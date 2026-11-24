from __future__ import annotations

import io
import json
import secrets
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..config import DEFAULT_AUTO_INSTALL_PLUGINS, Settings
from ..docker_service import BaseSandboxRuntime, DockerService, SandboxRuntimeError
from ..models import LlmProfile, Sandbox, Team, TeamSandbox, User
from ..security import hash_password
from .common import (
    Conflict,
    ManagerError,
    NotFoundError,
    _normalize_init_script,
    audit,
    get_or_create_user,
    unique_slug,
    utcnow,
)
from .llm_gateway import generate_sandbox_gateway_key
from .policies import get_branding_config, get_extra_plugin_indexes
from .templates import get_template_by_key
from .vault import sync_bound_credentials


def _attach_extra_plugin_indexes(db: Session, sandbox: Sandbox) -> None:
    try:
        items = get_extra_plugin_indexes(db)
        sandbox._extra_plugin_indexes = [
            str(x["url"]) for x in items if x.get("enabled", True) and x.get("url")
        ]
    except Exception:
        sandbox._extra_plugin_indexes = []
    try:
        cfg = get_branding_config(db)
        theme = cfg.get("brand_theme") if isinstance(cfg.get("brand_theme"), dict) else {}
        sandbox._brand_theme_payload = {
            "primary": str(theme.get("primary") or "#6366f1"),
            "accent": str(theme.get("accent") or "#06b6d4"),
            "mode": str(theme.get("mode") or "dark"),
            "brandTitle": str(cfg.get("brand_name_zh") or cfg.get("brand_name_en") or "Metis"),
            "brandLogoSvg": str(cfg.get("brand_logo_svg") or ""),
        }
    except Exception:
        sandbox._brand_theme_payload = None


def create_sandbox(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
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
    role_title: str | None = None,
    role_description: str | None = None,
    role_sop: str | None = None,
    preview_auth_mode: str = "public",
    daily_token_limit: int | None = None,
    daily_cost_limit: float | None = None,
    budget_action: str = "block",
    ownership_mode: str = "personal",
    maintainer_emails: list[str] | None = None,
    team_ids: list[str] | None = None,
    credential_profile_ids: list[str] | None = None,
    set_new_user_display_name: bool = True,
) -> Sandbox:
    email = email.strip().lower()
    clean_display_name = display_name.strip() if display_name and display_name.strip() else None
    pw_hash = hash_password(initial_password) if initial_password else None
    user = get_or_create_user(
        db,
        email,
        clean_display_name if set_new_user_display_name else None,
        password_hash=pw_hash,
    )
    final_slug = unique_slug(db, email, slug)

    tpl_key = (template or "agent-os").strip()
    tpl_obj = get_template_by_key(db, tpl_key)

    effective_llm_id = llm_profile_id or (
        tpl_obj.default_llm_profile_id if tpl_obj else None
    )
    resolved_cred_ids = (
        list(dict.fromkeys(str(x).strip() for x in credential_profile_ids if str(x).strip()))
        if credential_profile_ids is not None
        else (tpl_obj.default_credential_profile_ids if tpl_obj else [])
    )
    llm_profile: LlmProfile | None = None
    if effective_llm_id:
        llm_profile = db.get(LlmProfile, effective_llm_id)
        if not llm_profile and llm_profile_id:
            raise NotFoundError(f"llm profile not found: {llm_profile_id}")

    resolved_role_title = (
        (role_title.strip() if role_title is not None else None)
        or (tpl_obj.role_title if tpl_obj else None)
    )
    resolved_role_desc = (
        (role_description.strip() if role_description is not None else None)
        or (tpl_obj.role_description if tpl_obj else None)
    )
    resolved_role_sop = (
        (role_sop.strip() if role_sop is not None else None)
        or (tpl_obj.role_sop if tpl_obj else None)
    )

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
        display_name=clean_display_name,
        volume_name=f"dsh-{final_slug}-home",
        image_repo=resolved_repo,
        image_tag=resolved_tag,
        template=tpl_key,
        role_title=resolved_role_title,
        role_description=resolved_role_desc,
        role_sop=resolved_role_sop,
        init_repo_url=init_repo_url.strip() if init_repo_url else None,
        init_script=resolved_script,
        extra_env_json=resolved_env_json,
        auto_install_plugins=resolved_plugins,
        cpu_limit=resolved_cpu,
        memory_limit=resolved_mem,
        auto_sleep_exempt=auto_sleep_exempt,
        preview_auth_mode=(
            preview_auth_mode
            if preview_auth_mode in {"public", "authenticated", "team"}
            else "public"
        ),
        ownership_mode=(
            ownership_mode if ownership_mode in {"personal", "shared"} else "personal"
        ),
        maintainer_emails_json=json.dumps(
            list(
                dict.fromkeys(
                    str(e).strip().lower()
                    for e in (maintainer_emails or [])
                    if str(e).strip()
                )
            )
        ),
        webhook_token=secrets.token_hex(16),
        gateway_api_key=generate_sandbox_gateway_key(),
        daily_token_limit=daily_token_limit,
        daily_cost_limit=(
            round(float(daily_cost_limit), 4)
            if daily_cost_limit is not None and float(daily_cost_limit) > 0
            else None
        ),
        budget_action=(
            budget_action if budget_action in {"block", "downgrade", "warn"} else "block"
        ),
        credential_profile_ids_json=json.dumps(resolved_cred_ids),
        llm_profile_id=llm_profile.id if llm_profile else None,
        status="creating",
    )
    db.add(sandbox)
    db.flush()
    if team_ids:
        clean_tids = list(dict.fromkeys(str(t).strip() for t in team_ids if str(t).strip()))
        matched_teams = list(db.scalars(select(Team).where(Team.id.in_(clean_tids))).all())
        for idx_t, tm in enumerate(matched_teams):
            db.add(TeamSandbox(team_id=tm.id, sandbox_id=sandbox.id, is_moderator=False))
            if idx_t == 0 and not sandbox.project_team_name:
                sandbox.project_team_name = tm.name
    sandbox.user = user
    sandbox.llm_profile = llm_profile
    db.commit()
    db.refresh(sandbox)
    _attach_extra_plugin_indexes(db, sandbox)

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

    if hasattr(docker, "sync_role_profile") and (
        sandbox.role_title or sandbox.role_description or sandbox.role_sop
    ):
        try:
            docker.sync_role_profile(sandbox)
        except Exception:
            pass

    if resolved_cred_ids and hasattr(docker, "sync_credential_profile"):
        try:
            sync_bound_credentials(db, docker, sandbox)
        except Exception:
            pass

    sandbox.status = "running"
    sandbox.last_seen_at = utcnow()
    audit(db, "sandbox.create", target=sandbox.id, detail=f"slug={sandbox.slug}")
    db.commit()
    db.refresh(sandbox)

    if team_ids:
        from .teams import sync_project_mesh_group

        clean_tids = list(dict.fromkeys(str(t).strip() for t in team_ids if str(t).strip()))
        for tid in clean_tids:
            tm = db.get(Team, tid)
            if tm is not None:
                try:
                    sync_project_mesh_group(db, tm, docker, actor=user.email)
                except Exception:
                    pass

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


def refresh_statuses(
    db: Session, docker: DockerService, sandboxes: list[Sandbox], max_workers: int = 16
) -> list[Sandbox]:
    """Refresh many sandboxes' runtime status in batch with a single DB commit.

    Delegates to ``docker.statuses(...)`` (single ``containers.list`` on Docker,
    concurrent probes on runtimes without a bulk API) so refreshing N sandboxes
    takes one round-trip instead of N serial inspects.
    """
    if not sandboxes:
        return sandboxes

    status_map: dict[str, str] | None = None
    if hasattr(docker, "statuses"):
        try:
            status_map = docker.statuses(sandboxes, max_workers=max_workers)
        except Exception:
            status_map = None

    if status_map is None:
        def _probe(sbx: Sandbox) -> str:
            try:
                return docker.status(sbx)
            except Exception:
                return "unknown"

        if len(sandboxes) == 1:
            results = [_probe(sandboxes[0])]
        else:
            workers = max(1, min(max_workers, len(sandboxes)))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                results = list(pool.map(_probe, sandboxes))
        status_map = {sbx.id: st for sbx, st in zip(sandboxes, results)}

    now = utcnow()
    for sbx in sandboxes:
        current = status_map.get(sbx.id, "unknown")
        if current not in {"unknown"}:
            sbx.status = current
        sbx.last_seen_at = now
    db.commit()
    return sandboxes


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
            _attach_extra_plugin_indexes(db, sandbox)
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
        _attach_extra_plugin_indexes(db, sandbox)
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




def clone_sandbox(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    source_sandbox_id: str,
    *,
    email: str,
    slug: str | None = None,
    display_name: str | None = None,
    role_title: str | None = None,
    exclude_caches: bool = True,
    actor: str | None = None,
) -> Sandbox:
    """Clone an existing digital employee's workspace, role profile, image, and LLM binding."""
    import tempfile

    source = load_sandbox(db, source_sandbox_id)
    cloned = create_sandbox(
        db,
        settings,
        docker,
        email=email,
        slug=slug,
        display_name=display_name or source.effective_display_name,
        set_new_user_display_name=False,
        image_repo=source.image_repo,
        image_tag=source.image_tag,
        cpu_limit=source.cpu_limit,
        memory_limit=source.memory_limit,
        llm_profile_id=source.llm_profile_id,
        template=source.template,
        init_repo_url=source.init_repo_url,
        init_script=source.init_script,
        auto_install_plugins=source.auto_install_plugins,
        auto_sleep_exempt=source.auto_sleep_exempt,
        role_title=role_title if role_title is not None else source.role_title,
        role_description=source.role_description,
        role_sop=source.role_sop,
        preview_auth_mode=source.preview_auth_mode or "public",
        ownership_mode=getattr(source, "ownership_mode", "personal") or "personal",
        maintainer_emails=source.maintainer_emails,
        budget_action=getattr(source, "budget_action", "block") or "block",
        credential_profile_ids=source.credential_profile_ids,
    )
    if source.status == "running":
        tmp = tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024)
        try:
            for chunk in docker.export_workspace_tar(
                source, exclude_caches=exclude_caches
            ):
                if chunk:
                    tmp.write(chunk)
            if tmp.tell() > 0:
                tmp.seek(0)
                docker.restore_workspace_tar(cloned, tmp, mode="merge")
                if hasattr(docker, "sync_role_profile"):
                    try:
                        docker.sync_role_profile(cloned)
                    except Exception:
                        pass
        except Exception:
            pass
        finally:
            tmp.close()

    audit(
        db,
        "sandbox.clone",
        target=cloned.id,
        detail=f"from={source.slug},to={cloned.slug}",
        actor=actor,
    )
    db.commit()
    db.refresh(cloned)
    return cloned


