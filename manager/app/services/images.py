"""Container registry credential management, K8s pull secret sync, and digital employee image factory."""

from __future__ import annotations

import base64
import fnmatch
import io
import json
import re
import tarfile
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from ..config import Settings
from ..coordination import cluster_lock
from ..models import ContainerRegistry, ImageBuildJob, SandboxTemplate
from ..security import decrypt_secret, encrypt_secret
from .bootstrap import (
    NETWORK_PRESET_MIRRORS,
    get_runtime_settings,
    resolve_sandbox_src_dir,
)
from .common import Conflict, NotFoundError, audit, utcnow

_MAX_LOG_CHARS = 180_000
_SENSITIVE_LOG_RE = re.compile(r"(password|token|secret|auth)\s*[:=]\s*\S+", re.IGNORECASE)


def _sanitize_text(text: str) -> str:
    return _SENSITIVE_LOG_RE.sub(r"\1=[REDACTED]", text)


def parse_image_registry_host(image_ref: str) -> str:
    """Extract normalized container registry host[:port] from a Docker image reference."""
    clean = (image_ref or "").strip()
    if not clean:
        return "docker.io"
    if "@" in clean:
        clean = clean.split("@", 1)[0]
    if "/" not in clean:
        return "docker.io"
    first = clean.split("/", 1)[0].strip().lower()
    if "." in first or ":" in first or first == "localhost":
        if first in {"docker.io", "index.docker.io", "registry-1.docker.io"}:
            return "docker.io"
        return first
    return "docker.io"


def normalize_registry_host(host: str) -> str:
    clean = (host or "").strip().lower()
    for prefix in ("https://", "http://"):
        if clean.startswith(prefix):
            clean = clean[len(prefix) :]
    clean = clean.split("/", 1)[0].strip()
    if clean in {"index.docker.io", "registry-1.docker.io", "docker.io"}:
        return "docker.io"
    return clean


def docker_login_server(registry_host: str) -> str:
    host = normalize_registry_host(registry_host)
    if host == "docker.io":
        return "https://index.docker.io/v1/"
    return host


def registry_to_out_dict(reg: ContainerRegistry) -> dict[str, Any]:
    return {
        "id": reg.id,
        "name": reg.name,
        "registry_host": reg.registry_host,
        "username": reg.username,
        "has_password": reg.has_password,
        "tls_verify": bool(reg.tls_verify),
        "is_default": bool(reg.is_default),
        "k8s_secret_name": reg.k8s_secret_name,
        "last_test_ok": reg.last_test_ok,
        "last_tested_at": reg.last_tested_at,
        "last_error": reg.last_error,
        "created_at": reg.created_at,
        "updated_at": reg.updated_at,
    }


def list_registries(db: Session) -> list[ContainerRegistry]:
    return list(
        db.scalars(
            select(ContainerRegistry).order_by(
                ContainerRegistry.is_default.desc(),
                ContainerRegistry.name.asc(),
            )
        ).all()
    )


def find_registry_for_image(
    db: Session, image_ref: str, registry_id: str | None = None
) -> ContainerRegistry | None:
    if registry_id:
        reg = db.get(ContainerRegistry, registry_id)
        if not reg:
            raise NotFoundError(f"container registry not found: {registry_id}")
        return reg
    host = parse_image_registry_host(image_ref)
    candidates = [host]
    if host == "docker.io":
        candidates.extend(["index.docker.io", "https://index.docker.io/v1/"])
    return db.scalar(
        select(ContainerRegistry).where(ContainerRegistry.registry_host.in_(candidates))
    )


def auth_config_for_registry(reg: ContainerRegistry | None) -> dict[str, str] | None:
    if reg is None or not reg.username or not reg.password_ciphertext:
        return None
    password = decrypt_secret(reg.password_ciphertext)
    return {
        "username": reg.username,
        "password": password,
        "registry": docker_login_server(reg.registry_host),
        "registry_host": reg.registry_host,
    }


def auth_configs_map(db: Session) -> dict[str, dict[str, str]]:
    """Build {host: {username, password}} auth map for all stored registries (in memory only)."""
    out: dict[str, dict[str, str]] = {}
    for reg in list_registries(db):
        cfg = auth_config_for_registry(reg)
        if not cfg:
            continue
        creds = {"username": cfg["username"], "password": cfg["password"]}
        out[reg.registry_host] = creds
        if reg.registry_host == "docker.io":
            out["https://index.docker.io/v1/"] = creds
            out["index.docker.io"] = creds
    return out


def resolve_auth_config_for_image(
    db: Session, image_ref: str, registry_id: str | None = None
) -> dict[str, str] | None:
    reg = find_registry_for_image(db, image_ref, registry_id=registry_id)
    cfg = auth_config_for_registry(reg)
    if not cfg:
        return None
    return {"username": cfg["username"], "password": cfg["password"]}


def sync_k8s_registry_secrets(db: Session, runtime: Any) -> bool:
    """Push encrypted registry credentials as kubernetes.io/dockerconfigjson when running on K8s."""
    if getattr(runtime, "runtime_name", "") != "kubernetes" or not hasattr(
        runtime, "sync_registry_secrets"
    ):
        return False
    regs = list_registries(db)
    auths: dict[str, dict[str, str]] = {}
    for reg in regs:
        cfg = auth_config_for_registry(reg)
        if not cfg:
            continue
        raw_auth = base64.b64encode(
            f"{cfg['username']}:{cfg['password']}".encode("utf-8")
        ).decode("ascii")
        entry = {
            "username": cfg["username"],
            "password": cfg["password"],
            "auth": raw_auth,
        }
        if reg.registry_host == "docker.io":
            auths["https://index.docker.io/v1/"] = entry
        else:
            auths[reg.registry_host] = entry
    secret_name = runtime.sync_registry_secrets(auths)
    for reg in regs:
        reg.k8s_secret_name = secret_name if auths else None
    db.commit()
    return True


def create_registry(
    db: Session,
    runtime: Any,
    *,
    name: str,
    registry_host: str,
    username: str,
    password: str,
    tls_verify: bool = True,
    is_default: bool = False,
    actor: str | None = None,
) -> ContainerRegistry:
    clean_host = normalize_registry_host(registry_host)
    if db.scalar(select(ContainerRegistry).where(ContainerRegistry.name == name.strip())):
        raise Conflict(f"镜像仓库名称已存在: {name}")
    if db.scalar(select(ContainerRegistry).where(ContainerRegistry.registry_host == clean_host)):
        raise Conflict(f"镜像仓库地址已存在: {clean_host}")
    if is_default:
        for existing in list_registries(db):
            existing.is_default = False
    reg = ContainerRegistry(
        name=name.strip(),
        registry_host=clean_host,
        username=username.strip(),
        password_ciphertext=encrypt_secret(password),
        tls_verify=tls_verify,
        is_default=is_default,
    )
    db.add(reg)
    audit(
        db,
        "registry.create",
        target=clean_host,
        detail=f"name={reg.name}, host={clean_host}, user={reg.username}",
        actor=actor,
    )
    db.commit()
    db.refresh(reg)
    try:
        sync_k8s_registry_secrets(db, runtime)
    except Exception:
        pass
    db.refresh(reg)
    return reg


def update_registry(
    db: Session,
    runtime: Any,
    registry_id: str,
    *,
    name: str | None = None,
    registry_host: str | None = None,
    username: str | None = None,
    password: str | None = None,
    tls_verify: bool | None = None,
    is_default: bool | None = None,
    actor: str | None = None,
) -> ContainerRegistry:
    reg = db.get(ContainerRegistry, registry_id)
    if not reg:
        raise NotFoundError(f"container registry not found: {registry_id}")
    if name is not None:
        clean_name = name.strip()
        dup = db.scalar(
            select(ContainerRegistry).where(
                ContainerRegistry.name == clean_name,
                ContainerRegistry.id != registry_id,
            )
        )
        if dup:
            raise Conflict(f"镜像仓库名称已存在: {clean_name}")
        reg.name = clean_name
    if registry_host is not None:
        clean_host = normalize_registry_host(registry_host)
        dup_h = db.scalar(
            select(ContainerRegistry).where(
                ContainerRegistry.registry_host == clean_host,
                ContainerRegistry.id != registry_id,
            )
        )
        if dup_h:
            raise Conflict(f"镜像仓库地址已存在: {clean_host}")
        reg.registry_host = clean_host
    if username is not None:
        reg.username = username.strip()
    if password is not None and password != "":
        reg.password_ciphertext = encrypt_secret(password)
    if tls_verify is not None:
        reg.tls_verify = tls_verify
    if is_default is not None:
        if is_default:
            for other in list_registries(db):
                if other.id != registry_id:
                    other.is_default = False
        reg.is_default = is_default
    audit(db, "registry.update", target=reg.registry_host, detail=f"id={reg.id}", actor=actor)
    db.commit()
    db.refresh(reg)
    try:
        sync_k8s_registry_secrets(db, runtime)
    except Exception:
        pass
    db.refresh(reg)
    return reg


def delete_registry(
    db: Session,
    runtime: Any,
    registry_id: str,
    *,
    actor: str | None = None,
) -> None:
    reg = db.get(ContainerRegistry, registry_id)
    if not reg:
        raise NotFoundError(f"container registry not found: {registry_id}")
    host = reg.registry_host
    db.delete(reg)
    audit(db, "registry.delete", target=host, detail=f"id={registry_id}", actor=actor)
    db.commit()
    try:
        sync_k8s_registry_secrets(db, runtime)
    except Exception:
        pass


def _oci_v2_probe(host: str, username: str, password: str, tls_verify: bool) -> tuple[bool, str]:
    """Direct OCI Distribution v2 auth probe (used when Docker daemon is absent, e.g. K8s)."""
    scheme = "https" if tls_verify or host == "docker.io" else "http"
    base_host = "registry-1.docker.io" if host == "docker.io" else host
    url = f"{scheme}://{base_host}/v2/"
    try:
        with httpx.Client(timeout=10.0, verify=tls_verify) as client:
            res = client.get(url, auth=(username, password))
            if res.status_code == 200:
                return True, f"OCI v2 authentication succeeded for {host}"
            if res.status_code == 401:
                header = res.headers.get("www-authenticate") or ""
                if header.lower().startswith("bearer "):
                    # Extract realm/service/scope
                    params = dict(re.findall(r'(\w+)="([^"]+)"', header))
                    realm = params.get("realm")
                    if realm:
                        q = {}
                        if params.get("service"):
                            q["service"] = params["service"]
                        tok_res = client.get(realm, params=q, auth=(username, password))
                        if tok_res.status_code == 200 and tok_res.json().get("token"):
                            return True, f"Bearer token issued cleanly for {host}"
                        return False, f"认证失败 (Bearer token HTTP {tok_res.status_code})"
                return False, f"认证失败: 用户名或密码被仓库 {host} 拒绝 (HTTP 401)"
            return False, f"仓库返回非预期状态 HTTP {res.status_code}"
    except Exception as exc:
        if scheme == "https" and not tls_verify:
            try:
                with httpx.Client(timeout=10.0, verify=False) as client:
                    res = client.get(f"http://{base_host}/v2/", auth=(username, password))
                    if res.status_code == 200:
                        return True, f"HTTP OCI v2 authentication succeeded for {host}"
            except Exception:
                pass
        return False, f"连接镜像仓库 {host} 失败: {exc}"


def test_registry_connection(
    db: Session,
    runtime: Any,
    *,
    registry_id: str | None = None,
    registry_host: str | None = None,
    username: str | None = None,
    password: str | None = None,
    tls_verify: bool = True,
) -> dict[str, Any]:
    reg: ContainerRegistry | None = None
    if registry_id:
        reg = db.get(ContainerRegistry, registry_id)
        if not reg:
            raise NotFoundError(f"container registry not found: {registry_id}")
        host = reg.registry_host
        user = (username if username is not None else reg.username).strip()
        secret = (
            password
            if password is not None and password != ""
            else decrypt_secret(reg.password_ciphertext)
        )
        verify_tls = reg.tls_verify
    else:
        if not registry_host or not username or not password:
            raise ValueError("registry_host, username, and password are required")
        host = normalize_registry_host(registry_host)
        user = username.strip()
        secret = password
        verify_tls = tls_verify

    ok = False
    detail = ""
    if hasattr(runtime, "test_registry_login") and getattr(runtime, "runtime_name", "") == "docker":
        try:
            ok, detail = runtime.test_registry_login(
                registry_host=host,
                login_server=docker_login_server(host),
                username=user,
                password=secret,
            )
        except Exception as exc:
            ok = False
            detail = _sanitize_text(str(exc))
    else:
        ok, detail = _oci_v2_probe(host, user, secret, verify_tls)

    k8s_synced = False
    if reg is not None:
        reg.last_test_ok = ok
        reg.last_tested_at = utcnow()
        reg.last_error = None if ok else detail[:500]
        db.commit()
        if ok:
            try:
                k8s_synced = sync_k8s_registry_secrets(db, runtime)
            except Exception:
                k8s_synced = False
    return {
        "ok": ok,
        "registry_host": host,
        "detail": detail,
        "k8s_synced": k8s_synced,
    }


# ---------------------------------------------------------------------------
# In-UI Digital Employee Image Factory
# ---------------------------------------------------------------------------


def _load_dockerignore_patterns(src_dir: Path) -> list[str]:
    ignore_file = src_dir / ".dockerignore"
    if not ignore_file.is_file():
        return []
    patterns: list[str] = []
    for line in ignore_file.read_text(encoding="utf-8", errors="replace").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or clean.startswith("!"):
            continue
        patterns.append(clean.rstrip("/"))
    return patterns


def _is_ignored_relpath(rel_posix: str, patterns: list[str]) -> bool:
    for pat in patterns:
        trimmed = pat[3:] if pat.startswith("**/") else pat
        if fnmatch.fnmatch(rel_posix, pat) or fnmatch.fnmatch(rel_posix.split("/")[0], pat):
            return True
        if "/" in pat and fnmatch.fnmatch(rel_posix, trimmed):
            return True
        for part in rel_posix.split("/"):
            if fnmatch.fnmatch(part, trimmed):
                return True
    return False


def build_tar_from_directory(src_dir: Path) -> io.BytesIO:
    """Create a deterministic tar build context from sandbox/ honoring .dockerignore."""
    patterns = _load_dockerignore_patterns(src_dir)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        for path in sorted(src_dir.rglob("*")):
            rel = path.relative_to(src_dir).as_posix()
            if _is_ignored_relpath(rel, patterns):
                continue
            if path.is_symlink():
                continue
            info = tf.gettarinfo(str(path), arcname=rel)
            if path.is_file():
                # Ensure scripts keep clean POSIX mode bits
                if rel.endswith(".sh") or "/bin/" in rel:
                    info.mode = 0o755
                with path.open("rb") as fh:
                    tf.addfile(info, fh)
            elif path.is_dir():
                tf.addfile(info)
    buf.seek(0)
    return buf


def render_variant_dockerfile(
    *,
    base_image: str,
    apt_packages: list[str] | None = None,
    pip_packages: list[str] | None = None,
    npm_packages: list[str] | None = None,
    mirrors: dict[str, str] | None = None,
    include_ca_bundle: bool = False,
) -> str:
    """Generate a fast, layer-cached role variant Dockerfile extending base_image."""
    apt = apt_packages or []
    pip = pip_packages or []
    npm = npm_packages or []
    mirror_cfg = mirrors or {}
    apt_mirror = (mirror_cfg.get("apt_mirror") or "").strip()
    pip_index = (mirror_cfg.get("pip_index_url") or "").strip()
    npm_registry = (mirror_cfg.get("npm_registry") or "").strip()

    lines: list[str] = [
        f"FROM {base_image}",
        "USER root",
    ]
    if include_ca_bundle:
        lines.extend(
            [
                "COPY ca-bundle.crt /tmp/ca-bundle.crt",
                (
                    "RUN if grep -q '^-----BEGIN CERTIFICATE-----' /tmp/ca-bundle.crt 2>/dev/null; then "
                    "cp /tmp/ca-bundle.crt /usr/local/share/ca-certificates/custom-ca-bundle.crt && "
                    "update-ca-certificates; fi && rm -f /tmp/ca-bundle.crt"
                ),
            ]
        )

    if apt:
        pkg_args = " ".join(apt)
        sed_cmd = ""
        if apt_mirror and apt_mirror != "deb.debian.org":
            mirror_url = (
                apt_mirror.rstrip("/")
                if apt_mirror.startswith(("http://", "https://"))
                else f"https://{apt_mirror}"
            )
            sed_cmd = (
                f"for f in /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list; do "
                f'[ -f "$f" ] && sed -i "s|https\\?://deb.debian.org|{mirror_url}|g; '
                f's|https\\?://security.debian.org|{mirror_url}|g" "$f"; done && '
            )
        lines.append(
            f"RUN {sed_cmd}apt-get -o Acquire::Retries=3 update && "
            f"DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y --no-install-recommends {pkg_args} && "
            f"rm -rf /var/lib/apt/lists/*"
        )

    if pip:
        pkg_args = " ".join(pip)
        idx_flag = ""
        if pip_index and pip_index != "https://pypi.org/simple/":
            idx_flag = f"--index-url {pip_index} "
            if pip_index.startswith("http://"):
                parsed = urlsplit(pip_index)
                if parsed.hostname:
                    idx_flag += f"--trusted-host {parsed.hostname} "
        lines.append(
            f"RUN pip3 install --no-cache-dir --break-system-packages --root-user-action=ignore "
            f"{idx_flag}{pkg_args}"
        )

    if npm:
        pkg_args = " ".join(npm)
        reg_flag = f"--registry {npm_registry} " if npm_registry else ""
        # Install role tools into /usr/local instead of /home/workspace/.npm-global because
        # /home/workspace is shadowed by per-sandbox persistent Docker volumes / K8s PVCs.
        lines.append(
            f"RUN NPM_CONFIG_PREFIX=/usr/local npm install -g --no-audit --no-fund {reg_flag}{pkg_args}"
        )

    lines.append("WORKDIR /home/workspace")
    return "\n".join(lines) + "\n"


def build_variant_context_tar(
    *,
    dockerfile_text: str,
    ca_bundle_bytes: bytes | None = None,
) -> io.BytesIO:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        df_bytes = dockerfile_text.encode("utf-8")
        info = tarfile.TarInfo("Dockerfile")
        info.size = len(df_bytes)
        info.mode = 0o644
        tf.addfile(info, io.BytesIO(df_bytes))
        if ca_bundle_bytes is not None:
            ca_info = tarfile.TarInfo("ca-bundle.crt")
            ca_info.size = len(ca_bundle_bytes)
            ca_info.mode = 0o644
            tf.addfile(ca_info, io.BytesIO(ca_bundle_bytes))
    buf.seek(0)
    return buf


def image_job_to_out_dict(job: ImageBuildJob) -> dict[str, Any]:
    return {
        "id": job.id,
        "job_key": job.job_key,
        "kind": job.kind,
        "image_repo": job.image_repo,
        "image_tag": job.image_tag,
        "base_image": job.base_image,
        "install_browser": bool(job.install_browser),
        "network_preset": job.network_preset,
        "packages": job.packages,
        "custom_dockerfile": job.custom_dockerfile,
        "push_registry_id": job.push_registry_id,
        "status": job.status,
        "progress_stage": job.progress_stage,
        "log_text": job.log_text or "",
        "error_message": job.error_message,
        "image_id": job.image_id,
        "size_bytes": job.size_bytes,
        "created_by": job.created_by,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


def list_image_jobs(db: Session, limit: int = 30) -> list[ImageBuildJob]:
    return list(
        db.scalars(
            select(ImageBuildJob)
            .order_by(ImageBuildJob.created_at.desc())
            .limit(max(1, min(limit, 100)))
        ).all()
    )


def get_image_job(db: Session, job_id: str) -> ImageBuildJob:
    job = db.get(ImageBuildJob, job_id)
    if not job:
        raise NotFoundError(f"image job not found: {job_id}")
    return job


def _assert_no_active_job(db: Session, job_key: str) -> None:
    active = db.scalar(
        select(ImageBuildJob).where(
            ImageBuildJob.job_key == job_key,
            ImageBuildJob.status.in_(("pending", "running")),
        )
    )
    if active is not None:
        raise Conflict(f"镜像 {job_key} 已有正在进行的构建/拉取任务 (job={active.id})")


def _append_log_and_maybe_flush(
    db: Session,
    job: ImageBuildJob,
    lines: list[str],
    last_flush: list[float],
    stage: str | None = None,
    force: bool = False,
) -> None:
    if stage:
        job.progress_stage = stage
    if lines:
        chunk = _sanitize_text("\n".join(lines)) + "\n"
        combined = (job.log_text or "") + chunk
        if len(combined) > _MAX_LOG_CHARS:
            combined = "...[earlier build logs trimmed]...\n" + combined[-_MAX_LOG_CHARS:]
        job.log_text = combined
    now_mono = time.monotonic()
    if force or (now_mono - last_flush[0] >= 0.7):
        db.commit()
        last_flush[0] = now_mono


def _spawn_image_job_worker(
    db: Session,
    settings: Settings,
    runtime: Any,
    job: ImageBuildJob,
    *,
    buildargs: dict[str, str] | None = None,
    nocache: bool = False,
    ca_bundle_bytes: bytes | None = None,
    bind_template_key: str | None = None,
    source_image: str | None = None,
) -> None:
    session_factory = sessionmaker(
        bind=db.get_bind(), autoflush=False, autocommit=False, expire_on_commit=False
    )
    job_id = job.id

    def _run() -> None:
        with session_factory() as wdb:
            wjob = wdb.get(ImageBuildJob, job_id)
            if not wjob:
                return
            wjob.status = "running"
            wjob.started_at = utcnow()
            wjob.progress_stage = "preparing"
            wdb.commit()
            last_flush = [time.monotonic()]
            pending_lines: list[str] = []

            def _emit(line: str, stage: str | None = None, force: bool = False) -> None:
                clean = (line or "").rstrip("\r\n")
                if clean:
                    pending_lines.append(clean)
                if force or len(pending_lines) >= 8 or time.monotonic() - last_flush[0] >= 0.7:
                    batch = list(pending_lines)
                    pending_lines.clear()
                    _append_log_and_maybe_flush(wdb, wjob, batch, last_flush, stage=stage, force=force)
                elif stage and stage != wjob.progress_stage:
                    wjob.progress_stage = stage
                    wdb.commit()

            try:
                auth_map = auth_configs_map(wdb)
                full_target = f"{wjob.image_repo}:{wjob.image_tag}"

                if wjob.kind == "pull":
                    _emit(f"Starting image pull: {full_target}", stage="pulling", force=True)
                    pull_auth = resolve_auth_config_for_image(
                        wdb, full_target, registry_id=wjob.push_registry_id
                    )
                    runtime.pull_image_stream(
                        wjob.image_repo,
                        wjob.image_tag,
                        auth_config=pull_auth,
                        on_log=lambda ln: _emit(ln),
                    )
                elif wjob.kind == "base":
                    src_dir = resolve_sandbox_src_dir(settings)
                    if src_dir is None:
                        raise RuntimeError(
                            "sandbox build context directory not found; mount ../sandbox to /app/sandbox_src"
                        )
                    _emit(
                        f"Packing base build context from {src_dir} for {full_target} ...",
                        stage="packing_context",
                        force=True,
                    )
                    tar_buf = build_tar_from_directory(src_dir)
                    _emit(
                        f"Running Docker build {full_target} (INSTALL_BROWSER={wjob.install_browser}) ...",
                        stage="building",
                        force=True,
                    )
                    runtime.build_image_stream(
                        tar_buf,
                        tag=full_target,
                        buildargs=buildargs or {},
                        nocache=nocache,
                        auth_configs=auth_map,
                        on_log=lambda ln: _emit(ln),
                    )
                elif wjob.kind == "variant":
                    _emit(
                        f"Building role variant {full_target} from {wjob.base_image} ...",
                        stage="building",
                        force=True,
                    )
                    tar_buf = build_variant_context_tar(
                        dockerfile_text=wjob.custom_dockerfile or "",
                        ca_bundle_bytes=ca_bundle_bytes,
                    )
                    runtime.build_image_stream(
                        tar_buf,
                        tag=full_target,
                        buildargs=buildargs or {},
                        nocache=nocache,
                        auth_configs=auth_map,
                        on_log=lambda ln: _emit(ln),
                    )
                elif wjob.kind == "push":
                    src_img = source_image or full_target
                    _emit(
                        f"Tagging & pushing {src_img} -> {full_target} ...",
                        stage="pushing",
                        force=True,
                    )
                    push_auth = resolve_auth_config_for_image(
                        wdb, full_target, registry_id=wjob.push_registry_id
                    )
                    runtime.tag_and_push_image(
                        source_image=src_img,
                        target_repo=wjob.image_repo,
                        target_tag=wjob.image_tag,
                        auth_config=push_auth,
                        on_log=lambda ln: _emit(ln),
                    )

                # Optional post-build push to selected registry
                if wjob.kind in {"base", "variant"} and wjob.push_registry_id:
                    push_reg = wdb.get(ContainerRegistry, wjob.push_registry_id)
                    if push_reg is not None:
                        push_auth = auth_config_for_registry(push_reg)
                        creds = (
                            {"username": push_auth["username"], "password": push_auth["password"]}
                            if push_auth
                            else None
                        )
                        host = push_reg.registry_host
                        if wjob.image_repo.startswith(f"{host}/"):
                            push_repo = wjob.image_repo
                        elif host == "docker.io":
                            push_repo = wjob.image_repo
                        else:
                            repo_tail = wjob.image_repo.lstrip("/")
                            push_repo = f"{host}/{repo_tail}"
                        _emit(
                            f"Pushing built image {full_target} -> {push_repo}:{wjob.image_tag} ...",
                            stage="pushing",
                            force=True,
                        )
                        runtime.tag_and_push_image(
                            source_image=full_target,
                            target_repo=push_repo,
                            target_tag=wjob.image_tag,
                            auth_config=creds,
                            on_log=lambda ln: _emit(ln),
                        )

                # Inspect resulting image metadata cleanly
                meta = runtime.inspect_image(full_target) if hasattr(runtime, "inspect_image") else {}
                wjob.image_id = meta.get("id")
                wjob.size_bytes = meta.get("size_bytes")

                if bind_template_key and wjob.kind in {"variant", "base"}:
                    tpl = wdb.scalar(
                        select(SandboxTemplate).where(SandboxTemplate.key == bind_template_key)
                    )
                    if tpl is not None:
                        tpl.image_repo = wjob.image_repo
                        tpl.image_tag = wjob.image_tag
                        _emit(
                            f"Updated template '{bind_template_key}' image to {full_target}",
                            force=True,
                        )

                _emit(f"Completed cleanly: {full_target}", stage="completed", force=True)
                wjob.status = "succeeded"
                wjob.finished_at = utcnow()
                wdb.commit()
            except Exception as exc:
                safe_err = _sanitize_text(str(exc))
                pending_lines.append(f"ERROR: {safe_err}")
                batch = list(pending_lines)
                pending_lines.clear()
                _append_log_and_maybe_flush(
                    wdb, wjob, batch, last_flush, stage="failed", force=True
                )
                wjob.status = "failed"
                wjob.error_message = safe_err[:500]
                wjob.finished_at = utcnow()
                wdb.commit()

    thread = threading.Thread(
        target=_run,
        name=f"dsh-image-job-{job.id[:8]}",
        daemon=True,
    )
    thread.start()


def start_pull_job(
    db: Session,
    settings: Settings,
    runtime: Any,
    *,
    image_repo: str,
    image_tag: str,
    registry_id: str | None = None,
    actor: str | None = None,
) -> ImageBuildJob:
    job_key = f"{image_repo}:{image_tag}"
    with cluster_lock(f"image-job:{job_key}", ttl_seconds=15.0, wait_seconds=2.0):
        _assert_no_active_job(db, job_key)
        if registry_id and not db.get(ContainerRegistry, registry_id):
            raise NotFoundError(f"container registry not found: {registry_id}")
        job = ImageBuildJob(
            job_key=job_key,
            kind="pull",
            image_repo=image_repo,
            image_tag=image_tag,
            push_registry_id=registry_id,
            status="pending",
            progress_stage="queued",
            created_by=actor,
        )
        db.add(job)
        audit(db, "image.pull.start", target=job_key, detail=f"registry={registry_id or 'auto'}", actor=actor)
        db.commit()
        db.refresh(job)

    _spawn_image_job_worker(db, settings, runtime, job)
    return job


def start_base_build_job(
    db: Session,
    settings: Settings,
    runtime: Any,
    *,
    image_repo: str,
    image_tag: str,
    install_browser: bool = False,
    network_preset: str | None = None,
    nocache: bool = False,
    push_registry_id: str | None = None,
    actor: str | None = None,
) -> ImageBuildJob:
    src_dir = resolve_sandbox_src_dir(settings)
    if src_dir is None:
        raise ValueError(
            "未找到 sandbox Dockerfile 构建上下文（请检查 Compose 是否挂载 ../sandbox:/app/sandbox_src:ro）"
        )
    job_key = f"{image_repo}:{image_tag}"
    eff = get_runtime_settings(db, settings)
    preset = network_preset or eff["network_preset"]
    mirrors = NETWORK_PRESET_MIRRORS.get(preset, {}) if network_preset else eff
    docker_reg = (mirrors.get("docker_registry_mirror") or "").strip()
    buildargs: dict[str, str] = {
        "INSTALL_BROWSER": "true" if install_browser else "false",
    }
    if docker_reg:
        buildargs["DOCKER_REGISTRY"] = docker_reg.rstrip("/")
    for arg_name, mirror_key in (
        ("APT_MIRROR", "apt_mirror"),
        ("NODE_MIRROR", "node_mirror"),
        ("NPM_REGISTRY", "npm_registry"),
        ("PIP_INDEX_URL", "pip_index_url"),
    ):
        val = (mirrors.get(mirror_key) or "").strip()
        if val:
            buildargs[arg_name] = val

    with cluster_lock(f"image-job:{job_key}", ttl_seconds=15.0, wait_seconds=2.0):
        _assert_no_active_job(db, job_key)
        if push_registry_id and not db.get(ContainerRegistry, push_registry_id):
            raise NotFoundError(f"container registry not found: {push_registry_id}")
        job = ImageBuildJob(
            job_key=job_key,
            kind="base",
            image_repo=image_repo,
            image_tag=image_tag,
            install_browser=install_browser,
            network_preset=preset,
            push_registry_id=push_registry_id,
            status="pending",
            progress_stage="queued",
            created_by=actor,
        )
        db.add(job)
        audit(
            db,
            "image.base_build.start",
            target=job_key,
            detail=f"browser={install_browser}, preset={preset}",
            actor=actor,
        )
        db.commit()
        db.refresh(job)

    _spawn_image_job_worker(db, settings, runtime, job, buildargs=buildargs, nocache=nocache)
    return job


def start_variant_build_job(
    db: Session,
    settings: Settings,
    runtime: Any,
    *,
    image_repo: str,
    image_tag: str,
    base_image: str,
    apt_packages: list[str] | None = None,
    pip_packages: list[str] | None = None,
    npm_packages: list[str] | None = None,
    install_ca_bundle: bool = True,
    network_preset: str | None = None,
    nocache: bool = False,
    push_registry_id: str | None = None,
    bind_template_key: str | None = None,
    actor: str | None = None,
) -> ImageBuildJob:
    job_key = f"{image_repo}:{image_tag}"
    eff = get_runtime_settings(db, settings)
    preset = network_preset or eff["network_preset"]
    mirrors = NETWORK_PRESET_MIRRORS.get(preset, {}) if network_preset else eff

    ca_bytes: bytes | None = None
    if install_ca_bundle:
        custom_ca = (getattr(settings, "custom_ca_bundle_path", "") or "").strip()
        if custom_ca and Path(custom_ca).is_file():
            ca_bytes = Path(custom_ca).read_bytes()
        else:
            src_dir = resolve_sandbox_src_dir(settings)
            if src_dir is not None and (src_dir / "ca-bundle.crt").is_file():
                raw_ca = (src_dir / "ca-bundle.crt").read_bytes()
                if b"-----BEGIN CERTIFICATE-----" in raw_ca:
                    ca_bytes = raw_ca

    dockerfile_text = render_variant_dockerfile(
        base_image=base_image,
        apt_packages=apt_packages,
        pip_packages=pip_packages,
        npm_packages=npm_packages,
        mirrors=mirrors,
        include_ca_bundle=ca_bytes is not None,
    )
    pkgs_payload = json.dumps(
        {
            "apt": apt_packages or [],
            "pip": pip_packages or [],
            "npm": npm_packages or [],
        },
        ensure_ascii=False,
    )

    with cluster_lock(f"image-job:{job_key}", ttl_seconds=15.0, wait_seconds=2.0):
        _assert_no_active_job(db, job_key)
        if push_registry_id and not db.get(ContainerRegistry, push_registry_id):
            raise NotFoundError(f"container registry not found: {push_registry_id}")
        job = ImageBuildJob(
            job_key=job_key,
            kind="variant",
            image_repo=image_repo,
            image_tag=image_tag,
            base_image=base_image,
            network_preset=preset,
            packages_json=pkgs_payload,
            custom_dockerfile=dockerfile_text,
            push_registry_id=push_registry_id,
            status="pending",
            progress_stage="queued",
            created_by=actor,
        )
        db.add(job)
        audit(
            db,
            "image.variant_build.start",
            target=job_key,
            detail=f"base={base_image}, tpl={bind_template_key or '-'}",
            actor=actor,
        )
        db.commit()
        db.refresh(job)

    _spawn_image_job_worker(
        db,
        settings,
        runtime,
        job,
        nocache=nocache,
        ca_bundle_bytes=ca_bytes,
        bind_template_key=bind_template_key,
    )
    return job


def start_push_job(
    db: Session,
    settings: Settings,
    runtime: Any,
    *,
    source_image: str,
    target_repo: str,
    target_tag: str,
    registry_id: str | None = None,
    actor: str | None = None,
) -> ImageBuildJob:
    job_key = f"{target_repo}:{target_tag}"
    with cluster_lock(f"image-job:{job_key}", ttl_seconds=15.0, wait_seconds=2.0):
        _assert_no_active_job(db, job_key)
        if registry_id and not db.get(ContainerRegistry, registry_id):
            raise NotFoundError(f"container registry not found: {registry_id}")
        job = ImageBuildJob(
            job_key=job_key,
            kind="push",
            image_repo=target_repo,
            image_tag=target_tag,
            base_image=source_image,
            push_registry_id=registry_id,
            status="pending",
            progress_stage="queued",
            created_by=actor,
        )
        db.add(job)
        audit(
            db,
            "image.push.start",
            target=job_key,
            detail=f"source={source_image}, registry={registry_id or 'auto'}",
            actor=actor,
        )
        db.commit()
        db.refresh(job)

    _spawn_image_job_worker(db, settings, runtime, job, source_image=source_image)
    return job


def prune_unused_images(
    db: Session, runtime: Any, *, actor: str | None = None
) -> dict[str, Any]:
    if not hasattr(runtime, "prune_images"):
        return {"reclaimed_bytes": 0, "deleted_images": []}
    result = runtime.prune_images()
    audit(
        db,
        "image.prune",
        target="docker",
        detail=f"reclaimed={result.get('reclaimed_bytes', 0)}",
        actor=actor,
    )
    db.commit()
    return result
