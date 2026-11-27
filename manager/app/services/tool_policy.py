"""Enterprise Tool-level Human-in-the-Loop (HITL) policy rules & approval workflow."""

from __future__ import annotations

import re
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import Sandbox, ToolApprovalRequest, ToolPolicyRule
from ..schemas import ToolPolicyRuleCreate, ToolPolicyRuleUpdate
from .common import NotFoundError, audit, utcnow
from .notifications import NotificationEvent, dispatch_notification_event
from .policies import get_branding_config


def serialize_tool_policy_rule(r: ToolPolicyRule) -> dict[str, Any]:
    return {
        "id": r.id,
        "name": r.name,
        "enabled": bool(r.enabled),
        "tool_pattern": r.tool_pattern,
        "arg_regex": r.arg_regex,
        "action": r.action,
        "scope_sandbox_id": r.scope_sandbox_id,
        "description": r.description,
        "created_by": r.created_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def serialize_tool_approval_request(req: ToolApprovalRequest) -> dict[str, Any]:
    return {
        "id": req.id,
        "sandbox_id": req.sandbox_id,
        "sandbox_slug": req.sandbox_slug,
        "rule_id": req.rule_id,
        "rule_name": req.rule_name,
        "playbook_run_id": req.playbook_run_id,
        "playbook_step_id": req.playbook_step_id,
        "tool_name": req.tool_name,
        "tool_args_summary": req.tool_args_summary,
        "status": req.status,
        "decided_by": req.decided_by,
        "decision_note": req.decision_note,
        "decided_at": req.decided_at.isoformat() if req.decided_at else None,
        "expires_at": req.expires_at.isoformat() if req.expires_at else None,
        "created_at": req.created_at.isoformat() if req.created_at else None,
    }


def _validate_regex(pattern: str | None, field_name: str) -> str | None:
    clean = (pattern or "").strip()
    if not clean:
        return None
    try:
        re.compile(clean)
    except re.error as exc:
        raise ValueError(f"{field_name} 不是合法的正则表达式: {exc}") from exc
    return clean


def list_tool_policy_rules(db: Session) -> list[ToolPolicyRule]:
    return list(db.scalars(select(ToolPolicyRule).order_by(ToolPolicyRule.created_at.asc())).all())


def create_tool_policy_rule(
    db: Session, payload: ToolPolicyRuleCreate, *, actor: str
) -> ToolPolicyRule:
    tool_pat = _validate_regex(payload.tool_pattern, "tool_pattern") or "*"
    arg_rx = _validate_regex(payload.arg_regex, "arg_regex")
    rule = ToolPolicyRule(
        name=payload.name.strip(),
        enabled=bool(payload.enabled),
        tool_pattern=tool_pat,
        arg_regex=arg_rx,
        action=payload.action,
        scope_sandbox_id=(payload.scope_sandbox_id or "").strip() or None,
        description=(payload.description or "").strip() or None,
        created_by=actor,
    )
    db.add(rule)
    audit(db, "tool_policy.create", target=rule.name, actor=actor, detail=f"action={rule.action},pattern={tool_pat}")
    db.commit()
    db.refresh(rule)
    return rule


def update_tool_policy_rule(
    db: Session, rule_id: str, payload: ToolPolicyRuleUpdate, *, actor: str
) -> ToolPolicyRule:
    rule = db.get(ToolPolicyRule, rule_id)
    if rule is None:
        raise NotFoundError("工具策略规则不存在")
    if payload.name is not None:
        rule.name = payload.name.strip()
    if payload.enabled is not None:
        rule.enabled = bool(payload.enabled)
    if payload.tool_pattern is not None:
        rule.tool_pattern = _validate_regex(payload.tool_pattern, "tool_pattern") or rule.tool_pattern
    if "arg_regex" in payload.model_fields_set or payload.arg_regex is not None:
        rule.arg_regex = _validate_regex(payload.arg_regex, "arg_regex")
    if payload.action is not None:
        rule.action = payload.action
    if "scope_sandbox_id" in payload.model_fields_set or payload.scope_sandbox_id is not None:
        rule.scope_sandbox_id = (payload.scope_sandbox_id or "").strip() or None
    if payload.description is not None:
        rule.description = payload.description.strip() or None
    rule.updated_at = utcnow()
    audit(db, "tool_policy.update", target=rule.id, actor=actor, detail=f"name={rule.name},enabled={rule.enabled}")
    db.commit()
    db.refresh(rule)
    return rule


def delete_tool_policy_rule(db: Session, rule_id: str, *, actor: str) -> None:
    rule = db.get(ToolPolicyRule, rule_id)
    if rule is None:
        raise NotFoundError("工具策略规则不存在")
    audit(db, "tool_policy.delete", target=rule.id, actor=actor, detail=f"name={rule.name}")
    db.delete(rule)
    db.commit()


def _rule_matches(rule: ToolPolicyRule, sandbox_id: str, tool_name: str, args_summary: str) -> bool:
    if rule.scope_sandbox_id and rule.scope_sandbox_id != sandbox_id:
        return False
    try:
        if not re.search(rule.tool_pattern, tool_name, re.IGNORECASE):
            return False
        if rule.arg_regex:
            if not re.search(rule.arg_regex, args_summary, re.IGNORECASE):
                return False
        return True
    except re.error:
        return False


def evaluate_tool_call(
    db: Session,
    settings: Settings,
    sandbox: Sandbox,
    *,
    tool_name: str,
    args_summary: str = "",
    playbook_run_id: str | None = None,
    playbook_step_id: str | None = None,
) -> dict[str, Any]:
    """Evaluate active ToolPolicyRules against a requested tool execution."""
    clean_tool = (tool_name or "").strip()[:128]
    clean_args = (args_summary or "").strip()[:2000]
    rules = list(
        db.scalars(
            select(ToolPolicyRule)
            .where(ToolPolicyRule.enabled == True)  # noqa: E712
            .order_by(ToolPolicyRule.created_at.asc())
        ).all()
    )
    matched = [r for r in rules if _rule_matches(r, sandbox.id, clean_tool, clean_args)]
    if not matched:
        return {"allowed": True, "action": "allow", "rule_name": None, "approval_id": None}

    priority = {"block": 3, "require_approval": 2, "audit": 1}
    matched.sort(key=lambda r: -priority.get(r.action, 0))
    chosen = matched[0]

    if chosen.action == "audit":
        audit(
            db,
            "tool_policy.audit",
            target=sandbox.id,
            actor=f"sandbox:{sandbox.slug}",
            detail=f"slug={sandbox.slug},tool={clean_tool},rule={chosen.name}",
        )
        db.commit()
        return {"allowed": True, "action": "audit", "rule_name": chosen.name, "approval_id": None}

    if chosen.action == "block":
        audit(
            db,
            "tool_policy.blocked",
            target=sandbox.id,
            actor=f"sandbox:{sandbox.slug}",
            detail=f"slug={sandbox.slug},tool={clean_tool},rule={chosen.name}",
        )
        db.commit()
        return {
            "allowed": False,
            "action": "block",
            "rule_name": chosen.name,
            "approval_id": None,
            "reason": chosen.description or f"Tool '{clean_tool}' blocked by policy '{chosen.name}'",
        }

    # require_approval -> create persistent HITL request & notify Inbox / IM channels
    now = utcnow()
    req = ToolApprovalRequest(
        sandbox_id=sandbox.id,
        sandbox_slug=sandbox.slug,
        rule_id=chosen.id,
        rule_name=chosen.name,
        playbook_run_id=playbook_run_id,
        playbook_step_id=playbook_step_id,
        tool_name=clean_tool,
        tool_args_summary=clean_args,
        status="pending",
        expires_at=now + timedelta(hours=1),
        created_at=now,
    )
    db.add(req)
    db.flush()
    audit(
        db,
        "tool_policy.approval_requested",
        target=sandbox.id,
        actor=f"sandbox:{sandbox.slug}",
        detail=f"slug={sandbox.slug},tool={clean_tool},approval_id={req.id}",
    )
    brand = get_branding_config(db)
    brand_name = str(brand.get("brand_name_zh") or brand.get("brand_name_en") or "Metis")
    dispatch_notification_event(
        db,
        settings,
        NotificationEvent(
            event_type="approval.pending",
            title=f"高危操作审批：@{sandbox.slug} 请求执行 {clean_tool}",
            summary=(
                f"命中策略「{chosen.name}」。参数摘要：{clean_args[:240] or '无'}\n"
                f"请在 Metis 收件箱确认是否授权放行。"
            ),
            severity="warning",
            sandbox_id=sandbox.id,
            sandbox_slug=sandbox.slug,
            role_title=sandbox.role_title,
            project_team_name=sandbox.project_team_name,
            dedupe_key=f"tool.approval:{req.id}",
        ),
        brand_name=brand_name,
    )
    db.commit()
    db.refresh(req)
    return {
        "allowed": False,
        "action": "require_approval",
        "status": "pending",
        "rule_name": chosen.name,
        "approval_id": req.id,
        "reason": chosen.description or f"High-risk tool '{clean_tool}' requires human approval.",
    }


def decide_tool_approval(
    db: Session,
    approval_id: str,
    *,
    decision: str,
    note: str = "",
    actor: str,
) -> ToolApprovalRequest:
    req = db.get(ToolApprovalRequest, approval_id)
    if req is None:
        raise NotFoundError("工具操作审批记录不存在")
    if req.status != "pending":
        return req
    req.status = "approved" if decision == "approved" else "rejected"
    req.decided_by = actor
    req.decision_note = (note or "").strip() or None
    req.decided_at = utcnow()
    audit(
        db,
        f"tool_policy.approval_{req.status}",
        target=req.sandbox_id,
        actor=actor,
        detail=f"slug={req.sandbox_slug},tool={req.tool_name},approval_id={req.id}",
    )
    db.commit()
    db.refresh(req)
    return req


def list_tool_approvals(
    db: Session,
    *,
    status: str | None = None,
    sandbox_ids: list[str] | None = None,
    limit: int = 50,
) -> list[ToolApprovalRequest]:
    stmt = select(ToolApprovalRequest)
    if status:
        stmt = stmt.where(ToolApprovalRequest.status == status)
    if sandbox_ids is not None:
        if not sandbox_ids:
            return []
        stmt = stmt.where(ToolApprovalRequest.sandbox_id.in_(sandbox_ids))
    stmt = stmt.order_by(ToolApprovalRequest.created_at.desc()).limit(max(1, min(limit, 200)))
    return list(db.scalars(stmt).all())
