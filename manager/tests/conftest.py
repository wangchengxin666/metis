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

os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_PATH.as_posix()}"
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
            "detail": "dsh: stopped\ndsh: started",
        }

    def remove(self, sandbox: Sandbox, purge_volume: bool = False) -> None:
        self.calls.append(("remove", (sandbox.slug, purge_volume)))
        self.containers.pop(sandbox.slug, None)


def pytest_sessionfinish(session, exitstatus) -> None:
    shutil.rmtree(_TEST_TMP_DIR, ignore_errors=True)


def reset_database() -> None:
    import app.main as main_mod

    init_db()
    main_mod.oidc_registry.clear()
    with SessionLocal() as db:
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
