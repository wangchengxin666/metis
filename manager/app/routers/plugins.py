"""Self-hosted DSH plugin registry, npm packument proxy, and sandbox sync routes."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import (
    require_admin_api,
    resolve_docker,
    resolve_plugin_registry,
    session_email,
    settings,
)
from ..models import Sandbox
from ..schemas import PluginIndexSourcesUpdate, PluginSyncRequest
from ..services import (
    audit,
    get_extra_plugin_indexes,
    resolve_push_target_sandboxes,
    set_extra_plugin_indexes,
)

router = APIRouter()


def _request_origin(request: Request, fallback_url: str) -> str:
    raw_host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or ""
    ).split(",")[0].strip()
    if not raw_host or raw_host == "testserver":
        return fallback_url
    raw_proto = (
        request.headers.get("x-forwarded-proto")
        or request.url.scheme
        or "http"
    ).split(",")[0].strip()
    return f"{raw_proto}://{raw_host}".rstrip("/")


@router.get("/plugins/index.json")
def plugin_discover_index(request: Request):
    base_url = _request_origin(request, settings.manager_base_url)
    doc = resolve_plugin_registry().build_index(base_url)
    return JSONResponse(
        content=doc,
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/plugins/icons/{icon_name}")
def plugin_icon(icon_name: str):
    icon_path = resolve_plugin_registry().resolve_icon(icon_name)
    if not icon_path:
        raise HTTPException(status_code=404, detail="icon not found")
    media_type = (
        "image/svg+xml"
        if icon_path.suffix.lower() == ".svg"
        else "application/octet-stream"
    )
    return FileResponse(
        path=str(icon_path),
        media_type=media_type,
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/plugins/packages/{tarball_name}")
def plugin_tarball(tarball_name: str):
    pkg = resolve_plugin_registry().get_by_slug_or_filename(tarball_name)
    if not pkg:
        raise HTTPException(status_code=404, detail="plugin package not found")
    return Response(
        content=pkg.tarball_bytes,
        media_type="application/gzip",
        headers={
            "Cache-Control": "no-cache",
            "Content-Disposition": f'attachment; filename="{pkg.slug}-{pkg.version}.tgz"',
        },
    )


@router.get("/plugins/npm/{package_name:path}")
def plugin_npm_packument(package_name: str, request: Request):
    pkg = resolve_plugin_registry().get_by_package_name(package_name)
    if not pkg:
        return RedirectResponse(
            url=f"https://registry.npmmirror.com/{package_name}",
            status_code=307,
        )
    reach_url = _request_origin(request, settings.sandbox_reachable_manager_url)
    packument = resolve_plugin_registry().build_npm_packument(pkg, reach_url)
    return JSONResponse(
        content=packument,
        headers={"Cache-Control": "no-cache"},
    )



@router.get("/api/plugins")
def api_plugins(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    base_url = settings.manager_base_url
    packages = resolve_plugin_registry().list_packages()
    index_doc = resolve_plugin_registry().build_index(base_url)
    index_by_name = {
        entry.get("name"): entry for entry in index_doc.get("plugins", [])
    }
    root_meta = index_doc.get("metadata") if isinstance(index_doc.get("metadata"), dict) else {}
    items = []
    for pkg in packages:
        entry = index_by_name.get(pkg.name) or {}
        title_obj = entry.get("title") or {}
        desc_obj = entry.get("description") or {}
        entry_meta = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
        items.append(
            {
                "slug": pkg.slug,
                "package_name": pkg.name,
                "version": pkg.version,
                "display_name_zh": (
                    title_obj.get("zh") if isinstance(title_obj, dict) else pkg.name
                )
                or pkg.name,
                "display_name_en": (
                    title_obj.get("en") if isinstance(title_obj, dict) else pkg.name
                )
                or pkg.name,
                "description_zh": (
                    desc_obj.get("zh")
                    if isinstance(desc_obj, dict)
                    else pkg.description
                )
                or pkg.description,
                "description_en": (
                    desc_obj.get("en")
                    if isinstance(desc_obj, dict)
                    else pkg.description
                )
                or pkg.description,
                "author": entry.get("author") or "Metis",
                "category": entry_meta.get("category") or (entry.get("categories") or ["utility"])[0],
                "labels": entry_meta.get("labels") or [],
                "icon_url": f"{base_url}/plugins/icons/{pkg.slug}.svg",
                "tarball_url": f"{base_url}/plugins/packages/{pkg.slug}.tgz",
                "npm_packument_url": f"{base_url}/plugins/npm/{pkg.name}",
                "install_command": f"dsh plugin --profile web add {base_url}/plugins/packages/{pkg.slug}.tgz",
            }
        )
    return {
        "index_url": f"{base_url}/plugins/index.json",
        "npm_registry_url": f"{base_url}/plugins/npm",
        "source_type": settings.plugin_source_type,
        "auto_install_default": settings.sandbox_auto_install_plugins,
        "categories": root_meta.get("categories") or {},
        "extra_indexes": get_extra_plugin_indexes(db),
        "items": items,
    }


@router.put("/api/plugins/indexes")
def api_update_plugin_indexes(
    payload: PluginIndexSourcesUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    actor = session_email(request) if request is not None else None
    try:
        saved = set_extra_plugin_indexes(
            db,
            [item.model_dump() for item in payload.indexes],
            actor=actor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    synced = 0
    results: list[dict] = []
    if payload.sync_sandboxes:
        enabled_urls = [str(x["url"]) for x in saved if x.get("enabled", True)]
        sandboxes = list(
            db.scalars(select(Sandbox).where(Sandbox.deleted_at.is_(None))).all()
        )
        for sbx in sandboxes:
            try:
                res = resolve_docker().sync_plugin_market(
                    sbx,
                    extra_indexes=enabled_urls,
                )
                results.append(res)
            except Exception as exc:
                results.append({"slug": sbx.slug, "ok": False, "detail": str(exc)})
        synced = len([r for r in results if r.get("ok")])

    return {
        "extra_indexes": saved,
        "synced": synced,
        "results": results,
    }


@router.post("/api/plugins/sync-sandboxes")
def api_sync_plugins_to_sandboxes(
    request: Request,
    payload: PluginSyncRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    req = payload or PluginSyncRequest()
    sandboxes = resolve_push_target_sandboxes(
        db,
        sandbox_ids=req.sandbox_ids,
        template_keys=req.template_keys,
        include_stopped_explicit=True,
    )

    reinstall_plugins = (
        req.plugins if req.mode == "reinstall_selected" and req.plugins else None
    )
    force_reinstall = req.mode == "reinstall_builtin"
    extra_urls = [
        str(x["url"])
        for x in get_extra_plugin_indexes(db)
        if x.get("enabled", True) and x.get("url")
    ]

    results = []
    for sbx in sandboxes:
        try:
            res = resolve_docker().sync_plugin_market(
                sbx,
                reinstall_plugins=reinstall_plugins,
                force_reinstall=force_reinstall,
                extra_indexes=extra_urls,
            )
            results.append(res)
        except Exception as exc:
            results.append({"slug": sbx.slug, "ok": False, "detail": str(exc)})
    synced = len([r for r in results if r.get("ok")])
    actor = session_email(request) if request is not None else None
    audit(
        db,
        "plugins.sync",
        target="sandboxes",
        actor=actor,
        detail=f"mode={req.mode},synced={synced}/{len(results)}",
    )
    db.commit()
    return {"synced": synced, "mode": req.mode, "results": results}

