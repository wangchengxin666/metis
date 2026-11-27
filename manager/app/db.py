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
    """Normalize database URLs across PostgreSQL, Microsoft SQL Server, MySQL, and SQLite."""
    cleaned = (raw_url or "").strip()
    if cleaned.startswith("postgres://"):
        cleaned = "postgresql://" + cleaned[len("postgres://") :]
    elif cleaned.startswith("sqlserver://"):
        cleaned = "mssql://" + cleaned[len("sqlserver://") :]

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
    elif parsed.drivername == "mssql":
        if importlib.util.find_spec("pymssql") is not None:
            parsed = parsed.set(drivername="mssql+pymssql")
            return parsed.render_as_string(hide_password=False)
        if importlib.util.find_spec("pyodbc") is not None:
            parsed = parsed.set(drivername="mssql+pyodbc")
            return parsed.render_as_string(hide_password=False)
    return cleaned


def get_database_backend(target: Engine | str | None = None) -> str:
    """Return canonical SQLAlchemy dialect family name ('postgresql', 'mssql', 'mysql', 'sqlite')."""
    if isinstance(target, Engine):
        return (target.dialect.name or "").split("+")[0].lower()
    raw = str(target or get_settings().database_url or "").strip()
    if not raw:
        return "postgresql"
    return (make_url(normalize_database_url(raw)).get_backend_name() or "").lower()


def build_engine(
    database_url: str | None = None,
    app_settings: Settings | None = None,
) -> Engine:
    """Create a SQLAlchemy Engine tuned for PostgreSQL, SQL Server, MySQL, or local test SQLite."""
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
        if parsed_url.drivername == "mssql+pymssql" and "charset" not in parsed_url.query:
            engine_kwargs["connect_args"] = {"charset": "UTF-8"}

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


def _dialect_ddl_tokens(backend: str) -> dict[str, Any]:
    """Return dialect-safe column DDL tokens across PostgreSQL, SQL Server, MySQL, and SQLite."""
    b = (backend or "").lower()
    if b == "mssql":
        return {
            "bool_type": "BIT",
            "bool_false": "0",
            "bool_true": "1",
            "ts_type": "DATETIME2",
            "text_type": "NVARCHAR(MAX)",
            "vchar": lambda n: f"NVARCHAR({n})",
        }
    if b == "mysql":
        return {
            "bool_type": "BOOLEAN",
            "bool_false": "FALSE",
            "bool_true": "TRUE",
            "ts_type": "DATETIME",
            "text_type": "LONGTEXT",
            "vchar": lambda n: f"VARCHAR({n})",
        }
    if b == "sqlite":
        return {
            "bool_type": "BOOLEAN",
            "bool_false": "0",
            "bool_true": "1",
            "ts_type": "DATETIME",
            "text_type": "TEXT",
            "vchar": lambda n: f"VARCHAR({n})",
        }
    # Default: PostgreSQL
    return {
        "bool_type": "BOOLEAN",
        "bool_false": "FALSE",
        "bool_true": "TRUE",
        "ts_type": "TIMESTAMP",
        "text_type": "TEXT",
        "vchar": lambda n: f"VARCHAR({n})",
    }


def _drop_mssql_column_constraints(connection: Any, table: str, column: str) -> None:
    """Drop SQL Server default constraints & indexes on a column before ALTER TABLE DROP COLUMN."""
    connection.exec_driver_sql(
        f"""
        DECLARE @sql NVARCHAR(MAX) = N'';
        SELECT @sql += N'ALTER TABLE {table} DROP CONSTRAINT ' + QUOTENAME(dc.name) + N';'
        FROM sys.default_constraints dc
        JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
        WHERE dc.parent_object_id = OBJECT_ID(N'{table}') AND c.name = N'{column}';
        SELECT @sql += N'DROP INDEX ' + QUOTENAME(i.name) + N' ON {table};'
        FROM sys.indexes i
        JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE i.object_id = OBJECT_ID(N'{table}') AND c.name = N'{column}' AND i.is_primary_key = 0;
        EXEC sp_executesql @sql;
        """
    )


def migrate_schema(target_engine: Engine) -> None:
    """Apply idempotent, multi-dialect schema migrations across PostgreSQL, SQL Server, MySQL, and SQLite."""
    backend = (target_engine.dialect.name or "").split("+")[0].lower()
    tok = _dialect_ddl_tokens(backend)
    bool_type = tok["bool_type"]
    bool_false = tok["bool_false"]
    bool_true = tok["bool_true"]
    ts_type = tok["ts_type"]
    text_type = tok["text_type"]
    vchar = tok["vchar"]

    with target_engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())

        def add_missing(table: str, existing: set[str], col: str, ddl: str) -> None:
            if col not in existing:
                connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")

        if backend == "mssql":
            # MSSQL uses ADD <col> <type>, NOT ADD COLUMN
            def add_missing(table: str, existing: set[str], col: str, ddl: str) -> None:  # type: ignore[no-redef]
                if col not in existing:
                    connection.exec_driver_sql(f"ALTER TABLE {table} ADD {col} {ddl}")

        if "sandboxes" in table_names:
            columns = {col["name"] for col in inspector.get_columns("sandboxes")}
            add_missing("sandboxes", columns, "cpu_limit", "FLOAT")
            add_missing("sandboxes", columns, "display_name", vchar(255))
            add_missing("sandboxes", columns, "memory_limit", "VARCHAR(32)")
            add_missing("sandboxes", columns, "template", "VARCHAR(64) DEFAULT 'agent-os'")
            add_missing("sandboxes", columns, "init_repo_url", vchar(512))
            add_missing("sandboxes", columns, "image_repo", f"{vchar(255)} DEFAULT 'dsh-sandbox'")
            add_missing("sandboxes", columns, "init_script", text_type)
            add_missing("sandboxes", columns, "extra_env_json", text_type)
            add_missing("sandboxes", columns, "auto_install_plugins", vchar(512))
            add_missing("sandboxes", columns, "auto_sleep_exempt", f"{bool_type} NOT NULL DEFAULT {bool_false}")
            add_missing("sandboxes", columns, "disk_usage_mb", "FLOAT")
            add_missing("sandboxes", columns, "disk_updated_at", ts_type)
            add_missing("sandboxes", columns, "role_title", vchar(128))
            add_missing("sandboxes", columns, "role_description", vchar(600))
            add_missing("sandboxes", columns, "role_sop", text_type)
            add_missing("sandboxes", columns, "preview_auth_mode", "VARCHAR(32) NOT NULL DEFAULT 'public'")
            add_missing("sandboxes", columns, "webhook_token", "VARCHAR(128)")
            add_missing("sandboxes", columns, "daily_token_limit", "INTEGER")
            add_missing("sandboxes", columns, "daily_cost_limit", "FLOAT")
            add_missing("sandboxes", columns, "monthly_cost_limit", "FLOAT")
            add_missing("sandboxes", columns, "rpm_limit", "INTEGER")
            add_missing("sandboxes", columns, "tpm_limit", "INTEGER")
            add_missing("sandboxes", columns, "max_concurrent_requests", "INTEGER")
            add_missing("sandboxes", columns, "dlp_mode", "VARCHAR(32)")
            add_missing("sandboxes", columns, "project_team_name", vchar(128))
            add_missing("sandboxes", columns, "credential_profile_ids_json", text_type)
            add_missing("sandboxes", columns, "mcp_server_ids_json", text_type)
            add_missing("sandboxes", columns, "skill_ids_json", text_type)
            add_missing("sandboxes", columns, "budget_action", "VARCHAR(32) NOT NULL DEFAULT 'block'")
            add_missing("sandboxes", columns, "gateway_api_key", "VARCHAR(128)")
            add_missing("sandboxes", columns, "ownership_mode", "VARCHAR(32) NOT NULL DEFAULT 'personal'")
            add_missing("sandboxes", columns, "maintainer_emails_json", text_type)
            if "port" in columns:
                if backend in {"sqlite", "postgresql"}:
                    connection.exec_driver_sql("DROP INDEX IF EXISTS ix_sandboxes_port")
                elif backend == "mssql":
                    _drop_mssql_column_constraints(connection, "sandboxes", "port")
                connection.exec_driver_sql("ALTER TABLE sandboxes DROP COLUMN port")

        if "sandbox_templates" in table_names:
            tpl_columns = {col["name"] for col in inspector.get_columns("sandbox_templates")}
            add_missing("sandbox_templates", tpl_columns, "role_title", vchar(128))
            add_missing("sandbox_templates", tpl_columns, "role_description", vchar(600))
            add_missing("sandbox_templates", tpl_columns, "role_sop", text_type)
            add_missing("sandbox_templates", tpl_columns, "default_llm_profile_id", "VARCHAR(36)")
            add_missing("sandbox_templates", tpl_columns, "default_credential_profile_ids_json", text_type)
            add_missing("sandbox_templates", tpl_columns, "default_mcp_server_ids_json", text_type)
            add_missing("sandbox_templates", tpl_columns, "default_skill_ids_json", text_type)
            add_missing("sandbox_templates", tpl_columns, "sop_version", "INTEGER NOT NULL DEFAULT 1")

        if "audit_log" in table_names:
            audit_columns = {col["name"] for col in inspector.get_columns("audit_log")}
            add_missing("audit_log", audit_columns, "category", "VARCHAR(32)")
            add_missing("audit_log", audit_columns, "sandbox_slug", "VARCHAR(64)")

        if "users" in table_names:
            user_columns = {col["name"] for col in inspector.get_columns("users")}
            add_missing("users", user_columns, "password_hash", "VARCHAR(255)")

        if "llm_profiles" in table_names:
            llm_columns = {col["name"] for col in inspector.get_columns("llm_profiles")}
            add_missing("llm_profiles", llm_columns, "api_protocol", "VARCHAR(64) NOT NULL DEFAULT 'openai-completions'")
            add_missing("llm_profiles", llm_columns, "context_window", "INTEGER")
            add_missing("llm_profiles", llm_columns, "max_tokens", "INTEGER")
            add_missing("llm_profiles", llm_columns, "supports_image", f"{bool_type} NOT NULL DEFAULT {bool_false}")
            add_missing("llm_profiles", llm_columns, "reasoning_effort", "VARCHAR(32)")
            add_missing("llm_profiles", llm_columns, "thinking_format", "VARCHAR(64)")
            add_missing("llm_profiles", llm_columns, "gateway_enabled", f"{bool_type} NOT NULL DEFAULT {bool_false}")
            add_missing("llm_profiles", llm_columns, "input_price_per_1m", "FLOAT")
            add_missing("llm_profiles", llm_columns, "output_price_per_1m", "FLOAT")
            add_missing("llm_profiles", llm_columns, "cache_read_price_per_1m", "FLOAT")
            add_missing("llm_profiles", llm_columns, "cache_creation_price_per_1m", "FLOAT")
            add_missing("llm_profiles", llm_columns, "key_pool_json", text_type)
            add_missing("llm_profiles", llm_columns, "tpm_limit", "INTEGER")
            add_missing("llm_profiles", llm_columns, "dlp_mode", "VARCHAR(32) NOT NULL DEFAULT 'off'")
            add_missing("llm_profiles", llm_columns, "fallback_llm_profile_id", "VARCHAR(36)")
            add_missing("llm_profiles", llm_columns, "circuit_breaker_enabled", f"{bool_type} NOT NULL DEFAULT {bool_true}")

        if "llm_usage_ledger" in table_names:
            ledger_cols = {col["name"] for col in inspector.get_columns("llm_usage_ledger")}
            add_missing("llm_usage_ledger", ledger_cols, "cache_creation_tokens", "INTEGER NOT NULL DEFAULT 0")
            add_missing("llm_usage_ledger", ledger_cols, "playbook_run_id", "VARCHAR(36)")
            add_missing("llm_usage_ledger", ledger_cols, "playbook_step_id", "VARCHAR(36)")
            add_missing("llm_usage_ledger", ledger_cols, "mesh_task_id", "VARCHAR(128)")
            add_missing("llm_usage_ledger", ledger_cols, "upstream_key_label", vchar(128))
            add_missing("llm_usage_ledger", ledger_cols, "dlp_redacted_count", "INTEGER NOT NULL DEFAULT 0")

        if "teams" in table_names:
            team_columns = {col["name"] for col in inspector.get_columns("teams")}
            add_missing("teams", team_columns, "status", "VARCHAR(32) NOT NULL DEFAULT 'active'")
            add_missing("teams", team_columns, "mesh_room_id", "VARCHAR(128)")
            add_missing("teams", team_columns, "daily_cost_budget", "FLOAT")

        if "playbooks" in table_names:
            pb_columns = {col["name"] for col in inspector.get_columns("playbooks")}
            add_missing("playbooks", pb_columns, "schedule_cron", "VARCHAR(128)")
            add_missing("playbooks", pb_columns, "schedule_enabled", f"{bool_type} NOT NULL DEFAULT {bool_false}")
            add_missing("playbooks", pb_columns, "schedule_timezone", "VARCHAR(64) NOT NULL DEFAULT 'UTC'")
            add_missing("playbooks", pb_columns, "schedule_inputs_json", text_type)
            add_missing("playbooks", pb_columns, "last_scheduled_at", ts_type)
            add_missing("playbooks", pb_columns, "webhook_secret_ciphertext", text_type)

        if "playbook_runs" in table_names:
            pb_run_columns = {col["name"] for col in inspector.get_columns("playbook_runs")}
            add_missing("playbook_runs", pb_run_columns, "execution_mode", "VARCHAR(32) NOT NULL DEFAULT 'isolated'")

        if "playbook_step_runs" in table_names:
            pb_step_columns = {col["name"] for col in inspector.get_columns("playbook_step_runs")}
            add_missing("playbook_step_runs", pb_step_columns, "depends_on_json", text_type)
            add_missing("playbook_step_runs", pb_step_columns, "timeout_seconds", "INTEGER")
            add_missing("playbook_step_runs", pb_step_columns, "max_retries", "INTEGER NOT NULL DEFAULT 0")
            add_missing("playbook_step_runs", pb_step_columns, "retry_count", "INTEGER NOT NULL DEFAULT 0")
            add_missing("playbook_step_runs", pb_step_columns, "sla_warned_at", ts_type)
            add_missing("playbook_step_runs", pb_step_columns, "on_reject_goto", "VARCHAR(64)")
            add_missing("playbook_step_runs", pb_step_columns, "skip_if", vchar(512))

        if "credential_profiles" in table_names:
            cred_columns = {col["name"] for col in inspector.get_columns("credential_profiles")}
            add_missing("credential_profiles", cred_columns, "preset_key", "VARCHAR(64)")
            add_missing("credential_profiles", cred_columns, "category", "VARCHAR(32) NOT NULL DEFAULT 'custom'")
            add_missing("credential_profiles", cred_columns, "description", vchar(512))
            add_missing("credential_profiles", cred_columns, "github_auth_mode", "VARCHAR(32) NOT NULL DEFAULT 'pat'")
            add_missing("credential_profiles", cred_columns, "github_api_base_url", vchar(512))
            add_missing("credential_profiles", cred_columns, "github_app_id", "VARCHAR(64)")
            add_missing("credential_profiles", cred_columns, "github_app_installation_id", "VARCHAR(64)")
            add_missing("credential_profiles", cred_columns, "github_tls_verify", f"{bool_type} NOT NULL DEFAULT {bool_true}")
            add_missing("credential_profiles", cred_columns, "github_app_private_key_ciphertext", text_type)
            add_missing("credential_profiles", cred_columns, "github_app_cached_token_ciphertext", text_type)
            add_missing("credential_profiles", cred_columns, "github_app_token_expires_at", ts_type)

        if "container_registries" in table_names:
            reg_cols = {col["name"] for col in inspector.get_columns("container_registries")}
            add_missing("container_registries", reg_cols, "tls_verify", f"{bool_type} NOT NULL DEFAULT {bool_true}")
            add_missing("container_registries", reg_cols, "is_default", f"{bool_type} NOT NULL DEFAULT {bool_false}")
            add_missing("container_registries", reg_cols, "k8s_secret_name", "VARCHAR(128)")
            add_missing("container_registries", reg_cols, "last_test_ok", bool_type)
            add_missing("container_registries", reg_cols, "last_tested_at", ts_type)
            add_missing("container_registries", reg_cols, "last_error", vchar(512))

        if "image_build_jobs" in table_names:
            job_cols = {col["name"] for col in inspector.get_columns("image_build_jobs")}
            add_missing("image_build_jobs", job_cols, "base_image", "VARCHAR(255)")
            add_missing("image_build_jobs", job_cols, "install_browser", f"{bool_type} NOT NULL DEFAULT {bool_false}")
            add_missing("image_build_jobs", job_cols, "network_preset", "VARCHAR(32) NOT NULL DEFAULT 'direct'")
            add_missing("image_build_jobs", job_cols, "packages_json", text_type)
            add_missing("image_build_jobs", job_cols, "custom_dockerfile", text_type)
            add_missing("image_build_jobs", job_cols, "push_registry_id", "VARCHAR(36)")
            add_missing("image_build_jobs", job_cols, "progress_stage", "VARCHAR(128) NOT NULL DEFAULT 'queued'")
            add_missing("image_build_jobs", job_cols, "error_message", vchar(512))
            add_missing("image_build_jobs", job_cols, "image_id", "VARCHAR(128)")
            add_missing("image_build_jobs", job_cols, "size_bytes", "BIGINT")


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
