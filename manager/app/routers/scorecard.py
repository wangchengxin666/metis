"""Workforce Scorecard & ROI analytics API endpoints (Admin & Team Lead scoped)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..deps import (
    _ensure_active_user,
    _is_authenticated_admin,
    require_user_api,
)
from ..models import Sandbox, TeamMember, TeamSandbox
from ..services.scorecard import (
    build_workforce_scorecard,
    render_scorecard_csv,
    render_scorecard_markdown,
)

router = APIRouter()


def _resolve_scorecard_sandboxes(
    request: Request,
    db: Session,
    team_id: str | None,
) -> list[Sandbox]:
    is_admin = _is_authenticated_admin(request, db)
    if is_admin:
        query = (
            select(Sandbox)
            .options(joinedload(Sandbox.user))
            .where(Sandbox.deleted_at.is_(None))
        )
        if team_id:
            sbx_ids = list(
                db.scalars(
                    select(TeamSandbox.sandbox_id).where(TeamSandbox.team_id == team_id)
                ).all()
            )
            query = query.where(Sandbox.id.in_(sbx_ids)) if sbx_ids else query.where(Sandbox.id == "")
        return list(db.scalars(query.order_by(Sandbox.slug.asc())).all())

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
    if not lead_team_ids:
        raise HTTPException(
            status_code=403,
            detail="仅平台管理员或团队负责人 (Team Lead) 可查看效能与 ROI 看板",
        )
    if team_id and team_id not in lead_team_ids:
        raise HTTPException(status_code=403, detail="无权查看其他团队的效能报表")
    scoped_team_ids = [team_id] if team_id else lead_team_ids
    sbx_ids = list(
        db.scalars(
            select(TeamSandbox.sandbox_id).where(TeamSandbox.team_id.in_(scoped_team_ids))
        ).all()
    )
    if not sbx_ids:
        return []
    return list(
        db.scalars(
            select(Sandbox)
            .options(joinedload(Sandbox.user))
            .where(Sandbox.deleted_at.is_(None), Sandbox.id.in_(sbx_ids))
            .order_by(Sandbox.slug.asc())
        ).all()
    )


@router.get("/api/scorecard")
def api_workforce_scorecard(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
    team_id: str | None = Query(default=None),
    hourly_rate_usd: float = Query(default=45.0, ge=1.0, le=1000.0),
    db: Session = Depends(get_db),
):
    sandboxes = _resolve_scorecard_sandboxes(request, db, team_id)
    return build_workforce_scorecard(
        db, sandboxes, days=days, team_id=team_id, hourly_rate_usd=hourly_rate_usd
    )


@router.get("/api/scorecard/export")
def api_export_workforce_scorecard(
    request: Request,
    format: str = Query(default="csv", pattern="^(csv|markdown)$"),
    days: int = Query(default=30, ge=1, le=365),
    team_id: str | None = Query(default=None),
    hourly_rate_usd: float = Query(default=45.0, ge=1.0, le=1000.0),
    db: Session = Depends(get_db),
):
    sandboxes = _resolve_scorecard_sandboxes(request, db, team_id)
    data = build_workforce_scorecard(
        db, sandboxes, days=days, team_id=team_id, hourly_rate_usd=hourly_rate_usd
    )
    if format == "markdown":
        content = render_scorecard_markdown(data)
        return PlainTextResponse(
            content=content,
            media_type="text/markdown; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="metis-roi-scorecard-{days}d.md"'
            },
        )
    content = render_scorecard_csv(data)
    return PlainTextResponse(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="metis-roi-scorecard-{days}d.csv"'
        },
    )
