"""Admin resource management: role templates, users, platform admins, LLM profiles, and credential vault."""

from __future__ import annotations

import time
import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import (
    _manager_error,
    _user_out,
    require_admin_api,
    resolve_docker,
    session_email,
    settings,
)
from ..models import CredentialProfile, LlmProfile, Sandbox, User
from ..schemas import (
    AdminCreate,
    AdminOut,
    CredentialProfileCreate,
    CredentialProfileOut,
    CredentialProfilePushRequest,
    CredentialProfileRefreshAppRequest,
    CredentialProfileUpdate,
    LlmProfileCreate,
    LlmProfileOut,
    LlmProfilePushRequest,
    LlmProfileUpdate,
    TemplateCreate,
    TemplateOut,
    TemplateUpdate,
    UserCreate,
    UserOut,
    UserUpdate,
)
from ..security import decrypt_secret, encrypt_secret, hash_password
from ..services.llm_gateway import generate_sandbox_gateway_key
from ..services.vault import refresh_github_app_profile_token
from ..services import (
    ROLE_TEMPLATE_PRESETS,
    NotFoundError,
    add_platform_admin,
    audit,
    create_credential_profile,
    create_llm_profile,
    create_template,
    deactivate_platform_admin,
    delete_credential_profile,
    delete_template,
    list_credential_presets,
    list_credential_profiles,
    list_platform_admins,
    list_templates,
    push_credential_profile,
    resolve_push_target_sandboxes,
    seed_credential_presets,
    seed_role_template_presets,
    update_credential_profile,
    update_llm_profile,
    update_template,
)

router = APIRouter()


@router.get("/api/templates", response_model=list[TemplateOut])
def api_list_templates(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return list_templates(db)


@router.get("/api/templates/presets")
def api_list_template_presets(
    _: None = Depends(require_admin_api),
):
    return {"items": ROLE_TEMPLATE_PRESETS}


@router.post("/api/templates/seed-presets", response_model=list[TemplateOut])
def api_seed_template_presets(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return seed_role_template_presets(
        db,
        settings,
        actor=session_email(request) or settings.manager_admin_email,
    )


@router.post("/api/templates", response_model=TemplateOut, status_code=201)
def api_create_template(
    payload: TemplateCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        return create_template(db, payload)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.put("/api/templates/{template_id}", response_model=TemplateOut)
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


@router.delete("/api/templates/{template_id}")
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


@router.post("/api/users", response_model=UserOut, status_code=201)
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


@router.get("/api/users", response_model=list[UserOut])
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


@router.patch("/api/users/{user_id}", response_model=UserOut)
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


@router.delete("/api/users/{user_id}")
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


@router.get("/api/admins", response_model=list[AdminOut])
def list_admins(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return list_platform_admins(db)


@router.post("/api/admins", response_model=AdminOut, status_code=201)
def add_admin(
    payload: AdminCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return add_platform_admin(
        db, str(payload.email), payload.display_name
    )


@router.delete("/api/admins/{email}", response_model=AdminOut)
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


@router.post("/api/llm-profiles", response_model=LlmProfileOut, status_code=201)
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
        gateway_enabled=payload.gateway_enabled,
        input_price_per_1m=payload.input_price_per_1m,
        output_price_per_1m=payload.output_price_per_1m,
        cache_read_price_per_1m=payload.cache_read_price_per_1m,
        cache_creation_price_per_1m=payload.cache_creation_price_per_1m,
        key_pool=payload.key_pool,
        tpm_limit=payload.tpm_limit,
        dlp_mode=payload.dlp_mode,
        fallback_llm_profile_id=payload.fallback_llm_profile_id,
        circuit_breaker_enabled=payload.circuit_breaker_enabled,
    )
    return profile


@router.patch("/api/llm-profiles/{profile_id}", response_model=LlmProfileOut)
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
    fields_set = set(payload.model_fields_set)
    updated = update_llm_profile(
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
        gateway_enabled=payload.gateway_enabled,
        input_price_per_1m=payload.input_price_per_1m,
        output_price_per_1m=payload.output_price_per_1m,
        cache_read_price_per_1m=payload.cache_read_price_per_1m,
        cache_creation_price_per_1m=payload.cache_creation_price_per_1m,
        key_pool=payload.key_pool,
        tpm_limit=payload.tpm_limit,
        dlp_mode=payload.dlp_mode,
        fallback_llm_profile_id=payload.fallback_llm_profile_id,
        circuit_breaker_enabled=payload.circuit_breaker_enabled,
        fields_set=fields_set,
    )
    if fields_set.intersection(
        {"gateway_enabled", "base_url", "model", "api_protocol", "api_key", "clear_api_key"}
    ):
        bound_sandboxes = list(
            db.scalars(
                select(Sandbox).where(
                    Sandbox.deleted_at.is_(None),
                    Sandbox.llm_profile_id == updated.id,
                )
            ).all()
        )
        if bound_sandboxes:
            docker_svc = resolve_docker()
            need_commit = False
            for sbx in bound_sandboxes:
                if updated.gateway_enabled and not getattr(sbx, "gateway_api_key", None):
                    sbx.gateway_api_key = generate_sandbox_gateway_key()
                    need_commit = True
                try:
                    if sbx.status == "running" and hasattr(docker_svc, "sync_llm_profile"):
                        docker_svc.sync_llm_profile(
                            sbx, updated, set_as_default=True, replace_managed=False
                        )
                except Exception:
                    pass
            if need_commit:
                db.commit()
    return updated


@router.get("/api/llm-profiles", response_model=list[LlmProfileOut])
def list_profiles(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return list(db.scalars(select(LlmProfile).order_by(LlmProfile.name)).all())


@router.delete("/api/llm-profiles/{profile_id}")
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


@router.post("/api/llm-profiles/{profile_id}/push")
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

    docker_svc = resolve_docker()
    results = []
    for sbx in sandboxes:
        if getattr(profile, "gateway_enabled", False) and not getattr(sbx, "gateway_api_key", None):
            sbx.gateway_api_key = generate_sandbox_gateway_key()
            db.flush()
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


@router.post("/api/llm-profiles/{profile_id}/test")
def test_llm_profile_connectivity(
    profile_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    """Probe upstream LLM endpoint connectivity using stored encrypted API key."""
    profile = db.get(LlmProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="LLM 配置不存在")

    api_key = ""
    if profile.api_key_ciphertext:
        try:
            api_key = decrypt_secret(profile.api_key_ciphertext)
        except Exception as exc:
            return {"ok": False, "status_code": None, "latency_ms": 0, "detail": str(exc)}

    base = (profile.base_url or "").strip().rstrip("/")
    proto = (profile.api_protocol or "openai-completions").strip().lower()
    headers: dict[str, str] = {}
    if proto == "anthropic-messages":
        if api_key:
            headers["x-api-key"] = api_key
        headers["anthropic-version"] = "2023-06-01"
    else:
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

    started = time.monotonic()
    try:
        with httpx.Client(timeout=12.0) as client:
            if proto == "anthropic-messages":
                target = base if base.endswith("/messages") else f"{base}/v1/messages"
                res = client.post(
                    target,
                    headers=headers,
                    json={
                        "model": profile.model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ping"}],
                    },
                )
            else:
                models_url = base if base.endswith("/models") else f"{base}/models"
                res = client.get(models_url, headers=headers)
                if res.status_code in {404, 405}:
                    chat_url = (
                        f"{base}/responses"
                        if proto == "openai-responses"
                        else f"{base}/chat/completions"
                    )
                    res = client.post(
                        chat_url,
                        headers=headers,
                        json={
                            "model": profile.model,
                            "max_tokens": 1,
                            "messages": [{"role": "user", "content": "ping"}],
                        },
                    )
        elapsed_ms = int((time.monotonic() - started) * 1000)
        if 200 <= res.status_code < 300:
            return {
                "ok": True,
                "status_code": res.status_code,
                "latency_ms": elapsed_ms,
                "detail": f"HTTP {res.status_code} ({elapsed_ms} ms)",
            }
        snippet = res.text.strip().replace("\n", " ")[:200]
        return {
            "ok": False,
            "status_code": res.status_code,
            "latency_ms": elapsed_ms,
            "detail": f"HTTP {res.status_code}: {snippet or 'upstream rejected request'}",
        }
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        return {
            "ok": False,
            "status_code": None,
            "latency_ms": elapsed_ms,
            "detail": str(exc),
        }


@router.get("/api/credential-profiles", response_model=list[CredentialProfileOut])
def api_list_credential_profiles(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return list_credential_profiles(db)


@router.get("/api/credential-profiles/presets")
def api_list_credential_presets(
    _: None = Depends(require_admin_api),
):
    return {"items": list_credential_presets()}


@router.post("/api/credential-profiles/seed-presets", response_model=list[CredentialProfileOut])
def api_seed_credential_presets(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return seed_credential_presets(
        db,
        actor=session_email(request) or settings.manager_admin_email,
    )


@router.post("/api/credential-profiles", response_model=CredentialProfileOut, status_code=201)
def api_create_credential_profile(
    payload: CredentialProfileCreate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        return create_credential_profile(
            db,
            payload,
            actor=session_email(request) or settings.manager_admin_email,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.patch("/api/credential-profiles/{profile_id}", response_model=CredentialProfileOut)
def api_update_credential_profile(
    profile_id: str,
    payload: CredentialProfileUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    profile = db.get(CredentialProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="凭据配置不存在")
    try:
        return update_credential_profile(
            db,
            profile,
            payload,
            actor=session_email(request) or settings.manager_admin_email,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/credential-profiles/{profile_id}")
def api_delete_credential_profile(
    profile_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    profile = db.get(CredentialProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="凭据配置不存在")
    delete_credential_profile(
        db,
        profile,
        actor=session_email(request) or settings.manager_admin_email,
    )
    return {"ok": True}


@router.post("/api/credential-profiles/{profile_id}/push")
def api_push_credential_profile(
    profile_id: str,
    payload: CredentialProfilePushRequest | None = Body(default=None),
    request: Request = None,  # type: ignore[assignment]
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    """Hot-push Git credentials, SSH private key, environment variables, and MCP servers to selected digital employees."""
    profile = db.get(CredentialProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="凭据配置不存在")
    req = payload or CredentialProfilePushRequest()
    targets = resolve_push_target_sandboxes(
        db, sandbox_ids=req.sandbox_ids, template_keys=req.template_keys
    )
    try:
        return push_credential_profile(
            db,
            resolve_docker(),
            profile,
            targets,
            action=req.action,
            actor=session_email(request) if request is not None else None,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/credential-profiles/{profile_id}/refresh-github-app")
def api_refresh_github_app_credential(
    profile_id: str,
    payload: CredentialProfileRefreshAppRequest | None = Body(default=None),
    request: Request = None,  # type: ignore[assignment]
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    """Force-mint a fresh GitHub App Installation Access Token and optionally hot-push to bound sandboxes."""
    profile = db.get(CredentialProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="凭据配置不存在")
    req = payload or CredentialProfileRefreshAppRequest()
    try:
        return refresh_github_app_profile_token(
            db,
            resolve_docker(),
            profile,
            push_to_bound=req.push_to_bound,
            actor=session_email(request) if request is not None else None,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc
