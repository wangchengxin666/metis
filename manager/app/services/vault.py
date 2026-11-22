from __future__ import annotations

import json
import os

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import Settings
from ..docker_service import BaseSandboxRuntime
from ..models import CredentialProfile, Sandbox, WorkspaceSnapshot
from ..schemas import CredentialProfileCreate, CredentialProfileUpdate
from ..security import decrypt_secret, encrypt_secret
from .common import Conflict, NotFoundError, audit


def list_credential_profiles(db: Session) -> list[CredentialProfile]:
    return list(
        db.scalars(
            select(CredentialProfile).order_by(CredentialProfile.name.asc())
        ).all()
    )


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
    raw_env = (payload.env_vars_json or "").strip()
    if raw_env in {"", "{}"}:
        env_cipher = ""
    else:
        env_cipher = encrypt_secret(raw_env)

    profile = CredentialProfile(
        name=payload.name.strip(),
        git_user_name=(payload.git_user_name or "").strip() or None,
        git_user_email=(payload.git_user_email or "").strip() or None,
        git_host=(payload.git_host or "github.com").strip() or "github.com",
        git_token_ciphertext=encrypt_secret(raw_token) if raw_token else "",
        ssh_private_key_ciphertext=encrypt_secret(raw_ssh) if raw_ssh else "",
        env_vars_ciphertext=env_cipher,
        mcp_servers_json=(payload.mcp_servers_json or "{}").strip() or "{}",
    )
    db.add(profile)
    audit(
        db,
        "credential.create",
        target=profile.name,
        detail=f"host={profile.git_host},token={bool(raw_token)},ssh={bool(raw_ssh)}",
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
    if payload.name is not None:
        profile.name = payload.name.strip()
    if payload.git_user_name is not None:
        profile.git_user_name = payload.git_user_name.strip() or None
    if payload.git_user_email is not None:
        profile.git_user_email = payload.git_user_email.strip() or None
    if payload.git_host is not None:
        profile.git_host = payload.git_host.strip() or "github.com"
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
) -> dict[str, object]:
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
            git_host=profile.git_host,
            git_token=git_token,
            ssh_private_key=ssh_key,
            env_vars=env_vars,
            mcp_servers=mcp_servers,
        )
        results.append(res)

    synced = sum(1 for r in results if r.get("ok"))
    skipped = sum(1 for r in results if r.get("skipped"))
    failed = len(results) - synced - skipped
    audit(
        db,
        "credential.push",
        target=profile.name,
        actor=actor,
        detail=f"synced={synced}/{len(results)}",
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


