from __future__ import annotations

import hashlib
import hmac
import json
import time

import httpx
import pytest
from sqlalchemy import select

from app.config import Settings
from app.db import SessionLocal
from app.docker_service import DockerService
from app.models import LlmProfile, LlmUsageLedger, NotificationDelivery, Sandbox, User
from app.routers import llm_gateway as llm_gateway_router
from app.services.integrations import sign_approval_token, verify_approval_token


def _login_admin(client) -> None:
    client.post("/api/auth/logout")
    res = client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "token": "test-admin-token", "mode": "admin"},
    )
    assert res.status_code == 200, res.text


def _create_user_and_login(client, email: str, password: str = "Pass1234!", display_name: str = "User") -> None:
    _login_admin(client)
    res = client.post(
        "/api/users",
        json={"email": email, "display_name": display_name, "password": password},
    )
    assert res.status_code in (200, 201), res.text
    client.post("/api/auth/logout")
    login_res = client.post(
        "/api/auth/login",
        json={"email": email, "password": password, "mode": "user"},
    )
    assert login_res.status_code == 200, login_res.text


def _login_user(client, email: str, password: str = "Pass1234!") -> None:
    client.post("/api/auth/logout")
    res = client.post(
        "/api/auth/login",
        json={"email": email, "password": password, "mode": "user"},
    )
    assert res.status_code == 200, res.text


def test_runtime_environment_uses_metis_gateway_when_enabled():
    settings = Settings(
        secret_key="x" * 32,
        manager_public_url="https://metis.corp.com",
        manager_internal_url="http://dsh-manager:8000",
    )
    svc = DockerService.__new__(DockerService)
    svc.settings = settings

    user = User(email="alice@corp.com", display_name="Alice")
    prof_gw = LlmProfile(
        id="prof-gw-1",
        name="DeepSeek GW",
        api_protocol="openai-completions",
        base_url="https://api.deepseek.com/v1",
        model="deepseek-chat",
        gateway_enabled=True,
        api_key_ciphertext=None,
    )
    from app.security import encrypt_secret

    prof_gw.api_key_ciphertext = encrypt_secret("sk-real-upstream-secret-999")
    sbx = Sandbox(
        user=user,
        slug="alice",
        volume_name="dsh-vol-alice",
        image_repo="dsh-sandbox",
        image_tag="latest",
        template="agent-os",
        llm_profile=prof_gw,
        gateway_api_key="sk-metis-virtual-12345",
        cpu_limit=2.0,
        memory_limit="4g",
    )

    env = svc.environment(sbx)
    assert env["DSH_DEFAULT_LLM_API_KEY"] == "sk-metis-virtual-12345"
    assert env["DSH_DEFAULT_LLM_BASE_URL"] == "http://dsh-manager:8000/api/llm-gateway/p/prof-gw-1"
    assert "sk-real-upstream-secret-999" not in json.dumps(env)

    # Disabling gateway restores direct upstream credentials for backwards compatibility
    prof_gw.gateway_enabled = False
    direct_env = svc.environment(sbx)
    assert direct_env["DSH_DEFAULT_LLM_API_KEY"] == "sk-real-upstream-secret-999"
    assert direct_env["DSH_DEFAULT_LLM_BASE_URL"] == "https://api.deepseek.com/v1"


def test_llm_gateway_proxy_metering_budget_circuit_breaker_and_fallback(api_env, monkeypatch):
    client, _fake_docker, _reg = api_env
    _login_admin(client)

    # Create fallback cheap model + primary model with pricing and gateway enabled
    fb_res = client.post(
        "/api/llm-profiles",
        json={
            "name": "Cheap Fallback",
            "api_protocol": "openai-completions",
            "base_url": "https://fallback.example.com/v1",
            "model": "gpt-4o-mini",
            "api_key": "sk-fallback-real",
            "gateway_enabled": True,
            "input_price_per_1m": 0.15,
            "output_price_per_1m": 0.60,
        },
    )
    assert fb_res.status_code == 201, fb_res.text
    fallback_id = fb_res.json()["id"]

    prim_res = client.post(
        "/api/llm-profiles",
        json={
            "name": "Primary Pro",
            "api_protocol": "openai-completions",
            "base_url": "https://primary.example.com/v1",
            "model": "gpt-4o",
            "api_key": "sk-primary-real",
            "gateway_enabled": True,
            "input_price_per_1m": 2.0,
            "output_price_per_1m": 8.0,
            "fallback_llm_profile_id": fallback_id,
        },
    )
    assert prim_res.status_code == 201, prim_res.text
    primary_id = prim_res.json()["id"]

    # Provision sandbox with daily budget 1000 tokens and block action
    sbx_res = client.post(
        "/api/sandboxes",
        json={
            "email": "finops@corp.com",
            "slug": "finbot",
            "llm_profile_id": primary_id,
            "budget_action": "block",
        },
    )
    assert sbx_res.status_code == 201, sbx_res.text
    sbx_id = sbx_res.json()["id"]
    assert sbx_res.json()["has_gateway_api_key"] is True

    client.patch(
        f"/api/sandboxes/{sbx_id}",
        json={"daily_token_limit": 1000, "budget_action": "block"},
    )

    with SessionLocal() as db:
        sbx = db.get(Sandbox, sbx_id)
        assert sbx is not None and sbx.gateway_api_key
        vkey = sbx.gateway_api_key

    # Create notification channel to capture budget warning & exceeded alerts
    from app.services import notifications as notifications_mod

    sent_alerts: list[str] = []

    class _FakeNotifClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, url, **kwargs):
            sent_alerts.append(str(kwargs.get("content") or kwargs.get("json") or ""))
            return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(notifications_mod.httpx, "Client", _FakeNotifClient)
    ch_res = client.post(
        "/api/notification-channels",
        json={
            "name": "Budget Webhook",
            "channel_type": "webhook",
            "webhook_url": "https://alerts.example.com/hook",
            "events": ["budget.warning", "budget.exceeded"],
        },
    )
    assert ch_res.status_code in (200, 201), ch_res.text

    # Mock upstream httpx.AsyncClient
    recorded_upstream: list[dict] = []

    class _FakeStreamResp:
        status_code = 200
        headers = {"content-type": "text/event-stream"}

        async def aiter_bytes(self):
            yield b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'
            yield b'data: {"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\n'
            yield b"data: [DONE]\n\n"

        async def aclose(self):
            return None

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def build_request(self, method, url, **kwargs):
            return {"method": method, "url": url, **kwargs}

        async def send(self, req, stream=False):
            recorded_upstream.append(req)
            return _FakeStreamResp()

        async def request(self, method, url, **kwargs):
            recorded_upstream.append({"method": method, "url": url, **kwargs})
            body = json.loads(kwargs["content"].decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "id": "chatcmpl-1",
                    "model": body.get("model"),
                    "usage": {
                        "prompt_tokens": 500,
                        "completion_tokens": 400,
                        "total_tokens": 900,
                    },
                },
            )

        async def aclose(self):
            return None

    monkeypatch.setattr(llm_gateway_router.httpx, "AsyncClient", _FakeAsyncClient)

    # 1. Missing/invalid virtual key rejected with 401
    bad_auth = client.post(
        f"/api/llm-gateway/p/{primary_id}/chat/completions",
        json={"model": "gpt-4o", "messages": []},
    )
    assert bad_auth.status_code == 401

    # 2. First non-streaming call (900 tokens -> 90% of 1000 budget) succeeds & uses real upstream key
    ok1 = client.post(
        f"/api/llm-gateway/p/{primary_id}/chat/completions",
        headers={"Authorization": f"Bearer {vkey}"},
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hello"}]},
    )
    assert ok1.status_code == 200
    assert recorded_upstream[-1]["url"] == "https://primary.example.com/v1/chat/completions"
    assert recorded_upstream[-1]["headers"]["Authorization"] == "Bearer sk-primary-real"

    # 3. Second call (SSE streaming, while used=900 >= 80% warning) triggers 80% budget warning & streams 150 tokens (total=1050)
    ok2 = client.post(
        f"/api/llm-gateway/p/{primary_id}/chat/completions",
        headers={"Authorization": f"Bearer {vkey}"},
        json={"model": "gpt-4o", "stream": True, "messages": [{"role": "user", "content": "stream"}]},
    )
    assert ok2.status_code == 200
    assert "data: [DONE]" in ok2.text

    # 4. Third call hits 1050 >= 1000 with budget_action='block' -> HTTP 429 hard circuit breaker!
    blocked = client.post(
        f"/api/llm-gateway/p/{primary_id}/chat/completions",
        headers={"Authorization": f"Bearer {vkey}"},
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "blocked"}]},
    )
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "daily_token_limit_exceeded"

    # 5. Switch sandbox budget_action to 'downgrade' -> routes transparently to fallback model & rewrites model!
    client.patch(f"/api/sandboxes/{sbx_id}", json={"budget_action": "downgrade"})
    downgraded = client.post(
        f"/api/llm-gateway/p/{primary_id}/chat/completions",
        headers={"Authorization": f"Bearer {vkey}"},
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "fallback please"}]},
    )
    assert downgraded.status_code == 200
    assert recorded_upstream[-1]["url"] == "https://fallback.example.com/v1/chat/completions"
    assert recorded_upstream[-1]["headers"]["Authorization"] == "Bearer sk-fallback-real"
    sent_payload = json.loads(recorded_upstream[-1]["content"].decode("utf-8"))
    assert sent_payload["model"] == "gpt-4o-mini"

    # 6. Verify FinOps summary ledger & USD calculations
    fin_res = client.get("/api/finops/summary?days=7")
    assert fin_res.status_code == 200
    fin = fin_res.json()
    assert fin["today"]["tokens"] == 900 + 150 + 900
    assert fin["today"]["requests"] == 3
    assert fin["period"]["fallback_requests"] == 1
    assert fin["today"]["cost"] > 0
    assert len(fin["by_model"]) == 2

    with SessionLocal() as db:
        deliveries = list(db.scalars(select(NotificationDelivery)).all())
        ev_types = {d.event_type for d in deliveries}
        assert "budget.warning" in ev_types
        assert "budget.exceeded" in ev_types

    # 7. Pre-M2 legacy sandbox with gateway_api_key=None gets auto-backfilled on push!
    with SessionLocal() as db:
        sbx = db.get(Sandbox, sbx_id)
        sbx.gateway_api_key = None
        db.commit()
    push_res = client.post(
        f"/api/llm-profiles/{primary_id}/push",
        json={"sandbox_ids": [sbx_id], "set_as_default": True},
    )
    assert push_res.status_code == 200
    with SessionLocal() as db:
        sbx = db.get(Sandbox, sbx_id)
        assert sbx is not None and sbx.gateway_api_key and sbx.gateway_api_key.startswith("sk-metis-")


def test_teams_team_lead_rbac_hiring_and_shared_employee_intake(api_env):
    client, fake_docker, _reg = api_env

    # Create 3 users: Team Lead, Regular Team Member, Outsider
    _create_user_and_login(client, "lead@corp.com", display_name="Team Lead")
    _create_user_and_login(client, "member@corp.com", display_name="Team Member")
    _create_user_and_login(client, "outsider@corp.com", display_name="Outsider")
    _create_user_and_login(client, "maint@corp.com", display_name="Maintainer")

    # Admin creates two teams and a shared employee attached to Team Alpha
    _login_admin(client)
    t_alpha = client.post(
        "/api/teams",
        json={
            "name": "Alpha Growth",
            "department": "Growth",
            "daily_token_budget": 1000000,
            "lead_emails": ["lead@corp.com"],
            "member_emails": ["member@corp.com"],
        },
    )
    assert t_alpha.status_code == 201, t_alpha.text
    alpha_id = t_alpha.json()["id"]

    t_beta = client.post("/api/teams", json={"name": "Beta Infra", "department": "Infra"})
    assert t_beta.status_code == 201
    beta_id = t_beta.json()["id"]

    shared_res = client.post(
        "/api/sandboxes",
        json={
            "email": "admin@example.com",
            "slug": "shared-qa",
            "ownership_mode": "shared",
            "maintainer_emails": ["maint@corp.com"],
            "team_ids": [alpha_id],
            "preview_auth_mode": "team",
        },
    )
    assert shared_res.status_code == 201, shared_res.text
    shared_id = shared_res.json()["id"]

    # 1. Verify Team Lead auth summary, own-team management, cross-team 403, and FinOps scoping
    _login_user(client, "lead@corp.com")
    me = client.get("/api/auth/me").json()
    assert me["is_team_lead"] is True
    assert alpha_id in me["lead_team_ids"]

    # Team Lead can sync shared doc to Alpha, cannot manage Beta
    sync_ok = client.post(
        f"/api/teams/{alpha_id}/shared-docs",
        json={"file_name": "HANDBOOK.md", "content": "# Alpha Rules"},
    )
    assert sync_ok.status_code == 200
    assert sync_ok.json()["synced"] == 1

    beta_forbid = client.post(
        f"/api/teams/{beta_id}/members",
        json={"email": "outsider@corp.com", "role": "member"},
    )
    assert beta_forbid.status_code == 403

    # Team Lead CAN open FinOps summary for Alpha, NOT for Beta
    assert client.get(f"/api/finops/summary?team_id={alpha_id}").status_code == 200
    assert client.get(f"/api/finops/summary?team_id={beta_id}").status_code == 403

    # Team Lead CAN open shared employee's full DSH IDE
    assert (
        client.get(
            "/api/auth/verify-sandbox/shared-qa",
            headers={"X-Forwarded-Uri": "/s/shared-qa/dsh/"},
        ).status_code
        == 200
    )

    # 2. Verify Designated Maintainer CAN open shared employee's DSH IDE
    _login_user(client, "maint@corp.com")
    assert (
        client.get(
            "/api/auth/verify-sandbox/shared-qa",
            headers={"X-Forwarded-Uri": "/s/shared-qa/dsh/"},
        ).status_code
        == 200
    )

    # 3. Verify Regular Team Member layered access + attachments intake + self-service hiring request
    _login_user(client, "member@corp.com")
    assert client.get("/api/finops/summary").status_code == 403

    my_list = client.get("/api/my/sandboxes").json()["items"]
    assert len(my_list) == 1
    assert my_list[0]["slug"] == "shared-qa"
    assert my_list[0]["ownership_mode"] == "shared"
    assert my_list[0]["can_open_ide"] is False

    # Regular member gets 403 on DSH IDE, but 200 on team-only preview app!
    ide_deny = client.get(
        "/api/auth/verify-sandbox/shared-qa",
        headers={"X-Forwarded-Uri": "/s/shared-qa/dsh/"},
    )
    assert ide_deny.status_code == 403
    app_allow = client.get(
        "/api/auth/verify-sandbox/shared-qa",
        headers={"X-Forwarded-Uri": "/s/shared-qa/apps/web/"},
    )
    assert app_allow.status_code == 200

    # Regular member submits structured task with file attachment to shared employee!
    intake_res = client.post(
        f"/api/workspace/sandboxes/{shared_id}/intake",
        data={
            "title": "Review Q3 report",
            "description": "Please check KPI numbers in attached CSV.",
            "priority": "high",
            "approval_required": "true",
        },
        files=[("files", ("q3_metrics.csv", b"metric,value\nrev,100\n", "text/csv"))],
    )
    assert intake_res.status_code == 200, intake_res.text
    intake_body = intake_res.json()
    assert intake_body["ok"] is True
    assert len(intake_body["uploaded_files"]) == 1
    assert intake_body["uploaded_files"][0].endswith("/q3_metrics.csv")
    assert any(c[0] == "write_intake_files" for c in fake_docker.calls)

    # Regular member browses template catalog & submits self-service hiring request
    tpls = client.get("/api/workspace/templates")
    assert tpls.status_code == 200
    assert len(tpls.json()) >= 1
    tpl_key = tpls.json()[0]["key"]

    hire_res = client.post(
        "/api/provision-requests",
        json={
            "template_key": tpl_key,
            "team_id": alpha_id,
            "ownership_mode": "personal",
            "desired_slug": "member-helper",
            "role_title": "QA Copilot",
            "reason": "Automate regression suite",
        },
    )
    assert hire_res.status_code == 201, hire_res.text
    req_id = hire_res.json()["id"]

    # Outsider cannot access team preview or shared intake
    _login_user(client, "outsider@corp.com")
    assert (
        client.get(
            "/api/auth/verify-sandbox/shared-qa",
            headers={"X-Forwarded-Uri": "/s/shared-qa/apps/web/"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/workspace/sandboxes/{shared_id}/intake",
            data={"title": "Unauthorized"},
        ).status_code
        == 403
    )

    # 4. Team Lead approves member's hiring request -> sandbox automatically provisioned & attached to Alpha!
    _login_user(client, "lead@corp.com")
    decide = client.post(
        f"/api/provision-requests/{req_id}/decide",
        json={"decision": "approved", "note": "Approved by team lead"},
    )
    assert decide.status_code == 200, decide.text
    decided_body = decide.json()
    assert decided_body["status"] == "approved"
    assert decided_body["provisioned_slug"] == "member-helper"
    assert decided_body["provisioned_sandbox_id"] is not None

    # Regression check: approving a hiring request MUST NOT overwrite requester's User.display_name or other sandboxes!
    _login_user(client, "member@corp.com")
    member_me = client.get("/api/auth/me").json()
    assert member_me["display_name"] == "Team Member"
    member_sandboxes = {s["slug"]: s for s in client.get("/api/my/sandboxes").json()["items"]}
    assert member_sandboxes["member-helper"]["display_name"] == "QA Copilot"
    assert member_sandboxes["shared-qa"]["display_name"] != "QA Copilot"


def test_im_signed_approval_callbacks_and_native_git_webhooks(api_env):
    client, fake_docker, _reg = api_env
    _login_admin(client)

    sbx_res = client.post("/api/sandboxes", json={"email": "dev@corp.com", "slug": "devbot"})
    assert sbx_res.status_code == 201
    sbx_id = sbx_res.json()["id"]

    with SessionLocal() as db:
        sbx = db.get(Sandbox, sbx_id)
        assert sbx is not None and sbx.webhook_token
        wh_secret = sbx.webhook_token

    secret = "test-secret-key-for-pytest-32-chars-minimum"
    tok = sign_approval_token(secret, sandbox_id=sbx_id, task_id="task_99", room_id="grp_1")
    claims = verify_approval_token(secret, tok)
    assert claims == {"sandbox_id": sbx_id, "task_id": "task_99", "room_id": "grp_1"}

    # Tampered token rejected
    with pytest.raises(ValueError):
        verify_approval_token(secret, tok + "tamper")

    # 1. GET safe confirmation page & POST signed approval action
    confirm_page = client.get(f"/api/integrations/approvals/action?token={tok}&decision=approved")
    assert confirm_page.status_code == 200
    assert "task_99" in confirm_page.text

    exec_res = client.post(
        "/api/integrations/approvals/action",
        data={"token": tok, "decision": "approved", "note": "LGTM from WeCom"},
    )
    assert exec_res.status_code == 200
    assert exec_res.json()["decision"] == "approved"
    assert any(
        c[0] == "decide_mesh_approval" and c[1][1] == "task_99" and c[1][2] == "approved"
        for c in fake_docker.calls
    )

    # 2. Feishu interactive card callback: URL challenge + direct reject
    challenge = client.post(
        "/api/integrations/feishu/card-callback",
        json={"challenge": "feishu-verify-123"},
    )
    assert challenge.status_code == 200
    assert challenge.json() == {"challenge": "feishu-verify-123"}

    card_res = client.post(
        "/api/integrations/feishu/card-callback",
        json={
            "open_id": "ou_abc123",
            "action": {"value": {"token": tok, "decision": "rejected", "note": "Hold release"}},
        },
    )
    assert card_res.status_code == 200
    assert card_res.json()["toast"]["type"] == "success"
    assert any(
        c[0] == "decide_mesh_approval" and c[1][1] == "task_99" and c[1][2] == "rejected"
        for c in fake_docker.calls
    )

    # 3. Native GitHub Webhook with X-Hub-Signature-256 HMAC
    gh_payload = json.dumps(
        {
            "action": "opened",
            "repository": {"full_name": "acme/metis"},
            "issue": {
                "number": 42,
                "title": "Fix login race condition",
                "body": "Repro steps...",
                "html_url": "https://github.com/acme/metis/issues/42",
                "user": {"login": "octocat"},
                "labels": [{"name": "bug"}],
            },
        }
    ).encode("utf-8")
    gh_sig = "sha256=" + hmac.new(wh_secret.encode("utf-8"), gh_payload, hashlib.sha256).hexdigest()

    gh_ok = client.post(
        "/api/webhooks/sandboxes/devbot",
        content=gh_payload,
        headers={
            "Content-Type": "application/json",
            "X-GitHub-Event": "issues",
            "X-Hub-Signature-256": gh_sig,
        },
    )
    assert gh_ok.status_code == 200, gh_ok.text
    assert gh_ok.json()["event"] == "issues.opened"
    assert any(
        c[0] == "dispatch_mesh_task"
        and "[GitHub Issue #42]" in c[1][1]
        and c[1][2] == "high"
        and c[1][3] == "webhook:github"
        for c in fake_docker.calls
    )

    # GitHub workflow_run non-failure is cleanly ignored
    wf_ok_body = json.dumps(
        {"action": "completed", "workflow_run": {"conclusion": "success", "name": "CI"}}
    ).encode("utf-8")
    wf_sig = "sha256=" + hmac.new(wh_secret.encode("utf-8"), wf_ok_body, hashlib.sha256).hexdigest()
    wf_ignored = client.post(
        "/api/webhooks/sandboxes/devbot",
        content=wf_ok_body,
        headers={
            "Content-Type": "application/json",
            "X-GitHub-Event": "workflow_run",
            "X-Hub-Signature-256": wf_sig,
        },
    )
    assert wf_ignored.status_code == 200
    assert wf_ignored.json()["ignored"] is True

    # 4. Native GitLab Webhook with X-Gitlab-Token
    gl_res = client.post(
        "/api/webhooks/sandboxes/devbot",
        headers={"X-Gitlab-Event": "Merge Request Hook", "X-Gitlab-Token": wh_secret},
        json={
            "project": {"path_with_namespace": "acme/core"},
            "user": {"username": "gluser"},
            "object_attributes": {
                "iid": 7,
                "action": "open",
                "title": "Add gateway cache",
                "source_branch": "feat/cache",
                "target_branch": "main",
                "url": "https://gitlab.example.com/acme/core/-/merge_requests/7",
                "description": "Adds LRU cache",
            },
        },
    )
    assert gl_res.status_code == 200, gl_res.text
    assert gl_res.json()["event"] == "merge_request.open"
    assert any(
        c[0] == "dispatch_mesh_task"
        and "[GitLab MR !7]" in c[1][1]
        and c[1][3] == "webhook:gitlab"
        for c in fake_docker.calls
    )


def test_daily_cost_limit_and_team_cost_budget_enforcement(api_env, monkeypatch):
    client, _fake_docker, _reg = api_env
    _login_admin(client)

    fb_res = client.post(
        "/api/llm-profiles",
        json={
            "name": "Economy Fallback",
            "api_protocol": "openai-completions",
            "base_url": "https://fallback.example.com/v1",
            "model": "gpt-4o-mini",
            "api_key": "sk-fb",
            "gateway_enabled": True,
            "input_price_per_1m": 0.1,
            "output_price_per_1m": 0.2,
        },
    )
    assert fb_res.status_code == 201
    fb_id = fb_res.json()["id"]

    # Price: $10/1M input, $20/1M output -> 10k in + 5k out = $0.10 + $0.10 = $0.20/request
    prim_res = client.post(
        "/api/llm-profiles",
        json={
            "name": "Flagship Model",
            "api_protocol": "openai-completions",
            "base_url": "https://primary.example.com/v1",
            "model": "gpt-5",
            "api_key": "sk-prim",
            "gateway_enabled": True,
            "input_price_per_1m": 10.0,
            "output_price_per_1m": 20.0,
            "fallback_llm_profile_id": fb_id,
        },
    )
    assert prim_res.status_code == 201
    prim_id = prim_res.json()["id"]

    sbx_a = client.post(
        "/api/sandboxes",
        json={
            "email": "a@corp.com",
            "slug": "cost-a",
            "llm_profile_id": prim_id,
            "daily_cost_limit": 0.30,
            "budget_action": "block",
        },
    ).json()
    sbx_b = client.post(
        "/api/sandboxes",
        json={
            "email": "b@corp.com",
            "slug": "cost-b",
            "llm_profile_id": prim_id,
            "budget_action": "block",
        },
    ).json()
    assert sbx_a["daily_cost_limit"] == 0.30

    team_res = client.post(
        "/api/teams",
        json={
            "name": "Cost Guard Team",
            "daily_cost_budget": 0.50,
            "sandbox_ids": [sbx_a["id"], sbx_b["id"]],
        },
    )
    assert team_res.status_code == 201, team_res.text
    team_id = team_res.json()["id"]
    assert team_res.json()["daily_cost_budget"] == 0.50

    with SessionLocal() as db:
        vkey_a = db.get(Sandbox, sbx_a["id"]).gateway_api_key
        vkey_b = db.get(Sandbox, sbx_b["id"]).gateway_api_key

    recorded: list[dict] = []

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def request(self, method, url, **kwargs):
            recorded.append({"method": method, "url": url, "content": kwargs.get("content")})
            body = json.loads(kwargs["content"].decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "id": "cmpl",
                    "model": body.get("model"),
                    "usage": {"prompt_tokens": 10000, "completion_tokens": 5000, "total_tokens": 15000},
                },
            )

    monkeypatch.setattr(llm_gateway_router.httpx, "AsyncClient", _FakeAsyncClient)

    # Call 1 on cost-a -> $0.20 (under $0.30 employee cap & $0.50 team cap)
    r1 = client.post(
        f"/api/llm-gateway/p/{prim_id}/chat/completions",
        headers={"Authorization": f"Bearer {vkey_a}"},
        json={"model": "gpt-5", "messages": [{"role": "user", "content": "1"}]},
    )
    assert r1.status_code == 200

    # Call 2 on cost-a -> brings cost-a to $0.40 (>= $0.30 employee cap)
    r2 = client.post(
        f"/api/llm-gateway/p/{prim_id}/chat/completions",
        headers={"Authorization": f"Bearer {vkey_a}"},
        json={"model": "gpt-5", "messages": [{"role": "user", "content": "2"}]},
    )
    assert r2.status_code == 200

    # Call 3 on cost-a -> BLOCKED by employee daily_cost_limit ($0.40 >= $0.30)
    r3 = client.post(
        f"/api/llm-gateway/p/{prim_id}/chat/completions",
        headers={"Authorization": f"Bearer {vkey_a}"},
        json={"model": "gpt-5", "messages": [{"role": "user", "content": "3"}]},
    )
    assert r3.status_code == 429
    assert r3.json()["error"]["code"] == "daily_cost_limit_exceeded"

    # Switch cost-a to downgrade -> routes to fallback model!
    client.patch(f"/api/sandboxes/{sbx_a['id']}", json={"budget_action": "downgrade"})
    r4 = client.post(
        f"/api/llm-gateway/p/{prim_id}/chat/completions",
        headers={"Authorization": f"Bearer {vkey_a}"},
        json={"model": "gpt-5", "messages": [{"role": "user", "content": "4"}]},
    )
    assert r4.status_code == 200
    assert json.loads(recorded[-1]["content"].decode("utf-8"))["model"] == "gpt-4o-mini"

    # Call on cost-b (no individual cap): team cost is $0.402 -> succeeds & pushes team to $0.602 >= $0.50!
    rb1 = client.post(
        f"/api/llm-gateway/p/{prim_id}/chat/completions",
        headers={"Authorization": f"Bearer {vkey_b}"},
        json={"model": "gpt-5", "messages": [{"role": "user", "content": "b1"}]},
    )
    assert rb1.status_code == 200

    # Next call on cost-b -> BLOCKED by TEAM daily_cost_budget ($0.602 >= $0.50)!
    rb2 = client.post(
        f"/api/llm-gateway/p/{prim_id}/chat/completions",
        headers={"Authorization": f"Bearer {vkey_b}"},
        json={"model": "gpt-5", "messages": [{"role": "user", "content": "b2"}]},
    )
    assert rb2.status_code == 429
    assert rb2.json()["error"]["code"] == "team_daily_cost_budget_exceeded"

    # FinOps summary exposes cost caps and utilization percentages for both sandbox and team
    fin = client.get("/api/finops/summary?days=7").json()
    row_a = next(x for x in fin["by_sandbox"] if x["slug"] == "cost-a")
    assert row_a["daily_cost_limit"] == 0.30
    assert row_a["cost_budget_percent"] >= 100.0
    row_tm = next(x for x in fin["by_team"] if x["team_id"] == team_id)
    assert row_tm["daily_cost_budget"] == 0.50
    assert row_tm["today_cost"] >= 0.50
    assert row_tm["cost_budget_percent"] >= 100.0
