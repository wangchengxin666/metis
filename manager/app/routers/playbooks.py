"""Declarative Playbooks CRUD, YAML/JSON import-export, and multi-stage run orchestration routes."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

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
from ..models import Playbook, PlaybookRun, PlaybookStepRun, TeamMember
from ..schemas import (
    PlaybookCreate,
    PlaybookDraftRequest,
    PlaybookImportPayload,
    PlaybookRunCancelRequest,
    PlaybookStepDecisionRequest,
    PlaybookStepRetryRequest,
    PlaybookStepSkipRequest,
    PlaybookUpdate,
)
from ..services.playbooks import (
    cancel_playbook_run,
    create_playbook,
    decide_playbook_step,
    delete_playbook,
    export_playbook_declarative,
    generate_playbook_draft_with_llm,
    import_playbook_declarative,
    list_playbooks,
    retry_playbook_step,
    serialize_playbook,
    serialize_playbook_run,
    skip_playbook_step,
    start_playbook_run,
    sync_playbook_run_progress,
    update_playbook,
)
from ..services.teams import get_user_teams_summary, list_accessible_sandboxes

router = APIRouter()

_MAX_PB_FILES = 5
_MAX_PB_FILE_BYTES = 10 * 1024 * 1024


def _resolve_actor(request: Request, db: Session) -> tuple[str, bool]:
    is_admin = _is_authenticated_admin(request, db)
    if is_admin:
        return session_email(request) or settings.manager_admin_email, True
    email = require_user_api(request)
    _ensure_active_user(db, email)
    return email, False


def _require_playbook_author(request: Request, db: Session) -> tuple[str, bool]:
    """Allow both Platform Admins and Team Leads to create/manage custom Playbooks."""
    actor, is_admin = _resolve_actor(request, db)
    if is_admin:
        return actor, True
    is_lead, _lead_ids, _teams = get_user_teams_summary(db, actor)
    if is_lead:
        return actor, False
    raise HTTPException(status_code=403, detail="仅平台管理员或项目负责人可创建和管理 Playbook 模板")


def _require_playbook_manage(pb: Playbook, actor: str, is_admin: bool) -> None:
    if is_admin:
        return
    if pb.is_builtin or (pb.created_by or "").strip().lower() != actor.strip().lower():
        raise HTTPException(status_code=403, detail="仅可修改或删除自己创建的自定义 Playbook")


@router.get("/api/playbooks")
def api_list_playbooks(
    request: Request,
    include_disabled: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    actor, is_admin = _resolve_actor(request, db)
    can_author = is_admin or get_user_teams_summary(db, actor)[0]
    items = list_playbooks(db, enabled_only=not (include_disabled and can_author))
    return {"items": [serialize_playbook(pb) for pb in items]}


@router.post("/api/playbooks/ai-draft")
def api_ai_draft_playbook(
    payload: PlaybookDraftRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Generate a structured, editable Playbook draft from a plain-language goal via the configured LLM."""
    _require_playbook_author(request, db)
    try:
        return generate_playbook_draft_with_llm(
            db,
            goal=payload.goal,
            category=payload.category,
            stage_count=payload.stage_count,
            llm_profile_id=payload.llm_profile_id,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/playbooks", status_code=201)
def api_create_playbook(
    payload: PlaybookCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, _is_admin = _require_playbook_author(request, db)
    try:
        pb = create_playbook(db, payload, actor=actor)
        return serialize_playbook(pb)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.patch("/api/playbooks/{playbook_id}")
def api_update_playbook(
    playbook_id: str,
    payload: PlaybookUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, is_admin = _require_playbook_author(request, db)
    pb = db.get(Playbook, playbook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook 不存在")
    _require_playbook_manage(pb, actor, is_admin)
    try:
        updated = update_playbook(db, pb, payload, actor=actor)
        return serialize_playbook(updated)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/playbooks/{playbook_id}")
def api_delete_playbook(
    playbook_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, is_admin = _require_playbook_author(request, db)
    pb = db.get(Playbook, playbook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook 不存在")
    _require_playbook_manage(pb, actor, is_admin)
    try:
        delete_playbook(db, pb, actor=actor)
        return {"ok": True}
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.get("/api/playbooks/{playbook_id}/export")
def api_export_playbook(
    playbook_id: str,
    request: Request,
    format: str = Query(default="yaml", pattern="^(yaml|json)$"),
    db: Session = Depends(get_db),
):
    _resolve_actor(request, db)
    pb = db.get(Playbook, playbook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook 不存在")
    body, media_type = export_playbook_declarative(pb, fmt=format)
    ext = "yaml" if format == "yaml" else "json"
    return PlainTextResponse(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{pb.key}.playbook.{ext}"'},
    )


@router.post("/api/playbooks/import", status_code=201)
def api_import_playbook(
    payload: PlaybookImportPayload,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, is_admin = _require_playbook_author(request, db)
    try:
        if payload.overwrite and not is_admin:
            # Ensure team leads cannot overwrite built-in or other authors' Playbooks via import
            import yaml as _yaml  # type: ignore

            try:
                doc = json.loads(payload.content)
            except Exception:
                doc = _yaml.safe_load(payload.content)
            if isinstance(doc, dict) and doc.get("key"):
                existing = db.scalar(
                    select(Playbook).where(Playbook.key == str(doc["key"]).strip().lower())
                )
                if existing is not None:
                    _require_playbook_manage(existing, actor, is_admin)
        pb = import_playbook_declarative(
            db, payload.content, overwrite=payload.overwrite, actor=actor
        )
        return serialize_playbook(pb)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/playbooks/{playbook_id}/runs", status_code=201)
async def api_start_playbook_run(
    playbook_id: str,
    request: Request,
    title: str = Form(""),
    team_id: str = Form(""),
    execution_mode: str = Form("isolated"),
    inputs_json: str = Form("{}"),
    role_assignments_json: str = Form("{}"),
    files: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    """Launch a Playbook run with structured inputs, role-to-employee bindings, and optional file attachments."""
    actor, is_admin = _resolve_actor(request, db)
    pb = db.get(Playbook, playbook_id)
    if not pb or not pb.enabled:
        raise HTTPException(status_code=404, detail="Playbook 不存在或未启用")

    try:
        inputs: dict[str, Any] = json.loads(inputs_json or "{}")
        if not isinstance(inputs, dict):
            inputs = {}
    except Exception:
        raise HTTPException(status_code=400, detail="inputs_json 不是合法 JSON")
    try:
        role_assignments: dict[str, str] = json.loads(role_assignments_json or "{}")
        if not isinstance(role_assignments, dict):
            role_assignments = {}
    except Exception:
        raise HTTPException(status_code=400, detail="role_assignments_json 不是合法 JSON")

    file_blobs: list[tuple[str, bytes]] = []
    if len(files) > _MAX_PB_FILES:
        raise HTTPException(status_code=400, detail=f"单次最多上传 {_MAX_PB_FILES} 个附件")
    for up in files:
        if not up.filename:
            continue
        raw = await up.read()
        if len(raw) > _MAX_PB_FILE_BYTES:
            raise HTTPException(status_code=400, detail=f"附件 '{up.filename}' 超过 10MB 限制")
        file_blobs.append((up.filename, raw))

    accessible = list_accessible_sandboxes(db, actor, is_admin)
    try:
        run = start_playbook_run(
            db,
            settings,
            resolve_docker(),
            pb,
            title=title.strip() or str(inputs.get("feature_title") or inputs.get("report_title") or inputs.get("contract_name") or pb.name),
            inputs=inputs,
            role_assignments={str(k): str(v) for k, v in role_assignments.items() if v},
            accessible_sandboxes=accessible,
            team_id=team_id.strip() or None,
            execution_mode=execution_mode,
            files=file_blobs,
            actor=actor,
        )
        return serialize_playbook_run(db, run)
    except Exception as exc:
        raise _manager_error(exc) from exc


def _can_access_run(db: Session, run: PlaybookRun, actor: str, is_admin: bool) -> bool:
    if is_admin or run.created_by.lower() == actor.lower():
        return True
    if run.team_id:
        return bool(
            db.scalar(
                select(TeamMember.id).where(
                    TeamMember.team_id == run.team_id,
                    TeamMember.user_email == actor.lower(),
                )
            )
        )
    return False


@router.get("/api/playbook-runs")
def api_list_playbook_runs(
    request: Request,
    playbook_key: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    actor, is_admin = _resolve_actor(request, db)
    stmt = select(PlaybookRun)
    if playbook_key:
        stmt = stmt.where(PlaybookRun.playbook_key == playbook_key)
    if team_id:
        stmt = stmt.where(PlaybookRun.team_id == team_id)
    if not is_admin:
        team_ids = list(
            db.scalars(
                select(TeamMember.team_id).where(TeamMember.user_email == actor.lower())
            ).all()
        )
        if team_ids:
            stmt = stmt.where(
                or_(
                    PlaybookRun.created_by == actor.lower(),
                    PlaybookRun.team_id.in_(team_ids),
                )
            )
        else:
            stmt = stmt.where(PlaybookRun.created_by == actor.lower())

    runs = list(db.scalars(stmt.order_by(PlaybookRun.created_at.desc()).limit(limit)).all())
    docker = resolve_docker()
    for r in runs:
        if r.status in {"running", "awaiting_approval"}:
            try:
                sync_playbook_run_progress(db, settings, docker, r)
            except Exception:
                pass
    return {"items": [serialize_playbook_run(db, r) for r in runs]}


@router.post("/api/playbook-runs/{run_id}/steps/{step_id}/decide")
def api_decide_playbook_step(
    run_id: str,
    step_id: str,
    payload: PlaybookStepDecisionRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, is_admin = _resolve_actor(request, db)
    run = db.get(PlaybookRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Playbook 运行记录不存在")
    if not _can_access_run(db, run, actor, is_admin):
        raise HTTPException(status_code=403, detail="无权操作该 Playbook 运行实例")
    step = db.get(PlaybookStepRun, step_id)
    if not step or step.run_id != run.id:
        raise HTTPException(status_code=404, detail="Playbook 阶段步骤不存在")
    try:
        updated = decide_playbook_step(
            db,
            settings,
            resolve_docker(),
            run,
            step,
            decision=payload.decision,
            note=payload.note,
            output_summary=payload.output_summary,
            artifacts=payload.artifacts,
            actor=actor,
        )
        return serialize_playbook_run(db, updated)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/playbook-runs/{run_id}/cancel")
def api_cancel_playbook_run(
    run_id: str,
    request: Request,
    payload: PlaybookRunCancelRequest | None = None,
    db: Session = Depends(get_db),
):
    actor, is_admin = _resolve_actor(request, db)
    run = db.get(PlaybookRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Playbook 运行记录不存在")
    if not _can_access_run(db, run, actor, is_admin):
        raise HTTPException(status_code=403, detail="无权操作该 Playbook 运行实例")
    try:
        updated = cancel_playbook_run(
            db,
            run,
            note=payload.note if payload else "",
            actor=actor,
        )
        return serialize_playbook_run(db, updated)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/playbook-runs/{run_id}/steps/{step_id}/retry")
def api_retry_playbook_step(
    run_id: str,
    step_id: str,
    payload: PlaybookStepRetryRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    actor, is_admin = _resolve_actor(request, db)
    run = db.get(PlaybookRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Playbook 运行记录不存在")
    if not _can_access_run(db, run, actor, is_admin):
        raise HTTPException(status_code=403, detail="无权操作该 Playbook 运行实例")
    step = db.get(PlaybookStepRun, step_id)
    if not step or step.run_id != run.id:
        raise HTTPException(status_code=404, detail="Playbook 阶段步骤不存在")
    accessible = list_accessible_sandboxes(db, actor, is_admin)
    try:
        updated = retry_playbook_step(
            db,
            settings,
            resolve_docker(),
            run,
            step,
            sandbox_id=payload.sandbox_id,
            note=payload.note,
            accessible_sandboxes=accessible,
            actor=actor,
        )
        return serialize_playbook_run(db, updated)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/playbook-runs/{run_id}/steps/{step_id}/skip")
def api_skip_playbook_step(
    run_id: str,
    step_id: str,
    request: Request,
    payload: PlaybookStepSkipRequest | None = None,
    db: Session = Depends(get_db),
):
    actor, is_admin = _resolve_actor(request, db)
    run = db.get(PlaybookRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Playbook 运行记录不存在")
    if not _can_access_run(db, run, actor, is_admin):
        raise HTTPException(status_code=403, detail="无权操作该 Playbook 运行实例")
    step = db.get(PlaybookStepRun, step_id)
    if not step or step.run_id != run.id:
        raise HTTPException(status_code=404, detail="Playbook 阶段步骤不存在")
    try:
        updated = skip_playbook_step(
            db,
            settings,
            resolve_docker(),
            run,
            step,
            note=payload.note if payload else "",
            actor=actor,
        )
        return serialize_playbook_run(db, updated)
    except Exception as exc:
        raise _manager_error(exc) from exc
