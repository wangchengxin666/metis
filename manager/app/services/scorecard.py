"""Workforce Scorecard & ROI analytics combining task completion, first-pass approval rates, Playbooks, and FinOps ledger."""

from __future__ import annotations

import csv
import io
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    AuditLog,
    LlmUsageLedger,
    Playbook,
    PlaybookRun,
    PlaybookStepRun,
    Sandbox,
    Team,
    TeamSandbox,
)
from .common import utcnow
from .workspace_hub import _deduplicated_tasks_across_sandboxes, _load_snapshots_map


def _to_epoch_seconds(val: Any) -> float | None:
    if isinstance(val, (int, float)) and val > 0:
        return float(val) / 1000.0 if val > 1e12 else float(val)
    return None


def build_workforce_scorecard(
    db: Session,
    visible_sandboxes: list[Sandbox],
    *,
    days: int = 30,
    team_id: str | None = None,
    hourly_rate_usd: float = 45.0,
) -> dict[str, Any]:
    now = utcnow()
    clean_days = max(1, min(days, 365))
    since = now - timedelta(days=clean_days)

    sbx_ids = [s.id for s in visible_sandboxes]
    sbx_by_id = {s.id: s for s in visible_sandboxes}
    sbx_by_slug = {s.slug.lower(): s for s in visible_sandboxes}

    # 1. Deduplicated mesh tasks across visible sandboxes (exclude cancelled/superseded tasks from totals)
    snap_map = _load_snapshots_map(db, sbx_ids)
    all_tasks = _deduplicated_tasks_across_sandboxes(visible_sandboxes, snap_map)
    tasks = [t for t in all_tasks if t["status"] != "cancelled"]

    done_tasks = [t for t in tasks if t["status"] == "done"]
    blocked_tasks = [t for t in tasks if t["status"] == "blocked"]
    active_tasks = [t for t in tasks if t["status"] not in {"done", "cancelled"}]

    cycle_hours_samples: list[float] = []
    for t in done_tasks:
        c_ts = _to_epoch_seconds(t.get("created_at"))
        u_ts = _to_epoch_seconds(t.get("updated_at"))
        if c_ts and u_ts and u_ts >= c_ts:
            cycle_hours_samples.append((u_ts - c_ts) / 3600.0)

    # 2. Playbook runs in period
    pb_stmt = select(PlaybookRun).where(PlaybookRun.created_at >= since)
    if team_id:
        pb_stmt = pb_stmt.where(PlaybookRun.team_id == team_id)
    pb_runs = list(db.scalars(pb_stmt).all())
    pb_map = {p.id: p for p in db.scalars(select(Playbook)).all()}

    pb_completed = [r for r in pb_runs if r.status == "completed"]
    pb_hours_saved = 0.0
    for r in pb_completed:
        pb_obj = pb_map.get(r.playbook_id)
        pb_hours_saved += float(pb_obj.estimated_manual_hours if pb_obj else 4.0)
        if r.completed_at and r.created_at and r.completed_at >= r.created_at:
            cycle_hours_samples.append((r.completed_at - r.created_at).total_seconds() / 3600.0)

    # 3. Approvals (from AuditLog + PlaybookStepRun + Snapshot tasks)
    approved_count = 0
    rejected_count = 0
    pending_approvals = sum(
        1 for t in tasks if t.get("approval_required") and t.get("approval_status") == "pending"
    )

    if sbx_ids:
        audit_rows = list(
            db.scalars(
                select(AuditLog).where(
                    AuditLog.created_at >= since,
                    AuditLog.action.in_(
                        [
                            "sandbox.approval_approved",
                            "sandbox.approval_rejected",
                            "playbook.step_approved",
                            "playbook.step_rejected",
                        ]
                    ),
                )
            ).all()
        )
        run_id_set = {r.id for r in pb_runs}
        for log in audit_rows:
            in_scope = (log.target in sbx_by_id) or (log.target in run_id_set) or (
                log.sandbox_slug and log.sandbox_slug.lower() in sbx_by_slug
            )
            if not in_scope:
                continue
            if log.action.endswith("_approved"):
                approved_count += 1
            elif log.action.endswith("_rejected"):
                rejected_count += 1

    # Fallback to snapshot decided approvals if audit rows were empty
    if approved_count == 0 and rejected_count == 0:
        for t in tasks:
            if not t.get("approval_required"):
                continue
            st = str(t.get("approval_status") or "").lower()
            if st == "approved":
                approved_count += 1
            elif st == "rejected":
                rejected_count += 1

    # Include awaiting Playbook step approvals
    if pb_runs:
        pb_pending_steps = list(
            db.scalars(
                select(PlaybookStepRun).where(
                    PlaybookStepRun.run_id.in_([r.id for r in pb_runs]),
                    PlaybookStepRun.status == "awaiting_approval",
                )
            ).all()
        )
        pending_approvals += len(pb_pending_steps)

    decided_total = approved_count + rejected_count
    first_pass_rate = round((approved_count / decided_total) * 100.0, 1) if decided_total > 0 else None

    # 4. Real LLM Usage Ledger Cost
    ledger_rows: list[LlmUsageLedger] = []
    if sbx_ids:
        lstmt = select(LlmUsageLedger).where(
            LlmUsageLedger.sandbox_id.in_(sbx_ids),
            LlmUsageLedger.created_at >= since,
        )
        if team_id:
            lstmt = lstmt.where(LlmUsageLedger.team_id == team_id)
        ledger_rows = list(db.scalars(lstmt).all())

    cost_by_sbx: dict[str, dict[str, Any]] = {}
    total_cost = 0.0
    total_tokens = 0
    for r in ledger_rows:
        total_cost += r.cost_amount
        total_tokens += r.total_tokens
        slot = cost_by_sbx.setdefault(r.sandbox_id, {"cost": 0.0, "tokens": 0, "requests": 0})
        slot["cost"] = round(slot["cost"] + r.cost_amount, 6)
        slot["tokens"] += r.total_tokens
        slot["requests"] += 1

    # Per-sandbox task & ROI rollup
    sbx_tasks_map: dict[str, dict[str, int]] = {}
    for t in tasks:
        sid = str(t.get("sandbox_id") or "")
        slot = sbx_tasks_map.setdefault(
            sid, {"total": 0, "done": 0, "blocked": 0, "approved": 0, "rejected": 0}
        )
        slot["total"] += 1
        if t["status"] == "done":
            slot["done"] += 1
        elif t["status"] == "blocked":
            slot["blocked"] += 1
        if t.get("approval_required"):
            ap = str(t.get("approval_status") or "").lower()
            if ap == "approved":
                slot["approved"] += 1
            elif ap == "rejected":
                slot["rejected"] += 1

    # Team mappings for department ROI
    ts_rows = (
        list(
            db.scalars(
                select(TeamSandbox).where(TeamSandbox.sandbox_id.in_(sbx_ids))
            ).all()
        )
        if sbx_ids
        else []
    )
    sbx_to_teams: dict[str, list[str]] = {}
    for ts in ts_rows:
        sbx_to_teams.setdefault(ts.sandbox_id, []).append(ts.team_id)

    team_objs = (
        {
            t.id: t
            for t in db.scalars(
                select(Team).where(Team.id.in_(list({r.team_id for r in ts_rows})))
            ).all()
        }
        if ts_rows
        else {}
    )

    by_sandbox: list[dict[str, Any]] = []
    team_agg: dict[str, dict[str, Any]] = {}

    for sbx in visible_sandboxes:
        tstat = sbx_tasks_map.get(sbx.id) or {
            "total": 0,
            "done": 0,
            "blocked": 0,
            "approved": 0,
            "rejected": 0,
        }
        cstat = cost_by_sbx.get(sbx.id) or {"cost": 0.0, "tokens": 0, "requests": 0}
        comp_pct = round((tstat["done"] / tstat["total"]) * 100.0, 1) if tstat["total"] > 0 else None
        cost_per_task = round(cstat["cost"] / tstat["done"], 4) if tstat["done"] > 0 else None
        est_hours = round(tstat["done"] * 1.5, 1)

        by_sandbox.append(
            {
                "sandbox_id": sbx.id,
                "slug": sbx.slug,
                "display_name": sbx.effective_display_name or sbx.slug,
                "role_title": sbx.role_title,
                "ownership_mode": getattr(sbx, "ownership_mode", "personal") or "personal",
                "total_tasks": tstat["total"],
                "done_tasks": tstat["done"],
                "blocked_tasks": tstat["blocked"],
                "completion_rate_pct": comp_pct,
                "tokens": cstat["tokens"],
                "cost_usd": round(cstat["cost"], 4),
                "cost_per_task_usd": cost_per_task,
                "estimated_hours_saved": est_hours,
            }
        )

        for tid in sbx_to_teams.get(sbx.id, []):
            if team_id and tid != team_id:
                continue
            tm = team_objs.get(tid)
            tslot = team_agg.setdefault(
                tid,
                {
                    "team_id": tid,
                    "team_name": tm.name if tm else tid,
                    "department": tm.department if tm else None,
                    "employees_count": 0,
                    "total_tasks": 0,
                    "done_tasks": 0,
                    "blocked_tasks": 0,
                    "cost_usd": 0.0,
                    "estimated_hours_saved": 0.0,
                },
            )
            tslot["employees_count"] += 1
            tslot["total_tasks"] += tstat["total"]
            tslot["done_tasks"] += tstat["done"]
            tslot["blocked_tasks"] += tstat["blocked"]
            tslot["cost_usd"] = round(tslot["cost_usd"] + cstat["cost"], 4)
            tslot["estimated_hours_saved"] = round(tslot["estimated_hours_saved"] + est_hours, 1)

    by_sandbox.sort(key=lambda x: (-x["done_tasks"], -x["cost_usd"], x["slug"]))
    by_team = sorted(team_agg.values(), key=lambda x: (-x["done_tasks"], -x["cost_usd"]))

    total_deliveries = len(done_tasks) + len(pb_completed)
    standalone_hours = len(done_tasks) * 1.5
    estimated_hours_saved = round(standalone_hours + pb_hours_saved, 1)
    estimated_value_usd = round(estimated_hours_saved * hourly_rate_usd, 2)
    roi_multiple = round(estimated_value_usd / total_cost, 1) if total_cost > 0.001 else None

    total_tasks_count = len(tasks)
    completion_rate = (
        round((len(done_tasks) / total_tasks_count) * 100.0, 1)
        if total_tasks_count > 0
        else None
    )
    blocked_rate = (
        round((len(blocked_tasks) / total_tasks_count) * 100.0, 1)
        if total_tasks_count > 0
        else None
    )
    avg_cycle_hours = (
        round(sum(cycle_hours_samples) / len(cycle_hours_samples), 2)
        if cycle_hours_samples
        else None
    )
    cost_per_delivery = (
        round(total_cost / total_deliveries, 4) if total_deliveries > 0 else None
    )

    return {
        "period_days": clean_days,
        "hourly_rate_usd": hourly_rate_usd,
        "generated_at": now.isoformat() + "Z",
        "kpis": {
            "total_employees": len(visible_sandboxes),
            "total_tasks": total_tasks_count,
            "done_tasks": len(done_tasks),
            "active_tasks": len(active_tasks),
            "blocked_tasks": len(blocked_tasks),
            "completion_rate_pct": completion_rate,
            "blocked_rate_pct": blocked_rate,
            "approvals_approved": approved_count,
            "approvals_rejected": rejected_count,
            "approvals_pending": pending_approvals,
            "first_pass_approval_rate_pct": first_pass_rate,
            "avg_cycle_hours": avg_cycle_hours,
            "playbook_runs_total": len(pb_runs),
            "playbook_runs_completed": len(pb_completed),
            "total_tokens": total_tokens,
            "total_cost_usd": round(total_cost, 4),
            "cost_per_task_usd": cost_per_delivery,
            "estimated_hours_saved": estimated_hours_saved,
            "estimated_value_usd": estimated_value_usd,
            "roi_multiple": roi_multiple,
        },
        "by_sandbox": by_sandbox,
        "by_team": by_team,
    }


def render_scorecard_csv(data: dict[str, Any]) -> str:
    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Employee Slug",
            "Display Name",
            "Role",
            "Ownership",
            "Total Tasks",
            "Completed Tasks",
            "Blocked Tasks",
            "Completion Rate (%)",
            "Tokens",
            "Cost (USD)",
            "Cost / Task (USD)",
            "Est. Hours Saved",
        ]
    )
    for row in data.get("by_sandbox") or []:
        writer.writerow(
            [
                row["slug"],
                row["display_name"],
                row["role_title"] or "",
                row["ownership_mode"],
                row["total_tasks"],
                row["done_tasks"],
                row["blocked_tasks"],
                row["completion_rate_pct"] if row["completion_rate_pct"] is not None else "",
                row["tokens"],
                row["cost_usd"],
                row["cost_per_task_usd"] if row["cost_per_task_usd"] is not None else "",
                row["estimated_hours_saved"],
            ]
        )
    return buf.getvalue()


def render_scorecard_markdown(data: dict[str, Any]) -> str:
    k = data["kpis"]
    roi_str = f"{k['roi_multiple']}x" if k["roi_multiple"] is not None else "N/A"
    lines = [
        f"# Metis Workforce ROI & 效能月报（近 {data['period_days']} 天）",
        "",
        f"> 生成时间：{data['generated_at']} · 人力折算基准：`${data['hourly_rate_usd']}/小时`",
        "",
        "## 一、核心效能与 ROI 指标",
        "",
        "| 指标 | 数值 |",
        "| :--- | :--- |",
        f"| 统计数字员工数 | {k['total_employees']} |",
        f"| 任务完成率 | {k['completion_rate_pct'] if k['completion_rate_pct'] is not None else 'N/A'}% ({k['done_tasks']}/{k['total_tasks']}) |",
        f"| 人工审批一次通过率 | {k['first_pass_approval_rate_pct'] if k['first_pass_approval_rate_pct'] is not None else 'N/A'}% ({k['approvals_approved']} 通过 / {k['approvals_rejected']} 驳回) |",
        f"| 任务阻塞率 | {k['blocked_rate_pct'] if k['blocked_rate_pct'] is not None else 'N/A'}% ({k['blocked_tasks']}) |",
        f"| 平均交付周期 | {k['avg_cycle_hours'] if k['avg_cycle_hours'] is not None else 'N/A'} 小时 |",
        f"| Playbook 端到端交付 | {k['playbook_runs_completed']} / {k['playbook_runs_total']} |",
        f"| 真实 LLM 算力成本 | ${k['total_cost_usd']} ({k['total_tokens']:,} tokens) |",
        f"| 单次交付平均成本 | ${k['cost_per_task_usd'] if k['cost_per_task_usd'] is not None else 'N/A'} |",
        f"| 估算节省人时 / 价值 | {k['estimated_hours_saved']} 小时 (约 ${k['estimated_value_usd']}) |",
        f"| 综合投入产出比 (ROI) | {roi_str} |",
        "",
        "## 二、数字员工产出与成本明细",
        "",
        "| 数字员工 | 岗位 | 已完成/总任务 | 阻塞 | 真实成本 (USD) | 估算节省人时 |",
        "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for row in data.get("by_sandbox") or []:
        lines.append(
            f"| `@{row['slug']}` ({row['display_name']}) | {row['role_title'] or '-'} | "
            f"{row['done_tasks']}/{row['total_tasks']} | {row['blocked_tasks']} | "
            f"${row['cost_usd']} | {row['estimated_hours_saved']}h |"
        )
    if data.get("by_team"):
        lines.extend(
            [
                "",
                "## 三、团队/部门效能汇总",
                "",
                "| 团队 | 部门 | 员工数 | 完成任务 | 真实成本 (USD) | 估算节省人时 |",
                "| :--- | :--- | :--- | :--- | :--- | :--- |",
            ]
        )
        for tm in data["by_team"]:
            lines.append(
                f"| {tm['team_name']} | {tm['department'] or '-'} | {tm['employees_count']} | "
                f"{tm['done_tasks']}/{tm['total_tasks']} | ${tm['cost_usd']} | {tm['estimated_hours_saved']}h |"
            )
    lines.append("")
    return "\n".join(lines)
