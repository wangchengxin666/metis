from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest


def test_lifespan_startup_validation(monkeypatch):
    import app.main as main_mod

    orig_secret = main_mod.settings.secret_key
    orig_mode = main_mod.settings.manager_auth_mode
    orig_token = main_mod.settings.manager_admin_token
    orig_issuer = main_mod.settings.oidc_issuer_url
    orig_discovery = main_mod.settings.oidc_discovery_url
    orig_cid = main_mod.settings.oidc_client_id
    orig_csec = main_mod.settings.oidc_client_secret

    async def run_lifespan():
        async with main_mod.lifespan(main_mod.app):
            pass

    try:
        monkeypatch.setattr(main_mod.settings, "secret_key", "change-me-in-production")
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            asyncio.run(run_lifespan())

        monkeypatch.setattr(main_mod.settings, "secret_key", orig_secret)
        monkeypatch.setattr(main_mod.settings, "manager_auth_mode", "token")
        monkeypatch.setattr(main_mod.settings, "manager_admin_token", "")
        with pytest.raises(RuntimeError, match="MANAGER_ADMIN_TOKEN"):
            asyncio.run(run_lifespan())

        monkeypatch.setattr(main_mod.settings, "manager_auth_mode", "oidc")
        monkeypatch.setattr(main_mod.settings, "oidc_issuer_url", "")
        monkeypatch.setattr(main_mod.settings, "oidc_discovery_url", "")
        monkeypatch.setattr(main_mod.settings, "oidc_client_id", "")
        monkeypatch.setattr(main_mod.settings, "oidc_client_secret", "")
        with pytest.raises(RuntimeError, match="MANAGER_AUTH_MODE=oidc requires"):
            asyncio.run(run_lifespan())
    finally:
        monkeypatch.setattr(main_mod.settings, "secret_key", orig_secret)
        monkeypatch.setattr(main_mod.settings, "manager_auth_mode", orig_mode)
        monkeypatch.setattr(main_mod.settings, "manager_admin_token", orig_token)
        monkeypatch.setattr(main_mod.settings, "oidc_issuer_url", orig_issuer)
        monkeypatch.setattr(main_mod.settings, "oidc_discovery_url", orig_discovery)
        monkeypatch.setattr(main_mod.settings, "oidc_client_id", orig_cid)
        monkeypatch.setattr(main_mod.settings, "oidc_client_secret", orig_csec)


def test_public_endpoints_and_plugins_registry(api_env):
    client, _fake_docker, _registry = api_env

    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok", "docker": "ok"}

    idx = client.get("/plugins/index.json")
    assert idx.status_code == 200
    assert idx.json()["plugins"][0]["name"] == "@local/dsh-plugin-sample-tool"

    tgz = client.get("/plugins/packages/sample-tool.tgz")
    assert tgz.status_code == 200
    assert 'filename="sample-tool-1.2.3.tgz"' in tgz.headers["content-disposition"]

    pack = client.get("/plugins/npm/@local/dsh-plugin-sample-tool")
    assert pack.status_code == 200
    assert pack.json()["dist-tags"]["latest"] == "1.2.3"

    icon = client.get("/plugins/icons/sample-tool.svg")
    assert icon.status_code == 200
    assert "<svg" in icon.text

    assert client.get("/plugins/packages/missing.tgz").status_code == 404
    assert client.get("/plugins/icons/missing.svg").status_code == 404


def test_token_auth_admin_crud_backup_and_user_portal(api_env):
    client, _fake_docker, _registry = api_env
    admin_headers = {"Authorization": "Bearer test-admin-token"}

    # Unauthenticated check
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["authenticated"] is False

    # Create LLM profile, custom template, user, secondary admin
    llm_res = client.post(
        "/api/llm-profiles",
        headers=admin_headers,
        json={
            "name": "DeepSeek",
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "api_key": "sk-secret",
        },
    )
    assert llm_res.status_code == 201
    assert "api_key" not in llm_res.json()
    llm_id = llm_res.json()["id"]
    assert llm_res.json()["has_api_key"] is True

    # PATCH LLM profile with full model capability parameters (context, max output, vision, reasoning)
    llm_patch = client.patch(
        f"/api/llm-profiles/{llm_id}",
        headers=admin_headers,
        json={
            "api_protocol": "openai-completions",
            "context_window": 256000,
            "max_tokens": 32000,
            "supports_image": True,
            "reasoning_effort": "high",
            "thinking_format": "deepseek",
        },
    )
    assert llm_patch.status_code == 200
    lp = llm_patch.json()
    assert lp["context_window"] == 256000
    assert lp["max_tokens"] == 32000
    assert lp["supports_image"] is True
    assert lp["reasoning_effort"] == "high"
    assert lp["thinking_format"] == "deepseek"
    assert lp["has_api_key"] is True

    tpl_res = client.post(
        "/api/templates",
        headers=admin_headers,
        json={
            "key": "gpu-box",
            "name": "GPU Box",
            "default_cpu_limit": 4.0,
            "default_memory_limit": "8g",
        },
    )
    assert tpl_res.status_code == 201
    assert len(client.get("/api/templates", headers=admin_headers).json()) >= 2

    user_res = client.post(
        "/api/users",
        headers=admin_headers,
        json={
            "email": "alice@example.com",
            "display_name": "Alice",
            "password": "alice-password-123",
        },
    )
    assert user_res.status_code == 201
    assert user_res.json()["has_password"] is True
    alice_id = user_res.json()["id"]

    # Second admin + deactivate
    adm_res = client.post(
        "/api/admins",
        headers=admin_headers,
        json={"email": "ops@example.com", "display_name": "Ops"},
    )
    assert adm_res.status_code == 201
    assert client.delete("/api/admins/ops@example.com", headers=admin_headers).status_code == 200

    # Create sandbox for alice and bob
    alice_sbx = client.post(
        "/api/sandboxes",
        headers=admin_headers,
        json={
            "email": "alice@example.com",
            "display_name": "Alice",
            "llm_profile_id": llm_id,
            "template": "agent-os",
        },
    )
    assert alice_sbx.status_code == 201
    alice_sbx_id = alice_sbx.json()["id"]
    assert alice_sbx.json()["slug"] == "alice"

    bob_sbx = client.post(
        "/api/sandboxes",
        headers=admin_headers,
        json={"email": "bob@example.com", "initial_password": "bob-password-123"},
    )
    assert bob_sbx.status_code == 201
    bob_sbx_id = bob_sbx.json()["id"]

    # Admin operations: logs, stats, backup, limits, recreate, sync-sandboxes
    assert (
        client.get(f"/api/sandboxes/{alice_sbx_id}/logs", headers=admin_headers)
        .json()["logs"]
        .startswith("[alice]")
    )
    assert (
        client.get(f"/api/sandboxes/{alice_sbx_id}/stats", headers=admin_headers).json()[
            "cpu_percent"
        ]
        == 12.5
    )

    backup = client.get(f"/api/sandboxes/{alice_sbx_id}/backup", headers=admin_headers)
    assert backup.status_code == 200
    assert 'filename="alice-home.tar"' in backup.headers["content-disposition"]
    assert backup.content == b"fake-tar-chunk-1fake-tar-chunk-2"

    patched = client.patch(
        f"/api/sandboxes/{alice_sbx_id}",
        headers=admin_headers,
        json={"cpu_limit": 4.0, "memory_limit": "8g", "image_tag": "next"},
    )
    assert patched.status_code == 200
    assert patched.json()["cpu_limit"] == 4.0
    assert patched.json()["image_tag"] == "next"

    recreated = client.post(
        f"/api/sandboxes/{alice_sbx_id}/recreate",
        headers=admin_headers,
    )
    assert recreated.status_code == 200
    assert recreated.json()["status"] == "running"

    synced = client.post("/api/plugins/sync-sandboxes", headers=admin_headers, json={})
    assert synced.status_code == 200
    assert synced.json()["synced"] == 2

    # 1-click push LLM profile to selected / all sandboxes
    push_res = client.post(
        f"/api/llm-profiles/{llm_id}/push",
        headers=admin_headers,
        json={"sandbox_ids": [bob_sbx_id], "set_as_default": True, "replace_managed": False},
    )
    assert push_res.status_code == 200
    push_body = push_res.json()
    assert push_body["synced"] == 1
    assert push_body["skipped"] == 0
    assert push_body["results"][0]["slug"] == "bob"
    # Pushing with set_as_default=True binds sandbox.llm_profile_id in DB
    bob_detail = client.get(f"/api/sandboxes/{bob_sbx_id}", headers=admin_headers)
    assert bob_detail.status_code == 200
    assert bob_detail.json()["llm_profile_id"] == llm_id

    # Patching llm_profile_id on a running sandbox hot-syncs instead of recreating container
    recreate_count_before = len([c for c in _fake_docker.calls if c[0] == "recreate"])
    llm_patch_sbx = client.patch(
        f"/api/sandboxes/{alice_sbx_id}",
        headers=admin_headers,
        json={"llm_profile_id": llm_id},
    )
    assert llm_patch_sbx.status_code == 200
    assert len([c for c in _fake_docker.calls if c[0] == "recreate"]) == recreate_count_before
    assert any(c[0] == "sync_llm_profile" and c[1][0] == "alice" for c in _fake_docker.calls)

    overview = client.get("/api/overview", headers=admin_headers)
    assert overview.status_code == 200
    assert overview.json()["total_sandboxes"] == 2

    # ForwardAuth without login -> 401 JSON / 401 HTML
    assert client.get("/api/auth/verify-sandbox/alice").status_code == 401
    assert (
        client.get(
            "/api/auth/verify-sandbox/alice", headers={"Accept": "text/html"}
        ).status_code
        == 401
    )

    # Login as Alice with password
    bad_login = client.post(
        "/api/auth/login",
        json={"email": "alice@example.com", "password": "wrong", "mode": "user"},
    )
    assert bad_login.status_code == 401

    good_login = client.post(
        "/api/auth/login",
        json={"email": "alice@example.com", "password": "alice-password-123", "mode": "user"},
    )
    assert good_login.status_code == 200
    assert good_login.json()["admin"] is False

    # Verify sandbox ForwardAuth: Alice can access alice, cannot access bob, missing returns 404
    ok_verify = client.get("/api/auth/verify-sandbox/alice")
    assert ok_verify.status_code == 200
    assert ok_verify.headers["x-auth-request-email"] == "alice@example.com"
    assert ok_verify.headers["x-sandbox-owner"] == "alice@example.com"
    assert ok_verify.headers["x-auth-request-name"] == "Alice"
    assert ok_verify.headers["x-sandbox-owner-name"] == "Alice"
    assert ok_verify.headers["x-auth-request-admin"] == "false"

    alice_me = client.get("/api/auth/me?slug=alice").json()
    assert alice_me["display_name"] == "Alice"
    assert alice_me["sandbox"]["owner_email"] == "alice@example.com"
    assert alice_me["sandbox"]["owner_display_name"] == "Alice"
    assert client.get("/api/auth/me?slug=bob").json()["sandbox"] is None

    assert client.get("/api/auth/verify-sandbox/bob").status_code == 403
    assert client.get("/api/auth/verify-sandbox/does-not-exist").status_code == 404

    # Alice self-service portal only sees her own sandbox & cannot touch Bob's
    my_sbxs = client.get("/api/my/sandboxes").json()["items"]
    assert [s["slug"] for s in my_sbxs] == ["alice"]
    assert client.post(f"/api/my/sandboxes/{alice_sbx_id}/restart").status_code == 200
    assert client.post(f"/api/my/sandboxes/{bob_sbx_id}/restart").status_code == 403

    # Alice changes her own password
    pw_res = client.post(
        "/api/my/password",
        json={"current_password": "alice-password-123", "new_password": "alice-new-password-456"},
    )
    assert pw_res.status_code == 200
    client.post("/api/auth/logout")
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "alice@example.com", "password": "alice-new-password-456", "mode": "user"},
        ).status_code
        == 200
    )

    # Verify UTF-8 non-ASCII display_name URL-encoding in ForwardAuth headers
    assert (
        client.patch(
            f"/api/users/{alice_id}",
            headers=admin_headers,
            json={"display_name": "爱丽丝"},
        ).status_code
        == 200
    )
    cn_verify = client.get("/api/auth/verify-sandbox/alice")
    assert cn_verify.status_code == 200
    assert cn_verify.headers["x-auth-request-name"] == "%E7%88%B1%E4%B8%BD%E4%B8%9D"
    assert cn_verify.headers["x-sandbox-owner-name"] == "%E7%88%B1%E4%B8%BD%E4%B8%9D"
    assert (
        client.patch(
            f"/api/users/{alice_id}",
            headers=admin_headers,
            json={"display_name": "Alice"},
        ).status_code
        == 200
    )

    # Admin disables Alice -> Alice session immediately denied
    assert (
        client.patch(
            f"/api/users/{alice_id}",
            headers=admin_headers,
            json={"status": "disabled"},
        ).status_code
        == 200
    )
    assert client.get("/api/auth/verify-sandbox/alice").status_code == 403

    # Admin cannot deactivate self when signed in with session
    client.post("/api/auth/logout")
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "admin@example.com", "token": "test-admin-token"},
        ).status_code
        == 200
    )
    assert client.delete("/api/admins/admin@example.com").status_code == 400
    admin_verify = client.get("/api/auth/verify-sandbox/alice")
    assert admin_verify.status_code == 200
    assert admin_verify.headers["x-auth-request-email"] == "admin@example.com"
    assert admin_verify.headers["x-sandbox-owner"] == "alice@example.com"
    assert admin_verify.headers["x-sandbox-owner-name"] == "Alice"
    assert admin_verify.headers["x-auth-request-admin"] == "true"
    admin_me = client.get("/api/auth/me?slug=alice").json()
    assert admin_me["admin"] is True
    assert admin_me["sandbox"]["owner_email"] == "alice@example.com"
    open_resp = client.get(f"/sandboxes/{alice_sbx_id}/open", follow_redirects=False)
    assert open_resp.status_code == 302
    assert open_resp.headers["location"].endswith("/s/alice/")

    assert client.delete(f"/api/sandboxes/{alice_sbx_id}", headers=admin_headers).status_code == 200


def test_none_and_oidc_auth_modes(api_env, monkeypatch):
    client, _fake_docker, _registry = api_env
    import app.main as main_mod

    admin_headers = {"Authorization": "Bearer test-admin-token"}

    # Mode: none
    monkeypatch.setattr(main_mod.settings, "manager_auth_mode", "none")
    me = client.get("/api/auth/me").json()
    assert me["authenticated"] is True
    assert me["admin"] is True
    assert client.get("/api/overview").status_code == 200

    # Create a sandbox in 'none' mode so ForwardAuth resolves an existing slug in OIDC tests,
    # then clear the session cookie before switching to OIDC.
    created = client.post("/api/sandboxes", json={"email": "sso-user@example.com"})
    assert created.status_code == 201
    client.post("/api/auth/logout")

    # Mode: oidc with DB-configured 'default' provider (and no admin token fallback)
    monkeypatch.setattr(main_mod.settings, "manager_auth_mode", "oidc")
    monkeypatch.setattr(main_mod.settings, "manager_admin_token", "test-admin-token")

    prov_res = client.post(
        "/api/oidc-providers",
        headers=admin_headers,
        json={
            "slug": "default",
            "name": "Enterprise SSO",
            "issuer_url": "https://idp.example.com/realms/main",
            "client_id": "dsh-client",
            "client_secret": "dsh-secret",
            "email_claim": "email",
        },
    )
    assert prov_res.status_code == 201
    prov_id = prov_res.json()["id"]

    redirect_calls: list[dict] = []

    async def fake_authorize_redirect(_request, redirect_uri, **kwargs):
        from fastapi.responses import RedirectResponse

        redirect_calls.append({"redirect_uri": redirect_uri, "kwargs": kwargs})
        return RedirectResponse(f"https://idp.example.com/auth?redirect_uri={redirect_uri}", status_code=302)

    async def fake_authorize_access_token(_request):
        return {
            "id_token": "fake-id-token-jwt",
            "userinfo": {"email": "sso-user@example.com", "name": "SSO User"},
        }

    async def fake_load_server_metadata():
        return {
            "end_session_endpoint": "https://idp.example.com/protocol/openid-connect/logout",
        }

    fake_client = SimpleNamespace(
        authorize_redirect=fake_authorize_redirect,
        authorize_access_token=fake_authorize_access_token,
        load_server_metadata=fake_load_server_metadata,
        server_metadata={},
    )
    monkeypatch.setattr(main_mod.oidc_registry, "get_client", lambda _prov: fake_client)

    # In oidc mode, local user login is disabled by default; when admin token is unset, admin login returns 400
    monkeypatch.setattr(main_mod.settings, "manager_admin_token", "")
    assert client.post("/api/auth/login", json={"email": "a@b.com", "token": "x"}).status_code == 400
    assert client.post("/api/auth/login", json={"email": "sso-user@example.com", "password": "pw", "mode": "user"}).status_code == 403
    monkeypatch.setattr(main_mod.settings, "manager_admin_token", "test-admin-token")

    unauth_verify = client.get(
        "/api/auth/verify-sandbox/sso-user",
        headers={"Accept": "text/html"},
        follow_redirects=False,
    )
    assert unauth_verify.status_code == 401
    assert "/login" in unauth_verify.text
    start_res = client.get("/auth/oidc/start?next=/my", follow_redirects=False)
    assert start_res.status_code == 302
    assert "idp.example.com" in start_res.headers["location"]
    assert redirect_calls[-1]["kwargs"] == {}

    cb_res = client.get("/auth/callback", follow_redirects=False)
    assert cb_res.status_code == 303
    assert cb_res.headers["location"] == "/my"
    assert client.cookies.get("dsh_manager_id_token") == "fake-id-token-jwt"

    me_oidc = client.get("/api/auth/me?slug=sso-user").json()
    assert me_oidc["authenticated"] is True
    assert me_oidc["email"] == "sso-user@example.com"
    assert me_oidc["display_name"] == "SSO User"
    assert me_oidc["admin"] is False
    assert me_oidc["auth_method"] == "oidc"
    assert me_oidc["oidc_provider_slug"] == "default"
    assert me_oidc["sandbox"]["owner_email"] == "sso-user@example.com"
    oidc_verify = client.get("/api/auth/verify-sandbox/sso-user")
    assert oidc_verify.status_code == 200
    assert oidc_verify.headers["x-auth-request-name"] == "SSO%20User"
    assert oidc_verify.headers["x-auth-request-admin"] == "false"

    # API logout clears local session + id_token and returns RP-Initiated Logout URL
    logout_res = client.post("/api/auth/logout")
    assert logout_res.status_code == 200
    logout_url = logout_res.json()["logout_url"]
    assert logout_url.startswith("https://idp.example.com/protocol/openid-connect/logout?")
    assert "id_token_hint=fake-id-token-jwt" in logout_url
    assert "client_id=dsh-client" in logout_url
    assert "post_logout_redirect_uri=" in logout_url
    assert "%2Flogin" in logout_url
    assert client.get("/api/auth/me").json()["authenticated"] is False
    assert client.get("/api/auth/verify-sandbox/sso-user").status_code == 401

    # Browser GET /auth/logout redirects to IdP logout URL and rewrites split-horizon internal origin
    assert client.patch(
        f"/api/oidc-providers/{prov_id}",
        headers=admin_headers,
        json={
            "discovery_url": "http://dsh-keycloak:8080/realms/main/.well-known/openid-configuration",
            "issuer_url": "https://sso.example.com/realms/main",
        },
    ).status_code == 200
    fake_client.server_metadata = {
        "end_session_endpoint": "http://dsh-keycloak:8080/realms/main/protocol/openid-connect/logout"
    }
    assert client.get("/auth/callback", follow_redirects=False).status_code == 303
    get_logout = client.get("/auth/logout", follow_redirects=False)
    assert get_logout.status_code == 303
    assert get_logout.headers["location"].startswith("https://sso.example.com/realms/main/protocol/openid-connect/logout?")
    assert client.get("/api/auth/me").json()["authenticated"] is False

    # Fallback when IdP lacks end_session_endpoint: next login forces prompt=login
    assert client.patch(
        f"/api/oidc-providers/{prov_id}",
        headers=admin_headers,
        json={"discovery_url": None},
    ).status_code == 200
    fake_client.server_metadata = {}

    async def empty_metadata():
        return {}

    fake_client.load_server_metadata = empty_metadata
    assert client.get("/auth/callback", follow_redirects=False).status_code == 303
    fallback_logout = client.post("/api/auth/logout")
    assert fallback_logout.status_code == 200
    assert fallback_logout.json()["logout_url"] is None
    assert client.get("/api/auth/me").json()["authenticated"] is False
    assert client.get("/auth/oidc/start", follow_redirects=False).status_code == 302
    assert redirect_calls[-1]["kwargs"] == {"prompt": "login"}

    # Explicit logout_url override per provider
    assert client.patch(
        f"/api/oidc-providers/{prov_id}",
        headers=admin_headers,
        json={"logout_url": "https://custom-idp.example.com/v2/logout"},
    ).status_code == 200
    assert client.get("/auth/callback", follow_redirects=False).status_code == 303
    override_logout = client.post("/api/auth/logout")
    assert override_logout.json()["logout_url"].startswith("https://custom-idp.example.com/v2/logout?")


def test_internal_multi_oidc_hybrid_auth_and_policies(api_env, monkeypatch):
    client, _fake_docker, _registry = api_env
    import app.main as main_mod
    import app.oidc as oidc_mod

    admin_headers = {"Authorization": "Bearer test-admin-token"}

    # Create local user + extra platform admins for role-gating checks
    assert client.post(
        "/api/users",
        headers=admin_headers,
        json={"email": "local@corp.com", "display_name": "Local User", "password": "local-password-1"},
    ).status_code == 201
    assert client.post(
        "/api/admins",
        headers=admin_headers,
        json={"email": "boss@corp.com", "display_name": "Corp Admin"},
    ).status_code == 201
    assert client.post(
        "/api/admins",
        headers=admin_headers,
        json={"email": "ext-admin@partner.org", "display_name": "Partner Admin"},
    ).status_code == 201

    # Configure two internal OIDC providers via API without touching Docker/env
    kc_res = client.post(
        "/api/oidc-providers",
        headers=admin_headers,
        json={
            "slug": "keycloak",
            "name": "Corp Keycloak",
            "issuer_url": "https://kc.corp.com/realms/main",
            "client_id": "kc-client",
            "client_secret": "kc-secret",
            "allowed_domains": "corp.com",
            "allow_admin_login": True,
            "sort_order": 10,
        },
    )
    assert kc_res.status_code == 201
    kc_data = kc_res.json()
    assert "client_secret" not in kc_data
    assert kc_data["has_client_secret"] is True
    assert kc_data["redirect_uri"] == "http://localhost:9000/auth/oidc/keycloak/callback"
    assert kc_data["post_logout_redirect_uri"] == "http://localhost:9000/login"

    partner_res = client.post(
        "/api/oidc-providers",
        headers=admin_headers,
        json={
            "slug": "partner",
            "name": "Partner SSO",
            "issuer_url": "https://sso.partner.org",
            "client_id": "partner-client",
            "client_secret": "partner-secret",
            "logout_url": "https://sso.partner.org/logout",
            "allowed_domains": "partner.org",
            "allow_admin_login": False,
            "sort_order": 20,
        },
    )
    assert partner_res.status_code == 201
    partner_id = partner_res.json()["id"]

    # Unauthenticated /api/auth/me exposes enabled providers in sort order without secrets
    me_anon = client.get("/api/auth/me").json()
    assert me_anon["authenticated"] is False
    assert me_anon["allow_local_user_login"] is True
    assert me_anon["admin_token_configured"] is True
    assert me_anon["oidc_providers"] == [
        {"slug": "keycloak", "name": "Corp Keycloak", "login_url": "/auth/oidc/keycloak/start"},
        {"slug": "partner", "name": "Partner SSO", "login_url": "/auth/oidc/partner/start"},
    ]

    # Hybrid login: local user login works alongside OIDC and logs out locally (no IdP redirect)
    local_login = client.post(
        "/api/auth/login",
        json={"email": "local@corp.com", "password": "local-password-1", "mode": "user"},
    )
    assert local_login.status_code == 200
    assert client.get("/api/auth/me").json()["auth_method"] == "local"
    local_logout = client.post("/api/auth/logout").json()
    assert local_logout["logout_url"] is None

    # Mock per-provider OIDC clients
    next_userinfo: dict[str, dict] = {
        "keycloak": {"email": "boss@corp.com", "name": "Corp Boss"},
        "partner": {"email": "ext-admin@partner.org", "name": "Partner Admin"},
    }

    def make_fake_client(provider):
        slug = provider.slug

        async def _redirect(_request, redirect_uri, **kwargs):
            from fastapi.responses import RedirectResponse

            return RedirectResponse(f"https://{slug}.idp/auth?redirect_uri={redirect_uri}", status_code=302)

        async def _token(_request):
            return {"id_token": f"id-{slug}", "userinfo": next_userinfo[slug]}

        async def _meta():
            return {"end_session_endpoint": f"https://{slug}.idp/end-session"}

        return SimpleNamespace(
            authorize_redirect=_redirect,
            authorize_access_token=_token,
            load_server_metadata=_meta,
            server_metadata={},
        )

    monkeypatch.setattr(main_mod.oidc_registry, "get_client", make_fake_client)

    # 1) Provider 'keycloak' grants admin to corp admin email and routes logout to keycloak
    s1 = client.get("/auth/oidc/keycloak/start?next=/admin", follow_redirects=False)
    assert s1.status_code == 302
    assert "/auth/oidc/keycloak/callback" in s1.headers["location"]
    cb1 = client.get("/auth/oidc/keycloak/callback", follow_redirects=False)
    assert cb1.status_code == 303
    assert cb1.headers["location"] == "/admin"
    me1 = client.get("/api/auth/me").json()
    assert me1["admin"] is True
    assert me1["oidc_provider_slug"] == "keycloak"
    assert client.get("/api/overview").status_code == 200
    lo1 = client.post("/api/auth/logout").json()
    assert lo1["logout_url"].startswith("https://keycloak.idp/end-session?")
    assert "client_id=kc-client" in lo1["logout_url"]

    # 2) Domain whitelist blocks disallowed email domain on 'keycloak'
    next_userinfo["keycloak"] = {"email": "outsider@gmail.com", "name": "Outsider"}
    denied = client.get("/auth/oidc/keycloak/callback", follow_redirects=False)
    assert denied.status_code == 303
    assert denied.headers["location"] == "/login?error=domain_not_allowed"
    assert client.get("/api/auth/me").json()["authenticated"] is False

    # 3) Provider 'partner' has allow_admin_login=False -> even platform_admins email gets non-admin session
    s2 = client.get("/auth/oidc/partner/start?next=/admin", follow_redirects=False)
    assert s2.status_code == 302
    cb2 = client.get("/auth/oidc/partner/callback", follow_redirects=False)
    assert cb2.status_code == 303
    assert cb2.headers["location"] == "/my"
    me2 = client.get("/api/auth/me").json()
    assert me2["authenticated"] is True
    assert me2["admin"] is False
    assert me2["oidc_provider_slug"] == "partner"
    assert client.get("/api/overview").status_code == 403
    lo2 = client.post("/api/auth/logout").json()
    assert lo2["logout_url"].startswith("https://sso.partner.org/logout?")
    assert "client_id=partner-client" in lo2["logout_url"]

    # 4) Auth policy toggle disables local user login while keeping Admin Token fallback active
    pol_res = client.put(
        "/api/auth/policy",
        headers=admin_headers,
        json={"allow_local_user_login": False},
    )
    assert pol_res.status_code == 200
    assert pol_res.json()["allow_local_user_login"] is False
    assert client.post(
        "/api/auth/login",
        json={"email": "local@corp.com", "password": "local-password-1", "mode": "user"},
    ).status_code == 403
    admin_fallback = client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "token": "test-admin-token", "mode": "admin"},
    )
    assert admin_fallback.status_code == 200
    assert admin_fallback.json()["admin"] is True
    assert client.post("/api/auth/logout").json()["logout_url"] is None

    # 5) Disabling a provider removes it from /api/auth/me and blocks its start route
    assert client.patch(
        f"/api/oidc-providers/{partner_id}",
        headers=admin_headers,
        json={"enabled": False},
    ).status_code == 200
    assert [p["slug"] for p in client.get("/api/auth/me").json()["oidc_providers"]] == ["keycloak"]
    disabled_start = client.get("/auth/oidc/partner/start", follow_redirects=False)
    assert disabled_start.status_code == 303
    assert disabled_start.headers["location"] == "/login?error=oidc_provider_disabled"

    # 6) Discovery test endpoint validates remote discovery JSON
    async def fake_probe(issuer_url, discovery_url=None):
        if "broken" in (issuer_url or ""):
            return {"ok": False, "discovery_url": f"{issuer_url}/.well-known/openid-configuration", "detail": "unreachable"}
        return {
            "ok": True,
            "discovery_url": f"{issuer_url}/.well-known/openid-configuration",
            "issuer": issuer_url,
            "authorization_endpoint": f"{issuer_url}/auth",
            "token_endpoint": f"{issuer_url}/token",
            "end_session_endpoint": f"{issuer_url}/logout",
            "supports_logout": True,
            "detail": "ok",
        }

    monkeypatch.setattr(main_mod, "probe_oidc_discovery", fake_probe)
    ok_test = client.post(
        "/api/oidc-providers/test",
        headers=admin_headers,
        json={"issuer_url": "https://kc.corp.com/realms/main"},
    )
    assert ok_test.status_code == 200
    assert ok_test.json()["ok"] is True
    assert ok_test.json()["supports_logout"] is True

    bad_test = client.post(
        "/api/oidc-providers/test",
        headers=admin_headers,
        json={"issuer_url": "https://broken.example.com"},
    )
    assert bad_test.status_code == 200
    assert bad_test.json()["ok"] is False

    # Delete provider cleans up cleanly
    assert client.delete(f"/api/oidc-providers/{partner_id}", headers=admin_headers).status_code == 200
    assert [p["slug"] for p in client.get("/api/oidc-providers", headers=admin_headers).json()] == ["keycloak"]
    _ = oidc_mod


def test_plugin_reinstall_disk_stats_backup_restore_and_auto_wake(api_env):
    import io
    import tarfile

    client, fake_docker, _registry = api_env
    admin_headers = {
        "Authorization": "Bearer test-admin-token",
        "X-Admin-Email": "admin@example.com",
    }

    sbx_res = client.post(
        "/api/sandboxes",
        headers=admin_headers,
        json={
            "email": "alice@example.com",
            "initial_password": "alice-password-123",
            "auto_sleep_exempt": True,
        },
    )
    assert sbx_res.status_code == 201
    sbx_data = sbx_res.json()
    sbx_id = sbx_data["id"]
    assert sbx_data["auto_sleep_exempt"] is True

    # Idle sleep policy default OFF, can be updated by admin
    policy = client.get("/api/policies/idle-sleep", headers=admin_headers)
    assert policy.status_code == 200 and policy.json()["enabled"] is False
    updated_policy = client.put(
        "/api/policies/idle-sleep",
        headers=admin_headers,
        json={"enabled": True, "idle_minutes": 90},
    )
    assert updated_policy.status_code == 200
    assert updated_policy.json() == {"enabled": True, "idle_minutes": 90}
    ov = client.get("/api/overview", headers=admin_headers).json()
    assert ov["idle_sleep_enabled"] is True and ov["idle_sleep_minutes"] == 90

    # Patch auto_sleep_exempt without container recreate
    calls_before_patch = len(fake_docker.calls)
    patched = client.patch(
        f"/api/sandboxes/{sbx_id}",
        headers=admin_headers,
        json={"auto_sleep_exempt": False},
    )
    assert patched.status_code == 200
    assert patched.json()["auto_sleep_exempt"] is False
    assert len(fake_docker.calls) == calls_before_patch

    # Stats includes disk metrics and persists disk_usage_mb
    stats = client.get(f"/api/sandboxes/{sbx_id}/stats", headers=admin_headers)
    assert stats.status_code == 200
    assert stats.json()["disk_usage_mb"] == 128.0
    assert client.get(f"/api/sandboxes/{sbx_id}", headers=admin_headers).json()["disk_usage_mb"] == 128.0

    # Plugin reinstall modes
    sync_builtin = client.post(
        "/api/plugins/sync-sandboxes",
        headers=admin_headers,
        json={"mode": "reinstall_builtin", "sandbox_ids": [sbx_id]},
    )
    assert sync_builtin.status_code == 200
    assert sync_builtin.json()["synced"] == 1
    assert ("sync_plugin_market", ("alice", None, True)) in fake_docker.calls

    # Lite backup with exclude_caches=true
    lite = client.get(
        f"/api/sandboxes/{sbx_id}/backup?exclude_caches=true",
        headers=admin_headers,
    )
    assert lite.status_code == 200
    assert 'filename="alice-lite.tar"' in lite.headers["content-disposition"]
    assert ("export_workspace_tar", ("alice", True)) in fake_docker.calls

    # User logs in and restores backup onto own sandbox
    bob_res = client.post(
        "/api/sandboxes",
        headers=admin_headers,
        json={"email": "bob@example.com", "initial_password": "bob-password-123"},
    )
    bob_id = bob_res.json()["id"]

    login = client.post(
        "/api/auth/login",
        json={"email": "alice@example.com", "password": "alice-password-123", "mode": "user"},
    )
    assert login.status_code == 200

    tar_buf = io.BytesIO()
    with tarfile.open(fileobj=tar_buf, mode="w:gz") as tf:
        b = b"restored"
        ti = tarfile.TarInfo("workspace/note.txt")
        ti.size = len(b)
        tf.addfile(ti, io.BytesIO(b))
    tar_buf.seek(0)

    restore_ok = client.post(
        f"/api/my/sandboxes/{sbx_id}/restore",
        files={"file": ("alice-home.tar.gz", tar_buf.getvalue(), "application/gzip")},
        data={"mode": "merge"},
    )
    assert restore_ok.status_code == 200
    assert restore_ok.json()["ok"] is True

    # Cannot restore someone else's sandbox
    restore_forbidden = client.post(
        f"/api/my/sandboxes/{bob_id}/restore",
        files={"file": ("x.tar.gz", tar_buf.getvalue(), "application/gzip")},
        data={"mode": "merge"},
    )
    assert restore_forbidden.status_code == 403

    # Stopped sandbox returns wake HTML and /api/wake/{slug} starts it cleanly
    fake_docker.containers["alice"]["status"] = "exited"
    wake_page = client.get("/s/alice/dsh/", headers={"Accept": "text/html"})
    assert wake_page.status_code == 200 and "正在唤醒休眠工作区" in wake_page.text

    open_wake = client.get(f"/sandboxes/{sbx_id}/open", headers={"Accept": "text/html"}, follow_redirects=False)
    assert open_wake.status_code == 200 and "正在唤醒休眠工作区" in open_wake.text

    woke = client.post("/api/wake/alice")
    assert woke.status_code == 200 and woke.json()["ready"] is True
    assert fake_docker.containers["alice"]["status"] == "running"
    assert client.post("/api/wake/bob").status_code == 403


def test_digital_workforce_branding_role_presets_team_assembly_clone_and_runtime(api_env):
    client, fake_docker, _registry = api_env
    admin_headers = {
        "Authorization": "Bearer test-admin-token",
        "X-Admin-Email": "admin@example.com",
    }

    # 1) Default & custom white-label platform branding (Metis defaults + custom SVG logo/favicon + XSS sanitization)
    b0 = client.get("/api/branding")
    assert b0.status_code == 200
    assert b0.json() == {
        "brand_name_zh": "Metis",
        "brand_name_en": "Metis",
        "brand_logo_svg": "",
        "brand_favicon": "",
        "brand_theme": {
            "mode": "dark",
            "primary": "#6366f1",
            "accent": "#06b6d4",
            "radius": "rounded",
            "font_scale": "comfortable",
            "layout_width": "wide",
        },
    }
    fav_default = client.get("/api/branding/favicon")
    assert fav_default.status_code == 200
    assert "image/svg+xml" in fav_default.headers["content-type"]
    assert "<svg" in fav_default.text

    dirty_svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" onload="alert(1)">'
        '<script>alert(2)</script><circle cx="16" cy="16" r="12" onclick="evil()" fill="#6366f1"/>'
        "</svg>"
    )
    b_upd = client.put(
        "/api/branding",
        headers=admin_headers,
        json={
            "brand_name_zh": "星辰 · 数字员工云",
            "brand_name_en": "StarWork Cloud",
            "brand_logo_svg": dirty_svg,
            "brand_favicon": dirty_svg,
            "brand_theme": {
                "mode": "light",
                "primary": "#2563eb",
                "accent": "#0891b2",
                "radius": "md",
                "font_scale": "large",
                "layout_width": "full",
            },
        },
    )
    assert b_upd.status_code == 200
    b_data = b_upd.json()
    assert b_data["brand_name_zh"] == "星辰 · 数字员工云"
    assert b_data["brand_theme"]["mode"] == "light"
    assert b_data["brand_theme"]["primary"] == "#2563eb"
    assert b_data["brand_theme"]["font_scale"] == "large"
    assert "<circle" in b_data["brand_logo_svg"]
    assert "<script" not in b_data["brand_logo_svg"]
    assert "onload" not in b_data["brand_logo_svg"]
    assert "onclick" not in b_data["brand_logo_svg"]
    assert client.get("/api/auth/me").json()["brand_name_zh"] == "星辰 · 数字员工云"
    assert client.get("/api/overview", headers=admin_headers).json()["brand_name_en"] == "StarWork Cloud"

    fav_custom = client.get("/api/branding/favicon")
    assert fav_custom.status_code == 200 and "<circle" in fav_custom.text and "<script" not in fav_custom.text

    # Invalid non-SVG logo or invalid theme hex color rejected with 400
    bad_logo = client.put(
        "/api/branding",
        headers=admin_headers,
        json={
            "brand_name_zh": "星辰",
            "brand_name_en": "Star",
            "brand_logo_svg": "<div>not an svg</div>",
        },
    )
    assert bad_logo.status_code == 400

    bad_color = client.put(
        "/api/branding",
        headers=admin_headers,
        json={
            "brand_name_zh": "星辰",
            "brand_name_en": "Star",
            "brand_theme": {"primary": "not-a-hex"},
        },
    )
    assert bad_color.status_code == 400

    # 2) All-company role template presets (8 R&D + 6 Corporate/Business = 14) & 1-click seeding
    presets = client.get("/api/templates/presets", headers=admin_headers)
    assert presets.status_code == 200
    assert len(presets.json()["items"]) == 14

    seed_res = client.post("/api/templates/seed-presets", headers=admin_headers)
    assert seed_res.status_code == 200
    assert len(seed_res.json()) >= 14

    templates = client.get("/api/templates", headers=admin_headers).json()
    lead_tpl = next(t for t in templates if t["key"] == "tech-lead")
    assert lead_tpl["role_title"] == "系统架构师 & Tech Lead"
    assert "担任架构师与技术统筹主持人" in (lead_tpl["role_sop"] or "")
    legal_tpl = next(t for t in templates if t["key"] == "legal-counsel")
    assert legal_tpl["role_title"] == "法务与合规审查专员"
    finance_tpl = next(t for t in templates if t["key"] == "finance-analyst")
    assert finance_tpl["role_title"] == "财务与经营分析专员"

    # 3) Hire a digital employee from the tech-lead role template -> inherits role & syncs profile
    lead_res = client.post(
        "/api/sandboxes",
        headers=admin_headers,
        json={
            "email": "lead@example.com",
            "display_name": "Tech Lead",
            "slug": "lead",
            "template": "tech-lead",
            "initial_password": "lead-password-123",
        },
    )
    assert lead_res.status_code == 201
    lead_data = lead_res.json()
    lead_id = lead_data["id"]
    assert lead_data["role_title"] == "系统架构师 & Tech Lead"
    assert "担任架构师与技术统筹主持人" in (lead_data["role_sop"] or "")
    assert any(c[0] == "sync_role_profile" and c[1][0] == "lead" for c in fake_docker.calls)

    # Update role persona without container recreation
    patched_lead = client.patch(
        f"/api/sandboxes/{lead_id}",
        headers=admin_headers,
        json={
            "role_title": "首席架构师 & Tech Lead",
            "role_description": "负责核心架构与代码评审",
        },
    )
    assert patched_lead.status_code == 200
    assert patched_lead.json()["role_title"] == "首席架构师 & Tech Lead"

    # 4) Clone the digital employee (including workspace files & role persona)
    clone_res = client.post(
        f"/api/sandboxes/{lead_id}/clone",
        headers=admin_headers,
        json={
            "email": "fullstack@example.com",
            "display_name": "Fullstack Eng",
            "slug": "fullstack",
            "copy_workspace": True,
        },
    )
    assert clone_res.status_code == 201
    clone_data = clone_res.json()
    clone_id = clone_data["id"]
    assert clone_data["slug"] == "fullstack"
    assert clone_data["role_title"] == "首席架构师 & Tech Lead"
    assert ("export_workspace_tar", ("lead", True)) in fake_docker.calls
    assert any(c[0] == "restore_workspace_tar" and c[1][0] == "fullstack" for c in fake_docker.calls)

    # 5) 1-Click Project Team Assembly
    team_res = client.post(
        "/api/teams/assemble",
        headers=admin_headers,
        json={
            "name": "核心支付攻坚组",
            "description": "完成支付网关与自动化回归验证",
            "member_ids": [lead_id, clone_id],
            "moderator_id": lead_id,
        },
    )
    assert team_res.status_code == 200
    assert team_res.json()["ok"] is True
    assert team_res.json()["room_name"] == "核心支付攻坚组"
    assert team_res.json()["paired_members"] == 2

    # 6) Workforce Runtime & Delivery Center + User Service Control
    wf_admin = client.get(f"/api/sandboxes/{lead_id}/workforce", headers=admin_headers)
    assert wf_admin.status_code == 200
    assert wf_admin.json()["online"] is True
    assert "/s/lead/apps/web/" in wf_admin.json()["exposed_apps"][0]["url"]

    svc_admin = client.post(
        f"/api/sandboxes/{lead_id}/services/dev-server/restart",
        headers=admin_headers,
    )
    assert svc_admin.status_code == 200
    assert svc_admin.json()["ok"] is True

    # User Portal (/my) workforce inspection & service control with tenant isolation
    assert client.post(
        "/api/auth/login",
        json={"email": "lead@example.com", "password": "lead-password-123", "mode": "user"},
    ).status_code == 200

    wf_my = client.get(f"/api/my/sandboxes/{lead_id}/workforce")
    assert wf_my.status_code == 200
    assert wf_my.json()["online"] is True

    svc_my = client.post(f"/api/my/sandboxes/{lead_id}/services/dev-server/restart")
    assert svc_my.status_code == 200

    # Forbidden on another user's digital employee
    assert client.get(f"/api/my/sandboxes/{clone_id}/workforce").status_code == 403
    assert client.post(f"/api/my/sandboxes/{clone_id}/services/dev-server/stop").status_code == 403


def test_enterprise_full_lifecycle_tasks_approvals_webhooks_vault_preview_auth_and_snapshots(
    api_env,
):
    client, fake_docker, _registry = api_env
    admin_headers = {
        "Authorization": "Bearer test-admin-token",
        "X-Admin-Email": "admin@example.com",
    }

    # Provision two digital employees
    emp_a_res = client.post(
        "/api/sandboxes",
        headers=admin_headers,
        json={
            "email": "alice@example.com",
            "slug": "alice-eng",
            "initial_password": "alice-password-123",
            "preview_auth_mode": "public",
            "daily_token_limit": 250000,
        },
    )
    assert emp_a_res.status_code == 201
    emp_a = emp_a_res.json()
    emp_a_id = emp_a["id"]
    assert emp_a["preview_auth_mode"] == "public"
    assert emp_a["daily_token_limit"] == 250000
    assert emp_a["has_webhook_token"] is True
    assert emp_a["webhook_url"] and "/api/webhooks/sandboxes/alice-eng?token=" in emp_a["webhook_url"]

    emp_b_res = client.post(
        "/api/sandboxes",
        headers=admin_headers,
        json={
            "email": "bob@example.com",
            "slug": "bob-qa",
            "initial_password": "bob-password-123",
        },
    )
    assert emp_b_res.status_code == 201
    emp_b_id = emp_b_res.json()["id"]

    # 1) Shared project file sync (/home/workspace/shared/PROJECT_BRIEF.md)
    sync_shared = client.post(
        "/api/teams/sync-shared",
        headers=admin_headers,
        json={
            "team_name": "支付核心组",
            "sandbox_ids": [emp_a_id, emp_b_id],
            "file_name": "PROJECT_BRIEF.md",
            "content": "# 支付核心组\n\n完成对账与自动化测试。\n",
        },
    )
    assert sync_shared.status_code == 200
    assert sync_shared.json()["ok"] is True
    assert sync_shared.json()["synced"] == 2

    # 2) Task dispatch & Human approval decision (admin + tenant isolation for users)
    task_res = client.post(
        f"/api/sandboxes/{emp_a_id}/tasks",
        headers=admin_headers,
        json={
            "title": "实现 Webhook 自动触发",
            "description": "接入 GitHub PR 事件并自动跑单测",
            "priority": "high",
            "approval_required": True,
        },
    )
    assert task_res.status_code == 200
    assert task_res.json()["ok"] is True

    appr_res = client.post(
        f"/api/sandboxes/{emp_a_id}/approvals/task-999",
        headers=admin_headers,
        json={"decision": "approved", "note": "LGTM"},
    )
    assert appr_res.status_code == 200
    assert appr_res.json()["decision"] == "approved"

    # 3) Inbound Event Webhook: bad token -> 401; valid token -> auto-wake + dispatch; rotate invalidates old
    bad_wh = client.post(
        "/api/webhooks/sandboxes/alice-eng?token=wrong-token",
        json={"source": "github", "event": "pull_request", "title": "Review PR #42"},
    )
    assert bad_wh.status_code == 401

    old_token = emp_a["webhook_url"].split("token=", 1)[1]
    fake_docker.containers["alice-eng"]["status"] = "exited"
    ok_wh = client.post(
        "/api/webhooks/sandboxes/alice-eng",
        headers={"X-Webhook-Token": old_token},
        json={
            "source": "github",
            "event": "pull_request",
            "title": "Review PR #42",
            "wake_if_sleeping": True,
        },
    )
    assert ok_wh.status_code == 200
    assert ok_wh.json()["ok"] is True
    assert fake_docker.containers["alice-eng"]["status"] == "running"

    rotated = client.patch(
        f"/api/sandboxes/{emp_a_id}",
        headers=admin_headers,
        json={"rotate_webhook_token": True},
    )
    assert rotated.status_code == 200
    new_token = rotated.json()["webhook_url"].split("token=", 1)[1]
    assert new_token != old_token
    assert (
        client.post(
            f"/api/webhooks/sandboxes/alice-eng?token={old_token}",
            json={"title": "Should fail"},
        ).status_code
        == 401
    )
    assert (
        client.post(
            f"/api/webhooks/sandboxes/alice-eng?token={new_token}",
            json={"title": "Should succeed"},
        ).status_code
        == 200
    )

    # 4) Online Preview App Expose/Unexpose, Service CRUD+Logs, Cron CRUD
    exp_res = client.post(
        f"/api/sandboxes/{emp_a_id}/apps",
        headers=admin_headers,
        json={"name": "preview-web", "port": 5173},
    )
    assert exp_res.status_code == 200 and exp_res.json()["ok"] is True
    assert (
        client.delete(
            f"/api/sandboxes/{emp_a_id}/apps/preview-web", headers=admin_headers
        ).status_code
        == 200
    )

    svc_add = client.post(
        f"/api/sandboxes/{emp_a_id}/services",
        headers=admin_headers,
        json={"name": "api-dev", "command": "uvicorn app:app --port 8000"},
    )
    assert svc_add.status_code == 200 and svc_add.json()["ok"] is True
    svc_logs = client.get(
        f"/api/sandboxes/{emp_a_id}/services/api-dev/logs?tail=80",
        headers=admin_headers,
    )
    assert svc_logs.status_code == 200 and "api-dev" in svc_logs.json()["logs"]
    assert (
        client.delete(
            f"/api/sandboxes/{emp_a_id}/services/api-dev", headers=admin_headers
        ).status_code
        == 200
    )

    cron_add = client.post(
        f"/api/sandboxes/{emp_a_id}/cron",
        headers=admin_headers,
        json={"schedule": "0 9 * * *", "command": "/home/workspace/daily.sh"},
    )
    assert cron_add.status_code == 200 and cron_add.json()["ok"] is True
    assert (
        client.delete(
            f"/api/sandboxes/{emp_a_id}/cron?raw=0%209%20*%20*%20*%20/home/workspace/daily.sh",
            headers=admin_headers,
        ).status_code
        == 200
    )

    # 5) Preview Access Mode governance: public vs authenticated
    # Anonymous user can access /s/alice-eng/apps/web/ while preview_auth_mode == "public"
    pub_verify = client.get(
        "/api/auth/verify-sandbox/alice-eng",
        headers={"X-Forwarded-Uri": "/s/alice-eng/apps/web/"},
        follow_redirects=False,
    )
    assert pub_verify.status_code == 200

    # Switch to authenticated -> anonymous access to /apps/ must be rejected
    switch_auth = client.patch(
        f"/api/sandboxes/{emp_a_id}",
        headers=admin_headers,
        json={"preview_auth_mode": "authenticated", "daily_token_limit": 500000},
    )
    assert switch_auth.status_code == 200
    assert switch_auth.json()["preview_auth_mode"] == "authenticated"
    assert switch_auth.json()["daily_token_limit"] == 500000

    priv_verify = client.get(
        "/api/auth/verify-sandbox/alice-eng",
        headers={"X-Forwarded-Uri": "/s/alice-eng/apps/web/"},
        follow_redirects=False,
    )
    assert priv_verify.status_code in {302, 401}

    # 6) Enterprise Credentials & MCP Vault CRUD + hot-push (no secret leakage)
    cred_create = client.post(
        "/api/credential-profiles",
        headers=admin_headers,
        json={
            "name": "Core R&D Vault",
            "git_user_name": "Digital Bot",
            "git_user_email": "bot@corp.com",
            "git_host": "github.com",
            "git_token": "ghp_super_secret_token",
            "ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\nSECRET\n-----END OPENSSH PRIVATE KEY-----",
            "env_vars_json": '{"NPM_TOKEN":"npm_123"}',
            "mcp_servers_json": '{"github":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}}',
        },
    )
    assert cred_create.status_code == 201
    cred_data = cred_create.json()
    cred_id = cred_data["id"]
    assert cred_data["has_git_token"] is True
    assert cred_data["has_ssh_key"] is True
    assert cred_data["has_env_vars"] is True
    assert "ghp_super_secret_token" not in str(cred_data)
    assert "BEGIN OPENSSH" not in str(cred_data)

    cred_list = client.get("/api/credential-profiles", headers=admin_headers)
    assert cred_list.status_code == 200 and len(cred_list.json()) == 1

    cred_patch = client.patch(
        f"/api/credential-profiles/{cred_id}",
        headers=admin_headers,
        json={"git_host": "gitlab.corp.com"},
    )
    assert cred_patch.status_code == 200 and cred_patch.json()["git_host"] == "gitlab.corp.com"

    cred_push = client.post(
        f"/api/credential-profiles/{cred_id}/push",
        headers=admin_headers,
        json={"sandbox_ids": [emp_a_id, emp_b_id]},
    )
    assert cred_push.status_code == 200
    assert cred_push.json()["synced"] == 2
    assert any(
        c[0] == "sync_credential_profile" and c[1] == ("alice-eng", "Digital Bot", "gitlab.corp.com")
        for c in fake_docker.calls
    )

    assert (
        client.delete(
            f"/api/credential-profiles/{cred_id}", headers=admin_headers
        ).status_code
        == 200
    )

    # 7) Server-Side Workspace Snapshots Center + User Portal tenant isolation
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "alice@example.com", "password": "alice-password-123", "mode": "user"},
        ).status_code
        == 200
    )

    snap_create = client.post(
        f"/api/my/sandboxes/{emp_a_id}/snapshots",
        json={"name": "v1.0 上线前快照", "note": "release checkpoint", "exclude_caches": True},
    )
    assert snap_create.status_code == 201
    snap_id = snap_create.json()["id"]
    assert snap_create.json()["name"] == "v1.0 上线前快照"

    snap_list = client.get(f"/api/my/sandboxes/{emp_a_id}/snapshots")
    assert snap_list.status_code == 200 and len(snap_list.json()) == 1

    snap_restore = client.post(
        f"/api/my/sandboxes/{emp_a_id}/snapshots/{snap_id}/restore?mode=merge"
    )
    assert snap_restore.status_code == 200 and snap_restore.json()["ok"] is True

    # Cross-user isolation on snapshots, tasks, approvals, apps, services, cron
    assert client.get(f"/api/my/sandboxes/{emp_b_id}/snapshots").status_code == 403
    assert (
        client.post(
            f"/api/my/sandboxes/{emp_b_id}/tasks", json={"title": "Unauthorized"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/my/sandboxes/{emp_b_id}/approvals/t1", json={"decision": "approved"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/my/sandboxes/{emp_b_id}/apps", json={"name": "x", "port": 3000}
        ).status_code
        == 403
    )

    # Owner deletes snapshot cleanly
    assert (
        client.delete(f"/api/my/sandboxes/{emp_a_id}/snapshots/{snap_id}").status_code
        == 200
    )
    assert client.get(f"/api/my/sandboxes/{emp_a_id}/snapshots").json() == []


