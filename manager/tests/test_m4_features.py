from __future__ import annotations

import json
import os
import shutil
import subprocess
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import (
    LlmProfile,
    LlmUsageLedger,
    NotificationDelivery,
    PlaybookRun,
    PlaybookStepRun,
    Sandbox,
)
from app.routers import llm_gateway as llm_gateway_router
from app.runtime.operations import WorkforceOperationsMixin
from app.security import derive_sandbox_gateway_secret
from app.services import notifications as notifications_mod
from app.services.common import utcnow
from app.services.llm_gateway import (
    is_upstream_circuit_open,
    reset_gateway_runtime_state,
)
from app.services.playbooks import sync_playbook_run_progress


def _login_admin(client) -> None:
    client.post("/api/auth/logout")
    res = client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "token": "test-admin-token", "mode": "admin"},
    )
    assert res.status_code == 200, res.text


def _get_run(client, run_id: str) -> dict:
    res = client.get("/api/playbook-runs")
    assert res.status_code == 200, res.text
    for item in res.json()["items"]:
        if item["id"] == run_id:
            return item
    raise AssertionError(f"PlaybookRun {run_id} not found")


def test_sse_long_stream_metering_and_cache_read_pricing(
    api_env, monkeypatch
):
    client, _fake_docker, _reg = api_env
    reset_gateway_runtime_state()
    _login_admin(client)
    try:
        # Create profile with discounted cache_read_price_per_1m
        p_res = client.post(
            "/api/llm-profiles",
            json={
                "name": "M4 Cached GPT",
                "api_protocol": "openai-completions",
                "base_url": "https://primary-cache.example.com/v1",
                "model": "gpt-4o",
                "api_key": "sk-cache-primary",
                "gateway_enabled": True,
                "input_price_per_1m": 10.0,
                "output_price_per_1m": 30.0,
                "cache_read_price_per_1m": 1.0,
            },
        )
        assert p_res.status_code == 201, p_res.text
        profile_id = p_res.json()["id"]

        sbx_res = client.post(
            "/api/sandboxes",
            json={
                "email": "m4-sse@example.com",
                "slug": "m4-sse",
                "llm_profile_id": profile_id,
            },
        )
        assert sbx_res.status_code == 201, sbx_res.text
        sbx_id = sbx_res.json()["id"]

        with SessionLocal() as db:
            vkey = db.get(Sandbox, sbx_id).gateway_api_key
            assert vkey

        class _LongSseResponse:
            status_code = 200
            headers = {"content-type": "text/event-stream"}

            async def aiter_bytes(self):
                # Emit >2500 SSE chunks (plus split multi-byte UTF-8) before final usage chunk
                for i in range(2505):
                    yield f'data: {{"choices":[{{"delta":{{"content":"c{i}"}}}}]}}\n\n'.encode("utf-8")
                split_msg = 'data: {"choices":[{"delta":{"content":"中文测"}}]}\n\n'.encode("utf-8")
                yield split_msg[:33]
                yield split_msg[33:]
                final_evt = json.dumps(
                    {
                        "id": "chatcmpl-long",
                        "choices": [],
                        "usage": {
                            "prompt_tokens": 1000,
                            "completion_tokens": 200,
                            "total_tokens": 1200,
                            "prompt_tokens_details": {"cached_tokens": 800},
                        },
                    }
                )
                yield f"data: {final_evt}\n\n".encode("utf-8")
                yield b"data: [DONE]\n\n"

            async def aclose(self):
                return None

        class _FakeAsyncClient:
            def __init__(self, timeout=None):
                self.timeout = timeout

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            def build_request(self, method, url, params=None, headers=None, content=b""):
                return SimpleNamespace(method=method, url=url, params=params, headers=headers, content=content)

            async def send(self, req, stream=False):
                return _LongSseResponse()

            async def aclose(self):
                return None

        monkeypatch.setattr(llm_gateway_router.httpx, "AsyncClient", _FakeAsyncClient)

        resp = client.post(
            f"/api/llm-gateway/p/{profile_id}/chat/completions",
            headers={"Authorization": f"Bearer {vkey}"},
            json={"model": "gpt-4o", "stream": True, "messages": [{"role": "user", "content": "hi"}]},
        )
        assert resp.status_code == 200
        assert "chatcmpl-long" in resp.text

        with SessionLocal() as db:
            row = db.scalar(
                select(LlmUsageLedger)
                .where(LlmUsageLedger.sandbox_id == sbx_id)
                .order_by(LlmUsageLedger.created_at.desc())
            )
            assert row is not None
            assert row.input_tokens == 1000
            assert row.output_tokens == 200
            assert row.cache_read_tokens == 800
            assert row.total_tokens == 1200
            # (200/1e6)*10 + (800/1e6)*1 + (200/1e6)*30 = 0.002 + 0.0008 + 0.006 = 0.0088
            assert abs(row.cost_amount - 0.0088) < 1e-6

        fin = client.get("/api/finops/summary?days=7").json()
        assert fin["period"]["cache_read_tokens"] >= 800
        assert fin["period"]["cache_savings_estimate"] >= 0.0072
    finally:
        reset_gateway_runtime_state()


def test_gateway_failover_circuit_breaker_rpm_and_monthly_budget(
    api_env, monkeypatch
):
    client, _fake_docker, _reg = api_env
    reset_gateway_runtime_state()
    _login_admin(client)
    try:
        fb_res = client.post(
            "/api/llm-profiles",
            json={
                "name": "M4 HA Fallback",
                "api_protocol": "openai-completions",
                "base_url": "https://ha-fallback.example.com/v1",
                "model": "gpt-4o-mini",
                "api_key": "sk-ha-fallback",
                "gateway_enabled": True,
                "input_price_per_1m": 0.1,
                "output_price_per_1m": 0.2,
            },
        )
        assert fb_res.status_code == 201
        fb_id = fb_res.json()["id"]

        pri_res = client.post(
            "/api/llm-profiles",
            json={
                "name": "M4 HA Primary",
                "api_protocol": "openai-completions",
                "base_url": "https://ha-primary.example.com/v1",
                "model": "gpt-4o",
                "api_key": "sk-ha-primary",
                "gateway_enabled": True,
                "fallback_llm_profile_id": fb_id,
                "circuit_breaker_enabled": True,
                "input_price_per_1m": 5.0,
                "output_price_per_1m": 15.0,
            },
        )
        assert pri_res.status_code == 201
        pri_id = pri_res.json()["id"]

        sbx_res = client.post(
            "/api/sandboxes",
            json={
                "email": "m4-ha@example.com",
                "slug": "m4-ha",
                "llm_profile_id": pri_id,
                "monthly_cost_limit": 0.05,
                "rpm_limit": 5,
                "budget_action": "block",
            },
        )
        assert sbx_res.status_code == 201, sbx_res.text
        sbx_id = sbx_res.json()["id"]
        assert sbx_res.json()["monthly_cost_limit"] == 0.05
        assert sbx_res.json()["rpm_limit"] == 5

        with SessionLocal() as db:
            vkey = db.get(Sandbox, sbx_id).gateway_api_key

        calls: list[tuple[str, str]] = []
        primary_should_fail = True

        class _FakeResp:
            def __init__(self, status_code: int, payload: dict):
                self.status_code = status_code
                self._payload = payload
                self.headers = {"content-type": "application/json"}
                self.content = json.dumps(payload).encode("utf-8")

            def json(self):
                return self._payload

        class _FakeAsyncClient:
            def __init__(self, timeout=None):
                self.timeout = timeout

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def request(self, method, url, params=None, headers=None, content=b""):
                body = json.loads(content.decode("utf-8"))
                calls.append((url, body.get("model")))
                if "ha-primary.example.com" in url and primary_should_fail:
                    return _FakeResp(503, {"error": {"message": "upstream overloaded"}})
                return _FakeResp(
                    200,
                    {
                        "id": "chatcmpl-ha",
                        "model": body.get("model"),
                        "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
                    },
                )

        monkeypatch.setattr(llm_gateway_router.httpx, "AsyncClient", _FakeAsyncClient)

        # Failover on 503 (calls 1..3 trip the default threshold=3 circuit breaker)
        for _ in range(3):
            res = client.post(
                f"/api/llm-gateway/p/{pri_id}/chat/completions",
                headers={"Authorization": f"Bearer {vkey}"},
                json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]},
            )
            assert res.status_code == 200
            assert res.json()["model"] == "gpt-4o-mini"

        with SessionLocal() as db:
            pri_obj = db.get(LlmProfile, pri_id)
            assert is_upstream_circuit_open(pri_obj) is True

        # 4th call bypasses primary immediately via open circuit breaker -> only 1 upstream call to fallback!
        calls.clear()
        cb_res = client.post(
            f"/api/llm-gateway/p/{pri_id}/chat/completions",
            headers={"Authorization": f"Bearer {vkey}"},
            json={"model": "gpt-4o", "messages": [{"role": "user", "content": "via circuit"}]},
        )
        assert cb_res.status_code == 200
        assert calls == [("https://ha-fallback.example.com/v1/chat/completions", "gpt-4o-mini")]

        # 5th call passes, 6th call hits rpm_limit=5 -> HTTP 429 rate_limit_exceeded!
        ok_5 = client.post(
            f"/api/llm-gateway/p/{pri_id}/chat/completions",
            headers={"Authorization": f"Bearer {vkey}"},
            json={"model": "gpt-4o", "messages": [{"role": "user", "content": "5th"}]},
        )
        assert ok_5.status_code == 200
        rpm_blocked = client.post(
            f"/api/llm-gateway/p/{pri_id}/chat/completions",
            headers={"Authorization": f"Bearer {vkey}"},
            json={"model": "gpt-4o", "messages": [{"role": "user", "content": "6th"}]},
        )
        assert rpm_blocked.status_code == 429
        assert rpm_blocked.json()["error"]["code"] == "rpm_limit_exceeded"
        assert "Retry-After" in rpm_blocked.headers

        # Raise RPM limit, inject ledger spend exceeding monthly_cost_limit=0.05 -> monthly budget block!
        reset_gateway_runtime_state()
        client.patch(f"/api/sandboxes/{sbx_id}", json={"rpm_limit": 100})
        with SessionLocal() as db:
            db.add(
                LlmUsageLedger(
                    sandbox_id=sbx_id,
                    sandbox_slug="m4-ha",
                    llm_profile_id=pri_id,
                    model="gpt-4o",
                    api_protocol="openai-completions",
                    input_tokens=5000,
                    output_tokens=2000,
                    cache_read_tokens=0,
                    total_tokens=7000,
                    cost_amount=0.06,
                    routed_mode="primary",
                    status_code=200,
                    latency_ms=120,
                    created_at=utcnow(),
                )
            )
            db.commit()

        monthly_blocked = client.post(
            f"/api/llm-gateway/p/{pri_id}/chat/completions",
            headers={"Authorization": f"Bearer {vkey}"},
            json={"model": "gpt-4o", "messages": [{"role": "user", "content": "over monthly"}]},
        )
        assert monthly_blocked.status_code == 429
        assert monthly_blocked.json()["error"]["code"] == "monthly_cost_limit_exceeded"
    finally:
        reset_gateway_runtime_state()


def test_internal_mesh_wake_and_event_callback(api_env):
    client, fake_docker, _reg = api_env
    _login_admin(client)
    caller_res = client.post(
        "/api/sandboxes",
        json={"email": "m4-caller@example.com", "slug": "m4-caller", "role_title": "PM"},
    )
    target_res = client.post(
        "/api/sandboxes",
        json={"email": "m4-target@example.com", "slug": "m4-target", "role_title": "QA"},
    )
    assert caller_res.status_code == 201 and target_res.status_code == 201
    caller_id = caller_res.json()["id"]
    target_id = target_res.json()["id"]

    # Put target to sleep
    stop_res = client.post(f"/api/sandboxes/{target_id}/stop")
    assert stop_res.status_code == 200
    assert stop_res.json()["status"] == "stopped"

    # Sleeping mesh path returns 503 {sleeping: true} instead of 401 when X-Mesh-From header present
    mesh_sleeping = client.post(
        "/s/m4-target/p/4090/mesh/send",
        headers={"x-mesh-from": "m4-caller"},
        json={"roomId": "pair:m4-caller:m4-target"},
    )
    assert mesh_sleeping.status_code == 503
    assert mesh_sleeping.json()["sleeping"] is True

    # Unauthorized wake request is rejected
    bad_wake = client.post("/api/internal/mesh/wake/m4-target")
    assert bad_wake.status_code == 401

    caller_secret = derive_sandbox_gateway_secret(caller_id, "m4-caller")
    wake_ok = client.post(
        "/api/internal/mesh/wake/m4-target",
        headers={
            "X-Metis-Sandbox-Slug": "m4-caller",
            "X-Metis-Gateway-Auth": caller_secret,
        },
    )
    assert wake_ok.status_code == 200, wake_ok.text
    assert wake_ok.json()["ok"] is True
    assert wake_ok.json()["woke"] is True
    assert wake_ok.json()["status"] == "running"

    # Now create a 2-stage Playbook & verify instant POST /api/internal/mesh/events advances it!
    pb_res = client.post(
        "/api/playbooks",
        json={
            "key": "m4-event-sync",
            "name": "Event Sync Flow",
            "stages": [
                {
                    "id": "first",
                    "name": "First Step",
                    "role_hint": "PM",
                    "prompt_template": "Do {{goal}}",
                },
                {
                    "id": "second",
                    "name": "Second Step",
                    "role_hint": "QA",
                    "depends_on": ["first"],
                    "prompt_template": "Verify {{stage.first.output}}",
                },
            ],
        },
    )
    assert pb_res.status_code == 201, pb_res.text
    pb_id = pb_res.json()["id"]

    run_res = client.post(
        f"/api/playbooks/{pb_id}/runs",
        data={
            "title": "Instant Callback Run",
            "inputs_json": json.dumps({"goal": "Build feature"}),
            "role_assignments_json": json.dumps({"first": caller_id, "second": target_id}),
        },
    )
    assert run_res.status_code == 201, run_res.text
    run = run_res.json()
    first_step = run["steps"][0]
    assert first_step["status"] == "running"
    assert run["steps"][1]["status"] == "pending"

    fake_docker.mesh_progress[("m4-caller", first_step["task_id"])] = {
        "ok": True,
        "completed": True,
        "reply_text": "Spec approved & ready",
        "artifacts": ["/home/workspace/spec.md"],
    }
    evt_res = client.post(
        "/api/internal/mesh/events",
        headers={
            "X-Metis-Sandbox-Slug": "m4-caller",
            "X-Metis-Gateway-Auth": caller_secret,
        },
        json={
            "event": "message.agent",
            "roomId": first_step["room_id"],
            "taskId": first_step["task_id"],
        },
    )
    assert evt_res.status_code == 200, evt_res.text
    assert evt_res.json()["advanced"] >= 1

    updated_run = _get_run(client, run["id"])
    assert updated_run["steps"][0]["status"] == "completed"
    assert updated_run["steps"][1]["status"] == "running"


def test_playbook_dag_sla_retry_and_rework_loop(api_env, monkeypatch):
    client, fake_docker, _reg = api_env
    _login_admin(client)

    class _FakeNotifClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, url, **kwargs):
            return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(notifications_mod.httpx, "Client", _FakeNotifClient)

    # Create notification channel subscribed to stage.timeout
    ch_res = client.post(
        "/api/notification-channels",
        json={
            "name": "M4 SLA Webhook",
            "channel_type": "webhook",
            "webhook_url": "https://hooks.example.com/m4-sla",
            "events": ["stage.timeout", "approval.pending"],
        },
    )
    assert ch_res.status_code == 201

    sbx_ids = {}
    for slug in ("m4-pm", "m4-fe", "m4-be", "m4-qa"):
        r = client.post(
            "/api/sandboxes",
            json={"email": f"{slug}@example.com", "slug": slug},
        )
        assert r.status_code == 201
        sbx_ids[slug] = r.json()["id"]

    # Diamond + branch-ahead DAG: plan -> (fe, be); fe -> docs; (fe, be) -> qa (with on_reject_goto: be)
    pb_res = client.post(
        "/api/playbooks",
        json={
            "key": "m4-dag-flow",
            "name": "DAG & Rework Flow",
            "stages": [
                {"id": "plan", "name": "Plan", "prompt_template": "Plan {{topic}}"},
                {
                    "id": "fe",
                    "name": "Frontend",
                    "depends_on": ["plan"],
                    "prompt_template": "FE for {{stage.plan.output}}",
                },
                {
                    "id": "be",
                    "name": "Backend",
                    "depends_on": ["plan"],
                    "timeout_seconds": 30,
                    "max_retries": 1,
                    "prompt_template": "BE for {{stage.plan.output}}",
                },
                {
                    "id": "docs",
                    "name": "FE Docs",
                    "depends_on": ["fe"],
                    "prompt_template": "Docs from {{stage.fe.output}} ({{stage.fe.artifacts}})",
                },
                {
                    "id": "qa",
                    "name": "QA Sign-off",
                    "depends_on": ["fe", "be"],
                    "approval_required": True,
                    "on_reject_goto": "be",
                    "prompt_template": "QA {{previous_outputs}}",
                },
            ],
        },
    )
    assert pb_res.status_code == 201, pb_res.text
    pb_id = pb_res.json()["id"]

    run_res = client.post(
        f"/api/playbooks/{pb_id}/runs",
        data={
            "title": "DAG Launch",
            "inputs_json": json.dumps({"topic": "Payments v2"}),
            "role_assignments_json": json.dumps(
                {
                    "plan": sbx_ids["m4-pm"],
                    "fe": sbx_ids["m4-fe"],
                    "be": sbx_ids["m4-be"],
                    "docs": sbx_ids["m4-fe"],
                    "qa": sbx_ids["m4-qa"],
                }
            ),
        },
    )
    assert run_res.status_code == 201, run_res.text
    run_id = run_res.json()["id"]
    steps_map = {s["stage_id"]: s for s in run_res.json()["steps"]}
    assert steps_map["plan"]["status"] == "running"
    assert steps_map["fe"]["status"] == "pending"

    # Complete 'plan' -> 'fe' & 'be' dispatch concurrently
    fake_docker.mesh_progress[("m4-pm", steps_map["plan"]["task_id"])] = {
        "ok": True,
        "completed": True,
        "reply_text": "Architecture ready",
        "artifacts": ["/home/workspace/arch.md"],
    }
    sync_run1 = _get_run(client, run_id)
    steps_map = {s["stage_id"]: s for s in sync_run1["steps"]}
    assert steps_map["plan"]["status"] == "completed"
    assert steps_map["fe"]["status"] == "running"
    assert steps_map["be"]["status"] == "running"
    assert steps_map["docs"]["status"] == "pending"
    assert steps_map["qa"]["status"] == "pending"

    # Complete 'fe' ONLY while 'be' is still running -> 'docs' immediately runs (true branch DAG!), 'qa' still pending!
    fake_docker.mesh_progress[("m4-fe", steps_map["fe"]["task_id"])] = {
        "ok": True,
        "completed": True,
        "reply_text": "React checkout built",
        "artifacts": ["/home/workspace/ui.tsx"],
    }
    sync_run2 = _get_run(client, run_id)
    steps_map = {s["stage_id"]: s for s in sync_run2["steps"]}
    assert steps_map["fe"]["status"] == "completed"
    assert steps_map["docs"]["status"] == "running"
    assert steps_map["be"]["status"] == "running"
    assert steps_map["qa"]["status"] == "pending"

    # Check {{stage.fe.output}} interpolation in docs prompt & test SLA auto-retry + timeout alert
    with SessionLocal() as db:
        docs_db = db.scalar(
            select(PlaybookStepRun).where(
                PlaybookStepRun.run_id == run_id, PlaybookStepRun.stage_id == "docs"
            )
        )
        assert "React checkout built" in (docs_db.prompt_rendered or "")
        assert "/home/workspace/ui.tsx" in (docs_db.prompt_rendered or "")

        # Simulate SLA timeout on 'be': first breach -> auto-retry (retry_count goes 0 -> 1)
        be_db = db.scalar(
            select(PlaybookStepRun).where(
                PlaybookStepRun.run_id == run_id, PlaybookStepRun.stage_id == "be"
            )
        )
        be_db.started_at = utcnow() - timedelta(seconds=60)
        db.commit()
        run_obj = db.get(PlaybookRun, run_id)
        sync_playbook_run_progress(db, get_settings(), fake_docker, run_obj, check_runtime=False)
        db.refresh(be_db)
        assert be_db.retry_count == 1
        assert be_db.sla_warned_at is None

        # Simulate second SLA timeout on 'be' -> retries exhausted -> stage.timeout notification emitted!
        be_db.started_at = utcnow() - timedelta(seconds=60)
        db.commit()
        sync_playbook_run_progress(db, get_settings(), fake_docker, run_obj, check_runtime=False)
        db.refresh(be_db)
        assert be_db.sla_warned_at is not None
        sla_notifs = list(
            db.scalars(
                select(NotificationDelivery).where(
                    NotificationDelivery.event_type == "stage.timeout"
                )
            ).all()
        )
        assert len(sla_notifs) >= 1

    # Re-fetch steps_map after 'be' auto-retried (so 'be' has latest task_id), then finish 'be' and 'docs'
    steps_map = {s["stage_id"]: s for s in _get_run(client, run_id)["steps"]}
    fake_docker.mesh_progress[("m4-be", steps_map["be"]["task_id"])] = {
        "ok": True,
        "completed": True,
        "reply_text": "Payment API v2 deployed",
        "artifacts": [],
    }
    fake_docker.mesh_progress[("m4-fe", steps_map["docs"]["task_id"])] = {
        "ok": True,
        "completed": True,
        "reply_text": "Docs published",
        "artifacts": [],
    }
    sync_run3 = _get_run(client, run_id)
    steps_map = {s["stage_id"]: s for s in sync_run3["steps"]}
    assert steps_map["qa"]["status"] == "running"

    fake_docker.mesh_progress[("m4-qa", steps_map["qa"]["task_id"])] = {
        "ok": True,
        "completed": True,
        "reply_text": "Found API status code mismatch",
        "artifacts": [],
    }
    sync_run4 = _get_run(client, run_id)
    steps_map = {s["stage_id"]: s for s in sync_run4["steps"]}
    assert steps_map["qa"]["status"] == "awaiting_approval"

    # Reject QA -> on_reject_goto='be' automatically re-dispatches 'be' instead of failing run!
    rej_res = client.post(
        f"/api/playbook-runs/{run_id}/steps/{steps_map['qa']['id']}/decide",
        json={"decision": "rejected", "note": "Fix 402 webhook payload"},
    )
    assert rej_res.status_code == 200, rej_res.text
    after_rework = rej_res.json()
    assert after_rework["status"] == "running"
    rework_map = {s["stage_id"]: s for s in after_rework["steps"]}
    assert rework_map["be"]["status"] == "running"
    assert rework_map["qa"]["status"] == "pending"

    with SessionLocal() as db:
        be_reworked = db.scalar(
            select(PlaybookStepRun).where(
                PlaybookStepRun.run_id == run_id, PlaybookStepRun.stage_id == "be"
            )
        )
        assert "Fix 402 webhook payload" in (be_reworked.prompt_rendered or "")


def test_subcent_cost_budget_precision(api_env):
    client, _fake_docker, _reg = api_env
    _login_admin(client)

    prof = client.post(
        "/api/llm-profiles",
        json={
            "name": "M4 Subcent Model",
            "api_protocol": "openai-completions",
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-subcent",
            "model": "gpt-4o",
            "gateway_enabled": True,
            "input_price_per_1m": 1.0,
            "output_price_per_1m": 1.0,
        },
    )
    assert prof.status_code == 201
    prof_id = prof.json()["id"]

    res = client.post(
        "/api/sandboxes",
        json={
            "email": "m4-subcent@example.com",
            "slug": "m4-subcent",
            "llm_profile_id": prof_id,
            "daily_cost_limit": 0.00005,
            "monthly_cost_limit": 0.00001,
            "budget_action": "block",
        },
    )
    assert res.status_code == 201, res.text
    sbx = res.json()
    assert sbx["daily_cost_limit"] == 0.00005
    assert sbx["monthly_cost_limit"] == 0.00001

    p1 = client.patch(
        f"/api/sandboxes/{sbx['id']}",
        json={"daily_cost_limit": 0.00002, "monthly_cost_limit": 0.0000001},
    )
    assert p1.status_code == 200, p1.text
    assert p1.json()["daily_cost_limit"] == 0.00002
    assert p1.json()["monthly_cost_limit"] is None

    p2 = client.patch(
        f"/api/sandboxes/{sbx['id']}",
        json={"monthly_cost_limit": 0.00001},
    )
    assert p2.status_code == 200
    assert p2.json()["monthly_cost_limit"] == 0.00001

    with SessionLocal() as db:
        sbx_db = db.get(Sandbox, sbx["id"])
        vkey = sbx_db.gateway_api_key
        db.add(
            LlmUsageLedger(
                sandbox_id=sbx["id"],
                sandbox_slug="m4-subcent",
                llm_profile_id=prof_id,
                model="gpt-4o",
                api_protocol="openai-completions",
                input_tokens=10,
                output_tokens=10,
                cache_read_tokens=0,
                total_tokens=20,
                cost_amount=0.000127,
                routed_mode="primary",
                status_code=200,
                latency_ms=50,
                created_at=utcnow(),
            )
        )
        db.commit()

    blocked = client.post(
        f"/api/llm-gateway/p/{prof_id}/chat/completions",
        headers={"Authorization": f"Bearer {vkey}"},
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "ping"}]},
    )
    assert blocked.status_code == 429, blocked.text


def test_inspect_mesh_room_progress_self_approval_wait(tmp_path):
    if not shutil.which("node"):
        pytest.skip("Node.js not installed in test environment")

    mesh_fixture = tmp_path / "sandbox-mesh.json"
    preload_js = tmp_path / "preload-fs.js"
    preload_js.write_text(
        f"""
const fs = require('fs');
const fixturePath = {json.dumps(str(mesh_fixture))};
const origExists = fs.existsSync.bind(fs);
const origRead = fs.readFileSync.bind(fs);
fs.existsSync = (p) => {{
  const s = String(p || '').replace(/\\\\/g, '/');
  if (s.endsWith('sandbox-mesh.local-token')) return false;
  if (s.endsWith('sandbox-mesh.json')) return true;
  return origExists(p);
}};
fs.readFileSync = (p, opts) => {{
  const s = String(p || '').replace(/\\\\/g, '/');
  if (s.endsWith('sandbox-mesh.json')) return origRead(fixturePath, opts);
  return origRead(p, opts);
}};
""",
        encoding="utf-8",
    )

    class _FakeRuntime(WorkforceOperationsMixin):
        def _workload_status(self, _sandbox):
            return "running"

        def exec_command(self, _sandbox, cmd, *, user="workspace", environment=None):
            env = {**os.environ, **(environment or {})}
            proc = subprocess.run(
                [cmd[0], "-r", str(preload_js), *cmd[1:]],
                capture_output=True,
                env=env,
                check=False,
            )
            return proc.returncode, proc.stdout + proc.stderr

    runtime = _FakeRuntime()
    fake_sbx = SimpleNamespace(slug="qa-agent")

    # 1. Self-created approval wait task (`in_review` + `approvalRequired` + `pending`)
    # must NOT block completion or trigger waiting_on_subtasks deadlock.
    mesh_fixture.write_text(
        json.dumps(
            {
                "messages": {
                    "grp_qa": [
                        {
                            "id": "msg_dispatch",
                            "roomId": "grp_qa",
                            "threadId": "thr_1",
                            "sender": {"actor": "user", "slug": "manager"},
                            "text": "Review deliverable",
                            "createdAt": 1000,
                        }
                    ]
                },
                "tasks": {
                    "grp_qa": [
                        {
                            "id": "tsk_self_approval",
                            "threadId": "thr_1",
                            "title": "QA Gate",
                            "status": "in_review",
                            "approvalRequired": True,
                            "approvalStatus": "pending",
                            "approvalPrompt": "Ready for human sign-off",
                            "assigneeSlug": "qa-agent",
                            "createdBy": "qa-agent",
                            "createdAt": 1200,
                        }
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    res_approval = runtime.inspect_mesh_room_progress(
        fake_sbx, "grp_qa", since_message_id="msg_dispatch"
    )
    assert res_approval["ok"] is True, res_approval
    assert res_approval["completed"] is True
    assert res_approval["waiting_on_subtasks"] is False
    assert "Ready for human sign-off" in res_approval["reply_text"]

    # 2. Genuine delegated child task (`in_progress`) must keep `waiting_on_subtasks=True`.
    mesh_fixture.write_text(
        json.dumps(
            {
                "messages": {
                    "grp_qa": [
                        {
                            "id": "msg_dispatch",
                            "roomId": "grp_qa",
                            "threadId": "thr_1",
                            "sender": {"actor": "user", "slug": "manager"},
                            "text": "Coordinate team",
                            "createdAt": 1000,
                        },
                        {
                            "id": "msg_mod",
                            "roomId": "grp_qa",
                            "threadId": "thr_1",
                            "sender": {"actor": "agent", "slug": "qa-agent"},
                            "text": "Delegated child task",
                            "createdAt": 1100,
                        },
                    ]
                },
                "tasks": {
                    "grp_qa": [
                        {
                            "id": "tsk_child",
                            "threadId": "thr_1",
                            "title": "Subtask",
                            "status": "in_progress",
                            "assigneeSlug": "dev-agent",
                            "createdBy": "qa-agent",
                            "createdAt": 1150,
                        }
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    res_child = runtime.inspect_mesh_room_progress(
        fake_sbx, "grp_qa", since_message_id="msg_dispatch"
    )
    assert res_child["ok"] is True, res_child
    assert res_child["completed"] is False
    assert res_child["waiting_on_subtasks"] is True
