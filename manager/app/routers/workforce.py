"""Digital employee runtime, tasks, approvals, webhooks, teams, apps/services/cron, and snapshots."""

from __future__ import annotations

import hmac
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..deps import (
    _ensure_active_user,
    _ensure_sandbox_awake,
    _is_authenticated_admin,
    _manager_error,
    _require_sandbox_owner_or_admin,
    require_admin_api,
    require_user_api,
    resolve_docker,
    session_email,
    settings,
)
from ..models import PlaybookRun, PlaybookStepRun, Sandbox, Team, TeamSandbox, ToolApprovalRequest
from ..schemas import (
    ApprovalDecisionRequest,
    CronJobCreateRequest,
    ExposeAppRequest,
    SharedProjectSyncRequest,
    SnapshotCreateRequest,
    SnapshotOut,
    TaskDispatchRequest,
    TaskStatusUpdateRequest,
    TeamAssembleRequest,
    ToolApprovalDecisionRequest,
    ToolPolicyRuleCreate,
    ToolPolicyRuleUpdate,
    UserServiceCreateRequest,
    WebhookEventPayload,
)
from ..security import derive_sandbox_gateway_secret
from ..services import (
    NotFoundError,
    audit,
    create_workspace_snapshot,
    delete_workspace_snapshot,
    get_branding_config,
    list_workspace_snapshots,
    load_sandbox,
    load_sandbox_by_slug,
    restore_workspace_snapshot,
)
from ..services.integrations import parse_native_git_webhook, verify_github_signature
from ..services.notifications import NotificationEvent, dispatch_notification_event
from ..services.playbooks import sync_playbook_run_progress
from ..services.teams import ensure_team_for_assembly, list_accessible_sandboxes
from ..services.tool_policy import (
    create_tool_policy_rule,
    decide_tool_approval,
    delete_tool_policy_rule,
    evaluate_tool_call,
    list_tool_approvals,
    list_tool_policy_rules,
    serialize_tool_approval_request,
    serialize_tool_policy_rule,
    update_tool_policy_rule,
)
from ..services.workspace_hub import (
    refresh_sandbox_snapshot,
    refresh_sandboxes_snapshots,
    upsert_sandbox_runtime_snapshot,
)

router = APIRouter()


def _safe_refresh_snapshot(
    db: Session,
    sandbox: Sandbox,
    *,
    emit_notifications: bool = False,
    include_team_peers: bool = False,
    room_id: str | None = None,
) -> None:
    try:
        if not include_team_peers:
            refresh_sandbox_snapshot(
                db,
                resolve_docker(),
                sandbox,
                settings=settings,
                emit_notifications=emit_notifications,
            )
            return

        peer_ids: set[str] = {sandbox.id}
        team_ids = set(
            db.scalars(
                select(TeamSandbox.team_id).where(TeamSandbox.sandbox_id == sandbox.id)
            ).all()
        )
        clean_room = (room_id or "").strip()
        if clean_room:
            team_ids.update(
                db.scalars(select(Team.id).where(Team.mesh_room_id == clean_room)).all()
            )
        if team_ids:
            peer_ids.update(
                db.scalars(
                    select(TeamSandbox.sandbox_id).where(TeamSandbox.team_id.in_(list(team_ids)))
                ).all()
            )
        targets = list(
            db.scalars(
                select(Sandbox).where(
                    Sandbox.id.in_(list(peer_ids)),
                    Sandbox.deleted_at.is_(None),
                )
            ).all()
        )
        if not targets:
            targets = [sandbox]
        refresh_sandboxes_snapshots(
            db,
            resolve_docker(),
            targets,
            settings=settings,
            emit_notifications=emit_notifications,
        )
    except Exception:
        pass


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
        _require_sandbox_owner_or_admin(
            sandbox, request, db, "无权查看他人的数字员工运行态", allow_shared_member=True
        )
        data = resolve_docker().inspect_workforce_runtime(sandbox)
        try:
            upsert_sandbox_runtime_snapshot(db, sandbox, data, settings=settings, emit_notifications=False)
        except Exception:
            pass
        return data
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
    ensure_team_for_assembly(
        db,
        team_name=effective_name,
        sandboxes=sandboxes,
        moderator_slug=result.get("moderator_slug"),
        mesh_room_id=result.get("room_id"),
        actor=actor,
    )
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
        actor = _require_sandbox_owner_or_admin(
            sandbox, request, db, "无权向他人的数字员工派发任务", allow_shared_member=True
        )
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
        if payload.approval_required:
            try:
                brand = get_branding_config(db)
                brand_name = str(brand.get("brand_name_zh") or brand.get("brand_name_en") or "Metis")
                task_id = str(res.get("task_id") or "")
                dispatch_notification_event(
                    db,
                    settings,
                    NotificationEvent(
                        event_type="approval.pending",
                        title=payload.title,
                        summary=payload.description[:500] or "新建的需审批任务等待确认。",
                        severity="warning",
                        sandbox_id=sandbox.id,
                        sandbox_slug=sandbox.slug,
                        role_title=sandbox.role_title,
                        project_team_name=sandbox.project_team_name,
                        task_id=task_id or None,
                        dedupe_key=f"approval.pending:{payload.room_id or 'local'}:{task_id}" if task_id else None,
                        metadata={"room_id": payload.room_id or ""},
                    ),
                    brand_name=brand_name,
                )
            except Exception:
                pass
        _safe_refresh_snapshot(db, sandbox, emit_notifications=False)
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
        actor = _require_sandbox_owner_or_admin(
            sandbox, request, db, "无权审批他人的数字员工任务", allow_shared_member=True
        )
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
        _safe_refresh_snapshot(
            db,
            sandbox,
            emit_notifications=False,
            include_team_peers=True,
            room_id=res.get("room_id") or payload.room_id,
        )
        return res
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.patch("/api/sandboxes/{sandbox_id}/tasks/{task_id}")
@router.patch("/api/my/sandboxes/{sandbox_id}/tasks/{task_id}")
def update_sandbox_task_endpoint(
    sandbox_id: str,
    task_id: str,
    payload: TaskStatusUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Update a tracked mesh task's status (e.g. resolve or dismiss a blocked task) and refresh peer snapshots."""
    try:
        sandbox = load_sandbox(db, sandbox_id)
        actor = _require_sandbox_owner_or_admin(
            sandbox, request, db, "无权更新他人的数字员工任务", allow_shared_member=True
        )
        res = resolve_docker().update_mesh_task_status(
            sandbox,
            task_id,
            status=payload.status,
            summary=payload.summary,
            room_id=payload.room_id,
            actor=actor or "User",
            notify_moderator=payload.notify_moderator,
        )
        if not res.get("ok"):
            detail = str(res.get("detail") or "更新任务状态失败")
            code = 404 if "not found" in detail.lower() else 400
            raise HTTPException(status_code=code, detail=detail)
        eff_room_id = res.get("room_id") or payload.room_id or ""
        audit(
            db,
            "sandbox.task_update",
            target=sandbox.id,
            actor=actor,
            detail=f"slug={sandbox.slug},task_id={task_id},status={payload.status},room_id={eff_room_id}",
        )
        db.commit()
        _safe_refresh_snapshot(
            db,
            sandbox,
            emit_notifications=False,
            include_team_peers=True,
            room_id=eff_room_id or None,
        )
        return res
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/webhooks/sandboxes/{slug}")
async def inbound_sandbox_webhook_endpoint(
    slug: str,
    request: Request,
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """External webhook trigger (native GitHub/GitLab or standard Metis JSON) to auto-wake and dispatch tasks."""
    try:
        sandbox = load_sandbox_by_slug(db, slug)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="数字员工不存在")

    raw_body = await request.body()
    expected = getattr(sandbox, "webhook_token", None) or ""
    provided = (
        token
        or request.headers.get("x-webhook-token")
        or request.headers.get("x-gitlab-token")
        or request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    )
    gh_sig_ok = verify_github_signature(
        expected, raw_body, request.headers.get("x-hub-signature-256")
    )
    token_ok = bool(expected and provided and hmac.compare_digest(expected, provided))
    if not (token_ok or gh_sig_ok):
        raise HTTPException(status_code=401, detail="无效的 Webhook Token 或签名")

    try:
        raw_json = json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except Exception:
        raise HTTPException(status_code=400, detail="Webhook 请求体不是合法的 JSON")
    if not isinstance(raw_json, dict):
        raise HTTPException(status_code=400, detail="Webhook 请求体必须是 JSON 对象")

    translated = parse_native_git_webhook(dict(request.headers), raw_json)
    if translated is not None:
        if translated.get("ignored"):
            return {
                "ok": True,
                "ignored": True,
                "slug": sandbox.slug,
                "source": translated.get("source"),
                "event": translated.get("event"),
                "reason": translated.get("reason", "ignored"),
            }
        payload = WebhookEventPayload.model_validate(translated)
    else:
        try:
            payload = WebhookEventPayload.model_validate(raw_json)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc

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
        _safe_refresh_snapshot(db, sandbox, emit_notifications=True)
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
        _safe_refresh_snapshot(db, sandbox, emit_notifications=False)
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
        _safe_refresh_snapshot(db, sandbox, emit_notifications=False)
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


def _authenticate_mesh_sandbox(request: Request, db: Session) -> Sandbox:
    slug = (request.headers.get("x-metis-sandbox-slug") or "").strip().lower()
    token = (
        request.headers.get("x-metis-gateway-auth")
        or request.headers.get("x-metis-sandbox-token")
        or ""
    ).strip()
    if not slug or not token:
        raise HTTPException(status_code=401, detail="Missing sandbox internal auth headers")
    sbx = db.scalar(
        select(Sandbox).where(Sandbox.slug == slug, Sandbox.deleted_at.is_(None))
    )
    if sbx is None:
        raise HTTPException(status_code=401, detail="Unknown sandbox")
    expected_secret = derive_sandbox_gateway_secret(sbx.id, sbx.slug)
    gw_key = (getattr(sbx, "gateway_api_key", None) or "").strip()
    valid = hmac.compare_digest(token, expected_secret) or (
        bool(gw_key) and hmac.compare_digest(token, gw_key)
    )
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid sandbox internal auth token")
    return sbx


@router.post("/api/internal/mesh/wake/{target_slug}", include_in_schema=False)
def api_internal_mesh_wake_peer(
    target_slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Wake a sleeping peer sandbox on behalf of an authenticated sandbox-mesh container."""
    caller = _authenticate_mesh_sandbox(request, db)
    try:
        target = load_sandbox_by_slug(db, target_slug.strip().lower())
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if target.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Target sandbox not found")

    was_sleeping = target.status != "running"
    try:
        awake = _ensure_sandbox_awake(db, target)
    except Exception as exc:
        raise _manager_error(exc) from exc
    if was_sleeping:
        audit(
            db,
            "mesh.wake_peer",
            target=awake.id,
            actor=f"sandbox:{caller.slug}",
            detail=f"from={caller.slug},target={awake.slug}",
        )
        db.commit()
    return {
        "ok": True,
        "slug": awake.slug,
        "status": awake.status,
        "woke": was_sleeping,
    }


@router.post("/api/internal/mesh/events", include_in_schema=False)
async def api_internal_mesh_event(
    request: Request,
    db: Session = Depends(get_db),
):
    """Receive instant task/turn events from sandbox-mesh to advance Playbooks without polling lag."""
    caller = _authenticate_mesh_sandbox(request, db)
    try:
        raw = await request.body()
        body = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}

    room_id = str(body.get("room_id") or body.get("roomId") or "").strip()
    task_id = str(body.get("task_id") or body.get("taskId") or "").strip()

    docker = resolve_docker()
    if hasattr(docker, "inspect_workforce_runtime"):
        _safe_refresh_snapshot(
            db,
            caller,
            emit_notifications=True,
            include_team_peers=False,
            room_id=room_id or None,
        )

    active_runs = list(
        db.scalars(
            select(PlaybookRun).where(
                PlaybookRun.status.in_(["running", "awaiting_approval"])
            )
        ).all()
    )
    matched_runs: list[PlaybookRun] = []
    for run in active_runs:
        steps = list(
            db.scalars(
                select(PlaybookStepRun).where(PlaybookStepRun.run_id == run.id)
            ).all()
        )
        if any(
            st.status in {"running", "awaiting_approval"}
            and (
                st.sandbox_id == caller.id
                or (room_id and st.room_id == room_id)
                or (task_id and st.task_id == task_id)
            )
            for st in steps
        ):
            matched_runs.append(run)

    advanced = 0
    for run in matched_runs:
        try:
            if sync_playbook_run_progress(db, settings, docker, run):
                advanced += 1
        except Exception:
            pass

    return {
        "ok": True,
        "synced_runs": len(matched_runs),
        "advanced": advanced,
    }


@router.post("/api/internal/mesh/tool-check", include_in_schema=False)
async def api_internal_mesh_tool_check(
    request: Request,
    db: Session = Depends(get_db),
):
    """Evaluate Tool-level HITL policies for an in-sandbox high-risk tool/command call."""
    caller = _authenticate_mesh_sandbox(request, db)
    try:
        raw = await request.body()
        body = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    tool_name = str(body.get("tool_name") or body.get("toolName") or "").strip()
    if not tool_name:
        raise HTTPException(status_code=400, detail="tool_name is required")
    args_summary = str(body.get("args_summary") or body.get("argsSummary") or body.get("command") or "")
    pb_run_id = str(body.get("playbook_run_id") or body.get("playbookRunId") or "").strip() or None
    pb_step_id = str(body.get("playbook_step_id") or body.get("playbookStepId") or "").strip() or None
    return evaluate_tool_call(
        db,
        settings,
        caller,
        tool_name=tool_name,
        args_summary=args_summary,
        playbook_run_id=pb_run_id,
        playbook_step_id=pb_step_id,
    )


@router.get("/api/internal/mesh/tool-check/{approval_id}", include_in_schema=False)
def api_internal_mesh_tool_check_status(
    approval_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    caller = _authenticate_mesh_sandbox(request, db)
    req = db.get(ToolApprovalRequest, approval_id)
    if req is None or req.sandbox_id != caller.id:
        raise HTTPException(status_code=404, detail="Tool approval request not found")
    return serialize_tool_approval_request(req)


@router.get("/api/tool-policies")
def api_list_tool_policies(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return {"items": [serialize_tool_policy_rule(r) for r in list_tool_policy_rules(db)]}


@router.post("/api/tool-policies", status_code=201)
def api_create_tool_policy(
    payload: ToolPolicyRuleCreate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    actor = session_email(request) or settings.manager_admin_email
    try:
        rule = create_tool_policy_rule(db, payload, actor=actor)
        return serialize_tool_policy_rule(rule)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.patch("/api/tool-policies/{rule_id}")
def api_update_tool_policy(
    rule_id: str,
    payload: ToolPolicyRuleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    actor = session_email(request) or settings.manager_admin_email
    try:
        rule = update_tool_policy_rule(db, rule_id, payload, actor=actor)
        return serialize_tool_policy_rule(rule)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/tool-policies/{rule_id}")
def api_delete_tool_policy(
    rule_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    actor = session_email(request) or settings.manager_admin_email
    try:
        delete_tool_policy_rule(db, rule_id, actor=actor)
        return {"ok": True}
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.get("/api/tool-approvals")
def api_list_tool_approvals(
    request: Request,
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    is_admin = _is_authenticated_admin(request, db)
    if is_admin:
        scoped_ids = None
    else:
        email = require_user_api(request)
        _ensure_active_user(db, email)
        scoped_ids = [s.id for s in list_accessible_sandboxes(db, email, False)]
    rows = list_tool_approvals(db, status=status, sandbox_ids=scoped_ids, limit=limit)
    return {"items": [serialize_tool_approval_request(r) for r in rows]}


@router.post("/api/tool-approvals/{approval_id}/decide")
def api_decide_tool_approval(
    approval_id: str,
    payload: ToolApprovalDecisionRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    is_admin = _is_authenticated_admin(request, db)
    if is_admin:
        actor = session_email(request) or settings.manager_admin_email
    else:
        actor = require_user_api(request)
        _ensure_active_user(db, actor)
    req = db.get(ToolApprovalRequest, approval_id)
    if req is None:
        raise HTTPException(status_code=404, detail="工具操作审批记录不存在")
    if not is_admin:
        accessible_ids = {s.id for s in list_accessible_sandboxes(db, actor, False)}
        if req.sandbox_id not in accessible_ids:
            raise HTTPException(status_code=403, detail="无权审批该沙箱的工具操作请求")
    try:
        updated = decide_tool_approval(
            db, approval_id, decision=payload.decision, note=payload.note, actor=actor
        )
        return serialize_tool_approval_request(updated)
    except Exception as exc:
        raise _manager_error(exc) from exc
