from __future__ import annotations

import io
import tarfile
from pathlib import Path
from typing import Any

import docker
from docker.errors import APIError, ImageNotFound, NotFound
from docker.models.containers import Container

from ..config import Settings
from ..models import Sandbox
from .base import (
    AUTH_RESPONSE_HEADERS,
    TAR_CACHE_EXCLUDES,
    BaseSandboxRuntime,
    SandboxRuntimeError,
    sandbox_traefik_dsh_rule,
    strip_ansi,
)


class DockerSandboxRuntime(BaseSandboxRuntime):
    """Docker runtime supporting both local unix socket (bridge network) and remote TCP/SSH daemons."""

    runtime_name = "docker"

    def __init__(self, settings: Settings):
        super().__init__(settings)
        self._client: docker.DockerClient | None = None

    @property
    def is_remote_mode(self) -> bool:
        """True when sandboxes run on a remote Docker host accessed via published host ports."""
        return bool((self.settings.docker_public_host or "").strip())

    def _build_client(self) -> docker.DockerClient:
        host = (self.settings.docker_host or "").strip()
        has_tls = bool(
            self.settings.docker_tls_verify
            or self.settings.docker_tls_ca_cert
            or self.settings.docker_tls_client_cert
        )
        if not host and not has_tls:
            return docker.from_env()

        tls_config: docker.tls.TLSConfig | bool = False
        if has_tls:
            tls_kwargs: dict[str, Any] = {
                "verify": bool(
                    self.settings.docker_tls_verify or self.settings.docker_tls_ca_cert
                )
            }
            if self.settings.docker_tls_ca_cert:
                tls_kwargs["ca_cert"] = self.settings.docker_tls_ca_cert
            if (
                self.settings.docker_tls_client_cert
                and self.settings.docker_tls_client_key
            ):
                tls_kwargs["client_cert"] = (
                    self.settings.docker_tls_client_cert,
                    self.settings.docker_tls_client_key,
                )
            tls_config = docker.tls.TLSConfig(**tls_kwargs)

        kwargs: dict[str, Any] = {}
        if host:
            kwargs["base_url"] = host
        if tls_config:
            kwargs["tls"] = tls_config
        return docker.DockerClient(**kwargs)

    @property
    def client(self) -> docker.DockerClient:
        if self._client is None:
            self._client = self._build_client()
        return self._client

    def ping(self) -> bool:
        return bool(self.client.ping())

    def list_local_images(self) -> list[dict[str, str | float]]:
        items: list[dict[str, str | float]] = []
        try:
            for img in self.client.images.list():
                size_mb = round(int(img.attrs.get("Size") or 0) / (1024 * 1024), 1)
                short_id = (img.short_id or "").removeprefix("sha256:")
                for tag_full in img.tags or []:
                    if ":" in tag_full:
                        repo, tag = tag_full.rsplit(":", 1)
                    else:
                        repo, tag = tag_full, "latest"
                    items.append(
                        {
                            "full_name": tag_full,
                            "repo": repo,
                            "tag": tag,
                            "id": short_id,
                            "size_mb": size_mb,
                        }
                    )
        except Exception:
            pass
        return items

    def _ensure_network(self) -> None:
        try:
            self.client.networks.get(self.settings.dsh_network)
        except NotFound:
            self.client.networks.create(self.settings.dsh_network, driver="bridge")

    def _ensure_image(
        self, tag: str | None = None, repo: str | None = None
    ) -> None:
        image = self.image_for(tag, repo)
        try:
            self.client.images.get(image)
        except ImageNotFound as exc:
            if not self.settings.pull_missing_image:
                raise SandboxRuntimeError(
                    f"image {image} is not present; pull it or set PULL_MISSING_IMAGE=true"
                ) from exc
            self.client.images.pull(
                repo or self.settings.dsh_image_repo,
                tag=tag or self.settings.dsh_image_tag,
            )

    def upstream_origin(self, sandbox: Sandbox) -> str:
        """Return http://<ip_or_container_name>:<port> reachable by Manager and Traefik."""
        public_host = (self.settings.docker_public_host or "").strip()
        try:
            container = self.get(sandbox)
            container.reload()
            net_settings = container.attrs.get("NetworkSettings") or {}
            if public_host:
                ports = net_settings.get("Ports") or {}
                bindings = ports.get("8080/tcp") or []
                if bindings and isinstance(bindings[0], dict):
                    host_port = bindings[0].get("HostPort")
                    if host_port:
                        return f"http://{public_host}:{host_port}"
            networks = net_settings.get("Networks") or {}
            address = networks.get(self.settings.dsh_network, {}).get("IPAddress")
            if address:
                return f"http://{address}:8080"
        except Exception:
            pass
        if public_host:
            return f"http://{public_host}:8080"
        return f"http://{self.container_name(sandbox)}:8080"

    def _inject_ca_bundle_archive(self, container: Container, ca_path: Path) -> None:
        """Push custom CA bundle into /etc/dsh/ca/custom-ca.crt over Docker API for remote daemons."""
        data = ca_path.read_bytes()
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w") as tf:
            info = tarfile.TarInfo("custom-ca.crt")
            info.size = len(data)
            info.mode = 0o644
            tf.addfile(info, io.BytesIO(data))
        buf.seek(0)
        container.exec_run(["mkdir", "-p", "/etc/dsh/ca"], user="root")
        container.put_archive("/etc/dsh/ca", buf.getvalue())

    def create(self, sandbox: Sandbox) -> Container:
        self._ensure_network()
        self._ensure_image(sandbox.image_tag, sandbox.image_repo)
        volumes: dict[str, dict[str, str]] = {
            sandbox.volume_name: {"bind": "/home/workspace", "mode": "rw"}
        }
        ca_path: Path | None = None
        if self.settings.custom_ca_bundle_path:
            candidate = Path(self.settings.custom_ca_bundle_path)
            if candidate.is_file():
                ca_path = candidate
                if not self.is_remote_mode:
                    volumes[str(candidate.resolve())] = {
                        "bind": "/etc/dsh/ca/custom-ca.crt",
                        "mode": "ro",
                    }

        router_name = f"dsh-sbx-{sandbox.slug}"
        dsh_router_name = f"dsh-sbx-{sandbox.slug}-dsh"
        auth_mw = f"dsh-auth-{sandbox.slug}"
        verify_url = (
            f"{self.settings.sandbox_reachable_manager_url}"
            f"/api/auth/verify-sandbox/{sandbox.slug}"
        )
        dsh_rule = sandbox_traefik_dsh_rule(sandbox.slug)
        labels = {
            "dsh.managed": "true",
            "dsh.owner": sandbox.user.email,
            "dsh.slug": sandbox.slug,
            "dsh.volume": sandbox.volume_name,
            "dsh.template": sandbox.template or "agent-os",
            "traefik.enable": "true",
            f"traefik.http.routers.{router_name}.rule": f"PathPrefix(`/s/{sandbox.slug}`)",
            f"traefik.http.routers.{router_name}.entrypoints": "web",
            f"traefik.http.routers.{router_name}.priority": "100",
            f"traefik.http.routers.{router_name}.service": router_name,
            f"traefik.http.routers.{dsh_router_name}.rule": dsh_rule,
            f"traefik.http.routers.{dsh_router_name}.entrypoints": "web",
            f"traefik.http.routers.{dsh_router_name}.priority": "120",
            f"traefik.http.routers.{dsh_router_name}.service": router_name,
            f"traefik.http.routers.{dsh_router_name}.middlewares": f"{auth_mw}@docker",
            f"traefik.http.middlewares.{auth_mw}.forwardauth.address": verify_url,
            f"traefik.http.middlewares.{auth_mw}.forwardauth.trustForwardHeader": "true",
            f"traefik.http.middlewares.{auth_mw}.forwardauth.authResponseHeaders": ",".join(
                AUTH_RESPONSE_HEADERS
            ),
            f"traefik.http.services.{router_name}.loadbalancer.server.port": "8080",
        }

        run_kwargs: dict[str, Any] = {
            "name": self.container_name(sandbox),
            "detach": True,
            "volumes": volumes,
            "environment": self.environment(sandbox),
            "labels": labels,
            "network": self.settings.dsh_network,
            "restart_policy": {"Name": "unless-stopped"},
            "mem_limit": sandbox.memory_limit or self.settings.sandbox_memory,
            "cpu_period": 100_000,
            "cpu_quota": int(
                (sandbox.cpu_limit or self.settings.sandbox_cpus) * 100_000
            ),
            "pids_limit": 512,
            "security_opt": ["no-new-privileges:true"],
            "log_config": {
                "Type": "json-file",
                "Config": {"max-size": "20m", "max-file": "3"},
            },
            "init": True,
        }
        if self.is_remote_mode:
            bind_ip = (self.settings.docker_host_port_bind_ip or "0.0.0.0").strip()
            run_kwargs["ports"] = (
                {"8080/tcp": (bind_ip, None)}
                if bind_ip and bind_ip != "0.0.0.0"
                else {"8080/tcp": None}
            )

        container = self.client.containers.run(
            self.image_for(sandbox.image_tag, sandbox.image_repo),
            **run_kwargs,
        )
        if self.is_remote_mode and ca_path is not None:
            try:
                self._inject_ca_bundle_archive(container, ca_path)
            except Exception:
                pass
        return container

    def update_limits(self, sandbox: Sandbox) -> None:
        container = self.get(sandbox)
        cpus = sandbox.cpu_limit or self.settings.sandbox_cpus
        try:
            container.update(
                mem_limit=sandbox.memory_limit or self.settings.sandbox_memory,
                cpu_period=100_000,
                cpu_quota=int(cpus * 100_000),
            )
        except APIError as exc:
            raise SandboxRuntimeError(f"limit update failed: {exc}") from exc

    def recreate(self, sandbox: Sandbox) -> None:
        """Recreate a container with the current image and limits, keeping volume."""
        self.remove(sandbox, purge_volume=False)
        sandbox.container_id = None
        container = self.create(sandbox)
        sandbox.container_id = container.id
        self.wait_healthy(sandbox)

    def _container_health_status(self, sandbox: Sandbox) -> str | None:
        try:
            container = self.get(sandbox)
            container.reload()
            state = container.attrs.get("State") if isinstance(container.attrs, dict) else None
            health = state.get("Health") if isinstance(state, dict) else None
            status = health.get("Status") if isinstance(health, dict) else None
            return status if isinstance(status, str) else None
        except Exception:
            return None

    def get(self, sandbox: Sandbox) -> Container:
        try:
            if sandbox.container_id:
                return self.client.containers.get(sandbox.container_id)
            return self.client.containers.get(self.container_name(sandbox))
        except NotFound as exc:
            raise SandboxRuntimeError(f"container for {sandbox.slug} not found") from exc

    def start(self, sandbox: Sandbox) -> str:
        container = self.get(sandbox)
        container.start()
        container.reload()
        return container.status

    def stop(self, sandbox: Sandbox) -> str:
        container = self.get(sandbox)
        container.stop(timeout=20)
        container.reload()
        return container.status

    def restart(self, sandbox: Sandbox) -> str:
        container = self.get(sandbox)
        container.restart(timeout=20)
        container.reload()
        return container.status

    def status(self, sandbox: Sandbox) -> str:
        try:
            container = self.get(sandbox)
            container.reload()
            return container.status
        except SandboxRuntimeError:
            return "missing"
        except APIError:
            return "unknown"

    def logs(self, sandbox: Sandbox, tail: int = 200) -> str:
        container = self.get(sandbox)
        raw = container.logs(tail=tail, timestamps=True)
        text = raw.decode("utf-8", errors="replace")
        return strip_ansi(text)

    def exec_command(
        self,
        sandbox: Sandbox,
        cmd: list[str],
        *,
        user: str = "root",
        environment: dict[str, str] | None = None,
    ) -> tuple[int, bytes]:
        container = self.get(sandbox)
        kwargs: dict[str, Any] = {"user": user}
        if environment is not None:
            kwargs["environment"] = environment
        ec, out = container.exec_run(cmd, **kwargs)
        return int(ec), (out or b"")

    def stats(self, sandbox: Sandbox) -> dict[str, float | int | str | None]:
        """Return live CPU %, memory usage, and workspace disk stats for a running sandbox."""
        container = self.get(sandbox)
        raw = container.stats(stream=False)
        mem_stats = raw.get("memory_stats") or {}
        mem_usage = int(mem_stats.get("usage") or 0)
        mem_limit = int(mem_stats.get("limit") or 0)

        cpu_stats = raw.get("cpu_stats") or {}
        precpu_stats = raw.get("precpu_stats") or {}
        cpu_delta = int(
            (cpu_stats.get("cpu_usage") or {}).get("total_usage", 0)
        ) - int((precpu_stats.get("cpu_usage") or {}).get("total_usage", 0))
        system_delta = int(cpu_stats.get("system_cpu_usage") or 0) - int(
            precpu_stats.get("system_cpu_usage") or 0
        )
        online_cpus = int(cpu_stats.get("online_cpus") or 1)
        cpu_percent = 0.0
        if system_delta > 0 and cpu_delta > 0:
            cpu_percent = round((cpu_delta / system_delta) * online_cpus * 100.0, 2)

        disk = self.workspace_disk_usage(sandbox)
        return {
            "cpu_percent": cpu_percent,
            "memory_usage_bytes": mem_usage,
            "memory_limit_bytes": mem_limit,
            "memory_usage_mb": round(mem_usage / (1024 * 1024), 1),
            "memory_limit_mb": round(mem_limit / (1024 * 1024), 1),
            **disk,
        }

    def export_workspace_tar(self, sandbox: Sandbox, exclude_caches: bool = False):
        """Stream a tar archive of /home/workspace from the sandbox container."""
        container = self.get(sandbox)
        if exclude_caches:
            container.reload()
            if container.status == "running":
                _ec, stream = container.exec_run(
                    [
                        "tar",
                        *TAR_CACHE_EXCLUDES,
                        "-cf",
                        "-",
                        "-C",
                        "/home",
                        "workspace",
                    ],
                    user="root",
                    stream=True,
                    demux=True,
                )

                def _stdout_chunks():
                    for stdout_chunk, _stderr_chunk in stream:
                        if stdout_chunk:
                            yield stdout_chunk

                return _stdout_chunks()
        bits, _stat = container.get_archive("/home/workspace")
        return bits

    def restore_workspace_tar(
        self,
        sandbox: Sandbox,
        archive_fileobj,
        mode: str = "merge",
    ) -> dict[str, int | bool]:
        """Validate and extract a tar/tar.gz backup into the sandbox /home/workspace."""
        if mode not in {"merge", "clean"}:
            raise SandboxRuntimeError(f"unsupported restore mode: {mode}")

        spooled, restored_entries = self._prepare_sanitized_restore_tar(archive_fileobj)
        container = self.get(sandbox)
        container.reload()
        was_running = container.status == "running"
        try:
            if was_running:
                container.exec_run(["supervisorctl", "stop", "dsh"], user="root")
                if mode == "clean":
                    container.exec_run(
                        [
                            "find",
                            "/home/workspace",
                            "-mindepth",
                            "1",
                            "-maxdepth",
                            "1",
                            "!",
                            "-name",
                            ".dsh-sandbox",
                            "-exec",
                            "rm",
                            "-rf",
                            "{}",
                            "+",
                        ],
                        user="root",
                    )
            spooled.seek(0)
            ok = container.put_archive("/home/workspace", spooled.read())
            if not ok:
                raise SandboxRuntimeError("docker put_archive returned failure")
            if was_running:
                container.exec_run(
                    ["chown", "-R", "workspace:workspace", "/home/workspace"],
                    user="root",
                )
                container.exec_run(["supervisorctl", "start", "dsh"], user="root")
                self.wait_healthy(sandbox)
        finally:
            spooled.close()

        return {"restored_entries": restored_entries, "restarted_dsh": was_running}

    def remove(self, sandbox: Sandbox, purge_volume: bool = False) -> None:
        try:
            container = self.get(sandbox)
            container.remove(force=True, v=False)
        except SandboxRuntimeError:
            pass
        except APIError as exc:
            raise SandboxRuntimeError(str(exc)) from exc

        if purge_volume:
            try:
                volume = self.client.volumes.get(sandbox.volume_name)
                volume.remove(force=True)
            except NotFound:
                pass
            except APIError as exc:
                raise SandboxRuntimeError(
                    f"container removed but volume cleanup failed: {exc}"
                ) from exc


DockerService = DockerSandboxRuntime
