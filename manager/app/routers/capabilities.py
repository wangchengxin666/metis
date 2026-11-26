"""API routes for MCP Server Center and Agent Skill Center (presets, CRUD, import, targeted push)."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin_api, resolve_docker, session_email, settings
from ..models import McpServer, Sandbox, SkillItem
from ..schemas import (
    CapabilityPushRequest,
    McpServerCreate,
    McpServerImportRequest,
    McpServerOut,
    McpServerUpdate,
    SkillCreate,
    SkillImportRequest,
    SkillOut,
    SkillUpdate,
)
from ..services.capabilities import (
    create_mcp_server,
    create_skill,
    delete_mcp_server,
    delete_skill,
    export_skill_zip,
    import_mcp_servers_json,
    import_skill_markdown,
    import_skill_zip,
    list_mcp_servers,
    list_skills,
    push_mcp_servers,
    push_skills,
    resolve_push_target_sandboxes,
    seed_builtin_mcp_servers,
    seed_builtin_skills,
    update_mcp_server,
    update_skill,
)

router = APIRouter()


def _mcp_pushed_map(db: Session) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for sbx in db.scalars(select(Sandbox).where(Sandbox.deleted_at.is_(None))).all():
        for mid in sbx.mcp_server_ids:
            mapping.setdefault(mid, []).append(sbx.id)
    return mapping


def _skill_pushed_map(db: Session) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for sbx in db.scalars(select(Sandbox).where(Sandbox.deleted_at.is_(None))).all():
        for sid in sbx.skill_ids:
            mapping.setdefault(sid, []).append(sbx.id)
    return mapping


def _mcp_out(srv: McpServer, pushed_ids: list[str] | None = None) -> McpServerOut:
    return McpServerOut(
        id=srv.id,
        slug=srv.slug,
        name=srv.name,
        description=srv.description,
        category=srv.category,
        transport=srv.transport,
        command=srv.command,
        args=srv.args,
        env=srv.env,
        cwd=srv.cwd,
        url=srv.url,
        headers=srv.headers,
        tool_loading=srv.tool_loading,
        enabled=srv.enabled,
        required_credentials=srv.required_credentials,
        is_builtin=srv.is_builtin,
        created_by=srv.created_by,
        pushed_sandbox_ids=pushed_ids if pushed_ids is not None else [],
        created_at=srv.created_at,
        updated_at=srv.updated_at,
    )


def _skill_out(skill: SkillItem, pushed_ids: list[str] | None = None) -> SkillOut:
    return SkillOut(
        id=skill.id,
        slug=skill.slug,
        name=skill.name,
        description=skill.description,
        when_to_use=skill.when_to_use,
        category=skill.category,
        content=skill.content,
        extra_files=skill.extra_files,
        disable_model_invocation=skill.disable_model_invocation,
        user_invocable=skill.user_invocable,
        is_builtin=skill.is_builtin,
        created_by=skill.created_by,
        pushed_sandbox_ids=pushed_ids if pushed_ids is not None else [],
        created_at=skill.created_at,
        updated_at=skill.updated_at,
    )


# ---------------------------------------------------------------------------
# MCP Servers Center
# ---------------------------------------------------------------------------


@router.get("/api/mcp-servers", response_model=list[McpServerOut])
def api_list_mcp_servers(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    pushed = _mcp_pushed_map(db)
    return [_mcp_out(s, pushed.get(s.id, [])) for s in list_mcp_servers(db)]


@router.post("/api/mcp-servers/seed-builtins", response_model=list[McpServerOut])
def api_seed_mcp_servers(
    request: Request,
    overwrite: bool = False,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    actor = session_email(request) or settings.manager_admin_email
    items = seed_builtin_mcp_servers(db, overwrite=overwrite, actor=actor)
    pushed = _mcp_pushed_map(db)
    return [_mcp_out(s, pushed.get(s.id, [])) for s in items]


@router.post("/api/mcp-servers", response_model=McpServerOut, status_code=201)
def api_create_mcp_server(
    payload: McpServerCreate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    from ..deps import _manager_error

    try:
        srv = create_mcp_server(
            db, payload, actor=session_email(request) or settings.manager_admin_email
        )
        return _mcp_out(srv, [])
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/mcp-servers/import", response_model=list[McpServerOut], status_code=201)
def api_import_mcp_servers(
    payload: McpServerImportRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    from ..deps import _manager_error

    try:
        items = import_mcp_servers_json(
            db,
            payload.content,
            overwrite=payload.overwrite,
            actor=session_email(request) or settings.manager_admin_email,
        )
        pushed = _mcp_pushed_map(db)
        return [_mcp_out(s, pushed.get(s.id, [])) for s in items]
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.patch("/api/mcp-servers/{server_id}", response_model=McpServerOut)
def api_update_mcp_server(
    server_id: str,
    payload: McpServerUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    from ..deps import _manager_error

    srv = db.get(McpServer, server_id)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP 服务不存在")
    try:
        updated = update_mcp_server(
            db, srv, payload, actor=session_email(request) or settings.manager_admin_email
        )
        pushed = _mcp_pushed_map(db)
        return _mcp_out(updated, pushed.get(updated.id, []))
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/mcp-servers/{server_id}")
def api_delete_mcp_server(
    server_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    srv = db.get(McpServer, server_id)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP 服务不存在")
    delete_mcp_server(
        db, srv, actor=session_email(request) or settings.manager_admin_email
    )
    return {"ok": True}


@router.post("/api/mcp-servers/batch-push")
def api_batch_push_mcp_servers(
    payload: CapabilityPushRequest = Body(default_factory=CapabilityPushRequest),
    request: Request = None,  # type: ignore[assignment]
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    ids = [str(x).strip() for x in (payload.item_ids or []) if str(x).strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="请选择至少 1 个 MCP 服务")
    servers = list(db.scalars(select(McpServer).where(McpServer.id.in_(ids))).all())
    if not servers:
        raise HTTPException(status_code=404, detail="未找到选中的 MCP 服务")
    targets = resolve_push_target_sandboxes(
        db, sandbox_ids=payload.sandbox_ids, template_keys=payload.template_keys
    )
    return push_mcp_servers(
        db,
        resolve_docker(),
        servers,
        targets,
        action=payload.action,
        actor=session_email(request) if request is not None else None,
    )


@router.post("/api/mcp-servers/{server_id}/push")
def api_push_mcp_server(
    server_id: str,
    payload: CapabilityPushRequest | None = Body(default=None),
    request: Request = None,  # type: ignore[assignment]
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    srv = db.get(McpServer, server_id)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP 服务不存在")
    req = payload or CapabilityPushRequest()
    targets = resolve_push_target_sandboxes(
        db, sandbox_ids=req.sandbox_ids, template_keys=req.template_keys
    )
    return push_mcp_servers(
        db,
        resolve_docker(),
        [srv],
        targets,
        action=req.action,
        actor=session_email(request) if request is not None else None,
    )


# ---------------------------------------------------------------------------
# Agent Skills Center
# ---------------------------------------------------------------------------


@router.get("/api/skills", response_model=list[SkillOut])
def api_list_skills(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    pushed = _skill_pushed_map(db)
    return [_skill_out(s, pushed.get(s.id, [])) for s in list_skills(db)]


@router.post("/api/skills/seed-builtins", response_model=list[SkillOut])
def api_seed_skills(
    request: Request,
    overwrite: bool = False,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    actor = session_email(request) or settings.manager_admin_email
    items = seed_builtin_skills(db, overwrite=overwrite, actor=actor)
    pushed = _skill_pushed_map(db)
    return [_skill_out(s, pushed.get(s.id, [])) for s in items]


@router.post("/api/skills", response_model=SkillOut, status_code=201)
def api_create_skill(
    payload: SkillCreate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    from ..deps import _manager_error

    try:
        skill = create_skill(
            db, payload, actor=session_email(request) or settings.manager_admin_email
        )
        return _skill_out(skill, [])
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/skills/import", response_model=SkillOut, status_code=201)
def api_import_skill(
    payload: SkillImportRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    from ..deps import _manager_error

    try:
        skill = import_skill_markdown(
            db, payload, actor=session_email(request) or settings.manager_admin_email
        )
        pushed = _skill_pushed_map(db)
        return _skill_out(skill, pushed.get(skill.id, []))
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/skills/import-zip", response_model=SkillOut, status_code=201)
async def api_import_skill_zip(
    request: Request,
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    slug: str | None = Form(default=None),
    category: str = Form(default="custom"),
    overwrite: bool = Form(default=False),
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    from ..deps import _manager_error

    try:
        raw = await file.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError("ZIP 压缩包不能超过 16MB")
        skill = import_skill_zip(
            db,
            raw,
            name=name,
            slug=slug,
            category=category,
            overwrite=overwrite,
            filename_hint=file.filename,
            actor=session_email(request) or settings.manager_admin_email,
        )
        pushed = _skill_pushed_map(db)
        return _skill_out(skill, pushed.get(skill.id, []))
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.get("/api/skills/{skill_id}/export")
def api_export_skill_zip(
    skill_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    skill = db.get(SkillItem, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    filename, zip_bytes = export_skill_zip(skill)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/api/skills/{skill_id}", response_model=SkillOut)
def api_update_skill(
    skill_id: str,
    payload: SkillUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    from ..deps import _manager_error

    skill = db.get(SkillItem, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    try:
        updated = update_skill(
            db, skill, payload, actor=session_email(request) or settings.manager_admin_email
        )
        pushed = _skill_pushed_map(db)
        return _skill_out(updated, pushed.get(updated.id, []))
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/skills/{skill_id}")
def api_delete_skill(
    skill_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    skill = db.get(SkillItem, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    delete_skill(
        db, skill, actor=session_email(request) or settings.manager_admin_email
    )
    return {"ok": True}


@router.post("/api/skills/batch-push")
def api_batch_push_skills(
    payload: CapabilityPushRequest = Body(default_factory=CapabilityPushRequest),
    request: Request = None,  # type: ignore[assignment]
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    ids = [str(x).strip() for x in (payload.item_ids or []) if str(x).strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="请选择至少 1 个 Skill")
    skills = list(db.scalars(select(SkillItem).where(SkillItem.id.in_(ids))).all())
    if not skills:
        raise HTTPException(status_code=404, detail="未找到选中的 Skill")
    targets = resolve_push_target_sandboxes(
        db, sandbox_ids=payload.sandbox_ids, template_keys=payload.template_keys
    )
    return push_skills(
        db,
        resolve_docker(),
        skills,
        targets,
        action=payload.action,
        actor=session_email(request) if request is not None else None,
    )


@router.post("/api/skills/{skill_id}/push")
def api_push_skill(
    skill_id: str,
    payload: CapabilityPushRequest | None = Body(default=None),
    request: Request = None,  # type: ignore[assignment]
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    skill = db.get(SkillItem, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    req = payload or CapabilityPushRequest()
    targets = resolve_push_target_sandboxes(
        db, sandbox_ids=req.sandbox_ids, template_keys=req.template_keys
    )
    return push_skills(
        db,
        resolve_docker(),
        [skill],
        targets,
        action=req.action,
        actor=session_email(request) if request is not None else None,
    )
