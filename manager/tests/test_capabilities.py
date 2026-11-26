"""Tests for Unified Capability Center: Credential Presets, MCP Center, Skill Center, and Targeted Employee Push."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

from sqlalchemy import create_engine, inspect

from app.config import Settings
from app.db import migrate_schema
from app.docker_service import DockerService
from app.models import Sandbox, User
from app.services.capabilities import (
    BUILTIN_MCP_SERVERS,
    BUILTIN_SKILLS,
    mcp_server_to_runtime_entry,
    parse_skill_markdown,
    render_skill_markdown,
)


ADMIN_HEADERS = {"Authorization": "Bearer test-admin-token"}


def test_credential_presets_seed_redaction_and_targeted_push(api_env):
    client, fake_docker, _ = api_env

    # 1. List built-in credential presets
    presets_res = client.get("/api/credential-profiles/presets", headers=ADMIN_HEADERS)
    assert presets_res.status_code == 200
    presets = presets_res.json()["items"]
    assert len(presets) >= 6
    assert any(p["preset_key"] == "github-dev" for p in presets)

    # 2. Seed all presets -> creates profiles with empty secrets
    seed_res = client.post("/api/credential-profiles/seed-presets", headers=ADMIN_HEADERS)
    assert seed_res.status_code == 200
    seeded = seed_res.json()
    assert len(seeded) >= 6

    gh = next(p for p in seeded if p.get("preset_key") == "github-dev")
    assert gh["has_git_token"] is False

    # 3. Configure secret env vars + token on preset, verify no secret leakage in API output
    patch_res = client.patch(
        f"/api/credential-profiles/{gh['id']}",
        headers=ADMIN_HEADERS,
        json={
            "git_token": "ghp_super_secret_xyz",
            "env_vars_json": json.dumps({"GITHUB_TOKEN": "ghp_super_secret_xyz", "NPM_TOKEN": "npm_abc"}),
        },
    )
    assert patch_res.status_code == 200
    body = patch_res.json()
    assert body["has_git_token"] is True
    assert body["has_env_vars"] is True
    assert body["env_var_keys"] == ["GITHUB_TOKEN", "NPM_TOKEN"]
    assert "ghp_super_secret_xyz" not in json.dumps(body)
    assert "npm_abc" not in json.dumps(body)

    # 4. Provision 2 sandboxes and push ONLY to alice
    alice = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "alice@corp.com", "slug": "alice-dev"},
    ).json()
    bob = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "bob@corp.com", "slug": "bob-ops"},
    ).json()

    fake_docker.calls.clear()
    push_res = client.post(
        f"/api/credential-profiles/{gh['id']}/push",
        headers=ADMIN_HEADERS,
        json={"sandbox_ids": [alice["id"]]},
    )
    assert push_res.status_code == 200
    assert push_res.json()["synced"] == 1
    assert push_res.json()["total"] == 1
    pushed_slugs = [c[1][0] for c in fake_docker.calls if c[0] == "sync_credential_profile"]
    assert pushed_slugs == ["alice-dev"]
    assert bob["slug"] not in pushed_slugs


def test_mcp_center_builtins_crud_import_and_targeted_push(api_env):
    client, fake_docker, _ = api_env

    # 1. Built-in MCP servers are auto-seeded on startup
    list_res = client.get("/api/mcp-servers", headers=ADMIN_HEADERS)
    assert list_res.status_code == 200
    items = list_res.json()
    slugs = {m["slug"] for m in items}
    for expected in BUILTIN_MCP_SERVERS:
        assert expected["slug"] in slugs

    # 2. Validation rejects cross-transport / incomplete definitions
    bad_stdio = client.post(
        "/api/mcp-servers",
        headers=ADMIN_HEADERS,
        json={"slug": "bad-stdio", "name": "Bad", "transport": "stdio", "command": ""},
    )
    assert bad_stdio.status_code in (400, 422)

    bad_http = client.post(
        "/api/mcp-servers",
        headers=ADMIN_HEADERS,
        json={"slug": "bad-http", "name": "Bad HTTP", "transport": "streamable-http", "url": "ftp://invalid"},
    )
    assert bad_http.status_code in (400, 422)

    # 3. Create custom stdio & import JSON mcpServers
    custom_res = client.post(
        "/api/mcp-servers",
        headers=ADMIN_HEADERS,
        json={
            "slug": "internal-erp",
            "name": "Internal ERP MCP",
            "category": "data",
            "transport": "streamable-http",
            "url": "https://erp.corp.example/mcp",
            "headers": {"Authorization": "Bearer ${credential:ERP_API_KEY}"},
            "tool_loading": "on-demand",
        },
    )
    assert custom_res.status_code == 201, custom_res.text
    erp = custom_res.json()
    assert erp["required_credentials"] == ["ERP_API_KEY"]

    imp_res = client.post(
        "/api/mcp-servers/import",
        headers=ADMIN_HEADERS,
        json={
            "content": json.dumps(
                {
                    "mcpServers": {
                        "sentry-mcp": {
                            "command": "npx",
                            "args": ["-y", "@sentry/mcp-server"],
                            "env": {"SENTRY_TOKEN": "${credential:SENTRY_TOKEN}"},
                        }
                    }
                }
            )
        },
    )
    assert imp_res.status_code == 201, imp_res.text
    assert imp_res.json()[0]["slug"] == "sentry-mcp"
    assert imp_res.json()[0]["required_credentials"] == ["SENTRY_TOKEN"]

    # 4. Provision 2 employees & selectively batch-push MCP servers ONLY to dev-1
    dev1 = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "dev1@corp.com", "slug": "mcp-dev-1"},
    ).json()
    dev2 = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "dev2@corp.com", "slug": "mcp-dev-2"},
    ).json()

    fetch_mcp = next(m for m in items if m["slug"] == "fetch")
    fake_docker.calls.clear()
    batch_res = client.post(
        "/api/mcp-servers/batch-push",
        headers=ADMIN_HEADERS,
        json={
            "item_ids": [fetch_mcp["id"], erp["id"]],
            "sandbox_ids": [dev1["id"]],
            "action": "push",
        },
    )
    assert batch_res.status_code == 200, batch_res.text
    assert batch_res.json()["synced"] == 1
    mcp_calls = [c for c in fake_docker.calls if c[0] == "sync_mcp_servers"]
    assert len(mcp_calls) == 1
    assert mcp_calls[0][1][0] == "mcp-dev-1"
    assert sorted(mcp_calls[0][1][1]) == ["fetch", "internal-erp"]

    # Verify pushed_sandbox_ids & sandbox.mcp_server_ids persisted
    refreshed_dev1 = client.get(f"/api/sandboxes/{dev1['id']}", headers=ADMIN_HEADERS).json()
    refreshed_dev2 = client.get(f"/api/sandboxes/{dev2['id']}", headers=ADMIN_HEADERS).json()
    assert set(refreshed_dev1["mcp_server_ids"]) == {fetch_mcp["id"], erp["id"]}
    assert refreshed_dev2["mcp_server_ids"] == []

    # 5. Remove single MCP server from dev-1
    fake_docker.calls.clear()
    rem_res = client.post(
        f"/api/mcp-servers/{erp['id']}/push",
        headers=ADMIN_HEADERS,
        json={"sandbox_ids": [dev1["id"]], "action": "remove"},
    )
    assert rem_res.status_code == 200
    assert rem_res.json()["synced"] == 1
    rem_call = [c for c in fake_docker.calls if c[0] == "sync_mcp_servers"][0]
    assert rem_call[1][2] == ["internal-erp"]
    refreshed_dev1_after = client.get(f"/api/sandboxes/{dev1['id']}", headers=ADMIN_HEADERS).json()
    assert refreshed_dev1_after["mcp_server_ids"] == [fetch_mcp["id"]]

    # 6. Recreate sandbox automatically re-syncs bound MCP servers
    fake_docker.calls.clear()
    rec_res = client.post(f"/api/sandboxes/{dev1['id']}/recreate", headers=ADMIN_HEADERS)
    assert rec_res.status_code == 200
    assert any(c[0] == "sync_mcp_servers" and c[1][0] == "mcp-dev-1" for c in fake_docker.calls)


def test_skills_center_builtins_import_template_binding_and_targeted_push(api_env):
    client, fake_docker, _ = api_env

    # 1. Built-in skills seeded
    res = client.get("/api/skills", headers=ADMIN_HEADERS)
    assert res.status_code == 200
    items = res.json()
    slugs = {s["slug"] for s in items}
    for expected in BUILTIN_SKILLS:
        assert expected["slug"] in slugs

    # 2. Import SKILL.md
    imp = client.post(
        "/api/skills/import",
        headers=ADMIN_HEADERS,
        json={
            "name": "前端性能调优",
            "category": "engineering",
            "markdown": "---\nname: web-perf-audit\ndescription: Audit React bundle and rendering latency\nwhenToUse: When optimizing slow frontend pages\n---\n\n# Web Perf Steps\n1. Measure LCP and bundle size.\n",
        },
    )
    assert imp.status_code == 201, imp.text
    perf_skill = imp.json()
    assert perf_skill["slug"] == "web-perf-audit"
    assert perf_skill["name"] == "前端性能调优"

    # Reject path traversal in extra_files
    bad_skill = client.post(
        "/api/skills",
        headers=ADMIN_HEADERS,
        json={
            "slug": "evil-skill",
            "name": "Evil",
            "description": "Test",
            "content": "Hi",
            "extra_files": {"../../etc/passwd": "nope"},
        },
    )
    assert bad_skill.status_code in (400, 422)

    # 3. Template with default_skill_ids + default_mcp_server_ids auto-syncs on provision
    code_rev = next(s for s in items if s["slug"] == "code-review-checklist")
    tpl_res = client.post(
        "/api/templates",
        headers=ADMIN_HEADERS,
        json={
            "key": "fe-specialist",
            "name": "Frontend Specialist",
            "default_skill_ids": [code_rev["id"], perf_skill["id"]],
        },
    )
    assert tpl_res.status_code == 201, tpl_res.text

    fake_docker.calls.clear()
    fe1 = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "fe1@corp.com", "slug": "fe-one", "template": "fe-specialist"},
    ).json()
    assert set(fe1["skill_ids"]) == {code_rev["id"], perf_skill["id"]}
    skill_calls = [c for c in fake_docker.calls if c[0] == "sync_skills"]
    assert len(skill_calls) == 1
    assert set(skill_calls[0][1][1]) == {"code-review-checklist", "web-perf-audit"}

    # Provision a default employee (no bound skills)
    other = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "other@corp.com", "slug": "other-emp", "template": "agent-os"},
    ).json()
    assert other["skill_ids"] == []

    # Push ONLY by template_keys=['fe-specialist'] -> touches fe-one, NOT other-emp
    qa_skill = next(s for s in items if s["slug"] == "qa-e2e-verification")
    fake_docker.calls.clear()
    push_tpl = client.post(
        f"/api/skills/{qa_skill['id']}/push",
        headers=ADMIN_HEADERS,
        json={"template_keys": ["fe-specialist"], "action": "push"},
    )
    assert push_tpl.status_code == 200
    assert push_tpl.json()["synced"] == 1
    pushed_slugs = [c[1][0] for c in fake_docker.calls if c[0] == "sync_skills"]
    assert pushed_slugs == ["fe-one"]

    # 4. Also verify Plugins sync supports template_keys & sandbox_ids
    fake_docker.calls.clear()
    plg_sync = client.post(
        "/api/plugins/sync-sandboxes",
        headers=ADMIN_HEADERS,
        json={"mode": "market_only", "template_keys": ["fe-specialist"]},
    )
    assert plg_sync.status_code == 200
    assert plg_sync.json()["synced"] == 1
    assert [r["slug"] for r in plg_sync.json()["results"]] == ["fe-one"]


def test_runtime_sync_helpers_and_skill_markdown_roundtrip():
    svc = DockerService(Settings(_env_file=None))
    mock_client = MagicMock()
    svc._client = mock_client
    container = MagicMock(status="running", id="c1")
    mock_client.containers.get.return_value = container
    sbx = Sandbox(
        id="sbx-1",
        user=User(email="a@b.com"),
        slug="alpha",
        volume_name="dsh-alpha-home",
        image_repo="dsh-sandbox",
        image_tag="latest",
        template="agent-os",
    )

    container.exec_run.return_value = (0, b"MCP_SYNC_OK:1\n")
    m_res = svc.sync_mcp_servers(
        sbx,
        upsert_servers={
            "memory": {
                "transport": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-memory"],
                "env": {},
                "enabled": True,
                "toolLoading": "eager",
            }
        },
        remove_slugs=["old-srv", "../bad"],
    )
    assert m_res["ok"] is True
    mcp_payload = json.loads(container.exec_run.call_args.kwargs["environment"]["MCP_SYNC_PAYLOAD"])
    assert "memory" in mcp_payload["upsert"]
    assert mcp_payload["remove"] == ["old-srv"]

    container.exec_run.return_value = (0, b"SKILL_SYNC_OK:written=1,removed=0\n")
    s_res = svc.sync_skills(
        sbx,
        upsert_skills=[{"slug": "code-review-checklist", "skillMd": "---\nname: code-review-checklist\ndescription: Test\n---\n\nBody\n"}],
        remove_slugs=["../escape", "old-skill"],
    )
    assert s_res["ok"] is True
    skill_payload = json.loads(container.exec_run.call_args.kwargs["environment"]["SKILL_SYNC_PAYLOAD"])
    assert skill_payload["remove"] == ["old-skill"]

    # Roundtrip markdown parser/renderer
    from app.models import SkillItem

    sk = SkillItem(
        slug="demo-skill",
        name="Demo",
        description="Run checks: fast & safe",
        when_to_use="When testing",
        content="# Hello\nRun tests.",
        disable_model_invocation=True,
        user_invocable=False,
    )
    rendered = render_skill_markdown(sk)
    parsed = parse_skill_markdown(rendered)
    assert parsed["slug"] == "demo-skill"
    assert parsed["description"] == "Run checks: fast & safe"
    assert parsed["when_to_use"] == "When testing"
    assert parsed["disable_model_invocation"] is True
    assert parsed["user_invocable"] is False
    assert "# Hello" in parsed["content"]


def test_migrate_schema_adds_capability_columns_idempotently(tmp_path):
    db_path = tmp_path / "legacy.db"
    eng = create_engine(f"sqlite:///{db_path.as_posix()}")
    with eng.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE sandboxes (id VARCHAR(36) PRIMARY KEY, slug VARCHAR(64))"
        )
        conn.exec_driver_sql(
            "CREATE TABLE sandbox_templates (id VARCHAR(36) PRIMARY KEY, key VARCHAR(64))"
        )
        conn.exec_driver_sql(
            "CREATE TABLE credential_profiles (id VARCHAR(36) PRIMARY KEY, name VARCHAR(128))"
        )

    migrate_schema(eng)
    migrate_schema(eng)  # second run is idempotent

    insp = inspect(eng)
    assert {"mcp_server_ids_json", "skill_ids_json"}.issubset(
        {c["name"] for c in insp.get_columns("sandboxes")}
    )
    assert {"default_mcp_server_ids_json", "default_skill_ids_json"}.issubset(
        {c["name"] for c in insp.get_columns("sandbox_templates")}
    )
    assert {
        "preset_key",
        "category",
        "description",
        "github_auth_mode",
        "github_api_base_url",
        "github_app_id",
        "github_app_installation_id",
        "github_tls_verify",
        "github_app_private_key_ciphertext",
        "github_app_cached_token_ciphertext",
        "github_app_token_expires_at",
    }.issubset({c["name"] for c in insp.get_columns("credential_profiles")})


def test_github_app_jwt_enterprise_urls_mint_cache_and_renew(api_env, monkeypatch):
    import base64
    from datetime import timedelta

    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding, rsa

    import app.services.github_app as gh_mod
    from app.models import CredentialProfile, utcnow
    from app.services.vault import refresh_expiring_github_app_credentials

    client, fake_docker, _ = api_env

    # 1. URL inference across github.com, *.ghe.com, and on-prem enterprise domains
    assert gh_mod.resolve_github_api_base("github.com") == "https://api.github.com"
    assert gh_mod.resolve_github_api_base("corp.ghe.com") == "https://api.corp.ghe.com"
    assert gh_mod.resolve_github_api_base("git.corp.internal") == "https://git.corp.internal/api/v3"
    assert (
        gh_mod.resolve_github_api_base("https://git.corp.internal:8443")
        == "https://git.corp.internal:8443/api/v3"
    )
    assert (
        gh_mod.resolve_github_api_base("git.corp.internal", "https://api-git.corp.internal/v3")
        == "https://api-git.corp.internal/v3"
    )

    # 2. Generate ephemeral RSA private key & verify RS256 JWT signature
    priv_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem_str = priv_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    jwt_tok = gh_mod.build_github_app_jwt("4242", pem_str, now=1_700_000_000)
    hdr_b64, pay_b64, sig_b64 = jwt_tok.split(".")
    pad = lambda s: s + "=" * (-len(s) % 4)
    hdr_obj = json.loads(base64.urlsafe_b64decode(pad(hdr_b64)))
    pay_obj = json.loads(base64.urlsafe_b64decode(pad(pay_b64)))
    assert hdr_obj == {"alg": "RS256", "typ": "JWT"}
    assert pay_obj == {"iat": 1_699_999_940, "exp": 1_700_000_540, "iss": "4242"}
    priv_key.public_key().verify(
        base64.urlsafe_b64decode(pad(sig_b64)),
        f"{hdr_b64}.{pay_b64}".encode("ascii"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )

    # 3. Built-in presets include github-app-enterprise
    presets = client.get("/api/credential-profiles/presets", headers=ADMIN_HEADERS).json()["items"]
    assert any(p["preset_key"] == "github-app-enterprise" for p in presets)

    # 4. Create Enterprise GitHub App credential profile (PEM never leaked in API response)
    create_res = client.post(
        "/api/credential-profiles",
        headers=ADMIN_HEADERS,
        json={
            "name": "Corp GHES App",
            "preset_key": "github-app-enterprise",
            "category": "git",
            "git_user_name": "Metis Bot",
            "git_user_email": "bot@corp.internal",
            "git_host": "git.corp.internal:8443",
            "github_auth_mode": "github_app",
            "github_api_base_url": "https://git.corp.internal:8443/api/v3",
            "github_app_id": "4242",
            "github_app_installation_id": "9001",
            "github_app_private_key": pem_str,
            "github_tls_verify": False,
        },
    )
    assert create_res.status_code == 201, create_res.text
    prof = create_res.json()
    assert prof["github_auth_mode"] == "github_app"
    assert prof["has_github_app_private_key"] is True
    assert prof["github_tls_verify"] is False
    assert "BEGIN PRIVATE KEY" not in json.dumps(prof)

    # 5. Provision 2 employees & bind prof to dev-a ONLY
    dev_a = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "deva@corp.com", "slug": "ghe-dev-a"},
    ).json()
    dev_b = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "devb@corp.com", "slug": "ghe-dev-b"},
    ).json()

    mint_counter = {"n": 0, "urls": [], "verify": []}

    class _FakeResp:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload
            self.content = json.dumps(payload).encode("utf-8")

        def json(self):
            return self._payload

    class _FakeHttpxClient:
        def __init__(self, *args, **kwargs):
            mint_counter["verify"].append(kwargs.get("verify"))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None):
            mint_counter["n"] += 1
            mint_counter["urls"].append(url)
            exp = (utcnow() + timedelta(minutes=55)).strftime("%Y-%m-%dT%H:%M:%SZ")
            return _FakeResp(201, {"token": f"ghs_minted_{mint_counter['n']}", "expires_at": exp})

    monkeypatch.setattr(gh_mod.httpx, "Client", _FakeHttpxClient)

    # First targeted push mints ghs_minted_1 ONLY for ghe-dev-a
    fake_docker.calls.clear()
    push1 = client.post(
        f"/api/credential-profiles/{prof['id']}/push",
        headers=ADMIN_HEADERS,
        json={"sandbox_ids": [dev_a["id"]]},
    )
    assert push1.status_code == 200, push1.text
    assert push1.json()["synced"] == 1
    assert mint_counter["n"] == 1
    assert mint_counter["urls"] == [
        "https://git.corp.internal:8443/api/v3/app/installations/9001/access_tokens"
    ]
    assert mint_counter["verify"] == [False]
    cred_calls = [c[1] for c in fake_docker.calls if c[0] == "sync_credential_profile_detail"]
    assert len(cred_calls) == 1
    assert cred_calls[0]["slug"] == "ghe-dev-a"
    assert cred_calls[0]["git_token"] == "ghs_minted_1"
    assert cred_calls[0]["github_api_base_url"] == "https://git.corp.internal:8443/api/v3"
    assert cred_calls[0]["git_auth_username"] == "x-access-token"
    assert cred_calls[0]["github_tls_verify"] is False
    assert cred_calls[0]["is_github"] is True

    # Second immediate push reuses cached encrypted token (mint_counter still 1)
    fake_docker.calls.clear()
    push2 = client.post(
        f"/api/credential-profiles/{prof['id']}/push",
        headers=ADMIN_HEADERS,
        json={"sandbox_ids": [dev_a["id"]]},
    )
    assert push2.status_code == 200
    assert mint_counter["n"] == 1
    assert [c[1] for c in fake_docker.calls if c[0] == "sync_credential_profile_detail"][0]["git_token"] == "ghs_minted_1"

    # Explicit bind dev_a -> credential_profile_id + force-refresh endpoint mints ghs_minted_2 & pushes to dev_a only
    assert (
        client.patch(
            f"/api/sandboxes/{dev_a['id']}",
            headers=ADMIN_HEADERS,
            json={"credential_profile_ids": [prof["id"]]},
        ).status_code
        == 200
    )
    fake_docker.calls.clear()
    ref_res = client.post(
        f"/api/credential-profiles/{prof['id']}/refresh-github-app",
        headers=ADMIN_HEADERS,
        json={"push_to_bound": True},
    )
    assert ref_res.status_code == 200, ref_res.text
    assert mint_counter["n"] == 2
    assert ref_res.json()["pushed"]["synced"] == 1
    ref_calls = [c[1] for c in fake_docker.calls if c[0] == "sync_credential_profile_detail"]
    assert [c["slug"] for c in ref_calls] == ["ghe-dev-a"]
    assert ref_calls[0]["git_token"] == "ghs_minted_2"

    # Background auto-renew refreshes expiring token bound to running sandbox
    from app.db import SessionLocal

    with SessionLocal() as session_db:
        row = session_db.get(CredentialProfile, prof["id"])
        assert row is not None
        row.github_app_token_expires_at = utcnow() + timedelta(minutes=3)
        session_db.commit()
        fake_docker.calls.clear()
        renewed = refresh_expiring_github_app_credentials(session_db, fake_docker)
        assert renewed == 1
        assert mint_counter["n"] == 3
        renew_calls = [c[1] for c in fake_docker.calls if c[0] == "sync_credential_profile_detail"]
        assert [c["slug"] for c in renew_calls] == ["ghe-dev-a"]
        assert renew_calls[0]["git_token"] == "ghs_minted_3"

    # Test runtime payload generation for enterprise GitHub shim & scoped TLS
    mock_svc = DockerService(Settings(_env_file=None))
    mock_client = MagicMock()
    mock_svc._client = mock_client
    container = MagicMock(status="running", id="c-gh")
    container.exec_run.return_value = (0, b"CRED_SYNC_OK\n")
    mock_client.containers.get.return_value = container
    rt_res = mock_svc.sync_credential_profile(
        Sandbox(
            id="sbx-gh",
            user_id="u1",
            user=User(email="u1@corp.com"),
            slug="ghe-rt",
            volume_name="vol",
            image_repo="dsh-sandbox",
            image_tag="latest",
            template="agent-os",
        ),
        git_host="git.corp.internal:8443",
        git_token="ghs_minted_3",
        github_api_base_url="https://git.corp.internal:8443/api/v3",
        git_auth_username="x-access-token",
        github_tls_verify=False,
        is_github=True,
    )
    assert rt_res["ok"] is True
    rt_payload = json.loads(container.exec_run.call_args.kwargs["environment"]["CRED_SYNC_PAYLOAD"])
    assert rt_payload["gitAuthUsername"] == "x-access-token"
    assert rt_payload["githubTlsVerify"] is False
    assert rt_payload["githubApiBaseUrl"] == "https://git.corp.internal:8443/api/v3"
    assert "launcher" in rt_payload["githubShim"] and "preload" in rt_payload["githubShim"]


def test_skill_zip_bundle_import_export_resources_and_security(api_env):
    import io
    import zipfile

    client, fake_docker, _ = api_env

    # 1. Built-in skills include bundled resources (e.g. code-review-checklist -> scripts/ & references/)
    skills = client.get("/api/skills", headers=ADMIN_HEADERS).json()
    code_rev = next(s for s in skills if s["slug"] == "code-review-checklist")
    assert "scripts/precommit-check.sh" in code_rev["extra_files"]
    assert "references/review-rubric.md" in code_rev["extra_files"]

    # 2. Build a realistic .zip archive wrapped inside a single directory with text + binary PNG + __MACOSX noise
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("__MACOSX/._SKILL.md", b"junk")
        zf.writestr(
            "bundle-skill/SKILL.md",
            "---\nname: bundle-demo-skill\ndescription: Skill with scripts and binary asset\nwhenToUse: When testing bundles\n---\n\n# Bundle Demo\nRun `scripts/run.sh`.\n",
        )
        zf.writestr("bundle-skill/scripts/run.sh", "#!/bin/sh\necho hi\n")
        zf.writestr("bundle-skill/references/guide.md", "# Guide\nFollow these steps.\n")
        zf.writestr("bundle-skill/assets/pixel.png", png_bytes)

    imp_res = client.post(
        "/api/skills/import-zip",
        headers=ADMIN_HEADERS,
        files={"file": ("bundle-demo-skill.zip", buf.getvalue(), "application/zip")},
        data={"name": "包资源演示技能", "category": "engineering", "overwrite": "false"},
    )
    assert imp_res.status_code == 201, imp_res.text
    imported = imp_res.json()
    assert imported["slug"] == "bundle-demo-skill"
    assert imported["name"] == "包资源演示技能"
    assert "scripts/run.sh" in imported["extra_files"]
    assert "references/guide.md" in imported["extra_files"]
    assert imported["extra_files"]["assets/pixel.png"].startswith("base64:")

    # 3. Export .zip round-trip restores SKILL.md + text + exact binary bytes + executable flag
    exp_res = client.get(f"/api/skills/{imported['id']}/export", headers=ADMIN_HEADERS)
    assert exp_res.status_code == 200
    assert "application/zip" in exp_res.headers["content-type"]
    with zipfile.ZipFile(io.BytesIO(exp_res.content), "r") as zout:
        names = set(zout.namelist())
        assert "bundle-demo-skill/SKILL.md" in names
        assert "bundle-demo-skill/scripts/run.sh" in names
        assert "bundle-demo-skill/references/guide.md" in names
        assert "bundle-demo-skill/assets/pixel.png" in names
        assert zout.read("bundle-demo-skill/assets/pixel.png") == png_bytes
        sh_info = zout.getinfo("bundle-demo-skill/scripts/run.sh")
        assert ((sh_info.external_attr >> 16) & 0o777) == 0o755

    # 4. Reject Zip Slip path traversal and missing SKILL.md
    bad_zip = io.BytesIO()
    with zipfile.ZipFile(bad_zip, "w") as zf:
        zf.writestr("../../etc/passwd", "root:x:0:0")
    assert (
        client.post(
            "/api/skills/import-zip",
            headers=ADMIN_HEADERS,
            files={"file": ("evil.zip", bad_zip.getvalue(), "application/zip")},
        ).status_code
        in (400, 422)
    )

    no_md_zip = io.BytesIO()
    with zipfile.ZipFile(no_md_zip, "w") as zf:
        zf.writestr("readme.txt", "no skill markdown")
    assert (
        client.post(
            "/api/skills/import-zip",
            headers=ADMIN_HEADERS,
            files={"file": ("nomd.zip", no_md_zip.getvalue(), "application/zip")},
        ).status_code
        in (400, 422)
    )

    # 5. Push zip-imported skill to targeted sandbox -> verify sync_skills receives extraFiles including base64 binary
    emp = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "zipemp@corp.com", "slug": "zip-emp"},
    ).json()
    fake_docker.calls.clear()
    push_res = client.post(
        f"/api/skills/{imported['id']}/push",
        headers=ADMIN_HEADERS,
        json={"sandbox_ids": [emp["id"]], "action": "push"},
    )
    assert push_res.status_code == 200
    assert push_res.json()["synced"] == 1
    assert any(c[0] == "sync_skills" and "bundle-demo-skill" in c[1][1] for c in fake_docker.calls)
