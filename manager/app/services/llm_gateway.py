"""Built-in lightweight Metis LLM Gateway: virtual key isolation, streaming metering, cost/token budget guardrails, and FinOps ledger."""

from __future__ import annotations

import codecs
from dataclasses import dataclass
import json
import logging
import random
import re
import secrets
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..coordination import (
    acquire_concurrency_slot,
    check_and_consume_window_limit,
    get_circuit_states_snapshot,
    is_circuit_open as coord_is_circuit_open,
    record_circuit_failure,
    record_circuit_success,
    release_concurrency_slot,
    reset_coordination_state,
)
from ..models import (
    CredentialProfile,
    LlmProfile,
    LlmUsageLedger,
    PlaybookStepRun,
    Sandbox,
    Team,
    TeamSandbox,
)
from ..security import decrypt_secret
from .common import audit, utcnow
from .notifications import NotificationEvent, dispatch_notification_event
from .policies import get_branding_config

logger = logging.getLogger("dsh-manager.llm_gateway")


def reset_gateway_runtime_state() -> None:
    """Clear distributed/in-process RPM, TPM, concurrency, and circuit-breaker states."""
    reset_coordination_state()


def check_sandbox_rpm_limit(sandbox: Sandbox) -> tuple[bool, int]:
    """Distributed sliding 60-second RPM rate limiter per sandbox. Returns (allowed, retry_after_seconds)."""
    limit = getattr(sandbox, "rpm_limit", None)
    if limit is None or int(limit) <= 0:
        return True, 0
    return check_and_consume_window_limit(
        "rpm", sandbox.id, int(limit), cost=1, consume=True, window_seconds=60.0
    )


def check_sandbox_tpm_limit(sandbox: Sandbox, profile: LlmProfile | None = None) -> tuple[bool, int]:
    """Distributed sliding 60-second TPM rate limiter (checks sandbox or profile cap before forwarding)."""
    sbx_cap = int(getattr(sandbox, "tpm_limit", None) or 0)
    prof_cap = int(getattr(profile, "tpm_limit", None) or 0) if profile is not None else 0
    cap = sbx_cap if sbx_cap > 0 else prof_cap
    if cap <= 0:
        return True, 0
    return check_and_consume_window_limit(
        "tpm", sandbox.id, cap, cost=0, consume=False, window_seconds=60.0
    )


def record_sandbox_tpm_usage(sandbox_id: str, tokens: int) -> None:
    if int(tokens or 0) > 0:
        check_and_consume_window_limit(
            "tpm", sandbox_id, None, cost=int(tokens), consume=True, window_seconds=60.0
        )


def acquire_sandbox_concurrency(
    sandbox: Sandbox, *, default_limit: int = 0
) -> tuple[bool, str | None]:
    raw_cap = getattr(sandbox, "max_concurrent_requests", None)
    cap = int(raw_cap) if raw_cap is not None and int(raw_cap) > 0 else int(default_limit or 0)
    if cap <= 0:
        return True, None
    return acquire_concurrency_slot(f"sbx:{sandbox.id}", cap)


def release_sandbox_concurrency(sandbox: Sandbox, token: str | None) -> None:
    if token:
        release_concurrency_slot(f"sbx:{sandbox.id}", token)


def is_upstream_circuit_open(profile: LlmProfile) -> bool:
    """Return True when a profile's distributed circuit breaker is open (or canary probe is already active)."""
    return coord_is_circuit_open(
        profile.id,
        enabled=bool(getattr(profile, "circuit_breaker_enabled", True)),
    )


def record_upstream_success(profile_id: str) -> None:
    record_circuit_success(profile_id)


def record_upstream_failure(
    profile: LlmProfile,
    *,
    reason: str,
    threshold: int = 3,
    cooldown_seconds: int = 60,
) -> bool:
    """Increment cluster failure counter for profile and open circuit breaker when threshold reached."""
    opened = record_circuit_failure(
        profile.id,
        reason=reason,
        threshold=threshold,
        cooldown_seconds=cooldown_seconds,
        enabled=bool(getattr(profile, "circuit_breaker_enabled", True)),
    )
    if opened:
        logger.warning(
            "LLM Gateway circuit opened for profile %s (%s): %s",
            profile.name,
            profile.id,
            (reason or "")[:300],
        )
    return opened


def get_circuit_breaker_snapshot() -> dict[str, dict[str, Any]]:
    return get_circuit_states_snapshot()


class SseUsageAccumulator:
    """Bounded-memory incremental SSE parser that captures trailing usage across streams of any length."""

    def __init__(self, api_protocol: str) -> None:
        self.api_protocol = (api_protocol or "openai-completions").strip()
        self._decoder = codecs.getincrementaldecoder("utf-8")("ignore")
        self._pending_line = ""
        self.input_tokens = 0
        self.output_tokens = 0
        self.cache_read_tokens = 0
        self.cache_creation_tokens = 0
        self.total_tokens = 0

    def _consume_line(self, line: str) -> None:
        stripped = line.strip()
        if not stripped.startswith("data:"):
            return
        data_str = stripped[5:].strip()
        if not data_str or data_str == "[DONE]":
            return
        try:
            obj = json.loads(data_str)
        except Exception:
            return
        if not isinstance(obj, dict):
            return
        e_in, e_out, e_cr, e_cc, e_tot = extract_detailed_usage_from_payload(
            obj, self.api_protocol
        )
        if e_in > self.input_tokens:
            self.input_tokens = e_in
        if e_out > self.output_tokens:
            self.output_tokens = e_out
        if e_cr > self.cache_read_tokens:
            self.cache_read_tokens = e_cr
        if e_cc > self.cache_creation_tokens:
            self.cache_creation_tokens = e_cc
        if e_tot > self.total_tokens:
            self.total_tokens = e_tot

    def feed(self, chunk: bytes) -> None:
        if not chunk:
            return
        text = self._decoder.decode(chunk, final=False)
        if not text:
            return
        self._pending_line += text
        if "\n" not in self._pending_line:
            # Cap corrupted single-line memory at 2 MiB
            if len(self._pending_line) > 2 * 1024 * 1024:
                self._pending_line = ""
            return
        lines = self._pending_line.splitlines()
        if self._pending_line.endswith(("\n", "\r")):
            self._pending_line = ""
        else:
            self._pending_line = lines.pop() if lines else ""
        for line in lines:
            self._consume_line(line)

    def finalize_detailed(self) -> tuple[int, int, int, int, int]:
        tail = self._decoder.decode(b"", final=True)
        if tail:
            self._pending_line += tail
        if self._pending_line:
            for line in self._pending_line.splitlines():
                self._consume_line(line)
            self._pending_line = ""
        if self.total_tokens == 0 and (self.input_tokens or self.output_tokens):
            self.total_tokens = self.input_tokens + self.output_tokens
        return (
            self.input_tokens,
            self.output_tokens,
            self.cache_read_tokens,
            self.cache_creation_tokens,
            self.total_tokens,
        )

    def finalize(self) -> tuple[int, int, int, int]:
        inp, out, cr, _cc, tot = self.finalize_detailed()
        return inp, out, cr, tot


@dataclass(frozen=True)
class BudgetEvaluation:
    decision: str  # primary | fallback | block
    profile: LlmProfile
    error_code: str = ""
    error_message: str = ""
    scope: str = "sandbox"  # sandbox | team
    unit: str = "usd"  # usd | tokens
    used: float = 0.0
    limit: float | None = None


def generate_sandbox_gateway_key() -> str:
    return f"sk-metis-{secrets.token_hex(20)}"


def ensure_sandbox_gateway_keys(db: Session) -> int:
    """Backfill virtual gateway API keys for any existing non-deleted sandboxes created before M2."""
    missing = list(
        db.scalars(
            select(Sandbox).where(
                Sandbox.deleted_at.is_(None),
                (Sandbox.gateway_api_key.is_(None)) | (Sandbox.gateway_api_key == ""),
            )
        ).all()
    )
    if not missing:
        return 0
    for sbx in missing:
        sbx.gateway_api_key = generate_sandbox_gateway_key()
    db.commit()
    return len(missing)


def resolve_sandbox_llm_endpoint(
    settings: Settings,
    sandbox: Sandbox,
    profile: LlmProfile,
) -> tuple[str, str]:
    """Return (base_url, api_key) to inject into a sandbox container.

    When profile.gateway_enabled is True and the sandbox has a virtual gateway_api_key,
    the real upstream API key NEVER enters the container.
    """
    gw_key = (getattr(sandbox, "gateway_api_key", None) or "").strip()
    if getattr(profile, "gateway_enabled", False) and gw_key:
        gw_base = f"{settings.sandbox_reachable_manager_url}/api/llm-gateway/p/{profile.id}"
        return gw_base, gw_key

    raw_key = ""
    if profile.api_key_ciphertext:
        try:
            raw_key = decrypt_secret(profile.api_key_ciphertext)
        except ValueError:
            raw_key = ""
    return profile.base_url, raw_key


def _utc_day_start(now: datetime | None = None) -> datetime:
    dt = now or utcnow()
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _utc_month_start(now: datetime | None = None) -> datetime:
    dt = now or utcnow()
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _fmt_usd(amount: float) -> str:
    val = float(amount or 0.0)
    if val >= 1.0:
        return f"${val:.2f}"
    if val > 0:
        return f"${val:.4f}"
    return "$0.00"


def extract_detailed_usage_from_payload(
    payload: dict[str, Any], api_protocol: str
) -> tuple[int, int, int, int, int]:
    """Extract (input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_tokens)."""
    if not isinstance(payload, dict):
        return 0, 0, 0, 0, 0

    gm = payload.get("usageMetadata")
    if isinstance(gm, dict):
        inp = int(gm.get("promptTokenCount") or 0)
        out = int(gm.get("candidatesTokenCount") or 0)
        cr = int(gm.get("cachedContentTokenCount") or 0)
        tot = int(gm.get("totalTokenCount") or (inp + out))
        return inp, out, cr, 0, tot

    usage = payload.get("usage")
    if not isinstance(usage, dict) and isinstance(payload.get("response"), dict):
        usage = payload["response"].get("usage")
    if not isinstance(usage, dict) and isinstance(payload.get("message"), dict):
        usage = payload["message"].get("usage")
    if not isinstance(usage, dict):
        return 0, 0, 0, 0, 0

    inp = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    out = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    cr = int(usage.get("cache_read_input_tokens") or usage.get("cache_read_tokens") or 0)
    cc = int(usage.get("cache_creation_input_tokens") or usage.get("cache_creation_tokens") or 0)
    if cr == 0:
        details = usage.get("prompt_tokens_details") or usage.get("input_tokens_details")
        if isinstance(details, dict):
            cr = int(details.get("cached_tokens") or 0)
    tot = int(usage.get("total_tokens") or (inp + out + cr + cc if api_protocol == "anthropic-messages" else inp + out))
    if tot == 0 and (inp or out or cr or cc):
        tot = inp + out + (cr + cc if api_protocol == "anthropic-messages" else 0)
    return inp, out, cr, cc, tot


def extract_usage_from_payload(payload: dict[str, Any], api_protocol: str) -> tuple[int, int, int, int]:
    """Extract (input_tokens, output_tokens, cache_read_tokens, total_tokens) from OpenAI/Anthropic/Gemini JSON."""
    inp, out, cr, _cc, tot = extract_detailed_usage_from_payload(payload, api_protocol)
    return inp, out, cr, tot


def extract_usage_from_sse_text(raw_sse: str, api_protocol: str) -> tuple[int, int, int, int]:
    """Parse token usage incrementally across SSE data lines (OpenAI, Anthropic, Gemini)."""
    acc = SseUsageAccumulator(api_protocol)
    acc.feed(raw_sse.encode("utf-8", errors="ignore"))
    return acc.finalize()


def compute_usage_cost(
    profile: LlmProfile,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
) -> float:
    in_price = float(getattr(profile, "input_price_per_1m", None) or 0.0)
    out_price = float(getattr(profile, "output_price_per_1m", None) or 0.0)
    cr_price_raw = getattr(profile, "cache_read_price_per_1m", None)
    cc_price_raw = getattr(profile, "cache_creation_price_per_1m", None)
    inp = max(0, int(input_tokens or 0))
    out = max(0, int(output_tokens or 0))
    cr = max(0, int(cache_read_tokens or 0))
    cc = max(0, int(cache_creation_tokens or 0))
    protocol = (getattr(profile, "api_protocol", None) or "openai-completions").strip()

    if cr_price_raw is not None and cr > 0:
        cr_price = float(cr_price_raw)
        if protocol == "anthropic-messages":
            cost = (
                (inp / 1_000_000.0) * in_price
                + (cr / 1_000_000.0) * cr_price
                + (out / 1_000_000.0) * out_price
            )
        else:
            billable_cache = min(inp, cr)
            uncached_in = max(0, inp - billable_cache)
            cost = (
                (uncached_in / 1_000_000.0) * in_price
                + (billable_cache / 1_000_000.0) * cr_price
                + (out / 1_000_000.0) * out_price
            )
    else:
        cost = (inp / 1_000_000.0) * in_price + (out / 1_000_000.0) * out_price

    if cc > 0:
        cc_price = float(cc_price_raw) if cc_price_raw is not None else in_price
        cost += (cc / 1_000_000.0) * cc_price
    return round(cost, 6)


def get_sandbox_primary_team_id(db: Session, sandbox_id: str) -> str | None:
    return db.scalar(
        select(TeamSandbox.team_id)
        .where(TeamSandbox.sandbox_id == sandbox_id)
        .order_by(TeamSandbox.created_at.asc())
        .limit(1)
    )


def get_sandbox_today_tokens(db: Session, sandbox_id: str) -> int:
    day_start = _utc_day_start()
    val = db.scalar(
        select(func.coalesce(func.sum(LlmUsageLedger.total_tokens), 0)).where(
            LlmUsageLedger.sandbox_id == sandbox_id,
            LlmUsageLedger.created_at >= day_start,
        )
    )
    return int(val or 0)


def get_sandbox_today_cost(db: Session, sandbox_id: str) -> float:
    day_start = _utc_day_start()
    val = db.scalar(
        select(func.coalesce(func.sum(LlmUsageLedger.cost_amount), 0.0)).where(
            LlmUsageLedger.sandbox_id == sandbox_id,
            LlmUsageLedger.created_at >= day_start,
        )
    )
    return round(float(val or 0.0), 6)


def get_sandbox_month_cost(db: Session, sandbox_id: str) -> float:
    month_start = _utc_month_start()
    val = db.scalar(
        select(func.coalesce(func.sum(LlmUsageLedger.cost_amount), 0.0)).where(
            LlmUsageLedger.sandbox_id == sandbox_id,
            LlmUsageLedger.created_at >= month_start,
        )
    )
    return round(float(val or 0.0), 6)


def get_team_today_usage(db: Session, team_id: str) -> tuple[float, int]:
    """Return (today_cost_usd, today_tokens) across all sandboxes in this team."""
    day_start = _utc_day_start()
    member_sbx_ids = list(
        db.scalars(
            select(TeamSandbox.sandbox_id).where(TeamSandbox.team_id == team_id)
        ).all()
    )
    scope = (
        or_(LlmUsageLedger.team_id == team_id, LlmUsageLedger.sandbox_id.in_(member_sbx_ids))
        if member_sbx_ids
        else (LlmUsageLedger.team_id == team_id)
    )
    row = db.execute(
        select(
            func.coalesce(func.sum(LlmUsageLedger.cost_amount), 0.0),
            func.coalesce(func.sum(LlmUsageLedger.total_tokens), 0),
        ).where(
            scope,
            LlmUsageLedger.created_at >= day_start,
        )
    ).one()
    return round(float(row[0] or 0.0), 6), int(row[1] or 0)


def _apply_budget_exceeded(
    db: Session,
    settings: Settings,
    *,
    sandbox: Sandbox,
    profile: LlmProfile,
    action: str,
    today_tag: str,
    scope: str,
    unit: str,
    used: float,
    limit: float,
    error_code: str,
    error_message: str,
    dedupe_prefix: str,
    downgrade_title: str,
    downgrade_summary: str,
    exceeded_title: str,
    exceeded_summary: str,
) -> BudgetEvaluation:
    brand = get_branding_config(db)
    brand_name = str(brand.get("brand_name_zh") or brand.get("brand_name_en") or "Metis")

    if action == "downgrade" and getattr(profile, "fallback_llm_profile_id", None):
        fallback = db.get(LlmProfile, profile.fallback_llm_profile_id)
        if fallback is not None:
            dispatch_notification_event(
                db,
                settings,
                NotificationEvent(
                    event_type="budget.warning",
                    title=downgrade_title.format(fallback_name=fallback.name),
                    summary=downgrade_summary.format(fallback_model=fallback.model),
                    severity="warning",
                    sandbox_id=sandbox.id,
                    sandbox_slug=sandbox.slug,
                    role_title=sandbox.role_title,
                    project_team_name=sandbox.project_team_name,
                    dedupe_key=f"{dedupe_prefix}.downgrade:{today_tag}",
                ),
                brand_name=brand_name,
            )
            return BudgetEvaluation(
                decision="fallback",
                profile=fallback,
                scope=scope,
                unit=unit,
                used=used,
                limit=limit,
            )

    dispatch_notification_event(
        db,
        settings,
        NotificationEvent(
            event_type="budget.exceeded",
            title=exceeded_title,
            summary=exceeded_summary,
            severity="danger",
            sandbox_id=sandbox.id,
            sandbox_slug=sandbox.slug,
            role_title=sandbox.role_title,
            project_team_name=sandbox.project_team_name,
            dedupe_key=f"{dedupe_prefix}.exceeded:{today_tag}",
        ),
        brand_name=brand_name,
    )
    if action == "warn":
        return BudgetEvaluation(
            decision="primary",
            profile=profile,
            scope=scope,
            unit=unit,
            used=used,
            limit=limit,
        )
    return BudgetEvaluation(
        decision="block",
        profile=profile,
        error_code=error_code,
        error_message=error_message,
        scope=scope,
        unit=unit,
        used=used,
        limit=limit,
    )


def _emit_budget_warning(
    db: Session,
    settings: Settings,
    *,
    sandbox: Sandbox,
    today_tag: str,
    dedupe_prefix: str,
    title: str,
    summary: str,
) -> None:
    brand = get_branding_config(db)
    brand_name = str(brand.get("brand_name_zh") or brand.get("brand_name_en") or "Metis")
    dispatch_notification_event(
        db,
        settings,
        NotificationEvent(
            event_type="budget.warning",
            title=title,
            summary=summary,
            severity="warning",
            sandbox_id=sandbox.id,
            sandbox_slug=sandbox.slug,
            role_title=sandbox.role_title,
            project_team_name=sandbox.project_team_name,
            dedupe_key=f"{dedupe_prefix}.warning:{today_tag}",
        ),
        brand_name=brand_name,
    )


def evaluate_budget_and_route(
    db: Session,
    settings: Settings,
    sandbox: Sandbox,
    profile: LlmProfile,
) -> BudgetEvaluation:
    """Enforce daily/monthly cost and legacy token budgets for both the employee and their project teams."""
    now = utcnow()
    today_tag = now.strftime("%Y%m%d")
    month_tag = now.strftime("%Y%m")
    action = (getattr(sandbox, "budget_action", None) or "block").strip().lower()
    action_label = "仅告警" if action == "warn" else "已熔断"

    # 1. Employee daily cost limit (USD) — primary guardrail
    cost_limit = getattr(sandbox, "daily_cost_limit", None)
    if cost_limit is not None and float(cost_limit) > 0:
        limit_val = float(cost_limit)
        used_cost = get_sandbox_today_cost(db, sandbox.id)
        if used_cost >= limit_val:
            return _apply_budget_exceeded(
                db,
                settings,
                sandbox=sandbox,
                profile=profile,
                action=action,
                today_tag=today_tag,
                scope="sandbox",
                unit="usd",
                used=used_cost,
                limit=limit_val,
                error_code="daily_cost_limit_exceeded",
                error_message=(
                    f"Daily cost budget exceeded for @{sandbox.slug} "
                    f"({_fmt_usd(used_cost)} / {_fmt_usd(limit_val)} USD)."
                ),
                dedupe_prefix=f"budget.cost.sbx:{sandbox.id}",
                downgrade_title=f"@{sandbox.slug} 达到每日费用上限，已自动降级至 {{fallback_name}}",
                downgrade_summary=f"今日已消费 {_fmt_usd(used_cost)} / 上限 {_fmt_usd(limit_val)}，系统已切换至备用低成本模型 {{fallback_model}}。",
                exceeded_title=f"@{sandbox.slug} 已触达每日费用上限 ({action_label})",
                exceeded_summary=f"今日已消费 {_fmt_usd(used_cost)}，达到费用配额上限 {_fmt_usd(limit_val)}。",
            )
        if used_cost >= limit_val * 0.8:
            pct = round((used_cost / limit_val) * 100)
            _emit_budget_warning(
                db,
                settings,
                sandbox=sandbox,
                today_tag=today_tag,
                dedupe_prefix=f"budget.cost.sbx:{sandbox.id}",
                title=f"@{sandbox.slug} 每日费用预算已消耗 {pct}%",
                summary=f"今日已消费 {_fmt_usd(used_cost)} / 上限 {_fmt_usd(limit_val)}，请留意成本支出。",
            )
    else:
        # 1b. Legacy employee daily token limit fallback when daily_cost_limit is not configured
        daily_token_limit = getattr(sandbox, "daily_token_limit", None)
        if daily_token_limit is not None and daily_token_limit > 0:
            used_today = get_sandbox_today_tokens(db, sandbox.id)
            if used_today >= daily_token_limit:
                return _apply_budget_exceeded(
                    db,
                    settings,
                    sandbox=sandbox,
                    profile=profile,
                    action=action,
                    today_tag=today_tag,
                    scope="sandbox",
                    unit="tokens",
                    used=float(used_today),
                    limit=float(daily_token_limit),
                    error_code="daily_token_limit_exceeded",
                    error_message=(
                        f"Daily token budget exceeded for @{sandbox.slug} "
                        f"({used_today:,}/{daily_token_limit:,} tokens)."
                    ),
                    dedupe_prefix=f"budget.token.sbx:{sandbox.id}",
                    downgrade_title=f"@{sandbox.slug} 达到每日 Token 上限，已自动降级至 {{fallback_name}}",
                    downgrade_summary=f"今日已用 {used_today:,} / 上限 {daily_token_limit:,} Tokens，系统已切换至备用低成本模型 {{fallback_model}}。",
                    exceeded_title=f"@{sandbox.slug} 已触达每日 Token 预算上限 ({action_label})",
                    exceeded_summary=f"今日已消耗 {used_today:,} Tokens，达到配额上限 {daily_token_limit:,} Tokens。",
                )
            if used_today >= int(daily_token_limit * 0.8):
                pct = round((used_today / daily_token_limit) * 100)
                _emit_budget_warning(
                    db,
                    settings,
                    sandbox=sandbox,
                    today_tag=today_tag,
                    dedupe_prefix=f"budget.token.sbx:{sandbox.id}",
                    title=f"@{sandbox.slug} 每日 Token 预算已消耗 {pct}%",
                    summary=f"今日已用 {used_today:,} / 上限 {daily_token_limit:,} Tokens，请留意算力消耗。",
                )

    # 1c. Employee monthly cost cap (USD) — cumulative calendar-month guardrail
    monthly_cost_limit = getattr(sandbox, "monthly_cost_limit", None)
    if monthly_cost_limit is not None and float(monthly_cost_limit) > 0:
        mlimit = float(monthly_cost_limit)
        mused = get_sandbox_month_cost(db, sandbox.id)
        if mused >= mlimit:
            return _apply_budget_exceeded(
                db,
                settings,
                sandbox=sandbox,
                profile=profile,
                action=action,
                today_tag=month_tag,
                scope="sandbox",
                unit="usd",
                used=mused,
                limit=mlimit,
                error_code="monthly_cost_limit_exceeded",
                error_message=(
                    f"Monthly cost budget exceeded for @{sandbox.slug} "
                    f"({_fmt_usd(mused)} / {_fmt_usd(mlimit)} USD)."
                ),
                dedupe_prefix=f"budget.monthly.sbx:{sandbox.id}",
                downgrade_title=f"@{sandbox.slug} 达到月度费用上限，已自动降级至 {{fallback_name}}",
                downgrade_summary=f"本月已消费 {_fmt_usd(mused)} / 月度上限 {_fmt_usd(mlimit)}，系统已切换至备用低成本模型 {{fallback_model}}。",
                exceeded_title=f"@{sandbox.slug} 已触达月度费用上限 ({action_label})",
                exceeded_summary=f"本月已消费 {_fmt_usd(mused)}，达到月度费用配额上限 {_fmt_usd(mlimit)}。",
            )
        if mused >= mlimit * 0.8:
            pct = round((mused / mlimit) * 100)
            _emit_budget_warning(
                db,
                settings,
                sandbox=sandbox,
                today_tag=month_tag,
                dedupe_prefix=f"budget.monthly.sbx:{sandbox.id}",
                title=f"@{sandbox.slug} 月度费用预算已消耗 {pct}%",
                summary=f"本月已消费 {_fmt_usd(mused)} / 月度上限 {_fmt_usd(mlimit)}，请留意成本支出。",
            )

    # 2. Team daily cost budget (primary) & legacy team token budget enforcement
    team_rows = list(
        db.scalars(
            select(Team)
            .join(TeamSandbox, TeamSandbox.team_id == Team.id)
            .where(
                TeamSandbox.sandbox_id == sandbox.id,
                Team.status != "archived",
            )
            .order_by(Team.created_at.asc())
        ).all()
    )
    for tm in team_rows:
        tm_cost_budget = getattr(tm, "daily_cost_budget", None)
        tm_tok_budget = getattr(tm, "daily_token_budget", None)
        if (not tm_cost_budget or float(tm_cost_budget) <= 0) and (
            not tm_tok_budget or int(tm_tok_budget) <= 0
        ):
            continue
        tm_cost_today, tm_tok_today = get_team_today_usage(db, tm.id)
        if tm_cost_budget is not None and float(tm_cost_budget) > 0:
            tm_limit = float(tm_cost_budget)
            if tm_cost_today >= tm_limit:
                return _apply_budget_exceeded(
                    db,
                    settings,
                    sandbox=sandbox,
                    profile=profile,
                    action=action,
                    today_tag=today_tag,
                    scope="team",
                    unit="usd",
                    used=tm_cost_today,
                    limit=tm_limit,
                    error_code="team_daily_cost_budget_exceeded",
                    error_message=(
                        f"Team '{tm.name}' daily cost budget exceeded "
                        f"({_fmt_usd(tm_cost_today)} / {_fmt_usd(tm_limit)} USD)."
                    ),
                    dedupe_prefix=f"budget.cost.team:{tm.id}",
                    downgrade_title=f"项目「{tm.name}」达到每日费用上限，@{sandbox.slug} 已自动降级至 {{fallback_name}}",
                    downgrade_summary=f"项目今日累计消费 {_fmt_usd(tm_cost_today)} / 上限 {_fmt_usd(tm_limit)}，系统已切换至备用低成本模型 {{fallback_model}}。",
                    exceeded_title=f"项目「{tm.name}」已触达每日费用上限 ({action_label})",
                    exceeded_summary=f"项目今日累计消费 {_fmt_usd(tm_cost_today)}，达到费用预算上限 {_fmt_usd(tm_limit)}。",
                )
            if tm_cost_today >= tm_limit * 0.8:
                pct = round((tm_cost_today / tm_limit) * 100)
                _emit_budget_warning(
                    db,
                    settings,
                    sandbox=sandbox,
                    today_tag=today_tag,
                    dedupe_prefix=f"budget.cost.team:{tm.id}",
                    title=f"项目「{tm.name}」每日费用预算已消耗 {pct}%",
                    summary=f"项目今日已消费 {_fmt_usd(tm_cost_today)} / 上限 {_fmt_usd(tm_limit)}，请留意成本支出。",
                )
        elif tm_tok_budget is not None and int(tm_tok_budget) > 0:
            tm_tlim = int(tm_tok_budget)
            if tm_tok_today >= tm_tlim:
                return _apply_budget_exceeded(
                    db,
                    settings,
                    sandbox=sandbox,
                    profile=profile,
                    action=action,
                    today_tag=today_tag,
                    scope="team",
                    unit="tokens",
                    used=float(tm_tok_today),
                    limit=float(tm_tlim),
                    error_code="team_daily_token_budget_exceeded",
                    error_message=(
                        f"Team '{tm.name}' daily token budget exceeded "
                        f"({tm_tok_today:,}/{tm_tlim:,} tokens)."
                    ),
                    dedupe_prefix=f"budget.token.team:{tm.id}",
                    downgrade_title=f"项目「{tm.name}」达到每日 Token 上限，@{sandbox.slug} 已自动降级至 {{fallback_name}}",
                    downgrade_summary=f"项目今日已用 {tm_tok_today:,} / 上限 {tm_tlim:,} Tokens，系统已切换至备用低成本模型 {{fallback_model}}。",
                    exceeded_title=f"项目「{tm.name}」已触达每日 Token 预算上限 ({action_label})",
                    exceeded_summary=f"项目今日已消耗 {tm_tok_today:,} Tokens，达到预算上限 {tm_tlim:,} Tokens。",
                )
            if tm_tok_today >= int(tm_tlim * 0.8):
                pct = round((tm_tok_today / tm_tlim) * 100)
                _emit_budget_warning(
                    db,
                    settings,
                    sandbox=sandbox,
                    today_tag=today_tag,
                    dedupe_prefix=f"budget.token.team:{tm.id}",
                    title=f"项目「{tm.name}」每日 Token 预算已消耗 {pct}%",
                    summary=f"项目今日已用 {tm_tok_today:,} / 上限 {tm_tlim:,} Tokens，请留意算力消耗。",
                )

    return BudgetEvaluation(decision="primary", profile=profile)


_DLP_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("pem_private_key", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----")),
    ("api_key_sk", re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b")),
    ("github_pat", re.compile(r"\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("bearer_token", re.compile(r"\bBearer\s+[A-Za-z0-9._-]{20,}\b")),
]


def resolve_upstream_targets(profile: LlmProfile) -> list[dict[str, str]]:
    """Expand an LlmProfile + its weighted key_pool into ordered healthy upstream targets."""
    targets: list[dict[str, str]] = []
    primary_key = ""
    if profile.api_key_ciphertext:
        try:
            primary_key = decrypt_secret(profile.api_key_ciphertext)
        except ValueError:
            primary_key = ""
    if not coord_is_circuit_open(
        f"{profile.id}:key:primary",
        enabled=bool(getattr(profile, "circuit_breaker_enabled", True)),
    ):
        targets.append(
            {
                "key_id": "primary",
                "label": "primary",
                "base_url": profile.base_url.rstrip("/"),
                "api_key": primary_key,
                "weight": "1",
            }
        )

    pool_raw: list[Any] = []
    try:
        parsed = json.loads(getattr(profile, "key_pool_json", None) or "[]")
        if isinstance(parsed, list):
            pool_raw = parsed
    except Exception:
        pool_raw = []

    weighted_extra: list[dict[str, str]] = []
    for idx, entry in enumerate(pool_raw):
        if not isinstance(entry, dict) or not entry.get("enabled", True):
            continue
        kid = str(entry.get("id") or f"k{idx + 1}")
        if coord_is_circuit_open(
            f"{profile.id}:key:{kid}",
            enabled=bool(getattr(profile, "circuit_breaker_enabled", True)),
        ):
            continue
        cipher = str(entry.get("api_key_ciphertext") or "")
        raw_k = primary_key
        if cipher:
            try:
                raw_k = decrypt_secret(cipher)
            except ValueError:
                continue
        url = str(entry.get("base_url") or profile.base_url).strip().rstrip("/")
        weighted_extra.append(
            {
                "key_id": kid,
                "label": str(entry.get("label") or kid),
                "base_url": url,
                "api_key": raw_k,
                "weight": str(max(1, int(entry.get("weight") or 1))),
            }
        )

    if weighted_extra:
        # Rotate intra-profile pool entries evenly alongside primary
        random.shuffle(weighted_extra)
        weighted_extra.sort(key=lambda x: -int(x["weight"]))
        # Put weighted pool first half / alternate cleanly
        combined = weighted_extra + targets
        return combined
    return targets or [
        {
            "key_id": "primary",
            "label": "primary",
            "base_url": profile.base_url.rstrip("/"),
            "api_key": primary_key,
            "weight": "1",
        }
    ]


def record_upstream_key_failure(
    profile: LlmProfile,
    key_id: str,
    *,
    reason: str,
    cooldown_seconds: int = 30,
) -> None:
    record_circuit_failure(
        f"{profile.id}:key:{key_id}",
        reason=reason,
        threshold=2,
        cooldown_seconds=cooldown_seconds,
        enabled=bool(getattr(profile, "circuit_breaker_enabled", True)),
    )


def record_upstream_key_success(profile_id: str, key_id: str) -> None:
    record_circuit_success(f"{profile_id}:key:{key_id}")


def resolve_fallback_chain(
    db: Session,
    start_profile: LlmProfile,
    *,
    max_hops: int = 4,
) -> list[LlmProfile]:
    """Resolve non-cyclic multi-hop fallback profile chain starting after start_profile."""
    chain: list[LlmProfile] = []
    seen = {start_profile.id}
    cur = start_profile
    for _ in range(max_hops):
        fb_id = getattr(cur, "fallback_llm_profile_id", None)
        if not fb_id or fb_id in seen:
            break
        nxt = db.get(LlmProfile, fb_id)
        if nxt is None:
            break
        seen.add(nxt.id)
        chain.append(nxt)
        cur = nxt
    return chain


def collect_sandbox_vault_secrets(db: Session, sandbox: Sandbox) -> list[str]:
    """Collect active Vault plaintext secrets bound to a sandbox strictly in-memory for DLP scanning."""
    cids = sandbox.credential_profile_ids
    if not cids:
        return []
    creds = list(
        db.scalars(select(CredentialProfile).where(CredentialProfile.id.in_(cids))).all()
    )
    secrets_list: list[str] = []
    for c in creds:
        for attr in (
            "git_token_ciphertext",
            "ssh_private_key_ciphertext",
            "github_app_cached_token_ciphertext",
        ):
            enc = getattr(c, attr, "") or ""
            if enc:
                try:
                    val = decrypt_secret(enc)
                    if val and len(val.strip()) >= 8:
                        secrets_list.append(val.strip())
                except Exception:
                    pass
        if c.env_vars_ciphertext:
            try:
                env_map = json.loads(decrypt_secret(c.env_vars_ciphertext))
                if isinstance(env_map, dict):
                    for v in env_map.values():
                        sv = str(v or "").strip()
                        if len(sv) >= 8:
                            secrets_list.append(sv)
            except Exception:
                pass
    return list(dict.fromkeys(secrets_list))


def apply_outbound_dlp(
    raw_body: bytes,
    *,
    mode: str = "off",
    extra_secrets: list[str] | None = None,
) -> tuple[bytes, int, list[str]]:
    """Scan/redact sensitive secrets & Vault tokens in outbound LLM payloads."""
    clean_mode = (mode or "off").strip().lower()
    if clean_mode not in {"redact", "block"} or not raw_body:
        return raw_body, 0, []
    try:
        parsed = json.loads(raw_body.decode("utf-8"))
    except Exception:
        return raw_body, 0, []

    hits: list[str] = []
    count = 0

    def scrub_str(s: str) -> str:
        nonlocal count
        out = s
        if extra_secrets:
            for sec in extra_secrets:
                if sec and sec in out:
                    out = out.replace(sec, "[REDACTED:VAULT_SECRET]")
                    count += 1
                    if "vault_secret" not in hits:
                        hits.append("vault_secret")
        for label, pat in _DLP_PATTERNS:
            new_out, n = pat.subn(f"[REDACTED:{label.upper()}]", out)
            if n > 0:
                out = new_out
                count += n
                if label not in hits:
                    hits.append(label)
        return out

    def walk(node: Any) -> Any:
        if isinstance(node, str):
            return scrub_str(node)
        if isinstance(node, list):
            return [walk(x) for x in node]
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items()}
        return node

    scrubbed = walk(parsed)
    if count == 0:
        return raw_body, 0, []
    return json.dumps(scrubbed, ensure_ascii=False).encode("utf-8"), count, hits


def resolve_gateway_trace_context(
    db: Session,
    sandbox: Sandbox,
    headers: Any,
) -> dict[str, str | None]:
    """Resolve Playbook/Task attribution from explicit headers or the sandbox's single active running step."""
    run_id = (headers.get("x-metis-playbook-run-id") or "").strip() or None
    step_id = (headers.get("x-metis-playbook-step-id") or "").strip() or None
    task_id = (headers.get("x-metis-mesh-task-id") or "").strip() or None
    if not step_id and not run_id:
        active_steps = list(
            db.scalars(
                select(PlaybookStepRun).where(
                    PlaybookStepRun.sandbox_id == sandbox.id,
                    PlaybookStepRun.status == "running",
                )
            ).all()
        )
        if len(active_steps) == 1:
            st = active_steps[0]
            run_id = st.run_id
            step_id = st.id
            task_id = task_id or st.task_id
    return {
        "playbook_run_id": run_id,
        "playbook_step_id": step_id,
        "mesh_task_id": task_id,
    }


def record_llm_usage(
    db: Session,
    *,
    sandbox: Sandbox,
    profile: LlmProfile,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    total_tokens: int,
    routed_mode: str,
    status_code: int,
    latency_ms: int,
    cache_creation_tokens: int = 0,
    playbook_run_id: str | None = None,
    playbook_step_id: str | None = None,
    mesh_task_id: str | None = None,
    upstream_key_label: str | None = None,
    dlp_redacted_count: int = 0,
) -> LlmUsageLedger:
    team_id = get_sandbox_primary_team_id(db, sandbox.id)
    cost = compute_usage_cost(
        profile,
        input_tokens,
        output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_creation_tokens=cache_creation_tokens,
    )
    entry = LlmUsageLedger(
        sandbox_id=sandbox.id,
        sandbox_slug=sandbox.slug,
        team_id=team_id,
        llm_profile_id=profile.id,
        model=model or profile.model,
        api_protocol=profile.api_protocol or "openai-completions",
        input_tokens=max(0, int(input_tokens)),
        output_tokens=max(0, int(output_tokens)),
        cache_read_tokens=max(0, int(cache_read_tokens)),
        cache_creation_tokens=max(0, int(cache_creation_tokens)),
        total_tokens=max(0, int(total_tokens)),
        cost_amount=cost,
        routed_mode=routed_mode,
        status_code=status_code,
        latency_ms=max(0, int(latency_ms)),
        playbook_run_id=playbook_run_id,
        playbook_step_id=playbook_step_id,
        mesh_task_id=mesh_task_id,
        upstream_key_label=upstream_key_label,
        dlp_redacted_count=max(0, int(dlp_redacted_count or 0)),
        created_at=utcnow(),
    )
    db.add(entry)
    db.commit()
    if total_tokens > 0:
        record_sandbox_tpm_usage(sandbox.id, total_tokens)
    return entry


def build_finops_summary(
    db: Session,
    visible_sandboxes: list[Sandbox],
    *,
    days: int = 30,
    team_id: str | None = None,
) -> dict[str, Any]:
    now = utcnow()
    day_start = _utc_day_start(now)
    month_start = _utc_month_start(now)
    since = day_start - timedelta(days=max(1, min(days, 365)) - 1)

    sbx_ids = [s.id for s in visible_sandboxes]
    if not sbx_ids:
        return {
            "today": {"tokens": 0, "cost": 0.0, "requests": 0},
            "period": {
                "days": days,
                "tokens": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "cost": 0.0,
                "requests": 0,
                "fallback_requests": 0,
                "error_requests": 0,
                "cache_savings_estimate": 0.0,
            },
            "daily_series": [],
            "by_sandbox": [],
            "by_team": [],
            "by_model": [],
        }

    stmt = select(LlmUsageLedger).where(
        LlmUsageLedger.sandbox_id.in_(sbx_ids),
        LlmUsageLedger.created_at >= since,
    )
    if team_id:
        stmt = stmt.where(LlmUsageLedger.team_id == team_id)
    rows = list(db.scalars(stmt.order_by(LlmUsageLedger.created_at.asc())).all())

    prof_map = {p.id: p for p in db.scalars(select(LlmProfile)).all()}
    month_rows = db.execute(
        select(
            LlmUsageLedger.sandbox_id,
            func.coalesce(func.sum(LlmUsageLedger.cost_amount), 0.0),
        )
        .where(
            LlmUsageLedger.sandbox_id.in_(sbx_ids),
            LlmUsageLedger.created_at >= month_start,
        )
        .group_by(LlmUsageLedger.sandbox_id)
    ).all()
    month_cost_map = {sid: round(float(val or 0.0), 6) for sid, val in month_rows}

    # Map sandbox_id -> attached team_ids so team spend aggregation is exact even across multiple teams
    ts_links = list(
        db.execute(
            select(TeamSandbox.team_id, TeamSandbox.sandbox_id).where(
                TeamSandbox.sandbox_id.in_(sbx_ids)
            )
        ).all()
    )
    sbx_to_teams: dict[str, list[str]] = {}
    visible_team_ids: set[str] = set()
    for tid, sid in ts_links:
        if team_id and tid != team_id:
            continue
        sbx_to_teams.setdefault(sid, []).append(tid)
        visible_team_ids.add(tid)

    today_tokens = 0
    today_cost = 0.0
    today_reqs = 0
    period_tokens = 0
    period_in = 0
    period_out = 0
    period_cache = 0
    period_cost = 0.0
    fallback_reqs = 0
    error_reqs = 0
    cache_savings_total = 0.0

    daily_map: dict[str, dict[str, Any]] = {}
    sbx_agg: dict[str, dict[str, Any]] = {}
    team_agg: dict[str, dict[str, Any]] = {}
    model_agg: dict[str, dict[str, Any]] = {}

    for r in rows:
        is_today = r.created_at >= day_start
        period_tokens += r.total_tokens
        period_in += r.input_tokens
        period_out += r.output_tokens
        period_cache += r.cache_read_tokens
        period_cost += r.cost_amount
        if r.routed_mode == "fallback":
            fallback_reqs += 1
        if int(r.status_code or 200) >= 400:
            error_reqs += 1
        if r.cache_read_tokens > 0 and r.llm_profile_id in prof_map:
            prof_obj = prof_map[r.llm_profile_id]
            in_p = float(getattr(prof_obj, "input_price_per_1m", None) or 0.0)
            cr_p = getattr(prof_obj, "cache_read_price_per_1m", None)
            if cr_p is not None and float(cr_p) < in_p:
                cache_savings_total += (r.cache_read_tokens / 1_000_000.0) * (
                    in_p - float(cr_p)
                )
        if is_today:
            today_tokens += r.total_tokens
            today_cost += r.cost_amount
            today_reqs += 1

        dkey = r.created_at.strftime("%Y-%m-%d")
        dslot = daily_map.setdefault(dkey, {"date": dkey, "tokens": 0, "cost": 0.0, "requests": 0})
        dslot["tokens"] += r.total_tokens
        dslot["cost"] = round(dslot["cost"] + r.cost_amount, 6)
        dslot["requests"] += 1

        sslot = sbx_agg.setdefault(
            r.sandbox_id,
            {"today_tokens": 0, "today_cost": 0.0, "period_tokens": 0, "period_cost": 0.0, "requests": 0},
        )
        sslot["period_tokens"] += r.total_tokens
        sslot["period_cost"] = round(sslot["period_cost"] + r.cost_amount, 6)
        sslot["requests"] += 1
        if is_today:
            sslot["today_tokens"] += r.total_tokens
            sslot["today_cost"] = round(sslot["today_cost"] + r.cost_amount, 6)

        row_tids = set(sbx_to_teams.get(r.sandbox_id) or [])
        if r.team_id and (not team_id or r.team_id == team_id):
            row_tids.add(r.team_id)
            visible_team_ids.add(r.team_id)
        for tid in row_tids:
            tslot = team_agg.setdefault(
                tid,
                {
                    "today_tokens": 0,
                    "today_cost": 0.0,
                    "period_tokens": 0,
                    "period_cost": 0.0,
                    "requests": 0,
                },
            )
            tslot["period_tokens"] += r.total_tokens
            tslot["period_cost"] = round(tslot["period_cost"] + r.cost_amount, 6)
            tslot["requests"] += 1
            if is_today:
                tslot["today_tokens"] += r.total_tokens
                tslot["today_cost"] = round(tslot["today_cost"] + r.cost_amount, 6)

        mkey = f"{r.model}|{r.api_protocol}"
        mslot = model_agg.setdefault(
            mkey,
            {"model": r.model, "api_protocol": r.api_protocol, "tokens": 0, "cost": 0.0, "requests": 0},
        )
        mslot["tokens"] += r.total_tokens
        mslot["cost"] = round(mslot["cost"] + r.cost_amount, 6)
        mslot["requests"] += 1

    by_sandbox = []
    for sbx in visible_sandboxes:
        st = sbx_agg.get(sbx.id) or {
            "today_tokens": 0,
            "today_cost": 0.0,
            "period_tokens": 0,
            "period_cost": 0.0,
            "requests": 0,
        }
        cost_limit = getattr(sbx, "daily_cost_limit", None)
        monthly_cost_val = month_cost_map.get(sbx.id, 0.0)
        monthly_cost_limit = getattr(sbx, "monthly_cost_limit", None)
        token_limit = getattr(sbx, "daily_token_limit", None)
        cost_pct = (
            round((st["today_cost"] / float(cost_limit)) * 100, 1)
            if cost_limit is not None and float(cost_limit) > 0
            else None
        )
        monthly_pct = (
            round((monthly_cost_val / float(monthly_cost_limit)) * 100, 1)
            if monthly_cost_limit is not None and float(monthly_cost_limit) > 0
            else None
        )
        token_pct = (
            round((st["today_tokens"] / token_limit) * 100, 1)
            if token_limit and token_limit > 0
            else None
        )
        by_sandbox.append(
            {
                "sandbox_id": sbx.id,
                "slug": sbx.slug,
                "display_name": sbx.effective_display_name or sbx.slug,
                "role_title": sbx.role_title,
                "ownership_mode": getattr(sbx, "ownership_mode", "personal") or "personal",
                "today_tokens": st["today_tokens"],
                "today_cost": st["today_cost"],
                "daily_cost_limit": cost_limit,
                "monthly_cost": monthly_cost_val,
                "monthly_cost_limit": monthly_cost_limit,
                "monthly_budget_percent": monthly_pct,
                "rpm_limit": getattr(sbx, "rpm_limit", None),
                "tpm_limit": getattr(sbx, "tpm_limit", None),
                "max_concurrent_requests": getattr(sbx, "max_concurrent_requests", None),
                "dlp_mode": getattr(sbx, "dlp_mode", None),
                "cost_budget_percent": cost_pct,
                "daily_limit": token_limit,
                "budget_percent": cost_pct if cost_pct is not None else token_pct,
                "budget_action": getattr(sbx, "budget_action", "block") or "block",
                "period_tokens": st["period_tokens"],
                "period_cost": st["period_cost"],
                "requests": st["requests"],
            }
        )
    by_sandbox.sort(key=lambda x: (-x["period_cost"], -x["period_tokens"], x["slug"]))

    teams_by_id = (
        {
            t.id: t
            for t in db.scalars(select(Team).where(Team.id.in_(list(visible_team_ids)))).all()
        }
        if visible_team_ids
        else {}
    )
    by_team = []
    for tid in visible_team_ids:
        tm = teams_by_id.get(tid)
        st = team_agg.get(tid) or {
            "today_tokens": 0,
            "today_cost": 0.0,
            "period_tokens": 0,
            "period_cost": 0.0,
            "requests": 0,
        }
        tm_cost_budget = getattr(tm, "daily_cost_budget", None) if tm else None
        tm_cost_pct = (
            round((st["today_cost"] / float(tm_cost_budget)) * 100, 1)
            if tm_cost_budget is not None and float(tm_cost_budget) > 0
            else None
        )
        by_team.append(
            {
                "team_id": tid,
                "team_name": tm.name if tm else tid,
                "department": tm.department if tm else None,
                "today_tokens": st["today_tokens"],
                "today_cost": st["today_cost"],
                "daily_cost_budget": tm_cost_budget,
                "cost_budget_percent": tm_cost_pct,
                "daily_budget": tm.daily_token_budget if tm else None,
                "period_tokens": st["period_tokens"],
                "period_cost": st["period_cost"],
                "requests": st["requests"],
            }
        )
    by_team.sort(key=lambda x: (-x["period_cost"], -x["period_tokens"], x["team_name"]))

    by_model = sorted(model_agg.values(), key=lambda x: (-x["cost"], -x["tokens"]))
    daily_series = sorted(daily_map.values(), key=lambda x: x["date"])

    return {
        "today": {
            "tokens": today_tokens,
            "cost": round(today_cost, 6),
            "requests": today_reqs,
        },
        "period": {
            "days": days,
            "tokens": period_tokens,
            "input_tokens": period_in,
            "output_tokens": period_out,
            "cache_read_tokens": period_cache,
            "cost": round(period_cost, 6),
            "requests": len(rows),
            "fallback_requests": fallback_reqs,
            "error_requests": error_reqs,
            "dlp_redactions": sum(int(getattr(r, "dlp_redacted_count", 0) or 0) for r in rows),
            "cache_savings_estimate": round(cache_savings_total, 6),
        },
        "daily_series": daily_series,
        "by_sandbox": by_sandbox,
        "by_team": by_team,
        "by_model": by_model,
    }
