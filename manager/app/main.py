from __future__ import annotations

import asyncio
import hmac
import html as html_lib
import logging
import os
import tempfile
import threading
import time
from contextlib import asynccontextmanager, suppress
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, urlsplit

from authlib.integrations.starlette_client import OAuthError
from fastapi import (
    Body,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    PlainTextResponse,
    RedirectResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from starlette.middleware.sessions import SessionMiddleware

from .config import Settings, get_settings
from .db import SessionLocal, get_db, init_db
from .docker_service import DockerService, SandboxRuntimeError
from .models import (
    AuditLog,
    LlmProfile,
    OidcProvider,
    PlatformAdmin,
    Sandbox,
    SandboxTemplate,
    User,
)
from .oidc import (
    OidcClientRegistry,
    build_provider_logout_url,
    is_email_domain_allowed,
    probe_oidc_discovery,
)
from .plugin_registry import PluginRegistryService
from .scheduler import BackgroundWorker
from .schemas import (
    AdminCreate,
    AdminOut,
    AuthPolicyOut,
    AuthPolicyUpdate,
    HealthOut,
    IdleSleepPolicyOut,
    IdleSleepPolicyUpdate,
    LlmProfileCreate,
    LlmProfileOut,
    LlmProfilePushRequest,
    LlmProfileUpdate,
    OidcProviderCreate,
    OidcProviderOut,
    OidcProviderTestOut,
    OidcProviderTestRequest,
    OidcProviderUpdate,
    PluginSyncRequest,
    SandboxCreate,
    SandboxList,
    SandboxOut,
    SandboxPatch,
    TemplateCreate,
    TemplateOut,
    TemplateUpdate,
    UserCreate,
    UserOut,
    UserPasswordChange,
    UserUpdate,
)
from .security import encrypt_secret, hash_password, verify_password
from .services import (
    Conflict,
    ManagerError,
    NotFoundError,
    add_platform_admin,
    audit,
    create_llm_profile,
    create_oidc_provider,
    update_llm_profile,
    create_sandbox,
    create_template,
    deactivate_platform_admin,
    delete_oidc_provider,
    ensure_bootstrap_admin,
    ensure_bootstrap_oidc_provider,
    ensure_default_templates,
    get_allow_local_user_login,
    get_idle_sleep_policy,
    get_oidc_provider_by_slug,
    is_platform_admin,
    list_oidc_providers,
    list_platform_admins,
    list_templates,
    load_sandbox,
    load_sandbox_by_slug,
    refresh_status,
    restart_sandbox,
    set_allow_local_user_login,
    set_idle_sleep_policy,
    start_sandbox,
    stop_sandbox,
    touch_sandbox_activity,
    update_oidc_provider,
    update_sandbox_limits,
    update_template,
    upgrade_sandbox,
    utcnow,
    delete_sandbox,
    delete_template,
)

logger = logging.getLogger("dsh-manager")
settings = get_settings()
WEB_DIST_DIR = Path(__file__).parent / "web_dist"
SESSION_COOKIE_NAME = "dsh_manager_session"
OIDC_ID_TOKEN_COOKIE = "dsh_manager_id_token"
OIDC_PROMPT_LOGIN_COOKIE = "dsh_oidc_prompt_login"

oidc_registry = OidcClientRegistry()


def oidc_provider_out(provider: OidcProvider) -> OidcProviderOut:
    base = settings.manager_base_url
    return OidcProviderOut(
        id=provider.id,
        slug=provider.slug,
        name=provider.name,
        enabled=bool(provider.enabled),
        issuer_url=provider.issuer_url,
        discovery_url=provider.discovery_url,
        client_id=provider.client_id,
        has_client_secret=provider.has_client_secret,
        scope=provider.scope,
        email_claim=provider.email_claim,
        logout_url=provider.logout_url,
        allowed_domains=provider.allowed_domains,
        allow_admin_login=bool(provider.allow_admin_login),
        sort_order=provider.sort_order,
        redirect_uri=f"{base}/auth/oidc/{provider.slug}/callback",
        post_logout_redirect_uri=f"{base}/login",
        created_at=provider.created_at,
        updated_at=provider.updated_at,
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.secret_key in {
        "change-me-in-production",
        "replace-with-a-long-random-secret",
    }:
        raise RuntimeError("SECRET_KEY must be set to a long random value")

    if not settings.manager_admin_email:
        raise RuntimeError("MANAGER_ADMIN_EMAIL is required")

    if settings.manager_auth_mode == "token" and not settings.manager_admin_token:
        raise RuntimeError(
            "MANAGER_AUTH_MODE=token requires MANAGER_ADMIN_TOKEN to be set"
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
        worker = BackgroundWorker(settings, get_docker())
        worker_task = asyncio.create_task(worker.run())
    try:
        yield
    finally:
        if worker_task is not None:
            worker_task.cancel()
            with suppress(asyncio.CancelledError):
                await worker_task


app = FastAPI(
    title="DSH Sandbox Manager",
    version="0.3.0",
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


@lru_cache
def get_docker() -> DockerService:
    return DockerService(settings)


@lru_cache
def get_plugin_registry() -> PluginRegistryService:
    return PluginRegistryService(settings)


def sandbox_out(sandbox: Sandbox) -> SandboxOut:
    return SandboxOut(
        id=sandbox.id,
        email=sandbox.user.email,
        display_name=sandbox.user.display_name,
        slug=sandbox.slug,
        container_id=sandbox.container_id,
        volume_name=sandbox.volume_name,
        image_repo=sandbox.image_repo or settings.dsh_image_repo,
        image_tag=sandbox.image_tag,
        template=sandbox.template or "agent-os",
        init_repo_url=sandbox.init_repo_url,
        auto_install_plugins=sandbox.auto_install_plugins,
        llm_profile_id=sandbox.llm_profile_id,
        llm_profile_name=sandbox.llm_profile.name if sandbox.llm_profile else None,
        cpu_limit=(
            sandbox.cpu_limit
            if sandbox.cpu_limit is not None
            else settings.sandbox_cpus
        ),
        memory_limit=sandbox.memory_limit or settings.sandbox_memory,
        auto_sleep_exempt=bool(sandbox.auto_sleep_exempt),
        disk_usage_mb=sandbox.disk_usage_mb,
        disk_updated_at=sandbox.disk_updated_at,
        status=sandbox.status,
        url=settings.sandbox_url(sandbox.slug),
        created_at=sandbox.created_at,
        last_seen_at=sandbox.last_seen_at,
        deleted_at=sandbox.deleted_at,
    )


_wake_locks_guard = threading.Lock()
_wake_locks: dict[str, threading.Lock] = {}


def _get_wake_lock(slug: str) -> threading.Lock:
    with _wake_locks_guard:
        lock = _wake_locks.get(slug)
        if lock is None:
            lock = threading.Lock()
            _wake_locks[slug] = lock
        return lock


def _ensure_sandbox_awake(db: Session, sandbox: Sandbox) -> Sandbox:
    """Start a stopped sandbox container under a per-slug lock and wait until healthy."""
    docker = get_docker()
    with _get_wake_lock(sandbox.slug):
        current = docker.status(sandbox)
        if current != "running":
            docker.start(sandbox)
            audit(db, "sandbox.auto_wake", target=sandbox.id, detail=f"slug={sandbox.slug}")
        docker.wait_healthy(sandbox)
        sandbox.status = "running"
        sandbox.last_seen_at = utcnow()
        db.commit()
        db.refresh(sandbox)
        # Allow Traefik Docker provider a moment to pick up the running container labels.
        time.sleep(0.4)
    return sandbox


def _render_wake_html(slug: str, redirect_target: str) -> str:
    safe_slug = html_lib.escape(slug)
    js_slug = json_dumps_safe(slug)
    js_target = json_dumps_safe(redirect_target)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>正在唤醒工作区 /s/{safe_slug}/ - DSH Sandbox Cloud</title>
  <style>
    body{{margin:0;background:#09090b;color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}}
    .card{{max-width:440px;width:90%;padding:28px;border-radius:16px;background:#18181b;border:1px solid #27272a;box-shadow:0 24px 48px rgba(0,0,0,.55);text-align:center}}
    .spin{{width:32px;height:32px;margin:0 auto 16px;border:3px solid #27272a;border-top-color:#10b981;border-radius:50%;animation:s .9s linear infinite}}
    @keyframes s{{to{{transform:rotate(360deg)}}}}
    h2{{margin:0 0 8px;font-size:18px;font-weight:600}}
    p{{margin:0 0 18px;font-size:13px;color:#a1a1aa;line-height:1.6}}
    code{{background:#27272a;padding:2px 6px;border-radius:4px;color:#e4e4e7}}
    .err{{color:#fb7185;display:none;margin-top:12px;font-size:12px}}
    .btn{{display:none;margin-top:14px;padding:8px 16px;border-radius:8px;border:1px solid #3f3f46;background:#27272a;color:#f4f4f5;cursor:pointer;font-size:13px}}
  </style>
</head>
<body>
  <div class="card">
    <div class="spin" id="spinner"></div>
    <h2>正在唤醒休眠工作区</h2>
    <p>工作区 <code>/s/{safe_slug}/</code> 当前处于休眠状态，正在自动启动容器并等待服务就绪...</p>
    <p id="err" class="err"></p>
    <button id="retry" class="btn" onclick="wake()">重试唤醒</button>
  </div>
  <script>
    const slug = {js_slug};
    const target = {js_target};
    async function wake() {{
      const errEl = document.getElementById('err');
      const retryEl = document.getElementById('retry');
      const spinEl = document.getElementById('spinner');
      errEl.style.display = 'none';
      retryEl.style.display = 'none';
      spinEl.style.display = 'block';
      try {{
        const res = await fetch('/api/wake/' + encodeURIComponent(slug), {{ method: 'POST', credentials: 'same-origin' }});
        const data = await res.json().catch(() => ({{}}));
        if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status));
        window.location.replace(target);
      }} catch (e) {{
        spinEl.style.display = 'none';
        errEl.textContent = '唤醒失败: ' + (e && e.message ? e.message : String(e));
        errEl.style.display = 'block';
        retryEl.style.display = 'inline-block';
      }}
    }}
    wake();
  </script>
</body>
</html>"""


def json_dumps_safe(val: str) -> str:
    import json
    return json.dumps(val).replace("<", "\\u003c")


def _user_out(user: User, sandbox_count: int = 0) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        status=user.status,
        has_password=bool(user.password_hash),
        sandbox_count=sandbox_count,
        created_at=user.created_at,
    )


def _ensure_active_user(db: Session, email: str) -> User | None:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user and user.status != "active":
        raise HTTPException(
            status_code=403,
            detail="该账号已被管理员禁用，请联系平台管理员",
        )
    return user


def _manager_error(exc: Exception) -> HTTPException:
    if isinstance(exc, NotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, Conflict):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, SandboxRuntimeError):
        return HTTPException(status_code=502, detail=str(exc))
    if isinstance(exc, ManagerError):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@app.get("/healthz", response_model=HealthOut)
def healthz(db: Session = Depends(get_db)):
    db_ok = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        db_ok = f"error: {exc}"

    docker_ok = "ok"
    try:
        get_docker().client.ping()
    except Exception as exc:
        docker_ok = f"error: {exc}"

    if db_ok != "ok" or docker_ok != "ok":
        raise HTTPException(
            status_code=503,
            detail={"database": db_ok, "docker": docker_ok},
        )
    return HealthOut(status="ok", database=db_ok, docker=docker_ok)


# ---------------------------------------------------------------------------
# Self-hosted Plugin Discover Index & Built-in Read-Only NPM Registry
# ---------------------------------------------------------------------------


@app.get("/plugins/index.json")
def plugin_discover_index():
    base_url = settings.manager_base_url
    doc = get_plugin_registry().build_index(base_url)
    return JSONResponse(
        content=doc,
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/plugins/icons/{icon_name}")
def plugin_icon(icon_name: str):
    icon_path = get_plugin_registry().resolve_icon(icon_name)
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


@app.get("/plugins/packages/{tarball_name}")
def plugin_tarball(tarball_name: str):
    pkg = get_plugin_registry().get_by_slug_or_filename(tarball_name)
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


@app.get("/plugins/npm/{package_name:path}")
def plugin_npm_packument(package_name: str):
    pkg = get_plugin_registry().get_by_package_name(package_name)
    if not pkg:
        return RedirectResponse(
            url=f"https://registry.npmmirror.com/{package_name}",
            status_code=307,
        )
    packument = get_plugin_registry().build_npm_packument(
        pkg, settings.sandbox_reachable_manager_url
    )
    return JSONResponse(
        content=packument,
        headers={"Cache-Control": "no-cache"},
    )


# ---------------------------------------------------------------------------
# Authentication & Sessions
# ---------------------------------------------------------------------------


def _bearer_is_admin(request: Request) -> bool:
    if not settings.manager_admin_token:
        return False
    auth_header = request.headers.get("authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        return False
    provided = auth_header[7:].strip()
    return hmac.compare_digest(provided, settings.manager_admin_token)


def session_email(request: Request) -> str:
    if settings.manager_auth_mode == "none":
        email = settings.manager_admin_email.lower()
        request.session["email"] = email
        return email
    return str(request.session.get("email") or "").lower()


def _is_authenticated_admin(request: Request, db: Session) -> bool:
    if _bearer_is_admin(request):
        return True
    email = session_email(request)
    if not email or not is_platform_admin(db, email):
        return False
    if settings.manager_auth_mode == "none":
        return True
    return request.session.get("role") == "admin"


def require_admin_api(
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    if _is_authenticated_admin(request, db):
        return
    email = session_email(request)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录管理员账号",
        )
    raise HTTPException(status_code=403, detail="当前账号无管理员权限")


def require_user_api(request: Request) -> str:
    email = session_email(request)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录",
        )
    return email


def safe_next(value: str | None) -> str:
    if value and value.startswith("/") and not value.startswith("//"):
        return value
    return "/admin"


class LoginPayload(BaseModel):
    email: str
    token: str | None = None
    password: str | None = None
    mode: str = "admin"


def _resolve_display_name(
    db: Session,
    email: str | None,
    *,
    session_name: str | None = None,
    user_row: User | None = None,
) -> str | None:
    if email:
        user = user_row or db.scalar(select(User).where(User.email == email))
        if user and user.display_name:
            return user.display_name
        admin_row = db.scalar(
            select(PlatformAdmin).where(PlatformAdmin.email == email)
        )
        if admin_row and admin_row.display_name:
            return admin_row.display_name
    cleaned_session_name = (session_name or "").strip()
    if cleaned_session_name and (
        not email or cleaned_session_name.lower() != email.lower()
    ):
        return cleaned_session_name
    return None


@app.get("/api/auth/me")
@app.get("/auth/me", include_in_schema=False)
def auth_me(
    request: Request,
    response: Response,
    slug: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    email = session_email(request)
    admin = _is_authenticated_admin(request, db)
    user_row = (
        db.scalar(select(User).where(User.email == email))
        if email
        else None
    )
    session_name = request.session.get("name")
    display_name = _resolve_display_name(
        db,
        email,
        session_name=session_name if isinstance(session_name, str) else None,
        user_row=user_row,
    )
    sandbox_info = None
    if slug and (email or admin):
        try:
            sandbox = load_sandbox_by_slug(db, slug)
        except NotFoundError:
            sandbox = None
        if sandbox is not None:
            owner_email = sandbox.user.email.lower()
            if admin or email == owner_email:
                sandbox_info = {
                    "slug": sandbox.slug,
                    "owner_email": owner_email,
                    "owner_display_name": _resolve_display_name(
                        db,
                        owner_email,
                        session_name=(
                            session_name
                            if isinstance(session_name, str) and email == owner_email
                            else None
                        ),
                        user_row=sandbox.user,
                    ),
                }
    enabled_providers = list_oidc_providers(db, enabled_only=True)
    allow_local_user = get_allow_local_user_login(db, settings)
    auth_method = request.session.get("auth_method")
    if not auth_method:
        if settings.manager_auth_mode == "none":
            auth_method = "none"
        elif email:
            auth_method = "local"
    return {
        "authenticated": bool(email),
        "email": email,
        "display_name": display_name,
        "admin": admin,
        "user_status": user_row.status if user_row else "active",
        "has_password": bool(user_row and user_row.password_hash),
        "auth_mode": settings.manager_auth_mode,
        "auth_method": auth_method,
        "oidc_provider_slug": request.session.get("oidc_provider_slug"),
        "oidc_provider_name": request.session.get("oidc_provider_name"),
        "allow_local_user_login": allow_local_user,
        "admin_token_configured": bool(settings.manager_admin_token),
        "oidc_providers": [
            {
                "slug": p.slug,
                "name": p.name,
                "login_url": f"/auth/oidc/{p.slug}/start",
            }
            for p in enabled_providers
        ],
        "default_admin_email": settings.manager_admin_email,
        "public_url": settings.manager_base_url,
        "plugin_index_url": settings.plugin_index_url,
        "sandbox": sandbox_info,
    }


@app.get("/api/auth/verify-sandbox/{slug}", include_in_schema=False)
def verify_sandbox_access(
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Traefik ForwardAuth endpoint: enforce that only the workspace owner or platform admin can access /s/<slug>."""
    try:
        sandbox = load_sandbox_by_slug(db, slug)
    except NotFoundError:
        raise HTTPException(status_code=404, detail=f"工作区 /s/{slug} 不存在")

    email = session_email(request)
    is_admin = _is_authenticated_admin(request, db)
    accept = (request.headers.get("accept") or "").lower()
    wants_html = "text/html" in accept

    if not email and not is_admin:
        if wants_html:
            safe_slug = html_lib.escape(slug)
            login_href = f"/login?next={quote(f'/s/{slug}/', safe='/')}"
            html = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>需要登录 - DSH Sandbox Cloud</title>
<style>body{{margin:0;background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}}
.card{{max-width:420px;padding:28px;border-radius:14px;background:#18181b;border:1px solid #27272a;box-shadow:0 20px 40px rgba(0,0,0,.5)}}
h2{{margin:0 0 10px;font-size:18px}}p{{margin:0 0 20px;font-size:13px;color:#a1a1aa;line-height:1.6}}
a.btn{{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:500}}</style></head>
<body><div class="card"><h2>请先登录工作区平台</h2>
<p>访问工作区 <code>/s/{safe_slug}/</code> 需要验证您的身份，仅工作区归属人本人或平台管理员可进入。</p>
<a class="btn" href="{login_href}">前往登录</a></div></body></html>"""
            return HTMLResponse(content=html, status_code=401)
        raise HTTPException(status_code=401, detail="请先登录平台后再访问工作区")

    owner_email = sandbox.user.email.lower()
    if not is_admin and email != owner_email:
        if wants_html:
            html = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>403 禁止访问 - DSH Sandbox Cloud</title>
<style>body{{margin:0;background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}}
.card{{max-width:440px;padding:28px;border-radius:14px;background:#18181b;border:1px solid #3f3f46;box-shadow:0 20px 40px rgba(0,0,0,.5)}}
h2{{margin:0 0 10px;font-size:18px;color:#fb7185}}p{{margin:0 0 20px;font-size:13px;color:#a1a1aa;line-height:1.6}}
code{{background:#27272a;padding:2px 6px;border-radius:4px;color:#e4e4e7}}
a.btn{{display:inline-block;background:#27272a;color:#f4f4f5;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:500;border:1px solid #3f3f46}}</style></head>
<body><div class="card"><h2>403 禁止访问他人工作区</h2>
<p>工作区 <code>/s/{slug}/</code> 归属于 <code>{owner_email}</code>。<br>当前登录账号 <code>{email}</code> 无权访问（仅归属人本人或平台管理员可访问）。</p>
<a class="btn" href="/my">返回我的工作区</a></div></body></html>"""
            return HTMLResponse(content=html, status_code=403)
        raise HTTPException(
            status_code=403,
            detail=f"禁止访问：工作区 /s/{slug} 仅归属人 ({owner_email}) 或管理员可访问",
        )

    if not is_admin and sandbox.user.status != "active":
        if wants_html:
            html = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>403 账号已禁用 - DSH Sandbox Cloud</title>
<style>body{{margin:0;background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}}
.card{{max-width:440px;padding:28px;border-radius:14px;background:#18181b;border:1px solid #3f3f46;box-shadow:0 20px 40px rgba(0,0,0,.5)}}
h2{{margin:0 0 10px;font-size:18px;color:#fb7185}}p{{margin:0 0 20px;font-size:13px;color:#a1a1aa;line-height:1.6}}
code{{background:#27272a;padding:2px 6px;border-radius:4px;color:#e4e4e7}}
a.btn{{display:inline-block;background:#27272a;color:#f4f4f5;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:500;border:1px solid #3f3f46}}</style></head>
<body><div class="card"><h2>403 账号已被禁用</h2>
<p>账号 <code>{email}</code> 已被平台管理员禁用，暂时无法访问工作区 <code>/s/{slug}/</code>。</p>
<a class="btn" href="/login">返回登录页</a></div></body></html>"""
            return HTMLResponse(content=html, status_code=403)
        raise HTTPException(
            status_code=403,
            detail=f"禁止访问：账号 {email} 已被管理员禁用",
        )

    effective_user = email or settings.manager_admin_email.lower()
    session_name = request.session.get("name")
    session_name_str = session_name if isinstance(session_name, str) else None
    owner_name = _resolve_display_name(
        db,
        owner_email,
        session_name=session_name_str if effective_user == owner_email else None,
        user_row=sandbox.user,
    )
    if effective_user == owner_email:
        viewer_name = owner_name
    else:
        viewer_name = _resolve_display_name(
            db,
            effective_user,
            session_name=session_name_str,
        )
    touch_sandbox_activity(db, sandbox)
    return Response(
        status_code=200,
        headers={
            "X-Auth-Request-Email": effective_user,
            "X-Forwarded-User": effective_user,
            "X-Sandbox-Owner": owner_email,
            "X-Auth-Request-Name": quote(viewer_name or "", safe=""),
            "X-Auth-Request-Admin": "true" if is_admin else "false",
            "X-Sandbox-Owner-Name": quote(owner_name or "", safe=""),
        },
    )


@app.post("/api/auth/login")
def api_auth_login(
    payload: LoginPayload,
    request: Request,
    db: Session = Depends(get_db),
):
    clean_email = payload.email.strip().lower()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=400, detail="请输入有效的邮箱地址")

    if settings.manager_auth_mode == "none":
        is_admin = is_platform_admin(db, clean_email)
        request.session["email"] = clean_email
        request.session["role"] = "admin" if is_admin else "user"
        request.session["auth_method"] = "none"
        request.session.pop("oidc_provider_slug", None)
        request.session.pop("oidc_provider_name", None)
        return {
            "authenticated": True,
            "email": clean_email,
            "admin": is_admin,
        }

    if payload.mode == "user":
        if not get_allow_local_user_login(db, settings):
            raise HTTPException(
                status_code=403,
                detail="当前已禁用普通用户本地密码登录，请通过 OIDC 单点登录",
            )
        if is_platform_admin(db, clean_email):
            raise HTTPException(
                status_code=401,
                detail="管理员账号请切换至“管理员控制台”并输入 Admin Token 登录",
            )
        user = db.scalar(select(User).where(User.email == clean_email))
        secret = (
            payload.password if payload.password is not None else payload.token
        ) or ""
        if not user:
            raise HTTPException(status_code=401, detail="邮箱或密码错误")
        if user.status != "active":
            raise HTTPException(
                status_code=403, detail="该账号已被管理员禁用，请联系平台管理员"
            )
        if not user.password_hash:
            raise HTTPException(
                status_code=401,
                detail="该账号尚未设置登录密码，请联系管理员设置初始密码",
            )
        if not verify_password(secret, user.password_hash):
            raise HTTPException(status_code=401, detail="邮箱或密码错误")
        request.session["email"] = clean_email
        request.session["role"] = "user"
        request.session["auth_method"] = "local"
        request.session.pop("oidc_provider_slug", None)
        request.session.pop("oidc_provider_name", None)
        return {
            "authenticated": True,
            "email": clean_email,
            "admin": False,
        }

    if not settings.manager_admin_token:
        raise HTTPException(
            status_code=400,
            detail="未配置管理员口令 (MANAGER_ADMIN_TOKEN)，请通过 OIDC 登录",
        )
    if not payload.token or not hmac.compare_digest(
        payload.token.strip(), settings.manager_admin_token
    ):
        raise HTTPException(status_code=401, detail="管理员口令 (Admin Token) 错误")
    if not is_platform_admin(db, clean_email):
        raise HTTPException(
            status_code=403, detail=f"邮箱 {clean_email} 不是平台管理员"
        )
    request.session["email"] = clean_email
    request.session["role"] = "admin"
    request.session["auth_method"] = "local"
    request.session.pop("oidc_provider_slug", None)
    request.session.pop("oidc_provider_name", None)
    return {
        "authenticated": True,
        "email": clean_email,
        "admin": True,
    }


def _set_auth_cookie(response: Response, key: str, value: str) -> None:
    response.set_cookie(
        key,
        value,
        httponly=True,
        samesite="lax",
        secure=settings.manager_base_url.startswith("https"),
        path="/",
    )


def _delete_auth_cookie(response: Response, key: str) -> None:
    response.delete_cookie(
        key,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.manager_base_url.startswith("https"),
    )


def _resolve_default_oidc_provider(
    db: Session, slug: str | None = None
) -> OidcProvider | None:
    if slug:
        return get_oidc_provider_by_slug(db, slug, enabled_only=True)
    default_provider = get_oidc_provider_by_slug(db, "default", enabled_only=True)
    if default_provider is not None:
        return default_provider
    enabled = list_oidc_providers(db, enabled_only=True)
    if len(enabled) == 1:
        return enabled[0]
    return None


async def _start_oidc_login(
    request: Request, provider: OidcProvider, redirect_uri: str
) -> Response:
    next_url = safe_next(request.query_params.get("next", "/admin"))
    request.session["next"] = next_url
    request.session["oidc_login_provider"] = provider.slug
    try:
        client = oidc_registry.get_client(provider)
    except Exception as exc:
        logger.warning("Failed to initialize OIDC client (%s): %s", provider.slug, exc)
        return RedirectResponse("/login?error=oidc_failed", status_code=303)

    prompt_cookie = request.cookies.get(OIDC_PROMPT_LOGIN_COOKIE)
    if prompt_cookie in {"1", provider.slug}:
        resp = await client.authorize_redirect(request, redirect_uri, prompt="login")
        _delete_auth_cookie(resp, OIDC_PROMPT_LOGIN_COOKIE)
        return resp
    return await client.authorize_redirect(request, redirect_uri)


async def _complete_oidc_callback(
    request: Request, db: Session, provider: OidcProvider
) -> Response:
    try:
        client = oidc_registry.get_client(provider)
        token = await client.authorize_access_token(request)
    except (OAuthError, Exception) as exc:
        logger.warning("OIDC callback failed for provider '%s': %s", provider.slug, exc)
        request.session.pop("oidc_login_provider", None)
        return RedirectResponse("/login?error=oidc_failed", status_code=303)

    userinfo = token.get("userinfo") if isinstance(token, dict) else None
    if not isinstance(userinfo, dict):
        userinfo = {}
    claim = (provider.email_claim or "email").strip() or "email"
    email = userinfo.get(claim) or userinfo.get("email")

    if not email and isinstance(token, dict) and token.get("id_token") and hasattr(client, "parse_id_token"):
        try:
            parsed = await client.parse_id_token(token, nonce=None)
        except TypeError:
            parsed = await client.parse_id_token(request, token)
        except Exception as exc:
            logger.warning("OIDC parse_id_token failed (%s): %s", provider.slug, exc)
            parsed = None
        if isinstance(parsed, dict):
            userinfo = {**userinfo, **parsed}
            email = userinfo.get(claim) or userinfo.get("email")

    if not email and isinstance(token, dict) and token.get("access_token") and hasattr(client, "userinfo"):
        try:
            fetched = await client.userinfo(token=token)
            if isinstance(fetched, dict):
                userinfo = {**userinfo, **fetched}
                email = userinfo.get(claim) or userinfo.get("email")
        except Exception as exc:
            logger.warning("OIDC userinfo fetch failed (%s): %s", provider.slug, exc)

    email = str(email or "").strip().lower()
    if not email or "@" not in email:
        request.session.clear()
        resp = RedirectResponse("/login?error=oidc_no_email", status_code=303)
        _delete_auth_cookie(resp, OIDC_ID_TOKEN_COOKIE)
        return resp

    if not is_email_domain_allowed(email, provider.allowed_domains):
        request.session.clear()
        audit(
            db,
            "auth.oidc_denied",
            target=email,
            detail=f"provider={provider.slug},reason=domain_not_allowed",
        )
        db.commit()
        resp = RedirectResponse("/login?error=domain_not_allowed", status_code=303)
        _delete_auth_cookie(resp, OIDC_ID_TOKEN_COOKIE)
        return resp

    is_admin_email = is_platform_admin(db, email)
    granted_admin = is_admin_email and bool(provider.allow_admin_login)

    if not granted_admin:
        existing_user = db.scalar(select(User).where(User.email == email))
        if existing_user and existing_user.status != "active":
            request.session.clear()
            resp = RedirectResponse("/login?error=disabled", status_code=303)
            _delete_auth_cookie(resp, OIDC_ID_TOKEN_COOKIE)
            return resp

    request.session["email"] = email
    request.session["name"] = userinfo.get("name") or email
    request.session["role"] = "admin" if granted_admin else "user"
    request.session["auth_method"] = "oidc"
    request.session["oidc_provider_slug"] = provider.slug
    request.session["oidc_provider_name"] = provider.name
    request.session.pop("oidc_login_provider", None)

    next_url = safe_next(request.session.pop("next", "/admin"))
    if granted_admin:
        target = next_url
    elif next_url.startswith(("/my", "/s/")):
        target = next_url
    else:
        target = "/my"

    resp = RedirectResponse(target, status_code=303)
    _delete_auth_cookie(resp, OIDC_PROMPT_LOGIN_COOKIE)
    id_token = token.get("id_token") if isinstance(token, dict) else None
    if isinstance(id_token, str) and id_token:
        _set_auth_cookie(resp, OIDC_ID_TOKEN_COOKIE, id_token)
    return resp


async def _perform_logout(
    request: Request, response: Response, db: Session
) -> str | None:
    auth_method = request.session.get("auth_method")
    provider_slug = request.session.get("oidc_provider_slug")
    id_token = request.cookies.get(OIDC_ID_TOKEN_COOKIE)
    had_session_data = bool(request.session)
    request.session.clear()
    if SESSION_COOKIE_NAME in request.cookies and not had_session_data:
        _delete_auth_cookie(response, SESSION_COOKIE_NAME)
    _delete_auth_cookie(response, OIDC_ID_TOKEN_COOKIE)

    logout_url: str | None = None
    if auth_method == "oidc" and isinstance(provider_slug, str) and provider_slug:
        provider = get_oidc_provider_by_slug(db, provider_slug)
        if provider is not None:
            client = None
            try:
                client = oidc_registry.get_client(provider)
            except Exception as exc:
                logger.warning(
                    "Failed to build OIDC client for logout (%s): %s",
                    provider.slug,
                    exc,
                )
            logout_url = await build_provider_logout_url(
                provider,
                client,
                settings.manager_base_url,
                id_token=id_token,
            )
            if not logout_url:
                _set_auth_cookie(response, OIDC_PROMPT_LOGIN_COOKIE, provider.slug)
            else:
                _delete_auth_cookie(response, OIDC_PROMPT_LOGIN_COOKIE)
        else:
            _delete_auth_cookie(response, OIDC_PROMPT_LOGIN_COOKIE)
    else:
        _delete_auth_cookie(response, OIDC_PROMPT_LOGIN_COOKIE)
    return logout_url


@app.post("/api/auth/logout")
async def api_auth_logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    logout_url = await _perform_logout(request, response, db)
    return {"ok": True, "logout_url": logout_url}


@app.get("/auth/oidc/start", include_in_schema=False)
async def auth_oidc_start(
    request: Request,
    provider: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    resolved = _resolve_default_oidc_provider(db, provider)
    if resolved is None:
        return RedirectResponse("/login?error=oidc_provider_disabled", status_code=303)
    redirect_uri = (
        f"{settings.manager_base_url}/auth/oidc/{resolved.slug}/callback"
        if provider
        else f"{settings.manager_base_url}/auth/callback"
    )
    return await _start_oidc_login(request, resolved, redirect_uri)


@app.get("/auth/oidc/{slug}/start", include_in_schema=False)
async def auth_oidc_provider_start(
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    provider = get_oidc_provider_by_slug(db, slug, enabled_only=True)
    if provider is None:
        return RedirectResponse("/login?error=oidc_provider_disabled", status_code=303)
    redirect_uri = f"{settings.manager_base_url}/auth/oidc/{provider.slug}/callback"
    return await _start_oidc_login(request, provider, redirect_uri)


@app.get("/auth/oidc/{slug}/callback", include_in_schema=False)
async def auth_oidc_provider_callback(
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    provider = get_oidc_provider_by_slug(db, slug, enabled_only=True)
    if provider is None:
        return RedirectResponse("/login?error=oidc_provider_disabled", status_code=303)
    return await _complete_oidc_callback(request, db, provider)


@app.get("/auth/callback", include_in_schema=False)
async def auth_callback(request: Request, db: Session = Depends(get_db)):
    session_slug = request.session.get("oidc_login_provider")
    provider = _resolve_default_oidc_provider(
        db, session_slug if isinstance(session_slug, str) else None
    )
    if provider is None:
        return RedirectResponse("/login?error=oidc_provider_disabled", status_code=303)
    return await _complete_oidc_callback(request, db, provider)


@app.get("/auth/logout", include_in_schema=False)
async def auth_logout(request: Request, db: Session = Depends(get_db)):
    # RedirectResponse is created after _perform_logout determines target; apply cookies onto it.
    temp_resp = Response()
    logout_url = await _perform_logout(request, temp_resp, db)
    resp = RedirectResponse(logout_url or "/login", status_code=303)
    for k, v in temp_resp.raw_headers:
        if k.lower() == b"set-cookie":
            resp.raw_headers.append((k, v))
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------------------------------------------------------------------------
# Direct Sandbox Open & Workspace Backup
# ---------------------------------------------------------------------------


@app.get("/sandboxes/{sandbox_id}/open", include_in_schema=False)
def open_sandbox_with_token(
    sandbox_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    sandbox = load_sandbox(db, sandbox_id)
    auth_resp = verify_sandbox_access(sandbox.slug, request, db)
    if auth_resp.status_code != 200:
        return auth_resp
    if get_docker().status(sandbox) != "running":
        return HTMLResponse(
            _render_wake_html(sandbox.slug, f"/sandboxes/{sandbox.id}/open")
        )
    base = settings.sandbox_url(sandbox.slug).rstrip("/")
    raw_launch = get_docker().launch_token_url(sandbox)
    if raw_launch:
        parsed = urlsplit(raw_launch)
        if parsed.query:
            return RedirectResponse(f"{base}/dsh/?{parsed.query}", status_code=302)
    return RedirectResponse(f"{base}/", status_code=302)


@app.post("/api/wake/{slug}")
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


def _require_sandbox_owner_or_admin(
    sandbox: Sandbox,
    request: Request,
    db: Session,
    forbidden_detail: str,
) -> str:
    email = session_email(request)
    if _is_authenticated_admin(request, db):
        return email or settings.manager_admin_email.lower()
    if not email:
        raise HTTPException(status_code=401, detail="请先登录")
    if sandbox.user.email.lower() != email:
        raise HTTPException(status_code=403, detail=forbidden_detail)
    if sandbox.user.status != "active":
        raise HTTPException(status_code=403, detail="该账号已被管理员禁用")
    return email


@app.get("/api/sandboxes/{sandbox_id}/backup")
@app.get("/sandboxes/{sandbox_id}/backup", include_in_schema=False)
def backup_sandbox_workspace(
    sandbox_id: str,
    request: Request,
    exclude_caches: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    sandbox = load_sandbox(db, sandbox_id)
    _require_sandbox_owner_or_admin(sandbox, request, db, "无权备份他人的工作区")
    try:
        stream = get_docker().export_workspace_tar(
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


@app.post("/api/sandboxes/{sandbox_id}/restore")
@app.post("/api/my/sandboxes/{sandbox_id}/restore")
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
            result = get_docker().restore_workspace_tar(sandbox, tmp, mode=mode)
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


@app.get("/api/my/sandboxes", response_model=SandboxList)
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
    target_email = (email or sess_email or "").strip().lower()
    if not is_admin:
        target_email = sess_email
        _ensure_active_user(db, sess_email)
    if not target_email:
        return SandboxList(items=[])
    sandboxes = list(
        db.scalars(
            select(Sandbox)
            .join(Sandbox.user)
            .options(joinedload(Sandbox.user), joinedload(Sandbox.llm_profile))
            .where(Sandbox.deleted_at.is_(None), User.email == target_email)
            .order_by(Sandbox.created_at)
        ).all()
    )
    if refresh:
        docker = get_docker()
        for sandbox in sandboxes:
            refresh_status(db, docker, sandbox)
    return SandboxList(items=[sandbox_out(s) for s in sandboxes])


@app.post("/api/my/password")
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


@app.post("/api/my/sandboxes/{sandbox_id}/{action}", response_model=SandboxOut)
def api_my_sandbox_action(
    sandbox_id: str,
    action: str,
    request: Request,
    db: Session = Depends(get_db),
):
    email = require_user_api(request)
    sandbox = load_sandbox(db, sandbox_id)
    if not _is_authenticated_admin(request, db):
        if sandbox.user.email.lower() != email:
            raise HTTPException(status_code=403, detail="无权操作他人的工作区")
        if sandbox.user.status != "active":
            raise HTTPException(status_code=403, detail="该账号已被管理员禁用")
    handlers = {
        "start": lambda: start_sandbox(db, get_docker(), sandbox_id),
        "stop": lambda: stop_sandbox(db, get_docker(), sandbox_id),
        "restart": lambda: restart_sandbox(db, get_docker(), sandbox_id),
    }
    if action not in handlers:
        raise HTTPException(status_code=404, detail="未知操作")
    try:
        updated = handlers[action]()
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(updated)


# ---------------------------------------------------------------------------
# Platform Overview & Self-Hosted Plugins API
# ---------------------------------------------------------------------------


@app.get("/api/overview")
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
    plugins = get_plugin_registry().list_packages()
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
        "plugin_index_url": settings.plugin_index_url,
        "idle_sleep_enabled": idle_enabled,
        "idle_sleep_minutes": idle_minutes,
        "local_images": get_docker().list_local_images(),
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


@app.get("/api/plugins")
def api_plugins(
    _: None = Depends(require_admin_api),
):
    base_url = settings.manager_base_url
    packages = get_plugin_registry().list_packages()
    index_doc = get_plugin_registry().build_index(base_url)
    index_by_name = {
        entry.get("name"): entry for entry in index_doc.get("plugins", [])
    }
    items = []
    for pkg in packages:
        entry = index_by_name.get(pkg.name) or {}
        title_obj = entry.get("title") or {}
        desc_obj = entry.get("description") or {}
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
                "author": entry.get("author") or "DSH Sandbox Platform",
                "category": (entry.get("categories") or ["utility"])[0],
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
        "items": items,
    }


@app.post("/api/plugins/sync-sandboxes")
def api_sync_plugins_to_sandboxes(
    request: Request,
    payload: PluginSyncRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    req = payload or PluginSyncRequest()
    query = select(Sandbox).where(Sandbox.deleted_at.is_(None))
    if req.sandbox_ids:
        query = query.where(Sandbox.id.in_(req.sandbox_ids))
    sandboxes = list(db.scalars(query).all())

    reinstall_plugins = (
        req.plugins if req.mode == "reinstall_selected" and req.plugins else None
    )
    force_reinstall = req.mode == "reinstall_builtin"

    results = []
    for sbx in sandboxes:
        try:
            res = get_docker().sync_plugin_market(
                sbx,
                reinstall_plugins=reinstall_plugins,
                force_reinstall=force_reinstall,
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


@app.get("/api/policies/idle-sleep", response_model=IdleSleepPolicyOut)
def api_get_idle_sleep_policy(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    enabled, idle_minutes = get_idle_sleep_policy(db, settings)
    return IdleSleepPolicyOut(enabled=enabled, idle_minutes=idle_minutes)


@app.put("/api/policies/idle-sleep", response_model=IdleSleepPolicyOut)
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


# ---------------------------------------------------------------------------
# Auth Policy & Multi-OIDC Providers CRUD API
# ---------------------------------------------------------------------------


@app.get("/api/auth/policy", response_model=AuthPolicyOut)
def api_get_auth_policy(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return AuthPolicyOut(
        allow_local_user_login=get_allow_local_user_login(db, settings),
        admin_token_configured=bool(settings.manager_admin_token),
        auth_mode=settings.manager_auth_mode,
    )


@app.put("/api/auth/policy", response_model=AuthPolicyOut)
def api_update_auth_policy(
    payload: AuthPolicyUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    allow = set_allow_local_user_login(
        db,
        allow=payload.allow_local_user_login,
        actor=session_email(request) or settings.manager_admin_email,
    )
    return AuthPolicyOut(
        allow_local_user_login=allow,
        admin_token_configured=bool(settings.manager_admin_token),
        auth_mode=settings.manager_auth_mode,
    )


@app.get("/api/oidc-providers", response_model=list[OidcProviderOut])
def api_list_oidc_providers(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return [oidc_provider_out(p) for p in list_oidc_providers(db)]


@app.post("/api/oidc-providers", response_model=OidcProviderOut, status_code=201)
def api_create_oidc_provider(
    payload: OidcProviderCreate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        provider = create_oidc_provider(
            db,
            payload,
            actor=session_email(request) or settings.manager_admin_email,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc
    oidc_registry.invalidate(provider.slug)
    return oidc_provider_out(provider)


@app.patch("/api/oidc-providers/{provider_id}", response_model=OidcProviderOut)
def api_update_oidc_provider(
    provider_id: str,
    payload: OidcProviderUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    provider = db.get(OidcProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="OIDC 提供方不存在")
    try:
        updated = update_oidc_provider(
            db,
            provider,
            payload,
            actor=session_email(request) or settings.manager_admin_email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _manager_error(exc) from exc
    oidc_registry.invalidate(updated.slug)
    return oidc_provider_out(updated)


@app.delete("/api/oidc-providers/{provider_id}")
def api_delete_oidc_provider(
    provider_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    provider = db.get(OidcProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="OIDC 提供方不存在")
    slug = provider.slug
    delete_oidc_provider(
        db,
        provider,
        actor=session_email(request) or settings.manager_admin_email,
    )
    oidc_registry.invalidate(slug)
    return {"ok": True}


@app.post("/api/oidc-providers/test", response_model=OidcProviderTestOut)
async def api_test_oidc_provider(
    payload: OidcProviderTestRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    issuer_url = payload.issuer_url
    discovery_url = payload.discovery_url
    if payload.provider_id:
        provider = db.get(OidcProvider, payload.provider_id)
        if not provider:
            raise HTTPException(status_code=404, detail="OIDC 提供方不存在")
        if issuer_url is None:
            issuer_url = provider.issuer_url
        if discovery_url is None:
            discovery_url = provider.discovery_url
    result = await probe_oidc_discovery(issuer_url, discovery_url)
    return OidcProviderTestOut(**result)


# ---------------------------------------------------------------------------
# Templates CRUD API (/api/templates)
# ---------------------------------------------------------------------------


@app.get("/api/templates", response_model=list[TemplateOut])
def api_list_templates(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return list_templates(db)


@app.post("/api/templates", response_model=TemplateOut, status_code=201)
def api_create_template(
    payload: TemplateCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        return create_template(db, payload)
    except Exception as exc:
        raise _manager_error(exc) from exc


@app.put("/api/templates/{template_id}", response_model=TemplateOut)
def api_update_template(
    template_id: str,
    payload: TemplateUpdate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        return update_template(db, template_id, payload)
    except Exception as exc:
        raise _manager_error(exc) from exc


@app.delete("/api/templates/{template_id}")
def api_delete_template(
    template_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        delete_template(db, template_id)
        return {"ok": True}
    except Exception as exc:
        raise _manager_error(exc) from exc


# ---------------------------------------------------------------------------
# Users & Admins API
# ---------------------------------------------------------------------------


@app.post("/api/users", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="该邮箱用户已存在")
    pw_hash = hash_password(payload.password) if payload.password else None
    user = User(
        email=email,
        display_name=payload.display_name,
        password_hash=pw_hash,
        role=payload.role,
    )
    db.add(user)
    try:
        db.flush()
        audit(
            db,
            "user.create",
            target=email,
            detail=f"has_password={bool(pw_hash)}",
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该邮箱用户已存在") from exc
    db.refresh(user)
    return _user_out(user, 0)


@app.get("/api/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    users = list(db.scalars(select(User).order_by(User.email)).all())
    counts_rows = db.execute(
        select(Sandbox.user_id, func.count(Sandbox.id))
        .where(Sandbox.deleted_at.is_(None))
        .group_by(Sandbox.user_id)
    ).all()
    counts = {row[0]: int(row[1]) for row in counts_rows}
    return [_user_out(u, counts.get(u.id, 0)) for u in users]


@app.patch("/api/users/{user_id}", response_model=UserOut)
def update_user_endpoint(
    user_id: str,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    changes: list[str] = []
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip() or None
        changes.append("display_name")
    if payload.status is not None and payload.status != user.status:
        user.status = payload.status
        changes.append(f"status={payload.status}")
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
        changes.append("password_reset")
    if changes:
        audit(db, "user.update", target=user.email, detail=",".join(changes))
    db.commit()
    db.refresh(user)
    cnt = db.scalar(
        select(func.count(Sandbox.id)).where(
            Sandbox.user_id == user.id, Sandbox.deleted_at.is_(None)
        )
    )
    return _user_out(user, int(cnt or 0))


@app.delete("/api/users/{user_id}")
def delete_user_endpoint(
    user_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    active_sbx = db.scalar(
        select(Sandbox).where(
            Sandbox.user_id == user_id, Sandbox.deleted_at.is_(None)
        )
    )
    if active_sbx:
        raise HTTPException(
            status_code=409,
            detail=f"该用户仍有运行中的沙箱 ({active_sbx.slug})，请先删除沙箱",
        )
    # Remove soft-deleted sandbox tombstones before deleting the user row.
    for old_sbx in db.scalars(
        select(Sandbox).where(Sandbox.user_id == user_id, Sandbox.deleted_at.is_not(None))
    ).all():
        db.delete(old_sbx)
    audit(db, "user.delete", target=user.email)
    db.delete(user)
    db.commit()
    return {"ok": True}


@app.get("/api/admins", response_model=list[AdminOut])
def list_admins(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return list_platform_admins(db)


@app.post("/api/admins", response_model=AdminOut, status_code=201)
def add_admin(
    payload: AdminCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return add_platform_admin(
        db, str(payload.email), payload.display_name
    )


@app.delete("/api/admins/{email}", response_model=AdminOut)
def remove_admin(
    email: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    if email.lower() == session_email(request):
        raise HTTPException(status_code=400, detail="不能停用当前登录的管理员账号")
    try:
        return deactivate_platform_admin(db, email)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# LLM profiles
# ---------------------------------------------------------------------------


@app.post("/api/llm-profiles", response_model=LlmProfileOut, status_code=201)
def create_profile(
    payload: LlmProfileCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    raw_key = payload.api_key.strip()
    profile = create_llm_profile(
        db,
        name=payload.name,
        base_url=payload.base_url,
        model=payload.model,
        ciphertext=encrypt_secret(raw_key) if raw_key else "",
        api_protocol=payload.api_protocol,
        context_window=payload.context_window,
        max_tokens=payload.max_tokens,
        supports_image=payload.supports_image,
        reasoning_effort=payload.reasoning_effort,
        thinking_format=payload.thinking_format,
    )
    return profile


@app.patch("/api/llm-profiles/{profile_id}", response_model=LlmProfileOut)
def patch_profile(
    profile_id: str,
    payload: LlmProfileUpdate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    profile = db.get(LlmProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="LLM 配置不存在")
    raw_key = payload.api_key.strip() if isinstance(payload.api_key, str) else None
    ciphertext = encrypt_secret(raw_key) if raw_key else None
    return update_llm_profile(
        db,
        profile,
        name=payload.name,
        base_url=payload.base_url,
        model=payload.model,
        ciphertext=ciphertext,
        clear_api_key=payload.clear_api_key,
        api_protocol=payload.api_protocol,
        context_window=payload.context_window,
        max_tokens=payload.max_tokens,
        supports_image=payload.supports_image,
        reasoning_effort=payload.reasoning_effort,
        thinking_format=payload.thinking_format,
        fields_set=set(payload.model_fields_set),
    )


@app.get("/api/llm-profiles", response_model=list[LlmProfileOut])
def list_profiles(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return list(db.scalars(select(LlmProfile).order_by(LlmProfile.name)).all())


@app.delete("/api/llm-profiles/{profile_id}")
def delete_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    profile = db.get(LlmProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="LLM 配置不存在")
    for sbx in db.scalars(
        select(Sandbox).where(Sandbox.llm_profile_id == profile_id)
    ).all():
        sbx.llm_profile_id = None
    db.delete(profile)
    db.commit()
    return {"ok": True}


@app.post("/api/llm-profiles/{profile_id}/push")
def push_llm_profile_to_sandboxes(
    profile_id: str,
    request: Request,
    payload: LlmProfilePushRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    profile = db.get(LlmProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="LLM 配置不存在")

    req = payload or LlmProfilePushRequest()
    query = select(Sandbox).where(Sandbox.deleted_at.is_(None)).order_by(Sandbox.created_at.asc())
    if req.sandbox_ids:
        query = query.where(Sandbox.id.in_(req.sandbox_ids))
    sandboxes = list(db.scalars(query).all())

    docker_svc = get_docker()
    results = []
    for sbx in sandboxes:
        try:
            res = docker_svc.sync_llm_profile(
                sbx,
                profile,
                set_as_default=req.set_as_default,
                replace_managed=req.replace_managed,
            )
            if res.get("ok") and req.set_as_default:
                sbx.llm_profile_id = profile.id
            results.append(res)
        except Exception as exc:
            results.append(
                {
                    "slug": sbx.slug,
                    "sandbox_id": sbx.id,
                    "ok": False,
                    "skipped": False,
                    "detail": str(exc),
                }
            )

    synced = len([r for r in results if r.get("ok")])
    skipped = len([r for r in results if r.get("skipped")])
    failed = len(results) - synced - skipped
    actor = session_email(request) if request is not None else None
    audit(
        db,
        "llm.push",
        target=profile.name,
        actor=actor,
        detail=(
            f"profile={profile.id},model={profile.model},"
            f"synced={synced}/{len(results)},skipped={skipped},default={req.set_as_default}"
        ),
    )
    db.commit()
    return {
        "profile_id": profile.id,
        "profile_name": profile.name,
        "synced": synced,
        "skipped": skipped,
        "failed": failed,
        "total": len(results),
        "results": results,
    }


# ---------------------------------------------------------------------------
# Sandboxes API (Admin-Only Creation & Lifecycle Management)
# ---------------------------------------------------------------------------


@app.post("/api/sandboxes", response_model=SandboxOut, status_code=201)
def create_sandbox_endpoint(
    payload: SandboxCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = create_sandbox(
            db,
            settings,
            get_docker(),
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
        )
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@app.get("/api/sandboxes", response_model=SandboxList)
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
        docker = get_docker()
        for sandbox in sandboxes:
            refresh_status(db, docker, sandbox)
    return SandboxList(items=[sandbox_out(sandbox) for sandbox in sandboxes])


@app.get("/api/sandboxes/{sandbox_id}", response_model=SandboxOut)
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
        refresh_status(db, get_docker(), sandbox)
    return sandbox_out(sandbox)


@app.post("/api/sandboxes/{sandbox_id}/start", response_model=SandboxOut)
def start_sandbox_endpoint(
    sandbox_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = start_sandbox(db, get_docker(), sandbox_id)
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@app.post("/api/sandboxes/{sandbox_id}/stop", response_model=SandboxOut)
def stop_sandbox_endpoint(
    sandbox_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = stop_sandbox(db, get_docker(), sandbox_id)
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@app.post("/api/sandboxes/{sandbox_id}/restart", response_model=SandboxOut)
def restart_sandbox_endpoint(
    sandbox_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = restart_sandbox(db, get_docker(), sandbox_id)
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@app.post("/api/sandboxes/{sandbox_id}/recreate", response_model=SandboxOut)
def recreate_sandbox_endpoint(
    sandbox_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = load_sandbox(db, sandbox_id)
        get_docker().recreate(sandbox)
        sandbox.status = "running"
        sandbox.last_seen_at = sandbox.updated_at
        audit(db, "sandbox.recreate", target=sandbox.id)
        db.commit()
        db.refresh(sandbox)
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@app.patch("/api/sandboxes/{sandbox_id}", response_model=SandboxOut)
def patch_sandbox(
    sandbox_id: str,
    payload: SandboxPatch,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    if (
        payload.image_repo is None
        and payload.image_tag is None
        and payload.llm_profile_id is None
        and payload.cpu_limit is None
        and payload.memory_limit is None
        and payload.auto_sleep_exempt is None
    ):
        raise HTTPException(status_code=400, detail="nothing to update")
    try:
        sandbox = load_sandbox(db, sandbox_id)
        need_recreate = False
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
                get_docker(),
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
                db, get_docker(), sandbox_id, payload.image_tag
            )
            need_recreate = False
        if need_recreate:
            get_docker().recreate(sandbox)
            sandbox.status = "running"
            db.commit()
            db.refresh(sandbox)
        if llm_to_sync is not None:
            # Hot-push updated LLM profile directly into the sandbox's cordis.patch.yml + .credentials.yaml
            # without destroying the container (and after recreate if the image also changed).
            sync_res = get_docker().sync_llm_profile(
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


@app.delete("/api/sandboxes/{sandbox_id}", response_model=SandboxOut)
def delete_sandbox_endpoint(
    sandbox_id: str,
    purge_volume: bool = False,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        sandbox = delete_sandbox(db, get_docker(), sandbox_id, purge_volume)
    except Exception as exc:
        raise _manager_error(exc) from exc
    return sandbox_out(sandbox)


@app.get("/api/sandboxes/{sandbox_id}/logs")
@app.get("/api/my/sandboxes/{sandbox_id}/logs")
def sandbox_logs(
    sandbox_id: str,
    request: Request,
    tail: int = Query(default=300, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    try:
        sandbox = load_sandbox(db, sandbox_id, include_deleted=True)
        _require_sandbox_owner_or_admin(sandbox, request, db, "无权查看他人的工作区日志")
        return {"logs": get_docker().logs(sandbox, tail=tail)}
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


@app.get("/api/sandboxes/{sandbox_id}/stats")
@app.get("/api/my/sandboxes/{sandbox_id}/stats")
def sandbox_stats(
    sandbox_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    try:
        sandbox = load_sandbox(db, sandbox_id)
        _require_sandbox_owner_or_admin(sandbox, request, db, "无权查看他人的工作区状态")
        data = get_docker().stats(sandbox)
        if data.get("disk_usage_mb") is not None:
            sandbox.disk_usage_mb = float(data["disk_usage_mb"])
            sandbox.disk_updated_at = utcnow()
            db.commit()
        return data
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc


# ---------------------------------------------------------------------------
# Sleeping Sandbox Auto-Wake Fallback (/s/<slug>/* when container is stopped)
# ---------------------------------------------------------------------------


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


@app.api_route(
    "/s/{slug}",
    methods=["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    include_in_schema=False,
)
@app.api_route(
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


# ---------------------------------------------------------------------------
# React + shadcn/ui SPA Entry Routes
# ---------------------------------------------------------------------------


def _serve_spa():
    index_file = WEB_DIST_DIR / "index.html"
    if index_file.is_file():
        return FileResponse(str(index_file), media_type="text/html")
    return HTMLResponse(
        "<h1>DSH Manager Frontend not built yet</h1><p>Run <code>yarn build</code> in <code>manager/frontend</code>.</p>",
        status_code=503,
    )


@app.get("/", include_in_schema=False)
@app.get("/login", include_in_schema=False)
@app.get("/auth/login", include_in_schema=False)
@app.get("/admin", include_in_schema=False)
@app.get("/my", include_in_schema=False)
def spa_routes():
    return _serve_spa()
