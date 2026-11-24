"""Sandbox lifecycle, user portal (/api/my/*), backup/restore, direct open, and wake fallback routes."""

from __future__ import annotations

import json
import secrets
import tempfile
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..deps import (
    _ensure_active_user,
    _ensure_sandbox_awake,
    _is_authenticated_admin,
    _manager_error,
    _render_wake_html,
    _require_sandbox_owner_or_admin,
    require_admin_api,
    require_user_api,
    resolve_docker,
    sandbox_out,
    session_email,
    settings,
)
from ..docker_service import SandboxRuntimeError
from ..models import LlmProfile, Sandbox, User
from ..schemas import (
    SandboxCloneRequest,
    SandboxCreate,
    SandboxList,
    SandboxOut,
    SandboxPatch,
    UserPasswordChange,
)
from ..security import hash_password, verify_password
from ..services import (
    NotFoundError,
    audit,
    clone_sandbox,
    create_sandbox,
    delete_sandbox,
    get_allow_local_user_login,
    load_sandbox,
    load_sandbox_by_slug,
    refresh_status,
    refresh_statuses,
    restart_sandbox,
    start_sandbox,
    stop_sandbox,
    update_sandbox_limits,
    upgrade_sandbox,
    utcnow,
)
from ..services.llm_gateway import generate_sandbox_gateway_key
from ..services.teams import (
    can_user_open_sandbox_ide,
    get_sandbox_teams_map,
    list_accessible_sandboxes,
)
from ..services.vault import sync_bound_credentials
from .auth import verify_sandbox_access

router = APIRouter()


def _serialize_sandboxes(
    db: Session,
    sandboxes: list[Sandbox],
    *,
    viewer_email: str | None,
    is_admin: bool,
) -> list[SandboxOut]:
    tmap = get_sandbox_teams_map(db, [s.id for s in sandboxes])
    out: list[SandboxOut] = []
    for s in sandboxes:
        pairs = tmap.get(s.id, [])
        out.append(
            sandbox_out(
                s,
                team_ids=[p[0] for p in pairs],
                team_names=[p[1] for p in pairs],
                can_open_ide=can_user_open_sandbox_ide(db, s, viewer_email, is_admin),
            )
        )
    return out


@router.get("/sandboxes/{sandbox_id}/open", include_in_schema=False)
def open_sandbox_with_token(
    sandbox_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    sandbox = load_sandbox(db, sandbox_id)
    auth_resp = verify_sandbox_access(sandbox.slug, request, db)
    if auth_resp.status_code != 200:
        return auth_resp
    if resolve_docker().status(sandbox) != "running":
        return HTMLResponse(
            _render_wake_html(sandbox.slug, f"/sandboxes/{sandbox.id}/open")
        )
    base = settings.sandbox_url(sandbox.slug).rstrip("/")
    raw_launch = resolve_docker().launch_token_url(sandbox)
    if raw_launch:
        parsed = urlsplit(raw_launch)
        if parsed.query:
            return RedirectResponse(f"{base}/dsh/?{parsed.query}", status_code=302)
    return RedirectResponse(f"{base}/", status_code=302)


@router.post("/api/wake/{slug}")
def wake_sandbox_endpoint(
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    sandbox = load_sandbox_by_slug(db, slug)
    auth_resp = verify_sandbox_access(sandbox.slug, request, db)
    if auth_resp.status_code != 200:
        raise HTTPException(
            status_code=auth_resp.status_code,
            detail="无权唤醒此工作区",
        )
    try:
        awake = _ensure_sandbox_awake(db, sandbox)
    except Exception as exc:
        raise _manager_error(exc) from exc
    return {"ok": True, "ready": True, "status": awake.status}



@router.get("/api/sandboxes/{sandbox_id}/backup")
@router.get("/sandboxes/{sandbox_id}/backup", include_in_schema=False)
def backup_sandbox_workspace(
    sandbox_id: str,
    request: Request,
    exclude_caches: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    sandbox = load_sandbox(db, sandbox_id)
    _require_sandbox_owner_or_admin(sandbox, request, db, "无权备份他人的工作区")
    try:
        stream = resolve_docker().export_workspace_tar(
            sandbox, exclude_caches=exclude_caches
        )
    except Exception as exc:
        raise _manager_error(exc) from exc
    suffix = "lite" if exclude_caches else "home"
    filename = f"{sandbox.slug}-{suffix}.tar"
    return StreamingResponse(
        stream,
        media_type="application/x-tar",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/api/sandboxes/{sandbox_id}/restore")
@router.post("/api/my/sandboxes/{sandbox_id}/restore")
def restore_sandbox_workspace(
    sandbox_id: str,
    request: Request,
    file: UploadFile = File(...),
    mode: str = Form("merge"),
    db: Session = Depends(get_db),
):
    sandbox = load_sandbox(db, sandbox_id)
    actor = _require_sandbox_owner_or_admin(sandbox, request, db, "无权恢复他人的工作区")
    if mode not in {"merge", "clean"}:
        raise HTTPException(status_code=400, detail="恢复模式仅支持 merge 或 clean")

    raw_name = (file.filename or "").lower()
    if raw_name and not raw_name.endswith((".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tar.xz")):
        raise HTTPException(status_code=400, detail="仅支持上传 .tar / .tar.gz / .tgz 备份归档")

    max_bytes = settings.restore_max_bytes
    total_bytes = 0
    tmp = tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024)
    try:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"备份文件过大，最大允许 {round(max_bytes / (1024 * 1024))} MB",
                )
            tmp.write(chunk)
        tmp.seek(0)
        try:
            result = resolve_docker().restore_workspace_tar(sandbox, tmp, mode=mode)
        except Exception as exc:
            raise _manager_error(exc) from exc
    finally:
        tmp.close()

    audit(
        db,
        "sandbox.restore",
        target=sandbox.id,
        actor=actor,
        detail=f"slug={sandbox.slug},mode={mode},entries={result.get('restored_entries')}",
    )
    db.commit()
    return {"ok": True, **result}


# ---------------------------------------------------------------------------
# User Portal API (/api/my/*) — Read / Start / Stop / Backup only (No Create!)
# ---------------------------------------------------------------------------


@router.get("/api/my/sandboxes", response_model=SandboxList)
def api_my_sandboxes(
    request: Request,
    email: str | None = Query(default=None),
    refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    sess_email = session_email(request)
    is_admin = _is_authenticated_admin(request, db)
    if not sess_email and not is_admin:
        return SandboxList(items=[])
    if is_admin and email:
        target_email = email.strip().lower()
        sandboxes = list(
            db.scalars(
                select(Sandbox)
                .join(Sandbox.user)
                .options(joinedload(Sandbox.user), joinedload(Sandbox.llm_profile))
                .where(Sandbox.deleted_at.is_(None), User.email == target_email)
                .order_by(Sandbox.created_at)
            ).all()
        )
    elif is_admin:
        sandboxes = list_accessible_sandboxes(db, sess_email, is_admin=True)
    else:
        _ensure_active_user(db, sess_email)
        sandboxes = list_accessible_sandboxes(db, sess_email, is_admin=False)
    if refresh:
        refresh_statuses(db, resolve_docker(), sandboxes)
    return SandboxList(
        items=_serialize_sandboxes(
            db, sandboxes, viewer_email=sess_email, is_admin=is_admin
        )
    )


@router.post("/api/my/password")
def api_change_my_password(
    payload: UserPasswordChange,
    request: Request,
    db: Session = Depends(get_db),
):
    if not get_allow_local_user_login(db, settings):
        raise HTTPException(
            status_code=400,
            detail="当前已禁用本地密码登录，请前往统一身份认证平台修改密码",
        )
    email = require_user_api(request)
    user = _ensure_active_user(db, email)
    if not user:
        raise HTTPException(
            status_code=404,
            detail="当前账号仅使用平台管理员配置，无独立用户密码记录",
        )
    if user.password_hash:
        if not payload.current_password or not verify_password(
            payload.current_password, user.password_hash
        ):
            raise HTTPException(status_code=401, detail="当前密码错误")
    user.password_hash = hash_password(payload.new_password)
    audit(db, "user.password_change", target=user.email, actor=email)
    db.commit()
    return {"ok": True}


@router.post("/api/my/sandboxes/{sandbox_id}/start", response_model=SandboxOut)
@router.post("/api/my/sandboxes/{sandbox_id}/stop", response_model=SandboxOut)
@router.post("/api/my/sandboxes/{sandbox_id}/restart", response_model=SandboxOut)
def api_my_sandbox_action(
    sandbox_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    action = request.url.path.rstrip("/").rsplit("/", 1)[-1]
    email = require_user_api(request)
    sandbox = load_sandbox(db, sandbox_id)
    if not _is_authenticated_admin(request, db):
        if sandbox.user.email.lower() != email:
            raise HTTPException(status_code=403, detail="无权操作他人的工作区")
        if sandbox.user.status != "active":
            raise HTTPException(status_code=403, detail="该账号已被管理员禁用")
    handlers = {
        "start": lambda: start_sandbox(db, resolve_docker(), sandbox_id),
        "stop": lambda: stop_sandbox(db, resolve_docker(), sandbox_id),
        "restart": lambda: restart_sandbox(db, resolve_docker(), sandbox_id),
    }
    if action not in handlers:
        raise HTTPException(status_code=404, detail="未知操作")
    try:
        updated = handlers[action]()
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(updated)


@router.post("/api/sandboxes", response_model=SandboxOut, status_code=201)
def create_sandbox_endpoint(
    payload: SandboxCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = create_sandbox(
            db,
            settings,
            resolve_docker(),
            email=str(payload.email),
            slug=payload.slug,
            display_name=payload.display_name,
            image_repo=payload.image_repo,
            image_tag=payload.image_tag,
            cpu_limit=payload.cpu_limit,
            memory_limit=payload.memory_limit,
            llm_profile_id=payload.llm_profile_id,
            template=payload.template,
            init_repo_url=payload.init_repo_url,
            init_script=payload.init_script,
            auto_install_plugins=payload.auto_install_plugins,
            initial_password=payload.initial_password,
            auto_sleep_exempt=payload.auto_sleep_exempt,
            role_title=payload.role_title,
            role_description=payload.role_description,
            role_sop=payload.role_sop,
            preview_auth_mode=payload.preview_auth_mode,
            ownership_mode=payload.ownership_mode,
            maintainer_emails=payload.maintainer_emails,
            team_ids=payload.team_ids,
            daily_token_limit=payload.daily_token_limit,
            budget_action=payload.budget_action,
            credential_profile_ids=payload.credential_profile_ids,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc
    return _serialize_sandboxes(db, [sandbox], viewer_email=None, is_admin=True)[0]


@router.get("/api/sandboxes", response_model=SandboxList)
def list_sandboxes(
    include_deleted: bool = False,
    refresh: bool = False,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    query = select(Sandbox).options(
        joinedload(Sandbox.user), joinedload(Sandbox.llm_profile)
    )
    if not include_deleted:
        query = query.where(Sandbox.deleted_at.is_(None))
    sandboxes = list(db.scalars(query.order_by(Sandbox.created_at)).all())
    if refresh:
        refresh_statuses(db, resolve_docker(), sandboxes)
    return SandboxList(
        items=_serialize_sandboxes(db, sandboxes, viewer_email=None, is_admin=True)
    )


@router.get("/api/sandboxes/{sandbox_id}", response_model=SandboxOut)
def get_sandbox(
    sandbox_id: str,
    refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = load_sandbox(db, sandbox_id)
    except NotFoundError as exc:
        raise _manager_error(exc) from exc
    if refresh:
        refresh_status(db, resolve_docker(), sandbox)
    return sandbox_out(sandbox)


@router.post("/api/sandboxes/{sandbox_id}/start", response_model=SandboxOut)
def start_sandbox_endpoint(
    sandbox_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = start_sandbox(db, resolve_docker(), sandbox_id)
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@router.post("/api/sandboxes/{sandbox_id}/stop", response_model=SandboxOut)
def stop_sandbox_endpoint(
    sandbox_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = stop_sandbox(db, resolve_docker(), sandbox_id)
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@router.post("/api/sandboxes/{sandbox_id}/restart", response_model=SandboxOut)
def restart_sandbox_endpoint(
    sandbox_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = restart_sandbox(db, resolve_docker(), sandbox_id)
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@router.post("/api/sandboxes/{sandbox_id}/recreate", response_model=SandboxOut)
def recreate_sandbox_endpoint(
    sandbox_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = load_sandbox(db, sandbox_id)
        docker = resolve_docker()
        docker.recreate(sandbox)
        sandbox.status = "running"
        sandbox.last_seen_at = sandbox.updated_at
        if sandbox.credential_profile_ids and hasattr(docker, "sync_credential_profile"):
            try:
                sync_bound_credentials(db, docker, sandbox)
            except Exception:
                pass
        audit(db, "sandbox.recreate", target=sandbox.id, detail=f"slug={sandbox.slug}")
        db.commit()
        db.refresh(sandbox)
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@router.patch("/api/sandboxes/{sandbox_id}", response_model=SandboxOut)
def patch_sandbox(
    sandbox_id: str,
    payload: SandboxPatch,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    if (
        payload.display_name is None
        and payload.image_repo is None
        and payload.image_tag is None
        and payload.llm_profile_id is None
        and payload.credential_profile_ids is None
        and payload.cpu_limit is None
        and payload.memory_limit is None
        and payload.auto_sleep_exempt is None
        and payload.role_title is None
        and payload.role_description is None
        and payload.role_sop is None
        and payload.preview_auth_mode is None
        and payload.ownership_mode is None
        and payload.maintainer_emails is None
        and payload.daily_token_limit is None
        and payload.budget_action is None
        and not payload.rotate_webhook_token
        and not payload.rotate_gateway_key
    ):
        raise HTTPException(status_code=400, detail="nothing to update")
    try:
        sandbox = load_sandbox(db, sandbox_id)
        need_recreate = False
        role_updated = False
        creds_updated = False
        gateway_key_rotated = False
        if payload.display_name is not None:
            sandbox.display_name = payload.display_name.strip() or None
            role_updated = True
            audit(
                db,
                "sandbox.display_name_update",
                target=sandbox.id,
                detail=f"slug={sandbox.slug},display_name={sandbox.display_name or ''}",
            )
            db.commit()
        if payload.ownership_mode is not None:
            sandbox.ownership_mode = payload.ownership_mode
            audit(
                db,
                "sandbox.ownership_update",
                target=sandbox.id,
                detail=f"slug={sandbox.slug},mode={payload.ownership_mode}",
            )
            db.commit()
        if payload.maintainer_emails is not None:
            clean_maint = list(
                dict.fromkeys(
                    str(e).strip().lower() for e in payload.maintainer_emails if str(e).strip()
                )
            )
            sandbox.maintainer_emails_json = json.dumps(clean_maint)
            audit(
                db,
                "sandbox.maintainers_update",
                target=sandbox.id,
                detail=f"slug={sandbox.slug},count={len(clean_maint)}",
            )
            db.commit()
        if payload.budget_action is not None:
            sandbox.budget_action = payload.budget_action
            audit(
                db,
                "sandbox.budget_action",
                target=sandbox.id,
                detail=f"slug={sandbox.slug},action={payload.budget_action}",
            )
            db.commit()
        if payload.rotate_gateway_key or not getattr(sandbox, "gateway_api_key", None):
            if payload.rotate_gateway_key or not getattr(sandbox, "gateway_api_key", None):
                sandbox.gateway_api_key = generate_sandbox_gateway_key()
                gateway_key_rotated = True
                if payload.rotate_gateway_key:
                    audit(
                        db,
                        "sandbox.gateway_key_rotate",
                        target=sandbox.id,
                        detail=f"slug={sandbox.slug}",
                    )
                db.commit()
        if payload.credential_profile_ids is not None:
            clean_cids = list(
                dict.fromkeys(str(x).strip() for x in payload.credential_profile_ids if str(x).strip())
            )
            sandbox.credential_profile_ids_json = json.dumps(clean_cids)
            creds_updated = True
            audit(
                db,
                "sandbox.credential_bind",
                target=sandbox.id,
                detail=f"slug={sandbox.slug},profiles={len(clean_cids)}",
            )
            db.commit()
        if payload.preview_auth_mode is not None:
            sandbox.preview_auth_mode = payload.preview_auth_mode
            audit(
                db,
                "sandbox.preview_auth",
                target=sandbox.id,
                detail=f"slug={sandbox.slug},mode={payload.preview_auth_mode}",
            )
            db.commit()
        if payload.daily_token_limit is not None:
            sandbox.daily_token_limit = (
                payload.daily_token_limit if payload.daily_token_limit > 0 else None
            )
            audit(
                db,
                "sandbox.token_budget",
                target=sandbox.id,
                detail=f"slug={sandbox.slug},daily_limit={sandbox.daily_token_limit}",
            )
            db.commit()
        if payload.rotate_webhook_token or not getattr(sandbox, "webhook_token", None):
            if payload.rotate_webhook_token:
                sandbox.webhook_token = secrets.token_hex(16)
                audit(
                    db,
                    "sandbox.webhook_rotate",
                    target=sandbox.id,
                    detail=f"slug={sandbox.slug}",
                )
                db.commit()
        if payload.role_title is not None:
            sandbox.role_title = payload.role_title.strip() or None
            role_updated = True
        if payload.role_description is not None:
            sandbox.role_description = payload.role_description.strip() or None
            role_updated = True
        if payload.role_sop is not None:
            sandbox.role_sop = payload.role_sop.strip() or None
            role_updated = True
        if role_updated:
            audit(
                db,
                "sandbox.role_update",
                target=sandbox.id,
                detail=f"slug={sandbox.slug},role={sandbox.role_title}",
            )
            db.commit()
        if (
            payload.auto_sleep_exempt is not None
            and payload.auto_sleep_exempt != sandbox.auto_sleep_exempt
        ):
            sandbox.auto_sleep_exempt = payload.auto_sleep_exempt
            audit(
                db,
                "sandbox.sleep_policy",
                target=sandbox.id,
                detail=f"slug={sandbox.slug},auto_sleep_exempt={payload.auto_sleep_exempt}",
            )
            db.commit()
        llm_to_sync: LlmProfile | None = None
        if payload.llm_profile_id is not None:
            if payload.llm_profile_id == "":
                sandbox.llm_profile_id = None
            else:
                prof = db.get(LlmProfile, payload.llm_profile_id)
                if not prof:
                    raise HTTPException(status_code=404, detail="llm profile not found")
                sandbox.llm_profile_id = prof.id
                llm_to_sync = prof
            db.commit()
        if payload.image_repo is not None and payload.image_repo != sandbox.image_repo:
            sandbox.image_repo = payload.image_repo.strip()
            db.commit()
            need_recreate = True
        if payload.cpu_limit is not None or payload.memory_limit is not None:
            sandbox = update_sandbox_limits(
                db,
                resolve_docker(),
                sandbox_id,
                payload.cpu_limit
                if payload.cpu_limit is not None
                else sandbox.cpu_limit,
                payload.memory_limit
                if payload.memory_limit is not None
                else sandbox.memory_limit,
            )
        if payload.image_tag is not None and payload.image_tag != sandbox.image_tag:
            sandbox = upgrade_sandbox(
                db, resolve_docker(), sandbox_id, payload.image_tag
            )
            need_recreate = False
        if need_recreate:
            resolve_docker().recreate(sandbox)
            sandbox.status = "running"
            db.commit()
            db.refresh(sandbox)
        if role_updated and hasattr(resolve_docker(), "sync_role_profile"):
            try:
                resolve_docker().sync_role_profile(sandbox)
            except Exception:
                pass
        if (creds_updated or need_recreate) and sandbox.credential_profile_ids and hasattr(
            resolve_docker(), "sync_credential_profile"
        ):
            try:
                sync_bound_credentials(db, resolve_docker(), sandbox)
            except Exception:
                pass
        if llm_to_sync is None and gateway_key_rotated and sandbox.llm_profile and getattr(
            sandbox.llm_profile, "gateway_enabled", False
        ):
            llm_to_sync = sandbox.llm_profile
        if llm_to_sync is not None:
            # Hot-push updated LLM profile directly into the sandbox's cordis.patch.yml + .credentials.yaml
            # without destroying the container (and after recreate if the image also changed).
            sync_res = resolve_docker().sync_llm_profile(
                sandbox, llm_to_sync, set_as_default=True
            )
            if not sync_res.get("ok") and not sync_res.get("skipped"):
                raise SandboxRuntimeError(
                    f"LLM 配置下发失败: {sync_res.get('detail') or 'unknown error'}"
                )
            audit(
                db,
                "sandbox.llm_sync",
                target=sandbox.id,
                detail=f"slug={sandbox.slug},profile={llm_to_sync.name},synced={sync_res.get('ok')}",
            )
            db.commit()
            db.refresh(sandbox)
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@router.delete("/api/sandboxes/{sandbox_id}", response_model=SandboxOut)
def delete_sandbox_endpoint(
    sandbox_id: str,
    purge_volume: bool = False,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = delete_sandbox(db, resolve_docker(), sandbox_id, purge_volume)
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@router.get("/api/sandboxes/{sandbox_id}/logs")
@router.get("/api/my/sandboxes/{sandbox_id}/logs")
def sandbox_logs(
    sandbox_id: str,
    request: Request,
    tail: int = Query(default=300, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    try:
        sandbox = load_sandbox(db, sandbox_id, include_deleted=True)
        _require_sandbox_owner_or_admin(sandbox, request, db, "无权查看他人的工作区日志")
        return {"logs": resolve_docker().logs(sandbox, tail=tail)}
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.get("/api/sandboxes/{sandbox_id}/stats")
@router.get("/api/my/sandboxes/{sandbox_id}/stats")
def sandbox_stats(
    sandbox_id: str,
    request: Request,
    include_disk: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    try:
        sandbox = load_sandbox(db, sandbox_id)
        _require_sandbox_owner_or_admin(sandbox, request, db, "无权查看他人的工作区状态")
        runtime = resolve_docker()
        try:
            data = runtime.stats(sandbox, include_disk=include_disk)
        except TypeError:
            data = runtime.stats(sandbox)
        if data.get("disk_usage_mb") is not None:
            sandbox.disk_usage_mb = float(data["disk_usage_mb"])
            sandbox.disk_updated_at = utcnow()
            db.commit()
        elif not include_disk and sandbox.disk_usage_mb is not None:
            data = {**data, "disk_usage_mb": float(sandbox.disk_usage_mb)}
        return data
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/sandboxes/{sandbox_id}/clone", response_model=SandboxOut, status_code=201)
def clone_sandbox_endpoint(
    sandbox_id: str,
    payload: SandboxCloneRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    """Clone an existing digital employee's workspace, role persona, and model binding."""
    try:
        src = load_sandbox(db, sandbox_id)
        target_email = str(payload.email) if payload.email else src.user.email
        cloned = clone_sandbox(
            db,
            settings,
            resolve_docker(),
            sandbox_id,
            email=target_email,
            slug=payload.slug,
            display_name=payload.display_name,
            role_title=payload.role_title,
            exclude_caches=payload.exclude_caches,
            actor=session_email(request) or settings.manager_admin_email,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(cloned)


def _handle_sleeping_sandbox_fallback(
    slug: str,
    request: Request,
    db: Session,
) -> Response:
    """Traefik falls through here when a sandbox container is stopped or waking."""
    auth_resp = verify_sandbox_access(slug, request, db)
    if auth_resp.status_code != 200:
        return auth_resp

    accept = (request.headers.get("accept") or "").lower()
    is_html_nav = request.method == "GET" and (
        "text/html" in accept or "*/*" in accept or accept == ""
    )
    target_url = str(request.url.path) + (
        f"?{request.url.query}" if request.url.query else ""
    )
    if is_html_nav:
        return HTMLResponse(_render_wake_html(slug, target_url))
    return JSONResponse(
        {
            "detail": "工作区当前处于休眠状态，请打开工作区页面自动唤醒",
            "sleeping": True,
            "slug": slug,
        },
        status_code=503,
    )


@router.api_route(
    "/s/{slug}",
    methods=["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    include_in_schema=False,
)
@router.api_route(
    "/s/{slug}/{rest:path}",
    methods=["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    include_in_schema=False,
)
def sleeping_sandbox_fallback(
    slug: str,
    request: Request,
    rest: str = "",
    db: Session = Depends(get_db),
):
    _ = rest
    return _handle_sleeping_sandbox_fallback(slug, request, db)
