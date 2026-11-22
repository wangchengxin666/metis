from __future__ import annotations

import copy
import json
import math
import posixpath
import re
import sys
import tarfile
import tempfile
import time
from abc import ABC, abstractmethod
from pathlib import PurePosixPath
from typing import Any

import httpx

from ..config import Settings
from ..models import LlmProfile, Sandbox
from ..plugin_registry import PluginRegistryService
from ..security import decrypt_secret

_ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]")

AUTH_RESPONSE_HEADERS = [
    "X-Auth-Request-Email",
    "X-Forwarded-User",
    "X-Sandbox-Owner",
    "X-Auth-Request-Name",
    "X-Auth-Request-Admin",
    "X-Sandbox-Owner-Name",
]

TAR_CACHE_EXCLUDES = [
    "--exclude=*/node_modules",
    "--exclude=*/.venv",
    "--exclude=*/venv",
    "--exclude=*/__pycache__",
    "--exclude=*/.cache",
    "--exclude=*/.pnpm-store",
    "--exclude=*/.npm",
    "--exclude=*/logs/*.log",
]


def strip_ansi(text: str) -> str:
    cleaned = _ANSI_ESCAPE_RE.sub("", text)
    return cleaned.replace("\u2009", " ").replace("\r\n", "\n").replace("\r", "\n")


def llm_provider_identifiers(profile: LlmProfile) -> tuple[str, str]:
    """Derive stable (provider_key, credential_ref) identifiers for a Manager LLM profile."""
    raw_id = re.sub(r"[^a-z0-9]", "", (profile.id or "").lower())
    suffix = raw_id[:12] if raw_id else "default"
    return f"mgr-{suffix}", f"DSH_LLM_MGR_{suffix.upper()}_KEY"


def parse_memory_to_bytes(mem_str: str | None, default: str = "4g") -> int:
    """Convert memory string like '512m', '4g', '2.5g', or '4Gi' into integer bytes."""
    raw = (mem_str or default).strip().lower()
    for suffix, mult in (
        ("gi", 1024**3),
        ("mi", 1024**2),
        ("ki", 1024),
        ("g", 1024**3),
        ("m", 1024**2),
        ("k", 1024),
    ):
        if raw.endswith(suffix):
            num = float(raw[: -len(suffix)].strip() or "0")
            return max(int(num * mult), 64 * 1024 * 1024)
    if raw.isdigit():
        return int(raw)
    return 4 * (1024**3)


def normalize_k8s_memory(mem_str: str | None, default: str = "4g") -> str:
    """Convert Docker-style memory strings ('4g', '512m', '1.5g') into valid Kubernetes Quantities ('4Gi', '512Mi', '1536Mi')."""
    total_bytes = parse_memory_to_bytes(mem_str, default=default)
    gi = 1024**3
    mi = 1024**2
    if total_bytes % gi == 0:
        return f"{total_bytes // gi}Gi"
    return f"{max(math.ceil(total_bytes / mi), 64)}Mi"


def format_k8s_cpu(cpus: float | None, default: float = 2.0) -> str:
    """Convert float CPU cores (e.g. 2.0, 0.5) into Kubernetes millicore Quantity (e.g. '2000m', '500m')."""
    val = cpus if cpus is not None and cpus > 0 else default
    millicores = max(int(round(val * 1000)), 100)
    return f"{millicores}m"


def sandbox_traefik_dsh_rule(slug: str) -> str:
    return (
        f"Path(`/s/{slug}`) || "
        f"Path(`/s/{slug}/`) || "
        f"Path(`/s/{slug}/_dsh-token`) || "
        f"Path(`/s/{slug}/dsh`) || "
        f"PathPrefix(`/s/{slug}/dsh/`)"
    )


def build_traefik_dynamic_config(
    settings: Settings,
    sandboxes_with_upstreams: list[tuple[Sandbox, str]],
) -> dict[str, Any]:
    """Build Traefik v3 HTTP Provider dynamic configuration for all running sandboxes.

    Works identically across Local Docker, Remote Docker (mapped host ports), and Kubernetes Services.
    """
    routers: dict[str, Any] = {}
    middlewares: dict[str, Any] = {}
    services: dict[str, Any] = {}

    entrypoint = (settings.traefik_entrypoint or "web").strip() or "web"
    manager_internal = settings.sandbox_reachable_manager_url

    for sandbox, upstream_url in sandboxes_with_upstreams:
        if not upstream_url:
            continue
        slug = sandbox.slug
        router_name = f"dsh-sbx-{slug}"
        dsh_router_name = f"dsh-sbx-{slug}-dsh"
        auth_mw = f"dsh-auth-{slug}"
        verify_url = f"{manager_internal}/api/auth/verify-sandbox/{slug}"

        routers[router_name] = {
            "rule": f"PathPrefix(`/s/{slug}`)",
            "entryPoints": [entrypoint],
            "priority": 100,
            "service": router_name,
        }
        routers[dsh_router_name] = {
            "rule": sandbox_traefik_dsh_rule(slug),
            "entryPoints": [entrypoint],
            "priority": 120,
            "service": router_name,
            "middlewares": [auth_mw],
        }
        middlewares[auth_mw] = {
            "forwardAuth": {
                "address": verify_url,
                "trustForwardHeader": True,
                "authResponseHeaders": list(AUTH_RESPONSE_HEADERS),
            }
        }
        services[router_name] = {
            "loadBalancer": {
                "servers": [{"url": upstream_url}],
            }
        }

    if not routers:
        return {}
    return {
        "http": {
            "routers": routers,
            "middlewares": middlewares,
            "services": services,
        }
    }


class SandboxRuntimeError(RuntimeError):
    pass


class BaseSandboxRuntime(ABC):
    """Abstract runtime contract shared by Docker (local/remote) and Kubernetes backends."""

    runtime_name: str = "base"

    def __init__(self, settings: Settings):
        self.settings = settings

    def image_for(
        self, tag: str | None = None, repo: str | None = None
    ) -> str:
        final_repo = (repo or self.settings.dsh_image_repo).strip()
        final_tag = (tag or self.settings.dsh_image_tag).strip()
        return f"{final_repo}:{final_tag}"

    def container_name(self, sandbox: Sandbox) -> str:
        return f"dsh-sbx-{sandbox.slug}"

    @abstractmethod
    def ping(self) -> bool:
        """Verify connectivity to the container runtime backend."""

    @abstractmethod
    def list_local_images(self) -> list[dict[str, str | float]]:
        """List available sandbox images (or configured defaults in cluster runtimes)."""

    @abstractmethod
    def upstream_origin(self, sandbox: Sandbox) -> str:
        """Return http://<host>:<port> reachable by dsh-manager and Traefik gateway."""

    def health_url(self, sandbox: Sandbox) -> str:
        return f"{self.upstream_origin(sandbox)}/healthz"

    def _resolve_auto_install_plugins(self, raw_override: str | None = None) -> str:
        raw = (
            raw_override
            if raw_override is not None
            else self.settings.sandbox_auto_install_plugins
        ).strip()
        if not raw:
            return ""
        base = self.settings.sandbox_reachable_manager_url
        registry = PluginRegistryService(self.settings)
        resolved: list[str] = []
        for item in raw.split(","):
            spec = item.strip()
            if not spec:
                continue
            if spec.startswith(("http://", "https://", "/", "@")):
                resolved.append(spec)
            else:
                slug = spec.removesuffix(".tgz")
                pkg = registry.get_by_slug_or_filename(slug)
                if pkg is not None:
                    resolved.append(pkg.name)
                else:
                    resolved.append(f"{base}/plugins/packages/{slug}.tgz")
        return ",".join(resolved)

    def environment(self, sandbox: Sandbox) -> dict[str, str]:
        suffix = sandbox.slug.replace("-", "_")
        manager_url = self.settings.sandbox_reachable_manager_url
        base_path = f"/s/{sandbox.slug}"
        dsh_mount = f"{base_path}/dsh"
        public_origin = self.settings.manager_base_url
        public_base = f"{public_origin}{base_path}"
        dsh_public_url = f"{public_base}/dsh/"

        gw_host = self.settings.public_host_header
        gw_hostname = gw_host.split(":")[0]
        trusted_list = [gw_host]
        if gw_hostname and gw_hostname not in trusted_list:
            trusted_list.append(gw_hostname)
        for fallback in (
            f"{self.container_name(sandbox)}:8080",
            "127.0.0.1:8080",
            "localhost:8080",
        ):
            if fallback not in trusted_list:
                trusted_list.append(fallback)
        trusted_hosts = " ".join(trusted_list)

        env: dict[str, str] = {
            "SANDBOX_BASE_PATH": base_path,
            "SANDBOX_PUBLIC_ORIGIN": public_origin,
            "SANDBOX_PUBLIC_URL": f"{public_base}/",
            "DSH_MOUNT": dsh_mount,
            "DSH_PUBLIC_URL": dsh_public_url,
            "DSH_TRUSTED_HOSTS": trusted_hosts,
            "DSH_TOKEN_COOKIE_NAME": f"dsh_token_seen_{suffix}",
            "DSH_PERMISSION_MODE": self.settings.dsh_permission_mode,
            "DSH_PLUGIN_INDEX_URL": f"{manager_url}/plugins/index.json",
            "DSH_PLUGIN_NPM_REGISTRY": f"{manager_url}/plugins/npm",
            "SANDBOX_TEMPLATE": sandbox.template or "agent-os",
            "TZ": self.settings.sandbox_timezone,
        }

        if self.settings.gateway_internal_url and self.settings.gateway_internal_url.strip():
            env["DSH_GATEWAY_INTERNAL_URL"] = self.settings.gateway_internal_url.strip().rstrip("/")

        if sandbox.init_repo_url:
            env["SANDBOX_INIT_REPO_URL"] = sandbox.init_repo_url

        if sandbox.init_script and sandbox.init_script.strip():
            env["SANDBOX_INIT_SCRIPT"] = sandbox.init_script

        auto_plugins = self._resolve_auto_install_plugins(
            sandbox.auto_install_plugins
        )
        if auto_plugins:
            env["DSH_AUTO_INSTALL_PLUGINS"] = auto_plugins

        if sandbox.extra_env_json:
            try:
                parsed_env = json.loads(sandbox.extra_env_json)
                if isinstance(parsed_env, dict):
                    for k, v in parsed_env.items():
                        if k and v is not None:
                            env[str(k)] = str(v)
            except Exception:
                pass

        if sandbox.llm_profile is not None:
            prof = sandbox.llm_profile
            env["DSH_DEFAULT_LLM_PROVIDER"] = "openai-compatible"
            env["DSH_DEFAULT_LLM_DISPLAY_NAME"] = prof.name
            env["DSH_DEFAULT_LLM_API"] = prof.api_protocol or "openai-completions"
            env["DSH_DEFAULT_LLM_BASE_URL"] = prof.base_url
            env["DSH_DEFAULT_LLM_MODEL"] = prof.model
            if prof.context_window:
                env["DSH_DEFAULT_LLM_CONTEXT_WINDOW"] = str(prof.context_window)
            if prof.max_tokens:
                env["DSH_DEFAULT_LLM_MAX_TOKENS"] = str(prof.max_tokens)
            env["DSH_DEFAULT_LLM_SUPPORTS_IMAGE"] = "true" if prof.supports_image else "false"
            if prof.reasoning_effort:
                env["DSH_DEFAULT_LLM_REASONING_EFFORT"] = prof.reasoning_effort
            if prof.thinking_format and (prof.api_protocol or "openai-completions") == "openai-completions":
                env["DSH_DEFAULT_LLM_THINKING_FORMAT"] = prof.thinking_format
            if prof.api_key_ciphertext:
                try:
                    api_key = decrypt_secret(prof.api_key_ciphertext)
                    if api_key:
                        env["DSH_DEFAULT_LLM_API_KEY"] = api_key
                except ValueError:
                    pass

        return env

    @abstractmethod
    def create(self, sandbox: Sandbox) -> Any:
        """Provision a sandbox workload and return an object with an `.id` attribute."""

    @abstractmethod
    def get(self, sandbox: Sandbox) -> Any:
        """Return the underlying runtime workload object (with `.id`, `.status`, `.reload()`)."""

    @abstractmethod
    def start(self, sandbox: Sandbox) -> str:
        """Start/wake a stopped sandbox and return its status."""

    @abstractmethod
    def stop(self, sandbox: Sandbox) -> str:
        """Stop/sleep a running sandbox while preserving its persistent workspace volume."""

    @abstractmethod
    def restart(self, sandbox: Sandbox) -> str:
        """Restart a sandbox and return its status."""

    @abstractmethod
    def recreate(self, sandbox: Sandbox) -> None:
        """Recreate the sandbox workload with current image and limits, keeping volume."""

    @abstractmethod
    def update_limits(self, sandbox: Sandbox) -> None:
        """Update CPU and memory limits on the sandbox workload."""

    @abstractmethod
    def remove(self, sandbox: Sandbox, purge_volume: bool = False) -> None:
        """Remove the sandbox workload and optionally delete its persistent volume."""

    @abstractmethod
    def status(self, sandbox: Sandbox) -> str:
        """Return normalized runtime status ('running', 'exited'/'stopped', 'starting', 'missing', 'unknown')."""

    @abstractmethod
    def logs(self, sandbox: Sandbox, tail: int = 200) -> str:
        """Return ANSI-stripped recent sandbox logs."""

    @abstractmethod
    def stats(self, sandbox: Sandbox) -> dict[str, float | int | str | None]:
        """Return live CPU %, memory usage, and workspace disk stats for a running sandbox."""

    @abstractmethod
    def exec_command(
        self,
        sandbox: Sandbox,
        cmd: list[str],
        *,
        user: str = "root",
        environment: dict[str, str] | None = None,
    ) -> tuple[int, bytes]:
        """Execute a command inside a running sandbox and return (exit_code, raw_stdout_stderr)."""

    @abstractmethod
    def export_workspace_tar(self, sandbox: Sandbox, exclude_caches: bool = False):
        """Stream a tar archive of /home/workspace from the sandbox."""

    @abstractmethod
    def restore_workspace_tar(
        self,
        sandbox: Sandbox,
        archive_fileobj,
        mode: str = "merge",
    ) -> dict[str, int | bool]:
        """Validate and extract a tar/tar.gz backup into the sandbox /home/workspace."""

    def _container_health_status(self, sandbox: Sandbox) -> str | None:
        return None

    def _probe_health_once(
        self, sandbox: Sandbox, http: Any, url: str
    ) -> tuple[bool, str | None]:
        try:
            response = http.get(url)
            if response.status_code == 200:
                if self._container_health_status(sandbox) != "starting":
                    return True, None
                return False, "container healthcheck still starting"
            return False, f"HTTP {response.status_code}"
        except httpx.HTTPError as exc:
            return False, str(exc)

    def wait_healthy(self, sandbox: Sandbox) -> None:
        compat_mod = sys.modules.get("app.docker_service")
        active_httpx = getattr(compat_mod, "httpx", httpx) if compat_mod else httpx
        active_time = getattr(compat_mod, "time", time) if compat_mod else time

        deadline = active_time.monotonic() + self.settings.health_timeout_seconds
        url = self.health_url(sandbox)
        last_error: str | None = None
        with active_httpx.Client(timeout=2.0, trust_env=False) as http:
            while active_time.monotonic() < deadline:
                ok, err = self._probe_health_once(sandbox, http, url)
                if ok:
                    return
                last_error = err
                active_time.sleep(
                    0.5 if err == "container healthcheck still starting" else 1.0
                )
        raise SandboxRuntimeError(
            f"sandbox {sandbox.slug} did not become healthy at {url}: {last_error}"
        )

    def launch_token_url(self, sandbox: Sandbox) -> str | None:
        """Extract the latest DSH launch URL with ?token=... from sandbox logs if available."""
        try:
            log_text = self.logs(sandbox, tail=300)
        except Exception:
            return None
        for line in reversed(log_text.splitlines()):
            if "dsh web:" in line and "token=" in line:
                parts = line.split("dsh web:", 1)[1].strip().split()
                if parts:
                    return parts[0]
        return None

    def _workload_status(self, sandbox: Sandbox) -> str:
        workload = self.get(sandbox)
        if hasattr(workload, "reload"):
            workload.reload()
        return str(getattr(workload, "status", "unknown"))

    def workspace_disk_usage(self, sandbox: Sandbox) -> dict[str, float | int | None]:
        """Measure /home/workspace disk footprint and filesystem capacity inside a running sandbox."""
        empty: dict[str, float | int | None] = {
            "disk_usage_bytes": None,
            "disk_usage_mb": None,
            "disk_fs_total_mb": None,
            "disk_fs_avail_mb": None,
            "disk_fs_used_percent": None,
        }
        try:
            if self._workload_status(sandbox) != "running":
                return empty
            ec, out = self.exec_command(
                sandbox,
                [
                    "sh",
                    "-c",
                    "df -Pk /home/workspace 2>/dev/null | tail -n 1; "
                    "echo '---DU---'; "
                    "timeout 4 du -sk -x /home/workspace 2>/dev/null || true",
                ],
                user="root",
            )
        except Exception:
            return empty
        if ec != 0 or not out:
            return empty
        text = out.decode("utf-8", errors="replace")
        if "---DU---" not in text:
            return empty
        df_part, du_part = text.split("---DU---", 1)
        result = dict(empty)

        df_tokens = df_part.strip().split()
        if len(df_tokens) >= 5 and df_tokens[1].isdigit() and df_tokens[3].isdigit():
            total_kb = int(df_tokens[1])
            avail_kb = int(df_tokens[3])
            result["disk_fs_total_mb"] = round(total_kb / 1024, 1)
            result["disk_fs_avail_mb"] = round(avail_kb / 1024, 1)
            pct_raw = df_tokens[4].rstrip("%")
            if pct_raw.isdigit():
                result["disk_fs_used_percent"] = float(pct_raw)

        du_tokens = du_part.strip().split()
        if du_tokens and du_tokens[0].isdigit():
            used_bytes = int(du_tokens[0]) * 1024
            result["disk_usage_bytes"] = used_bytes
            result["disk_usage_mb"] = round(used_bytes / (1024 * 1024), 1)

        return result

    def has_active_work(self, sandbox: Sandbox) -> tuple[bool, str]:
        """Detect user background daemons or active agent child processes before auto-sleeping."""
        try:
            if self._workload_status(sandbox) != "running":
                return False, "not-running"
        except Exception:
            return False, "not-running"
        probe = (
            "if ls /home/workspace/.dsh-sandbox/services/conf.d/*.conf >/dev/null 2>&1; then "
            "echo ACTIVE:user-services; exit 0; fi; "
            "dsh_pid=$(pgrep -u workspace -f '/usr/local/bin/dsh ' | head -n 1); "
            "if [ -n \"$dsh_pid\" ] && ps -o pid=,comm= --ppid \"$dsh_pid\" 2>/dev/null "
            "| awk '$2 != \"tee\" && $2 != \"\" {found=1} END {exit !found}'; then "
            "echo ACTIVE:agent-subprocess; exit 0; fi; "
            "echo IDLE"
        )
        try:
            ec, out = self.exec_command(sandbox, ["sh", "-c", probe], user="root")
        except Exception:
            return False, "probe-skipped"
        text = out.decode("utf-8", errors="replace").strip() if out else ""
        if ec == 0 and text.startswith("ACTIVE:"):
            return True, text.split(":", 1)[1]
        return False, "idle"

    def _sanitize_restore_member(self, member: tarfile.TarInfo) -> tarfile.TarInfo | None:
        """Normalize archive paths relative to /home/workspace and reject escapes/devices."""
        raw_name = member.name.replace("\\", "/")
        stripped = raw_name.lstrip("/")
        if raw_name.startswith("/"):
            raise SandboxRuntimeError(f"unsafe absolute archive path: {member.name}")
        parts = [p for p in PurePosixPath(stripped).parts if p not in ("", ".")]
        if any(p == ".." for p in parts):
            raise SandboxRuntimeError(f"unsafe archive path traversal: {member.name}")
        if parts and parts[0] == "workspace":
            parts = parts[1:]
        if not parts:
            return None
        rel = "/".join(parts)
        if member.isdev() or member.isfifo():
            raise SandboxRuntimeError(f"unsupported special file in backup: {member.name}")
        if member.issym() or member.islnk():
            target = member.linkname.replace("\\", "/")
            if target.startswith("/"):
                raise SandboxRuntimeError(f"unsafe link target in backup: {member.name} -> {target}")
            base = rel if member.islnk() else posixpath.dirname(rel)
            joined = posixpath.normpath(target if member.islnk() else posixpath.join(base, target))
            if joined == ".." or joined.startswith("../") or joined.startswith("/"):
                raise SandboxRuntimeError(f"link escapes workspace root: {member.name} -> {target}")
        cloned = copy.copy(member)
        cloned.name = rel
        cloned.uid = 1000
        cloned.gid = 1000
        cloned.uname = "workspace"
        cloned.gname = "workspace"
        return cloned

    def _prepare_sanitized_restore_tar(
        self, archive_fileobj
    ) -> tuple[tempfile.SpooledTemporaryFile, int]:
        spooled = tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024)
        restored_entries = 0
        try:
            archive_fileobj.seek(0)
            with tarfile.open(fileobj=archive_fileobj, mode="r:*") as src_tar:
                with tarfile.open(fileobj=spooled, mode="w") as dst_tar:
                    for member in src_tar:
                        clean_member = self._sanitize_restore_member(member)
                        if clean_member is None:
                            continue
                        extracted = src_tar.extractfile(member) if member.isfile() else None
                        dst_tar.addfile(clean_member, extracted)
                        restored_entries += 1
        except SandboxRuntimeError:
            spooled.close()
            raise
        except Exception as exc:
            spooled.close()
            raise SandboxRuntimeError(f"invalid tar archive: {exc}") from exc

        if restored_entries == 0:
            spooled.close()
            raise SandboxRuntimeError("backup archive contains no restorable workspace entries")
        spooled.seek(0)
        return spooled, restored_entries

    def sync_plugin_market(
        self,
        sandbox: Sandbox,
        reinstall_plugins: list[str] | None = None,
        force_reinstall: bool = False,
    ) -> dict[str, Any]:
        """Ensure Plugin Market config and optionally force-reinstall built-in plugins in a sandbox."""
        st = self._workload_status(sandbox)
        if st != "running":
            return {"slug": sandbox.slug, "ok": False, "detail": f"status={st}"}

        manager_url = self.settings.sandbox_reachable_manager_url
        index_url = f"{manager_url}/plugins/index.json"
        npm_registry = f"{manager_url}/plugins/npm"
        registry = PluginRegistryService(self.settings)
        registry_packages = {pkg.name: pkg for pkg in registry.list_packages()}

        explicit_targets: list[str] = []
        for raw_spec in reinstall_plugins or []:
            spec = raw_spec.strip()
            if not spec:
                continue
            pkg = registry.get_by_package_name(spec) or registry.get_by_slug_or_filename(spec)
            explicit_targets.append(pkg.name if pkg else spec)

        node_script = """
const fs = require('fs');
const indexUrl = process.env.INDEX_URL;
const npmRegistry = process.env.NPM_REGISTRY || '';
try { fs.rmSync('/home/workspace/.cache/pnpm', { recursive: true, force: true }); } catch {}
fs.mkdirSync('/home/workspace/.dsh-sandbox', { recursive: true });
fs.writeFileSync('/home/workspace/.dsh-sandbox/plugin-index-url.txt', indexUrl + '\\n');
if (npmRegistry) {
  fs.writeFileSync('/home/workspace/.dsh-sandbox/plugin-npm-registry.txt', npmRegistry + '\\n');
}
const profileDir = '/home/workspace/.dsh/profiles/web';
const pkgPath = profileDir + '/package.json';
const patchPath = profileDir + '/cordis.patch.yml';
const npmrcPath = profileDir + '/.npmrc';
if (npmRegistry && fs.existsSync(profileDir)) {
  const existing = fs.existsSync(npmrcPath) ? fs.readFileSync(npmrcPath, 'utf8') : '';
  const lines = existing.split(/\\r?\\n/).filter((l) => l.trim() !== '' && !/^registry\\s*=/.test(l.trim()));
  lines.unshift('registry=' + npmRegistry);
  fs.writeFileSync(npmrcPath, lines.join('\\n') + '\\n');
}
let installedDeps = [];
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  installedDeps = Object.keys(pkg.dependencies || {});
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  pkg.dsh.profile.bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
  const bundle = '@deepseek-ai/dsh-experimental-plugin-market-bundle';
  if (!pkg.dsh.profile.bundles.includes(bundle)) {
    pkg.dsh.profile.bundles.push(bundle);
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\\n');
  }
}
if (fs.existsSync(patchPath)) {
  let content = fs.readFileSync(patchPath, 'utf8');
  content = content.replace(/^\\s*\\[\\]\\s*$/m, '');
  if (!content.includes('id: plugin-market')) {
    content = content.trimEnd() + '\\n\\n- id: plugin-market\\n  name: "@deepseek-ai/dsh-plugin-market"\\n  config:\\n    indexes:\\n      - ' + JSON.stringify(indexUrl) + '\\n';
    fs.writeFileSync(patchPath, content);
  } else if (!content.includes(indexUrl)) {
    content = content.replace(/(- id: plugin-market[\\s\\S]*?indexes:)\\s*\\[\\s*\\]/, '$1\\n      - ' + JSON.stringify(indexUrl));
    if (!content.includes(indexUrl)) {
      content = content.replace(/(- id: plugin-market[\\s\\S]*?indexes:)/, '$1\\n      - ' + JSON.stringify(indexUrl));
    }
    fs.writeFileSync(patchPath, content);
  }
}
console.log('INSTALLED_DEPS=' + JSON.stringify(installedDeps));
"""
        ec1, out1 = self.exec_command(
            sandbox,
            ["node", "-e", node_script],
            user="workspace",
            environment={
                "INDEX_URL": index_url,
                "NPM_REGISTRY": npm_registry,
                "HOME": "/home/workspace",
            },
        )
        text1 = out1.decode("utf-8", errors="replace").strip() if out1 else ""
        if ec1 != 0:
            return {"slug": sandbox.slug, "ok": False, "detail": text1[-300:]}

        installed_deps: list[str] = []
        for line in text1.splitlines():
            if line.startswith("INSTALLED_DEPS="):
                try:
                    parsed = json.loads(line.split("=", 1)[1])
                    if isinstance(parsed, list):
                        installed_deps = [str(x) for x in parsed]
                except Exception:
                    pass

        targets_to_install = list(explicit_targets)
        if not targets_to_install and force_reinstall:
            configured = self._resolve_auto_install_plugins(sandbox.auto_install_plugins)
            configured_list = [x.strip() for x in configured.split(",") if x.strip()]
            installed_builtin = [name for name in installed_deps if name in registry_packages]
            seen_targets: set[str] = set()
            for item in [*installed_builtin, *configured_list]:
                if item not in seen_targets:
                    seen_targets.add(item)
                    targets_to_install.append(item)

        reinstalled: list[str] = []
        if targets_to_install:
            env = {
                "HOME": "/home/workspace",
                "DSH_HOME": "/home/workspace/.dsh",
                "npm_config_registry": npm_registry,
            }
            self.exec_command(
                sandbox,
                [
                    "sh",
                    "-c",
                    "rm -rf /home/workspace/.dsh/profiles/web/.pnpm-store "
                    "/home/workspace/.local/share/pnpm/store /home/workspace/.cache/pnpm",
                ],
                user="workspace",
                environment=env,
            )
            to_remove = [p for p in targets_to_install if p in installed_deps]
            if to_remove:
                self.exec_command(
                    sandbox,
                    ["dsh", "plugin", "--profile", "web", "remove", *to_remove],
                    user="workspace",
                    environment=env,
                )
            for spec in targets_to_install:
                cmd = ["dsh", "plugin", "--profile", "web", "add"]
                if not spec.startswith(("http://", "https://", "/", "file:")):
                    cmd.append(f"--registry={npm_registry}")
                cmd.append(spec)
                ec_add, out_add = self.exec_command(
                    sandbox, cmd, user="workspace", environment=env
                )
                if ec_add != 0:
                    add_msg = out_add.decode("utf-8", errors="replace").strip() if out_add else ""
                    return {
                        "slug": sandbox.slug,
                        "ok": False,
                        "reinstalled": reinstalled,
                        "detail": f"failed to install {spec}: {add_msg[-240:]}",
                    }
                reinstalled.append(spec)

        ec2, out2 = self.exec_command(
            sandbox,
            ["supervisorctl", "restart", "dsh"],
            user="root",
        )
        text = out2.decode("utf-8", errors="replace").strip() if out2 else ""
        return {
            "slug": sandbox.slug,
            "ok": ec2 == 0,
            "reinstalled": reinstalled,
            "detail": text[-300:] if text else "synced",
        }

    def sync_llm_profile(
        self,
        sandbox: Sandbox,
        profile: LlmProfile,
        *,
        set_as_default: bool = True,
        replace_managed: bool = False,
    ) -> dict[str, Any]:
        """Hot-push an LLM profile into a running sandbox's DSH config and restart dsh."""
        st = self._workload_status(sandbox)
        if st != "running":
            return {
                "slug": sandbox.slug,
                "sandbox_id": sandbox.id,
                "ok": False,
                "skipped": True,
                "detail": f"status={st}",
            }

        provider_key, cred_ref = llm_provider_identifiers(profile)
        api_key = ""
        if profile.api_key_ciphertext:
            try:
                api_key = decrypt_secret(profile.api_key_ciphertext)
            except ValueError:
                api_key = ""

        api_protocol = (profile.api_protocol or "openai-completions").strip()
        payload = {
            "providerKey": provider_key,
            "credRef": cred_ref,
            "displayName": profile.name,
            "apiProtocol": api_protocol,
            "baseUrl": profile.base_url,
            "model": profile.model,
            "apiKey": api_key or "local-no-key",
            "contextWindow": profile.context_window,
            "maxTokens": profile.max_tokens,
            "supportsImage": bool(profile.supports_image),
            "reasoningEffort": (profile.reasoning_effort or "").strip().lower(),
            "thinkingFormat": (
                (profile.thinking_format or "").strip()
                if api_protocol == "openai-completions"
                else ""
            ),
            "setAsDefault": bool(set_as_default),
            "replaceManaged": bool(replace_managed),
        }

        node_script = """
const fs = require('fs');
const path = require('path');
const yaml = require('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/yaml');

const cfg = JSON.parse(process.env.LLM_PUSH_PAYLOAD || '{}');
const validEfforts = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const dshHome = '/home/workspace/.dsh';
const profileDir = path.join(dshHome, 'profiles', 'web');
const patchPath = path.join(profileDir, 'cordis.patch.yml');
const credPath = path.join(dshHome, '.credentials.yaml');

fs.mkdirSync(profileDir, { recursive: true });

let entries = [];
if (fs.existsSync(patchPath)) {
  const raw = fs.readFileSync(patchPath, 'utf8');
  const parsed = yaml.parse(raw);
  if (Array.isArray(parsed)) entries = parsed;
}

let piAiEntry = entries.find((e) => e && typeof e === 'object' && e.id === 'llm-pi-ai');
if (!piAiEntry) {
  piAiEntry = { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: {} } };
  entries.push(piAiEntry);
}
if (!piAiEntry.name) piAiEntry.name = '@deepseek-ai/dsh-llm-pi-ai';
if (!piAiEntry.config || typeof piAiEntry.config !== 'object') piAiEntry.config = {};
if (!piAiEntry.config.providers || typeof piAiEntry.config.providers !== 'object') {
  piAiEntry.config.providers = {};
}
const providers = piAiEntry.config.providers;

let removedLegacyDefault = false;
const removedRefs = [];
const legacyBoot = providers['openai-compatible'];
if (legacyBoot && typeof legacyBoot === 'object' && legacyBoot.apiKeyEnv === 'DSH_DEFAULT_LLM_API_KEY') {
  if (
    cfg.replaceManaged
    || legacyBoot.displayName === cfg.displayName
    || legacyBoot.baseURL === cfg.baseUrl
  ) {
    delete providers['openai-compatible'];
    removedLegacyDefault = true;
  }
}
if (cfg.replaceManaged) {
  for (const key of Object.keys(providers)) {
    if (key.startsWith('mgr-') && key !== cfg.providerKey) {
      const ref = providers[key] && providers[key].apiKeyEnv;
      if (typeof ref === 'string' && ref.startsWith('DSH_LLM_MGR_')) {
        removedRefs.push(ref);
      }
      delete providers[key];
    }
  }
}

const modelEntry = {
  id: cfg.model,
  name: cfg.model,
  input: cfg.supportsImage ? ['text', 'image'] : ['text'],
};
if (Number.isFinite(cfg.contextWindow) && cfg.contextWindow >= 1024) {
  modelEntry.contextWindow = Math.floor(cfg.contextWindow);
}
if (Number.isFinite(cfg.maxTokens) && cfg.maxTokens >= 128) {
  modelEntry.maxTokens = Math.floor(cfg.maxTokens);
}
if (cfg.reasoningEffort === 'off') {
  modelEntry.reasoningEfforts = false;
} else if (validEfforts.has(cfg.reasoningEffort)) {
  modelEntry.reasoningEfforts = {
    off: null,
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  };
}

const providerObj = {
  api: cfg.apiProtocol || 'openai-completions',
  baseURL: cfg.baseUrl,
  displayName: cfg.displayName,
  apiKeyEnv: cfg.credRef,
};
if (validEfforts.has(cfg.reasoningEffort)) {
  providerObj.reasoning = cfg.reasoningEffort;
}
if (cfg.thinkingFormat && providerObj.api === 'openai-completions') {
  providerObj.compat = { thinkingFormat: cfg.thinkingFormat };
}
providerObj.models = [modelEntry];
providers[cfg.providerKey] = providerObj;

let defaultEntry = entries.find((e) => e && typeof e === 'object' && e.id === 'agent-default-model');
const shouldUpdateDefault = Boolean(cfg.setAsDefault)
  || (removedLegacyDefault && defaultEntry && defaultEntry.config && defaultEntry.config.provider === 'openai-compatible');
if (shouldUpdateDefault) {
  const defaultConfig = {
    provider: cfg.providerKey,
    model: cfg.model,
  };
  if (validEfforts.has(cfg.reasoningEffort) && cfg.reasoningEffort !== 'off') {
    defaultConfig.reasoningEffort = cfg.reasoningEffort;
  }
  if (!defaultEntry) {
    defaultEntry = { id: 'agent-default-model', config: defaultConfig };
    entries.unshift(defaultEntry);
  } else {
    defaultEntry.config = defaultConfig;
  }
}

const patchTmp = patchPath + '.tmp.' + process.pid;
fs.writeFileSync(patchTmp, yaml.stringify(entries), 'utf8');
fs.renameSync(patchTmp, patchPath);

let credDoc = { version: 1, refs: {} };
if (fs.existsSync(credPath)) {
  const rawCred = fs.readFileSync(credPath, 'utf8');
  const parsedCred = yaml.parse(rawCred);
  if (parsedCred && typeof parsedCred === 'object' && !Array.isArray(parsedCred)) {
    credDoc = parsedCred;
  }
}
credDoc.version = 1;
if (!credDoc.refs || typeof credDoc.refs !== 'object' || Array.isArray(credDoc.refs)) {
  credDoc.refs = {};
}
for (const oldRef of removedRefs) {
  delete credDoc.refs[oldRef];
}
credDoc.refs[cfg.credRef] = cfg.apiKey || 'local-no-key';

const credTmp = credPath + '.tmp.' + process.pid;
fs.writeFileSync(credTmp, yaml.stringify(credDoc), { encoding: 'utf8', mode: 0o600 });
fs.chmodSync(credTmp, 0o600);
fs.renameSync(credTmp, credPath);
fs.chmodSync(credPath, 0o600);
console.log('LLM_SYNC_OK:' + cfg.providerKey + ':' + cfg.model);
"""
        ec1, out1 = self.exec_command(
            sandbox,
            ["node", "-e", node_script],
            user="workspace",
            environment={
                "HOME": "/home/workspace",
                "DSH_HOME": "/home/workspace/.dsh",
                "LLM_PUSH_PAYLOAD": json.dumps(payload),
            },
        )
        text1 = out1.decode("utf-8", errors="replace").strip() if out1 else ""
        if ec1 != 0:
            return {
                "slug": sandbox.slug,
                "sandbox_id": sandbox.id,
                "ok": False,
                "skipped": False,
                "detail": text1[-300:] or f"node exit {ec1}",
            }

        ec2, out2 = self.exec_command(
            sandbox,
            ["supervisorctl", "restart", "dsh"],
            user="root",
        )
        text2 = out2.decode("utf-8", errors="replace").strip() if out2 else ""
        return {
            "slug": sandbox.slug,
            "sandbox_id": sandbox.id,
            "ok": ec2 == 0,
            "skipped": False,
            "provider": provider_key,
            "model": profile.model,
            "set_as_default": bool(set_as_default),
            "detail": text2[-300:] if text2 else "synced",
        }
