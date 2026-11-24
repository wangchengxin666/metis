from __future__ import annotations

import json

from app.db import SessionLocal
from app.models import LlmUsageLedger, Sandbox, SandboxRuntimeSnapshot, SandboxTemplate


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


def test_playbooks_presets_yaml_import_export_and_parallel_stage_orchestration(api_env):
    client, fake_docker, _reg = api_env
    _login_admin(client)

    # 1. Verify 3 built-in enterprise showcase Playbooks are seeded
    pb_list = client.get("/api/playbooks").json()["items"]
    keys = {p["key"] for p in pb_list}
    assert {"rd-feature-delivery", "bi-analysis-report", "contract-compliance-review"}.issubset(keys)
    rd_pb = next(p for p in pb_list if p["key"] == "rd-feature-delivery")

    # 2. Export YAML & import custom declarative Playbook
    exp = client.get(f"/api/playbooks/{rd_pb['id']}/export?format=yaml")
    assert exp.status_code == 200
    assert "rd-feature-delivery" in exp.text

    custom_yaml = """
key: security-patch-drill
name: Emergency Security Patch Flow
category: engineering
estimated_manual_hours: 5.0
input_fields:
  - key: cve_id
    label: CVE ID
    type: text
stages:
  - id: triage
    name: CVE Triage
    approval_required: true
    prompt_template: "Triage {{cve_id}}"
  - id: patch
    name: Apply Patch
    prompt_template: "Patch {{cve_id}} using {{previous_outputs}}"
"""
    imp = client.post(
        "/api/playbooks/import",
        json={"content": custom_yaml, "overwrite": False},
    )
    assert imp.status_code == 201, imp.text
    assert imp.json()["key"] == "security-patch-drill"

    # 3. Provision two digital employees and launch R&D Playbook with uploaded spec file
    dev_sbx = client.post(
        "/api/sandboxes",
        json={"email": "admin@example.com", "slug": "eng-dev", "role_title": "全栈研发工程师"},
    ).json()
    qa_sbx = client.post(
        "/api/sandboxes",
        json={"email": "admin@example.com", "slug": "eng-qa", "role_title": "测试与质量保障专家"},
    ).json()

    run_res = client.post(
        f"/api/playbooks/{rd_pb['id']}/runs",
        data={
            "title": "Invoice Export Feature",
            "inputs_json": json.dumps(
                {
                    "feature_title": "Invoice Export",
                    "business_goal": "Allow enterprise finance teams to export PDF invoices",
                }
            ),
            "role_assignments_json": json.dumps(
                {
                    "prd": dev_sbx["id"],
                    "arch": dev_sbx["id"],
                    "impl": dev_sbx["id"],
                    "qa": qa_sbx["id"],
                    "release": dev_sbx["id"],
                }
            ),
        },
        files=[("files", ("spec.md", b"# Invoice Export Spec\n", "text/markdown"))],
    )
    assert run_res.status_code == 201, run_res.text
    run = run_res.json()
    # Stage 0 MUST start in 'running' so the digital employee executes first (never awaiting_approval before work!)
    assert run["status"] == "running"
    assert run["steps"][0]["status"] == "running"
    assert run["steps"][1]["status"] == "pending"
    assert len(run["uploaded_files"]) >= 1
    assert any(c[0] == "write_intake_files" for c in fake_docker.calls)

    # Simulate @eng-dev completing Stage 0 (PRD) via live sandbox-mesh reply -> transitions to awaiting_approval!
    stage0_msg = run["steps"][0]["task_id"]
    fake_docker.mesh_progress[("eng-dev", stage0_msg)] = {
        "completed": True,
        "reply_text": "PRD v1 drafted with user stories and invoice schema.",
        "artifacts": ["/home/workspace/docs/invoice-prd.md"],
    }
    synced0 = client.get("/api/playbook-runs").json()["items"][0]
    assert synced0["status"] == "awaiting_approval"
    assert synced0["steps"][0]["status"] == "awaiting_approval"
    assert "PRD v1 drafted" in synced0["steps"][0]["output_summary"]
    assert "/home/workspace/docs/invoice-prd.md" in synced0["steps"][0]["artifacts"]

    # Human requests revision (打回重做) -> re-wakes @eng-dev and flips Stage 0 back to 'running'!
    rev_res = client.post(
        f"/api/playbook-runs/{run['id']}/steps/{synced0['steps'][0]['id']}/decide",
        json={"decision": "revise", "note": "请补充增值税发票校验规则"},
    ).json()
    assert rev_res["status"] == "running"
    assert rev_res["steps"][0]["status"] == "running"
    stage0_rev_msg = rev_res["steps"][0]["task_id"]
    assert stage0_rev_msg != stage0_msg

    # @eng-dev replies with revised PRD -> transitions back to awaiting_approval
    fake_docker.mesh_progress[("eng-dev", stage0_rev_msg)] = {
        "completed": True,
        "reply_text": "PRD v2 finalized including VAT validation rules.",
        "artifacts": ["/home/workspace/docs/invoice-prd-v2.md"],
    }
    synced0_v2 = client.get("/api/playbook-runs").json()["items"][0]
    assert synced0_v2["status"] == "awaiting_approval"
    assert "PRD v2 finalized" in synced0_v2["steps"][0]["output_summary"]

    # Approve Stage 0 (PRD) -> automatically dispatches Stage 1 (Arch) in 'running'
    r1 = client.post(
        f"/api/playbook-runs/{run['id']}/steps/{synced0_v2['steps'][0]['id']}/decide",
        json={"decision": "approved", "note": "PRD approved"},
    ).json()
    assert r1["steps"][0]["status"] == "completed"
    assert r1["steps"][1]["status"] == "running"

    # Simulate @eng-dev finishing Stage 1 (Arch, approval_required=False) -> auto-completes AND dispatches Stage 2 (Impl) sequentially before QA!
    stage1_msg = r1["steps"][1]["task_id"]
    fake_docker.mesh_progress[("eng-dev", stage1_msg)] = {
        "completed": True,
        "reply_text": "REST API designed: POST /api/invoices/export",
        "artifacts": [],
    }
    r2 = client.get("/api/playbook-runs").json()["items"][0]
    assert r2["steps"][1]["status"] == "completed"
    assert r2["steps"][2]["status"] == "running"
    assert r2["steps"][3]["status"] == "pending"  # QA waits for Impl to finish!
    assert r2["steps"][4]["status"] == "pending"

    # @eng-dev finishes Stage 2 (Impl) -> Stage 3 (QA) dispatches next
    fake_docker.mesh_progress[("eng-dev", r2["steps"][2]["task_id"])] = {
        "completed": True,
        "reply_text": "Implemented invoice export API and UI.",
        "artifacts": ["https://github.com/acme/app/pull/88"],
    }
    r3 = client.get("/api/playbook-runs").json()["items"][0]
    assert r3["steps"][2]["status"] == "completed"
    assert r3["steps"][3]["status"] == "running"
    assert r3["steps"][4]["status"] == "pending"  # QA still running

    fake_docker.mesh_progress[("eng-qa", r3["steps"][3]["task_id"])] = {
        "completed": True,
        "reply_text": "All 42 e2e tests passed.",
        "artifacts": [],
    }
    r4 = client.get("/api/playbook-runs").json()["items"][0]
    assert r4["steps"][3]["status"] == "completed"
    assert r4["status"] == "running"
    assert r4["steps"][4]["status"] == "running"

    # @eng-dev finishes Stage 4 (Release, approval_required=True) -> transitions to awaiting_approval
    fake_docker.mesh_progress[("eng-dev", r4["steps"][4]["task_id"])] = {
        "completed": True,
        "reply_text": "Release notes ready; preview online.",
        "artifacts": ["http://localhost:9000/s/eng-dev/apps/web/"],
    }
    r4_ready = client.get("/api/playbook-runs").json()["items"][0]
    assert r4_ready["status"] == "awaiting_approval"
    assert r4_ready["steps"][4]["status"] == "awaiting_approval"

    # Final approval completes entire Playbook Run
    r5 = client.post(
        f"/api/playbook-runs/{run['id']}/steps/{r4_ready['steps'][4]['id']}/decide",
        json={"decision": "approved"},
    ).json()
    assert r5["status"] == "completed"
    assert r5["progress_done"] == 5
    assert any("pull/88" in a["value"] for a in r5["artifacts"])
    assert any("/apps/web/" in a["value"] for a in r5["artifacts"])


def test_workforce_scorecard_roi_metrics_exports_and_rbac(api_env):
    client, _fake_docker, _reg = api_env
    _create_user_and_login(client, "lead@corp.com", display_name="Lead")
    _create_user_and_login(client, "member@corp.com", display_name="Member")

    _login_admin(client)
    team_a = client.post(
        "/api/teams",
        json={"name": "Core R&D", "department": "Engineering", "lead_emails": ["lead@corp.com"]},
    ).json()
    team_b = client.post(
        "/api/teams",
        json={"name": "Sales Ops", "department": "Sales"},
    ).json()

    sbx = client.post(
        "/api/sandboxes",
        json={"email": "lead@corp.com", "slug": "roi-bot", "team_ids": [team_a["id"]]},
    ).json()

    # Record 1 approval via API first (before seeding our custom snapshot so refresh doesn't overwrite it)
    client.post(f"/api/sandboxes/{sbx['id']}/approvals/t1", json={"decision": "approved"})

    # Seed snapshot with 2 done tasks + 1 blocked task + real LLM cost ledger
    with SessionLocal() as db:
        snap_payload = {
            "online": True,
            "mesh_summary": {
                "tasks": [
                    {
                        "id": "t1",
                        "room_id": "r1",
                        "title": "Build API",
                        "status": "done",
                        "assignee_slug": "roi-bot",
                        "approval_required": True,
                        "approval_status": "approved",
                        "created_at": 1760000000000,
                        "updated_at": 1760007200000,  # 2 hours cycle
                    },
                    {
                        "id": "t2",
                        "room_id": "r1",
                        "title": "Write Tests",
                        "status": "done",
                        "assignee_slug": "roi-bot",
                        "created_at": 1760000000000,
                        "updated_at": 1760003600000,  # 1 hour cycle
                    },
                    {
                        "id": "t3",
                        "room_id": "r1",
                        "title": "Deploy Prod",
                        "status": "blocked",
                        "assignee_slug": "roi-bot",
                        "approval_required": True,
                        "approval_status": "pending",
                    },
                ]
            },
        }
        existing_snap = db.get(SandboxRuntimeSnapshot, sbx["id"])
        if existing_snap:
            existing_snap.payload_json = json.dumps(snap_payload)
            existing_snap.online = True
            existing_snap.status = "running"
        else:
            db.add(
                SandboxRuntimeSnapshot(
                    sandbox_id=sbx["id"],
                    sandbox_slug="roi-bot",
                    online=True,
                    status="running",
                    payload_json=json.dumps(snap_payload),
                )
            )
        db.add(
            LlmUsageLedger(
                sandbox_id=sbx["id"],
                sandbox_slug="roi-bot",
                team_id=team_a["id"],
                llm_profile_id="prof-1",
                model="deepseek-chat",
                input_tokens=50000,
                output_tokens=20000,
                total_tokens=70000,
                cost_amount=1.50,
            )
        )
        db.commit()

    sc = client.get("/api/scorecard?days=30&hourly_rate_usd=50").json()
    k = sc["kpis"]
    assert k["done_tasks"] == 2
    assert k["blocked_tasks"] == 1
    assert k["completion_rate_pct"] == 66.7
    assert k["first_pass_approval_rate_pct"] == 100.0
    assert k["avg_cycle_hours"] == 1.5
    assert k["total_cost_usd"] == 1.5
    assert k["estimated_hours_saved"] == 3.0
    assert k["estimated_value_usd"] == 150.0
    assert k["roi_multiple"] == 100.0
    assert len(sc["by_team"]) == 1

    # Exports (CSV & Markdown)
    csv_res = client.get("/api/scorecard/export?format=csv&days=30")
    assert csv_res.status_code == 200
    assert "roi-bot" in csv_res.text

    md_res = client.get("/api/scorecard/export?format=markdown&days=30&hourly_rate_usd=50")
    assert md_res.status_code == 200
    assert "Metis Workforce ROI" in md_res.text
    assert "100.0x" in md_res.text

    # RBAC: Team Lead can view Team A, 403 on Team B; regular member gets 403
    _login_user(client, "lead@corp.com")
    assert client.get(f"/api/scorecard?team_id={team_a['id']}").status_code == 200
    assert client.get(f"/api/scorecard?team_id={team_b['id']}").status_code == 403

    _login_user(client, "member@corp.com")
    assert client.get("/api/scorecard").status_code == 403


def test_memory_hub_inspect_and_canary_sop_and_team_doc_promotion(api_env):
    client, fake_docker, _reg = api_env
    _create_user_and_login(client, "lead@corp.com", display_name="Team Lead")

    _login_admin(client)
    team = client.post(
        "/api/teams",
        json={"name": "Platform Guild", "lead_emails": ["lead@corp.com"]},
    ).json()

    src_sbx = client.post(
        "/api/sandboxes",
        json={"email": "lead@corp.com", "slug": "senior-eng", "team_ids": [team["id"]]},
    ).json()
    canary_sbx = client.post(
        "/api/sandboxes",
        json={"email": "lead@corp.com", "slug": "canary-eng", "team_ids": [team["id"]]},
    ).json()
    untouched_sbx = client.post(
        "/api/sandboxes",
        json={"email": "lead@corp.com", "slug": "holdout-eng", "team_ids": [team["id"]]},
    ).json()

    # 1. Inspect memories from source digital employee
    mem_res = client.get(f"/api/memory-hub/sandboxes/{src_sbx['id']}/memories")
    assert mem_res.status_code == 200
    mems = mem_res.json()["memories"]
    assert len(mems) == 2
    first_mem = mems[0]

    # 2. Admin promotes memory into default Template SOP with canary rollout ONLY to canary-eng!
    tpl = client.get("/api/templates").json()[0]
    assert tpl["sop_version"] == 1

    promo_res = client.post(
        "/api/memory-hub/promote",
        json={
            "source_sandbox_id": src_sbx["id"],
            "memory_id": first_mem["id"],
            "memory_title": first_mem["title"],
            "memory_category": first_mem["category"],
            "promoted_content": first_mem["content"],
            "target_type": "template_sop",
            "target_template_id": tpl["id"],
            "rollout_sandbox_ids": [canary_sbx["id"]],
        },
    )
    assert promo_res.status_code == 201, promo_res.text
    promo = promo_res.json()["promotion"]
    assert promo["sop_version"] == 2
    assert promo_res.json()["rollout"]["synced"] == 1

    with SessionLocal() as db:
        updated_tpl = db.get(SandboxTemplate, tpl["id"])
        assert updated_tpl is not None
        assert updated_tpl.sop_version == 2
        assert "[SOP v2]" in (updated_tpl.role_sop or "")

        canary_obj = db.get(Sandbox, canary_sbx["id"])
        holdout_obj = db.get(Sandbox, untouched_sbx["id"])
        assert canary_obj is not None and "[SOP v2]" in (canary_obj.role_sop or "")
        assert holdout_obj is not None and "[SOP v2]" not in (holdout_obj.role_sop or "")

    # 3. Team Lead cannot mutate global Template SOP (403), CAN promote to own Team Shared Doc (201)
    _login_user(client, "lead@corp.com")
    forbid_tpl = client.post(
        "/api/memory-hub/promote",
        json={
            "source_sandbox_id": src_sbx["id"],
            "memory_id": mems[1]["id"],
            "memory_title": mems[1]["title"],
            "memory_category": mems[1]["category"],
            "promoted_content": mems[1]["content"],
            "target_type": "template_sop",
            "target_template_id": tpl["id"],
        },
    )
    assert forbid_tpl.status_code == 403

    team_promo = client.post(
        "/api/memory-hub/promote",
        json={
            "source_sandbox_id": src_sbx["id"],
            "memory_id": mems[1]["id"],
            "memory_title": mems[1]["title"],
            "memory_category": mems[1]["category"],
            "promoted_content": mems[1]["content"],
            "target_type": "team_shared_doc",
            "target_team_id": team["id"],
            "target_file_name": "DB_BEST_PRACTICES.md",
            "rollout_sandbox_ids": [canary_sbx["id"]],
        },
    )
    assert team_promo.status_code == 201, team_promo.text
    assert any(
        c[0] == "sync_shared_project_file" and c[1][1] == "DB_BEST_PRACTICES.md"
        for c in fake_docker.calls
    )

    hist = client.get("/api/memory-hub/promotions").json()["items"]
    assert len(hist) >= 1


def test_project_workspace_self_service_archive_and_scoping(api_env):
    """Regular users can create Projects (becoming Project Lead), cannot attach forbidden sandboxes,
    can archive/restore projects, and Playbook runs + Deliverables filter cleanly by team_id."""
    client, _fake_docker, _reg = api_env
    _create_user_and_login(client, "alice@corp.com", display_name="Alice")
    _create_user_and_login(client, "bob@corp.com", display_name="Bob")

    _login_admin(client)
    alice_sbx = client.post(
        "/api/sandboxes",
        json={"email": "alice@corp.com", "slug": "alice-dev"},
    ).json()
    bob_sbx = client.post(
        "/api/sandboxes",
        json={"email": "bob@corp.com", "slug": "bob-priv"},
    ).json()

    # Alice (non-admin) cannot attach Bob's private sandbox when creating a project
    _login_user(client, "alice@corp.com")
    forbid = client.post(
        "/api/teams",
        json={"name": "Stolen Project", "sandbox_ids": [bob_sbx["id"]]},
    )
    assert forbid.status_code == 403

    # Alice creates her own project with her own sandbox -> automatically becomes lead
    proj_res = client.post(
        "/api/teams",
        json={
            "name": "Invoice V2",
            "department": "Finance R&D",
            "sandbox_ids": [alice_sbx["id"]],
        },
    )
    assert proj_res.status_code == 201, proj_res.text
    proj = proj_res.json()
    assert proj["status"] == "active"
    assert proj["my_role"] == "lead"
    assert proj["can_manage"] is True
    assert len(proj["sandboxes"]) == 1

    # Alice launches a Playbook scoped to this project -> team_id filter isolates it
    rd_pb = next(p for p in client.get("/api/playbooks").json()["items"] if p["key"] == "rd-feature-delivery")
    run_res = client.post(
        f"/api/playbooks/{rd_pb['id']}/runs",
        data={
            "title": "Invoice PDF",
            "team_id": proj["id"],
            "inputs_json": json.dumps({"feature_title": "Invoice PDF", "business_goal": "Export PDFs"}),
            "role_assignments_json": json.dumps({"prd": alice_sbx["id"]}),
        },
    )
    assert run_res.status_code == 201, run_res.text
    scoped_runs = client.get(f"/api/playbook-runs?team_id={proj['id']}").json()["items"]
    assert len(scoped_runs) == 1
    assert scoped_runs[0]["team_id"] == proj["id"]
    empty_runs = client.get("/api/playbook-runs?team_id=nonexistent").json()["items"]
    assert empty_runs == []

    # Project-scoped deliverables filter works
    deliv_res = client.get(f"/api/workspace/deliverables?team_id={proj['id']}")
    assert deliv_res.status_code == 200

    # Project Lead can archive and restore project; status filter reflects it
    arch = client.patch(f"/api/teams/{proj['id']}", json={"status": "archived"})
    assert arch.status_code == 200 and arch.json()["status"] == "archived"
    assert client.get("/api/teams?status=active").json()["items"] == []
    assert len(client.get("/api/teams?status=archived").json()["items"]) == 1

    restored = client.patch(f"/api/teams/{proj['id']}", json={"status": "active"})
    assert restored.status_code == 200 and restored.json()["status"] == "active"

    # New SPA routes return 200 or 503 (never 404)
    for spa_path in ("/projects", f"/projects/{proj['id']}", "/analytics", "/admin/workforce", "/admin/ops"):
        resp = client.get(spa_path)
        assert resp.status_code != 404, f"{spa_path} returned 404"


def test_project_group_auto_sync_directory_isolation_and_playbook_relay(api_env):
    """Verify Step 2 end-to-end:
    1) Attaching >=2 digital employees auto-creates & saves Team.mesh_room_id;
    2) Switching moderator updates single moderator crown & re-syncs existing room_id;
    3) Shared docs & memory promotion isolate into /home/workspace/shared/<project-slug>/;
    4) Playbook execution_mode='project_group' relays into Team.mesh_room_id & injects project shared dir;
    5) Detaching down to <2 employees removes detached member from live group & clears mesh_room_id.
    """
    client, fake_docker, _reg = api_env
    _login_admin(client)

    s1 = client.post("/api/sandboxes", json={"email": "admin@example.com", "slug": "grp-lead", "role_title": "Tech Lead"}).json()
    s2 = client.post("/api/sandboxes", json={"email": "admin@example.com", "slug": "grp-dev", "role_title": "Full-Stack"}).json()
    s3 = client.post("/api/sandboxes", json={"email": "admin@example.com", "slug": "grp-qa", "role_title": "QA"}).json()

    # Create project with 1 employee -> no group chat yet
    proj = client.post(
        "/api/teams",
        json={"name": "Apollo Billing", "slug": "apollo-billing", "sandbox_ids": [s1["id"]]},
    ).json()
    assert proj["mesh_room_id"] is None

    # Attach 2nd employee -> automatically creates live project group chat & persists mesh_room_id
    proj2 = client.post(
        f"/api/teams/{proj['id']}/sandboxes",
        json={"sandbox_id": s2["id"]},
    ).json()
    assert proj2["mesh_room_id"] == "grp_test_apollo-billing"
    assemble_calls = [c for c in fake_docker.calls if c[0] == "assemble_mesh_team"]
    assert assemble_calls[-1][1][3] == "apollo-billing"  # project_slug

    # Switch moderator to s2 -> keeps SAME mesh_room_id & single moderator flag
    proj_mod = client.post(
        f"/api/teams/{proj['id']}/sandboxes",
        json={"sandbox_id": s2["id"], "is_moderator": True},
    ).json()
    assert proj_mod["mesh_room_id"] == "grp_test_apollo-billing"
    assert sum(1 for x in proj_mod["sandboxes"] if x["is_moderator"]) == 1
    assert next(x for x in proj_mod["sandboxes"] if x["id"] == s2["id"])["is_moderator"] is True
    assemble_calls = [c for c in fake_docker.calls if c[0] == "assemble_mesh_team"]
    assert assemble_calls[-1][1][2] == "grp-dev"  # moderator_slug
    assert assemble_calls[-1][1][4] == "grp_test_apollo-billing"  # existing_room_id preserved

    # Manual sync endpoint works cleanly
    sync_res = client.post(f"/api/teams/{proj['id']}/sync-group")
    assert sync_res.status_code == 200
    assert sync_res.json()["sync"]["ok"] is True
    assert sync_res.json()["team"]["mesh_room_id"] == "grp_test_apollo-billing"

    # Shared docs isolate into /home/workspace/shared/apollo-billing/
    doc_res = client.post(
        f"/api/teams/{proj['id']}/shared-docs",
        json={"file_name": "API_SPEC.md", "content": "# Billing API\n"},
    )
    assert doc_res.status_code == 200
    assert doc_res.json()["path"] == "/home/workspace/shared/apollo-billing/API_SPEC.md"
    assert doc_res.json()["project_slug"] == "apollo-billing"

    # Playbook launched in project_group mode relays directly into team.mesh_room_id & injects project shared dir
    rd_pb = next(p for p in client.get("/api/playbooks").json()["items"] if p["key"] == "rd-feature-delivery")
    run_grp = client.post(
        f"/api/playbooks/{rd_pb['id']}/runs",
        data={
            "title": "Billing Webhook Relay",
            "team_id": proj["id"],
            "execution_mode": "project_group",
            "inputs_json": json.dumps({"feature_title": "Billing Webhook", "business_goal": "Realtime billing alerts"}),
            "role_assignments_json": json.dumps({"prd": s1["id"], "arch": s2["id"]}),
        },
    ).json()
    assert run_grp["execution_mode"] == "project_group"
    assert run_grp["steps"][0]["room_id"] == "grp_test_apollo-billing"
    dispatch_calls = [c for c in fake_docker.calls if c[0] == "dispatch_mesh_task"]
    assert dispatch_calls[-1][1][4] == "grp_test_apollo-billing"
    assert "/home/workspace/shared/apollo-billing/" in dispatch_calls[-1][1][5]

    # Playbook launched in isolated mode does NOT reuse project group room
    run_iso = client.post(
        f"/api/playbooks/{rd_pb['id']}/runs",
        data={
            "title": "Solo Draft",
            "team_id": proj["id"],
            "execution_mode": "isolated",
            "inputs_json": json.dumps({"feature_title": "Solo Draft", "business_goal": "Private spike"}),
            "role_assignments_json": json.dumps({"prd": s1["id"]}),
        },
    ).json()
    assert run_iso["execution_mode"] == "isolated"
    assert run_iso["steps"][0]["room_id"] != "grp_test_apollo-billing"

    # Attach 3rd employee, then detach back down to 1 -> live remove called and mesh_room_id cleared
    client.post(f"/api/teams/{proj['id']}/sandboxes", json={"sandbox_id": s3["id"]})
    proj_two = client.delete(f"/api/teams/{proj['id']}/sandboxes/{s3['id']}").json()
    assert proj_two["mesh_room_id"] == "grp_test_apollo-billing"

    proj_one = client.delete(f"/api/teams/{proj['id']}/sandboxes/{s2['id']}").json()
    assert proj_one["mesh_room_id"] is None
    assert any(
        c[0] == "remove_mesh_group_member" and c[1] == ("grp_test_apollo-billing", "grp-dev")
        for c in fake_docker.calls
    )


def test_patch_sandbox_task_unblocks_and_refreshes_inbox_across_team_peers(api_env):
    client, fake_docker, _reg = api_env
    _login_admin(client)

    s1 = client.post("/api/sandboxes", json={"email": "admin@example.com", "slug": "blk-lead"}).json()
    s2 = client.post("/api/sandboxes", json={"email": "admin@example.com", "slug": "blk-qa"}).json()
    client.post(
        "/api/teams",
        json={"name": "Blocker Ops", "slug": "blocker-ops", "sandbox_ids": [s1["id"], s2["id"]]},
    )

    # Seed snapshots -> FakeDockerService starts with task_1 in status='blocked'
    inbox_before = client.get("/api/workspace/inbox?refresh=true").json()
    assert inbox_before["summary"]["blocked_tasks_count"] >= 1
    assert any(t["id"] == "task_1" and t["status"] == "blocked" for t in inbox_before["blocked_tasks"])

    # Resolve task_1 via PATCH /api/sandboxes/{id}/tasks/{task_id}
    patch_res = client.patch(
        f"/api/sandboxes/{s1['id']}/tasks/task_1",
        json={"status": "done", "summary": "Resolved by operator", "room_id": "grp_test_123"},
    )
    assert patch_res.status_code == 200, patch_res.text
    assert patch_res.json()["status"] == "done"
    assert any(
        c[0] == "update_mesh_task_status" and c[1][0] == "blk-lead" and c[1][1] == "task_1" and c[1][2] == "done"
        for c in fake_docker.calls
    )

    # Refresh peer s2 too (simulate mesh broadcast arriving at peer) & confirm blocked count drops cleanly
    fake_docker.task_status_overrides[("blk-qa", "task_1")] = "done"
    client.patch(
        f"/api/sandboxes/{s2['id']}/tasks/task_1",
        json={"status": "cancelled", "room_id": "grp_test_123"},
    )
    inbox_after = client.get("/api/workspace/inbox").json()
    assert inbox_after["summary"]["blocked_tasks_count"] == 0
    assert inbox_after["blocked_tasks"] == []

    # Verify audit entry recorded under workforce category
    audit_res = client.get("/api/audit-logs?category=workforce&q=task_update").json()
    assert any(item["action"] == "sandbox.task_update" for item in audit_res["items"])


def test_workspace_inbox_task_groups_and_playbook_approvals(api_env):
    from app.models import Playbook, PlaybookRun, PlaybookStepRun

    client, fake_docker, _reg = api_env
    _login_admin(client)

    s1 = client.post("/api/sandboxes", json={"email": "admin@example.com", "slug": "grp-lead"}).json()
    s2 = client.post("/api/sandboxes", json={"email": "admin@example.com", "slug": "grp-qa"}).json()
    proj = client.post(
        "/api/teams",
        json={"name": "Portal Alpha", "slug": "portal-alpha", "sandbox_ids": [s1["id"], s2["id"]]},
    ).json()
    room_id = proj["mesh_room_id"]

    # Inject multi-subtask thread (2 done + 1 cancelled) into runtime inspection
    def fake_inspect(sbx: Sandbox):
        return {
            "online": True,
            "slug": sbx.slug,
            "status": "running",
            "exposed_apps": [],
            "user_services": [],
            "cron_jobs": [],
            "shared_files": [],
            "mesh_summary": {
                "role": sbx.role_title or "",
                "peers": [],
                "groups": [{"id": room_id, "name": "Portal Alpha", "member_count": 2}],
                "tasks": [
                    {
                        "id": "tsk_a",
                        "room_id": room_id,
                        "room_name": "Portal Alpha",
                        "thread_id": "thr_1",
                        "thread_title": "Alpha 看板一期交付",
                        "title": "页面开发",
                        "status": "done",
                        "assignee_slug": "grp-lead",
                        "created_at": 1000,
                        "updated_at": 2000,
                    },
                    {
                        "id": "tsk_b_old",
                        "room_id": room_id,
                        "room_name": "Portal Alpha",
                        "thread_id": "thr_1",
                        "thread_title": "Alpha 看板一期交付",
                        "title": "QA 初测",
                        "status": "cancelled",
                        "assignee_slug": "grp-qa",
                        "created_at": 1500,
                        "updated_at": 2100,
                    },
                    {
                        "id": "tsk_b_final",
                        "room_id": room_id,
                        "room_name": "Portal Alpha",
                        "thread_id": "thr_1",
                        "thread_title": "Alpha 看板一期交付",
                        "title": "QA 终审",
                        "status": "done",
                        "assignee_slug": "grp-qa",
                        "created_at": 2200,
                        "updated_at": 2500,
                    },
                ],
                "active_tasks_count": 0,
                "blocked_tasks_count": 0,
                "done_tasks_count": 2,
                "pending_approvals": [],
            },
        }

    fake_docker.inspect_workforce_runtime = fake_inspect

    # Seed a Playbook step awaiting approval
    with SessionLocal() as db:
        pb = db.query(Playbook).first()
        assert pb is not None
        run = PlaybookRun(
            playbook_id=pb.id,
            playbook_key=pb.key,
            playbook_name=pb.name,
            team_id=proj["id"],
            execution_mode="project_group",
            title="Alpha 生产发布审批",
            status="awaiting_approval",
            created_by="admin@example.com",
        )
        db.add(run)
        db.flush()
        step = PlaybookStepRun(
            run_id=run.id,
            stage_index=0,
            stage_id="design",
            stage_name="技术方案评审",
            sandbox_id=s1["id"],
            sandbox_slug=s1["slug"],
            room_id=room_id,
            approval_required=True,
            approval_status="pending",
            status="awaiting_approval",
            output_summary="已完成架构文档，请确认是否进入开发。",
        )
        db.add(step)
        db.commit()

    inbox = client.get("/api/workspace/inbox?refresh=true").json()
    assert inbox["summary"]["playbook_approvals_count"] == 1
    assert inbox["summary"]["pending_approvals_count"] == 1
    assert inbox["summary"]["action_required_count"] == 1
    assert inbox["summary"]["done_groups_count"] == 1
    assert len(inbox["playbook_approvals"]) == 1
    assert inbox["playbook_approvals"][0]["run_title"] == "Alpha 生产发布审批"
    assert inbox["playbook_approvals"][0]["project_team_name"] == "Portal Alpha"

    # All 3 subtasks in thr_1 fold into ONE done parent task group with 2/2 progress + 1 cancelled
    assert len(inbox["task_groups"]) == 1
    grp = inbox["task_groups"][0]
    assert grp["title"] == "Alpha 看板一期交付"
    assert grp["status"] == "done"
    assert grp["project_team_id"] == proj["id"]
    assert grp["counts"]["total"] == 2
    assert grp["counts"]["done"] == 2
    assert grp["counts"]["cancelled"] == 1
    assert [t["id"] for t in grp["tasks"]] == ["tsk_a", "tsk_b_old", "tsk_b_final"]


def test_playbook_team_lead_authoring_ai_draft_and_run_controls(api_env, monkeypatch):
    from app.models import LlmProfile
    from app.services import playbooks as pb_service

    client, fake_docker, _reg = api_env
    _login_admin(client)

    # Seed an LLM profile for AI draft generation
    with SessionLocal() as db:
        db.add(
            LlmProfile(
                name="Test Local LLM",
                base_url="http://mock-llm:8000/v1",
                model="qwen3.5-4b",
                api_protocol="openai-completions",
            )
        )
        db.commit()

    # Create a Team Lead user and an ordinary Member user
    _create_user_and_login(client, "lead-author@example.com", display_name="Team Lead")
    _create_user_and_login(client, "plain-member@example.com", display_name="Plain Member")
    _login_admin(client)

    s_a = client.post("/api/sandboxes", json={"email": "lead-author@example.com", "slug": "pb-dev"}).json()
    s_b = client.post("/api/sandboxes", json={"email": "lead-author@example.com", "slug": "pb-qa"}).json()
    proj = client.post(
        "/api/teams",
        json={
            "name": "Playbook Ops",
            "slug": "playbook-ops",
            "lead_emails": ["lead-author@example.com"],
            "member_emails": ["plain-member@example.com"],
            "sandbox_ids": [s_a["id"], s_b["id"]],
        },
    ).json()

    # 1. Ordinary member CANNOT create Playbook or call AI draft (403)
    _login_user(client, "plain-member@example.com")
    denied_create = client.post(
        "/api/playbooks",
        json={
            "name": "Member Blocked Flow",
            "stages": [{"id": "s1", "name": "Step 1", "prompt_template": "Do work"}],
        },
    )
    assert denied_create.status_code == 403
    denied_ai = client.post("/api/playbooks/ai-draft", json={"goal": "每周汇总项目进度"})
    assert denied_ai.status_code == 403

    # 2. Team Lead CAN call AI draft (mocked LLM call), create (auto-key), edit, and delete own Playbook,
    #    but CANNOT edit or delete a built-in Playbook (403)
    _login_user(client, "lead-author@example.com")
    monkeypatch.setattr(
        pb_service,
        "_call_llm_for_playbook_json",
        lambda profile, sys_p, usr_p: {
            "key": "weekly-digest",
            "name": "研发周报自动汇总流",
            "category": "operations",
            "description": "汇总进展并审批归档",
            "estimated_manual_hours": 3.0,
            "input_fields": [
                {"key": "week_label", "label": "周期", "type": "text", "required": True},
            ],
            "stages": [
                {
                    "id": "collect_code",
                    "name": "代码与测试汇总",
                    "role_hint": "研发",
                    "parallel_group": "gather",
                    "approval_required": False,
                    "prompt_template": "汇总 {{week_label}} 进展",
                },
                {
                    "id": "collect_qa",
                    "name": "质量数据汇总",
                    "role_hint": "QA",
                    "parallel_group": "gather",
                    "approval_required": False,
                    "prompt_template": "汇总 {{week_label}} 质量指标",
                },
                {
                    "id": "approve_digest",
                    "name": "审批发布",
                    "role_hint": "负责人",
                    "parallel_group": None,
                    "approval_required": True,
                    "prompt_template": "整合并提交审批 {{previous_outputs}}",
                },
            ],
            "deliverables_checklist": ["周报正文"],
        },
    )

    ai_res = client.post("/api/playbooks/ai-draft", json={"goal": "每周五汇总代码和质量数据出周报并审批"})
    assert ai_res.status_code == 200, ai_res.text
    draft = ai_res.json()["draft"]
    assert draft["name"] == "研发周报自动汇总流"
    assert len(draft["stages"]) == 3

    # Create without explicit key -> auto-generates unique key
    draft_no_key = {**draft, "key": None}
    created_pb = client.post("/api/playbooks", json=draft_no_key)
    assert created_pb.status_code == 201, created_pb.text
    pb_data = created_pb.json()
    assert pb_data["key"]
    assert pb_data["created_by"] == "lead-author@example.com"

    # Team Lead can edit own custom Playbook
    patched_pb = client.patch(
        f"/api/playbooks/{pb_data['id']}",
        json={"name": "研发周报汇总流 v2"},
    )
    assert patched_pb.status_code == 200
    assert patched_pb.json()["name"] == "研发周报汇总流 v2"

    # Team Lead CANNOT edit built-in Playbook
    all_pbs = client.get("/api/playbooks").json()["items"]
    builtin_pb = next(p for p in all_pbs if p["is_builtin"])
    assert client.patch(f"/api/playbooks/{builtin_pb['id']}", json={"name": "Hack"}).status_code == 403

    # 3. Run parallel-group custom Playbook & test Retry (reassign), Skip, and Cancel!
    run = client.post(
        f"/api/playbooks/{pb_data['id']}/runs",
        data={
            "title": "W48 周报",
            "team_id": proj["id"],
            "inputs_json": json.dumps({"week_label": "2026-W48"}),
            "role_assignments_json": json.dumps({"collect_code": s_a["id"], "collect_qa": s_b["id"], "approve_digest": s_a["id"]}),
        },
    ).json()
    assert run["steps"][0]["status"] == "running"
    assert run["steps"][1]["status"] == "running"  # parallel_group='gather' ran together!
    assert run["steps"][2]["status"] == "pending"
    assert run["role_assignments"]["collect_code"] == s_a["id"]

    # Retry step 0 and reassign to s_b
    retried = client.post(
        f"/api/playbook-runs/{run['id']}/steps/{run['steps'][0]['id']}/retry",
        json={"sandbox_id": s_b["id"], "note": "请补充性能数据"},
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["steps"][0]["sandbox_slug"] == "pb-qa"

    # Skip both parallel stages -> stage 2 auto-dispatches!
    s0_skip = client.post(
        f"/api/playbook-runs/{run['id']}/steps/{run['steps'][0]['id']}/skip",
        json={"note": "skip 0"},
    )
    assert s0_skip.status_code == 200
    assert s0_skip.json()["steps"][0]["status"] == "skipped"
    assert s0_skip.json()["steps"][2]["status"] == "pending"  # step 1 still running

    s1_skip = client.post(
        f"/api/playbook-runs/{run['id']}/steps/{run['steps'][1]['id']}/skip",
        json={"note": "skip 1"},
    )
    assert s1_skip.status_code == 200
    assert s1_skip.json()["steps"][2]["status"] == "running"

    # Cancel active run
    cancelled = client.post(
        f"/api/playbook-runs/{run['id']}/cancel",
        json={"note": "取消演示"},
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["steps"][2]["status"] == "skipped"

    # Team Lead can delete own custom Playbook
    assert client.delete(f"/api/playbooks/{pb_data['id']}").status_code == 200
