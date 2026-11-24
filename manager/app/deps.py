"""Shared runtime dependencies, auth guards, serializers, and wake helpers."""

from __future__ import annotations

import hmac
import html as html_lib
import json
import logging
import sys
import threading
import time
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .docker_service import BaseSandboxRuntime, SandboxRuntimeError, create_runtime
from .models import OidcProvider, PlatformAdmin, Sandbox, User
from .oidc import OidcClientRegistry, probe_oidc_discovery
from .plugin_registry import PluginRegistryService
from .schemas import OidcProviderOut, SandboxOut, UserOut
from .services import (
    Conflict,
    ManagerError,
    NotFoundError,
    audit,
    is_platform_admin,
    utcnow,
)

logger = logging.getLogger("dsh-manager")
settings = get_settings()
WEB_DIST_DIR = Path(__file__).parent / "web_dist"
SESSION_COOKIE_NAME = "dsh_manager_session"
OIDC_ID_TOKEN_COOKIE = "dsh_manager_id_token"
OIDC_PROMPT_LOGIN_COOKIE = "dsh_oidc_prompt_login"

oidc_registry = OidcClientRegistry()


@lru_cache
def _default_get_docker() -> BaseSandboxRuntime:
    return create_runtime(settings)


@lru_cache
def _default_get_plugin_registry() -> PluginRegistryService:
    return PluginRegistryService(settings)


def resolve_docker() -> BaseSandboxRuntime:
    main_mod = sys.modules.get("app.main")
    fn = getattr(main_mod, "get_docker", None) if main_mod else None
    if callable(fn) and fn is not _default_get_docker:
        return fn()
    return _default_get_docker()


def resolve_plugin_registry() -> PluginRegistryService:
    main_mod = sys.modules.get("app.main")
    fn = getattr(main_mod, "get_plugin_registry", None) if main_mod else None
    if callable(fn) and fn is not _default_get_plugin_registry:
        return fn()
    return _default_get_plugin_registry()


async def resolve_probe_oidc_discovery(issuer_url: str | None, discovery_url: str | None):
    main_mod = sys.modules.get("app.main")
    fn = getattr(main_mod, "probe_oidc_discovery", None) if main_mod else None
    if callable(fn) and fn is not probe_oidc_discovery:
        return await fn(issuer_url, discovery_url)
    return await probe_oidc_discovery(issuer_url, discovery_url)


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



def sandbox_out(
    sandbox: Sandbox,
    *,
    team_ids: list[str] | None = None,
    team_names: list[str] | None = None,
    can_open_ide: bool = True,
) -> SandboxOut:
    wh_tok = getattr(sandbox, "webhook_token", None)
    wh_url = (
        f"{settings.manager_base_url}/api/webhooks/sandboxes/{sandbox.slug}?token={wh_tok}"
        if wh_tok
        else None
    )
    gw_key = getattr(sandbox, "gateway_api_key", None)
    return SandboxOut(
        id=sandbox.id,
        email=sandbox.user.email,
        display_name=sandbox.effective_display_name,
        slug=sandbox.slug,
        container_id=sandbox.container_id,
        volume_name=sandbox.volume_name,
        image_repo=sandbox.image_repo or settings.dsh_image_repo,
        image_tag=sandbox.image_tag,
        template=sandbox.template or "agent-os",
        role_title=sandbox.role_title,
        role_description=sandbox.role_description,
        role_sop=sandbox.role_sop,
        init_repo_url=sandbox.init_repo_url,
        auto_install_plugins=sandbox.auto_install_plugins,
        llm_profile_id=sandbox.llm_profile_id,
        llm_profile_name=sandbox.llm_profile.name if sandbox.llm_profile else None,
        credential_profile_ids=sandbox.credential_profile_ids,
        cpu_limit=(
            sandbox.cpu_limit
            if sandbox.cpu_limit is not None
            else settings.sandbox_cpus
        ),
        memory_limit=sandbox.memory_limit or settings.sandbox_memory,
        auto_sleep_exempt=bool(sandbox.auto_sleep_exempt),
        disk_usage_mb=sandbox.disk_usage_mb,
        disk_updated_at=sandbox.disk_updated_at,
        preview_auth_mode=getattr(sandbox, "preview_auth_mode", None) or "public",
        ownership_mode=getattr(sandbox, "ownership_mode", None) or "personal",
        maintainer_emails=sandbox.maintainer_emails,
        has_webhook_token=bool(wh_tok),
        webhook_url=wh_url,
        has_gateway_api_key=bool(gw_key),
        daily_token_limit=getattr(sandbox, "daily_token_limit", None),
        daily_cost_limit=getattr(sandbox, "daily_cost_limit", None),
        budget_action=getattr(sandbox, "budget_action", None) or "block",
        project_team_name=getattr(sandbox, "project_team_name", None),
        team_ids=team_ids or [],
        team_names=team_names or [],
        can_open_ide=can_open_ide,
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
    docker = resolve_docker()
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



def _require_sandbox_owner_or_admin(
    sandbox: Sandbox,
    request: Request,
    db: Session,
    forbidden_detail: str,
    *,
    allow_shared_member: bool = False,
) -> str:
    from .services.teams import (
        can_user_access_sandbox_frontstage,
        can_user_open_sandbox_ide,
    )

    email = session_email(request)
    if _is_authenticated_admin(request, db):
        return email or settings.manager_admin_email.lower()
    if not email:
        raise HTTPException(status_code=401, detail="请先登录")
    _ensure_active_user(db, email)
    allowed = (
        can_user_access_sandbox_frontstage(db, sandbox, email, False)
        if allow_shared_member
        else can_user_open_sandbox_ide(db, sandbox, email, False)
    )
    if not allowed:
        raise HTTPException(status_code=403, detail=forbidden_detail)
    if sandbox.user.email.lower() == email and sandbox.user.status != "active":
        raise HTTPException(status_code=403, detail="该账号已被管理员禁用")
    return email

