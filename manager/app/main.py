"""FastAPI application entrypoint assembling middleware, lifecycle, routers, and SPA shell."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .db import SessionLocal, init_db
from .deps import (
    OIDC_ID_TOKEN_COOKIE,
    OIDC_PROMPT_LOGIN_COOKIE,
    SESSION_COOKIE_NAME,
    WEB_DIST_DIR,
    _default_get_docker,
    _default_get_plugin_registry,
    logger,
    oidc_registry,
    resolve_docker,
    settings,
)
from .oidc import probe_oidc_discovery
from .routers import admin, auth, plugins, sandboxes, system, workforce
from .scheduler import BackgroundWorker
from .services import (
    ensure_bootstrap_admin,
    ensure_bootstrap_oidc_provider,
    ensure_default_templates,
    list_oidc_providers,
)

# Backwards-compatible factory references (also monkeypatched in pytest suites)
get_docker = _default_get_docker
get_runtime = _default_get_docker
get_plugin_registry = _default_get_plugin_registry


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.secret_key in {
        "change-me-in-production",
        "replace-with-a-long-random-secret",
    }:
        raise RuntimeError(
            "SECRET_KEY must be set to a random secret before starting dsh-manager"
        )
    if settings.manager_auth_mode == "token" and not settings.manager_admin_token:
        raise RuntimeError(
            "MANAGER_ADMIN_TOKEN must be set when MANAGER_AUTH_MODE=token"
        )
    init_db()
    with SessionLocal() as db:
        ensure_bootstrap_admin(db, settings.manager_admin_email)
        ensure_default_templates(db, settings)
        ensure_bootstrap_oidc_provider(db, settings)
        if settings.manager_auth_mode == "oidc":
            enabled_providers = list_oidc_providers(db, enabled_only=True)
            if not enabled_providers and not settings.manager_admin_token:
                raise RuntimeError(
                    "MANAGER_AUTH_MODE=oidc requires at least one enabled OIDC provider "
                    "(configure in Admin Console or set OIDC_ISSUER_URL/OIDC_DISCOVERY_URL + OIDC_CLIENT_ID) "
                    "or MANAGER_ADMIN_TOKEN"
                )

    worker_task: asyncio.Task | None = None
    if settings.background_tasks:
        worker = BackgroundWorker(settings, resolve_docker())
        worker_task = asyncio.create_task(worker.run())
    try:
        yield
    finally:
        if worker_task is not None:
            worker_task.cancel()
            with suppress(asyncio.CancelledError):
                await worker_task


app = FastAPI(
    title="Metis — Enterprise Digital Workforce Cloud",
    version="0.4.0",
    lifespan=lifespan,
)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.secret_key,
    session_cookie=SESSION_COOKIE_NAME,
    same_site="lax",
    https_only=settings.manager_base_url.startswith("https"),
)

if (WEB_DIST_DIR / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=str(WEB_DIST_DIR / "assets")),
        name="spa-assets",
    )

# Register domain routers (sandboxes last so /s/{slug}* sleeping fallback never shadows API routes)
app.include_router(system.router)
app.include_router(plugins.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(workforce.router)
app.include_router(sandboxes.router)


def _serve_spa():
    index_file = WEB_DIST_DIR / "index.html"
    if index_file.is_file():
        return FileResponse(str(index_file), media_type="text/html")
    return HTMLResponse(
        "<h1>Manager Frontend not built yet</h1><p>Run <code>yarn build</code> in <code>manager/frontend</code>.</p>",
        status_code=503,
    )


@app.get("/", include_in_schema=False)
@app.get("/login", include_in_schema=False)
@app.get("/auth/login", include_in_schema=False)
@app.get("/admin", include_in_schema=False)
@app.get("/my", include_in_schema=False)
def spa_routes():
    return _serve_spa()


__all__ = [
    "OIDC_ID_TOKEN_COOKIE",
    "OIDC_PROMPT_LOGIN_COOKIE",
    "SESSION_COOKIE_NAME",
    "app",
    "get_docker",
    "get_plugin_registry",
    "get_runtime",
    "logger",
    "oidc_registry",
    "probe_oidc_discovery",
    "settings",
]
