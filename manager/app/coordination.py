"""Distributed control-plane coordination backend (Redis with DB-lease & local fallback)."""

from __future__ import annotations

import logging
import os
import socket
import threading
import time
import uuid
from collections import deque
from contextlib import contextmanager
from datetime import timedelta
from typing import Any, Iterator

from sqlalchemy import delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import SessionLocal
from .models import ClusterLease, utcnow

logger = logging.getLogger("dsh-manager.coordination")


def _compute_instance_id() -> str:
    cfg_id = (get_settings().manager_instance_id or "").strip()
    if cfg_id:
        return cfg_id[:120]
    host = socket.gethostname()[:48]
    return f"{host}:{os.getpid()}:{uuid.uuid4().hex[:6]}"


INSTANCE_ID = _compute_instance_id()

_LOCAL_LOCK = threading.Lock()
_LOCAL_WINDOWS: dict[str, deque[tuple[float, int]]] = {}
_LOCAL_CONCURRENCY: dict[str, dict[str, float]] = {}
_LOCAL_CIRCUITS: dict[str, dict[str, Any]] = {}
_LOCAL_VERSIONS: dict[str, str] = {}
_LOCAL_LOCKS: dict[str, tuple[str, float]] = {}

_REDIS_LOCK = threading.Lock()
_REDIS_CLIENT: Any = None
_REDIS_URL_CACHED: str = ""
_REDIS_UNAVAILABLE_UNTIL: float = 0.0

_LUA_SLIDING_WINDOW = """
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local cutoff_ms = tonumber(ARGV[2])
local cap = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local consume = tonumber(ARGV[5])
local member_id = ARGV[6]
local ttl_ms = tonumber(ARGV[7])

redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff_ms)
local entries = redis.call('ZRANGE', key, 0, -1, 'WITHSCORES')
local total = 0
local oldest_score = now_ms
for i = 1, #entries, 2 do
  local mem = entries[i]
  local score = tonumber(entries[i + 1])
  if i == 1 and score then oldest_score = score end
  local sep = string.find(mem, ':', 1, true)
  local w = 1
  if sep then
    w = tonumber(string.sub(mem, 1, sep - 1)) or 1
  end
  total = total + w
end

if cap > 0 and total >= cap then
  local wait_ms = 60000 - (now_ms - oldest_score)
  local retry_after = math.max(1, math.floor(wait_ms / 1000) + 1)
  return {0, retry_after, total}
end

if consume == 1 and cost > 0 then
  redis.call('ZADD', key, now_ms, tostring(cost) .. ':' .. member_id)
  redis.call('PEXPIRE', key, ttl_ms)
  total = total + cost
end
return {1, 0, total}
"""

_LUA_CONCURRENCY_ACQUIRE = """
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local token = ARGV[3]
local expires_ms = tonumber(ARGV[4])
local ttl_ms = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms)
local active = redis.call('ZCARD', key)
if cap > 0 and active >= cap then
  return {0, active}
end
redis.call('ZADD', key, expires_ms, token)
redis.call('PEXPIRE', key, ttl_ms)
return {1, active + 1}
"""

_LUA_UNLOCK = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""

_LUA_RENEW = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return 0
"""


def set_test_redis_client(client: Any | None) -> None:
    """Inject a mock or test Redis client (used in distributed unit tests)."""
    global _REDIS_CLIENT, _REDIS_URL_CACHED, _REDIS_UNAVAILABLE_UNTIL
    with _REDIS_LOCK:
        _REDIS_CLIENT = client
        _REDIS_URL_CACHED = "__injected__" if client is not None else ""
        _REDIS_UNAVAILABLE_UNTIL = 0.0


def get_redis_client(app_settings: Settings | None = None) -> Any | None:
    """Return a shared Redis client when REDIS_URL is configured and reachable, else None."""
    global _REDIS_CLIENT, _REDIS_URL_CACHED, _REDIS_UNAVAILABLE_UNTIL
    with _REDIS_LOCK:
        if _REDIS_URL_CACHED == "__injected__" and _REDIS_CLIENT is not None:
            return _REDIS_CLIENT
        cfg = app_settings or get_settings()
        url = (cfg.redis_url or "").strip()
        if not url:
            return None
        now = time.monotonic()
        if now < _REDIS_UNAVAILABLE_UNTIL:
            return None
        if _REDIS_CLIENT is not None and _REDIS_URL_CACHED == url:
            return _REDIS_CLIENT
        try:
            import redis  # type: ignore

            client = redis.Redis.from_url(
                url,
                decode_responses=True,
                socket_connect_timeout=2.0,
                socket_timeout=2.0,
                health_check_interval=30,
            )
            client.ping()
            _REDIS_CLIENT = client
            _REDIS_URL_CACHED = url
            _REDIS_UNAVAILABLE_UNTIL = 0.0
            return client
        except Exception as exc:
            logger.warning("Redis coordination unavailable (%s); falling back cleanly: %s", url, exc)
            _REDIS_CLIENT = None
            _REDIS_UNAVAILABLE_UNTIL = now + 5.0
            return None


def reset_coordination_state() -> None:
    """Reset in-memory fallback structures and clear metis:* test keys if injected Redis is used."""
    with _LOCAL_LOCK:
        _LOCAL_WINDOWS.clear()
        _LOCAL_CONCURRENCY.clear()
        _LOCAL_CIRCUITS.clear()
        _LOCAL_VERSIONS.clear()
        _LOCAL_LOCKS.clear()
    r = get_redis_client()
    if r is not None and _REDIS_URL_CACHED == "__injected__":
        try:
            for k in list(r.scan_iter("metis:*")):
                r.delete(k)
        except Exception:
            pass


def coordination_health(db: Session | None = None) -> dict[str, Any]:
    """Summarize cluster coordination status (Redis / DB Leases / Worker Instance ID)."""
    cfg = get_settings()
    r = get_redis_client(cfg)
    redis_ok = False
    if r is not None:
        try:
            redis_ok = bool(r.ping())
        except Exception:
            redis_ok = False

    leader_owner: str | None = None
    if redis_ok and r is not None:
        try:
            leader_owner = r.get("metis:lease:scheduler_leader")
        except Exception:
            leader_owner = None
    elif db is not None:
        try:
            row = db.get(ClusterLease, "scheduler_leader")
            if row and row.expires_at > utcnow():
                leader_owner = row.owner_id
        except Exception:
            pass

    return {
        "instance_id": INSTANCE_ID,
        "workers": max(1, int(getattr(cfg, "manager_workers", 1) or 1)),
        "redis_configured": bool((cfg.redis_url or "").strip()),
        "redis_connected": redis_ok,
        "mode": "redis" if redis_ok else "database-lease",
        "scheduler_leader": leader_owner,
        "is_scheduler_leader": bool(leader_owner == INSTANCE_ID),
    }


def check_and_consume_window_limit(
    namespace: str,
    subject_id: str,
    limit: int | None,
    *,
    cost: int = 1,
    consume: bool = True,
    window_seconds: float = 60.0,
) -> tuple[bool, int]:
    """Distributed 60s sliding-window quota check (RPM or TPM). Returns (allowed, retry_after_seconds)."""
    cap = int(limit or 0) if limit is not None else 0
    if cap <= 0 and not consume:
        return True, 0

    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - int(window_seconds * 1000)
    r = get_redis_client()
    if r is not None:
        key = f"metis:rl:{namespace}:{subject_id}"
        try:
            res = r.eval(
                _LUA_SLIDING_WINDOW,
                1,
                key,
                now_ms,
                cutoff_ms,
                cap,
                max(0, int(cost)),
                1 if consume else 0,
                uuid.uuid4().hex[:10],
                int(window_seconds * 1000) + 5000,
            )
            allowed = int(res[0]) == 1
            retry_after = int(res[1])
            return allowed, retry_after
        except Exception as exc:
            logger.warning("Redis sliding window error for %s: %s", key, exc)

    now = time.monotonic()
    cutoff = now - window_seconds
    full_key = f"{namespace}:{subject_id}"
    with _LOCAL_LOCK:
        bucket = _LOCAL_WINDOWS.setdefault(full_key, deque())
        while bucket and bucket[0][0] <= cutoff:
            bucket.popleft()
        total = sum(w for _, w in bucket)
        if cap > 0 and total >= cap:
            oldest_ts = bucket[0][0] if bucket else now
            retry_after = max(1, int(window_seconds - (now - oldest_ts)) + 1)
            return False, retry_after
        if consume and cost > 0:
            bucket.append((now, max(1, int(cost))))
        return True, 0


def acquire_concurrency_slot(
    subject_id: str,
    max_concurrent: int | None,
    *,
    lease_seconds: float = 360.0,
) -> tuple[bool, str | None]:
    """Acquire an auto-expiring distributed in-flight concurrency slot. Returns (allowed, slot_token)."""
    cap = int(max_concurrent or 0) if max_concurrent is not None else 0
    if cap <= 0:
        return True, None
    token = f"{INSTANCE_ID}:{uuid.uuid4().hex[:8]}"
    now_ms = int(time.time() * 1000)
    expires_ms = now_ms + int(lease_seconds * 1000)
    r = get_redis_client()
    if r is not None:
        key = f"metis:conc:{subject_id}"
        try:
            res = r.eval(
                _LUA_CONCURRENCY_ACQUIRE,
                1,
                key,
                now_ms,
                cap,
                token,
                expires_ms,
                int(lease_seconds * 1000) + 5000,
            )
            if int(res[0]) == 1:
                return True, token
            return False, None
        except Exception as exc:
            logger.warning("Redis concurrency slot error: %s", exc)

    now = time.monotonic()
    with _LOCAL_LOCK:
        slots = _LOCAL_CONCURRENCY.setdefault(subject_id, {})
        expired = [tok for tok, exp in slots.items() if exp <= now]
        for tok in expired:
            del slots[tok]
        if len(slots) >= cap:
            return False, None
        slots[token] = now + lease_seconds
        return True, token


def release_concurrency_slot(subject_id: str, slot_token: str | None) -> None:
    if not slot_token:
        return
    r = get_redis_client()
    if r is not None:
        key = f"metis:conc:{subject_id}"
        try:
            r.zrem(key, slot_token)
            return
        except Exception:
            pass
    with _LOCAL_LOCK:
        slots = _LOCAL_CONCURRENCY.get(subject_id)
        if slots:
            slots.pop(slot_token, None)


def is_circuit_open(
    scope_key: str,
    *,
    enabled: bool = True,
    probe_ttl_seconds: int = 15,
) -> bool:
    """Cluster-wide circuit breaker check with single-flight Half-Open canary probing."""
    if not enabled:
        return False
    now = time.time()
    r = get_redis_client()
    if r is not None:
        hkey = f"metis:cb:{scope_key}"
        pkey = f"metis:cb_probe:{scope_key}"
        try:
            raw_until = r.hget(hkey, "opened_until")
            if not raw_until:
                return False
            opened_until = float(raw_until)
            if now < opened_until:
                return True
            # Cooldown expired -> allow exactly ONE single-flight canary probe across the cluster
            acquired = bool(r.set(pkey, INSTANCE_ID, nx=True, ex=max(5, probe_ttl_seconds)))
            return not acquired
        except Exception as exc:
            logger.warning("Redis circuit read failed (%s): %s", scope_key, exc)

    with _LOCAL_LOCK:
        st = _LOCAL_CIRCUITS.get(scope_key)
        if not st:
            return False
        opened_until = st.get("opened_until")
        if opened_until is None:
            return False
        if now < float(opened_until):
            return True
        probe_until = float(st.get("probe_until") or 0.0)
        if now < probe_until:
            return True
        st["probe_until"] = now + max(5, probe_ttl_seconds)
        return False


def record_circuit_success(scope_key: str) -> None:
    r = get_redis_client()
    if r is not None:
        try:
            r.delete(f"metis:cb:{scope_key}", f"metis:cb_probe:{scope_key}")
            r.srem("metis:cb:keys", scope_key)
            return
        except Exception:
            pass
    with _LOCAL_LOCK:
        _LOCAL_CIRCUITS.pop(scope_key, None)


def record_circuit_failure(
    scope_key: str,
    *,
    reason: str,
    threshold: int = 3,
    cooldown_seconds: int = 60,
    enabled: bool = True,
) -> bool:
    """Record failure across the cluster and trip circuit breaker when threshold reached."""
    if not enabled:
        return False
    eff_threshold = max(1, int(threshold))
    eff_cooldown = max(5, int(cooldown_seconds))
    now = time.time()
    clean_reason = (reason or "")[:300]

    r = get_redis_client()
    if r is not None:
        hkey = f"metis:cb:{scope_key}"
        pkey = f"metis:cb_probe:{scope_key}"
        try:
            failures = int(r.hincrby(hkey, "failures", 1))
            r.hset(hkey, "last_error", clean_reason)
            r.sadd("metis:cb:keys", scope_key)
            r.expire(hkey, max(300, eff_cooldown * 5))
            r.delete(pkey)
            # If cooldown already elapsed (canary probe failed) or threshold hit -> open immediately
            if failures >= eff_threshold:
                r.hset(hkey, "opened_until", str(now + eff_cooldown))
                return True
            return False
        except Exception as exc:
            logger.warning("Redis circuit failure update error (%s): %s", scope_key, exc)

    with _LOCAL_LOCK:
        st = _LOCAL_CIRCUITS.setdefault(
            scope_key,
            {"failures": 0, "opened_until": None, "probe_until": 0.0, "last_error": ""},
        )
        st["failures"] = int(st.get("failures") or 0) + 1
        st["last_error"] = clean_reason
        st["probe_until"] = 0.0
        if st["failures"] >= eff_threshold:
            st["opened_until"] = now + eff_cooldown
            return True
    return False


def get_circuit_states_snapshot() -> dict[str, dict[str, Any]]:
    """Return active circuit-breaker telemetry across all workers."""
    now = time.time()
    r = get_redis_client()
    if r is not None:
        out: dict[str, dict[str, Any]] = {}
        try:
            keys = list(r.smembers("metis:cb:keys") or [])
            for scope_key in keys:
                data = r.hgetall(f"metis:cb:{scope_key}")
                if not data:
                    r.srem("metis:cb:keys", scope_key)
                    continue
                opened_until = float(data.get("opened_until") or 0.0)
                remaining = max(0.0, opened_until - now) if opened_until else 0.0
                out[scope_key] = {
                    "failures": int(data.get("failures") or 0),
                    "open": remaining > 0.0,
                    "half_open": bool(opened_until and remaining == 0.0),
                    "cooldown_remaining_seconds": round(remaining, 1),
                    "last_error": data.get("last_error") or "",
                }
            return out
        except Exception:
            pass

    out_local: dict[str, dict[str, Any]] = {}
    with _LOCAL_LOCK:
        for pid, st in _LOCAL_CIRCUITS.items():
            opened_until = st.get("opened_until")
            remaining = max(0.0, float(opened_until) - now) if opened_until else 0.0
            out_local[pid] = {
                "failures": int(st.get("failures") or 0),
                "open": remaining > 0.0,
                "half_open": bool(opened_until and remaining == 0.0),
                "cooldown_remaining_seconds": round(remaining, 1),
                "last_error": st.get("last_error") or "",
            }
    return out_local


def try_acquire_lease(
    lease_name: str,
    *,
    owner_id: str | None = None,
    ttl_seconds: float = 55.0,
    db: Session | None = None,
) -> bool:
    """Acquire or renew an exclusive cluster lease (Redis NX/Lua, with SQL ClusterLease fallback)."""
    owner = (owner_id or INSTANCE_ID)[:120]
    ttl_ms = max(2000, int(ttl_seconds * 1000))
    r = get_redis_client()
    if r is not None:
        key = f"metis:lease:{lease_name}"
        try:
            if r.set(key, owner, nx=True, px=ttl_ms):
                return True
            renewed = r.eval(_LUA_RENEW, 1, key, owner, ttl_ms)
            return int(renewed or 0) == 1
        except Exception as exc:
            logger.warning("Redis lease error (%s): %s", lease_name, exc)

    now_dt = utcnow()
    exp_dt = now_dt + timedelta(seconds=max(2.0, ttl_seconds))
    own_session = db is None
    sess = db or SessionLocal()
    try:
        res = sess.execute(
            update(ClusterLease)
            .where(
                ClusterLease.lease_name == lease_name,
                or_(
                    ClusterLease.owner_id == owner,
                    ClusterLease.expires_at < now_dt,
                ),
            )
            .values(owner_id=owner, expires_at=exp_dt, updated_at=now_dt)
        )
        if (res.rowcount or 0) > 0:
            sess.commit()
            return True

        existing = sess.get(ClusterLease, lease_name)
        if existing is None:
            try:
                sess.add(
                    ClusterLease(
                        lease_name=lease_name,
                        owner_id=owner,
                        expires_at=exp_dt,
                        updated_at=now_dt,
                    )
                )
                sess.commit()
                return True
            except IntegrityError:
                sess.rollback()
                return False
        return False
    except Exception:
        sess.rollback()
        return False
    finally:
        if own_session:
            sess.close()


def release_lease(lease_name: str, *, owner_id: str | None = None, db: Session | None = None) -> None:
    owner = (owner_id or INSTANCE_ID)[:120]
    r = get_redis_client()
    if r is not None:
        try:
            r.eval(_LUA_UNLOCK, 1, f"metis:lease:{lease_name}", owner)
            return
        except Exception:
            pass
    own_session = db is None
    sess = db or SessionLocal()
    try:
        sess.execute(
            delete(ClusterLease).where(
                ClusterLease.lease_name == lease_name,
                ClusterLease.owner_id == owner,
            )
        )
        sess.commit()
    except Exception:
        sess.rollback()
    finally:
        if own_session:
            sess.close()


@contextmanager
def cluster_lock(
    lock_name: str,
    *,
    ttl_seconds: float = 20.0,
    wait_seconds: float = 3.0,
) -> Iterator[bool]:
    """Best-effort distributed mutex context manager for idempotent Playbook/bootstrap transitions."""
    token = f"{INSTANCE_ID}:{uuid.uuid4().hex[:8]}"
    deadline = time.monotonic() + max(0.0, wait_seconds)
    acquired = False

    r = get_redis_client()
    if r is not None:
        key = f"metis:lock:{lock_name}"
        ttl_ms = max(2000, int(ttl_seconds * 1000))
        while True:
            try:
                if r.set(key, token, nx=True, px=ttl_ms):
                    acquired = True
                    break
            except Exception:
                break
            if time.monotonic() >= deadline:
                break
            time.sleep(0.05)
        try:
            yield acquired
        finally:
            if acquired:
                try:
                    r.eval(_LUA_UNLOCK, 1, key, token)
                except Exception:
                    pass
        return

    # Local + DB-backed fallback using an isolated SessionLocal transaction
    while True:
        with _LOCAL_LOCK:
            now = time.monotonic()
            existing = _LOCAL_LOCKS.get(lock_name)
            if existing is None or existing[1] <= now:
                _LOCAL_LOCKS[lock_name] = (token, now + ttl_seconds)
                acquired = True
                break
        if time.monotonic() >= deadline:
            break
        time.sleep(0.05)

    if not acquired:
        yield False
        return

    db_locked = False
    is_non_sqlite = False
    try:
        from .db import engine as app_engine

        is_non_sqlite = (app_engine.dialect.name or "").split("+")[0].lower() != "sqlite"
    except Exception:
        is_non_sqlite = False

    if is_non_sqlite:
        while True:
            if try_acquire_lease(f"lock:{lock_name}", owner_id=token, ttl_seconds=ttl_seconds):
                db_locked = True
                break
            if time.monotonic() >= deadline:
                break
            time.sleep(0.05)
        if not db_locked:
            with _LOCAL_LOCK:
                cur = _LOCAL_LOCKS.get(lock_name)
                if cur and cur[0] == token:
                    _LOCAL_LOCKS.pop(lock_name, None)
            yield False
            return

    try:
        yield True
    finally:
        if db_locked:
            release_lease(f"lock:{lock_name}", owner_id=token)
        with _LOCAL_LOCK:
            cur = _LOCAL_LOCKS.get(lock_name)
            if cur and cur[0] == token:
                _LOCAL_LOCKS.pop(lock_name, None)


def bump_config_version(namespace: str) -> str:
    """Broadcast a config version bump across cluster workers (e.g. OIDC provider update)."""
    ver = f"{int(time.time() * 1000)}:{uuid.uuid4().hex[:6]}"
    r = get_redis_client()
    if r is not None:
        try:
            r.set(f"metis:ver:{namespace}", ver, ex=86400 * 7)
            return ver
        except Exception:
            pass
    with _LOCAL_LOCK:
        _LOCAL_VERSIONS[namespace] = ver
    return ver


def get_config_version(namespace: str) -> str:
    r = get_redis_client()
    if r is not None:
        try:
            val = r.get(f"metis:ver:{namespace}")
            if val:
                return str(val)
        except Exception:
            pass
    with _LOCAL_LOCK:
        return _LOCAL_VERSIONS.get(namespace, "0")
