"""Comprehensive M1 tests: Global Inbox/Deliverables snapshot dedupe, Notifications, Least-Privilege Credentials, Team Preview Auth, and Audit Center."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from unittest.mock import MagicMock

import httpx
from sqlalchemy import create_engine, inspect

from app.db import init_db
from app.models import AuditLog, Sandbox
from app.scheduler import BackgroundWorker
from app.services.notifications import NotificationEvent, dispatch_notification_event


ADMIN_HEADERS = {"Authorization": "Bearer test-admin-token"}


def test_idempotent_schema_migration_on_legacy_sqlite(tmp_path: Path):
    """Legacy databases missing M1 columns and tables migrate cleanly without data loss."""
    db_file = tmp_path / "legacy.db"
    conn = sqlite3.connect(db_file)
    conn.execute(
        "CREATE TABLE sandboxes (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36), slug VARCHAR(64), volume_name VARCHAR(128), image_tag VARCHAR(128), status VARCHAR(32))"
    )
    conn.execute(
        "CREATE TABLE sandbox_templates (id VARCHAR(36) PRIMARY KEY, key VARCHAR(64), name VARCHAR(128), image_repo VARCHAR(255), image_tag VARCHAR(128), default_cpu_limit FLOAT, default_memory_limit VARCHAR(32), is_builtin BOOLEAN)"
    )
    conn.execute(
        "CREATE TABLE audit_log (id VARCHAR(36) PRIMARY KEY, actor VARCHAR(255), action VARCHAR(64), target VARCHAR(128), detail TEXT, created_at DATETIME)"
    )
    conn.commit()
    conn.close()

    eng = create_engine(f"sqlite:///{db_file.as_posix()}")
    init_db(eng)
    # Run twice to confirm idempotency
    init_db(eng)

    insp = inspect(eng)
    tables = set(insp.get_table_names())
    assert "sandbox_runtime_snapshots" in tables
    assert "notification_channels" in tables
    assert "notification_deliveries" in tables
    assert "credential_profile_ids_json" in {c["name"] for c in insp.get_columns("sandboxes")}
    assert "default_credential_profile_ids_json" in {
        c["name"] for c in insp.get_columns("sandbox_templates")
    }
    audit_cols = {c["name"] for c in insp.get_columns("audit_log")}
    assert {"category", "sandbox_slug"}.issubset(audit_cols)
    eng.dispose()


def test_workspace_inbox_dedupe_deliverables_and_tenant_isolation(api_env):
    client, fake_docker, _ = api_env

    # Provision two sandboxes owned by alice and bob
    r1 = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={
            "email": "alice@example.com",
            "slug": "alice-eng",
            "display_name": "Alice",
            "initial_password": "password123",
            "role_title": "全栈研发",
            "preview_auth_mode": "public",
        },
    )
    assert r1.status_code == 201
    alice_id = r1.json()["id"]

    r2 = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={
            "email": "bob@example.com",
            "slug": "bob-qa",
            "display_name": "Bob",
            "initial_password": "password123",
            "role_title": "QA 专家",
            "preview_auth_mode": "team",
        },
    )
    assert r2.status_code == 201
    bob_id = r2.json()["id"]

    # Simulate group-replicated task appearing in BOTH alice-eng and bob-qa, plus a unique blocked task
    def fake_inspect(sbx: Sandbox):
        if sbx.slug == "alice-eng":
            return {
                "online": True,
                "slug": sbx.slug,
                "status": "running",
                "preview_auth_mode": sbx.preview_auth_mode,
                "exposed_apps": [
                    {
                        "name": "web-preview",
                        "mount_path": "/s/alice-eng/apps/web-preview/",
                        "target": "127.0.0.1:5173",
                        "url": "http://localhost:9000/s/alice-eng/apps/web-preview/",
                    }
                ],
                "user_services": [],
                "cron_jobs": [],
                "shared_files": [],
                "mesh_summary": {
                    "role": "全栈研发",
                    "peers": [],
                    "groups": [{"id": "grp_1", "name": "Alpha", "member_count": 2}],
                    "tasks": [
                        {
                            "id": "tsk_shared_1",
                            "room_id": "grp_1",
                            "room_name": "Alpha",
                            "title": "发布 v2.0 生产版本",
                            "description": "待人工最终审批",
                            "summary": "CI 全绿",
                            "status": "in_review",
                            "priority": "high",
                            "assignee_slug": "alice-eng",
                            "approval_required": True,
                            "approval_status": "pending",
                            "artifacts": [
                                "https://github.com/org/repo/pull/42",
                                "feat/v2-release",
                            ],
                            "updated_at": 2000,
                        }
                    ],
                    "active_tasks_count": 1,
                    "blocked_tasks_count": 0,
                    "done_tasks_count": 0,
                    "pending_approvals": [
                        {
                            "id": "tsk_shared_1",
                            "room_id": "grp_1",
                            "title": "发布 v2.0 生产版本",
                            "assignee_slug": "alice-eng",
                        }
                    ],
                },
            }
        return {
            "online": True,
            "slug": sbx.slug,
            "status": "running",
            "preview_auth_mode": sbx.preview_auth_mode,
            "exposed_apps": [
                {
                    "name": "qa-report",
                    "mount_path": "/s/bob-qa/apps/qa-report/",
                    "target": "127.0.0.1:8000",
                    "url": "http://localhost:9000/s/bob-qa/apps/qa-report/",
                }
            ],
            "user_services": [],
            "cron_jobs": [],
            "shared_files": [],
            "mesh_summary": {
                "role": "QA 专家",
                "peers": [],
                "groups": [{"id": "grp_1", "name": "Alpha", "member_count": 2}],
                "tasks": [
                    {
                        "id": "tsk_shared_1",
                        "room_id": "grp_1",
                        "room_name": "Alpha",
                        "title": "发布 v2.0 生产版本",
                        "description": "副本记录",
                        "summary": "",
                        "status": "in_review",
                        "priority": "high",
                        "assignee_slug": "alice-eng",
                        "approval_required": True,
                        "approval_status": "pending",
                        "artifacts": [],
                        "updated_at": 1500,
                    },
                    {
                        "id": "tsk_blocked_2",
                        "room_id": "grp_1",
                        "room_name": "Alpha",
                        "title": "压测环境凭证缺失",
                        "description": "缺少 staging token",
                        "summary": "阻塞等待运维提供",
                        "status": "blocked",
                        "priority": "urgent",
                        "assignee_slug": "bob-qa",
                        "approval_required": False,
                        "approval_status": "",
                        "artifacts": ["/home/workspace/reports/perf.md"],
                        "updated_at": 2100,
                    },
                ],
                "active_tasks_count": 2,
                "blocked_tasks_count": 1,
                "done_tasks_count": 0,
                "pending_approvals": [
                    {
                        "id": "tsk_shared_1",
                        "room_id": "grp_1",
                        "title": "发布 v2.0 生产版本",
                        "assignee_slug": "alice-eng",
                    }
                ],
            },
        }

    fake_docker.inspect_workforce_runtime = fake_inspect

    # Admin sees deduplicated inbox across both sandboxes: 1 pending approval (pinned to alice-eng), 1 blocked task
    inbox = client.get("/api/workspace/inbox?refresh=true", headers=ADMIN_HEADERS)
    assert inbox.status_code == 200
    body = inbox.json()
    assert body["summary"]["pending_approvals_count"] == 1
    assert body["summary"]["blocked_tasks_count"] == 1
    assert body["summary"]["exposed_apps_count"] == 2
    assert len(body["pending_approvals"]) == 1
    assert body["pending_approvals"][0]["sandbox_id"] == alice_id
    assert body["pending_approvals"][0]["sandbox_slug"] == "alice-eng"
    assert len(body["blocked_tasks"]) == 1
    assert body["blocked_tasks"][0]["sandbox_id"] == bob_id

    # Admin deliverables aggregates 2 apps + 3 classified artifacts (pr, branch, file)
    deliv = client.get("/api/workspace/deliverables", headers=ADMIN_HEADERS)
    assert deliv.status_code == 200
    dbody = deliv.json()
    assert dbody["total_apps"] == 2
    kinds = {a["kind"] for a in dbody["artifacts"]}
    assert kinds == {"pr", "branch", "file"}

    # Regular user Alice login -> sees ONLY her own sandbox's apps/tasks (strict isolation)
    login = client.post(
        "/api/auth/login",
        json={"email": "alice@example.com", "password": "password123", "mode": "user"},
    )
    assert login.status_code == 200

    alice_inbox = client.get("/api/workspace/inbox")
    assert alice_inbox.status_code == 200
    ab = alice_inbox.json()
    assert ab["summary"]["total_sandboxes"] == 1
    assert ab["summary"]["blocked_tasks_count"] == 0
    assert len(ab["pending_approvals"]) == 1

    alice_deliv = client.get("/api/workspace/deliverables")
    assert alice_deliv.status_code == 200
    assert alice_deliv.json()["total_apps"] == 1
    assert alice_deliv.json()["apps"][0]["sandbox_slug"] == "alice-eng"


def test_notification_channels_crud_connectors_and_dedupe(api_env, monkeypatch):
    client, _, _ = api_env

    sent_requests: list[tuple[str, dict, dict]] = []

    class _FakeResp:
        def __init__(self, status_code=200, payload=None):
            self.status_code = status_code
            self._payload = payload or {"code": 0, "errcode": 0}
            self.text = json.dumps(self._payload)

        def json(self):
            return self._payload

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, json=None, content=None, headers=None):
            body = json if json is not None else __import__("json").loads(content.decode("utf-8"))
            sent_requests.append((url, body, dict(headers or {})))
            return _FakeResp()

    monkeypatch.setattr(httpx, "Client", _FakeClient)

    # Create Feishu & Generic Webhook channels
    c1 = client.post(
        "/api/notification-channels",
        headers=ADMIN_HEADERS,
        json={
            "name": "Feishu Core",
            "channel_type": "feishu",
            "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/secret-token-123456",
            "signing_secret": "my-feishu-secret",
            "events": ["approval.pending", "task.blocked"],
        },
    )
    assert c1.status_code == 201
    ch1 = c1.json()
    assert ch1["has_secret"] is True
    assert "secret-token-123456" not in (ch1["target_hint"] or "")
    assert "****" in (ch1["target_hint"] or "")

    c2 = client.post(
        "/api/notification-channels",
        headers=ADMIN_HEADERS,
        json={
            "name": "Ops Webhook",
            "channel_type": "webhook",
            "webhook_url": "https://hooks.corp.local/metis/events",
            "signing_secret": "hmac-key-xyz",
            "events": ["approval.pending"],
        },
    )
    assert c2.status_code == 201
    ch2 = c2.json()

    # Connectivity test endpoint
    t1 = client.post(f"/api/notification-channels/{ch1['id']}/test", headers=ADMIN_HEADERS)
    assert t1.status_code == 200
    assert t1.json()["ok"] is True
    assert sent_requests[-1][1]["msg_type"] == "interactive"
    assert "sign" in sent_requests[-1][1]

    # Dispatch event twice with same dedupe_key -> delivered only once per channel
    from app.config import get_settings
    from app.db import SessionLocal

    sent_requests.clear()
    with SessionLocal() as db:
        ev = NotificationEvent(
            event_type="approval.pending",
            title="Approve Prod Release",
            summary="Ready for deploy",
            severity="warning",
            sandbox_slug="devops-1",
            task_id="tsk_99",
            dedupe_key="approval.pending:grp_1:tsk_99",
        )
        r_first = dispatch_notification_event(db, get_settings(), ev, brand_name="Metis")
        r_second = dispatch_notification_event(db, get_settings(), ev, brand_name="Metis")

    assert r_first["sent"] == 2
    assert r_second["sent"] == 0
    assert r_second["skipped"] == 2
    assert len(sent_requests) == 2
    # Verify HMAC signature header on generic webhook
    webhook_call = [r for r in sent_requests if "hooks.corp.local" in r[0]][0]
    assert webhook_call[2]["X-Metis-Signature"].startswith("sha256=")
    assert webhook_call[2]["X-Metis-Event"] == "approval.pending"

    # Delivery logs list
    dels = client.get("/api/notification-deliveries", headers=ADMIN_HEADERS)
    assert dels.status_code == 200
    assert len(dels.json()) >= 3

    # Update & delete channel
    up = client.patch(
        f"/api/notification-channels/{ch2['id']}",
        headers=ADMIN_HEADERS,
        json={"enabled": False},
    )
    assert up.status_code == 200
    assert up.json()["enabled"] is False
    assert client.delete(f"/api/notification-channels/{ch2['id']}", headers=ADMIN_HEADERS).status_code == 200


def test_least_privilege_credential_binding_and_targeted_push(api_env):
    client, fake_docker, _ = api_env

    # Create two credential profiles: eng-git and finance-mcp
    p_eng = client.post(
        "/api/credential-profiles",
        headers=ADMIN_HEADERS,
        json={
            "name": "Eng Git Bundle",
            "git_host": "github.com",
            "git_user_name": "Eng Bot",
            "git_token": "ghp_secret_1",
        },
    ).json()
    p_fin = client.post(
        "/api/credential-profiles",
        headers=ADMIN_HEADERS,
        json={
            "name": "Finance MCP Bundle",
            "git_host": "gitlab.corp.com",
            "git_user_name": "Fin Bot",
            "mcp_servers_json": '{"erp":{"command":"node","args":["erp-mcp.js"]}}',
        },
    ).json()

    # Create template bound ONLY to Eng Git Bundle
    tpl = client.post(
        "/api/templates",
        headers=ADMIN_HEADERS,
        json={
            "key": "sec-backend",
            "name": "Backend Secure Role",
            "default_credential_profile_ids": [p_eng["id"]],
        },
    )
    assert tpl.status_code == 201
    assert tpl.json()["default_credential_profile_ids"] == [p_eng["id"]]

    # Provision sandbox from sec-backend -> automatically syncs ONLY Eng Git Bundle
    fake_docker.calls.clear()
    s1 = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "dev1@example.com", "slug": "dev-one", "template": "sec-backend"},
    )
    assert s1.status_code == 201
    assert s1.json()["credential_profile_ids"] == [p_eng["id"]]
    cred_calls = [c for c in fake_docker.calls if c[0] == "sync_credential_profile"]
    assert len(cred_calls) == 1
    assert cred_calls[0][1] == ("dev-one", "Eng Bot", "github.com")

    # Provision a second sandbox with default template (no credentials bound)
    fake_docker.calls.clear()
    s2 = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "hr1@example.com", "slug": "hr-one", "template": "agent-os"},
    )
    assert s2.status_code == 201
    assert s2.json()["credential_profile_ids"] == []
    assert [c for c in fake_docker.calls if c[0] == "sync_credential_profile"] == []

    # Targeted push by template_keys hits ONLY sec-backend sandboxes (dev-one), NOT hr-one
    fake_docker.calls.clear()
    push_res = client.post(
        f"/api/credential-profiles/{p_fin['id']}/push",
        headers=ADMIN_HEADERS,
        json={"template_keys": ["sec-backend"]},
    )
    assert push_res.status_code == 200
    assert push_res.json()["synced"] == 1
    assert push_res.json()["total"] == 1
    pushed_slugs = [c[1][0] for c in fake_docker.calls if c[0] == "sync_credential_profile"]
    assert pushed_slugs == ["dev-one"]


def test_team_preview_auth_mode_forward_auth(api_env):
    client, _, _ = api_env

    # Create Alice (Project Alpha), Bob (Project Alpha), Carol (Project Beta / outside)
    s_alice = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={
            "email": "alice@example.com",
            "slug": "alice",
            "initial_password": "password123",
            "preview_auth_mode": "team",
        },
    ).json()
    s_bob = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={
            "email": "bob@example.com",
            "slug": "bob",
            "initial_password": "password123",
        },
    ).json()
    client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={
            "email": "carol@example.com",
            "slug": "carol",
            "initial_password": "password123",
        },
    )

    # Assemble Alice & Bob into Project Alpha
    asm = client.post(
        "/api/teams/assemble",
        headers=ADMIN_HEADERS,
        json={"name": "Project Alpha", "member_ids": [s_alice["id"], s_bob["id"]]},
    )
    assert asm.status_code == 200

    preview_headers = {"X-Forwarded-Uri": "/s/alice/apps/demo/"}

    # Unauthenticated -> 401
    assert client.get("/api/auth/verify-sandbox/alice", headers=preview_headers).status_code == 401

    # Bob (same project team) -> 200 ALLOWED for preview, 403 DENIED for DSH IDE
    client.post(
        "/api/auth/login",
        json={"email": "bob@example.com", "password": "password123", "mode": "user"},
    )
    assert client.get("/api/auth/verify-sandbox/alice", headers=preview_headers).status_code == 200
    assert (
        client.get("/api/auth/verify-sandbox/alice", headers={"X-Forwarded-Uri": "/s/alice/dsh/"}).status_code
        == 403
    )

    # Carol (outside project team) -> 403 DENIED for team-restricted preview
    client.post(
        "/api/auth/login",
        json={"email": "carol@example.com", "password": "password123", "mode": "user"},
    )
    assert client.get("/api/auth/verify-sandbox/alice", headers=preview_headers).status_code == 403

    # Admin -> 200 ALLOWED
    assert (
        client.get(
            "/api/auth/verify-sandbox/alice",
            headers={**ADMIN_HEADERS, **preview_headers},
        ).status_code
        == 200
    )


def test_audit_center_search_filter_and_export(api_env):
    client, _, _ = api_env

    sbx = client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "audit-user@example.com", "slug": "audit-bot"},
    ).json()

    # Generate workforce & approval audit events
    client.post(
        f"/api/sandboxes/{sbx['id']}/tasks",
        headers=ADMIN_HEADERS,
        json={"title": "Audit Task 1", "approval_required": True},
    )
    client.post(
        f"/api/sandboxes/{sbx['id']}/approvals/tsk_fake_1",
        headers=ADMIN_HEADERS,
        json={"decision": "approved", "note": "LGTM"},
    )

    # Filter by category=approval
    res = client.get("/api/audit-logs?category=approval", headers=ADMIN_HEADERS)
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    assert all(item["category"] == "approval" for item in body["items"])
    assert any(item["sandbox_slug"] == "audit-bot" for item in body["items"])

    # Search by keyword q=Audit Task
    res_q = client.get("/api/audit-logs?q=Audit+Task", headers=ADMIN_HEADERS)
    assert res_q.status_code == 200
    assert res_q.json()["total"] == 1

    # Export CSV (with UTF-8 BOM) & JSON
    csv_res = client.get("/api/audit-logs/export?format=csv&category=approval", headers=ADMIN_HEADERS)
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]
    assert csv_res.content.startswith(b"\xef\xbb\xbf")
    assert "sandbox.approval_approved" in csv_res.text

    json_res = client.get("/api/audit-logs/export?format=json&category=approval", headers=ADMIN_HEADERS)
    assert json_res.status_code == 200
    exported = json_res.json()
    assert isinstance(exported, list) and len(exported) >= 1
    assert exported[0]["action"] == "sandbox.approval_approved"


def test_scheduler_unhealthy_alert_and_snapshot_refresh(api_env, monkeypatch):
    client, fake_docker, _ = api_env

    sent: list[dict] = []

    class _FakeResp:
        status_code = 200
        text = '{"ok":true}'

        def json(self):
            return {"ok": True}

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, json=None, content=None, headers=None):
            sent.append({"url": url, "content": content, "json": json})
            return _FakeResp()

    monkeypatch.setattr(httpx, "Client", _FakeClient)

    client.post(
        "/api/notification-channels",
        headers=ADMIN_HEADERS,
        json={
            "name": "Health Watch",
            "channel_type": "webhook",
            "webhook_url": "https://alerts.corp.local/hook",
            "events": ["sandbox.unhealthy"],
        },
    )

    client.post(
        "/api/sandboxes",
        headers=ADMIN_HEADERS,
        json={"email": "sre@example.com", "slug": "sre-bot"},
    )
    # Simulate container unexpectedly crashing
    fake_docker.containers["sre-bot"]["status"] = "exited"

    from app.config import get_settings

    worker = BackgroundWorker(get_settings(), fake_docker)
    worker.tick()
    assert len(sent) == 1
    # Second tick in same hour should be deduplicated
    worker.tick()
    assert len(sent) == 1
