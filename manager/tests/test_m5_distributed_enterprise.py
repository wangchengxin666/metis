from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
import uuid
from json import loads as json_loads
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.dialects import mssql, mysql, postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from app.config import Settings, get_settings
from app.coordination import (
    acquire_concurrency_slot,
    bump_config_version,
    check_and_consume_window_limit,
    coordination_health,
    get_config_version,
    is_circuit_open,
    record_circuit_failure,
    record_circuit_success,
    release_concurrency_slot,
    release_lease,
    reset_coordination_state,
    set_test_redis_client,
    try_acquire_lease,
)
from app.db import (
    Base,
    SessionLocal,
    get_database_backend,
    init_db,
    migrate_schema,
    normalize_database_url,
)
from app.db_migrate import _coerce_value, migrate_sqlite_to_engine
from app.models import (
    CredentialProfile,
    LlmProfile,
    LlmUsageLedger,
    Playbook,
    PlaybookArtifact,
    PlaybookRun,
    PlaybookStepRun,
    Sandbox,
    ToolApprovalRequest,
)
from app.routers import llm_gateway as llm_gateway_router
from app.security import derive_sandbox_gateway_secret
from app.services.llm_gateway import reset_gateway_runtime_state
from app.services.playbooks import process_due_scheduled_playbooks, sync_playbook_run_progress


def _login_admin(client) -> None:
    client.post("/api/auth/logout")
    res = client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "token": "test-admin-token", "mode": "admin"},
    )
    assert res.status_code == 200, res.text


class _FakeRedis:
    """In-memory Redis double supporting string, hash, set, sorted-set, and M5 Lua scripts."""

    def __init__(self) -> None:
        self.kv: dict[str, tuple[str, float | None]] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.sets: dict[str, set[str]] = {}
        self.zsets: dict[str, dict[str, float]] = {}

    def _prune(self, key: str) -> None:
        item = self.kv.get(key)
        if item and item[1] is not None and time.monotonic() >= item[1]:
            self.kv.pop(key, None)

    def ping(self) -> bool:
        return True

    def get(self, key: str) -> str | None:
        self._prune(key)
        item = self.kv.get(key)
        return item[0] if item else None

    def set(
        self,
        key: str,
        value: str,
        nx: bool = False,
        ex: float | None = None,
        px: float | None = None,
    ) -> bool:
        self._prune(key)
        if nx and key in self.kv:
            return False
        exp: float | None = None
        if px is not None:
            exp = time.monotonic() + (float(px) / 1000.0)
        elif ex is not None:
            exp = time.monotonic() + float(ex)
        self.kv[key] = (str(value), exp)
        return True

    def delete(self, *keys: str) -> int:
        deleted = 0
        for k in keys:
            if k in self.kv:
                del self.kv[k]
                deleted += 1
            if k in self.hashes:
                del self.hashes[k]
                deleted += 1
            if k in self.sets:
                del self.sets[k]
                deleted += 1
            if k in self.zsets:
                del self.zsets[k]
                deleted += 1
        return deleted

    def hget(self, key: str, field: str) -> str | None:
        return self.hashes.get(key, {}).get(field)

    def hgetall(self, key: str) -> dict[str, str]:
        return dict(self.hashes.get(key, {}))

    def hset(self, key: str, field: str, value: str) -> int:
        bucket = self.hashes.setdefault(key, {})
        is_new = field not in bucket
        bucket[field] = str(value)
        return 1 if is_new else 0

    def hincrby(self, key: str, field: str, amount: int = 1) -> int:
        bucket = self.hashes.setdefault(key, {})
        cur = int(bucket.get(field) or 0) + int(amount)
        bucket[field] = str(cur)
        return cur

    def expire(self, key: str, seconds: int) -> bool:
        return True

    def sadd(self, key: str, member: str) -> int:
        s = self.sets.setdefault(key, set())
        before = len(s)
        s.add(str(member))
        return 1 if len(s) > before else 0

    def srem(self, key: str, member: str) -> int:
        s = self.sets.get(key)
        if not s or str(member) not in s:
            return 0
        s.remove(str(member))
        return 1

    def smembers(self, key: str) -> set[str]:
        return set(self.sets.get(key, set()))

    def zrem(self, key: str, member: str) -> int:
        z = self.zsets.get(key)
        if not z or member not in z:
            return 0
        del z[member]
        return 1

    def scan_iter(self, match: str = "*"):
        prefix = match[:-1] if match.endswith("*") else match
        keys = set(self.kv) | set(self.hashes) | set(self.sets) | set(self.zsets)
        for k in list(keys):
            if k.startswith(prefix):
                yield k

    def eval(self, script: str, numkeys: int, *args):
        key = str(args[0])
        rest = args[1:]
        if "ZRANGE" in script and "ZREMRANGEBYSCORE" in script:
            now_ms, cutoff_ms, cap, cost, consume, member_id, _ttl_ms = rest
            now_ms = int(now_ms)
            cutoff_ms = int(cutoff_ms)
            cap = int(cap)
            cost = int(cost)
            consume = int(consume)
            z = self.zsets.setdefault(key, {})
            for m in [m for m, sc in z.items() if sc <= cutoff_ms]:
                del z[m]
            ordered = sorted(z.items(), key=lambda x: x[1])
            oldest_score = ordered[0][1] if ordered else now_ms
            total = 0
            for m, _sc in ordered:
                w = int(m.split(":", 1)[0]) if ":" in m else 1
                total += w
            if cap > 0 and total >= cap:
                wait_ms = 60000 - (now_ms - oldest_score)
                return [0, max(1, int(wait_ms / 1000) + 1), total]
            if consume == 1 and cost > 0:
                z[f"{cost}:{member_id}"] = float(now_ms)
                total += cost
            return [1, 0, total]
        if "ZCARD" in script:
            now_ms, cap, token, expires_ms, _ttl_ms = rest
            now_ms = int(now_ms)
            cap = int(cap)
            z = self.zsets.setdefault(key, {})
            for m in [m for m, sc in z.items() if sc <= now_ms]:
                del z[m]
            active = len(z)
            if cap > 0 and active >= cap:
                return [0, active]
            z[str(token)] = float(expires_ms)
            return [1, active + 1]
        if "PEXPIRE" in script and "GET" in script:
            owner, ttl_ms = rest
            if self.get(key) == str(owner):
                self.kv[key] = (str(owner), time.monotonic() + float(ttl_ms) / 1000.0)
                return 1
            return 0
        if "DEL" in script and "GET" in script:
            (owner,) = rest
            if self.get(key) == str(owner):
                self.kv.pop(key, None)
                return 1
            return 0
        raise NotImplementedError(script[:60])


def test_m5_db_mssql_ddl_and_sqlite_migration(tmp_path):
    from app import models  # noqa: F401

    assert normalize_database_url("mssql://sa:Pass!@db:1433/dsh") == "mssql+pymssql://sa:Pass%21@db:1433/dsh"
    assert normalize_database_url("sqlserver://sa:Pass!@db:1433/dsh") == "mssql+pymssql://sa:Pass%21@db:1433/dsh"
    assert normalize_database_url("mssql+pyodbc://sa:Pass!@db:1433/dsh") == "mssql+pyodbc://sa:Pass!@db:1433/dsh"
    assert normalize_database_url("postgresql://u:p@pg:5432/db") == "postgresql+psycopg://u:p@pg:5432/db"
    assert get_database_backend("mssql+pymssql://sa:x@db:1433/dsh") == "mssql"
    assert get_database_backend("postgresql+psycopg://u:p@pg/db") == "postgresql"

    # Compile full metadata for PostgreSQL, MySQL, and SQL Server without legacy NTEXT or nullable UNIQUE bugs
    for dialect in (postgresql.dialect(), mysql.dialect(), mssql.dialect()):
        ddls = [str(CreateTable(tbl).compile(dialect=dialect)) for tbl in Base.metadata.sorted_tables]
        idx_ddls = [
            str(CreateIndex(idx).compile(dialect=dialect))
            for tbl in Base.metadata.tables.values()
            for idx in tbl.indexes
        ]
        if dialect.name == "mssql":
            joined = "\n".join(ddls + idx_ddls)
            assert not re.search(r"\bN?TEXT\b", joined, re.I)
            assert "DATETIME2" in joined.upper()
            assert "NVARCHAR(max)" in joined
            assert "WHERE gateway_api_key IS NOT NULL" in joined

    # Verify migrate_schema generates valid MSSQL ALTER statements cleanly
    executed_sql: list[str] = []

    class _FakeConn:
        def execute(self, stmt, *args, **kwargs):
            executed_sql.append(str(stmt))
            return SimpleNamespace(fetchall=lambda: [], scalar=lambda: None, first=lambda: None)

        def exec_driver_sql(self, stmt, *args, **kwargs):
            executed_sql.append(str(stmt))
            return SimpleNamespace(fetchall=lambda: [], scalar=lambda: None, first=lambda: None)

    class _FakeBegin:
        def __enter__(self):
            return _FakeConn()

        def __exit__(self, *args):
            return False

    class _FakeInspect:
        def __init__(self, _target):
            self._tables = ["sandboxes", "llm_profiles", "playbooks", "playbook_step_runs"]

        def get_table_names(self):
            return self._tables

        def get_columns(self, tbl):
            return [{"name": "id"}]

        def get_indexes(self, tbl):
            return []

    import sqlalchemy as sa

    orig_inspect = sa.inspect
    from app import db as db_mod

    orig_mod_inspect = db_mod.inspect
    db_mod.inspect = _FakeInspect  # type: ignore[assignment]
    try:
        fake_mssql_engine = SimpleNamespace(
            dialect=SimpleNamespace(name="mssql"),
            begin=lambda: _FakeBegin(),
        )
        migrate_schema(fake_mssql_engine)  # type: ignore[arg-type]
    finally:
        db_mod.inspect = orig_mod_inspect  # type: ignore[assignment]
        _ = orig_inspect

    mssql_stmts = [s for s in executed_sql if "ALTER TABLE" in s]
    assert mssql_stmts
    assert all("ADD COLUMN" not in s.upper() for s in mssql_stmts)
    assert any("NVARCHAR" in s for s in mssql_stmts)
    assert any("BIT" in s for s in mssql_stmts)

    # Verify FastAPI lifespan rejects SQLite in multi-worker mode or when ALLOW_SQLITE=false
    from fastapi.testclient import TestClient
    from app import main as main_mod

    orig_engine = main_mod.engine
    orig_settings = main_mod.settings
    sqlite_eng = create_engine("sqlite:///:memory:", future=True)
    main_mod.engine = sqlite_eng
    try:
        main_mod.settings = Settings(
            database_url="sqlite:///:memory:",
            allow_sqlite=False,
            manager_workers=1,
            secret_key="test-secret-key-for-pytest-32-chars-minimum",
        )
        with pytest.raises(RuntimeError, match="ALLOW_SQLITE"):
            with TestClient(main_mod.app):
                pass
        main_mod.settings = Settings(
            database_url="sqlite:///:memory:",
            allow_sqlite=True,
            manager_workers=2,
            secret_key="test-secret-key-for-pytest-32-chars-minimum",
        )
        with pytest.raises(RuntimeError, match="MANAGER_WORKERS > 1"):
            with TestClient(main_mod.app):
                pass
    finally:
        main_mod.engine = orig_engine
        main_mod.settings = orig_settings
        sqlite_eng.dispose()

    # Verify SQLite -> Target coercion and error guards
    assert _coerce_value(Sandbox.__table__.c.auto_sleep_exempt, "true") is True
    assert _coerce_value(Sandbox.__table__.c.created_at, "2026-11-27T01:02:03Z").tzinfo is None

    src_db = tmp_path / "legacy.db"
    src_engine = create_engine(f"sqlite:///{src_db.as_posix()}", future=True)
    init_db(src_engine)
    assert migrate_sqlite_to_engine(tmp_path / "missing.db", src_engine)["reason"] == "source_missing"
    assert migrate_sqlite_to_engine(src_db, src_engine)["reason"] == "target_is_sqlite"
    src_engine.dispose()


def test_m5_coordination_redis_and_db_leases(api_env):
    client, _fake_docker, _reg = api_env
    _login_admin(client)
    fake_redis = _FakeRedis()
    set_test_redis_client(fake_redis)
    reset_coordination_state()
    try:
        with SessionLocal() as db:
            health = coordination_health(db)
            assert health["mode"] == "redis"
            assert health["redis_connected"] is True

        # Cluster endpoint & overview expose dialect + coordination state
        cluster = client.get("/api/system/cluster")
        assert cluster.status_code == 200
        assert cluster.json()["coordination"]["mode"] == "redis"
        ov = client.get("/api/overview")
        assert ov.status_code == 200
        assert ov.json()["coordination"]["redis_connected"] is True

        # Leader election across simulated workers
        assert try_acquire_lease("scheduler_leader", owner_id="worker-a", ttl_seconds=10) is True
        assert try_acquire_lease("scheduler_leader", owner_id="worker-b", ttl_seconds=10) is False
        assert try_acquire_lease("scheduler_leader", owner_id="worker-a", ttl_seconds=10) is True
        release_lease("scheduler_leader", owner_id="worker-a")
        assert try_acquire_lease("scheduler_leader", owner_id="worker-b", ttl_seconds=10) is True

        # Sliding-window quota & concurrency slots
        for _ in range(2):
            ok, _ = check_and_consume_window_limit("rpm", "sbx-1", 2, cost=1, consume=True)
            assert ok is True
        blocked, retry_after = check_and_consume_window_limit("rpm", "sbx-1", 2, cost=1, consume=True)
        assert blocked is False and retry_after >= 1

        ok1, tok1 = acquire_concurrency_slot("sbx-1", 1)
        ok2, tok2 = acquire_concurrency_slot("sbx-1", 1)
        assert ok1 is True and tok1
        assert ok2 is False and tok2 is None
        release_concurrency_slot("sbx-1", tok1)
        ok3, tok3 = acquire_concurrency_slot("sbx-1", 1)
        assert ok3 is True and tok3
        release_concurrency_slot("sbx-1", tok3)

        # Single-flight Half-Open canary circuit breaker
        record_circuit_failure("prof-1", reason="502 upstream", threshold=1, cooldown_seconds=5)
        assert is_circuit_open("prof-1", enabled=True) is True
        # Force cooldown elapsed -> ONLY 1st caller probes; 2nd stays blocked
        fake_redis.hset("metis:cb:prof-1", "opened_until", str(time.time() - 1.0))
        assert is_circuit_open("prof-1", enabled=True, probe_ttl_seconds=15) is False
        assert is_circuit_open("prof-1", enabled=True, probe_ttl_seconds=15) is True
        record_circuit_success("prof-1")
        assert is_circuit_open("prof-1", enabled=True) is False

        # OIDC / config version cross-worker bump
        v1 = bump_config_version("oidc")
        assert get_config_version("oidc") == v1

        # DB ClusterLease fallback when Redis is detached
        set_test_redis_client(None)
        with SessionLocal() as db:
            assert try_acquire_lease("db-only-lease", owner_id="w1", ttl_seconds=15, db=db) is True
            assert try_acquire_lease("db-only-lease", owner_id="w2", ttl_seconds=15, db=db) is False
            release_lease("db-only-lease", owner_id="w1", db=db)
            assert try_acquire_lease("db-only-lease", owner_id="w2", ttl_seconds=15, db=db) is True
    finally:
        set_test_redis_client(None)
        reset_coordination_state()


def test_m5_gateway_pool_multihop_dlp_and_anthropic_cache_creation(api_env, monkeypatch):
    client, _fake_docker, _reg = api_env
    reset_gateway_runtime_state()
    _login_admin(client)
    try:
        # Multi-hop fallback chain: P1 -> P2 -> P3 (cycle guard when P3 points back to P1)
        p3 = client.post(
            "/api/llm-profiles",
            json={
                "name": "M5 Tier-3",
                "api_protocol": "anthropic-messages",
                "base_url": "https://tier3.example.com",
                "model": "claude-haiku",
                "api_key": "sk-tier3",
                "gateway_enabled": True,
                "input_price_per_1m": 1.0,
                "output_price_per_1m": 5.0,
                "cache_read_price_per_1m": 0.1,
                "cache_creation_price_per_1m": 1.25,
                "dlp_mode": "redact",
            },
        ).json()
        p2 = client.post(
            "/api/llm-profiles",
            json={
                "name": "M5 Tier-2",
                "api_protocol": "openai-completions",
                "base_url": "https://tier2.example.com/v1",
                "model": "gpt-4o-mini",
                "api_key": "sk-tier2",
                "gateway_enabled": True,
                "fallback_llm_profile_id": p3["id"],
                "circuit_breaker_enabled": True,
            },
        ).json()
        p1 = client.post(
            "/api/llm-profiles",
            json={
                "name": "M5 Primary Pool",
                "api_protocol": "openai-completions",
                "base_url": "https://primary.example.com/v1",
                "model": "gpt-4o",
                "api_key": "sk-primary-unused",
                "gateway_enabled": True,
                "fallback_llm_profile_id": p2["id"],
                "circuit_breaker_enabled": True,
                "dlp_mode": "redact",
                "key_pool": [
                    {"label": "k1-bad", "api_key": "sk-pool-bad", "weight": 100, "enabled": True},
                    {"label": "k2-good", "api_key": "sk-pool-good", "weight": 1, "enabled": True},
                ],
            },
        ).json()
        assert len(p1["key_pool"]) == 2

        # Bind a credential vault secret so DLP recognizes vault secret values too
        cred = client.post(
            "/api/credential-profiles",
            json={
                "name": "Prod Vault Token",
                "category": "custom",
                "git_token": "vault-ultra-secret-token-998877",
            },
        ).json()

        sbx = client.post(
            "/api/sandboxes",
            json={
                "email": "m5-gw@example.com",
                "slug": "m5-gw",
                "llm_profile_id": p1["id"],
                "credential_profile_ids": [cred["id"]],
                "tpm_limit": 200,
                "max_concurrent_requests": 2,
                "dlp_mode": "redact",
            },
        ).json()

        with SessionLocal() as db:
            vkey = db.get(Sandbox, sbx["id"]).gateway_api_key

        observed_posts: list[tuple[str, str, dict]] = []
        mode_switch = {"step": "pool_failover"}

        class _MockResp:
            def __init__(self, status_code: int, payload: dict) -> None:
                self.status_code = status_code
                self._payload = payload
                self.headers = {"content-type": "application/json"}
                self.text = json.dumps(payload)
                self.content = self.text.encode("utf-8")

            def json(self):
                return self._payload

            async def aread(self):
                return self.text.encode("utf-8")

        class _MockAsyncClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def request(self, method, url, headers=None, content=None, json=None, **kwargs):
                return await self.post(url, headers=headers, content=content, json=json)

            async def post(self, url, headers=None, content=None, json=None):
                low_headers = {k.lower(): v for k, v in (headers or {}).items()}
                auth_h = low_headers.get("authorization") or low_headers.get("x-api-key") or ""
                body_obj = json
                if body_obj is None and content:
                    raw = content.decode("utf-8") if isinstance(content, (bytes, bytearray)) else str(content)
                    body_obj = json_loads(raw)
                observed_posts.append((url, auth_h, body_obj or {}))
                if mode_switch["step"] == "pool_failover":
                    # Key-pool key fails on first attempt, secondary pool key succeeds
                    if "sk-pool-bad" in auth_h:
                        return _MockResp(503, {"error": "key rate limited"})
                    return _MockResp(
                        200,
                        {
                            "id": "chatcmpl-pool",
                            "model": "gpt-4o",
                            "choices": [{"message": {"role": "assistant", "content": "ok"}}],
                            "usage": {"prompt_tokens": 50, "completion_tokens": 20, "total_tokens": 70},
                        },
                    )
                if mode_switch["step"] == "multihop":
                    # P1 & P2 fail -> lands on P3 (tier3 anthropic with cache_creation_input_tokens)
                    if "tier3.example.com" in url:
                        return _MockResp(
                            200,
                            {
                                "id": "msg-t3",
                                "type": "message",
                                "model": "claude-haiku",
                                "content": [{"type": "text", "text": "tier3 ok"}],
                                "usage": {
                                    "input_tokens": 100,
                                    "cache_creation_input_tokens": 1000,
                                    "cache_read_input_tokens": 2000,
                                    "output_tokens": 40,
                                },
                            },
                        )
                    return _MockResp(502, {"error": "upstream down"})
                return _MockResp(200, {"choices": [{"message": {"content": "ok"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}})

        monkeypatch.setattr(llm_gateway_router.httpx, "AsyncClient", _MockAsyncClient)

        # 1. Pool failover + DLP redact of OpenAI key & Vault secret
        r1 = client.post(
            f"/api/llm-gateway/p/{p1['id']}/chat/completions",
            headers={"Authorization": f"Bearer {vkey}"},
            json={
                "model": "gpt-4o",
                "messages": [
                    {
                        "role": "user",
                        "content": "leak sk-1234567890abcdefghijklmnop and vault-ultra-secret-token-998877",
                    }
                ],
            },
        )
        assert r1.status_code == 200, r1.text
        assert len(observed_posts) == 2
        forwarded_msg = observed_posts[-1][2]["messages"][0]["content"]
        assert "sk-1234567890" not in forwarded_msg
        assert "vault-ultra-secret-token-998877" not in forwarded_msg
        assert "[REDACTED:" in forwarded_msg

        # 2. Multi-hop fallback P1 -> P2 -> P3 & Anthropic cache_creation_input_tokens billing
        mode_switch["step"] = "multihop"
        r2 = client.post(
            f"/api/llm-gateway/p/{p1['id']}/chat/completions",
            headers={"Authorization": f"Bearer {vkey}"},
            json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]},
        )
        assert r2.status_code == 200, r2.text
        with SessionLocal() as db:
            last_row = db.scalar(
                select(LlmUsageLedger)
                .where(LlmUsageLedger.sandbox_id == sbx["id"])
                .order_by(LlmUsageLedger.created_at.desc())
            )
            assert last_row is not None
            assert last_row.routed_mode == "fallback"
            assert last_row.cache_creation_tokens == 1000
            # Expected cost on Tier-3: (100/1e6)*1.0 + (1000/1e6)*1.25 + (2000/1e6)*0.1 + (40/1e6)*5.0
            # = 0.0001 + 0.00125 + 0.0002 + 0.0002 = 0.00175
            assert abs(last_row.cost_amount - 0.00175) < 1e-6

        # 3. TPM limit exceeded after consuming >200 tokens above -> HTTP 429
        r_tpm = client.post(
            f"/api/llm-gateway/p/{p3['id']}/chat/completions",
            headers={"Authorization": f"Bearer {vkey}"},
            json={"model": "claude-haiku", "messages": [{"role": "user", "content": "x"}]},
        )
        assert r_tpm.status_code == 429

        # 4. DLP 'block' mode rejects outbound secrets with HTTP 403
        client.patch(f"/api/sandboxes/{sbx['id']}", json={"dlp_mode": "block", "tpm_limit": 0})
        r_blk = client.post(
            f"/api/llm-gateway/p/{p3['id']}/chat/completions",
            headers={"Authorization": f"Bearer {vkey}"},
            json={
                "model": "claude-haiku",
                "messages": [{"role": "user", "content": "key is sk-abcdefghijklmnopqrstuvwx"}],
            },
        )
        assert r_blk.status_code == 403
    finally:
        reset_gateway_runtime_state()


def test_m5_playbook_relay_skipif_cron_webhook_trace_and_rag(api_env):
    client, fake_docker, _reg = api_env
    _login_admin(client)

    # Setup 2 running sandboxes + LLM profile
    p = client.post(
        "/api/llm-profiles",
        json={
            "name": "M5 PB LLM",
            "api_protocol": "openai-completions",
            "base_url": "https://pb.example.com/v1",
            "model": "gpt-4o",
            "api_key": "sk-pb",
            "gateway_enabled": True,
            "input_price_per_1m": 2.0,
            "output_price_per_1m": 6.0,
        },
    ).json()
    sbx1 = client.post("/api/sandboxes", json={"email": "pb-lead@example.com", "slug": "pb-lead", "role_title": "Lead", "llm_profile_id": p["id"]}).json()
    sbx2 = client.post("/api/sandboxes", json={"email": "pb-dev@example.com", "slug": "pb-dev", "role_title": "Developer", "llm_profile_id": p["id"]}).json()

    # Create Knowledge Entry & verify BM25 RAG recall
    kn = client.post(
        "/api/memory-hub/knowledge",
        json={
            "title": "MSSQL Deadlock Prevention Guide",
            "category": "database",
            "tags_csv": "mssql,sqlserver,playbook",
            "content": "Always acquire SQL Server ClusterLease outside long HTTP calls.",
        },
    )
    assert kn.status_code == 201, kn.text
    rec = client.get("/api/memory-hub/recall", params={"q": "SQL Server ClusterLease"})
    assert rec.status_code == 200
    assert rec.json()["items"][0]["title"] == "MSSQL Deadlock Prevention Guide"
    assert rec.json()["items"][0]["score"] > 0

    # Mock artifact extraction/write on fake_docker
    relayed_writes: list[tuple[str, str, list[dict]]] = []

    def _fake_extract(sbx, candidates):
        raw_bytes = b"# Architecture Spec\nClean SQL Server schema"
        if sbx.slug == "pb-lead":
            return [
                {
                    "file_name": "arch-spec.md",
                    "path": "/home/workspace/arch-spec.md",
                    "content_b64": base64.b64encode(raw_bytes).decode("ascii"),
                    "size_bytes": len(raw_bytes),
                    "sha256": hashlib.sha256(raw_bytes).hexdigest(),
                    "mime_type": "text/markdown",
                }
            ]
        return []

    def _fake_write_relayed(sbx, subdir, files):
        relayed_writes.append((sbx.slug, subdir, files))
        return [f"/home/workspace/relayed/{subdir}/{fname}" for fname, _raw in files]

    fake_docker.extract_workspace_files = _fake_extract
    fake_docker.write_relayed_artifacts = _fake_write_relayed

    # Create Playbook with Cron, Webhook Secret, and skip_if stage
    pb_res = client.post(
        "/api/playbooks",
        json={
            "key": "m5-relay-flow",
            "name": "M5 Relay Flow",
            "category": "engineering",
            "schedule_cron": "*/5 * * * *",
            "schedule_enabled": True,
            "schedule_timezone": "UTC",
            "schedule_inputs": {"topic": "Cron Release", "skip_qa": "true"},
            "webhook_secret": "whsec-test-m5",
            "input_fields": [
                {"key": "topic", "label": "Topic", "type": "text", "required": True},
                {"key": "skip_qa", "label": "Skip QA", "type": "text", "required": False},
            ],
            "stages": [
                {
                    "id": "design",
                    "name": "Design",
                    "role_hint": "Lead",
                    "prompt_template": "Design {{topic}} with SQL Server ClusterLease guidance",
                    "deliverable_hint": "arch-spec.md",
                },
                {
                    "id": "qa",
                    "name": "Optional QA",
                    "role_hint": "Developer",
                    "depends_on": ["design"],
                    "skip_if": 'inputs.skip_qa == "true"',
                    "prompt_template": "Run QA on {{topic}}",
                },
                {
                    "id": "build",
                    "name": "Build",
                    "role_hint": "Developer",
                    "depends_on": ["qa"],
                    "prompt_template": "Implement {{topic}} using {{stage.design.output}}",
                },
            ],
        },
    )
    assert pb_res.status_code == 201, pb_res.text
    assert pb_res.json()["has_webhook_secret"] is True

    # Invalid webhook signature -> 401/403
    bad_wh = client.post(
        "/api/hooks/playbooks/m5-relay-flow",
        headers={"X-Playbook-Signature": "sha256=deadbeef"},
        json={"title": "WH Run", "inputs": {"topic": "SQL Server HA", "skip_qa": "true"}},
    )
    assert bad_wh.status_code in {401, 403}

    # Valid HMAC webhook signature triggers run (assign stage1 -> pb-lead, stage3 -> pb-dev for cross-sandbox relay)
    raw_body = json.dumps(
        {
            "title": "WH Run",
            "inputs": {"topic": "SQL Server HA", "skip_qa": "true"},
            "role_assignments": {"design": sbx1["id"], "qa": sbx2["id"], "build": sbx2["id"]},
        }
    ).encode("utf-8")
    sig = "sha256=" + hmac.new(b"whsec-test-m5", raw_body, hashlib.sha256).hexdigest()
    good_wh = client.post(
        "/api/hooks/playbooks/m5-relay-flow",
        headers={"X-Playbook-Signature": sig, "Content-Type": "application/json"},
        content=raw_body,
    )
    assert good_wh.status_code == 201, good_wh.text
    run_id = good_wh.json()["id"]

    # Complete stage 1 via runtime mesh snapshot & attach step-attributed LLM Ledger call
    with SessionLocal() as db:
        run_obj = db.get(PlaybookRun, run_id)
        steps = list(db.scalars(select(PlaybookStepRun).where(PlaybookStepRun.run_id == run_id).order_by(PlaybookStepRun.stage_index.asc())).all())
        assert steps[0].status == "running"
        assert "MSSQL Deadlock Prevention Guide" in (steps[0].prompt_rendered or "")  # Auto BM25 RAG injection!
        # Attribute a simulated LLM call to step 0
        db.add(
            LlmUsageLedger(
                id=uuid.uuid4().hex,
                sandbox_id=sbx1["id"],
                sandbox_slug="pb-lead",
                llm_profile_id=p["id"],
                model="gpt-4o",
                api_protocol="openai-completions",
                routed_mode="primary",
                input_tokens=500,
                output_tokens=200,
                total_tokens=700,
                cost_amount=0.0022,
                status_code=200,
                latency_ms=320,
                playbook_run_id=run_id,
                playbook_step_id=steps[0].id,
                mesh_task_id=steps[0].task_id,
            )
        )
        fake_docker.inspect_mesh_room_progress = lambda _sbx, _room_id, since_message_id="": {
            "ok": True,
            "completed": True,
            "reply_text": "Spec finished",
            "artifacts": ["/home/workspace/arch-spec.md"],
        }
        db.commit()

        settings = get_settings()
        assert sync_playbook_run_progress(db, settings, fake_docker, run_obj) is True

    # Verify Artifact Relay persisted & pushed to step 3 (`pb-dev`), and `qa` step was skipped!
    arts = client.get(f"/api/playbook-runs/{run_id}/artifacts")
    assert arts.status_code == 200
    assert len(arts.json()["items"]) == 1
    art_id = arts.json()["items"][0]["id"]
    dl = client.get(f"/api/playbook-runs/{run_id}/artifacts/{art_id}")
    assert dl.status_code == 200 and b"Architecture Spec" in dl.content
    assert any(
        slug == "pb-dev" and any("arch-spec.md" in fname for fname, _raw in files)
        for slug, _sub, files in relayed_writes
    )

    trace = client.get(f"/api/playbook-runs/{run_id}/trace")
    assert trace.status_code == 200
    tj = trace.json()
    assert tj["total_llm_calls"] == 1
    assert tj["total_tokens"] == 700
    assert tj["stages"][0]["stage_id"] == "design"
    assert tj["stages"][1]["status"] == "skipped"
    assert tj["stages"][2]["status"] == "running"

    # Cron scheduler processes due playbook (note "*/5 * * * *" might only match mod-5 minutes; set "* * * * *" to test deterministically)
    client.patch(f"/api/playbooks/{pb_res.json()['id']}", json={"schedule_cron": "* * * * *", "schedule_enabled": True})
    with SessionLocal() as db:
        triggered = process_due_scheduled_playbooks(db, get_settings(), fake_docker)
        assert triggered >= 1
        # Calling again in the same minute is idempotent (0 duplicates)
        assert process_due_scheduled_playbooks(db, get_settings(), fake_docker) == 0


def test_m5_tool_hitl_policies_and_im_bot(api_env):
    client, _fake_docker, _reg = api_env
    _login_admin(client)

    sbx = client.post("/api/sandboxes", json={"email": "m5-hitl@example.com", "slug": "m5-hitl"}).json()
    mesh_secret = derive_sandbox_gateway_secret(sbx["id"], "m5-hitl")
    headers = {"x-metis-sandbox-slug": "m5-hitl", "x-metis-gateway-auth": mesh_secret}

    # Create HITL + Block ToolPolicyRules
    r_block = client.post(
        "/api/tool-policies",
        json={
            "name": "Block Destructive rm",
            "tool_pattern": "bash*",
            "arg_regex": r"rm\s+-rf",
            "action": "block",
            "description": "Destructive rm blocked",
        },
    )
    assert r_block.status_code == 201
    r_appr = client.post(
        "/api/tool-policies",
        json={
            "name": "Approve Git Push",
            "tool_pattern": "bash*",
            "arg_regex": r"git\s+push",
            "action": "require_approval",
        },
    )
    assert r_appr.status_code == 201

    # Block matches
    chk_blk = client.post("/api/internal/mesh/tool-check", headers=headers, json={"tool_name": "bash_exec", "args_summary": "rm -rf /tmp/x"})
    assert chk_blk.status_code == 200
    assert chk_blk.json()["allowed"] is False and chk_blk.json()["action"] == "block"

    # Require approval creates ToolApprovalRequest
    chk_ap = client.post("/api/internal/mesh/tool-check", headers=headers, json={"tool_name": "bash_exec", "args_summary": "git push origin main"})
    assert chk_ap.status_code == 200
    ap_id = chk_ap.json()["approval_id"]
    assert chk_ap.json()["allowed"] is False and chk_ap.json()["action"] == "require_approval" and ap_id

    pending = client.get("/api/tool-approvals?status=pending").json()["items"]
    assert any(item["id"] == ap_id for item in pending)

    dec = client.post(f"/api/tool-approvals/{ap_id}/decide", json={"decision": "approved", "note": "LGTM"})
    assert dec.status_code == 200 and dec.json()["status"] == "approved"

    poll = client.get(f"/api/internal/mesh/tool-check/{ap_id}", headers=headers)
    assert poll.status_code == 200 and poll.json()["status"] == "approved"

    # IM Bot Challenge + Playbook Trigger (`/run`)
    ch = client.post("/api/integrations/im/feishu/events", json={"challenge": "tok-123"})
    assert ch.status_code == 200 and ch.json()["challenge"] == "tok-123"

    # Trigger built-in playbook via Feishu message command
    pb_list = client.get("/api/playbooks").json()["items"]
    pb_key = pb_list[0]["key"]
    ev = client.post(
        "/api/integrations/im/feishu/events",
        json={
            "event": {
                "sender": {"sender_id": {"open_id": "ou_m5"}},
                "message": {"content": json.dumps({"text": f"/run {pb_key} IM Triggered Delivery"})},
            }
        },
    )
    assert ev.status_code == 201, ev.text
    assert ev.json()["ok"] is True and ev.json()["run"]["playbook_key"] == pb_key
