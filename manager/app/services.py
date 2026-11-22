from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .config import DEFAULT_AUTO_INSTALL_PLUGINS, Settings
from .docker_service import DockerService, SandboxRuntimeError
from .models import (
    AuditLog,
    LlmProfile,
    PlatformAdmin,
    PlatformSetting,
    Sandbox,
    SandboxTemplate,
    User,
)
from .schemas import TemplateCreate, TemplateUpdate
from .security import hash_password


class ManagerError(RuntimeError):
    pass


class Conflict(ManagerError):
    pass


class NotFoundError(ManagerError):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _slug_base(email: str) -> str:
    local = email.split("@", 1)[0].lower()
    local = re.sub(r"[^a-z0-9]+", "-", local).strip("-")
    local = local[:48] or "user"
    if not local[0].isalnum():
        local = "u" + local
    return local


def unique_slug(db: Session, email: str, wanted: str | None) -> str:
    if wanted:
        if db.scalar(select(Sandbox).where(Sandbox.slug == wanted)):
            raise Conflict(f"slug already exists: {wanted}")
        return wanted

    base = _slug_base(email)
    candidate = base
    for index in range(1, 1000):
        exists = db.scalar(select(Sandbox).where(Sandbox.slug == candidate))
        if not exists:
            return candidate
        candidate = f"{base}-{index + 1}"
    raise Conflict("cannot allocate a unique slug")


def get_or_create_user(
    db: Session,
    email: str,
    display_name: str | None = None,
    password_hash: str | None = None,
) -> User:
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user:
        if user.status != "active":
            raise ManagerError(f"user {email} is disabled; re-enable before provisioning")
        if display_name:
            user.display_name = display_name
        if password_hash and not user.password_hash:
            user.password_hash = password_hash
        return user
    user = User(
        email=email,
        display_name=display_name,
        password_hash=password_hash,
    )
    db.add(user)
    db.flush()
    return user


def is_platform_admin(db: Session, email: str) -> bool:
    admin = db.get(PlatformAdmin, email.strip().lower())
    return bool(admin and admin.active)


def ensure_bootstrap_admin(db: Session, email: str) -> None:
    email = email.strip().lower()
    if db.get(PlatformAdmin, email) is None:
        db.add(PlatformAdmin(email=email, display_name="bootstrap", active=True))
        db.commit()


def list_platform_admins(db: Session) -> list[PlatformAdmin]:
    return list(
        db.scalars(select(PlatformAdmin).order_by(PlatformAdmin.email)).all()
    )


def add_platform_admin(
    db: Session, email: str, display_name: str | None = None
) -> PlatformAdmin:
    email = email.strip().lower()
    admin = db.get(PlatformAdmin, email)
    if admin:
        admin.active = True
        if display_name:
            admin.display_name = display_name
    else:
        admin = PlatformAdmin(email=email, display_name=display_name, active=True)
        db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def deactivate_platform_admin(db: Session, email: str) -> PlatformAdmin:
    email = email.strip().lower()
    admin = db.get(PlatformAdmin, email)
    if not admin:
        raise NotFoundError(f"admin not found: {email}")
    admin.active = False
    db.commit()
    return admin


def audit(
    db: Session,
    action: str,
    target: str | None = None,
    detail: str | None = None,
    actor: str | None = None,
) -> None:
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            target=target,
            detail=detail,
            created_at=utcnow(),
        )
    )


def _normalize_init_script(script: str | None) -> str | None:
    if script is None or not script.strip():
        return None
    return script


def ensure_default_templates(db: Session, settings: Settings) -> None:
    # Keep a single clean built-in default template ('agent-os'); admins can create custom ones.
    for extra_key in ("fullstack-web", "python-data", "minimal"):
        extra = db.scalar(
            select(SandboxTemplate).where(
                SandboxTemplate.key == extra_key,
                SandboxTemplate.is_builtin.is_(True),
            )
        )
        if extra is not None:
            db.delete(extra)

    legacy_default_init_script = "#!/usr/bin/env bash\nmkdir -p /home/workspace/projects\n"
    default_tpl = db.scalar(
        select(SandboxTemplate).where(SandboxTemplate.key == "agent-os")
    )
    default_plugins = (
        settings.sandbox_auto_install_plugins or DEFAULT_AUTO_INSTALL_PLUGINS
    )
    if default_tpl is None:
        db.add(
            SandboxTemplate(
                key="agent-os",
                name="默认 Agent OS 环境 (Default)",
                description="默认远程 DeepSeek Harness 操作系统环境，预装文件管理器、当前用户身份栏、自定义主题插件、进程守护 (sandbox-service) 与持久化定时任务 (sandbox-cron)。",
                image_repo=settings.dsh_image_repo,
                image_tag=settings.dsh_image_tag,
                default_cpu_limit=settings.sandbox_cpus,
                default_memory_limit=settings.sandbox_memory,
                auto_install_plugins=default_plugins,
                init_script=None,
                default_env_json="{}",
                is_builtin=True,
            )
        )
    elif default_tpl.is_builtin:
        if default_tpl.init_script == legacy_default_init_script:
            default_tpl.init_script = None
        if (default_tpl.auto_install_plugins or "").strip() in {
            "file-manager",
            "file-manager,workspace-user,custom-theme",
            "file-manager,workspace-user,custom-theme,sandbox-mesh",
        }:
            default_tpl.auto_install_plugins = default_plugins

    for sbx in db.scalars(select(Sandbox).where(Sandbox.deleted_at.is_(None))).all():
        if (sbx.auto_install_plugins or "").strip() in {
            "file-manager",
            "file-manager,workspace-user,custom-theme",
            "file-manager,workspace-user,custom-theme,sandbox-mesh",
        }:
            sbx.auto_install_plugins = default_plugins
    db.commit()


def list_templates(db: Session) -> list[SandboxTemplate]:
    return list(
        db.scalars(
            select(SandboxTemplate).order_by(
                SandboxTemplate.is_builtin.desc(), SandboxTemplate.key.asc()
            )
        ).all()
    )


def get_template_by_key(db: Session, key: str) -> SandboxTemplate | None:
    return db.scalar(select(SandboxTemplate).where(SandboxTemplate.key == key))


def create_template(db: Session, payload: TemplateCreate) -> SandboxTemplate:
    if get_template_by_key(db, payload.key):
        raise Conflict(f"模板标识 '{payload.key}' 已存在")
    tpl = SandboxTemplate(
        key=payload.key,
        name=payload.name,
        description=payload.description,
        image_repo=payload.image_repo.strip(),
        image_tag=payload.image_tag.strip(),
        default_cpu_limit=payload.default_cpu_limit,
        default_memory_limit=payload.default_memory_limit,
        auto_install_plugins=payload.auto_install_plugins,
        init_script=_normalize_init_script(payload.init_script),
        default_env_json=payload.default_env_json or "{}",
        is_builtin=False,
    )
    db.add(tpl)
    audit(db, "template.create", target=tpl.key, detail=f"image={tpl.image_repo}:{tpl.image_tag}")
    db.commit()
    db.refresh(tpl)
    return tpl


def update_template(
    db: Session, template_id: str, payload: TemplateUpdate
) -> SandboxTemplate:
    tpl = db.get(SandboxTemplate, template_id)
    if not tpl:
        raise NotFoundError(f"template not found: {template_id}")
    if payload.name is not None:
        tpl.name = payload.name
    if payload.description is not None:
        tpl.description = payload.description
    if payload.image_repo is not None:
        tpl.image_repo = payload.image_repo.strip()
    if payload.image_tag is not None:
        tpl.image_tag = payload.image_tag.strip()
    if payload.default_cpu_limit is not None:
        tpl.default_cpu_limit = payload.default_cpu_limit
    if payload.default_memory_limit is not None:
        tpl.default_memory_limit = payload.default_memory_limit
    if payload.auto_install_plugins is not None:
        tpl.auto_install_plugins = payload.auto_install_plugins
    if payload.init_script is not None:
        tpl.init_script = _normalize_init_script(payload.init_script)
    if payload.default_env_json is not None:
        tpl.default_env_json = payload.default_env_json
    audit(db, "template.update", target=tpl.key)
    db.commit()
    db.refresh(tpl)
    return tpl


def delete_template(db: Session, template_id: str) -> None:
    tpl = db.get(SandboxTemplate, template_id)
    if not tpl:
        raise NotFoundError(f"template not found: {template_id}")
    audit(db, "template.delete", target=tpl.key)
    db.delete(tpl)
    db.commit()


def create_sandbox(
    db: Session,
    settings: Settings,
    docker: DockerService,
    email: str,
    slug: str | None,
    display_name: str | None,
    image_tag: str | None,
    cpu_limit: float | None = None,
    memory_limit: str | None = None,
    llm_profile_id: str | None = None,
    template: str | None = "agent-os",
    init_repo_url: str | None = None,
    image_repo: str | None = None,
    init_script: str | None = None,
    auto_install_plugins: str | None = None,
    initial_password: str | None = None,
    auto_sleep_exempt: bool = False,
) -> Sandbox:
    email = email.strip().lower()
    pw_hash = hash_password(initial_password) if initial_password else None
    user = get_or_create_user(db, email, display_name, password_hash=pw_hash)
    final_slug = unique_slug(db, email, slug)

    llm_profile: LlmProfile | None = None
    if llm_profile_id:
        llm_profile = db.get(LlmProfile, llm_profile_id)
        if not llm_profile:
            raise NotFoundError(f"llm profile not found: {llm_profile_id}")

    tpl_key = (template or "agent-os").strip()
    tpl_obj = get_template_by_key(db, tpl_key)

    resolved_repo = (
        image_repo
        or (tpl_obj.image_repo if tpl_obj else None)
        or settings.dsh_image_repo
    )
    resolved_tag = (
        image_tag
        or (tpl_obj.image_tag if tpl_obj else None)
        or settings.dsh_image_tag
    )
    resolved_cpu = (
        cpu_limit
        if cpu_limit is not None
        else (tpl_obj.default_cpu_limit if tpl_obj else settings.sandbox_cpus)
    )
    resolved_mem = (
        memory_limit
        or (tpl_obj.default_memory_limit if tpl_obj else None)
        or settings.sandbox_memory
    )
    resolved_plugins = (
        auto_install_plugins
        if auto_install_plugins is not None
        else (
            tpl_obj.auto_install_plugins
            if tpl_obj and tpl_obj.auto_install_plugins is not None
            else settings.sandbox_auto_install_plugins
        )
    )
    resolved_script = _normalize_init_script(
        init_script
        if init_script is not None
        else (tpl_obj.init_script if tpl_obj else None)
    )
    resolved_env_json = tpl_obj.default_env_json if tpl_obj else "{}"

    sandbox = Sandbox(
        user_id=user.id,
        slug=final_slug,
        volume_name=f"dsh-{final_slug}-home",
        image_repo=resolved_repo,
        image_tag=resolved_tag,
        template=tpl_key,
        init_repo_url=init_repo_url.strip() if init_repo_url else None,
        init_script=resolved_script,
        extra_env_json=resolved_env_json,
        auto_install_plugins=resolved_plugins,
        cpu_limit=resolved_cpu,
        memory_limit=resolved_mem,
        auto_sleep_exempt=auto_sleep_exempt,
        llm_profile_id=llm_profile.id if llm_profile else None,
        status="creating",
    )
    db.add(sandbox)
    db.flush()
    sandbox.user = user
    sandbox.llm_profile = llm_profile
    db.commit()
    db.refresh(sandbox)

    try:
        container = docker.create(sandbox)
    except Exception as exc:
        db.delete(sandbox)
        db.commit()
        raise ManagerError(f"docker create failed: {exc}") from exc

    sandbox.container_id = container.id
    sandbox.status = "starting"
    db.commit()

    try:
        docker.wait_healthy(sandbox)
    except SandboxRuntimeError:
        try:
            docker.remove(sandbox, purge_volume=True)
        finally:
            db.delete(sandbox)
            db.commit()
        raise

    sandbox.status = "running"
    sandbox.last_seen_at = utcnow()
    audit(db, "sandbox.create", target=sandbox.id, detail=f"slug={sandbox.slug}")
    db.commit()
    db.refresh(sandbox)
    return sandbox


def load_sandbox(db: Session, sandbox_id: str, include_deleted: bool = False) -> Sandbox:
    query = (
        select(Sandbox)
        .options(joinedload(Sandbox.user), joinedload(Sandbox.llm_profile))
        .where(Sandbox.id == sandbox_id)
    )
    if not include_deleted:
        query = query.where(Sandbox.deleted_at.is_(None))
    sandbox = db.scalar(query)
    if not sandbox:
        raise NotFoundError(f"sandbox not found: {sandbox_id}")
    return sandbox


def load_sandbox_by_slug(db: Session, slug: str) -> Sandbox:
    query = (
        select(Sandbox)
        .options(joinedload(Sandbox.user), joinedload(Sandbox.llm_profile))
        .where(Sandbox.slug == slug, Sandbox.deleted_at.is_(None))
    )
    sandbox = db.scalar(query)
    if not sandbox:
        raise NotFoundError(f"sandbox not found for slug: {slug}")
    return sandbox


def refresh_status(db: Session, docker: DockerService, sandbox: Sandbox) -> Sandbox:
    current = docker.status(sandbox)
    if current not in {"unknown"}:
        sandbox.status = current
    sandbox.last_seen_at = utcnow()
    db.commit()
    return sandbox


def start_sandbox(db: Session, docker: DockerService, sandbox_id: str) -> Sandbox:
    sandbox = load_sandbox(db, sandbox_id)
    try:
        sandbox.status = docker.start(sandbox)
    except SandboxRuntimeError as exc:
        raise ManagerError(str(exc)) from exc
    audit(db, "sandbox.start", target=sandbox.id)
    db.commit()
    return sandbox


def stop_sandbox(db: Session, docker: DockerService, sandbox_id: str) -> Sandbox:
    sandbox = load_sandbox(db, sandbox_id)
    try:
        sandbox.status = docker.stop(sandbox)
    except SandboxRuntimeError as exc:
        raise ManagerError(str(exc)) from exc
    audit(db, "sandbox.stop", target=sandbox.id)
    db.commit()
    return sandbox


def restart_sandbox(db: Session, docker: DockerService, sandbox_id: str) -> Sandbox:
    sandbox = load_sandbox(db, sandbox_id)
    try:
        sandbox.status = docker.restart(sandbox)
    except SandboxRuntimeError as exc:
        raise ManagerError(str(exc)) from exc
    sandbox.last_seen_at = utcnow()
    audit(db, "sandbox.restart", target=sandbox.id)
    db.commit()
    return sandbox


def delete_sandbox(
    db: Session,
    docker: DockerService,
    sandbox_id: str,
    purge_volume: bool,
) -> Sandbox:
    sandbox = load_sandbox(db, sandbox_id, include_deleted=True)
    if sandbox.deleted_at is not None:
        return sandbox

    try:
        docker.remove(sandbox, purge_volume=purge_volume)
    except SandboxRuntimeError as exc:
        raise ManagerError(str(exc)) from exc

    sandbox.status = "deleted"
    sandbox.deleted_at = utcnow()
    audit(
        db,
        "sandbox.delete",
        target=sandbox.id,
        detail=f"purge_volume={purge_volume}",
    )
    db.commit()
    return sandbox


def update_sandbox_limits(
    db: Session,
    docker: DockerService,
    sandbox_id: str,
    cpu_limit: float | None,
    memory_limit: str | None,
) -> Sandbox:
    sandbox = load_sandbox(db, sandbox_id)
    sandbox.cpu_limit = cpu_limit
    sandbox.memory_limit = memory_limit
    recreated = False
    try:
        docker.update_limits(sandbox)
    except SandboxRuntimeError as update_error:
        # Older containers were created with NanoCpus. Docker refuses to mix
        # NanoCpus with CpuQuota/CpuPeriod, so recreate once with the current
        # limits. The named volume (workspace) is preserved.
        try:
            docker.recreate(sandbox)
            recreated = True
        except Exception as exc:
            raise ManagerError(
                f"docker limit update failed ({update_error}); recreate failed: {exc}"
            ) from exc
    if recreated:
        sandbox.status = "running"
    audit(
        db,
        "sandbox.limits",
        target=sandbox.id,
        detail=f"cpu={cpu_limit} memory={memory_limit} recreated={recreated}",
    )
    db.commit()
    return sandbox


def upgrade_sandbox(
    db: Session,
    docker: DockerService,
    sandbox_id: str,
    image_tag: str,
) -> Sandbox:
    sandbox = load_sandbox(db, sandbox_id)
    if sandbox.image_tag == image_tag:
        raise Conflict("image tag is unchanged")

    old_tag = sandbox.image_tag
    try:
        docker.remove(sandbox, purge_volume=False)
        sandbox.container_id = None
        sandbox.image_tag = image_tag
        sandbox.status = "creating"
        db.commit()
        container = docker.create(sandbox)
        sandbox.container_id = container.id
        sandbox.status = "starting"
        db.commit()
        docker.wait_healthy(sandbox)
    except Exception as exc:
        sandbox.status = "error"
        db.commit()
        raise ManagerError(f"upgrade failed from {old_tag} to {image_tag}: {exc}") from exc

    sandbox.status = "running"
    audit(
        db,
        "sandbox.upgrade",
        target=sandbox.id,
        detail=f"{old_tag} -> {image_tag}",
    )
    db.commit()
    return sandbox


def create_llm_profile(
    db: Session,
    name: str,
    base_url: str,
    model: str,
    ciphertext: str = "",
    *,
    api_protocol: str = "openai-completions",
    context_window: int | None = None,
    max_tokens: int | None = None,
    supports_image: bool = False,
    reasoning_effort: str | None = None,
    thinking_format: str | None = None,
) -> LlmProfile:
    clean_protocol = (api_protocol or "openai-completions").strip()
    clean_reasoning = (reasoning_effort or "").strip() or None
    clean_thinking_fmt = (
        (thinking_format or "").strip() or None
        if clean_protocol == "openai-completions"
        else None
    )
    profile = LlmProfile(
        name=name.strip(),
        base_url=base_url.strip(),
        model=model.strip(),
        api_protocol=clean_protocol,
        context_window=context_window,
        max_tokens=max_tokens,
        supports_image=bool(supports_image),
        reasoning_effort=clean_reasoning,
        thinking_format=clean_thinking_fmt,
        api_key_ciphertext=ciphertext,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def update_llm_profile(
    db: Session,
    profile: LlmProfile,
    *,
    name: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    ciphertext: str | None = None,
    clear_api_key: bool = False,
    api_protocol: str | None = None,
    context_window: int | None = None,
    max_tokens: int | None = None,
    supports_image: bool | None = None,
    reasoning_effort: str | None = None,
    thinking_format: str | None = None,
    fields_set: set[str] | None = None,
) -> LlmProfile:
    provided = fields_set or set()
    if name is not None:
        profile.name = name.strip()
    if base_url is not None:
        profile.base_url = base_url.strip()
    if model is not None:
        profile.model = model.strip()
    if clear_api_key:
        profile.api_key_ciphertext = ""
    elif ciphertext is not None:
        profile.api_key_ciphertext = ciphertext
    if api_protocol is not None:
        profile.api_protocol = api_protocol.strip()
    if "context_window" in provided or context_window is not None:
        profile.context_window = context_window
    if "max_tokens" in provided or max_tokens is not None:
        profile.max_tokens = max_tokens
    if supports_image is not None:
        profile.supports_image = bool(supports_image)
    if "reasoning_effort" in provided or reasoning_effort is not None:
        profile.reasoning_effort = (reasoning_effort or "").strip() or None
    if "thinking_format" in provided or thinking_format is not None:
        profile.thinking_format = (thinking_format or "").strip() or None
    if (profile.api_protocol or "openai-completions") != "openai-completions":
        profile.thinking_format = None
    db.commit()
    db.refresh(profile)
    return profile


def get_idle_sleep_policy(db: Session, settings: Settings) -> tuple[bool, int]:
    """Return global (enabled, idle_minutes) policy with DB override over env defaults."""
    enabled_row = db.get(PlatformSetting, "idle_sleep_enabled")
    minutes_row = db.get(PlatformSetting, "idle_sleep_minutes")

    enabled = settings.idle_sleep_enabled
    if enabled_row is not None:
        enabled = enabled_row.value.strip().lower() in {"1", "true", "yes", "on"}

    idle_minutes = settings.idle_sleep_minutes
    if minutes_row is not None:
        try:
            parsed = int(minutes_row.value.strip())
            if parsed >= 5:
                idle_minutes = parsed
        except ValueError:
            pass
    return enabled, idle_minutes


def set_idle_sleep_policy(
    db: Session,
    enabled: bool,
    idle_minutes: int,
    actor: str | None = None,
) -> tuple[bool, int]:
    """Persist platform idle auto-sleep policy in SQLite and record an audit entry."""
    pairs = {
        "idle_sleep_enabled": "true" if enabled else "false",
        "idle_sleep_minutes": str(idle_minutes),
    }
    now = utcnow()
    for key, val in pairs.items():
        row = db.get(PlatformSetting, key)
        if row is None:
            db.add(PlatformSetting(key=key, value=val, updated_at=now))
        else:
            row.value = val
            row.updated_at = now
    audit(
        db,
        "policy.idle_sleep",
        target="platform",
        detail=f"enabled={enabled},idle_minutes={idle_minutes}",
        actor=actor,
    )
    db.commit()
    return enabled, idle_minutes


def touch_sandbox_activity(
    db: Session,
    sandbox: Sandbox,
    min_interval_seconds: int = 60,
) -> None:
    """Update sandbox.last_seen_at with debouncing so ForwardAuth subrequests avoid write amplification."""
    now = utcnow()
    last = sandbox.last_seen_at
    if last is not None and (now - last).total_seconds() < min_interval_seconds:
        return
    sandbox.last_seen_at = now
    db.commit()