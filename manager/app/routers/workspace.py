"""Unified Workspace Frontstage aggregation routes: Global Inbox, Approvals, Deliverables Gallery, and Shared Intake."""

from __future__ import annotations

import re
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import (
    _ensure_active_user,
    _ensure_sandbox_awake,
    _is_authenticated_admin,
    _manager_error,
    _require_sandbox_owner_or_admin,
    require_user_api,
    resolve_docker,
    session_email,
    settings,
)
from ..models import Sandbox, SandboxRuntimeSnapshot, TeamSandbox
from ..services import audit, get_branding_config, load_sandbox
from ..services.notifications import NotificationEvent, dispatch_notification_event
from ..services.teams import list_accessible_sandboxes
from ..services.workspace_hub import (
    build_workspace_deliverables,
    build_workspace_inbox,
    refresh_sandbox_snapshot,
    refresh_sandboxes_snapshots,
)

router = APIRouter()

MAX_INTAKE_FILES = 5
MAX_INTAKE_FILE_BYTES = 10 * 1024 * 1024


def _list_visible_sandboxes(request: Request, db: Session) -> list[Sandbox]:
    is_admin = _is_authenticated_admin(request, db)
    if is_admin:
        return list_accessible_sandboxes(db, session_email(request), is_admin=True)
    email = require_user_api(request)
    _ensure_active_user(db, email)
    return list_accessible_sandboxes(db, email, is_admin=False)


def _ensure_missing_snapshots(db: Session, sandboxes: list[Sandbox]) -> None:
    if not sandboxes:
        return
    existing_ids = set(
        db.scalars(
            select(SandboxRuntimeSnapshot.sandbox_id).where(
                SandboxRuntimeSnapshot.sandbox_id.in_([s.id for s in sandboxes])
            )
        ).all()
    )
    missing = [s for s in sandboxes if s.status == "running" and s.id not in existing_ids]
    if missing:
        refresh_sandboxes_snapshots(
            db,
            resolve_docker(),
            missing,
            settings=settings,
            emit_notifications=False,
        )


@router.get("/api/workspace/inbox")
def api_workspace_inbox(
    request: Request,
    refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    is_admin = _is_authenticated_admin(request, db)
    actor = session_email(request)
    sandboxes = _list_visible_sandboxes(request, db)
    if refresh:
        refresh_sandboxes_snapshots(
            db,
            resolve_docker(),
            sandboxes,
            settings=settings,
            emit_notifications=True,
        )
    else:
        _ensure_missing_snapshots(db, sandboxes)
    return build_workspace_inbox(
        db,
        sandboxes,
        actor_email=actor,
        is_admin=is_admin,
    )


@router.get("/api/workspace/deliverables")
def api_workspace_deliverables(
    request: Request,
    refresh: bool = Query(default=False),
    team_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    sandboxes = _list_visible_sandboxes(request, db)
    if team_id:
        team_sbx_ids = set(
            db.scalars(
                select(TeamSandbox.sandbox_id).where(TeamSandbox.team_id == team_id)
            ).all()
        )
        sandboxes = [s for s in sandboxes if s.id in team_sbx_ids]
    if refresh:
        refresh_sandboxes_snapshots(
            db,
            resolve_docker(),
            sandboxes,
            settings=settings,
            emit_notifications=False,
        )
    else:
        _ensure_missing_snapshots(db, sandboxes)
    return build_workspace_deliverables(db, sandboxes)


@router.post("/api/workspace/refresh")
def api_workspace_refresh(
    request: Request,
    db: Session = Depends(get_db),
):
    sandboxes = _list_visible_sandboxes(request, db)
    snaps = refresh_sandboxes_snapshots(
        db,
        resolve_docker(),
        sandboxes,
        settings=settings,
        emit_notifications=True,
    )
    return {
        "ok": True,
        "refreshed": len(snaps),
        "total": len(sandboxes),
        "actor": session_email(request) or settings.manager_admin_email,
    }


@router.post("/api/workspace/sandboxes/{sandbox_id}/intake")
def api_workspace_shared_intake(
    sandbox_id: str,
    request: Request,
    title: str = Form(..., min_length=1, max_length=200),
    description: str = Form(""),
    priority: str = Form("normal"),
    approval_required: bool = Form(False),
    files: list[UploadFile] | None = File(default=None),
    db: Session = Depends(get_db),
):
    """Layered frontstage intake for personal or shared digital employees with isolated per-request attachments."""
    if priority not in {"low", "normal", "high", "urgent"}:
        raise HTTPException(status_code=400, detail="无效的任务优先级")

    sandbox = load_sandbox(db, sandbox_id)
    actor = _require_sandbox_owner_or_admin(
        sandbox,
        request,
        db,
        "无权向该数字员工提交任务单",
        allow_shared_member=True,
    )

    upload_list = [f for f in (files or []) if f and (f.filename or "").strip()]
    if len(upload_list) > MAX_INTAKE_FILES:
        raise HTTPException(
            status_code=400, detail=f"单次任务最多上传 {MAX_INTAKE_FILES} 个附件"
        )

    file_blobs: list[tuple[str, bytes]] = []
    for f in upload_list:
        raw = f.file.read(MAX_INTAKE_FILE_BYTES + 1)
        if len(raw) > MAX_INTAKE_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"附件 {f.filename} 超过 10 MB 上限",
            )
        file_blobs.append((f.filename or "attachment.bin", raw))

    docker = resolve_docker()
    try:
        if docker.status(sandbox) != "running":
            _ensure_sandbox_awake(db, sandbox)

        intake_id = f"intk_{secrets.token_hex(6)}"
        intake_dir = f"/home/workspace/shared-intake/{intake_id}"
        written_paths: list[str] = []
        if file_blobs and hasattr(docker, "write_intake_files"):
            written_paths = docker.write_intake_files(sandbox, intake_id, file_blobs)

        requester_slug = re.sub(r"[^a-z0-9]+", "-", (actor or "user").split("@")[0].lower()).strip("-") or "user"
        isolated_room = f"intake:{requester_slug}:{intake_id}"

        desc_parts = [description.strip()] if description.strip() else []
        desc_parts.append(f"提交人：{actor}")
        desc_parts.append(f"隔离工作目录：{intake_dir}/output")
        if written_paths:
            file_lines = "\n".join(f"- `{p}`" for p in written_paths)
            desc_parts.append(f"### 随单附件\n{file_lines}")
        final_desc = "\n\n".join(desc_parts)

        res = docker.dispatch_mesh_task(
            sandbox,
            title=title.strip(),
            description=final_desc,
            priority=priority,
            room_id=isolated_room,
            approval_required=bool(approval_required),
            source=f"intake:{requester_slug}",
            actor=actor,
        )
        audit(
            db,
            "sandbox.shared_intake",
            target=sandbox.id,
            actor=actor,
            detail=f"slug={sandbox.slug},intake_id={intake_id},files={len(written_paths)},title={title.strip()[:48]}",
        )
        db.commit()

        if approval_required:
            try:
                brand = get_branding_config(db)
                brand_name = str(
                    brand.get("brand_name_zh") or brand.get("brand_name_en") or "Metis"
                )
                task_id = str(res.get("task_id") or "")
                dispatch_notification_event(
                    db,
                    settings,
                    NotificationEvent(
                        event_type="approval.pending",
                        title=title.strip(),
                        summary=final_desc[:500],
                        severity="warning",
                        sandbox_id=sandbox.id,
                        sandbox_slug=sandbox.slug,
                        role_title=sandbox.role_title,
                        project_team_name=sandbox.project_team_name,
                        task_id=task_id or None,
                        dedupe_key=f"approval.pending:{isolated_room}:{task_id}" if task_id else None,
                    ),
                    brand_name=brand_name,
                )
            except Exception:
                pass

        try:
            refresh_sandbox_snapshot(db, docker, sandbox, settings=settings, emit_notifications=False)
        except Exception:
            pass

        return {
            "ok": True,
            "intake_id": intake_id,
            "intake_dir": intake_dir,
            "uploaded_files": written_paths,
            **res,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc
