"""Digital employee runtime, tasks, approvals, webhooks, teams, apps/services/cron, and snapshots."""

from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..deps import (
    _ensure_sandbox_awake,
    _manager_error,
    _require_sandbox_owner_or_admin,
    require_admin_api,
    resolve_docker,
    session_email,
    settings,
)
from ..models import Sandbox
from ..schemas import (
    ApprovalDecisionRequest,
    CronJobCreateRequest,
    ExposeAppRequest,
    SharedProjectSyncRequest,
    SnapshotCreateRequest,
    SnapshotOut,
    TaskDispatchRequest,
    TeamAssembleRequest,
    UserServiceCreateRequest,
    WebhookEventPayload,
)
from ..services import (
    NotFoundError,
    audit,
    create_workspace_snapshot,
    delete_workspace_snapshot,
    list_workspace_snapshots,
    load_sandbox,
    load_sandbox_by_slug,
    restore_workspace_snapshot,
)

router = APIRouter()


@router.get("/api/sandboxes/{sandbox_id}/workforce")
@router.get("/api/my/sandboxes/{sandbox_id}/workforce")
def sandbox_workforce_runtime(
    sandbox_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Inspect exposed preview apps, background services, cron jobs, and mesh team status for a digital employee."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        _require_sandbox_owner_or_admin(sandbox, request, db, "无权查看他人的数字员工运行态")
        return resolve_docker().inspect_workforce_runtime(sandbox)
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/sandboxes/{sandbox_id}/services/{service_name}/{action}")
@router.post("/api/my/sandboxes/{sandbox_id}/services/{service_name}/{action}")
def sandbox_service_control(
    sandbox_id: str,
    service_name: str,
    action: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Start, stop, or restart a user-managed background service inside a digital employee."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权操作他人的数字员工服务")
        res = resolve_docker().control_user_service(sandbox, service_name, action)
        audit(
            db,
            f"sandbox.service_{action}",
            target=sandbox.id,
            actor=actor,
            detail=f"slug={sandbox.slug},service={service_name},ok={res.get('ok')}",
        )
        db.commit()
        return res
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/teams/assemble")
def assemble_team_endpoint(
    payload: TeamAssembleRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    """One-click assemble a multi-employee collaborative team and shared group room across sandboxes."""
    effective_name = (payload.team_name or payload.name or "").strip()
    if not effective_name:
        raise HTTPException(status_code=400, detail="项目组名称不能为空")
    target_ids = payload.sandbox_ids or payload.member_ids or []
    if len(target_ids) < 2:
        raise HTTPException(status_code=400, detail="至少需要选择 2 位数字员工才能组建项目组")
    sandboxes = list(
        db.scalars(
            select(Sandbox)
            .options(joinedload(Sandbox.user), joinedload(Sandbox.llm_profile))
            .where(Sandbox.id.in_(target_ids), Sandbox.deleted_at.is_(None))
            .order_by(Sandbox.created_at.asc())
        ).all()
    )
    if len(sandboxes) < 2:
        raise HTTPException(status_code=400, detail="至少需要选择 2 位数字员工才能组建项目组")
    effective_mod_slug = payload.moderator_slug
    if not effective_mod_slug and payload.moderator_id:
        mod_sbx = next((s for s in sandboxes if s.id == payload.moderator_id), None)
        if mod_sbx:
            effective_mod_slug = mod_sbx.slug
    try:
        result = resolve_docker().assemble_mesh_team(
            sandboxes,
            team_name=effective_name,
            moderator_slug=effective_mod_slug,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc

    for sbx in sandboxes:
        sbx.project_team_name = effective_name
    actor = session_email(request) or settings.manager_admin_email
    audit(
        db,
        "team.assemble",
        target=effective_name,
        actor=actor,
        detail=f"members={','.join(s.slug for s in sandboxes)},moderator={result.get('moderator_slug')},synced={result.get('synced')}",
    )
    db.commit()
    return result


@router.post("/api/teams/sync-shared")
def sync_team_shared_file_endpoint(
    payload: SharedProjectSyncRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    """Synchronize a shared project document (PRD / API spec) into /home/workspace/shared/<file_name> across selected digital employees."""
    sandboxes = list(
        db.scalars(
            select(Sandbox)
            .options(joinedload(Sandbox.user))
            .where(Sandbox.id.in_(payload.sandbox_ids), Sandbox.deleted_at.is_(None))
        ).all()
    )
    if not sandboxes:
        raise HTTPException(status_code=400, detail="请至少选择 1 位数字员工")
    try:
        res = resolve_docker().sync_shared_project_file(
            sandboxes,
            team_name=payload.team_name,
            file_name=payload.file_name,
            content=payload.content,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc
    actor = session_email(request) or settings.manager_admin_email
    audit(
        db,
        "team.shared_sync",
        target=payload.team_name,
        actor=actor,
        detail=f"file={payload.file_name},synced={res.get('synced')}/{len(sandboxes)}",
    )
    db.commit()
    return res


@router.post("/api/sandboxes/{sandbox_id}/tasks")
@router.post("/api/my/sandboxes/{sandbox_id}/tasks")
def dispatch_sandbox_task_endpoint(
    sandbox_id: str,
    payload: TaskDispatchRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Dispatch a new task directly from the control center or user portal into a digital employee's mesh task board."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权向他人的数字员工派发任务")
        res = resolve_docker().dispatch_mesh_task(
            sandbox,
            title=payload.title,
            description=payload.description,
            priority=payload.priority,
            room_id=payload.room_id,
            approval_required=payload.approval_required,
            source="portal",
            actor=actor or "User",
        )
        audit(
            db,
            "sandbox.task_dispatch",
            target=sandbox.id,
            actor=actor,
            detail=f"slug={sandbox.slug},title={payload.title[:48]}",
        )
        db.commit()
        return res
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/sandboxes/{sandbox_id}/approvals/{task_id}")
@router.post("/api/my/sandboxes/{sandbox_id}/approvals/{task_id}")
def decide_sandbox_approval_endpoint(
    sandbox_id: str,
    task_id: str,
    payload: ApprovalDecisionRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Approve or reject a pending human-approval task directly from the control center or user portal."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权审批他人的数字员工任务")
        res = resolve_docker().decide_mesh_approval(
            sandbox,
            task_id,
            decision=payload.decision,
            note=payload.note,
            room_id=payload.room_id,
            actor=actor or "User",
        )
        audit(
            db,
            f"sandbox.approval_{payload.decision}",
            target=sandbox.id,
            actor=actor,
            detail=f"slug={sandbox.slug},task_id={task_id}",
        )
        db.commit()
        return res
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/webhooks/sandboxes/{slug}")
def inbound_sandbox_webhook_endpoint(
    slug: str,
    payload: WebhookEventPayload,
    request: Request,
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """External webhook trigger (GitHub/GitLab/Feishu/WeCom/CI) to auto-wake a digital employee and dispatch an event task."""
    try:
        sandbox = load_sandbox_by_slug(db, slug)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="数字员工不存在")

    expected = getattr(sandbox, "webhook_token", None)
    provided = (
        token
        or request.headers.get("x-webhook-token")
        or request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    )
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        raise HTTPException(status_code=401, detail="无效的 Webhook Token")

    try:
        if payload.wake_if_sleeping and resolve_docker().status(sandbox) != "running":
            _ensure_sandbox_awake(db, sandbox)
        res = resolve_docker().dispatch_mesh_task(
            sandbox,
            title=payload.title,
            description=payload.description,
            priority=payload.priority,
            source=f"webhook:{payload.source}",
            actor=f"webhook:{payload.source}",
        )
        audit(
            db,
            "sandbox.webhook_trigger",
            target=sandbox.id,
            actor=f"webhook:{payload.source}",
            detail=f"slug={sandbox.slug},event={payload.event},title={payload.title[:48]}",
        )
        db.commit()
        return {"ok": True, "slug": sandbox.slug, "event": payload.event, **res}
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/sandboxes/{sandbox_id}/apps")
@router.post("/api/my/sandboxes/{sandbox_id}/apps")
def expose_sandbox_app_endpoint(
    sandbox_id: str,
    payload: ExposeAppRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Expose a local port inside a digital employee as a live web preview app via sandbox-expose."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权操作他人的数字员工预览应用")
        res = resolve_docker().expose_user_app(
            sandbox,
            name=payload.name,
            port=payload.port,
            prefix=payload.prefix,
        )
        audit(
            db,
            "sandbox.app_expose",
            target=sandbox.id,
            actor=actor,
            detail=f"slug={sandbox.slug},app={payload.name},port={payload.port}",
        )
        db.commit()
        return res
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/sandboxes/{sandbox_id}/apps/{app_name}")
@router.delete("/api/my/sandboxes/{sandbox_id}/apps/{app_name}")
def unexpose_sandbox_app_endpoint(
    sandbox_id: str,
    app_name: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Remove an exposed preview route from a digital employee."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权操作他人的数字员工预览应用")
        res = resolve_docker().unexpose_user_app(sandbox, app_name)
        audit(
            db,
            "sandbox.app_unexpose",
            target=sandbox.id,
            actor=actor,
            detail=f"slug={sandbox.slug},app={app_name}",
        )
        db.commit()
        return res
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/sandboxes/{sandbox_id}/services")
@router.post("/api/my/sandboxes/{sandbox_id}/services")
def add_sandbox_service_endpoint(
    sandbox_id: str,
    payload: UserServiceCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Add and start a new user-level background daemon inside a digital employee."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权操作他人的数字员工服务")
        res = resolve_docker().add_user_service(
            sandbox,
            name=payload.name,
            command=payload.command,
        )
        audit(
            db,
            "sandbox.service_add",
            target=sandbox.id,
            actor=actor,
            detail=f"slug={sandbox.slug},service={payload.name}",
        )
        db.commit()
        return res
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/sandboxes/{sandbox_id}/services/{service_name}")
@router.delete("/api/my/sandboxes/{sandbox_id}/services/{service_name}")
def remove_sandbox_service_endpoint(
    sandbox_id: str,
    service_name: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Remove a user-level background daemon from a digital employee."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权操作他人的数字员工服务")
        res = resolve_docker().remove_user_service(sandbox, service_name)
        audit(
            db,
            "sandbox.service_remove",
            target=sandbox.id,
            actor=actor,
            detail=f"slug={sandbox.slug},service={service_name}",
        )
        db.commit()
        return res
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.get("/api/sandboxes/{sandbox_id}/services/{service_name}/logs")
@router.get("/api/my/sandboxes/{sandbox_id}/services/{service_name}/logs")
def get_sandbox_service_logs_endpoint(
    sandbox_id: str,
    service_name: str,
    request: Request,
    tail: int = Query(default=120, ge=10, le=2000),
    db: Session = Depends(get_db),
):
    """Read logs for a user-level background daemon inside a digital employee."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        _require_sandbox_owner_or_admin(sandbox, request, db, "无权查看他人的数字员工服务日志")
        return {"logs": resolve_docker().user_service_logs(sandbox, service_name, tail=tail)}
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/sandboxes/{sandbox_id}/cron")
@router.post("/api/my/sandboxes/{sandbox_id}/cron")
def add_sandbox_cron_endpoint(
    sandbox_id: str,
    payload: CronJobCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Add a persistent crontab job inside a digital employee."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权操作他人的数字员工排班")
        res = resolve_docker().add_cron_job(
            sandbox,
            schedule=payload.schedule,
            command=payload.command,
        )
        audit(
            db,
            "sandbox.cron_add",
            target=sandbox.id,
            actor=actor,
            detail=f"slug={sandbox.slug},schedule={payload.schedule}",
        )
        db.commit()
        return res
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/sandboxes/{sandbox_id}/cron")
@router.delete("/api/my/sandboxes/{sandbox_id}/cron")
def remove_sandbox_cron_endpoint(
    sandbox_id: str,
    request: Request,
    raw: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """Remove a persistent crontab job from a digital employee."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权操作他人的数字员工排班")
        res = resolve_docker().remove_cron_job(sandbox, raw)
        audit(
            db,
            "sandbox.cron_remove",
            target=sandbox.id,
            actor=actor,
            detail=f"slug={sandbox.slug}",
        )
        db.commit()
        return res
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.get("/api/sandboxes/{sandbox_id}/snapshots", response_model=list[SnapshotOut])
@router.get("/api/my/sandboxes/{sandbox_id}/snapshots", response_model=list[SnapshotOut])
def api_list_snapshots(
    sandbox_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    sandbox = load_sandbox(db, sandbox_id)
    _require_sandbox_owner_or_admin(sandbox, request, db, "无权查看他人的工作区快照")
    return list_workspace_snapshots(db, sandbox.id)


@router.post("/api/sandboxes/{sandbox_id}/snapshots", response_model=SnapshotOut, status_code=201)
@router.post("/api/my/sandboxes/{sandbox_id}/snapshots", response_model=SnapshotOut, status_code=201)
def api_create_snapshot(
    sandbox_id: str,
    payload: SnapshotCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权创建他人的工作区快照")
        return create_workspace_snapshot(
            db,
            settings,
            resolve_docker(),
            sandbox,
            name=payload.name,
            note=payload.note,
            exclude_caches=payload.exclude_caches,
            actor=actor,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/sandboxes/{sandbox_id}/snapshots/{snapshot_id}/restore")
@router.post("/api/my/sandboxes/{sandbox_id}/snapshots/{snapshot_id}/restore")
def api_restore_snapshot(
    sandbox_id: str,
    snapshot_id: str,
    request: Request,
    mode: str = Query(default="merge", pattern=r"^(merge|clean)$"),
    db: Session = Depends(get_db),
):
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权回滚他人的工作区快照")
        return restore_workspace_snapshot(
            db,
            resolve_docker(),
            sandbox,
            snapshot_id,
            mode=mode,
            actor=actor,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/sandboxes/{sandbox_id}/snapshots/{snapshot_id}")
@router.delete("/api/my/sandboxes/{sandbox_id}/snapshots/{snapshot_id}")
def api_delete_snapshot(
    sandbox_id: str,
    snapshot_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权删除他人的工作区快照")
        delete_workspace_snapshot(db, sandbox, snapshot_id, actor=actor)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc
