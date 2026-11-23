from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

# Configure isolated test environment BEFORE importing app.* so module-level
# Settings, SQLAlchemy engine, SessionMiddleware, and OAuth initialize cleanly.
_TEST_TMP_DIR = Path(tempfile.mkdtemp(prefix="dsh-manager-pytest-"))
_TEST_DB_PATH = _TEST_TMP_DIR / "test-manager.db"
_TEST_PLUGINS_DIR = _TEST_TMP_DIR / "plugins"
_TEST_PLUGINS_DIR.mkdir(parents=True, exist_ok=True)


def _seed_plugin_dir(root: Path) -> None:
    icons_dir = root / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>'
    (icons_dir / "sample-tool.svg").write_text(svg, encoding="utf-8")

    pkg_dir = root / "sample-tool"
    (pkg_dir / "locale").mkdir(parents=True, exist_ok=True)
    (pkg_dir / "node_modules" / "ignored").mkdir(parents=True, exist_ok=True)
    (pkg_dir / "node_modules" / "ignored" / "junk.js").write_text("x", encoding="utf-8")
    (pkg_dir / ".test").mkdir(parents=True, exist_ok=True)
    (pkg_dir / ".test" / "ignore.mjs").write_text("x", encoding="utf-8")
    (pkg_dir / "icon.svg").write_text(svg, encoding="utf-8")
    (pkg_dir / "index.js").write_text("export default {}\n", encoding="utf-8")
    (pkg_dir / "package.json").write_text(
        json.dumps(
            {
                "name": "@local/dsh-plugin-sample-tool",
                "version": "1.2.3",
                "description": "Sample test plugin",
                "author": "Test Author",
                "keywords": ["test", "sample"],
                "dsh": {"bundle": {"patch": "./cordis.patch.yml"}},
            }
        ),
        encoding="utf-8",
    )
    (pkg_dir / "locale" / "en.json").write_text(
        json.dumps({"title": "Sample Tool", "description": "English description"}),
        encoding="utf-8",
    )
    (pkg_dir / "locale" / "zh.json").write_text(
        json.dumps({"title": "示例工具", "description": "中文描述"}),
        encoding="utf-8",
    )
    (root / "index.json").write_text(
        json.dumps(
            {
                "format": 1,
                "title": {"en": "Test Index", "zh": "测试索引"},
                "description": {"en": "Desc", "zh": "描述"},
                "plugins": [
                    {
                        "name": "@local/dsh-plugin-sample-tool",
                        "title": {"en": "Sample Tool", "zh": "示例工具"},
                        "description": {"en": "English description", "zh": "中文描述"},
                        "icon": "icons/sample-tool.svg",
                        "versions": [
                            {
                                "version": "1.2.3",
                                "source": {
                                    "type": "npm",
                                    "registry": "http://localhost:9000/plugins/npm",
                                },
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )


_seed_plugin_dir(_TEST_PLUGINS_DIR)

os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TEST_DB_PATH.as_posix()}")
os.environ["SECRET_KEY"] = "test-secret-key-for-pytest-32-chars-minimum"
os.environ["MANAGER_AUTH_MODE"] = "token"
os.environ["MANAGER_ADMIN_EMAIL"] = "admin@example.com"
os.environ["MANAGER_ADMIN_TOKEN"] = "test-admin-token"
os.environ["MANAGER_PUBLIC_URL"] = "http://localhost:9000"
os.environ["BACKGROUND_TASKS"] = "false"
os.environ["PLUGINS_DIR"] = str(_TEST_PLUGINS_DIR)
os.environ["SANDBOX_AUTO_INSTALL_PLUGINS"] = "sample-tool"

from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import SessionLocal, init_db
from app.main import app
from app.models import (
    AuditLog,
    LlmProfile,
    OidcProvider,
    PlatformAdmin,
    PlatformSetting,
    Sandbox,
    SandboxTemplate,
    User,
)
from app.plugin_registry import PluginRegistryService
from app.services import ensure_bootstrap_admin, ensure_default_templates


class FakeDockerService:
    """In-memory mock replacement for DockerService used across unit and API tests."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.containers: dict[str, dict[str, Any]] = {}
        self.fail_on_create: Exception | None = None
        self.fail_on_health: Exception | None = None
        self.client = MagicMock()
        self.client.ping.return_value = True

    def container_name(self, sandbox: Sandbox) -> str:
        return f"dsh-sbx-{sandbox.slug}"

    def ping(self) -> bool:
        return bool(self.client.ping())

    def upstream_origin(self, sandbox: Sandbox) -> str:
        return f"http://dsh-sbx-{sandbox.slug}:8080"

    def list_local_images(self) -> list[dict[str, str | float]]:
        return [
            {
                "full_name": "dsh-sandbox:latest",
                "repo": "dsh-sandbox",
                "tag": "latest",
                "id": "sha256:abc123",
                "size_mb": 512.0,
            }
        ]

    def create(self, sandbox: Sandbox):
        self.calls.append(("create", sandbox.slug))
        if self.fail_on_create:
            raise self.fail_on_create
        cid = f"cid-{sandbox.slug}"
        self.containers[sandbox.slug] = {"id": cid, "status": "running"}

        class _C:
            def __init__(self, c: str) -> None:
                self.id = c

        return _C(cid)

    def wait_healthy(self, sandbox: Sandbox) -> None:
        self.calls.append(("wait_healthy", sandbox.slug))
        if self.fail_on_health:
            raise self.fail_on_health

    def start(self, sandbox: Sandbox) -> str:
        self.calls.append(("start", sandbox.slug))
        self.containers[sandbox.slug] = {"id": f"cid-{sandbox.slug}", "status": "running"}
        return "running"

    def stop(self, sandbox: Sandbox) -> str:
        self.calls.append(("stop", sandbox.slug))
        if sandbox.slug in self.containers:
            self.containers[sandbox.slug]["status"] = "exited"
        return "stopped"

    def restart(self, sandbox: Sandbox) -> str:
        self.calls.append(("restart", sandbox.slug))
        self.containers[sandbox.slug] = {"id": f"cid-{sandbox.slug}", "status": "running"}
        return "running"

    def status(self, sandbox: Sandbox) -> str:
        item = self.containers.get(sandbox.slug)
        if not item:
            return "missing"
        return "running" if item["status"] == "running" else "stopped"

    def get(self, sandbox: Sandbox):
        from types import SimpleNamespace
        from app.docker_service import SandboxRuntimeError

        item = self.containers.get(sandbox.slug)
        if not item:
            raise SandboxRuntimeError(f"container missing: {sandbox.slug}")
        return SimpleNamespace(status=item["status"], id=item["id"], reload=lambda: None)

    def update_limits(self, sandbox: Sandbox) -> None:
        self.calls.append(
            ("update_limits", (sandbox.slug, sandbox.cpu_limit, sandbox.memory_limit))
        )

    def recreate(self, sandbox: Sandbox) -> None:
        self.calls.append(("recreate", sandbox.slug))
        self.containers[sandbox.slug] = {
            "id": f"cid-{sandbox.slug}-recreated",
            "status": "running",
        }

    def logs(self, sandbox: Sandbox, tail: int = 200) -> str:
        self.calls.append(("logs", (sandbox.slug, tail)))
        return f"[{sandbox.slug}] line1\n[{sandbox.slug}] line2\n"

    def launch_token_url(self, sandbox: Sandbox) -> str | None:
        self.calls.append(("launch_token_url", sandbox.slug))
        return None

    def stats(self, sandbox: Sandbox) -> dict[str, Any]:
        self.calls.append(("stats", sandbox.slug))
        return {
            "cpu_percent": 12.5,
            "memory_usage_mb": 256.0,
            "memory_limit_mb": 4096.0,
            **self.workspace_disk_usage(sandbox),
        }

    def export_workspace_tar(self, sandbox: Sandbox, exclude_caches: bool = False):
        self.calls.append(("export_workspace_tar", (sandbox.slug, exclude_caches)))
        return iter([b"fake-tar-chunk-1", b"fake-tar-chunk-2"])

    def workspace_disk_usage(self, sandbox: Sandbox) -> dict[str, Any]:
        return {
            "disk_usage_bytes": 128 * 1024 * 1024,
            "disk_usage_mb": 128.0,
            "disk_fs_total_mb": 20480.0,
            "disk_fs_avail_mb": 15360.0,
            "disk_fs_used_percent": 25.0,
        }

    def has_active_work(self, sandbox: Sandbox) -> tuple[bool, str]:
        return False, "idle"

    def restore_workspace_tar(
        self, sandbox: Sandbox, archive_fileobj, mode: str = "merge"
    ) -> dict[str, int | bool]:
        data = archive_fileobj.read()
        self.calls.append(("restore_workspace_tar", (sandbox.slug, mode, len(data))))
        return {"restored_entries": 2, "restarted_dsh": True}

    def sync_plugin_market(
        self,
        sandbox: Sandbox,
        reinstall_plugins: list[str] | None = None,
        force_reinstall: bool = False,
        extra_indexes: list[str] | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            ("sync_plugin_market", (sandbox.slug, reinstall_plugins, force_reinstall))
        )
        return {
            "slug": sandbox.slug,
            "ok": True,
            "reinstalled": reinstall_plugins or [],
            "detail": "synced",
        }

    def sync_llm_profile(
        self,
        sandbox: Sandbox,
        profile: LlmProfile,
        *,
        set_as_default: bool = True,
        replace_managed: bool = False,
    ) -> dict[str, Any]:
        self.calls.append(
            (
                "sync_llm_profile",
                (sandbox.slug, profile.id, set_as_default, replace_managed),
            )
        )
        item = self.containers.get(sandbox.slug)
        if not item or item.get("status") != "running":
            return {
                "slug": sandbox.slug,
                "sandbox_id": sandbox.id,
                "ok": False,
                "skipped": True,
                "detail": f"status={item.get('status') if item else 'missing'}",
            }
        return {
            "slug": sandbox.slug,
            "sandbox_id": sandbox.id,
            "ok": True,
            "skipped": False,
            "provider": f"mgr-{profile.id[:8]}",
            "model": profile.model,
            "set_as_default": set_as_default,
            "detail": "hmr-synced",
        }

    def sync_brand_theme(
        self,
        sandbox: Sandbox,
        brand_config: dict[str, Any],
    ) -> dict[str, Any]:
        self.calls.append(("sync_brand_theme", (sandbox.slug, brand_config.get("brand_theme"))))
        return {"slug": sandbox.slug, "ok": True, "skipped": False, "detail": "hmr-synced"}

    def remove(self, sandbox: Sandbox, purge_volume: bool = False) -> None:
        self.calls.append(("remove", (sandbox.slug, purge_volume)))
        self.containers.pop(sandbox.slug, None)

    def sync_role_profile(self, sandbox: Sandbox) -> dict[str, Any]:
        self.calls.append(("sync_role_profile", (sandbox.slug, sandbox.role_title)))
        return {"slug": sandbox.slug, "ok": True, "skipped": False, "detail": "ROLE_SYNC_OK"}

    def assemble_mesh_team(
        self,
        sandboxes: list[Sandbox],
        team_name: str,
        moderator_slug: str | None = None,
    ) -> dict[str, Any]:
        slugs = [s.slug for s in sandboxes]
        eff_mod = moderator_slug if moderator_slug in slugs else slugs[0]
        self.calls.append(("assemble_mesh_team", (team_name, slugs, eff_mod)))
        return {
            "ok": True,
            "room_id": "grp_test_123",
            "team_name": team_name,
            "room_name": team_name,
            "moderator_slug": eff_mod,
            "members": slugs,
            "synced": len(slugs),
            "paired_members": len(slugs),
            "total": len(slugs),
            "results": [{"slug": s, "ok": True, "skipped": False, "detail": "assembled"} for s in slugs],
        }

    def inspect_workforce_runtime(self, sandbox: Sandbox) -> dict[str, Any]:
        self.calls.append(("inspect_workforce_runtime", sandbox.slug))
        return {
            "online": True,
            "slug": sandbox.slug,
            "status": "running",
            "exposed_apps": [
                {
                    "name": "web",
                    "target": "127.0.0.1:5173",
                    "mount_path": f"/s/{sandbox.slug}/apps/web/",
                    "url": f"http://localhost:9000/s/{sandbox.slug}/apps/web/",
                }
            ],
            "user_services": [
                {
                    "name": "web-dev",
                    "status": "RUNNING",
                    "detail": "pid 120, uptime 0:15:00",
                    "command": "npm run dev",
                    "directory": "/home/workspace",
                }
            ],
            "cron_jobs": [
                {
                    "schedule": "0 9 * * *",
                    "command": "/home/workspace/daily-check.sh",
                    "raw": "0 9 * * * /home/workspace/daily-check.sh",
                }
            ],
            "shared_files": [{"name": "TEAM_README.md", "size_bytes": 128}],
            "token_usage": {
                "estimated_tokens": 12500,
                "sessions_count": 3,
                "messages_count": 18,
                "daily_limit": getattr(sandbox, "daily_token_limit", None),
            },
            "mesh_summary": {
                "role": sandbox.role_title or "Full-Stack Engineer",
                "description": sandbox.role_description or "End-to-end delivery",
                "has_sop": bool(sandbox.role_sop),
                "peers": [{"slug": "lead", "owner_name": "Tech Lead", "role": "Architect", "status": "online"}],
                "groups": [{"id": "grp_test_123", "name": "Core R&D Team", "moderator_slug": "lead", "member_count": 3}],
                "tasks": [
                    {
                        "id": "task_1",
                        "room_id": "grp_test_123",
                        "title": "Approve v1.0 release",
                        "description": "Verify canary metrics before production promotion",
                        "status": "blocked",
                        "priority": "high",
                        "assignee_slug": sandbox.slug,
                        "approval_required": True,
                        "approval_status": "pending",
                    }
                ],
                "active_tasks_count": 2,
                "done_tasks_count": 5,
                "pending_approvals": [
                    {"id": "task_1", "room_id": "grp_test_123", "title": "Approve v1.0 release", "assignee_slug": sandbox.slug}
                ],
            },
        }

    def control_user_service(
        self, sandbox: Sandbox, service_name: str, action: str
    ) -> dict[str, Any]:
        self.calls.append(("control_user_service", (sandbox.slug, service_name, action)))
        return {"ok": True, "service": service_name, "action": action, "detail": f"{service_name}: {action}ed"}

    def add_user_service(
        self, sandbox: Sandbox, *, name: str, command: str
    ) -> dict[str, Any]:
        self.calls.append(("add_user_service", (sandbox.slug, name, command)))
        return {"ok": True, "service": name, "action": "add", "detail": f"added {name}"}

    def remove_user_service(self, sandbox: Sandbox, service_name: str) -> dict[str, Any]:
        self.calls.append(("remove_user_service", (sandbox.slug, service_name)))
        return {"ok": True, "service": service_name, "action": "remove", "detail": f"removed {service_name}"}

    def user_service_logs(self, sandbox: Sandbox, service_name: str, tail: int = 120) -> str:
        self.calls.append(("user_service_logs", (sandbox.slug, service_name, tail)))
        return f"[{service_name}] service started\n"

    def expose_user_app(
        self, sandbox: Sandbox, *, name: str, port: int, prefix: str | None = None
    ) -> dict[str, Any]:
        self.calls.append(("expose_user_app", (sandbox.slug, name, port, prefix)))
        return {
            "ok": True,
            "name": name,
            "port": port,
            "url": f"http://localhost:9000/s/{sandbox.slug}/apps/{name}/",
            "detail": f"exposed {name}",
        }

    def unexpose_user_app(self, sandbox: Sandbox, name: str) -> dict[str, Any]:
        self.calls.append(("unexpose_user_app", (sandbox.slug, name)))
        return {"ok": True, "name": name, "detail": f"removed {name}"}

    def add_cron_job(self, sandbox: Sandbox, *, schedule: str, command: str) -> dict[str, Any]:
        self.calls.append(("add_cron_job", (sandbox.slug, schedule, command)))
        return {"ok": True, "line": f"{schedule} {command}", "detail": "added cron"}

    def remove_cron_job(self, sandbox: Sandbox, raw_line: str) -> dict[str, Any]:
        self.calls.append(("remove_cron_job", (sandbox.slug, raw_line)))
        return {"ok": True, "detail": "CRON_REMOVED_OK"}

    def dispatch_mesh_task(
        self,
        sandbox: Sandbox,
        *,
        title: str,
        description: str = "",
        priority: str = "normal",
        room_id: str | None = None,
        approval_required: bool = False,
        source: str = "portal",
        actor: str = "User",
    ) -> dict[str, Any]:
        self.calls.append(("dispatch_mesh_task", (sandbox.slug, title, priority, source)))
        return {"ok": True, "task_id": "tsk_fake_1", "room_id": room_id or "inbox:portal"}

    def decide_mesh_approval(
        self,
        sandbox: Sandbox,
        task_id: str,
        *,
        decision: str,
        note: str = "",
        room_id: str | None = None,
        actor: str = "User",
    ) -> dict[str, Any]:
        self.calls.append(("decide_mesh_approval", (sandbox.slug, task_id, decision, note)))
        return {"ok": True, "task_id": task_id, "room_id": room_id or "grp_test_123", "decision": decision}

    def sync_credential_profile(
        self,
        sandbox: Sandbox,
        *,
        git_user_name: str | None = None,
        git_user_email: str | None = None,
        git_host: str = "github.com",
        git_token: str = "",
        ssh_private_key: str = "",
        env_vars: dict[str, str] | None = None,
        mcp_servers: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.calls.append(("sync_credential_profile", (sandbox.slug, git_user_name, git_host)))
        item = self.containers.get(sandbox.slug)
        if not item or item.get("status") != "running":
            return {"slug": sandbox.slug, "ok": False, "skipped": True, "detail": "not running"}
        return {"slug": sandbox.slug, "ok": True, "skipped": False, "detail": "CRED_SYNC_OK"}

    def sync_shared_project_file(
        self,
        sandboxes: list[Sandbox],
        *,
        team_name: str,
        file_name: str,
        content: str,
    ) -> dict[str, Any]:
        slugs = [s.slug for s in sandboxes]
        self.calls.append(("sync_shared_project_file", (team_name, file_name, slugs)))
        return {
            "ok": True,
            "team_name": team_name,
            "file_name": file_name,
            "synced": len(slugs),
            "total": len(slugs),
            "results": [{"slug": s, "ok": True, "skipped": False, "detail": "SHARED_SYNC_OK"} for s in slugs],
        }


def pytest_sessionfinish(session, exitstatus) -> None:
    shutil.rmtree(_TEST_TMP_DIR, ignore_errors=True)


def reset_database() -> None:
    import app.main as main_mod

    init_db()
    main_mod.oidc_registry.clear()
    with SessionLocal() as db:
        from app.models import CredentialProfile, WorkspaceSnapshot

        db.query(WorkspaceSnapshot).delete()
        db.query(CredentialProfile).delete()
        db.query(AuditLog).delete()
        db.query(OidcProvider).delete()
        db.query(PlatformSetting).delete()
        db.query(Sandbox).delete()
        db.query(SandboxTemplate).delete()
        db.query(LlmProfile).delete()
        db.query(PlatformAdmin).delete()
        db.query(User).delete()
        db.commit()
        settings = get_settings()
        ensure_bootstrap_admin(db, settings.manager_admin_email)
        ensure_default_templates(db, settings)


@pytest.fixture()
def db_session():
    reset_database()
    with SessionLocal() as db:
        yield db


@pytest.fixture()
def fake_docker() -> FakeDockerService:
    return FakeDockerService()


@pytest.fixture()
def api_env(fake_docker: FakeDockerService, monkeypatch):
    reset_database()
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "get_docker", lambda: fake_docker)
    registry = PluginRegistryService(get_settings())
    monkeypatch.setattr(main_mod, "get_plugin_registry", lambda: registry)
    monkeypatch.setattr(main_mod.settings, "manager_auth_mode", "token")
    monkeypatch.setattr(main_mod.settings, "manager_admin_token", "test-admin-token")
    monkeypatch.setattr(main_mod.settings, "manager_admin_email", "admin@example.com")
    with TestClient(app) as client:
        yield client, fake_docker, registry
