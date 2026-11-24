"""Cross-sandbox workforce snapshot caching, deduplication, Global Inbox, and Deliverables Gallery."""

from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..docker_service import BaseSandboxRuntime
from ..models import (
    PlaybookRun,
    PlaybookStepRun,
    Sandbox,
    SandboxRuntimeSnapshot,
    Team,
    TeamMember,
    TeamSandbox,
)
from .common import utcnow
from .notifications import NotificationEvent, dispatch_notification_event
from .policies import get_branding_config

logger = logging.getLogger("dsh-manager.workspace_hub")

_PR_URL_RE = re.compile(r"https?://\S+/(?:pull|merge_requests)/\d+", re.IGNORECASE)
_URL_RE = re.compile(r"^https?://", re.IGNORECASE)
_BRANCH_RE = re.compile(r"^(?:branch:|feat/|fix/|chore/|release/|hotfix/|main$|master$)", re.IGNORECASE)


def _classify_artifact(raw: str) -> str:
    val = (raw or "").strip()
    if _PR_URL_RE.search(val):
        return "pr"
    if _URL_RE.match(val):
        return "url"
    if _BRANCH_RE.match(val):
        return "branch"
    return "file"


def _parse_snapshot_payload(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}


def _extract_task_index(payload: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    mesh = payload.get("mesh_summary") if isinstance(payload, dict) else None
    tasks = (mesh.get("tasks") or []) if isinstance(mesh, dict) else []
    idx: dict[tuple[str, str], dict[str, Any]] = {}
    for t in tasks:
        if not isinstance(t, dict) or not t.get("id"):
            continue
        key = (str(t.get("room_id") or "local"), str(t["id"]))
        idx[key] = t
    return idx


def _emit_snapshot_transition_events(
    db: Session,
    settings: Settings,
    sandbox: Sandbox,
    prev_payload: dict[str, Any],
    next_payload: dict[str, Any],
) -> None:
    prev_tasks = _extract_task_index(prev_payload)
    next_tasks = _extract_task_index(next_payload)
    if not next_tasks:
        return

    brand = get_branding_config(db)
    brand_name = str(brand.get("brand_name_zh") or brand.get("brand_name_en") or "Metis")

    for (room_id, task_id), task in next_tasks.items():
        assignee = str(task.get("assignee_slug") or sandbox.slug or "").strip().lower()
        # For replicated group tasks, let the assignee's own sandbox emit to avoid cross-peer duplicates
        if assignee and assignee != sandbox.slug.lower():
            continue

        prev = prev_tasks.get((room_id, task_id))
        title = str(task.get("title") or task_id)
        summary = str(task.get("summary") or task.get("description") or "")[:500]
        status = str(task.get("status") or "").lower()
        approval_req = bool(task.get("approval_required"))
        approval_status = str(task.get("approval_status") or "").lower()

        if approval_req and approval_status == "pending":
            dispatch_notification_event(
                db,
                settings,
                NotificationEvent(
                    event_type="approval.pending",
                    title=title,
                    summary=summary or "数字员工正在等待人工审批确认，请尽快处理。",
                    severity="warning",
                    sandbox_id=sandbox.id,
                    sandbox_slug=sandbox.slug,
                    role_title=sandbox.role_title,
                    project_team_name=sandbox.project_team_name,
                    task_id=task_id,
                    dedupe_key=f"approval.pending:{room_id}:{task_id}",
                    metadata={"room_id": room_id},
                ),
                brand_name=brand_name,
            )

        prev_status = str(prev.get("status") or "").lower() if prev else ""
        if status == "blocked" and prev_status != "blocked":
            dispatch_notification_event(
                db,
                settings,
                NotificationEvent(
                    event_type="task.blocked",
                    title=title,
                    summary=summary or "任务执行受阻，需要人工介入排查。",
                    severity="danger",
                    sandbox_id=sandbox.id,
                    sandbox_slug=sandbox.slug,
                    role_title=sandbox.role_title,
                    project_team_name=sandbox.project_team_name,
                    task_id=task_id,
                    dedupe_key=f"task.blocked:{room_id}:{task_id}:{task.get('updated_at') or ''}",
                ),
                brand_name=brand_name,
            )
        elif status == "done" and prev is not None and prev_status != "done":
            dispatch_notification_event(
                db,
                settings,
                NotificationEvent(
                    event_type="task.done",
                    title=title,
                    summary=summary or "任务已完成交付，请前往验收。",
                    severity="success",
                    sandbox_id=sandbox.id,
                    sandbox_slug=sandbox.slug,
                    role_title=sandbox.role_title,
                    project_team_name=sandbox.project_team_name,
                    task_id=task_id,
                    dedupe_key=f"task.done:{room_id}:{task_id}",
                ),
                brand_name=brand_name,
            )


def upsert_sandbox_runtime_snapshot(
    db: Session,
    sandbox: Sandbox,
    payload: dict[str, Any],
    *,
    settings: Settings | None = None,
    emit_notifications: bool = False,
) -> SandboxRuntimeSnapshot:
    snap = db.get(SandboxRuntimeSnapshot, sandbox.id)
    prev_payload = _parse_snapshot_payload(snap.payload_json) if snap else {}

    mesh = payload.get("mesh_summary") if isinstance(payload, dict) else {}
    if not isinstance(mesh, dict):
        mesh = {}
    tasks = mesh.get("tasks") or []
    pending_approvals = mesh.get("pending_approvals") or []
    exposed_apps = payload.get("exposed_apps") or []
    blocked_count = sum(
        1 for t in tasks if isinstance(t, dict) and str(t.get("status") or "").lower() == "blocked"
    )
    active_count = int(mesh.get("active_tasks_count") or 0)

    serialized = json.dumps(payload, ensure_ascii=False)
    now = utcnow()
    if snap is None:
        snap = SandboxRuntimeSnapshot(
            sandbox_id=sandbox.id,
            sandbox_slug=sandbox.slug,
            online=bool(payload.get("online")),
            status=str(payload.get("status") or sandbox.status or "stopped"),
            payload_json=serialized,
            pending_approvals_count=len(pending_approvals),
            active_tasks_count=active_count,
            blocked_tasks_count=blocked_count,
            exposed_apps_count=len(exposed_apps),
            updated_at=now,
        )
        db.add(snap)
    else:
        snap.sandbox_slug = sandbox.slug
        snap.online = bool(payload.get("online"))
        snap.status = str(payload.get("status") or sandbox.status or "stopped")
        snap.payload_json = serialized
        snap.pending_approvals_count = len(pending_approvals)
        snap.active_tasks_count = active_count
        snap.blocked_tasks_count = blocked_count
        snap.exposed_apps_count = len(exposed_apps)
        snap.updated_at = now

    db.commit()
    db.refresh(snap)

    if emit_notifications and settings is not None and snap.online:
        try:
            _emit_snapshot_transition_events(db, settings, sandbox, prev_payload, payload)
        except Exception as exc:
            logger.warning("snapshot notification diff failed for %s: %s", sandbox.slug, exc)
    return snap


def refresh_sandbox_snapshot(
    db: Session,
    docker: BaseSandboxRuntime,
    sandbox: Sandbox,
    *,
    settings: Settings | None = None,
    emit_notifications: bool = False,
) -> SandboxRuntimeSnapshot:
    payload = docker.inspect_workforce_runtime(sandbox)
    return upsert_sandbox_runtime_snapshot(
        db,
        sandbox,
        payload,
        settings=settings,
        emit_notifications=emit_notifications,
    )


def refresh_sandboxes_snapshots(
    db: Session,
    docker: BaseSandboxRuntime,
    sandboxes: list[Sandbox],
    *,
    settings: Settings | None = None,
    max_workers: int = 4,
    emit_notifications: bool = False,
) -> list[SandboxRuntimeSnapshot]:
    if not sandboxes:
        return []

    running: list[Sandbox] = []
    offline: list[Sandbox] = []
    for sbx in sandboxes:
        if sbx.status == "running":
            running.append(sbx)
        else:
            offline.append(sbx)

    inspected: dict[str, dict[str, Any]] = {}
    if running:
        workers = max(1, min(max_workers, len(running)))
        if workers == 1:
            for sbx in running:
                try:
                    inspected[sbx.id] = docker.inspect_workforce_runtime(sbx)
                except Exception as exc:
                    logger.warning("inspect_workforce_runtime failed for %s: %s", sbx.slug, exc)
        else:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                fut_map = {pool.submit(docker.inspect_workforce_runtime, sbx): sbx for sbx in running}
                for fut in as_completed(fut_map):
                    sbx = fut_map[fut]
                    try:
                        inspected[sbx.id] = fut.result()
                    except Exception as exc:
                        logger.warning("inspect_workforce_runtime failed for %s: %s", sbx.slug, exc)

    results: list[SandboxRuntimeSnapshot] = []
    for sbx in running:
        if sbx.id in inspected:
            results.append(
                upsert_sandbox_runtime_snapshot(
                    db,
                    sbx,
                    inspected[sbx.id],
                    settings=settings,
                    emit_notifications=emit_notifications,
                )
            )
    for sbx in offline:
        existing = db.get(SandboxRuntimeSnapshot, sbx.id)
        if existing is not None:
            existing.online = False
            existing.status = sbx.status or "stopped"
            existing.updated_at = utcnow()
            results.append(existing)
    if offline:
        db.commit()
    return results


def _load_snapshots_map(db: Session, sandbox_ids: list[str]) -> dict[str, SandboxRuntimeSnapshot]:
    if not sandbox_ids:
        return {}
    rows = list(
        db.scalars(
            select(SandboxRuntimeSnapshot).where(
                SandboxRuntimeSnapshot.sandbox_id.in_(sandbox_ids)
            )
        ).all()
    )
    return {row.sandbox_id: row for row in rows}


def _deduplicated_tasks_across_sandboxes(
    sandboxes: list[Sandbox],
    snap_map: dict[str, SandboxRuntimeSnapshot],
) -> list[dict[str, Any]]:
    """Deduplicate group-replicated mesh tasks by (room_id, task_id), preferring assignee's sandbox."""
    best_by_key: dict[tuple[str, str], tuple[int, dict[str, Any]]] = {}
    for sbx in sandboxes:
        snap = snap_map.get(sbx.id)
        if not snap:
            continue
        payload = _parse_snapshot_payload(snap.payload_json)
        mesh = payload.get("mesh_summary") if isinstance(payload, dict) else {}
        if not isinstance(mesh, dict):
            continue
        for raw in mesh.get("tasks") or []:
            if not isinstance(raw, dict) or not raw.get("id"):
                continue
            room_id = str(raw.get("room_id") or "local")
            task_id = str(raw["id"])
            assignee_slug = str(raw.get("assignee_slug") or sbx.slug or "")
            is_owner_match = assignee_slug.lower() == sbx.slug.lower()
            is_online = bool(snap.online and sbx.status == "running")
            updated_val = raw.get("updated_at") or raw.get("created_at") or 0
            score = (4 if is_owner_match else 0) + (2 if is_online else 0)
            entry = {
                "id": task_id,
                "room_id": room_id,
                "room_name": str(raw.get("room_name") or room_id),
                "thread_id": str(raw.get("thread_id") or ""),
                "thread_title": str(raw.get("thread_title") or ""),
                "title": str(raw.get("title") or task_id),
                "description": str(raw.get("description") or ""),
                "summary": str(raw.get("summary") or ""),
                "status": str(raw.get("status") or "open"),
                "priority": str(raw.get("priority") or "normal"),
                "assignee_slug": assignee_slug,
                "approval_required": bool(raw.get("approval_required")),
                "approval_status": str(raw.get("approval_status") or ""),
                "approval_decided_by": str(raw.get("approval_decided_by") or ""),
                "approval_note": str(raw.get("approval_note") or ""),
                "artifacts": [str(a) for a in (raw.get("artifacts") or []) if str(a).strip()],
                "created_at": raw.get("created_at"),
                "updated_at": updated_val,
                "sandbox_id": sbx.id,
                "sandbox_slug": sbx.slug,
                "sandbox_display_name": sbx.effective_display_name or sbx.slug,
                "role_title": sbx.role_title or mesh.get("role") or None,
                "project_team_name": sbx.project_team_name,
                "sandbox_status": sbx.status,
                "sandbox_online": is_online,
            }
            key = (room_id, task_id)
            prev = best_by_key.get(key)
            if prev is None or score > prev[0] or (
                score == prev[0] and str(updated_val) > str(prev[1].get("updated_at") or "")
            ):
                best_by_key[key] = (score, entry)

    items = [val for _, val in best_by_key.values()]
    priority_rank = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
    items.sort(
        key=lambda t: (
            0 if (t["approval_required"] and t["approval_status"] == "pending") else 1,
            0 if t["status"] == "blocked" else 1,
            0 if t["status"] not in {"done", "cancelled"} else 1,
            priority_rank.get(t["priority"], 2),
            -int(t["updated_at"]) if isinstance(t["updated_at"], (int, float)) else 0,
        )
    )
    return items


def _load_pending_playbook_approvals(
    db: Session,
    sandboxes: list[Sandbox],
    team_by_id: dict[str, Team],
    *,
    actor_email: str | None = None,
    is_admin: bool = True,
) -> list[dict[str, Any]]:
    """Collect Playbook stages currently awaiting human approval visible to the caller."""
    sbx_ids = {s.id for s in sandboxes}
    stmt = (
        select(PlaybookStepRun, PlaybookRun)
        .join(PlaybookRun, PlaybookStepRun.run_id == PlaybookRun.id)
        .where(
            PlaybookStepRun.status == "awaiting_approval",
            PlaybookRun.status.in_(["running", "awaiting_approval"]),
        )
        .order_by(PlaybookStepRun.started_at.desc(), PlaybookRun.updated_at.desc())
    )
    if not is_admin:
        clean_email = (actor_email or "").strip().lower()
        team_ids = (
            list(
                db.scalars(
                    select(TeamMember.team_id).where(TeamMember.user_email == clean_email)
                ).all()
            )
            if clean_email
            else []
        )
        filters = []
        if clean_email:
            filters.append(PlaybookRun.created_by == clean_email)
        if team_ids:
            filters.append(PlaybookRun.team_id.in_(team_ids))
        if sbx_ids:
            filters.append(PlaybookStepRun.sandbox_id.in_(list(sbx_ids)))
        if not filters:
            return []
        stmt = stmt.where(or_(*filters))

    rows = db.execute(stmt).all()
    items: list[dict[str, Any]] = []
    for step, run in rows:
        try:
            arts = json.loads(step.artifacts_json or "[]")
            if not isinstance(arts, list):
                arts = []
        except Exception:
            arts = []
        tm = team_by_id.get(run.team_id) if run.team_id else None
        items.append(
            {
                "id": step.id,
                "run_id": run.id,
                "run_title": run.title,
                "playbook_name": run.playbook_name,
                "stage_index": step.stage_index,
                "stage_name": step.stage_name,
                "role_hint": step.role_hint or "",
                "sandbox_id": step.sandbox_id,
                "sandbox_slug": step.sandbox_slug or "",
                "team_id": run.team_id,
                "project_team_name": tm.name if tm else None,
                "output_summary": step.output_summary or "",
                "deliverable_hint": step.deliverable_hint or "",
                "artifacts": [str(a) for a in arts if str(a).strip()],
                "started_at": step.started_at.isoformat() if step.started_at else None,
                "updated_at": run.updated_at.isoformat() if run.updated_at else None,
            }
        )
    return items


def _build_task_groups(
    tasks: list[dict[str, Any]],
    team_by_room: dict[str, Team],
    team_by_sbx: dict[str, Team],
    playbook_title_by_room: dict[str, str],
) -> list[dict[str, Any]]:
    """Fold granular mesh subtasks into parent workstreams keyed by (room_id, thread_id)."""
    buckets: dict[str, list[dict[str, Any]]] = {}
    for tk in tasks:
        room_id = str(tk.get("room_id") or "local")
        thread_id = str(tk.get("thread_id") or "").strip()
        if room_id.startswith(("intake:", "inbox:")):
            gkey = f"{room_id}:{tk['id']}"
        else:
            gkey = f"{room_id}:{thread_id or 'default'}"
        buckets.setdefault(gkey, []).append(tk)

    groups: list[dict[str, Any]] = []
    for gkey, items in buckets.items():
        # Order subtasks chronologically so expanded timelines read naturally from start to finish
        items_sorted = sorted(
            items,
            key=lambda t: (
                int(t.get("created_at") or 0) if isinstance(t.get("created_at"), (int, float)) else 0,
                int(t.get("updated_at") or 0) if isinstance(t.get("updated_at"), (int, float)) else 0,
                str(t.get("id") or ""),
            ),
        )
        first = items_sorted[0]
        room_id = str(first.get("room_id") or "local")
        room_name = str(first.get("room_name") or room_id)
        thread_id = str(first.get("thread_id") or "").strip()

        tm = team_by_room.get(room_id) or team_by_sbx.get(str(first.get("sandbox_id") or ""))
        project_team_id = tm.id if tm else None
        project_team_name = (tm.name if tm else None) or first.get("project_team_name")

        non_cancelled = [t for t in items_sorted if t["status"] != "cancelled"]
        done_cnt = sum(1 for t in non_cancelled if t["status"] == "done")
        blocked_cnt = sum(1 for t in non_cancelled if t["status"] == "blocked")
        pending_appr_cnt = sum(
            1 for t in non_cancelled if t["approval_required"] and t["approval_status"] == "pending"
        )
        active_cnt = sum(1 for t in non_cancelled if t["status"] != "done")
        cancelled_cnt = len(items_sorted) - len(non_cancelled)

        if blocked_cnt > 0:
            group_status = "blocked"
        elif pending_appr_cnt > 0:
            group_status = "pending_approval"
        elif active_cnt > 0:
            group_status = "active"
        elif done_cnt > 0:
            group_status = "done"
        else:
            group_status = "cancelled"

        # Derive clean parent title (never repeat project name redundantly when better context exists)
        thread_title = next(
            (str(t.get("thread_title") or "").strip() for t in items_sorted if str(t.get("thread_title") or "").strip()),
            "",
        )
        pb_title = playbook_title_by_room.get(room_id, "")
        if len(non_cancelled) == 1 and room_id.startswith(("intake:", "inbox:")):
            group_title = non_cancelled[0]["title"]
        elif pb_title and (not thread_title or pb_title.lower() in thread_title.lower()):
            group_title = pb_title
        elif thread_title and thread_title.lower() != (project_team_name or "").lower():
            group_title = thread_title
        elif pb_title:
            group_title = pb_title
        elif len(non_cancelled) == 1:
            group_title = non_cancelled[0]["title"]
        elif room_name and room_name.lower() != (project_team_name or "").lower():
            group_title = room_name
        elif non_cancelled:
            group_title = non_cancelled[0]["title"]
        else:
            group_title = first["title"]

        # Enrich each subtask with resolved project_team_id/name
        seen_participants: dict[str, dict[str, Any]] = {}
        latest_updated = 0
        for t in items_sorted:
            if project_team_id:
                t["project_team_id"] = project_team_id
            if project_team_name and not t.get("project_team_name"):
                t["project_team_name"] = project_team_name
            slug = str(t.get("sandbox_slug") or "")
            if slug and slug not in seen_participants:
                seen_participants[slug] = {
                    "sandbox_id": t["sandbox_id"],
                    "sandbox_slug": slug,
                    "role_title": t.get("role_title") or None,
                }
            upd = t.get("updated_at") or t.get("created_at") or 0
            if isinstance(upd, (int, float)) and upd > latest_updated:
                latest_updated = int(upd)

        groups.append(
            {
                "key": gkey,
                "room_id": room_id,
                "room_name": room_name,
                "thread_id": thread_id,
                "title": group_title,
                "project_team_id": project_team_id,
                "project_team_name": project_team_name,
                "status": group_status,
                "counts": {
                    "total": len(non_cancelled),
                    "done": done_cnt,
                    "active": active_cnt,
                    "blocked": blocked_cnt,
                    "cancelled": cancelled_cnt,
                    "pending_approvals": pending_appr_cnt,
                },
                "participants": list(seen_participants.values()),
                "updated_at": latest_updated or None,
                "tasks": items_sorted,
            }
        )

    status_rank = {"blocked": 0, "pending_approval": 1, "active": 2, "done": 3, "cancelled": 4}
    groups.sort(
        key=lambda g: (
            status_rank.get(g["status"], 3),
            -(int(g["updated_at"]) if isinstance(g.get("updated_at"), (int, float)) else 0),
        )
    )
    return groups


def build_workspace_inbox(
    db: Session,
    sandboxes: list[Sandbox],
    *,
    actor_email: str | None = None,
    is_admin: bool = True,
) -> dict[str, Any]:
    snap_map = _load_snapshots_map(db, [s.id for s in sandboxes])
    tasks = _deduplicated_tasks_across_sandboxes(sandboxes, snap_map)

    all_teams = list(db.scalars(select(Team)).all())
    team_by_id = {tm.id: tm for tm in all_teams}
    team_by_room = {tm.mesh_room_id: tm for tm in all_teams if tm.mesh_room_id}
    team_by_sbx: dict[str, Team] = {}
    if sandboxes:
        ts_rows = list(
            db.scalars(
                select(TeamSandbox).where(TeamSandbox.sandbox_id.in_([s.id for s in sandboxes]))
            ).all()
        )
        for ts in ts_rows:
            if ts.sandbox_id not in team_by_sbx and ts.team_id in team_by_id:
                team_by_sbx[ts.sandbox_id] = team_by_id[ts.team_id]

    room_ids = {str(t.get("room_id") or "") for t in tasks if t.get("room_id")}
    playbook_title_by_room: dict[str, str] = {}
    if room_ids:
        pb_rows = db.execute(
            select(PlaybookStepRun.room_id, PlaybookRun.title)
            .join(PlaybookRun, PlaybookStepRun.run_id == PlaybookRun.id)
            .where(PlaybookStepRun.room_id.in_(list(room_ids)))
            .order_by(PlaybookRun.created_at.desc())
        ).all()
        for r_id, r_title in pb_rows:
            if r_id and r_id not in playbook_title_by_room and r_title:
                playbook_title_by_room[r_id] = r_title

    playbook_approvals = _load_pending_playbook_approvals(
        db,
        sandboxes,
        team_by_id,
        actor_email=actor_email,
        is_admin=is_admin,
    )
    task_groups = _build_task_groups(tasks, team_by_room, team_by_sbx, playbook_title_by_room)

    pending_approvals = [
        t for t in tasks if t["approval_required"] and t["approval_status"] == "pending"
    ]
    blocked_tasks = [t for t in tasks if t["status"] == "blocked"]
    active_tasks = [t for t in tasks if t["status"] not in {"done", "cancelled"}]
    done_tasks = [t for t in tasks if t["status"] == "done"]

    active_groups_count = sum(1 for g in task_groups if g["status"] in {"blocked", "pending_approval", "active"})
    done_groups_count = sum(1 for g in task_groups if g["status"] == "done")
    total_pending_approvals = len(pending_approvals) + len(playbook_approvals)
    action_required_count = total_pending_approvals + len(blocked_tasks)

    exposed_apps_count = 0
    latest_synced: str | None = None
    sandbox_badges: dict[str, dict[str, int | bool]] = {}

    for sbx in sandboxes:
        snap = snap_map.get(sbx.id)
        if snap:
            exposed_apps_count += int(snap.exposed_apps_count or 0)
            iso = snap.updated_at.isoformat() if snap.updated_at else None
            if iso and (latest_synced is None or iso > latest_synced):
                latest_synced = iso
            sandbox_badges[sbx.id] = {
                "pending_approvals": int(snap.pending_approvals_count or 0),
                "active_tasks": int(snap.active_tasks_count or 0),
                "blocked_tasks": int(snap.blocked_tasks_count or 0),
                "exposed_apps": int(snap.exposed_apps_count or 0),
                "online": bool(snap.online),
            }

    return {
        "summary": {
            "pending_approvals_count": total_pending_approvals,
            "mesh_approvals_count": len(pending_approvals),
            "playbook_approvals_count": len(playbook_approvals),
            "blocked_tasks_count": len(blocked_tasks),
            "action_required_count": action_required_count,
            "active_tasks_count": len(active_tasks),
            "done_tasks_count": len(done_tasks),
            "active_groups_count": active_groups_count,
            "done_groups_count": done_groups_count,
            "running_sandboxes": sum(1 for s in sandboxes if s.status == "running"),
            "total_sandboxes": len(sandboxes),
            "exposed_apps_count": exposed_apps_count,
            "last_synced_at": latest_synced,
        },
        "pending_approvals": pending_approvals,
        "playbook_approvals": playbook_approvals,
        "blocked_tasks": blocked_tasks,
        "task_groups": task_groups,
        "tasks": tasks,
        "sandbox_badges": sandbox_badges,
    }


def build_workspace_deliverables(
    db: Session,
    sandboxes: list[Sandbox],
) -> dict[str, Any]:
    snap_map = _load_snapshots_map(db, [s.id for s in sandboxes])
    apps: list[dict[str, Any]] = []
    latest_synced: str | None = None

    for sbx in sandboxes:
        snap = snap_map.get(sbx.id)
        if not snap:
            continue
        iso = snap.updated_at.isoformat() if snap.updated_at else None
        if iso and (latest_synced is None or iso > latest_synced):
            latest_synced = iso
        payload = _parse_snapshot_payload(snap.payload_json)
        for app in payload.get("exposed_apps") or []:
            if not isinstance(app, dict) or not app.get("name"):
                continue
            apps.append(
                {
                    "name": str(app["name"]),
                    "url": str(app.get("url") or ""),
                    "mount_path": str(app.get("mount_path") or ""),
                    "target": str(app.get("target") or ""),
                    "sandbox_id": sbx.id,
                    "sandbox_slug": sbx.slug,
                    "sandbox_display_name": sbx.effective_display_name or sbx.slug,
                    "role_title": sbx.role_title,
                    "project_team_name": sbx.project_team_name,
                    "preview_auth_mode": getattr(sbx, "preview_auth_mode", None) or "public",
                    "sandbox_status": sbx.status,
                    "online": bool(snap.online and sbx.status == "running"),
                }
            )

    tasks = _deduplicated_tasks_across_sandboxes(sandboxes, snap_map)
    artifacts: list[dict[str, Any]] = []
    for task in tasks:
        for idx, art in enumerate(task.get("artifacts") or []):
            artifacts.append(
                {
                    "id": f"{task['room_id']}:{task['id']}:{idx}",
                    "value": art,
                    "kind": _classify_artifact(art),
                    "task_id": task["id"],
                    "task_title": task["title"],
                    "task_status": task["status"],
                    "room_name": task["room_name"],
                    "sandbox_id": task["sandbox_id"],
                    "sandbox_slug": task["sandbox_slug"],
                    "sandbox_display_name": task["sandbox_display_name"],
                    "role_title": task["role_title"],
                    "project_team_name": task["project_team_name"],
                    "updated_at": task["updated_at"],
                }
            )

    return {
        "apps": apps,
        "artifacts": artifacts,
        "total_apps": len(apps),
        "total_artifacts": len(artifacts),
        "last_synced_at": latest_synced,
    }
