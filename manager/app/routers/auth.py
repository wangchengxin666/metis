"""Authentication, ForwardAuth verification, OIDC SSO flows, and OIDC provider CRUD."""

from __future__ import annotations

import hmac
import html as html_lib
from urllib.parse import quote

from authlib.integrations.starlette_client import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import (
    OIDC_ID_TOKEN_COOKIE,
    OIDC_PROMPT_LOGIN_COOKIE,
    SESSION_COOKIE_NAME,
    _delete_auth_cookie,
    _ensure_active_user,
    _is_authenticated_admin,
    _manager_error,
    _resolve_display_name,
    _set_auth_cookie,
    logger,
    oidc_provider_out,
    oidc_registry,
    require_admin_api,
    resolve_probe_oidc_discovery,
    safe_next,
    session_email,
    settings,
)
from ..models import OidcProvider, User
from ..oidc import build_provider_logout_url, is_email_domain_allowed
from ..schemas import (
    AuthPolicyOut,
    AuthPolicyUpdate,
    OidcProviderCreate,
    OidcProviderOut,
    OidcProviderTestOut,
    OidcProviderTestRequest,
    OidcProviderUpdate,
)
from ..security import derive_sandbox_gateway_secret, verify_password
from ..services import (
    NotFoundError,
    audit,
    create_oidc_provider,
    delete_oidc_provider,
    get_allow_local_user_login,
    get_branding_config,
    get_oidc_provider_by_slug,
    is_platform_admin,
    list_oidc_providers,
    load_sandbox_by_slug,
    set_allow_local_user_login,
    touch_sandbox_activity,
    update_oidc_provider,
)

router = APIRouter()


class LoginPayload(BaseModel):
    email: str
    token: str | None = None
    password: str | None = None
    mode: str = "admin"




@router.get("/api/auth/me")
@router.get("/auth/me", include_in_schema=False)
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
    brand_cfg = get_branding_config(db)
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
        "brand_name_zh": brand_cfg["brand_name_zh"],
        "brand_name_en": brand_cfg["brand_name_en"],
        "brand_logo_svg": brand_cfg["brand_logo_svg"],
        "brand_favicon": brand_cfg["brand_favicon"],
        "brand_theme": brand_cfg["brand_theme"],
        "sandbox_runtime": settings.sandbox_runtime,
        "sandbox": sandbox_info,
    }


@router.get("/api/auth/verify-sandbox/{slug}", include_in_schema=False)
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
    fwd_uri = request.headers.get("x-forwarded-uri") or ""
    is_preview_path = fwd_uri.startswith(f"/s/{slug}/apps/") or (
        fwd_uri.startswith(f"/s/{slug}/p/") and not fwd_uri.startswith(f"/s/{slug}/p/4090")
    )
    if is_preview_path and (getattr(sandbox, "preview_auth_mode", None) or "public") == "public":
        return Response(status_code=200)

    if not email and not is_admin:
        if wants_html:
            safe_slug = html_lib.escape(slug)
            login_href = f"/login?next={quote(fwd_uri or f'/s/{slug}/', safe='/')}"
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
    if not is_preview_path and not is_admin and email != owner_email:
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
            "X-Metis-Gateway-Auth": derive_sandbox_gateway_secret(sandbox.id, sandbox.slug),
        },
    )


@router.post("/api/auth/login")
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


@router.post("/api/auth/logout")
async def api_auth_logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    logout_url = await _perform_logout(request, response, db)
    return {"ok": True, "logout_url": logout_url}


@router.get("/auth/oidc/start", include_in_schema=False)
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


@router.get("/auth/oidc/{slug}/start", include_in_schema=False)
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


@router.get("/auth/oidc/{slug}/callback", include_in_schema=False)
async def auth_oidc_provider_callback(
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    provider = get_oidc_provider_by_slug(db, slug, enabled_only=True)
    if provider is None:
        return RedirectResponse("/login?error=oidc_provider_disabled", status_code=303)
    return await _complete_oidc_callback(request, db, provider)


@router.get("/auth/callback", include_in_schema=False)
async def auth_callback(request: Request, db: Session = Depends(get_db)):
    session_slug = request.session.get("oidc_login_provider")
    provider = _resolve_default_oidc_provider(
        db, session_slug if isinstance(session_slug, str) else None
    )
    if provider is None:
        return RedirectResponse("/login?error=oidc_provider_disabled", status_code=303)
    return await _complete_oidc_callback(request, db, provider)


@router.get("/auth/logout", include_in_schema=False)
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



@router.get("/api/auth/policy", response_model=AuthPolicyOut)
def api_get_auth_policy(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return AuthPolicyOut(
        allow_local_user_login=get_allow_local_user_login(db, settings),
        admin_token_configured=bool(settings.manager_admin_token),
        auth_mode=settings.manager_auth_mode,
    )


@router.put("/api/auth/policy", response_model=AuthPolicyOut)
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


@router.get("/api/oidc-providers", response_model=list[OidcProviderOut])
def api_list_oidc_providers(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return [oidc_provider_out(p) for p in list_oidc_providers(db)]


@router.post("/api/oidc-providers", response_model=OidcProviderOut, status_code=201)
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


@router.patch("/api/oidc-providers/{provider_id}", response_model=OidcProviderOut)
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


@router.delete("/api/oidc-providers/{provider_id}")
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


@router.post("/api/oidc-providers/test", response_model=OidcProviderTestOut)
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
    result = await resolve_probe_oidc_discovery(issuer_url, discovery_url)
    return OidcProviderTestOut(**result)
