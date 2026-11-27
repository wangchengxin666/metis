from __future__ import annotations

import json
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.db import Base, get_db
from app.models import ContainerRegistry, ImageBuildJob, SandboxTemplate
from app.runtime.docker_runtime import DockerSandboxRuntime
from app.runtime.k8s_runtime import KubernetesSandboxRuntime
from app.runtime_secrets import _setup_code_file_path, resolve_runtime_secret_key
from app.services.bootstrap import (
    apply_runtime_settings_to_settings,
    ensure_bootstrap_setup_state,
    get_runtime_settings,
    is_setup_completed,
    sync_runtime_settings_if_stale,
    update_runtime_settings,
)
from app.services.images import (
    build_tar_from_directory,
    parse_image_registry_host,
    render_variant_dockerfile,
    resolve_auth_config_for_image,
)


def test_runtime_secret_auto_generation_multi_worker_idempotent_and_placeholder(tmp_path):
    secrets_path = tmp_path / "data" / ".runtime-secrets.json"

    s_worker1 = Settings(
        _env_file=None,
        secret_key="auto",
        runtime_secrets_file=str(secrets_path),
    )
    resolved_1 = resolve_runtime_secret_key(s_worker1)
    assert len(resolved_1) == 64
    assert secrets_path.is_file()

    # Worker 2 booting independently loads exact same persisted secret
    s_worker2 = Settings(
        _env_file=None,
        secret_key="auto",
        runtime_secrets_file=str(secrets_path),
    )
    resolved_2 = resolve_runtime_secret_key(s_worker2)
    assert resolved_2 == resolved_1

    # Explicit insecure placeholder stays rejected by startup guard
    s_bad = Settings(
        _env_file=None,
        secret_key="change-me-in-production",
        runtime_secrets_file=str(secrets_path),
    )
    assert resolve_runtime_secret_key(s_bad) == "change-me-in-production"


def test_zero_config_setup_wizard_lockout_and_admin_password_login(api_env, monkeypatch, tmp_path):
    client, _fake_docker, _registry = api_env
    import app.main as main_mod
    import app.routers.auth as auth_router
    import app.routers.setup as setup_router
    import app.deps as deps_mod
    from app.db import SessionLocal
    from app.models import PlatformAdmin, PlatformSetting, User
    from app.services.common import ensure_bootstrap_admin

    orig_mode = deps_mod.settings.manager_auth_mode
    orig_token = deps_mod.settings.manager_admin_token
    orig_secrets_file = deps_mod.settings.runtime_secrets_file
    orig_email = deps_mod.settings.manager_admin_email

    try:
        secrets_file = tmp_path / "runtime" / ".runtime-secrets.json"
        for mod_settings in (deps_mod.settings, setup_router.settings, auth_router.settings, main_mod.settings):
            monkeypatch.setattr(mod_settings, "manager_auth_mode", "auto")
            monkeypatch.setattr(mod_settings, "manager_admin_token", "")
            monkeypatch.setattr(mod_settings, "runtime_secrets_file", str(secrets_file))
            monkeypatch.setattr(mod_settings, "allow_setup_wizard", True)

        # Reset setup state & remove existing admin passwords/OIDC so uninitialized branch triggers cleanly
        with SessionLocal() as db:
            for k in ("setup.completed", "setup.code_hash", "setup.onboarding_step"):
                row = db.get(PlatformSetting, k)
                if row is not None:
                    db.delete(row)
            for u in db.query(User).all():
                u.password_hash = None
            db.commit()
            ensure_bootstrap_admin(db, "admin@example.com")
            setup_code = ensure_bootstrap_setup_state(db, deps_mod.settings)
            assert setup_code and setup_code.startswith("DSH-")
            assert _setup_code_file_path(deps_mod.settings).is_file()

        st = client.get("/api/setup/status")
        assert st.status_code == 200
        assert st.json()["setup_completed"] is False
        assert st.json()["needs_setup"] is True

        # Wrong setup code returns 401 and keeps setup locked/incomplete
        bad = client.post(
            "/api/setup/complete",
            json={
                "setup_code": "WRONG-CODE",
                "admin_email": "boss@corp.local",
                "admin_password": "StrongPassword!123",
                "network_preset": "cn-aliyun",
            },
        )
        assert bad.status_code == 401

        # Valid setup code completes initialization, removes file, logs admin session in
        ok = client.post(
            "/api/setup/complete",
            json={
                "setup_code": setup_code,
                "admin_email": "boss@corp.local",
                "admin_password": "StrongPassword!123",
                "admin_display_name": "Chief Ops",
                "brand_name_zh": "星辰智算",
                "brand_name_en": "StarMatrix",
                "network_preset": "cn-aliyun",
                "allow_local_user_login": True,
            },
        )
        assert ok.status_code == 200
        body = ok.json()
        assert body["setup_completed"] is True
        assert body["admin_email"] == "boss@corp.local"
        assert not _setup_code_file_path(deps_mod.settings).exists()

        # Setup wizard endpoint MUST lock immediately with 403 once completed
        hijack = client.post(
            "/api/setup/complete",
            json={
                "setup_code": setup_code,
                "admin_email": "attacker@evil.com",
                "admin_password": "AttackerPassword123",
            },
        )
        assert hijack.status_code == 403

        # Admin session is active immediately after onboarding
        me = client.get("/api/auth/me").json()
        assert me["authenticated"] is True
        assert me["admin"] is True
        assert me["email"] == "boss@corp.local"
        assert me["brand_name_en"] == "StarMatrix"

        # Unified single-entry login resolves admin vs user purely by DB role
        client.post("/api/auth/logout")
        relogin = client.post(
            "/api/auth/login",
            json={
                "email": "boss@corp.local",
                "password": "StrongPassword!123",
            },
        )
        assert relogin.status_code == 200
        assert relogin.json()["admin"] is True

        # Regular employee uses the exact same unified endpoint and receives admin=False
        emp_res = client.post(
            "/api/users",
            json={
                "email": "staff@example.com",
                "display_name": "Staff One",
                "password": "StaffPassword!123",
            },
        )
        assert emp_res.status_code == 201
        client.post("/api/auth/logout")
        emp_login = client.post(
            "/api/auth/login",
            json={
                "email": "staff@example.com",
                "password": "StaffPassword!123",
            },
        )
        assert emp_login.status_code == 200
        assert emp_login.json()["admin"] is False
        client.post(
            "/api/auth/login",
            json={
                "email": "boss@corp.local",
                "password": "StrongPassword!123",
            },
        )

        # Verify secondary worker picks up boss@corp.local as default_admin_email cleanly
        import app.services.bootstrap as boot_mod

        w2 = Settings(_env_file=None, secret_key="w" * 32)
        with SessionLocal() as db:
            boot_mod._RUNTIME_VERSION_CACHE["platform"] = -1
            sync_runtime_settings_if_stale(db, w2)
        assert w2.manager_admin_email == "boss@corp.local"

        # Step 3 Setup Wizard LLM profile creation + test endpoint contract
        llm_res = client.post(
            "/api/llm-profiles",
            json={
                "name": "Wizard LLM",
                "api_protocol": "openai-completions",
                "base_url": "http://127.0.0.1:9/v1",
                "api_key": "",
                "model": "gpt-4o",
                "gateway_enabled": True,
            },
        )
        assert llm_res.status_code == 201
        test_res = client.post(f"/api/llm-profiles/{llm_res.json()['id']}/test")
        assert test_res.status_code == 200
        assert test_res.json()["ok"] is False
    finally:
        monkeypatch.setattr(deps_mod.settings, "manager_auth_mode", orig_mode)
        monkeypatch.setattr(deps_mod.settings, "manager_admin_token", orig_token)
        monkeypatch.setattr(deps_mod.settings, "runtime_secrets_file", orig_secrets_file)
        monkeypatch.setattr(deps_mod.settings, "manager_admin_email", orig_email)


def test_dynamic_runtime_settings_sync_across_workers_and_sandbox_defaults(api_env):
    client, _fake_docker, _registry = api_env
    r = client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "token": "test-admin-token"},
    )
    assert r.status_code == 200

    res = client.patch(
        "/api/system/runtime-settings",
        json={
            "network_preset": "cn-aliyun",
            "apply_preset_mirrors": True,
            "default_cpus": 3.5,
            "default_memory": "6g",
            "default_timezone": "Asia/Shanghai",
            "pull_missing_image": True,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["network_preset"] == "cn-aliyun"
    assert data["pip_index_url"] == "https://mirrors.aliyun.com/pypi/simple/"
    assert data["default_cpus"] == 3.5
    assert data["default_memory"] == "6g"
    assert data["pull_missing_image"] is True

    # Simulate secondary worker synchronizing from PlatformSetting + config version
    from app.db import SessionLocal

    worker2_settings = Settings(_env_file=None, secret_key="w" * 32)
    with SessionLocal() as db:
        import app.services.bootstrap as boot_mod

        boot_mod._RUNTIME_VERSION_CACHE["platform"] = -1
        sync_runtime_settings_if_stale(db, worker2_settings)
    assert worker2_settings.sandbox_cpus == 3.5
    assert worker2_settings.sandbox_memory == "6g"
    assert worker2_settings.sandbox_timezone == "Asia/Shanghai"
    assert worker2_settings.pull_missing_image is True


def test_registry_encryption_k8s_secret_sync_and_docker_pull_auth(tmp_path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    assert parse_image_registry_host("dsh-sandbox:latest") == "docker.io"
    assert parse_image_registry_host("ghcr.io/org/dsh-sandbox:v1") == "ghcr.io"
    assert parse_image_registry_host("127.0.0.1:5000/corp/dsh:test") == "127.0.0.1:5000"

    settings = Settings(
        _env_file=None,
        sandbox_runtime="kubernetes",
        k8s_namespace="dsh-sandboxes",
        k8s_image_pull_secret="regcred",
        secret_key="test-secret-key-for-registry-encryption-32bytes",
    )
    k8s_rt = KubernetesSandboxRuntime(settings)
    core_v1 = MagicMock()
    apps_v1 = MagicMock()
    custom_objects = MagicMock()
    not_found = type("NotFound", (Exception,), {"status": 404})("404")
    core_v1.read_namespace.side_effect = not_found
    core_v1.read_namespaced_secret.side_effect = not_found
    core_v1.read_namespaced_config_map.side_effect = not_found
    core_v1.read_namespaced_persistent_volume_claim.side_effect = not_found
    core_v1.read_namespaced_service.side_effect = not_found
    apps_v1.read_namespaced_stateful_set.side_effect = not_found
    k8s_rt._core_v1 = core_v1
    k8s_rt._apps_v1 = apps_v1
    k8s_rt._custom_objects = custom_objects
    k8s_rt._api_loaded = True

    from app.services.images import create_registry, delete_registry

    with SessionLocal() as db:
        reg = create_registry(
            db,
            k8s_rt,
            name="Local Test Registry",
            registry_host="https://127.0.0.1:5000/",
            username="robot",
            password="super-secret-password",
            tls_verify=False,
            is_default=True,
            actor="admin@example.com",
        )
        assert reg.registry_host == "127.0.0.1:5000"
        assert "super-secret-password" not in reg.password_ciphertext
        assert reg.k8s_secret_name == "dsh-registry-creds"
        core_v1.create_namespaced_secret.assert_called()
        sec_body = core_v1.create_namespaced_secret.call_args.kwargs["body"]
        assert sec_body["type"] == "kubernetes.io/dockerconfigjson"
        assert sec_body["metadata"]["name"] == "dsh-registry-creds"

        auth_cfg = resolve_auth_config_for_image(db, "127.0.0.1:5000/org/dsh-sandbox:v1")
        assert auth_cfg == {"username": "robot", "password": "super-secret-password"}

        from docker import auth as docker_auth

        mem_cfg = docker_auth.AuthConfig({"auths": {"127.0.0.1:5000": auth_cfg}})
        assert mem_cfg.get_all_credentials()["127.0.0.1:5000"] == auth_cfg

        # StatefulSet manifest includes BOTH static k8s_image_pull_secret AND synced dsh-registry-creds
        fake_sbx = SimpleNamespace(
            id="s1",
            slug="dev1",
            volume_name="dsh-dev1-home",
            template="agent-os",
            image_repo="127.0.0.1:5000/org/dsh-sandbox",
            image_tag="v1",
            cpu_limit=2.0,
            memory_limit="4g",
            user=SimpleNamespace(email="dev1@corp.local"),
        )
        sts = k8s_rt._build_statefulset_manifest(fake_sbx)
        assert sts["spec"]["template"]["spec"]["imagePullSecrets"] == [
            {"name": "regcred"},
            {"name": "dsh-registry-creds"},
        ]

        # Docker runtime _ensure_image injects auth_config on ImageNotFound pull
        pull_calls: list[dict] = []
        from docker.errors import ImageNotFound

        class _FakeImages:
            def get(self, _ref):
                raise ImageNotFound("missing")

            def pull(self, repo, tag=None, **kwargs):
                pull_calls.append({"repo": repo, "tag": tag, "kwargs": kwargs})

        drt = DockerSandboxRuntime(
            Settings(_env_file=None, pull_missing_image=True, secret_key="k" * 32),
            auth_resolver=lambda img: resolve_auth_config_for_image(db, img),
        )
        drt._client = SimpleNamespace(images=_FakeImages())
        drt._ensure_image("v1", "127.0.0.1:5000/org/dsh-sandbox")
        assert len(pull_calls) == 1
        assert pull_calls[0]["kwargs"]["auth_config"] == {
            "username": "robot",
            "password": "super-secret-password",
        }

        delete_registry(db, k8s_rt, reg.id, actor="admin@example.com")
        core_v1.delete_namespaced_secret.assert_called_with(
            name="dsh-registry-creds", namespace="dsh-sandboxes"
        )


def test_variant_dockerfile_renderer_and_image_factory_api(api_env, monkeypatch, tmp_path):
    client, fake_docker, _registry = api_env
    r = client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "token": "test-admin-token"},
    )
    assert r.status_code == 200

    # Variant Dockerfile must respect mirrors, PEP 668, and /usr/local global npm path
    df = render_variant_dockerfile(
        base_image="dsh-sandbox:latest",
        apt_packages=["jq"],
        pip_packages=["pandas", "openpyxl"],
        npm_packages=["tsx"],
        mirrors={
            "apt_mirror": "https://mirrors.aliyun.com",
            "pip_index_url": "http://pypi.internal.local/simple/",
            "npm_registry": "https://registry.npmmirror.com",
        },
        include_ca_bundle=True,
    )
    assert "FROM dsh-sandbox:latest" in df
    assert "COPY ca-bundle.crt /tmp/ca-bundle.crt" in df
    assert "https://mirrors.aliyun.com" in df
    assert "--break-system-packages" in df
    assert "--trusted-host pypi.internal.local" in df
    assert "NPM_CONFIG_PREFIX=/usr/local npm install -g" in df

    # Shell injection in package name MUST be rejected with 422
    bad_pkg = client.post(
        "/api/images/build-variant",
        json={
            "image_repo": "dsh-sandbox",
            "image_tag": "bad-variant",
            "base_image": "dsh-sandbox:latest",
            "pip_packages": ["pandas; rm -rf /"],
        },
    )
    assert bad_pkg.status_code == 422

    # Attach mock build/inspect/prune handlers on FakeDockerService cleanly
    built_tags: list[str] = []

    def _fake_build_stream(tar_buf, *, tag, buildargs=None, nocache=False, auth_configs=None, on_log=None):
        built_tags.append(tag)
        if on_log:
            on_log(f"Step 1/2 : FROM dsh-sandbox:latest")
            on_log(f"Successfully built {tag}")

    monkeypatch.setattr(fake_docker, "build_image_stream", _fake_build_stream, raising=False)
    monkeypatch.setattr(
        fake_docker,
        "inspect_image",
        lambda ref: {"id": "abcdef123456", "size_bytes": 524_288_000},
        raising=False,
    )
    monkeypatch.setattr(
        fake_docker,
        "prune_images",
        lambda: {"reclaimed_bytes": 10_485_760, "deleted_images": ["sha256:old123"]},
        raising=False,
    )

    # Build a role variant and auto-bind it to existing 'agent-os' template
    res = client.post(
        "/api/images/build-variant",
        json={
            "image_repo": "dsh-sandbox",
            "image_tag": "data-analyst",
            "base_image": "dsh-sandbox:latest",
            "pip_packages": ["pandas", "openpyxl"],
            "bind_template_key": "agent-os",
        },
    )
    assert res.status_code == 202
    job_id = res.json()["id"]

    final_job = None
    for _ in range(40):
        jr = client.get(f"/api/images/jobs/{job_id}")
        assert jr.status_code == 200
        final_job = jr.json()
        if final_job["status"] in {"succeeded", "failed"}:
            break
        time.sleep(0.05)

    assert final_job is not None
    assert final_job["status"] == "succeeded", final_job
    assert "dsh-sandbox:data-analyst" in built_tags
    assert final_job["size_bytes"] == 524_288_000

    # Template image_tag automatically updated cleanly!
    tpls = client.get("/api/templates").json()
    agent_os = next(x for x in tpls if x["key"] == "agent-os")
    assert agent_os["image_tag"] == "data-analyst"

    # Prune endpoint works
    pruned = client.post("/api/images/prune")
    assert pruned.status_code == 200
    assert pruned.json()["reclaimed_bytes"] == 10_485_760

    # Verify build_tar_from_directory respects .dockerignore exclusions cleanly
    src_dir = tmp_path / "sandbox_src"
    src_dir.mkdir()
    (src_dir / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
    (src_dir / ".dockerignore").write_text(".env\ndocs/\n*.log\n", encoding="utf-8")
    (src_dir / ".env").write_text("SECRET=1\n", encoding="utf-8")
    (src_dir / "debug.log").write_text("noise\n", encoding="utf-8")
    (src_dir / "docs").mkdir()
    (src_dir / "docs" / "note.md").write_text("doc\n", encoding="utf-8")
    tar_buf = build_tar_from_directory(src_dir)
    import tarfile

    with tarfile.open(fileobj=tar_buf, mode="r") as tf:
        names = set(tf.getnames())
    assert "Dockerfile" in names
    assert ".env" not in names
    assert "debug.log" not in names
    assert "docs/note.md" not in names
