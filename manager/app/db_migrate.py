"""Idempotent relational database data migrator (SQLite -> PostgreSQL / SQL Server / MySQL)."""

from __future__ import annotations

import argparse
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import DateTime, Engine, Boolean, Float, Integer, inspect, select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, build_engine, init_db

logger = logging.getLogger("dsh-manager.db_migrate")


def _coerce_value(col: Any, val: Any) -> Any:
    if val is None:
        return None
    col_type = col.type
    # Normalize SQLite ISO datetime strings / aware datetimes to naive UTC datetime
    if isinstance(col_type, DateTime):
        if isinstance(val, datetime):
            return val.astimezone(timezone.utc).replace(tzinfo=None) if val.tzinfo else val
        if isinstance(val, str):
            raw = val.strip()
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"
            try:
                parsed = datetime.fromisoformat(raw)
                return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
            except Exception:
                return val
    if isinstance(col_type, Boolean):
        if isinstance(val, bool):
            return val
        if isinstance(val, (int, float)):
            return bool(val)
        if isinstance(val, str):
            return val.strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(col_type, Integer) and not isinstance(val, int):
        try:
            return int(val)
        except Exception:
            return val
    if isinstance(col_type, Float) and not isinstance(val, float):
        try:
            return float(val)
        except Exception:
            return val
    return val


def migrate_sqlite_to_engine(
    sqlite_path: str | Path,
    target_engine: Engine,
    *,
    only_if_target_empty: bool = False,
    batch_size: int = 200,
) -> dict[str, Any]:
    """Copy all relational records from a legacy SQLite DB into target_engine in topological FK order."""
    from . import models  # noqa: F401

    src_path = Path(sqlite_path)
    if not src_path.is_file() or src_path.stat().st_size == 0:
        return {"ok": False, "skipped": True, "reason": "source_missing", "copied_rows": 0}

    if (target_engine.dialect.name or "").split("+")[0].lower() == "sqlite":
        return {"ok": False, "skipped": True, "reason": "target_is_sqlite", "copied_rows": 0}

    src_url = f"sqlite:///{src_path.as_posix()}"
    src_engine = build_engine(src_url)
    try:
        src_tables = set(inspect(src_engine).get_table_names())
        if not src_tables:
            return {"ok": True, "skipped": True, "reason": "source_empty", "copied_rows": 0}

        init_db(target_engine)

        if only_if_target_empty:
            with target_engine.connect() as chk_conn:
                for check_tbl in ("sandboxes", "llm_profiles", "playbooks", "teams"):
                    if check_tbl in Base.metadata.tables:
                        tbl_obj = Base.metadata.tables[check_tbl]
                        first_row = chk_conn.execute(select(tbl_obj).limit(1)).first()
                        if first_row is not None:
                            return {
                                "ok": True,
                                "skipped": True,
                                "reason": f"target_not_empty:{check_tbl}",
                                "copied_rows": 0,
                            }

        copied_by_table: dict[str, int] = {}
        total_copied = 0

        for table in Base.metadata.sorted_tables:
            if table.name not in src_tables:
                continue
            src_cols = {c["name"] for c in inspect(src_engine).get_columns(table.name)}
            shared_cols = [col for col in table.columns if col.name in src_cols]
            if not shared_cols:
                continue
            pk_cols = list(table.primary_key.columns)

            with src_engine.connect() as s_conn:
                stmt = select(*[table.c[c.name] for c in shared_cols])
                rows = s_conn.execute(stmt).mappings().all()

            if not rows:
                continue

            with target_engine.begin() as t_conn:
                existing_keys: set[tuple[Any, ...]] = set()
                if pk_cols:
                    pk_rows = t_conn.execute(select(*pk_cols)).all()
                    existing_keys = {tuple(r) for r in pk_rows}

                to_insert: list[dict[str, Any]] = []
                for row in rows:
                    if pk_cols:
                        pk_tuple = tuple(_coerce_value(pk, row[pk.name]) for pk in pk_cols)
                        if pk_tuple in existing_keys:
                            continue
                        existing_keys.add(pk_tuple)
                    payload = {col.name: _coerce_value(col, row[col.name]) for col in shared_cols}
                    to_insert.append(payload)

                for i in range(0, len(to_insert), batch_size):
                    chunk = to_insert[i : i + batch_size]
                    if chunk:
                        t_conn.execute(table.insert(), chunk)
                        total_copied += len(chunk)
                if to_insert:
                    copied_by_table[table.name] = len(to_insert)

        logger.info(
            "SQLite -> %s migration finished: total_copied=%s tables=%s",
            target_engine.dialect.name,
            total_copied,
            copied_by_table,
        )
        return {
            "ok": True,
            "skipped": False,
            "target_dialect": target_engine.dialect.name,
            "copied_rows": total_copied,
            "tables": copied_by_table,
        }
    finally:
        src_engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migrate Metis Control Plane DB from legacy SQLite to PostgreSQL / SQL Server / MySQL."
    )
    parser.add_argument("--source", required=True, help="Path to source SQLite .db file")
    parser.add_argument(
        "--target",
        default="",
        help="Target SQLAlchemy DATABASE_URL (defaults to configured DATABASE_URL)",
    )
    parser.add_argument(
        "--only-if-empty",
        action="store_true",
        help="Skip migration if target DB already contains business records",
    )
    args = parser.parse_args()
    settings = get_settings()
    target_url = (args.target or settings.database_url).strip()
    target_engine = build_engine(target_url, settings)
    try:
        res = migrate_sqlite_to_engine(
            args.source,
            target_engine,
            only_if_target_empty=args.only_if_empty,
        )
        print(res)
    finally:
        target_engine.dispose()


if __name__ == "__main__":
    main()
