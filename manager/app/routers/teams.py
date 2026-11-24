"""First-class Team / Department management, Team Lead RBAC endpoints, and self-service hiring requests."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..deps import (
    _ensure_active_user,
    _is_authenticated_admin,
    _manager_error,
    require_admin_api,
    require_user_api,
    resolve_docker,
    session_email,
    settings,
)
from ..models import ProvisionRequest, Sandbox, Team, TeamMember, TeamSandbox
from ..schemas import (
    ProvisionRequestCreate,
    ProvisionRequestDecision,
    TeamCreate,
    TeamMemberUpsert,
    TeamSandboxAttach,
    TeamSharedDocSyncRequest,
    TeamUpdate,
    TemplateOut,
)
from ..services import audit, list_templates, load_sandbox
from ..services.teams import (
    attach_sandbox_to_team,
    create_provision_request,
    create_team,
    decide_provision_request,
    delete_team,
    detach_sandbox_from_team,
    is_team_lead_for_team,
    list_accessible_sandboxes,
    remove_team_member,
    serialize_provision_request,
    serialize_team,
    sync_project_mesh_group,
    update_team,
    upsert_team_member,
)

router = APIRouter()


def _require_team_manager(
    request: Request, db: Session, team_id: str
) -> tuple[str, bool]:
    is_admin = _is_authenticated_admin(request, db)
    if is_admin:
        return session_email(request) or settings.manager_admin_email, True
    email = require_user_api(request)
    _ensure_active_user(db, email)
    if not is_team_lead_for_team(db, email, team_id):
        raise HTTPException(status_code=403, detail="仅平台管理员或该团队负责人 (Team Lead) 可执行此操作")
    return email, False


@router.get("/api/teams")
def api_list_teams(
    request: Request,
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    is_admin = _is_authenticated_admin(request, db)
    email = session_email(request)
    stmt = select(Team)
    if status in {"active", "archived"}:
        stmt = stmt.where(Team.status == status)
    if is_admin:
        teams = list(db.scalars(stmt.order_by(Team.status.asc(), Team.name.asc())).all())
    else:
        email = require_user_api(request)
        _ensure_active_user(db, email)
        team_ids = list(
            db.scalars(
                select(TeamMember.team_id).where(TeamMember.user_email == email)
            ).all()
        )
        teams = (
            list(
                db.scalars(
                    stmt.where(Team.id.in_(team_ids)).order_by(Team.status.asc(), Team.name.asc())
                ).all()
            )
            if team_ids
            else []
        )
    return {
        "items": [
            serialize_team(db, t, viewer_email=email, is_admin=is_admin)
            for t in teams
        ]
    }


@router.post("/api/teams", status_code=201)
def api_create_team(
    payload: TeamCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    """Allow both Platform Admins and authenticated users to create a Project; creator becomes Project Lead."""
    is_admin = _is_authenticated_admin(request, db)
    if is_admin:
        actor = session_email(request) or settings.manager_admin_email
    else:
        actor = require_user_api(request)
        _ensure_active_user(db, actor)
        if payload.sandbox_ids:
            accessible_ids = {
                s.id for s in list_accessible_sandboxes(db, actor, is_admin=False)
            }
            forbidden = [sid for sid in payload.sandbox_ids if sid not in accessible_ids]
            if forbidden:
                raise HTTPException(
                    status_code=403,
                    detail="只能将自己有权限访问的数字员工加入新建项目",
                )
    try:
        team = create_team(
            db,
            payload,
            actor=actor,
            docker=resolve_docker(),
            auto_add_creator_as_lead=not is_admin,
        )
        return serialize_team(db, team, viewer_email=actor, is_admin=is_admin)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.patch("/api/teams/{team_id}")
def api_update_team(
    team_id: str,
    payload: TeamUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, is_admin = _require_team_manager(request, db, team_id)
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")
    try:
        updated = update_team(db, team, payload, actor=actor)
        return serialize_team(db, updated, viewer_email=actor, is_admin=is_admin)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/teams/{team_id}")
def api_delete_team(
    team_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")
    delete_team(db, team, actor=session_email(request) or settings.manager_admin_email)
    return {"ok": True}


@router.post("/api/teams/{team_id}/members")
def api_upsert_team_member(
    team_id: str,
    payload: TeamMemberUpsert,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, is_admin = _require_team_manager(request, db, team_id)
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")
    upsert_team_member(
        db, team, email=str(payload.email), role=payload.role, actor=actor
    )
    return serialize_team(db, team, viewer_email=actor, is_admin=is_admin)


@router.delete("/api/teams/{team_id}/members/{member_email}")
def api_remove_team_member(
    team_id: str,
    member_email: str,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, is_admin = _require_team_manager(request, db, team_id)
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")
    try:
        remove_team_member(db, team, member_email, actor=actor)
        return serialize_team(db, team, viewer_email=actor, is_admin=is_admin)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/teams/{team_id}/sandboxes")
def api_attach_team_sandbox(
    team_id: str,
    payload: TeamSandboxAttach,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, is_admin = _require_team_manager(request, db, team_id)
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")
    try:
        sandbox = load_sandbox(db, payload.sandbox_id)
        if not is_admin:
            accessible_ids = {
                s.id for s in list_accessible_sandboxes(db, actor, is_admin=False)
            }
            if sandbox.id not in accessible_ids:
                raise HTTPException(
                    status_code=403,
                    detail="只能将自己有权限访问的数字员工加入该项目",
                )
        attach_sandbox_to_team(
            db,
            team,
            sandbox,
            is_moderator=payload.is_moderator,
            actor=actor,
            docker=resolve_docker(),
        )
        return serialize_team(db, team, viewer_email=actor, is_admin=is_admin)
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/teams/{team_id}/sandboxes/{sandbox_id}")
def api_detach_team_sandbox(
    team_id: str,
    sandbox_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, is_admin = _require_team_manager(request, db, team_id)
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")
    try:
        detach_sandbox_from_team(
            db, team, sandbox_id, actor=actor, docker=resolve_docker()
        )
        return serialize_team(db, team, viewer_email=actor, is_admin=is_admin)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/teams/{team_id}/sync-group")
def api_sync_team_mesh_group(
    team_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Manually trigger live @metis/sandbox-mesh pairing & group room synchronization for a Project."""
    actor, is_admin = _require_team_manager(request, db, team_id)
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")
    res = sync_project_mesh_group(db, team, resolve_docker(), actor=actor)
    return {
        "sync": res,
        "team": serialize_team(db, team, viewer_email=actor, is_admin=is_admin),
    }


@router.post("/api/teams/{team_id}/shared-docs")
def api_sync_team_shared_doc(
    team_id: str,
    payload: TeamSharedDocSyncRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, _ = _require_team_manager(request, db, team_id)
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")
    sbx_ids = list(
        db.scalars(
            select(TeamSandbox.sandbox_id).where(TeamSandbox.team_id == team.id)
        ).all()
    )
    if not sbx_ids:
        raise HTTPException(status_code=400, detail="该团队暂未关联数字员工")
    sandboxes = list(
        db.scalars(
            select(Sandbox)
            .options(joinedload(Sandbox.user))
            .where(Sandbox.deleted_at.is_(None), Sandbox.id.in_(sbx_ids))
        ).all()
    )
    try:
        res = resolve_docker().sync_shared_project_file(
            sandboxes,
            team_name=team.name,
            file_name=payload.file_name,
            content=payload.content,
            project_slug=team.slug,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc
    audit(
        db,
        "team.shared_sync",
        target=team.name,
        actor=actor,
        detail=f"file={payload.file_name},synced={res.get('synced')}/{len(sandboxes)}",
    )
    db.commit()
    return res


@router.get("/api/workspace/templates", response_model=list[TemplateOut])
def api_workspace_template_catalog(
    request: Request,
    db: Session = Depends(get_db),
):
    """Read-only role template catalog for all authenticated users to request new digital employees."""
    if not _is_authenticated_admin(request, db):
        email = require_user_api(request)
        _ensure_active_user(db, email)
    return list_templates(db)


@router.get("/api/provision-requests")
def api_list_provision_requests(
    request: Request,
    db: Session = Depends(get_db),
):
    is_admin = _is_authenticated_admin(request, db)
    if is_admin:
        rows = list(
            db.scalars(
                select(ProvisionRequest).order_by(ProvisionRequest.created_at.desc())
            ).all()
        )
    else:
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
        stmt = select(ProvisionRequest)
        if lead_team_ids:
            from sqlalchemy import or_

            stmt = stmt.where(
                or_(
                    ProvisionRequest.requester_email == email,
                    ProvisionRequest.team_id.in_(lead_team_ids),
                )
            )
        else:
            stmt = stmt.where(ProvisionRequest.requester_email == email)
        rows = list(db.scalars(stmt.order_by(ProvisionRequest.created_at.desc())).all())
    return {"items": [serialize_provision_request(db, r) for r in rows]}


@router.post("/api/provision-requests", status_code=201)
def api_create_provision_request(
    payload: ProvisionRequestCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    if _is_authenticated_admin(request, db):
        email = session_email(request) or settings.manager_admin_email
    else:
        email = require_user_api(request)
        _ensure_active_user(db, email)
    try:
        req = create_provision_request(db, payload, requester_email=email)
        return serialize_provision_request(db, req)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/provision-requests/{request_id}/decide")
def api_decide_provision_request(
    request_id: str,
    payload: ProvisionRequestDecision,
    request: Request,
    db: Session = Depends(get_db),
):
    req = db.get(ProvisionRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="雇佣申请不存在")

    is_admin = _is_authenticated_admin(request, db)
    actor = session_email(request) or settings.manager_admin_email
    if not is_admin:
        actor = require_user_api(request)
        _ensure_active_user(db, actor)
        if not req.team_id or not is_team_lead_for_team(db, actor, req.team_id):
            raise HTTPException(
                status_code=403,
                detail="仅平台管理员或目标团队负责人 (Team Lead) 可审批该雇佣申请",
            )
    try:
        updated, sbx = decide_provision_request(
            db,
            settings,
            resolve_docker(),
            req,
            decision=payload.decision,
            note=payload.note,
            llm_profile_id=payload.llm_profile_id,
            actor=actor,
        )
        out = serialize_provision_request(db, updated)
        if sbx is not None:
            out["provisioned_slug"] = sbx.slug
        return out
    except Exception as exc:
        raise _manager_error(exc) from exc
