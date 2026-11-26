from __future__ import annotations

import importlib.util
from collections.abc import Generator
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event, inspect
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import Settings, get_settings


class Base(DeclarativeBase):
    pass


def normalize_database_url(raw_url: str) -> str:
    """Normalize database URLs across SQLite, PostgreSQL (psycopg v3/v2), and MySQL (pymysql)."""
    cleaned = (raw_url or "").strip()
    if cleaned.startswith("postgres://"):
        cleaned = "postgresql://" + cleaned[len("postgres://") :]

    parsed = make_url(cleaned)
    if parsed.drivername == "postgresql":
        if (
            importlib.util.find_spec("psycopg") is not None
            and importlib.util.find_spec("psycopg2") is None
        ):
            parsed = parsed.set(drivername="postgresql+psycopg")
            return parsed.render_as_string(hide_password=False)
    elif parsed.drivername in {"mysql", "mariadb"}:
        if (
            importlib.util.find_spec("pymysql") is not None
            and importlib.util.find_spec("MySQLdb") is None
        ):
            parsed = parsed.set(drivername=f"{parsed.drivername}+pymysql")
            return parsed.render_as_string(hide_password=False)
    return cleaned


def build_engine(
    database_url: str | None = None,
    app_settings: Settings | None = None,
) -> Engine:
    """Create a SQLAlchemy Engine tuned for the target relational database dialect."""
    cfg = app_settings or get_settings()
    normalized_url = normalize_database_url(database_url or cfg.database_url)
    parsed_url = make_url(normalized_url)
    backend = parsed_url.get_backend_name()

    engine_kwargs: dict[str, Any] = {"pool_pre_ping": True}
    if backend == "sqlite":
        database = parsed_url.database or ""
        if database and database != ":memory:":
            Path(database).parent.mkdir(parents=True, exist_ok=True)
        engine_kwargs["connect_args"] = {"check_same_thread": False}
    else:
        engine_kwargs.update(
            {
                "pool_size": cfg.db_pool_size,
                "max_overflow": cfg.db_max_overflow,
                "pool_timeout": cfg.db_pool_timeout,
                "pool_recycle": cfg.db_pool_recycle,
            }
        )

    eng = create_engine(normalized_url, **engine_kwargs)

    if backend == "sqlite":

        @event.listens_for(eng, "connect")
        def _sqlite_pragmas(dbapi_connection, _record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return eng


settings = get_settings()
engine = build_engine(settings.database_url, settings)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def migrate_schema(target_engine: Engine) -> None:
    """Apply idempotent, dialect-agnostic column migrations for SQLite, PostgreSQL, and MySQL."""
    backend = target_engine.dialect.name
    bool_false = "0" if backend == "sqlite" else "FALSE"
    bool_true = "1" if backend == "sqlite" else "TRUE"
    ts_type = "TIMESTAMP" if backend == "postgresql" else "DATETIME"

    with target_engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())

        if "sandboxes" in table_names:
            columns = {
                col["name"] for col in inspector.get_columns("sandboxes")
            }
            if "cpu_limit" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN cpu_limit FLOAT"
                )
            if "display_name" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN display_name VARCHAR(255)"
                )
            if "memory_limit" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN memory_limit VARCHAR(32)"
                )
            if "template" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN template VARCHAR(64) DEFAULT 'agent-os'"
                )
            if "init_repo_url" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN init_repo_url VARCHAR(512)"
                )
            if "image_repo" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN image_repo VARCHAR(255) DEFAULT 'dsh-sandbox'"
                )
            if "init_script" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN init_script TEXT"
                )
            if "extra_env_json" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN extra_env_json TEXT"
                )
            if "auto_install_plugins" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN auto_install_plugins VARCHAR(512)"
                )
            if "auto_sleep_exempt" not in columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE sandboxes ADD COLUMN auto_sleep_exempt BOOLEAN NOT NULL DEFAULT {bool_false}"
                )
            if "disk_usage_mb" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN disk_usage_mb FLOAT"
                )
            if "disk_updated_at" not in columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE sandboxes ADD COLUMN disk_updated_at {ts_type}"
                )
            if "role_title" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN role_title VARCHAR(128)"
                )
            if "role_description" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN role_description VARCHAR(600)"
                )
            if "role_sop" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN role_sop TEXT"
                )
            if "preview_auth_mode" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN preview_auth_mode VARCHAR(32) NOT NULL DEFAULT 'public'"
                )
            if "webhook_token" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN webhook_token VARCHAR(128)"
                )
            if "daily_token_limit" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN daily_token_limit INTEGER"
                )
            if "daily_cost_limit" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN daily_cost_limit FLOAT"
                )
            if "project_team_name" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN project_team_name VARCHAR(128)"
                )
            if "credential_profile_ids_json" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN credential_profile_ids_json TEXT"
                )
            if "mcp_server_ids_json" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN mcp_server_ids_json TEXT"
                )
            if "skill_ids_json" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN skill_ids_json TEXT"
                )
            if "budget_action" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN budget_action VARCHAR(32) NOT NULL DEFAULT 'block'"
                )
            if "gateway_api_key" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN gateway_api_key VARCHAR(128)"
                )
            if "ownership_mode" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN ownership_mode VARCHAR(32) NOT NULL DEFAULT 'personal'"
                )
            if "maintainer_emails_json" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandboxes ADD COLUMN maintainer_emails_json TEXT"
                )
            if "port" in columns:
                if backend in {"sqlite", "postgresql"}:
                    connection.exec_driver_sql("DROP INDEX IF EXISTS ix_sandboxes_port")
                connection.exec_driver_sql("ALTER TABLE sandboxes DROP COLUMN port")

        if "sandbox_templates" in table_names:
            tpl_columns = {
                col["name"] for col in inspector.get_columns("sandbox_templates")
            }
            if "role_title" not in tpl_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandbox_templates ADD COLUMN role_title VARCHAR(128)"
                )
            if "role_description" not in tpl_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandbox_templates ADD COLUMN role_description VARCHAR(600)"
                )
            if "role_sop" not in tpl_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandbox_templates ADD COLUMN role_sop TEXT"
                )
            if "default_llm_profile_id" not in tpl_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandbox_templates ADD COLUMN default_llm_profile_id VARCHAR(36)"
                )
            if "default_credential_profile_ids_json" not in tpl_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandbox_templates ADD COLUMN default_credential_profile_ids_json TEXT"
                )
            if "default_mcp_server_ids_json" not in tpl_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandbox_templates ADD COLUMN default_mcp_server_ids_json TEXT"
                )
            if "default_skill_ids_json" not in tpl_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandbox_templates ADD COLUMN default_skill_ids_json TEXT"
                )
            if "sop_version" not in tpl_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE sandbox_templates ADD COLUMN sop_version INTEGER NOT NULL DEFAULT 1"
                )

        if "audit_log" in table_names:
            audit_columns = {
                col["name"] for col in inspector.get_columns("audit_log")
            }
            if "category" not in audit_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE audit_log ADD COLUMN category VARCHAR(32)"
                )
            if "sandbox_slug" not in audit_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE audit_log ADD COLUMN sandbox_slug VARCHAR(64)"
                )

        if "users" in table_names:
            user_columns = {
                col["name"] for col in inspector.get_columns("users")
            }
            if "password_hash" not in user_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)"
                )

        if "llm_profiles" in table_names:
            llm_columns = {
                col["name"] for col in inspector.get_columns("llm_profiles")
            }
            if "api_protocol" not in llm_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE llm_profiles ADD COLUMN api_protocol VARCHAR(64) NOT NULL DEFAULT 'openai-completions'"
                )
            if "context_window" not in llm_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE llm_profiles ADD COLUMN context_window INTEGER"
                )
            if "max_tokens" not in llm_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE llm_profiles ADD COLUMN max_tokens INTEGER"
                )
            if "supports_image" not in llm_columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE llm_profiles ADD COLUMN supports_image BOOLEAN NOT NULL DEFAULT {bool_false}"
                )
            if "reasoning_effort" not in llm_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE llm_profiles ADD COLUMN reasoning_effort VARCHAR(32)"
                )
            if "thinking_format" not in llm_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE llm_profiles ADD COLUMN thinking_format VARCHAR(64)"
                )
            if "gateway_enabled" not in llm_columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE llm_profiles ADD COLUMN gateway_enabled BOOLEAN NOT NULL DEFAULT {bool_false}"
                )
            if "input_price_per_1m" not in llm_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE llm_profiles ADD COLUMN input_price_per_1m FLOAT"
                )
            if "output_price_per_1m" not in llm_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE llm_profiles ADD COLUMN output_price_per_1m FLOAT"
                )
            if "fallback_llm_profile_id" not in llm_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE llm_profiles ADD COLUMN fallback_llm_profile_id VARCHAR(36)"
                )

        if "teams" in table_names:
            team_columns = {
                col["name"] for col in inspector.get_columns("teams")
            }
            if "status" not in team_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE teams ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'"
                )
            if "mesh_room_id" not in team_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE teams ADD COLUMN mesh_room_id VARCHAR(128)"
                )
            if "daily_cost_budget" not in team_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE teams ADD COLUMN daily_cost_budget FLOAT"
                )

        if "playbook_runs" in table_names:
            pb_run_columns = {
                col["name"] for col in inspector.get_columns("playbook_runs")
            }
            if "execution_mode" not in pb_run_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE playbook_runs ADD COLUMN execution_mode VARCHAR(32) NOT NULL DEFAULT 'isolated'"
                )

        if "credential_profiles" in table_names:
            cred_columns = {
                col["name"] for col in inspector.get_columns("credential_profiles")
            }
            if "preset_key" not in cred_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE credential_profiles ADD COLUMN preset_key VARCHAR(64)"
                )
            if "category" not in cred_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE credential_profiles ADD COLUMN category VARCHAR(32) NOT NULL DEFAULT 'custom'"
                )
            if "description" not in cred_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE credential_profiles ADD COLUMN description VARCHAR(512)"
                )
            if "github_auth_mode" not in cred_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE credential_profiles ADD COLUMN github_auth_mode VARCHAR(32) NOT NULL DEFAULT 'pat'"
                )
            if "github_api_base_url" not in cred_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE credential_profiles ADD COLUMN github_api_base_url VARCHAR(512)"
                )
            if "github_app_id" not in cred_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE credential_profiles ADD COLUMN github_app_id VARCHAR(64)"
                )
            if "github_app_installation_id" not in cred_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE credential_profiles ADD COLUMN github_app_installation_id VARCHAR(64)"
                )
            if "github_tls_verify" not in cred_columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE credential_profiles ADD COLUMN github_tls_verify BOOLEAN NOT NULL DEFAULT {bool_true}"
                )
            if "github_app_private_key_ciphertext" not in cred_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE credential_profiles ADD COLUMN github_app_private_key_ciphertext TEXT NOT NULL DEFAULT ''"
                )
            if "github_app_cached_token_ciphertext" not in cred_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE credential_profiles ADD COLUMN github_app_cached_token_ciphertext TEXT NOT NULL DEFAULT ''"
                )
            if "github_app_token_expires_at" not in cred_columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE credential_profiles ADD COLUMN github_app_token_expires_at {ts_type}"
                )


def init_db(target_engine: Engine | None = None) -> None:
    from . import models  # noqa: F401

    active_engine = target_engine or engine
    Base.metadata.create_all(bind=active_engine)
    migrate_schema(active_engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
