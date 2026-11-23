"""System health, Traefik dynamic provider, overview, sleep policy, and branding routes."""

from __future__ import annotations

import base64
import hmac

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select, text
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..deps import (
    require_admin_api,
    resolve_docker,
    resolve_plugin_registry,
    session_email,
    settings,
)
from ..docker_service import build_traefik_dynamic_config
from ..models import AuditLog, Sandbox, SandboxTemplate, User
from ..schemas import (
    BrandingOut,
    BrandingUpdate,
    HealthOut,
    IdleSleepPolicyOut,
    IdleSleepPolicyUpdate,
)
from ..services import (
    DEFAULT_BRAND_LOGO_SVG,
    get_allow_local_user_login,
    get_branding_config,
    get_idle_sleep_policy,
    list_oidc_providers,
    set_branding_config,
    set_idle_sleep_policy,
)

router = APIRouter()


@router.get("/healthz", response_model=HealthOut)
def healthz(db: Session = Depends(get_db)):
    db_ok = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        db_ok = f"error: {exc}"

    docker_ok = "ok"
    try:
        runtime = resolve_docker()
        if hasattr(runtime, "ping"):
            runtime.ping()
        else:
            runtime.client.ping()
    except Exception as exc:
        docker_ok = f"error: {exc}"

    if db_ok != "ok" or docker_ok != "ok":
        raise HTTPException(
            status_code=503,
            detail={"database": db_ok, "docker": docker_ok},
        )
    return HealthOut(status="ok", database=db_ok, docker=docker_ok)


@router.get("/api/internal/traefik/config", include_in_schema=False)
def traefik_dynamic_config(
    request: Request,
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Traefik HTTP Provider endpoint serving dynamic routers/middlewares/services for running sandboxes."""
    expected_token = (settings.traefik_provider_token or "").strip()
    if expected_token:
        provided = (token or "").strip()
        if not provided:
            auth_header = request.headers.get("authorization") or ""
            if auth_header.lower().startswith("bearer "):
                provided = auth_header[7:].strip()
        if not provided or not hmac.compare_digest(provided, expected_token):
            raise HTTPException(status_code=401, detail="invalid traefik provider token")

    sandboxes = list(
        db.scalars(
            select(Sandbox)
            .where(Sandbox.deleted_at.is_(None), Sandbox.status == "running")
            .order_by(Sandbox.slug.asc())
        ).all()
    )
    runtime = resolve_docker()
    pairs: list[tuple[Sandbox, str]] = []
    for sbx in sandboxes:
        try:
            upstream = runtime.upstream_origin(sbx)
            if upstream:
                pairs.append((sbx, upstream))
        except Exception:
            continue
    return JSONResponse(
        content=build_traefik_dynamic_config(settings, pairs),
        headers={"Cache-Control": "no-store"},
    )


# ---------------------------------------------------------------------------
# Self-hosted Plugin Discover Index & Built-in Read-Only NPM Registry
# ---------------------------------------------------------------------------



@router.get("/api/overview")
def api_overview(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    sandboxes = list(
        db.scalars(
            select(Sandbox).where(Sandbox.deleted_at.is_(None))
        ).all()
    )
    users_count = len(list(db.scalars(select(User)).all()))
    templates_count = len(list(db.scalars(select(SandboxTemplate)).all()))
    plugins = resolve_plugin_registry().list_packages()
    recent_audits = list(
        db.scalars(
            select(AuditLog).order_by(AuditLog.created_at.desc()).limit(25)
        ).all()
    )
    running_count = sum(1 for s in sandboxes if s.status == "running")
    allocated_cpus = sum(
        (s.cpu_limit if s.cpu_limit is not None else settings.sandbox_cpus)
        for s in sandboxes
    )
    idle_enabled, idle_minutes = get_idle_sleep_policy(db, settings)
    oidc_providers = list_oidc_providers(db)
    enabled_oidc_count = sum(1 for p in oidc_providers if p.enabled)
    allow_local_user = get_allow_local_user_login(db, settings)
    brand_cfg = get_branding_config(db)
    return {
        "total_sandboxes": len(sandboxes),
        "running_sandboxes": running_count,
        "stopped_sandboxes": len(sandboxes) - running_count,
        "allocated_cpus": round(allocated_cpus, 2),
        "users_count": users_count,
        "templates_count": templates_count,
        "plugins_count": len(plugins),
        "oidc_providers_count": len(oidc_providers),
        "enabled_oidc_providers_count": enabled_oidc_count,
        "allow_local_user_login": allow_local_user,
        "admin_token_configured": bool(settings.manager_admin_token),
        "default_image_repo": settings.dsh_image_repo,
        "default_image_tag": settings.dsh_image_tag,
        "default_cpus": settings.sandbox_cpus,
        "default_memory": settings.sandbox_memory,
        "manager_auth_mode": settings.manager_auth_mode,
        "sandbox_runtime": settings.sandbox_runtime,
        "plugin_index_url": settings.plugin_index_url,
        "idle_sleep_enabled": idle_enabled,
        "idle_sleep_minutes": idle_minutes,
        "brand_name_zh": brand_cfg["brand_name_zh"],
        "brand_name_en": brand_cfg["brand_name_en"],
        "brand_logo_svg": brand_cfg["brand_logo_svg"],
        "brand_favicon": brand_cfg["brand_favicon"],
        "brand_theme": brand_cfg["brand_theme"],
        "local_images": resolve_docker().list_local_images(),
        "audit_logs": [
            {
                "id": a.id,
                "actor": a.actor,
                "action": a.action,
                "target": a.target,
                "detail": a.detail,
                "created_at": a.created_at.isoformat(),
            }
            for a in recent_audits
        ],
    }



@router.get("/api/policies/idle-sleep", response_model=IdleSleepPolicyOut)
def api_get_idle_sleep_policy(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    enabled, idle_minutes = get_idle_sleep_policy(db, settings)
    return IdleSleepPolicyOut(enabled=enabled, idle_minutes=idle_minutes)


@router.put("/api/policies/idle-sleep", response_model=IdleSleepPolicyOut)
def api_update_idle_sleep_policy(
    payload: IdleSleepPolicyUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    enabled, idle_minutes = set_idle_sleep_policy(
        db,
        enabled=payload.enabled,
        idle_minutes=payload.idle_minutes,
        actor=session_email(request) or settings.manager_admin_email,
    )
    return IdleSleepPolicyOut(enabled=enabled, idle_minutes=idle_minutes)


@router.get("/api/branding", response_model=BrandingOut)
def api_get_branding(
    db: Session = Depends(get_db),
):
    return BrandingOut(**get_branding_config(db))


@router.put("/api/branding", response_model=BrandingOut)
def api_update_branding(
    payload: BrandingUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        cfg = set_branding_config(
            db,
            brand_name_zh=payload.brand_name_zh,
            brand_name_en=payload.brand_name_en,
            brand_logo_svg=payload.brand_logo_svg,
            brand_favicon=payload.brand_favicon,
            brand_theme=payload.brand_theme,
            actor=session_email(request) or settings.manager_admin_email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Best-effort live HMR push of brand tokens into running sandboxes (@metis/custom-theme)
    runtime = resolve_docker()
    if hasattr(runtime, "sync_brand_theme"):
        running_sandboxes = list(
            db.scalars(
                select(Sandbox).where(Sandbox.deleted_at.is_(None), Sandbox.status == "running")
            ).all()
        )
        for sbx in running_sandboxes:
            try:
                runtime.sync_brand_theme(sbx, cfg)
            except Exception:
                continue

    return BrandingOut(**cfg)


@router.get("/api/branding/favicon", include_in_schema=False)
def api_branding_favicon(db: Session = Depends(get_db)):
    """Serve active custom favicon (or custom logo SVG, or default Metis emblem SVG)."""
    cfg = get_branding_config(db)
    fav = (cfg.get("brand_favicon") or "").strip()
    if fav:
        if fav.startswith("<"):
            return Response(
                content=fav,
                media_type="image/svg+xml",
                headers={"Cache-Control": "no-cache"},
            )
        if fav.lower().startswith("data:image/") and ";base64," in fav:
            header, b64_data = fav.split(";base64,", 1)
            media_type = header[5:] or "image/png"
            try:
                raw_bytes = base64.b64decode(b64_data, validate=True)
                return Response(
                    content=raw_bytes,
                    media_type=media_type,
                    headers={"Cache-Control": "no-cache"},
                )
            except Exception:
                pass
        if fav.startswith(("http://", "https://", "/")):
            return RedirectResponse(fav, status_code=302)

    logo_svg = (cfg.get("brand_logo_svg") or "").strip() or DEFAULT_BRAND_LOGO_SVG
    return Response(
        content=logo_svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "no-cache"},
    )


# ---------------------------------------------------------------------------
# Auth Policy & Multi-OIDC Providers CRUD API
# ---------------------------------------------------------------------------

