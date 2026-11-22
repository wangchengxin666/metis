from __future__ import annotations

import io
import tarfile
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.config import Settings
from app.models import LlmProfile, Sandbox, User
from app.runtime import (
    DockerSandboxRuntime,
    KubernetesSandboxRuntime,
    SandboxRuntimeError,
    build_traefik_dynamic_config,
    create_runtime,
    format_k8s_cpu,
    normalize_k8s_memory,
)


def _make_sandbox(slug: str = "alice", **kwargs) -> Sandbox:
    user = User(email=f"{slug}@example.com", display_name=slug.title())
    sbx = Sandbox(
        id=f"id-{slug}",
        user=user,
        user_id=f"user-{slug}",
        slug=slug,
        volume_name=f"dsh-{slug}-home",
        image_repo="dsh-sandbox",
        image_tag="latest",
        template="agent-os",
        cpu_limit=2.0,
        memory_limit="4g",
        status="creating",
    )
    for k, v in kwargs.items():
        setattr(sbx, k, v)
    return sbx


class _FakeK8sApiException(Exception):
    def __init__(self, status: int, message: str = ""):
        super().__init__(message)
        self.status = status


def test_runtime_factory_and_k8s_quantity_normalizers():
    docker_rt = create_runtime(Settings(_env_file=None, sandbox_runtime="docker"))
    assert isinstance(docker_rt, DockerSandboxRuntime)
    assert docker_rt.runtime_name == "docker"

    k8s_rt = create_runtime(Settings(_env_file=None, sandbox_runtime="kubernetes"))
    assert isinstance(k8s_rt, KubernetesSandboxRuntime)
    assert k8s_rt.runtime_name == "kubernetes"

    assert normalize_k8s_memory("4g") == "4Gi"
    assert normalize_k8s_memory("512m") == "512Mi"
    assert normalize_k8s_memory("1.5g") == "1536Mi"
    assert format_k8s_cpu(2.0) == "2000m"
    assert format_k8s_cpu(0.5) == "500m"


def test_remote_docker_runtime_tls_ephemeral_ports_and_ca_archive_injection(
    tmp_path, monkeypatch
):
    ca_file = tmp_path / "remote-ca.crt"
    ca_file.write_text("-----BEGIN CERTIFICATE-----\nREMOTE\n-----END CERTIFICATE-----\n", encoding="utf-8")

    settings = Settings(
        _env_file=None,
        docker_host="tcp://10.0.0.20:2376",
        docker_tls_verify=True,
        docker_tls_ca_cert="/certs/ca.pem",
        docker_tls_client_cert="/certs/cert.pem",
        docker_tls_client_key="/certs/key.pem",
        docker_public_host="10.0.0.20",
        docker_host_port_bind_ip="10.0.0.20",
        custom_ca_bundle_path=str(ca_file),
    )
    rt = DockerSandboxRuntime(settings)
    assert rt.is_remote_mode is True

    captured_client: dict = {}

    def fake_tls_config(**kwargs):
        captured_client["tls_kwargs"] = kwargs
        return "FAKE_TLS_OBJ"

    mock_docker_client = MagicMock()

    def fake_docker_client(**kwargs):
        captured_client["client_kwargs"] = kwargs
        return mock_docker_client

    monkeypatch.setattr("app.runtime.docker_runtime.docker.tls.TLSConfig", fake_tls_config)
    monkeypatch.setattr("app.runtime.docker_runtime.docker.DockerClient", fake_docker_client)

    assert rt.client is mock_docker_client
    assert captured_client["tls_kwargs"] == {
        "verify": True,
        "ca_cert": "/certs/ca.pem",
        "client_cert": ("/certs/cert.pem", "/certs/key.pem"),
    }
    assert captured_client["client_kwargs"] == {
        "base_url": "tcp://10.0.0.20:2376",
        "tls": "FAKE_TLS_OBJ",
    }

    mock_container = MagicMock()
    mock_container.id = "remote-cid-alice"
    mock_container.attrs = {
        "NetworkSettings": {
            "Ports": {"8080/tcp": [{"HostIp": "10.0.0.20", "HostPort": "32789"}]},
            "Networks": {"dsh-manager": {"IPAddress": "172.18.0.5"}},
        }
    }
    mock_docker_client.containers.run.return_value = mock_container
    mock_docker_client.containers.get.return_value = mock_container

    sbx = _make_sandbox("alice")
    created = rt.create(sbx)
    assert created.id == "remote-cid-alice"

    _, run_kwargs = mock_docker_client.containers.run.call_args
    # Remote mode publishes container :8080 to an ephemeral host port on bind IP
    assert run_kwargs["ports"] == {"8080/tcp": ("10.0.0.20", None)}
    # Remote mode must NOT bind-mount local manager path for CA cert; it pushes via put_archive
    assert str(ca_file.resolve()) not in run_kwargs["volumes"]
    assert mock_container.put_archive.called
    ca_dest, ca_tar_bytes = mock_container.put_archive.call_args[0]
    assert ca_dest == "/etc/dsh/ca"
    with tarfile.open(fileobj=io.BytesIO(ca_tar_bytes), mode="r:*") as tf:
        assert tf.getnames() == ["custom-ca.crt"]

    # upstream_origin resolves the remote host + mapped ephemeral port instead of internal bridge IP
    assert rt.upstream_origin(sbx) == "http://10.0.0.20:32789"
    assert rt.health_url(sbx) == "http://10.0.0.20:32789/healthz"


def test_kubernetes_runtime_lifecycle_traefik_crds_exec_stats_and_backup(tmp_path):
    ca_file = tmp_path / "k8s-ca.crt"
    ca_file.write_text("-----BEGIN CERTIFICATE-----\nK8S\n-----END CERTIFICATE-----\n", encoding="utf-8")

    settings = Settings(
        _env_file=None,
        sandbox_runtime="kubernetes",
        k8s_namespace="dsh-sandboxes",
        k8s_storage_class="fast-ssd",
        k8s_workspace_storage_size="30Gi",
        k8s_image_pull_secret="regcred",
        k8s_routing_mode="traefik-crd",
        manager_internal_url="http://dsh-manager.dsh-sandboxes.svc.cluster.local:9000",
        custom_ca_bundle_path=str(ca_file),
    )
    rt = KubernetesSandboxRuntime(settings)

    # Inject in-memory mock Kubernetes APIs
    core_v1 = MagicMock()
    apps_v1 = MagicMock()
    custom_objects = MagicMock()
    rt._core_v1 = core_v1
    rt._apps_v1 = apps_v1
    rt._custom_objects = custom_objects
    rt._api_loaded = True

    # Simulate resources not existing initially (404)
    not_found = _FakeK8sApiException(404, "Not Found")
    core_v1.read_namespace.side_effect = not_found
    core_v1.read_namespaced_secret.side_effect = not_found
    core_v1.read_namespaced_config_map.side_effect = not_found
    core_v1.read_namespaced_persistent_volume_claim.side_effect = not_found
    core_v1.read_namespaced_service.side_effect = not_found
    apps_v1.read_namespaced_stateful_set.side_effect = not_found
    custom_objects.get_namespaced_custom_object.side_effect = not_found

    sbx = _make_sandbox("alice", cpu_limit=2.0, memory_limit="4g")
    handle = rt.create(sbx)
    assert handle.id == "k8s:dsh-sandboxes/dsh-sbx-alice"
    assert rt.upstream_origin(sbx) == "http://dsh-sbx-alice.dsh-sandboxes.svc.cluster.local:8080"

    # Verify Namespace, Secret, CA ConfigMap, PVC, Service, StatefulSet, and Traefik CRDs were created
    core_v1.create_namespace.assert_called_once()
    core_v1.create_namespaced_secret.assert_called_once()
    core_v1.create_namespaced_config_map.assert_called_once()

    pvc_body = core_v1.create_namespaced_persistent_volume_claim.call_args.kwargs["body"]
    assert pvc_body["metadata"]["name"] == "dsh-alice-home"
    assert pvc_body["spec"]["storageClassName"] == "fast-ssd"
    assert pvc_body["spec"]["resources"]["requests"]["storage"] == "30Gi"

    sts_body = apps_v1.create_namespaced_stateful_set.call_args.kwargs["body"]
    assert sts_body["metadata"]["name"] == "dsh-sbx-alice"
    assert sts_body["spec"]["replicas"] == 1
    pod_spec = sts_body["spec"]["template"]["spec"]
    assert pod_spec["automountServiceAccountToken"] is False
    assert pod_spec["enableServiceLinks"] is False
    assert pod_spec["imagePullSecrets"] == [{"name": "regcred"}]
    container_spec = pod_spec["containers"][0]
    assert container_spec["resources"]["limits"] == {"cpu": "2000m", "memory": "4Gi"}
    assert container_spec["securityContext"]["allowPrivilegeEscalation"] is False

    # Traefik Middleware + IngressRoute CRDs created
    assert custom_objects.create_namespaced_custom_object.call_count == 2
    crd_plurals = [
        c.kwargs["plural"]
        for c in custom_objects.create_namespaced_custom_object.call_args_list
    ]
    assert crd_plurals == ["middlewares", "ingressroutes"]

    # Now simulate StatefulSet and Pod running & Ready
    apps_v1.read_namespaced_stateful_set.side_effect = None
    apps_v1.read_namespaced_stateful_set.return_value = SimpleNamespace(
        spec=SimpleNamespace(replicas=1)
    )
    core_v1.read_namespaced_pod.return_value = SimpleNamespace(
        status=SimpleNamespace(
            phase="Running",
            conditions=[SimpleNamespace(type="Ready", status="True")],
        )
    )
    assert rt.status(sbx) == "running"
    assert rt._container_health_status(sbx) == "healthy"

    # Stop (auto-sleep): removes Traefik IngressRoute so /s/alice/* falls through to Manager wake UI,
    # and scales StatefulSet to replicas=0
    assert rt.stop(sbx) == "stopped"
    custom_objects.delete_namespaced_custom_object.assert_called_once_with(
        group="traefik.io",
        version="v1alpha1",
        namespace="dsh-sandboxes",
        plural="ingressroutes",
        name="dsh-sbx-alice",
    )
    apps_v1.patch_namespaced_stateful_set.assert_called_with(
        name="dsh-sbx-alice",
        namespace="dsh-sandboxes",
        body={"spec": {"replicas": 0}},
    )
    apps_v1.read_namespaced_stateful_set.return_value = SimpleNamespace(
        spec=SimpleNamespace(replicas=0)
    )
    assert rt.status(sbx) == "stopped"

    # Start (wake): scales StatefulSet back to replicas=1 and re-applies Traefik CRDs
    assert rt.start(sbx) == "running"
    apps_v1.read_namespaced_stateful_set.return_value = SimpleNamespace(
        spec=SimpleNamespace(replicas=1)
    )

    # Update limits patches StatefulSet container resources with K8s quantities
    sbx.cpu_limit = 4.0
    sbx.memory_limit = "8g"
    rt.update_limits(sbx)
    patch_body = apps_v1.patch_namespaced_stateful_set.call_args.kwargs["body"]
    patched_limits = patch_body["spec"]["template"]["spec"]["containers"][0]["resources"]["limits"]
    assert patched_limits == {"cpu": "4000m", "memory": "8Gi"}

    # Logs strip ANSI escape sequences
    core_v1.read_namespaced_pod_log.return_value = "\x1b[32m2026-01-01T00:00:00Z dsh web: http://127.0.0.1:8080/?token=k8stoken\x1b[0m\n"
    assert "k8stoken" in rt.logs(sbx)
    assert "\x1b[" not in rt.logs(sbx)
    assert rt.launch_token_url(sbx) == "http://127.0.0.1:8080/?token=k8stoken"

    # Pod exec wrapping for non-root user + environment variables + stats + backup/restore
    exec_calls: list[dict] = []

    class _FakeWsClient:
        def __init__(self, stdout_data: bytes = b"", rc: int = 0):
            self._stdout = stdout_data
            self._consumed = False
            self.returncode = rc
            self.stdin_chunks: list[bytes] = []

        def is_open(self) -> bool:
            return not self._consumed

        def update(self, timeout: int = 5) -> None:
            pass

        def peek_stdout(self) -> bool:
            return not self._consumed and bool(self._stdout)

        def read_stdout(self):
            self._consumed = True
            return self._stdout.decode("utf-8", errors="replace")

        def peek_stderr(self) -> bool:
            return False

        def read_stderr(self) -> str:
            return ""

        def write_stdin(self, data: bytes) -> None:
            self.stdin_chunks.append(data)
            self._consumed = True

        def close(self) -> None:
            self._consumed = True

    def fake_k8s_stream(_fn, pod_name, namespace, **kwargs):
        cmd = kwargs.get("command") or []
        exec_calls.append({"pod": pod_name, "ns": namespace, "cmd": cmd, "stdin": kwargs.get("stdin")})
        joined = " ".join(cmd)
        if "df -Pk" in joined:
            return _FakeWsClient(
                b"/dev/vda1 31457280 4194304 27262976 14% /home/workspace\n"
                b"---DU---\n"
                b"262144 /home/workspace\n"
            )
        if "LLM_SYNC_OK" in joined or "LLM_PUSH_PAYLOAD" in joined:
            return _FakeWsClient(b"LLM_SYNC_OK:mgr-k8s:deepseek-chat\n")
        if "| base64" in joined:
            import base64

            return _FakeWsClient(base64.b64encode(b"k8s-tar-stream-bytes"))
        return _FakeWsClient(b"ok\n")

    rt._get_stream_fn = lambda: fake_k8s_stream

    # Metrics API stats
    custom_objects.get_namespaced_custom_object.side_effect = None
    custom_objects.get_namespaced_custom_object.return_value = {
        "containers": [
            {"name": "sandbox", "usage": {"cpu": "500m", "memory": "512Mi"}}
        ]
    }
    stats = rt.stats(sbx)
    assert stats["cpu_percent"] == 50.0
    assert stats["memory_usage_mb"] == 512.0
    assert stats["memory_limit_mb"] == 8192.0
    assert stats["disk_usage_mb"] == 256.0

    # Sync LLM profile over K8s pod exec wraps command with su workspace + env
    prof = LlmProfile(
        id="k8s-prof-1",
        name="DeepSeek K8s",
        base_url="https://api.deepseek.com/v1",
        model="deepseek-chat",
        api_protocol="openai-completions",
    )
    sync_res = rt.sync_llm_profile(sbx, prof)
    assert sync_res["ok"] is True
    assert any(c["cmd"][:3] == ["su", "-s", "/bin/sh"] for c in exec_calls)

    # Export and Restore tar over K8s pod exec
    exported = b"".join(rt.export_workspace_tar(sbx, exclude_caches=True))
    assert exported == b"k8s-tar-stream-bytes"

    tar_buf = io.BytesIO()
    with tarfile.open(fileobj=tar_buf, mode="w:gz") as tf:
        payload = b"print('hello k8s')\n"
        info = tarfile.TarInfo("workspace/main.py")
        info.size = len(payload)
        tf.addfile(info, io.BytesIO(payload))
    tar_buf.seek(0)
    rt.wait_healthy = MagicMock()
    restore_res = rt.restore_workspace_tar(sbx, tar_buf, mode="clean")
    assert restore_res == {"restored_entries": 1, "restarted_dsh": True}

    # Remove with purge_volume=True deletes StatefulSet, Service, Secret, ConfigMap, CRDs, and PVC
    rt.remove(sbx, purge_volume=True)
    apps_v1.delete_namespaced_stateful_set.assert_called_with(
        name="dsh-sbx-alice", namespace="dsh-sandboxes"
    )
    core_v1.delete_namespaced_persistent_volume_claim.assert_called_with(
        name="dsh-alice-home", namespace="dsh-sandboxes"
    )


def test_kubernetes_runtime_nodeport_mode_for_external_manager():
    settings = Settings(
        _env_file=None,
        sandbox_runtime="kubernetes",
        k8s_namespace="dsh-sandboxes",
        k8s_service_type="NodePort",
        k8s_public_host="127.0.0.1",
        k8s_routing_mode="traefik-http",
    )
    rt = KubernetesSandboxRuntime(settings)
    core_v1 = MagicMock()
    rt._core_v1 = core_v1
    rt._apps_v1 = MagicMock()
    rt._custom_objects = MagicMock()
    rt._api_loaded = True

    not_found = _FakeK8sApiException(404, "Not Found")
    core_v1.read_namespaced_service.side_effect = not_found
    sbx = _make_sandbox("alice")
    rt._upsert_service(sbx)

    svc_body = core_v1.create_namespaced_service.call_args.kwargs["body"]
    assert svc_body["spec"]["type"] == "NodePort"

    core_v1.read_namespaced_service.side_effect = None
    core_v1.read_namespaced_service.return_value = SimpleNamespace(
        spec=SimpleNamespace(ports=[SimpleNamespace(port=8080, node_port=31234)])
    )
    assert rt.upstream_origin(sbx) == "http://127.0.0.1:31234"


def test_traefik_dynamic_http_provider_endpoint_and_auto_wake_exclusion(
    api_env, monkeypatch
):
    client, _fake_docker, _registry = api_env
    import app.main as main_mod

    admin_headers = {"Authorization": "Bearer test-admin-token"}

    # Create two sandboxes: alice (running) and bob (stopped)
    s1 = client.post(
        "/api/sandboxes",
        headers=admin_headers,
        json={"email": "alice@example.com"},
    )
    assert s1.status_code == 201
    s2 = client.post(
        "/api/sandboxes",
        headers=admin_headers,
        json={"email": "bob@example.com"},
    )
    assert s2.status_code == 201
    bob_id = s2.json()["id"]
    assert client.post(f"/api/sandboxes/{bob_id}/stop", headers=admin_headers).status_code == 200

    # Query /api/internal/traefik/config: only running sandbox 'alice' is present;
    # stopped sandbox 'bob' is omitted so /s/bob/* falls through to Manager auto-wake page!
    res = client.get("/api/internal/traefik/config")
    assert res.status_code == 200
    cfg = res.json()
    routers = cfg["http"]["routers"]
    services = cfg["http"]["services"]
    middlewares = cfg["http"]["middlewares"]

    assert "dsh-sbx-alice" in routers
    assert "dsh-sbx-alice-dsh" in routers
    assert "dsh-auth-alice" in middlewares
    assert services["dsh-sbx-alice"]["loadBalancer"]["servers"] == [
        {"url": "http://dsh-sbx-alice:8080"}
    ]
    assert "dsh-sbx-bob" not in routers
    assert "dsh-sbx-bob" not in services

    # Optional TRAEFIK_PROVIDER_TOKEN authentication
    monkeypatch.setattr(main_mod.settings, "traefik_provider_token", "traefik-secret-123")
    assert client.get("/api/internal/traefik/config").status_code == 401
    assert client.get("/api/internal/traefik/config?token=wrong").status_code == 401
    assert (
        client.get("/api/internal/traefik/config?token=traefik-secret-123").status_code
        == 200
    )
    assert (
        client.get(
            "/api/internal/traefik/config",
            headers={"Authorization": "Bearer traefik-secret-123"},
        ).status_code
        == 200
    )
