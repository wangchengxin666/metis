from __future__ import annotations

import json
import logging
import os
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import Settings
from ..docker_service import BaseSandboxRuntime
from ..models import CredentialProfile, Sandbox, WorkspaceSnapshot, utcnow
from ..schemas import CredentialProfileCreate, CredentialProfileUpdate
from ..security import decrypt_secret, encrypt_secret
from .common import Conflict, NotFoundError, audit
from .github_app import (
    ensure_fresh_github_app_token,
    is_github_profile,
    normalize_git_host,
    resolve_github_api_base,
    resolve_github_web_origin,
)

logger = logging.getLogger("dsh-manager.vault")


CREDENTIAL_PRESETS: list[dict[str, object]] = [
    {
        "preset_key": "github-dev",
        "name": "GitHub 研发通用凭据",
        "category": "git",
        "description": "配置 Git 提交身份、GitHub PAT / 自定义内网域名与 `${credential:GITHUB_TOKEN}`，自动驱动 Git 与 GitHub MCP。",
        "git_user_name": "Metis Digital Bot",
        "git_user_email": "bot@corp.example.com",
        "git_host": "github.com",
        "github_auth_mode": "pat",
        "github_api_base_url": "",
        "github_tls_verify": True,
        "suggested_env_keys": ["GITHUB_TOKEN"],
    },
    {
        "preset_key": "github-app-enterprise",
        "name": "GitHub App / 企业内网 GitHub",
        "category": "git",
        "description": "使用 GitHub App (App ID + Installation ID + PEM 私钥) 实时签发并自动续期 1 小时短期 Token，支持企业内网 GHES 自定义域名，私钥永不进入员工容器。",
        "git_user_name": "Metis GitHub App",
        "git_user_email": "github-app[bot]@corp.example.com",
        "git_host": "github.corp.com",
        "github_auth_mode": "github_app",
        "github_api_base_url": "https://github.corp.com/api/v3",
        "github_tls_verify": True,
        "suggested_env_keys": [],
    },
    {
        "preset_key": "gitlab-corp",
        "name": "GitLab 私有代码库凭据",
        "category": "git",
        "description": "配置企业内网 GitLab 域名、提交身份、Access Token 与 SSH 私钥，支持内网 Git HTTPS/SSH 认证。",
        "git_user_name": "Metis CI Bot",
        "git_user_email": "ci-bot@corp.example.com",
        "git_host": "gitlab.corp.com",
        "suggested_env_keys": ["GITLAB_TOKEN"],
    },
    {
        "preset_key": "search-docs-api",
        "name": "AI 搜索与文档检索 API",
        "category": "api",
        "description": "为全网检索与文档 MCP（如 Brave / Tavily / Context7）注入 API Key，自动同步至 `.credentials.yaml` 与容器环境变量。",
        "git_user_name": "",
        "git_user_email": "",
        "git_host": "github.com",
        "suggested_env_keys": ["BRAVE_API_KEY", "TAVILY_API_KEY", "CONTEXT7_API_KEY"],
    },
    {
        "preset_key": "cloud-db-readonly",
        "name": "数据库与对象存储只读凭据",
        "category": "database",
        "description": "集中管理 Postgres 只读连接串 (`POSTGRES_URL`) 与 S3/OSS 访问密钥，配合数据库 MCP 与 BI 分析员工安全使用。",
        "git_user_name": "",
        "git_user_email": "",
        "git_host": "github.com",
        "suggested_env_keys": ["POSTGRES_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
    },
    {
        "preset_key": "im-open-platform",
        "name": "飞书 / 企微开放平台凭据",
        "category": "im",
        "description": "为数字员工注入飞书机器人 / 企业微信应用凭证，支持消息群发、审批单查询与日历/文档自动化。",
        "git_user_name": "",
        "git_user_email": "",
        "git_host": "github.com",
        "suggested_env_keys": ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "WECOM_CORP_ID"],
    },
    {
        "preset_key": "pkg-registry-token",
        "name": "私有包仓库与容器凭据",
        "category": "dev",
        "description": "注入私有 npm / PyPI / Harbor 拉取与发布凭证，供研发、构建与发布类数字员工使用。",
        "git_user_name": "",
        "git_user_email": "",
        "git_host": "github.com",
        "suggested_env_keys": ["NPM_TOKEN", "UV_INDEX_TOKEN"],
    },
]


def list_credential_presets() -> list[dict[str, object]]:
    return CREDENTIAL_PRESETS


def list_credential_profiles(db: Session) -> list[CredentialProfile]:
    return list(
        db.scalars(
            select(CredentialProfile).order_by(CredentialProfile.name.asc())
        ).all()
    )


def seed_credential_presets(
    db: Session,
    *,
    actor: str | None = None,
) -> list[CredentialProfile]:
    created = 0
    for preset in CREDENTIAL_PRESETS:
        key = str(preset["preset_key"])
        name = str(preset["name"])
        existing = db.scalar(
            select(CredentialProfile).where(
                (CredentialProfile.preset_key == key) | (CredentialProfile.name == name)
            )
        )
        if existing is not None:
            continue
        db.add(
            CredentialProfile(
                name=name,
                preset_key=key,
                category=str(preset.get("category") or "custom"),
                description=str(preset.get("description") or "") or None,
                git_user_name=str(preset.get("git_user_name") or "") or None,
                git_user_email=str(preset.get("git_user_email") or "") or None,
                git_host=str(preset.get("git_host") or "github.com"),
                github_auth_mode=str(preset.get("github_auth_mode") or "pat"),
                github_api_base_url=str(preset.get("github_api_base_url") or "") or None,
                github_tls_verify=bool(preset.get("github_tls_verify", True)),
                git_token_ciphertext="",
                ssh_private_key_ciphertext="",
                github_app_private_key_ciphertext="",
                github_app_cached_token_ciphertext="",
                env_vars_ciphertext="",
                mcp_servers_json="{}",
            )
        )
        created += 1
    audit(db, "credential.seed_presets", target="credential-presets", detail=f"created={created}", actor=actor)
    db.commit()
    return list_credential_profiles(db)


def create_credential_profile(
    db: Session,
    payload: CredentialProfileCreate,
    *,
    actor: str | None = None,
) -> CredentialProfile:
    if db.scalar(
        select(CredentialProfile).where(CredentialProfile.name == payload.name.strip())
    ):
        raise Conflict(f"凭据配置 '{payload.name.strip()}' 已存在")

    raw_token = (payload.git_token or "").strip()
    raw_ssh = (payload.ssh_private_key or "").strip()
    raw_app_pem = (payload.github_app_private_key or "").strip()
    raw_env = (payload.env_vars_json or "").strip()
    if raw_env in {"", "{}"}:
        env_cipher = ""
    else:
        env_cipher = encrypt_secret(raw_env)

    profile = CredentialProfile(
        name=payload.name.strip(),
        preset_key=(payload.preset_key or "").strip() or None,
        category=(payload.category or "custom").strip() or "custom",
        description=(payload.description or "").strip() or None,
        git_user_name=(payload.git_user_name or "").strip() or None,
        git_user_email=(payload.git_user_email or "").strip() or None,
        git_host=normalize_git_host(payload.git_host),
        github_auth_mode=payload.github_auth_mode or "pat",
        github_api_base_url=payload.github_api_base_url,
        github_app_id=(payload.github_app_id or "").strip() or None,
        github_app_installation_id=(payload.github_app_installation_id or "").strip() or None,
        github_tls_verify=bool(payload.github_tls_verify),
        git_token_ciphertext=encrypt_secret(raw_token) if raw_token else "",
        ssh_private_key_ciphertext=encrypt_secret(raw_ssh) if raw_ssh else "",
        github_app_private_key_ciphertext=encrypt_secret(raw_app_pem) if raw_app_pem else "",
        github_app_cached_token_ciphertext="",
        env_vars_ciphertext=env_cipher,
        mcp_servers_json=(payload.mcp_servers_json or "{}").strip() or "{}",
    )
    db.add(profile)
    audit(
        db,
        "credential.create",
        target=profile.name,
        detail=f"host={profile.git_host},mode={profile.github_auth_mode},token={bool(raw_token)},ssh={bool(raw_ssh)},app_key={bool(raw_app_pem)}",
        actor=actor,
    )
    db.commit()
    db.refresh(profile)
    return profile


def update_credential_profile(
    db: Session,
    profile: CredentialProfile,
    payload: CredentialProfileUpdate,
    *,
    actor: str | None = None,
) -> CredentialProfile:
    invalidate_app_token = False

    if payload.name is not None:
        profile.name = payload.name.strip()
    if payload.preset_key is not None:
        profile.preset_key = payload.preset_key.strip() or None
    if payload.category is not None:
        profile.category = payload.category.strip() or "custom"
    if payload.description is not None:
        profile.description = payload.description.strip() or None
    if payload.git_user_name is not None:
        profile.git_user_name = payload.git_user_name.strip() or None
    if payload.git_user_email is not None:
        profile.git_user_email = payload.git_user_email.strip() or None
    if payload.git_host is not None:
        next_host = normalize_git_host(payload.git_host)
        if next_host != profile.git_host:
            invalidate_app_token = True
        profile.git_host = next_host
    if payload.github_auth_mode is not None:
        if payload.github_auth_mode != profile.github_auth_mode:
            invalidate_app_token = True
        profile.github_auth_mode = payload.github_auth_mode
    if "github_api_base_url" in payload.model_fields_set:
        if payload.github_api_base_url != profile.github_api_base_url:
            invalidate_app_token = True
        profile.github_api_base_url = payload.github_api_base_url
    if payload.github_app_id is not None:
        next_aid = payload.github_app_id.strip() or None
        if next_aid != profile.github_app_id:
            invalidate_app_token = True
        profile.github_app_id = next_aid
    if payload.github_app_installation_id is not None:
        next_iid = payload.github_app_installation_id.strip() or None
        if next_iid != profile.github_app_installation_id:
            invalidate_app_token = True
        profile.github_app_installation_id = next_iid
    if payload.github_tls_verify is not None:
        profile.github_tls_verify = bool(payload.github_tls_verify)
    if payload.clear_github_app_private_key:
        profile.github_app_private_key_ciphertext = ""
        invalidate_app_token = True
    elif payload.github_app_private_key is not None and payload.github_app_private_key.strip():
        profile.github_app_private_key_ciphertext = encrypt_secret(
            payload.github_app_private_key.strip()
        )
        invalidate_app_token = True

    if invalidate_app_token:
        profile.github_app_cached_token_ciphertext = ""
        profile.github_app_token_expires_at = None

    if payload.clear_git_token:
        profile.git_token_ciphertext = ""
    elif payload.git_token is not None and payload.git_token.strip():
        profile.git_token_ciphertext = encrypt_secret(payload.git_token.strip())
    if payload.clear_ssh_key:
        profile.ssh_private_key_ciphertext = ""
    elif payload.ssh_private_key is not None and payload.ssh_private_key.strip():
        profile.ssh_private_key_ciphertext = encrypt_secret(
            payload.ssh_private_key.strip()
        )
    if payload.env_vars_json is not None:
        clean_env = payload.env_vars_json.strip()
        profile.env_vars_ciphertext = (
            "" if clean_env in {"", "{}"} else encrypt_secret(clean_env)
        )
    if payload.mcp_servers_json is not None:
        profile.mcp_servers_json = payload.mcp_servers_json.strip() or "{}"

    audit(
        db,
        "credential.update",
        target=profile.name,
        actor=actor,
    )
    db.commit()
    db.refresh(profile)
    return profile


def delete_credential_profile(
    db: Session,
    profile: CredentialProfile,
    *,
    actor: str | None = None,
) -> None:
    name = profile.name
    audit(db, "credential.delete", target=name, actor=actor)
    db.delete(profile)
    db.commit()


def push_credential_profile(
    db: Session,
    docker: BaseSandboxRuntime,
    profile: CredentialProfile,
    sandboxes: list[Sandbox],
    *,
    actor: str | None = None,
    force_refresh_github_app: bool = False,
) -> dict[str, object]:
    auth_mode = (getattr(profile, "github_auth_mode", None) or "pat").strip().lower()
    is_gh = is_github_profile(
        git_host=profile.git_host,
        github_auth_mode=auth_mode,
        preset_key=profile.preset_key,
        github_api_base_url=getattr(profile, "github_api_base_url", None),
    )

    if auth_mode == "github_app":
        git_token = ensure_fresh_github_app_token(
            db, profile, force_refresh=force_refresh_github_app
        )
    else:
        git_token = (
            decrypt_secret(profile.git_token_ciphertext)
            if profile.git_token_ciphertext
            else ""
        )

    ssh_key = (
        decrypt_secret(profile.ssh_private_key_ciphertext)
        if profile.ssh_private_key_ciphertext
        else ""
    )
    env_vars: dict[str, str] = {}
    if profile.env_vars_ciphertext:
        try:
            raw_env = json.loads(decrypt_secret(profile.env_vars_ciphertext))
            if isinstance(raw_env, dict):
                env_vars = {str(k): str(v) for k, v in raw_env.items()}
        except Exception:
            pass

    clean_host = normalize_git_host(profile.git_host)
    api_base: str | None = None
    git_auth_username = "oauth2"
    if is_gh:
        git_auth_username = "x-access-token"
        web_origin = resolve_github_web_origin(
            profile.git_host, getattr(profile, "github_api_base_url", None)
        )
        api_base = resolve_github_api_base(
            profile.git_host, getattr(profile, "github_api_base_url", None)
        )
        env_vars.setdefault("GITHUB_HOST", web_origin)
        env_vars.setdefault("GITHUB_API_URL", api_base)
        if git_token:
            # GitHub App installation tokens are always pushed fresh into GITHUB_TOKEN / PAT refs.
            if auth_mode == "github_app":
                env_vars["GITHUB_TOKEN"] = git_token
                env_vars["GITHUB_PERSONAL_ACCESS_TOKEN"] = git_token
            else:
                env_vars.setdefault("GITHUB_TOKEN", git_token)
                env_vars.setdefault("GITHUB_PERSONAL_ACCESS_TOKEN", git_token)

    mcp_servers: dict[str, object] = {}
    if profile.mcp_servers_json:
        try:
            raw_mcp = json.loads(profile.mcp_servers_json)
            if isinstance(raw_mcp, dict):
                mcp_servers = raw_mcp.get("mcpServers", raw_mcp)
        except Exception:
            pass

    results = []
    for sbx in sandboxes:
        res = docker.sync_credential_profile(
            sbx,
            git_user_name=profile.git_user_name,
            git_user_email=profile.git_user_email,
            git_host=clean_host,
            git_token=git_token,
            ssh_private_key=ssh_key,
            env_vars=env_vars,
            mcp_servers=mcp_servers,
            github_api_base_url=api_base,
            git_auth_username=git_auth_username,
            github_tls_verify=bool(getattr(profile, "github_tls_verify", True)),
            is_github=is_gh,
        )
        results.append(res)

    synced = sum(1 for r in results if r.get("ok"))
    skipped = sum(1 for r in results if r.get("skipped"))
    failed = len(results) - synced - skipped
    target_slugs = ",".join(s.slug for s in sandboxes[:10])
    if len(sandboxes) > 10:
        target_slugs += f",+{len(sandboxes) - 10}"
    audit(
        db,
        "credential.push",
        target=profile.name,
        actor=actor,
        detail=f"mode={auth_mode},host={clean_host},synced={synced}/{len(results)},targets={target_slugs}",
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


def refresh_github_app_profile_token(
    db: Session,
    docker: BaseSandboxRuntime,
    profile: CredentialProfile,
    *,
    push_to_bound: bool = True,
    actor: str | None = None,
) -> dict[str, object]:
    """Force-mint a fresh GitHub App installation token and optionally hot-push to bound sandboxes."""
    if (getattr(profile, "github_auth_mode", "pat") or "pat").strip().lower() != "github_app":
        raise ValueError("当前凭据包未启用 GitHub App 认证模式")

    ensure_fresh_github_app_token(db, profile, force_refresh=True)
    push_res: dict[str, object] | None = None
    if push_to_bound:
        bound_running = [
            sbx
            for sbx in db.scalars(
                select(Sandbox).where(
                    Sandbox.deleted_at.is_(None),
                    Sandbox.status == "running",
                )
            ).all()
            if profile.id in sbx.credential_profile_ids
        ]
        if bound_running:
            push_res = push_credential_profile(
                db, docker, profile, bound_running, actor=actor
            )
    audit(
        db,
        "credential.github_app_refresh",
        target=profile.name,
        actor=actor,
        detail=f"host={profile.git_host},pushed={push_res['synced'] if push_res else 0}",
    )
    db.commit()
    db.refresh(profile)
    return {
        "ok": True,
        "profile_id": profile.id,
        "expires_at": profile.github_app_token_expires_at,
        "pushed": push_res,
    }


def refresh_expiring_github_app_credentials(
    db: Session,
    docker: BaseSandboxRuntime,
    *,
    refresh_window_minutes: int = 15,
) -> int:
    """Auto-renew GitHub App installation tokens bound to running sandboxes before expiry."""
    app_profiles = list(
        db.scalars(
            select(CredentialProfile).where(
                CredentialProfile.github_auth_mode == "github_app",
                CredentialProfile.github_app_private_key_ciphertext != "",
            )
        ).all()
    )
    if not app_profiles:
        return 0

    running_sandboxes = list(
        db.scalars(
            select(Sandbox).where(
                Sandbox.deleted_at.is_(None),
                Sandbox.status == "running",
            )
        ).all()
    )
    if not running_sandboxes:
        return 0

    now = utcnow()
    cutoff = now + timedelta(minutes=refresh_window_minutes)
    refreshed = 0
    for profile in app_profiles:
        targets = [sbx for sbx in running_sandboxes if profile.id in sbx.credential_profile_ids]
        if not targets:
            continue
        exp = profile.github_app_token_expires_at
        if profile.github_app_cached_token_ciphertext and exp is not None and exp > cutoff:
            continue
        try:
            push_credential_profile(
                db,
                docker,
                profile,
                targets,
                actor="system:github-app-renew",
                force_refresh_github_app=True,
            )
            refreshed += 1
        except Exception:
            logger.warning("GitHub App auto-renew failed for profile %s", profile.name)
    return refreshed


def sync_bound_credentials(
    db: Session,
    docker: BaseSandboxRuntime,
    sandbox: Sandbox,
    *,
    actor: str | None = None,
) -> list[dict[str, object]]:
    """Sync only the credential profiles explicitly bound to a sandbox (least-privilege)."""
    bound_ids = sandbox.credential_profile_ids
    if not bound_ids:
        return []
    profiles_by_id = {
        p.id: p
        for p in db.scalars(
            select(CredentialProfile).where(CredentialProfile.id.in_(bound_ids))
        ).all()
    }
    results: list[dict[str, object]] = []
    for pid in bound_ids:
        profile = profiles_by_id.get(pid)
        if profile is None:
            continue
        try:
            res = push_credential_profile(
                db, docker, profile, [sandbox], actor=actor
            )
            results.append(res)
        except Exception:
            continue
    return results


def list_workspace_snapshots(
    db: Session,
    sandbox_id: str,
) -> list[WorkspaceSnapshot]:
    return list(
        db.scalars(
            select(WorkspaceSnapshot)
            .where(WorkspaceSnapshot.sandbox_id == sandbox_id)
            .order_by(WorkspaceSnapshot.created_at.desc())
        ).all()
    )


def create_workspace_snapshot(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    sandbox: Sandbox,
    *,
    name: str,
    note: str | None = None,
    exclude_caches: bool = True,
    actor: str | None = None,
) -> WorkspaceSnapshot:
    snap_dir = settings.data_dir / "snapshots"
    snap_dir.mkdir(parents=True, exist_ok=True)
    snap = WorkspaceSnapshot(
        sandbox_id=sandbox.id,
        sandbox_slug=sandbox.slug,
        name=name.strip(),
        note=note.strip() if note else None,
        file_path="",
        size_mb=0.0,
        created_by=actor,
    )
    db.add(snap)
    db.flush()
    file_path = snap_dir / f"{sandbox.slug}-{snap.id}.tar"
    total_bytes = 0
    with open(file_path, "wb") as fh:
        for chunk in docker.export_workspace_tar(
            sandbox, exclude_caches=exclude_caches
        ):
            if chunk:
                fh.write(chunk)
                total_bytes += len(chunk)
    snap.file_path = str(file_path)
    snap.size_mb = round(total_bytes / (1024 * 1024), 2)
    audit(
        db,
        "sandbox.snapshot_create",
        target=sandbox.id,
        actor=actor,
        detail=f"slug={sandbox.slug},snapshot={snap.name},size_mb={snap.size_mb}",
    )
    db.commit()
    db.refresh(snap)
    return snap


def restore_workspace_snapshot(
    db: Session,
    docker: BaseSandboxRuntime,
    sandbox: Sandbox,
    snapshot_id: str,
    *,
    mode: str = "merge",
    actor: str | None = None,
) -> dict[str, object]:
    snap = db.get(WorkspaceSnapshot, snapshot_id)
    if not snap or snap.sandbox_id != sandbox.id:
        raise NotFoundError("快照不存在")
    if not os.path.exists(snap.file_path):
        raise NotFoundError("快照文件已丢失")
    with open(snap.file_path, "rb") as fh:
        res = docker.restore_workspace_tar(sandbox, fh, mode=mode)
    audit(
        db,
        "sandbox.snapshot_restore",
        target=sandbox.id,
        actor=actor,
        detail=f"slug={sandbox.slug},snapshot={snap.name},mode={mode}",
    )
    db.commit()
    return {"ok": True, "snapshot_id": snap.id, "name": snap.name, **res}


def delete_workspace_snapshot(
    db: Session,
    sandbox: Sandbox,
    snapshot_id: str,
    *,
    actor: str | None = None,
) -> None:
    snap = db.get(WorkspaceSnapshot, snapshot_id)
    if not snap or snap.sandbox_id != sandbox.id:
        raise NotFoundError("快照不存在")
    try:
        if snap.file_path and os.path.exists(snap.file_path):
            os.remove(snap.file_path)
    except Exception:
        pass
    audit(
        db,
        "sandbox.snapshot_delete",
        target=sandbox.id,
        actor=actor,
        detail=f"slug={sandbox.slug},snapshot={snap.name}",
    )
    db.delete(snap)
    db.commit()


