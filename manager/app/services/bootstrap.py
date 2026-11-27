"""Zero-config bootstrap, one-time Setup Wizard, and dynamic PlatformSetting runtime defaults."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import DEFAULT_AUTO_INSTALL_PLUGINS, Settings
from ..coordination import bump_config_version, cluster_lock, get_config_version
from ..models import LlmProfile, OidcProvider, PlatformAdmin, PlatformSetting, Sandbox, User
from ..runtime_secrets import (
    _setup_code_file_path,
    remove_initial_setup_code_file,
    write_initial_setup_code_file,
)
from ..security import hash_password
from .common import Conflict, audit, ensure_bootstrap_admin, get_or_create_user, utcnow
from .policies import set_allow_local_user_login, set_branding_config

logger = logging.getLogger("dsh.manager.bootstrap")

_SETUP_COMPLETED_KEY = "setup.completed"
_SETUP_CODE_HASH_KEY = "setup.code_hash"
_ONBOARDING_STEP_KEY = "setup.onboarding_step"

_RUNTIME_PREFIX = "runtime."
_RUNTIME_VERSION_CACHE: dict[str, int] = {"platform": -1}

NETWORK_PRESET_MIRRORS: dict[str, dict[str, str]] = {
    "direct": {
        "docker_registry_mirror": "",
        "apt_mirror": "deb.debian.org",
        "node_mirror": "https://nodejs.org/dist",
        "npm_registry": "",
        "pip_index_url": "https://pypi.org/simple/",
    },
    "cn-aliyun": {
        "docker_registry_mirror": "",
        "apt_mirror": "https://mirrors.aliyun.com",
        "node_mirror": "https://npmmirror.com/mirrors/node",
        "npm_registry": "https://registry.npmmirror.com",
        "pip_index_url": "https://mirrors.aliyun.com/pypi/simple/",
    },
}


def resolve_sandbox_src_dir(settings: Settings) -> Path | None:
    """Locate the sandbox image build directory (mounted in Compose or adjacent in repo)."""
    candidates: list[Path] = []
    explicit = (getattr(settings, "sandbox_src_dir", "") or "").strip()
    if explicit:
        candidates.append(Path(explicit))
    candidates.append(Path("/app/sandbox_src"))
    repo_candidate = Path(__file__).resolve().parents[3] / "sandbox"
    candidates.append(repo_candidate)
    for cand in candidates:
        try:
            if cand.is_dir() and (cand / "Dockerfile").is_file():
                return cand
        except Exception:
            continue
    return None


def _hash_setup_code(settings: Settings, code: str) -> str:
    key = (settings.secret_key or "dsh-setup-fallback").encode("utf-8")
    return hmac.new(key, code.strip().encode("utf-8"), hashlib.sha256).hexdigest()


def _upsert_setting(db: Session, key: str, value: str, now: datetime) -> None:
    row = db.get(PlatformSetting, key)
    if row is None:
        db.add(PlatformSetting(key=key, value=value, updated_at=now))
    else:
        row.value = value
        row.updated_at = now


def is_setup_completed(db: Session, settings: Settings | None = None) -> bool:
    if settings is not None and not getattr(settings, "allow_setup_wizard", True):
        return True
    if settings is not None and settings.manager_auth_mode == "none":
        return True
    row = db.get(PlatformSetting, _SETUP_COMPLETED_KEY)
    if row is not None:
        return (row.value or "").strip().lower() in {"1", "true", "yes"}
    if settings is not None and (settings.manager_admin_token or "").strip():
        return True
    return False


def get_onboarding_step(db: Session, settings: Settings | None = None) -> str:
    if not is_setup_completed(db, settings):
        return "account"
    row = db.get(PlatformSetting, _ONBOARDING_STEP_KEY)
    if row and row.value in {"images", "llm", "done"}:
        return row.value
    return "done"


def has_admin_password(db: Session) -> bool:
    admin_emails = list(
        db.scalars(
            select(PlatformAdmin.email).where(PlatformAdmin.active == True)  # noqa: E712
        ).all()
    )
    if not admin_emails:
        return False
    users = list(db.scalars(select(User).where(User.email.in_(admin_emails))).all())
    return any(bool((u.password_hash or "").strip()) for u in users)


def ensure_bootstrap_setup_state(db: Session, settings: Settings) -> str | None:
    """Initialize Setup Wizard state cleanly on first boot.

    Preserves existing deployments (configured MANAGER_ADMIN_TOKEN, enabled OIDC provider,
    existing admin password, or MANAGER_AUTH_MODE=none) as already completed.
    For zero-config installs without admin credentials, issues a single-use Setup Code.
    """
    existing_completed = db.get(PlatformSetting, _SETUP_COMPLETED_KEY)
    if existing_completed is not None and existing_completed.value == "true":
        return None

    now = utcnow()
    already_initialized = (
        not getattr(settings, "allow_setup_wizard", True)
        or settings.manager_auth_mode == "none"
        or bool((settings.manager_admin_token or "").strip())
        or has_admin_password(db)
        or db.scalar(
            select(OidcProvider.id).where(OidcProvider.enabled == True)  # noqa: E712
        )
        is not None
    )
    if already_initialized:
        _upsert_setting(db, _SETUP_COMPLETED_KEY, "true", now)
        _upsert_setting(db, _ONBOARDING_STEP_KEY, "done", now)
        _upsert_setting(db, _SETUP_CODE_HASH_KEY, "", now)
        remove_initial_setup_code_file(settings)
        db.commit()
        return None

    override_code = (getattr(settings, "manager_setup_code", "") or "").strip()
    existing_hash = db.get(PlatformSetting, _SETUP_CODE_HASH_KEY)
    if existing_hash and (existing_hash.value or "").strip() and not override_code:
        # Already generated in a prior boot before setup completion
        if existing_completed is None:
            _upsert_setting(db, _SETUP_COMPLETED_KEY, "false", now)
            _upsert_setting(db, _ONBOARDING_STEP_KEY, "account", now)
            db.commit()
        return None

    setup_code = override_code or f"DSH-{secrets.token_urlsafe(9)}"
    _upsert_setting(db, _SETUP_COMPLETED_KEY, "false", now)
    _upsert_setting(db, _ONBOARDING_STEP_KEY, "account", now)
    _upsert_setting(db, _SETUP_CODE_HASH_KEY, _hash_setup_code(settings, setup_code), now)
    db.commit()

    code_path = write_initial_setup_code_file(settings, setup_code)
    banner_hint = f" (also saved to {code_path})" if code_path else ""
    logger.warning(
        "\n====================================================================\n"
        " METIS ZERO-CONFIG FIRST BOOT: Setup Wizard required!\n"
        " Open: %s/setup\n"
        " One-Time Setup Code: %s%s\n"
        "====================================================================",
        settings.manager_base_url,
        setup_code,
        banner_hint,
    )
    return setup_code


def _read_runtime_map(db: Session) -> tuple[dict[str, str], datetime | None]:
    rows = list(
        db.scalars(
            select(PlatformSetting).where(PlatformSetting.key.like(f"{_RUNTIME_PREFIX}%"))
        ).all()
    )
    out: dict[str, str] = {}
    latest: datetime | None = None
    for r in rows:
        short = r.key[len(_RUNTIME_PREFIX) :]
        out[short] = r.value or ""
        if latest is None or (r.updated_at and r.updated_at > latest):
            latest = r.updated_at
    return out, latest


def get_runtime_settings(db: Session, settings: Settings) -> dict[str, Any]:
    """Return effective platform runtime defaults combining DB PlatformSetting + env fallbacks."""
    raw, updated_at = _read_runtime_map(db)
    preset = raw.get("network_preset", "direct")
    if preset not in NETWORK_PRESET_MIRRORS and preset != "custom":
        preset = "direct"
    preset_defaults = NETWORK_PRESET_MIRRORS.get(preset, NETWORK_PRESET_MIRRORS["direct"])

    def _str(key: str, fallback: str) -> str:
        if key in raw:
            return raw[key]
        return fallback

    def _bool(key: str, fallback: bool) -> bool:
        if key not in raw:
            return fallback
        return raw[key].strip().lower() in {"1", "true", "yes", "on"}

    def _float(key: str, fallback: float) -> float:
        if key not in raw or not raw[key].strip():
            return fallback
        try:
            val = float(raw[key])
            return val if val > 0 else fallback
        except Exception:
            return fallback

    src_dir = resolve_sandbox_src_dir(settings)
    return {
        "network_preset": preset,
        "docker_registry_mirror": _str("docker_registry_mirror", preset_defaults["docker_registry_mirror"]),
        "apt_mirror": _str("apt_mirror", preset_defaults["apt_mirror"]),
        "node_mirror": _str("node_mirror", preset_defaults["node_mirror"]),
        "npm_registry": _str("npm_registry", preset_defaults["npm_registry"]),
        "pip_index_url": _str("pip_index_url", preset_defaults["pip_index_url"]),
        "default_image_repo": _str("default_image_repo", settings.dsh_image_repo) or settings.dsh_image_repo,
        "default_image_tag": _str("default_image_tag", settings.dsh_image_tag) or settings.dsh_image_tag,
        "pull_missing_image": _bool("pull_missing_image", settings.pull_missing_image),
        "default_cpus": _float("default_cpus", settings.sandbox_cpus),
        "default_memory": _str("default_memory", settings.sandbox_memory) or settings.sandbox_memory,
        "default_timezone": _str("default_timezone", settings.sandbox_timezone) or settings.sandbox_timezone,
        "default_auto_install_plugins": (
            raw["default_auto_install_plugins"]
            if "default_auto_install_plugins" in raw
            else settings.sandbox_auto_install_plugins
        ),
        "default_admin_email": _str("default_admin_email", settings.manager_admin_email) or settings.manager_admin_email,
        "sandbox_src_available": src_dir is not None,
        "sandbox_src_path": str(src_dir) if src_dir is not None else None,
        "updated_at": updated_at,
    }


def apply_runtime_settings_to_settings(db: Session, settings: Settings) -> dict[str, Any]:
    """Propagate persisted PlatformSetting runtime defaults onto Settings for local execution."""
    eff = get_runtime_settings(db, settings)
    settings.dsh_image_repo = eff["default_image_repo"]
    settings.dsh_image_tag = eff["default_image_tag"]
    settings.pull_missing_image = bool(eff["pull_missing_image"])
    settings.sandbox_cpus = float(eff["default_cpus"])
    settings.sandbox_memory = eff["default_memory"]
    settings.sandbox_timezone = eff["default_timezone"]
    settings.sandbox_auto_install_plugins = eff["default_auto_install_plugins"]
    settings.manager_admin_email = eff["default_admin_email"]
    return eff


def sync_runtime_settings_if_stale(db: Session, settings: Settings) -> None:
    """Sync worker-local Settings defaults whenever any replica bumps platform config version."""
    try:
        current_ver = get_config_version("platform")
    except Exception:
        return
    if _RUNTIME_VERSION_CACHE.get("platform") == current_ver:
        return
    try:
        apply_runtime_settings_to_settings(db, settings)
        _RUNTIME_VERSION_CACHE["platform"] = current_ver
    except Exception:
        pass


def update_runtime_settings(
    db: Session,
    settings: Settings,
    updates: dict[str, Any],
    *,
    actor: str | None = None,
) -> dict[str, Any]:
    """Persist runtime defaults to DB and broadcast version invalidation across workers."""
    now = utcnow()
    preset = updates.get("network_preset")
    apply_preset = bool(updates.get("apply_preset_mirrors", True))
    to_store: dict[str, str] = {}

    if preset is not None:
        if preset not in {"direct", "cn-aliyun", "custom"}:
            raise ValueError(f"unsupported network_preset: {preset}")
        to_store["network_preset"] = str(preset)
        if apply_preset and preset in NETWORK_PRESET_MIRRORS:
            for mk, mv in NETWORK_PRESET_MIRRORS[preset].items():
                if updates.get(mk) is None:
                    to_store[mk] = mv

    for key in (
        "docker_registry_mirror",
        "apt_mirror",
        "node_mirror",
        "npm_registry",
        "pip_index_url",
        "default_image_repo",
        "default_image_tag",
        "default_memory",
        "default_timezone",
        "default_auto_install_plugins",
    ):
        if updates.get(key) is not None:
            to_store[key] = str(updates[key]).strip()

    if updates.get("pull_missing_image") is not None:
        to_store["pull_missing_image"] = "true" if updates["pull_missing_image"] else "false"
    if updates.get("default_cpus") is not None:
        to_store["default_cpus"] = str(round(float(updates["default_cpus"]), 2))

    for short_key, str_val in to_store.items():
        _upsert_setting(db, f"{_RUNTIME_PREFIX}{short_key}", str_val, now)

    audit(
        db,
        "system.runtime_settings.update",
        target="platform",
        detail=", ".join(f"{k}={v}" for k, v in sorted(to_store.items()))[:500],
        actor=actor,
    )
    db.commit()
    try:
        bump_config_version("platform")
    except Exception:
        pass
    _RUNTIME_VERSION_CACHE["platform"] = -1
    return apply_runtime_settings_to_settings(db, settings)


def check_base_image_present(runtime: Any, db: Session, settings: Settings) -> bool:
    """Check whether the currently configured default base image exists in runtime."""
    eff = get_runtime_settings(db, settings)
    repo = eff["default_image_repo"]
    tag = eff["default_image_tag"]
    try:
        images = runtime.list_local_images() or []
    except Exception:
        return False
    target = f"{repo}:{tag}"
    for item in images:
        if item.get("full_name") == target or (
            item.get("repo") == repo and item.get("tag") == tag
        ):
            return True
    return False


def get_setup_status(db: Session, settings: Settings, runtime: Any, db_backend: str) -> dict[str, Any]:
    completed = is_setup_completed(db, settings)
    eff = get_runtime_settings(db, settings)
    has_llm = db.scalar(select(LlmProfile.id)) is not None
    code_path = _setup_code_file_path(settings)
    code_file_hint = str(code_path) if (not completed and code_path.is_file()) else None
    code_row = db.get(PlatformSetting, _SETUP_CODE_HASH_KEY)
    return {
        "setup_completed": completed,
        "needs_setup": not completed,
        "onboarding_step": get_onboarding_step(db, settings),
        "setup_code_configured": bool(code_row and (code_row.value or "").strip()),
        "setup_code_file_hint": code_file_hint,
        "default_admin_email": settings.manager_admin_email,
        "default_image_repo": eff["default_image_repo"],
        "default_image_tag": eff["default_image_tag"],
        "base_image_present": check_base_image_present(runtime, db, settings),
        "has_llm_profile": has_llm,
        "database_backend": db_backend,
        "sandbox_runtime": settings.sandbox_runtime,
        "sandbox_src_available": bool(eff["sandbox_src_available"]),
    }


def complete_initial_setup(
    db: Session,
    settings: Settings,
    runtime: Any,
    *,
    setup_code: str,
    admin_email: str,
    admin_password: str,
    admin_display_name: str | None = None,
    brand_name_zh: str | None = None,
    brand_name_en: str | None = None,
    network_preset: str = "direct",
    docker_registry_mirror: str | None = None,
    apt_mirror: str | None = None,
    node_mirror: str | None = None,
    npm_registry: str | None = None,
    pip_index_url: str | None = None,
    allow_local_user_login: bool = True,
) -> dict[str, Any]:
    """Validate single-use setup code and bootstrap the admin account, branding, and mirrors."""
    with cluster_lock("setup_complete", ttl_seconds=20.0, wait_seconds=5.0):
        if is_setup_completed(db, settings):
            raise Conflict("初始配置已完成，引导接口已自动锁定")

        code_row = db.get(PlatformSetting, _SETUP_CODE_HASH_KEY)
        stored_hash = (code_row.value or "").strip() if code_row else ""
        candidate_hash = _hash_setup_code(settings, setup_code)
        if not stored_hash or not hmac.compare_digest(candidate_hash, stored_hash):
            raise ValueError("初始安装验证码（Setup Code）不正确")

        clean_email = admin_email.strip().lower()
        clean_name = (admin_display_name or "").strip() or clean_email.split("@", 1)[0]
        pw_hash = hash_password(admin_password)

        user = get_or_create_user(db, clean_email, clean_name, password_hash=pw_hash)
        user.password_hash = pw_hash
        user.status = "active"
        if clean_name and not user.display_name:
            user.display_name = clean_name
        ensure_bootstrap_admin(db, clean_email)

        # Clean unused placeholder bootstrap admin when operator chooses a different email
        default_email = (settings.manager_admin_email or "").strip().lower()
        if default_email and default_email != clean_email:
            default_user = db.scalar(select(User).where(User.email == default_email))
            has_sandboxes = (
                default_user is not None
                and db.scalar(select(Sandbox.id).where(Sandbox.user_id == default_user.id)) is not None
            )
            if not has_sandboxes:
                old_admin = db.scalar(select(PlatformAdmin).where(PlatformAdmin.email == default_email))
                if old_admin is not None:
                    db.delete(old_admin)
        settings.manager_admin_email = clean_email

        if brand_name_zh or brand_name_en:
            set_branding_config(
                db,
                brand_name_zh=(brand_name_zh or "").strip() or None,
                brand_name_en=(brand_name_en or "").strip() or None,
                actor=clean_email,
            )

        set_allow_local_user_login(db, allow_local_user_login, actor=clean_email)

        runtime_updates: dict[str, Any] = {
            "network_preset": network_preset,
            "apply_preset_mirrors": True,
        }
        if docker_registry_mirror is not None:
            runtime_updates["docker_registry_mirror"] = docker_registry_mirror
        if apt_mirror is not None:
            runtime_updates["apt_mirror"] = apt_mirror
        if node_mirror is not None:
            runtime_updates["node_mirror"] = node_mirror
        if npm_registry is not None:
            runtime_updates["npm_registry"] = npm_registry
        if pip_index_url is not None:
            runtime_updates["pip_index_url"] = pip_index_url
        update_runtime_settings(db, settings, runtime_updates, actor=clean_email)

        now = utcnow()
        _upsert_setting(db, f"{_RUNTIME_PREFIX}default_admin_email", clean_email, now)
        _upsert_setting(db, _SETUP_COMPLETED_KEY, "true", now)
        _upsert_setting(db, _SETUP_CODE_HASH_KEY, "", now)
        base_present = check_base_image_present(runtime, db, settings)
        next_step = "llm" if base_present else "images"
        _upsert_setting(db, _ONBOARDING_STEP_KEY, next_step, now)
        audit(
            db,
            "setup.complete",
            target="platform",
            detail=f"admin={clean_email}, preset={network_preset}",
            actor=clean_email,
        )
        db.commit()
        remove_initial_setup_code_file(settings)
        try:
            bump_config_version("platform")
        except Exception:
            pass

        return {
            "setup_completed": True,
            "admin_email": clean_email,
            "onboarding_step": next_step,
            "network_preset": network_preset,
            "base_image_present": base_present,
        }


def update_onboarding_step(db: Session, step: str, *, actor: str | None = None) -> str:
    if step not in {"images", "llm", "done"}:
        raise ValueError("invalid onboarding step")
    now = utcnow()
    _upsert_setting(db, _ONBOARDING_STEP_KEY, step, now)
    audit(db, "setup.onboarding_step", target="platform", detail=f"step={step}", actor=actor)
    db.commit()
    try:
        bump_config_version("platform")
    except Exception:
        pass
    return step
