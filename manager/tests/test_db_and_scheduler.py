from __future__ import annotations

import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

from app import db as db_mod
from app.config import Settings
from app.models import Sandbox, User
from app.scheduler import BackgroundWorker


def test_init_db_fresh_and_legacy_port_migration(tmp_path: Path, monkeypatch):
    legacy_path = tmp_path / "legacy.db"
    conn = sqlite3.connect(legacy_path)
    # Simulate an old schema before port removal and template/password columns.
    conn.executescript(
        """
        CREATE TABLE users (
            id VARCHAR(36) PRIMARY KEY,
            email VARCHAR(255) NOT NULL UNIQUE,
            display_name VARCHAR(255),
            role VARCHAR(32) NOT NULL DEFAULT 'user',
            status VARCHAR(32) NOT NULL DEFAULT 'active',
            created_at DATETIME NOT NULL
        );
        CREATE TABLE sandboxes (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL,
            slug VARCHAR(64) NOT NULL UNIQUE,
            container_id VARCHAR(128),
            volume_name VARCHAR(128) NOT NULL UNIQUE,
            port INTEGER NOT NULL DEFAULT 18080,
            image_tag VARCHAR(64) NOT NULL DEFAULT 'latest',
            llm_profile_id VARCHAR(36),
            status VARCHAR(32) NOT NULL DEFAULT 'creating',
            created_at DATETIME NOT NULL,
            last_seen_at DATETIME,
            deleted_at DATETIME
        );
        INSERT INTO sandboxes (id, user_id, slug, volume_name, port, created_at)
        VALUES ('s1', 'u1', 'alice', 'dsh-alice-home', 18080, '2026-01-01T00:00:00');
        """
    )
    conn.commit()
    conn.close()

    test_engine = create_engine(
        f"sqlite:///{legacy_path.as_posix()}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    monkeypatch.setattr(db_mod, "engine", test_engine)
    db_mod.init_db()

    inspector = inspect(test_engine)
    user_cols = {c["name"] for c in inspector.get_columns("users")}
    sbx_cols = {c["name"] for c in inspector.get_columns("sandboxes")}
    assert "password_hash" in user_cols
    assert "port" not in sbx_cols
    assert {
        "cpu_limit",
        "memory_limit",
        "template",
        "init_repo_url",
        "image_repo",
        "init_script",
        "extra_env_json",
        "auto_install_plugins",
        "auto_sleep_exempt",
        "disk_usage_mb",
        "disk_updated_at",
    }.issubset(sbx_cols)
    assert inspector.has_table("platform_settings")

    with test_engine.begin() as c:
        row = c.execute(text("SELECT slug, image_repo, cpu_limit FROM sandboxes WHERE id = 's1'")).fetchone()
        assert row == ("alice", "dsh-sandbox", None)
    test_engine.dispose()


def test_background_worker_tick_reconciles_statuses(db_session, fake_docker, monkeypatch):
    monkeypatch.setattr("app.scheduler.SessionLocal", db_mod.SessionLocal)
    user = User(email="alice@example.com", display_name="Alice")
    db_session.add(user)
    db_session.flush()

    s1 = Sandbox(
        user_id=user.id,
        slug="alice",
        volume_name="dsh-alice-home",
        image_tag="latest",
        status="creating",
    )
    s2 = Sandbox(
        user_id=user.id,
        slug="bob",
        volume_name="dsh-bob-home",
        image_tag="latest",
        status="running",
    )
    db_session.add_all([s1, s2])
    db_session.commit()

    fake_docker.containers["alice"] = {"id": "cid-alice", "status": "running"}
    # bob is absent from fake_docker.containers -> should reconcile to "missing"

    worker = BackgroundWorker(Settings(_env_file=None, background_tasks=True), fake_docker)  # type: ignore[arg-type]
    worker.tick()

    db_session.expire_all()
    assert db_session.get(Sandbox, s1.id).status == "running"
    assert db_session.get(Sandbox, s2.id).status == "missing"


def test_background_worker_idle_sleep_respects_policy_exempt_and_active_work(
    db_session, fake_docker, monkeypatch
):
    from datetime import datetime, timedelta, timezone
    from app.services import set_idle_sleep_policy

    monkeypatch.setattr("app.scheduler.SessionLocal", db_mod.SessionLocal)
    user = User(email="sleepy@example.com", display_name="Sleepy")
    db_session.add(user)
    db_session.flush()

    stale_at = (datetime.now(timezone.utc) - timedelta(hours=3)).replace(tzinfo=None)
    s_idle = Sandbox(
        user_id=user.id,
        slug="idle-one",
        volume_name="dsh-idle-one-home",
        image_tag="latest",
        status="running",
        auto_sleep_exempt=False,
        last_seen_at=stale_at,
    )
    s_exempt = Sandbox(
        user_id=user.id,
        slug="keep-alive",
        volume_name="dsh-keep-alive-home",
        image_tag="latest",
        status="running",
        auto_sleep_exempt=True,
        last_seen_at=stale_at,
    )
    s_busy = Sandbox(
        user_id=user.id,
        slug="busy-one",
        volume_name="dsh-busy-one-home",
        image_tag="latest",
        status="running",
        auto_sleep_exempt=False,
        last_seen_at=stale_at,
    )
    db_session.add_all([s_idle, s_exempt, s_busy])
    db_session.commit()

    fake_docker.containers["idle-one"] = {"id": "c1", "status": "running"}
    fake_docker.containers["keep-alive"] = {"id": "c2", "status": "running"}
    fake_docker.containers["busy-one"] = {"id": "c3", "status": "running"}

    orig_has_active = fake_docker.has_active_work
    fake_docker.has_active_work = lambda sbx: (
        (True, "user-services") if sbx.slug == "busy-one" else orig_has_active(sbx)
    )

    worker = BackgroundWorker(Settings(_env_file=None, background_tasks=True), fake_docker)  # type: ignore[arg-type]

    # 1. Default OFF: nothing stopped even when idle > 3h
    worker.tick()
    db_session.expire_all()
    assert db_session.get(Sandbox, s_idle.id).status == "running"
    assert db_session.get(Sandbox, s_idle.id).disk_usage_mb == 128.0

    # 2. Enable 60-minute idle sleep: only idle-one stops
    set_idle_sleep_policy(db_session, enabled=True, idle_minutes=60, actor="admin@example.com")
    worker.tick()
    db_session.expire_all()
    assert db_session.get(Sandbox, s_idle.id).status == "stopped"
    assert db_session.get(Sandbox, s_exempt.id).status == "running"
    assert db_session.get(Sandbox, s_busy.id).status == "running"


def test_normalize_database_url_and_dialect_engine_pool_kwargs(monkeypatch):
    # 1. postgres:// alias rewrites to postgresql:// (or +psycopg when psycopg v3 is present)
    monkeypatch.setattr(
        "app.db.importlib.util.find_spec",
        lambda name: object() if name in {"psycopg", "pymysql"} else None,
    )
    assert (
        db_mod.normalize_database_url("postgres://dsh:secret@db.internal:5432/dsh_mgr")
        == "postgresql+psycopg://dsh:secret@db.internal:5432/dsh_mgr"
    )
    assert (
        db_mod.normalize_database_url("postgresql://dsh:secret@db.internal:5432/dsh_mgr")
        == "postgresql+psycopg://dsh:secret@db.internal:5432/dsh_mgr"
    )
    assert (
        db_mod.normalize_database_url("mysql://dsh:secret@db.internal:3306/dsh_mgr")
        == "mysql+pymysql://dsh:secret@db.internal:3306/dsh_mgr"
    )
    # Explicit driver is preserved
    assert (
        db_mod.normalize_database_url("postgresql+psycopg2://dsh:secret@db:5432/dsh")
        == "postgresql+psycopg2://dsh:secret@db:5432/dsh"
    )

    # 2. build_engine passes pool parameters for non-SQLite relational databases
    captured: dict = {}

    def fake_create_engine(url, **kwargs):
        captured["url"] = url
        captured["kwargs"] = kwargs
        from unittest.mock import MagicMock

        return MagicMock()

    monkeypatch.setattr(db_mod, "create_engine", fake_create_engine)
    pg_settings = Settings(
        _env_file=None,
        database_url="postgres://dsh:secret@pg-host:5432/dsh",
        db_pool_size=15,
        db_max_overflow=30,
        db_pool_timeout=45,
        db_pool_recycle=1200,
    )
    db_mod.build_engine(pg_settings.database_url, pg_settings)
    assert captured["url"] == "postgresql+psycopg://dsh:secret@pg-host:5432/dsh"
    assert captured["kwargs"] == {
        "pool_pre_ping": True,
        "pool_size": 15,
        "max_overflow": 30,
        "pool_timeout": 45,
        "pool_recycle": 1200,
    }


def test_migrate_schema_postgresql_dialect_sql_generation(monkeypatch):
    from unittest.mock import MagicMock

    executed_sql: list[str] = []
    fake_conn = MagicMock()
    fake_conn.exec_driver_sql.side_effect = lambda sql: executed_sql.append(sql)

    class _FakeBeginCtx:
        def __enter__(self):
            return fake_conn

        def __exit__(self, *args):
            return False

    fake_engine = MagicMock()
    fake_engine.dialect.name = "postgresql"
    fake_engine.begin.return_value = _FakeBeginCtx()

    fake_inspector = MagicMock()
    fake_inspector.get_table_names.return_value = ["sandboxes", "users", "llm_profiles"]
    fake_inspector.get_columns.side_effect = lambda table: (
        [{"name": "id"}, {"name": "port"}]
        if table == "sandboxes"
        else [{"name": "id"}]
    )
    monkeypatch.setattr(db_mod, "inspect", lambda _conn: fake_inspector)

    db_mod.migrate_schema(fake_engine)
    assert any("DEFAULT FALSE" in s and "auto_sleep_exempt" in s for s in executed_sql)
    assert any("ADD COLUMN disk_updated_at TIMESTAMP" in s for s in executed_sql)
    assert any("DROP INDEX IF EXISTS ix_sandboxes_port" in s for s in executed_sql)
    assert any("ALTER TABLE sandboxes DROP COLUMN port" in s for s in executed_sql)
    assert any("ADD COLUMN password_hash VARCHAR(255)" in s for s in executed_sql)
    assert any("supports_image BOOLEAN NOT NULL DEFAULT FALSE" in s for s in executed_sql)
