"""Organizational Memory Hub endpoints: browse sandbox memories and promote into versioned SOPs or Team Knowledge."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import (
    _ensure_active_user,
    _is_authenticated_admin,
    _manager_error,
    require_user_api,
    resolve_docker,
    session_email,
    settings,
)
from ..models import MemoryPromotion, TeamMember
from ..schemas import MemoryPromoteRequest
from ..services import load_sandbox
from ..services.memory_hub import promote_sandbox_memory, serialize_promotion
from ..services.teams import can_user_open_sandbox_ide, is_team_lead_for_team

router = APIRouter()


@router.get("/api/memory-hub/sandboxes/{sandbox_id}/memories")
def api_inspect_sandbox_memories(
    sandbox_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Browse curated long-term memories accumulated by a digital employee."""
    is_admin = _is_authenticated_admin(request, db)
    email = session_email(request)
    if not is_admin:
        email = require_user_api(request)
        _ensure_active_user(db, email)
    try:
        sandbox = load_sandbox(db, sandbox_id)
    except Exception as exc:
        raise _manager_error(exc) from exc

    if not can_user_open_sandbox_ide(db, sandbox, email, is_admin):
        raise HTTPException(
            status_code=403,
            detail="仅平台管理员、团队负责人或该员工维护者可检视记忆条目",
        )
    docker = resolve_docker()
    if not hasattr(docker, "inspect_sandbox_memories"):
        return {"ok": True, "online": True, "slug": sandbox.slug, "memories": []}
    return docker.inspect_sandbox_memories(sandbox)


@router.post("/api/memory-hub/promote", status_code=201)
def api_promote_memory(
    payload: MemoryPromoteRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Promote a reviewed sandbox memory into a versioned Template SOP or Team Shared Doc with optional canary rollout."""
    is_admin = _is_authenticated_admin(request, db)
    if is_admin:
        actor = session_email(request) or settings.manager_admin_email
    else:
        actor = require_user_api(request)
        _ensure_active_user(db, actor)

    try:
        source_sbx = load_sandbox(db, payload.source_sandbox_id)
    except Exception as exc:
        raise _manager_error(exc) from exc

    if not can_user_open_sandbox_ide(db, source_sbx, actor, is_admin):
        raise HTTPException(status_code=403, detail="无权检视或晋升该数字员工的记忆条目")

    if payload.target_type == "template_sop" and not is_admin:
        raise HTTPException(
            status_code=403,
            detail="仅平台管理员可晋升修改全局岗位模板 SOP；Team Lead 可晋升至团队共享知识库",
        )
    if payload.target_type == "team_shared_doc" and not is_admin:
        if not payload.target_team_id or not is_team_lead_for_team(
            db, actor, payload.target_team_id
        ):
            raise HTTPException(
                status_code=403,
                detail="仅平台管理员或目标团队负责人 (Team Lead) 可推送团队共享知识库",
            )

    try:
        promo, rollout = promote_sandbox_memory(
            db, resolve_docker(), source_sbx, payload, actor=actor
        )
        return {"promotion": serialize_promotion(promo), "rollout": rollout}
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.get("/api/memory-hub/promotions")
def api_list_memory_promotions(
    request: Request,
    limit: int = Query(default=40, ge=1, le=200),
    db: Session = Depends(get_db),
):
    is_admin = _is_authenticated_admin(request, db)
    stmt = select(MemoryPromotion)
    if not is_admin:
        email = require_user_api(request)
        _ensure_active_user(db, email)
        lead_team_ids = list(
            db.scalars(
                select(TeamMember.team_id).where(
                    TeamMember.user_email == email,
                    TeamMember.role == "lead",
                )
            ).all()
        )
        if lead_team_ids:
            stmt = stmt.where(
                or_(
                    MemoryPromotion.promoted_by == email,
                    MemoryPromotion.target_team_id.in_(lead_team_ids),
                )
            )
        else:
            stmt = stmt.where(MemoryPromotion.promoted_by == email)

    rows = list(db.scalars(stmt.order_by(MemoryPromotion.created_at.desc()).limit(limit)).all())
    return {"items": [serialize_promotion(r) for r in rows]}
