from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from docker.errors import ImageNotFound, NotFound

from app.config import Settings
from app.docker_service import DockerService, SandboxRuntimeError
from app.models import LlmProfile, Sandbox, User
from app.security import encrypt_secret


def _make_sandbox(slug: str = "alice", **kwargs) -> Sandbox:
    user = User(email=f"{slug}@example.com", display_name=slug.title())
    sbx = Sandbox(
        user=user,
        user_id="user-1",
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


def test_environment_generation_and_plugin_resolution(tmp_path):
    ca_file = tmp_path / "corp-ca.crt"
    ca_file.write_text("-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n", encoding="utf-8")

    settings = Settings(
        _env_file=None,
        manager_public_url="https://sandbox.corp.example",
        manager_internal_url="http://dsh-manager:9000",
        sandbox_auto_install_plugins="file-manager",
        custom_ca_bundle_path=str(ca_file),
    )
    svc = DockerService(settings)

    profile = LlmProfile(
        name="DeepSeek",
        base_url="https://api.deepseek.com/v1",
        model="deepseek-chat",
        api_protocol="openai-completions",
        context_window=256000,
        max_tokens=32000,
        supports_image=True,
        reasoning_effort="high",
        thinking_format="deepseek",
        api_key_ciphertext=encrypt_secret("sk-secret-key"),
    )
    sbx = _make_sandbox(
        extra_env_json='{"CUSTOM_FOO": "bar"}',
        auto_install_plugins="extra-plugin, https://custom.example.com/p.tgz",
        init_repo_url="https://git.example.com/starter.git",
        init_script="#!/usr/bin/env bash\necho ready",
        llm_profile=profile,
    )

    env = svc.environment(sbx)
    assert env["SANDBOX_BASE_PATH"] == "/s/alice"
    assert env["SANDBOX_PUBLIC_ORIGIN"] == "https://sandbox.corp.example"
    assert env["SANDBOX_PUBLIC_URL"] == "https://sandbox.corp.example/s/alice/"
    assert env["DSH_MOUNT"] == "/s/alice/dsh"
    assert env["DSH_PUBLIC_URL"] == "https://sandbox.corp.example/s/alice/dsh/"
    assert env["DSH_TOKEN_COOKIE_NAME"] == "dsh_token_seen_alice"
    assert env["DSH_PLUGIN_INDEX_URL"] == "http://dsh-manager:9000/plugins/index.json"
    assert env["DSH_PLUGIN_NPM_REGISTRY"] == "http://dsh-manager:9000/plugins/npm"
    assert env["DSH_DEFAULT_LLM_PROVIDER"] == "openai-compatible"
    assert env["DSH_DEFAULT_LLM_API"] == "openai-completions"
    assert env["DSH_DEFAULT_LLM_BASE_URL"] == "https://api.deepseek.com/v1"
    assert env["DSH_DEFAULT_LLM_MODEL"] == "deepseek-chat"
    assert env["DSH_DEFAULT_LLM_CONTEXT_WINDOW"] == "256000"
    assert env["DSH_DEFAULT_LLM_MAX_TOKENS"] == "32000"
    assert env["DSH_DEFAULT_LLM_SUPPORTS_IMAGE"] == "true"
    assert env["DSH_DEFAULT_LLM_REASONING_EFFORT"] == "high"
    assert env["DSH_DEFAULT_LLM_THINKING_FORMAT"] == "deepseek"
    assert env["DSH_DEFAULT_LLM_API_KEY"] == "sk-secret-key"
    assert env["CUSTOM_FOO"] == "bar"
    assert env["SANDBOX_INIT_REPO_URL"] == "https://git.example.com/starter.git"
    assert env["SANDBOX_INIT_SCRIPT"] == "#!/usr/bin/env bash\necho ready"

    # Relative plugin slugs: known built-in packages resolve to npm package names,
    # while unknown slugs fall back to the packages tarball endpoint.
    assert (
        env["DSH_AUTO_INSTALL_PLUGINS"]
        == "http://dsh-manager:9000/plugins/packages/extra-plugin.tgz,https://custom.example.com/p.tgz"
    )
    builtin_svc = DockerService(
        Settings(
            _env_file=None,
            manager_internal_url="http://dsh-manager:9000",
            plugins_dir=str(Path(__file__).resolve().parents[2] / "plugins"),
        )
    )
    builtin_sbx = _make_sandbox(auto_install_plugins="file-manager,workspace-user,custom-theme")
    assert builtin_svc.environment(builtin_sbx)["DSH_AUTO_INSTALL_PLUGINS"] == (
        "@local/dsh-plugin-file-manager,@dsh-dock/workspace-user,@dsh-dock/custom-theme"
    )

    blank_script_sbx = _make_sandbox(init_script="   \n  ")
    assert "SANDBOX_INIT_SCRIPT" not in svc.environment(blank_script_sbx)


def test_create_container_uses_no_host_ports_and_traefik_forwardauth(tmp_path):
    ca_file = tmp_path / "ca.crt"
    ca_file.write_text("cert", encoding="utf-8")

    settings = Settings(
        _env_file=None,
        manager_public_url="http://localhost:9000",
        manager_internal_url="http://dsh-manager:9000",
        dsh_network="dsh-manager",
        pull_missing_image=False,
        custom_ca_bundle_path=str(ca_file),
    )
    svc = DockerService(settings)

    mock_client = MagicMock()
    mock_client.networks.get.side_effect = NotFound("missing network")
    mock_container = MagicMock()
    mock_container.id = "container-id-alice"
    mock_client.containers.run.return_value = mock_container
    svc._client = mock_client

    sbx = _make_sandbox()
    container = svc.create(sbx)
    assert container.id == "container-id-alice"

    mock_client.networks.create.assert_called_once_with("dsh-manager", driver="bridge")
    _, kwargs = mock_client.containers.run.call_args
    assert "ports" not in kwargs
    assert kwargs["network"] == "dsh-manager"
    assert kwargs["security_opt"] == ["no-new-privileges:true"]
    assert kwargs["mem_limit"] == "4g"
    assert kwargs["cpu_period"] == 100_000
    assert kwargs["cpu_quota"] == 200_000

    # Persistent volume mounts at /home/workspace + optional CA read-only mount
    volumes = kwargs["volumes"]
    assert volumes["dsh-alice-home"] == {"bind": "/home/workspace", "mode": "rw"}
    assert volumes[str(ca_file.resolve())] == {"bind": "/etc/dsh/ca/custom-ca.crt", "mode": "ro"}

    labels = kwargs["labels"]
    assert labels["traefik.enable"] == "true"
    assert labels["traefik.http.routers.dsh-sbx-alice.rule"] == "PathPrefix(`/s/alice`)"
    assert labels["traefik.http.routers.dsh-sbx-alice.priority"] == "100"
    assert labels["traefik.http.routers.dsh-sbx-alice-dsh.priority"] == "120"
    assert labels["traefik.http.routers.dsh-sbx-alice-dsh.middlewares"] == "dsh-auth-alice@docker"
    assert (
        labels["traefik.http.middlewares.dsh-auth-alice.forwardauth.address"]
        == "http://dsh-manager:9000/api/auth/verify-sandbox/alice"
    )
    assert labels["traefik.http.middlewares.dsh-auth-alice.forwardauth.authResponseHeaders"] == (
        "X-Auth-Request-Email,X-Forwarded-User,X-Sandbox-Owner,"
        "X-Auth-Request-Name,X-Auth-Request-Admin,X-Sandbox-Owner-Name"
    )
    assert labels["traefik.http.services.dsh-sbx-alice.loadbalancer.server.port"] == "8080"


def test_ensure_image_missing_raises_or_pulls():
    svc = DockerService(Settings(_env_file=None, pull_missing_image=False))
    mock_client = MagicMock()
    mock_client.images.get.side_effect = ImageNotFound("no image")
    svc._client = mock_client

    with pytest.raises(SandboxRuntimeError, match="PULL_MISSING_IMAGE=true"):
        svc._ensure_image("latest", "dsh-sandbox")

    svc_pull = DockerService(Settings(_env_file=None, pull_missing_image=True))
    svc_pull._client = mock_client
    svc_pull._ensure_image("latest", "dsh-sandbox")
    mock_client.images.pull.assert_called_once_with("dsh-sandbox", tag="latest")


def test_wait_healthy_stats_logs_backup_and_sync(monkeypatch):
    status_code_holder = {"code": 200}

    class _FakeHttpClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url):
            return type("_Resp", (), {"status_code": status_code_holder["code"]})()

    monkeypatch.setattr("app.docker_service.httpx.Client", _FakeHttpClient)
    monkeypatch.setattr("app.docker_service.time.sleep", lambda _s: None)

    svc = DockerService(
        Settings(_env_file=None, health_timeout_seconds=10, manager_internal_url="http://dsh-manager:9000")
    )
    mock_client = MagicMock()
    svc._client = mock_client

    container = MagicMock()
    container.status = "running"
    container.attrs = {"State": {"Health": {"Status": "healthy"}}}
    container.logs.return_value = b"\x1b[32mok\x1b[0m\ndsh web: http://127.0.0.1:3080/?token=abc123\n"
    container.stats.return_value = {
        "cpu_stats": {"cpu_usage": {"total_usage": 200}, "system_cpu_usage": 1000, "online_cpus": 2},
        "precpu_stats": {"cpu_usage": {"total_usage": 100}, "system_cpu_usage": 500},
        "memory_stats": {"usage": 256 * 1024 * 1024, "limit": 1024 * 1024 * 1024, "stats": {"file": 0}},
    }
    container.get_archive.return_value = (iter([b"tarbytes"]), {"size": 8})
    container.exec_run.return_value = (0, b"synced\n")
    mock_client.containers.get.return_value = container

    sbx = _make_sandbox()
    # Wait until Docker container Health leaves "starting" so Traefik can route immediately
    health_seq = iter(["starting", "healthy"])

    def _reload_health():
        container.attrs = {"State": {"Health": {"Status": next(health_seq, "healthy")}}}

    container.reload.side_effect = _reload_health
    svc.wait_healthy(sbx)
    assert container.reload.call_count == 2
    container.reload.side_effect = None
    container.attrs = {"State": {"Health": {"Status": "healthy"}}}

    assert "ok" in svc.logs(sbx)
    assert "\x1b[" not in svc.logs(sbx)
    assert svc.launch_token_url(sbx) == "http://127.0.0.1:3080/?token=abc123"

    stats = svc.stats(sbx)
    assert stats["cpu_percent"] == 40.0
    assert stats["memory_usage_mb"] == 256.0
    assert stats["memory_limit_mb"] == 1024.0

    stream = svc.export_workspace_tar(sbx)
    container.get_archive.assert_called_with("/home/workspace")
    assert b"".join(stream) == b"tarbytes"

    sync = svc.sync_plugin_market(sbx, reinstall_plugins=["http://dsh-manager:9000/plugins/packages/file-manager.tgz"])
    assert sync["ok"] is True
    assert sync["slug"] == "alice"

    # Unhealthy timeout raises SandboxRuntimeError
    status_code_holder["code"] = 503
    svc.settings.health_timeout_seconds = 0
    with pytest.raises(SandboxRuntimeError, match="did not become healthy"):
        svc.wait_healthy(sbx)


def test_disk_usage_active_work_lite_backup_and_restore(tmp_path):
    import io
    import tarfile

    svc = DockerService(Settings(_env_file=None, manager_internal_url="http://dsh-manager:9000"))
    mock_client = MagicMock()
    svc._client = mock_client

    container = MagicMock()
    container.status = "running"

    def fake_exec_run(cmd, **_kwargs):
        joined = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
        if "df -Pk" in joined:
            return (
                0,
                b"/dev/sda1 20971520 5242880 15728640 25% /home/workspace\n"
                b"---DU---\n"
                b"131072 /home/workspace\n",
            )
        if "ACTIVE:" in joined:
            return (0, b"ACTIVE:user-services\n")
        if cmd[0] == "tar":
            return (0, iter([(b"lite-tar-", None), (b"bytes", b"stderr-ignored")]))
        return (0, b"")

    container.exec_run.side_effect = fake_exec_run
    container.put_archive.return_value = True
    container.attrs = {"State": {"Health": {"Status": "healthy"}}}
    mock_client.containers.get.return_value = container

    sbx = _make_sandbox()

    disk = svc.workspace_disk_usage(sbx)
    assert disk["disk_usage_mb"] == 128.0
    assert disk["disk_fs_avail_mb"] == 15360.0
    assert disk["disk_fs_used_percent"] == 25.0

    busy, reason = svc.has_active_work(sbx)
    assert busy is True and reason == "user-services"

    lite = b"".join(svc.export_workspace_tar(sbx, exclude_caches=True))
    assert lite == b"lite-tar-bytes"

    # Build valid .tar.gz with workspace/ prefix
    good_buf = io.BytesIO()
    with tarfile.open(fileobj=good_buf, mode="w:gz") as tf:
        data = b"hello world"
        info = tarfile.TarInfo("workspace/projects/app.txt")
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))
    good_buf.seek(0)

    svc.wait_healthy = MagicMock()
    res = svc.restore_workspace_tar(sbx, good_buf, mode="merge")
    assert res["restored_entries"] == 1
    assert res["restarted_dsh"] is True
    assert container.put_archive.called
    put_path, put_bytes = container.put_archive.call_args[0]
    assert put_path == "/home/workspace"
    with tarfile.open(fileobj=io.BytesIO(put_bytes), mode="r:*") as check_tf:
        names = check_tf.getnames()
        assert names == ["projects/app.txt"]
        assert check_tf.getmember("projects/app.txt").uid == 1000

    # Unsafe archive traversal rejected
    bad_buf = io.BytesIO()
    with tarfile.open(fileobj=bad_buf, mode="w") as tf:
        info = tarfile.TarInfo("workspace/../../etc/evil")
        info.size = 1
        tf.addfile(info, io.BytesIO(b"x"))
    bad_buf.seek(0)
    with pytest.raises(SandboxRuntimeError, match="unsafe archive path traversal"):
        svc.restore_workspace_tar(sbx, bad_buf)

    # Escaping symlink rejected
    sym_buf = io.BytesIO()
    with tarfile.open(fileobj=sym_buf, mode="w") as tf:
        info = tarfile.TarInfo("workspace/badlink")
        info.type = tarfile.SYMTYPE
        info.linkname = "../../etc/passwd"
        tf.addfile(info)
    sym_buf.seek(0)
    with pytest.raises(SandboxRuntimeError, match="escapes workspace root"):
        svc.restore_workspace_tar(sbx, sym_buf)


def test_sync_llm_profile_exec_payload_and_stopped_skip():
    import json
    from app.docker_service import llm_provider_identifiers

    settings = Settings(_env_file=None)
    svc = DockerService(settings)
    profile = LlmProfile(
        id="abcdef12-3456-7890-abcd-ef1234567890",
        name="Local Qwen",
        base_url="http://192.168.1.3:47832/v1",
        model="iq3_xxs",
        api_protocol="openai-completions",
        context_window=256000,
        max_tokens=32000,
        supports_image=True,
        reasoning_effort="medium",
        thinking_format="qwen",
        api_key_ciphertext="",
    )
    sbx = _make_sandbox(slug="lead")

    # 1. Stopped container is cleanly skipped
    stopped_container = MagicMock()
    stopped_container.status = "exited"
    svc.get = MagicMock(return_value=stopped_container)
    skipped = svc.sync_llm_profile(sbx, profile)
    assert skipped["ok"] is False
    assert skipped["skipped"] is True
    assert "exited" in skipped["detail"]

    # 2. Running container executes node config sync (passing secret via env) and restarts dsh
    running_container = MagicMock()
    running_container.status = "running"
    running_container.exec_run.side_effect = [
        (0, b"LLM_SYNC_OK:mgr-abcdef123456:iq3_xxs\n"),
        (0, b"dsh: stopped\ndsh: started\n"),
    ]
    svc.get = MagicMock(return_value=running_container)
    res = svc.sync_llm_profile(sbx, profile, set_as_default=True, replace_managed=True)
    assert res["ok"] is True
    assert res["skipped"] is False
    prov_key, cred_ref = llm_provider_identifiers(profile)
    assert res["provider"] == prov_key
    assert running_container.exec_run.call_count == 2

    first_call = running_container.exec_run.call_args_list[0]
    assert first_call.kwargs["user"] == "workspace"
    payload = json.loads(first_call.kwargs["environment"]["LLM_PUSH_PAYLOAD"])
    assert payload["providerKey"] == prov_key
    assert payload["credRef"] == cred_ref
    assert payload["apiKey"] == "local-no-key"
    assert payload["contextWindow"] == 256000
    assert payload["maxTokens"] == 32000
    assert payload["supportsImage"] is True
    assert payload["reasoningEffort"] == "medium"
    assert payload["thinkingFormat"] == "qwen"
    assert payload["setAsDefault"] is True
    assert payload["replaceManaged"] is True

    second_call = running_container.exec_run.call_args_list[1]
    assert second_call.args[0] == ["supervisorctl", "restart", "dsh"]
    assert second_call.kwargs["user"] == "root"

    # 3. Non-completions protocols (e.g. anthropic-messages / openai-responses) must NOT emit thinkingFormat
    anthropic_profile = LlmProfile(
        id="11223344-5566-7788-99aa-bbccddeeff00",
        name="Claude",
        base_url="https://api.anthropic.com",
        model="claude-sonnet-4-5",
        api_protocol="anthropic-messages",
        context_window=1000000,
        max_tokens=64000,
        supports_image=True,
        reasoning_effort="high",
        thinking_format="qwen",  # stale value must be stripped for non-completions protocols
        api_key_ciphertext=encrypt_secret("sk-ant-test"),
    )
    running_container.exec_run.reset_mock()
    running_container.exec_run.side_effect = [
        (0, b"LLM_SYNC_OK:mgr-112233445566:claude-sonnet-4-5\n"),
        (0, b"dsh: stopped\ndsh: started\n"),
    ]
    res_ant = svc.sync_llm_profile(sbx, anthropic_profile)
    assert res_ant["ok"] is True
    ant_payload = json.loads(running_container.exec_run.call_args_list[0].kwargs["environment"]["LLM_PUSH_PAYLOAD"])
    assert ant_payload["apiProtocol"] == "anthropic-messages"
    assert ant_payload["thinkingFormat"] == ""
    assert ant_payload["contextWindow"] == 1000000
    assert ant_payload["maxTokens"] == 64000
    sbx_ant = _make_sandbox(slug="claude-box", llm_profile=anthropic_profile)
    assert "DSH_DEFAULT_LLM_THINKING_FORMAT" not in svc.environment(sbx_ant)


def test_sync_role_profile_assemble_team_inspect_workforce_and_control_service(monkeypatch):
    import json

    svc = DockerService(Settings())
    mock_client = MagicMock()
    svc._client = mock_client

    sbx1 = _make_sandbox(slug="lead", status="running")
    sbx1.role_title = "Tech Lead"
    sbx1.role_description = "Architecture & Code Review"
    sbx1.role_sop = "Lead the squad"

    sbx2 = _make_sandbox(slug="fullstack", status="running")
    sbx2.role_title = "Full-Stack Engineer"
    sbx2.role_description = "Frontend & API"
    sbx2.role_sop = "Run tests and expose preview"

    container1 = MagicMock(status="running", id="c1")
    container2 = MagicMock(status="running", id="c2")

    def get_container(name):
        if name.endswith("lead"):
            return container1
        if name.endswith("fullstack"):
            return container2
        raise NotFound("missing")

    mock_client.containers.get.side_effect = get_container

    # 1) sync_role_profile
    container1.exec_run.return_value = (0, b"ROLE_SYNC_OK:lead\n")
    res_role = svc.sync_role_profile(sbx1)
    assert res_role["ok"] is True

    # 2) assemble_mesh_team
    container1.exec_run.return_value = (0, b"TEAM_ASSEMBLE_OK:grp_123\n")
    container2.exec_run.return_value = (0, b"TEAM_ASSEMBLE_OK:grp_123\n")
    team_res = svc.assemble_mesh_team(
        [sbx1, sbx2],
        team_name="Core Squad",
        moderator_slug="lead",
    )
    assert team_res["ok"] is True
    assert team_res["paired_members"] == 2
    assert team_res["moderator_slug"] == "lead"

    # 3) inspect_workforce_runtime
    container1.exec_run.return_value = (
        0,
        json.dumps(
            {
                "exposed_apps": [
                    {"name": "web", "target": "127.0.0.1:3000", "mount_path": "/s/lead/apps/web/", "url": "http://localhost:9000/s/lead/apps/web/"}
                ],
                "user_services": [
                    {
                        "name": "dev-server",
                        "status": "RUNNING",
                        "command": "yarn dev",
                        "directory": "/home/workspace",
                    }
                ],
                "cron_jobs": [
                    {"schedule": "0 2 * * *", "command": "pytest", "raw": "0 2 * * * pytest"}
                ],
                "mesh_summary": {
                    "role": "Tech Lead",
                    "description": "Architecture",
                    "has_sop": True,
                    "peers": [{"slug": "fullstack", "role": "Full-Stack Engineer"}],
                    "groups": [{"id": "team-1", "name": "Core Squad", "member_count": 2, "moderator_slug": "lead"}],
                    "active_tasks_count": 2,
                    "done_tasks_count": 3,
                    "pending_approvals": [{"id": "t1", "title": "Approve release"}],
                },
            }
        ).encode("utf-8"),
    )
    wf = svc.inspect_workforce_runtime(sbx1)
    assert wf["online"] is True
    assert wf["exposed_apps"][0]["target"] == "127.0.0.1:3000"
    assert wf["user_services"][0]["status"] == "RUNNING"
    assert wf["cron_jobs"][0]["command"] == "pytest"
    assert len(wf["mesh_summary"]["pending_approvals"]) == 1

    # 4) control_user_service
    container1.exec_run.return_value = (0, b"dev-server: stopped\ndev-server: started\n")
    ctl = svc.control_user_service(sbx1, "dev-server", "restart")
    assert ctl["ok"] is True
    assert ctl["action"] == "restart"


def test_phase3_runtime_operations_and_traefik_preview_auth():
    import json
    from app.runtime.base import build_traefik_dynamic_config

    settings = Settings()
    svc = DockerService(settings)
    mock_client = MagicMock()
    svc._client = mock_client

    sbx = _make_sandbox(slug="lead", status="running")
    sbx.preview_auth_mode = "authenticated"
    container = MagicMock(status="running", id="c1")
    mock_client.containers.get.return_value = container

    # 1) build_traefik_dynamic_config respects preview_auth_mode='authenticated' while keeping mesh /p/4090 open
    cfg = build_traefik_dynamic_config(settings, [(sbx, "http://dsh-sbx-lead:8080")])
    routers = cfg["http"]["routers"]
    assert "dsh-sbx-lead-mesh" in routers
    assert "/s/lead/p/4090" in routers["dsh-sbx-lead-mesh"]["rule"]
    assert "middlewares" not in routers["dsh-sbx-lead-mesh"]
    assert "dsh-auth-lead" in routers["dsh-sbx-lead"]["middlewares"]

    sbx.preview_auth_mode = "public"
    cfg_pub = build_traefik_dynamic_config(settings, [(sbx, "http://dsh-sbx-lead:8080")])
    assert "dsh-sbx-lead-mesh" not in cfg_pub["http"]["routers"]
    assert "middlewares" not in cfg_pub["http"]["routers"]["dsh-sbx-lead"]

    # 2) dispatch_mesh_task & decide_mesh_approval
    container.exec_run.return_value = (
        0,
        json.dumps({"ok": True, "room_id": "portal-inbox", "task": {"id": "t-1", "title": "Fix bug"}}).encode("utf-8"),
    )
    t_res = svc.dispatch_mesh_task(sbx, title="Fix bug", priority="high", approval_required=True)
    assert t_res["ok"] is True
    t_payload = json.loads(container.exec_run.call_args.kwargs["environment"]["TASK_DISPATCH_PAYLOAD"])
    assert t_payload["title"] == "Fix bug"
    assert t_payload["approvalRequired"] is True

    container.exec_run.return_value = (
        0,
        json.dumps({"ok": True, "task_id": "t-1", "decision": "approved"}).encode("utf-8"),
    )
    a_res = svc.decide_mesh_approval(sbx, "t-1", decision="approved", note="ok")
    assert a_res["ok"] is True and a_res["decision"] == "approved"

    # 3) sync_credential_profile passes secrets via env (never argv)
    container.exec_run.return_value = (0, b"CRED_SYNC_OK\n")
    c_res = svc.sync_credential_profile(
        sbx,
        git_user_name="Bot",
        git_user_email="bot@corp.com",
        git_host="github.com",
        git_token="ghp_abc123",
        ssh_private_key="SSH_PRIVATE_KEY_BODY",
        env_vars={"FOO": "bar"},
        mcp_servers={"github": {"command": "npx", "args": ["-y", "mcp-github"]}},
    )
    assert c_res["ok"] is True
    c_payload = json.loads(container.exec_run.call_args.kwargs["environment"]["CRED_SYNC_PAYLOAD"])
    assert c_payload["gitToken"] == "ghp_abc123"
    assert c_payload["sshPrivateKey"] == "SSH_PRIVATE_KEY_BODY"
    assert c_payload["envVars"] == {"FOO": "bar"}
    assert "github" in c_payload["mcpServers"]

    # 4) expose/unexpose app, add/remove/logs service, add/remove cron, sync shared project doc
    container.exec_run.return_value = (0, b"Exposed web on 5173\n")
    assert svc.expose_user_app(sbx, name="web", port=5173)["ok"] is True
    container.exec_run.return_value = (0, b"Removed web\n")
    assert svc.unexpose_user_app(sbx, "web")["ok"] is True

    container.exec_run.return_value = (0, b"Added svc api\n")
    assert svc.add_user_service(sbx, name="api", command="yarn dev")["ok"] is True
    container.exec_run.return_value = (0, b"server started on 8000\n")
    assert "server started" in svc.user_service_logs(sbx, "api", tail=50)
    container.exec_run.return_value = (0, b"Removed svc api\n")
    assert svc.remove_user_service(sbx, "api")["ok"] is True

    container.exec_run.return_value = (0, b"Added cron\n")
    assert svc.add_cron_job(sbx, schedule="0 9 * * *", command="~/daily.sh")["ok"] is True
    container.exec_run.return_value = (0, b"CRON_REMOVED\n")
    assert svc.remove_cron_job(sbx, "0 9 * * * ~/daily.sh")["ok"] is True

    container.exec_run.return_value = (0, b"SHARED_SYNC_OK:/home/workspace/shared/PRD.md\n")
    sh_res = svc.sync_shared_project_file([sbx], team_name="Core", file_name="PRD.md", content="# PRD")
    assert sh_res["ok"] is True and sh_res["synced"] == 1


