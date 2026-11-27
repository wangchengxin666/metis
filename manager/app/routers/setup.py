"""Zero-config Setup Wizard & dynamic Platform Runtime Settings endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..db import get_database_backend, get_db
from ..deps import require_admin_api, resolve_docker, session_email, settings
from ..schemas import (
    OnboardingStepUpdate,
    PlatformRuntimeSettingsOut,
    PlatformRuntimeSettingsUpdate,
    SetupCompleteOut,
    SetupCompleteRequest,
    SetupStatusOut,
)
from ..services.bootstrap import (
    complete_initial_setup,
    get_runtime_settings,
    get_setup_status,
    is_setup_completed,
    sync_runtime_settings_if_stale,
    update_onboarding_step,
    update_runtime_settings,
)
from ..services.common import Conflict

router = APIRouter()


@router.get("/api/setup/status", response_model=SetupStatusOut)
def api_setup_status(db: Session = Depends(get_db)):
    sync_runtime_settings_if_stale(db, settings)
    return get_setup_status(db, settings, resolve_docker(), get_database_backend())


@router.post("/api/setup/complete", response_model=SetupCompleteOut)
def api_setup_complete(
    payload: SetupCompleteRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    if is_setup_completed(db, settings):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="平台已完成初始化配置，引导接口已自动关闭",
        )
    try:
        result = complete_initial_setup(
            db,
            settings,
            resolve_docker(),
            setup_code=payload.setup_code,
            admin_email=payload.admin_email,
            admin_password=payload.admin_password,
            admin_display_name=payload.admin_display_name,
            brand_name_zh=payload.brand_name_zh,
            brand_name_en=payload.brand_name_en,
            network_preset=payload.network_preset,
            docker_registry_mirror=payload.docker_registry_mirror,
            apt_mirror=payload.apt_mirror,
            node_mirror=payload.node_mirror,
            npm_registry=payload.npm_registry,
            pip_index_url=payload.pip_index_url,
            allow_local_user_login=payload.allow_local_user_login,
        )
    except Conflict as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        msg = str(exc)
        code = status.HTTP_401_UNAUTHORIZED if "Setup Code" in msg or "验证码" in msg else 400
        raise HTTPException(status_code=code, detail=msg) from exc

    # Automatically log in the newly initialized administrator into the browser session
    request.session["email"] = result["admin_email"]
    request.session["role"] = "admin"
    request.session["auth_method"] = "local"
    request.session.pop("oidc_provider_slug", None)
    request.session.pop("oidc_provider_name", None)
    return result


@router.post("/api/setup/onboarding-step")
def api_update_onboarding_step(
    payload: OnboardingStepUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    step = update_onboarding_step(db, payload.onboarding_step, actor=session_email(request))
    return {"onboarding_step": step}


@router.get("/api/system/runtime-settings", response_model=PlatformRuntimeSettingsOut)
def api_get_runtime_settings(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    sync_runtime_settings_if_stale(db, settings)
    return get_runtime_settings(db, settings)


@router.patch("/api/system/runtime-settings", response_model=PlatformRuntimeSettingsOut)
def api_update_runtime_settings(
    payload: PlatformRuntimeSettingsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        return update_runtime_settings(
            db,
            settings,
            payload.model_dump(exclude_unset=True),
            actor=session_email(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
