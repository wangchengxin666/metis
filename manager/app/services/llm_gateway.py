"""Built-in lightweight Metis LLM Gateway: virtual key isolation, streaming metering, budget guardrails, and FinOps ledger."""

from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import LlmProfile, LlmUsageLedger, Sandbox, Team, TeamSandbox
from ..security import decrypt_secret
from .common import utcnow
from .notifications import NotificationEvent, dispatch_notification_event
from .policies import get_branding_config

logger = logging.getLogger("dsh-manager.llm_gateway")


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


def extract_usage_from_payload(payload: dict[str, Any], api_protocol: str) -> tuple[int, int, int, int]:
    """Extract (input_tokens, output_tokens, cache_read_tokens, total_tokens) from OpenAI/Anthropic/Gemini JSON."""
    if not isinstance(payload, dict):
        return 0, 0, 0, 0

    # Gemini usageMetadata
    gm = payload.get("usageMetadata")
    if isinstance(gm, dict):
        inp = int(gm.get("promptTokenCount") or 0)
        out = int(gm.get("candidatesTokenCount") or 0)
        cr = int(gm.get("cachedContentTokenCount") or 0)
        tot = int(gm.get("totalTokenCount") or (inp + out))
        return inp, out, cr, tot

    # OpenAI Responses wraps under response.usage
    usage = payload.get("usage")
    if not isinstance(usage, dict) and isinstance(payload.get("response"), dict):
        usage = payload["response"].get("usage")
    if not isinstance(usage, dict) and isinstance(payload.get("message"), dict):
        usage = payload["message"].get("usage")
    if not isinstance(usage, dict):
        return 0, 0, 0, 0

    inp = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    out = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    cr = int(usage.get("cache_read_input_tokens") or usage.get("cache_read_tokens") or 0)
    if cr == 0:
        details = usage.get("prompt_tokens_details") or usage.get("input_tokens_details")
        if isinstance(details, dict):
            cr = int(details.get("cached_tokens") or 0)
    tot = int(usage.get("total_tokens") or (inp + out))
    if tot == 0 and (inp or out):
        tot = inp + out
    return inp, out, cr, tot


def extract_usage_from_sse_text(raw_sse: str, api_protocol: str) -> tuple[int, int, int, int]:
    """Parse token usage incrementally across SSE data lines (OpenAI, Anthropic, Gemini)."""
    inp = 0
    out = 0
    cr = 0
    tot = 0
    for line in raw_sse.splitlines():
        stripped = line.strip()
        if not stripped.startswith("data:"):
            continue
        data_str = stripped[5:].strip()
        if not data_str or data_str == "[DONE]":
            continue
        try:
            obj = json.loads(data_str)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        e_in, e_out, e_cr, e_tot = extract_usage_from_payload(obj, api_protocol)
        if e_in > inp:
            inp = e_in
        if e_out > out:
            out = e_out
        if e_cr > cr:
            cr = e_cr
        if e_tot > tot:
            tot = e_tot
    if tot == 0 and (inp or out):
        tot = inp + out
    return inp, out, cr, tot


def compute_usage_cost(
    profile: LlmProfile,
    input_tokens: int,
    output_tokens: int,
) -> float:
    in_price = float(getattr(profile, "input_price_per_1m", None) or 0.0)
    out_price = float(getattr(profile, "output_price_per_1m", None) or 0.0)
    cost = (max(0, input_tokens) / 1_000_000.0) * in_price + (
        max(0, output_tokens) / 1_000_000.0
    ) * out_price
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


def evaluate_budget_and_route(
    db: Session,
    settings: Settings,
    sandbox: Sandbox,
    profile: LlmProfile,
) -> tuple[str, LlmProfile, int, int | None]:
    """Check daily budget and return (decision: 'primary'|'fallback'|'block', effective_profile, used_today, limit)."""
    daily_limit = getattr(sandbox, "daily_token_limit", None)
    if not daily_limit or daily_limit <= 0:
        return "primary", profile, 0, None

    used_today = get_sandbox_today_tokens(db, sandbox.id)
    today_tag = utcnow().strftime("%Y%m%d")
    action = (getattr(sandbox, "budget_action", None) or "block").strip().lower()

    if used_today >= daily_limit:
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
                        title=f"@{sandbox.slug} 达到每日 Token 上限，已自动降级至 {fallback.name}",
                        summary=f"今日已用 {used_today:,} / 上限 {daily_limit:,} Tokens，系统已切换至备用低成本模型 {fallback.model}。",
                        severity="warning",
                        sandbox_id=sandbox.id,
                        sandbox_slug=sandbox.slug,
                        role_title=sandbox.role_title,
                        project_team_name=sandbox.project_team_name,
                        dedupe_key=f"budget.downgrade:{sandbox.id}:{today_tag}",
                    ),
                    brand_name=brand_name,
                )
                return "fallback", fallback, used_today, daily_limit

        dispatch_notification_event(
            db,
            settings,
            NotificationEvent(
                event_type="budget.exceeded",
                title=f"@{sandbox.slug} 已触达每日 Token 预算上限 ({'已熔断' if action == 'block' else '仅告警'})",
                summary=f"今日已消耗 {used_today:,} Tokens，达到配额上限 {daily_limit:,} Tokens。",
                severity="danger",
                sandbox_id=sandbox.id,
                sandbox_slug=sandbox.slug,
                role_title=sandbox.role_title,
                project_team_name=sandbox.project_team_name,
                dedupe_key=f"budget.exceeded:{sandbox.id}:{today_tag}",
            ),
            brand_name=brand_name,
        )
        if action == "warn":
            return "primary", profile, used_today, daily_limit
        return "block", profile, used_today, daily_limit

    if used_today >= int(daily_limit * 0.8):
        brand = get_branding_config(db)
        brand_name = str(brand.get("brand_name_zh") or brand.get("brand_name_en") or "Metis")
        pct = round((used_today / daily_limit) * 100)
        dispatch_notification_event(
            db,
            settings,
            NotificationEvent(
                event_type="budget.warning",
                title=f"@{sandbox.slug} 每日 Token 预算已消耗 {pct}%",
                summary=f"今日已用 {used_today:,} / 上限 {daily_limit:,} Tokens，请留意算力消耗。",
                severity="warning",
                sandbox_id=sandbox.id,
                sandbox_slug=sandbox.slug,
                role_title=sandbox.role_title,
                project_team_name=sandbox.project_team_name,
                dedupe_key=f"budget.warning:{sandbox.id}:{today_tag}",
            ),
            brand_name=brand_name,
        )

    return "primary", profile, used_today, daily_limit


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
) -> LlmUsageLedger:
    team_id = get_sandbox_primary_team_id(db, sandbox.id)
    cost = compute_usage_cost(profile, input_tokens, output_tokens)
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
        total_tokens=max(0, int(total_tokens)),
        cost_amount=cost,
        routed_mode=routed_mode,
        status_code=status_code,
        latency_ms=max(0, int(latency_ms)),
        created_at=utcnow(),
    )
    db.add(entry)
    db.commit()
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

    today_tokens = 0
    today_cost = 0.0
    today_reqs = 0
    period_tokens = 0
    period_in = 0
    period_out = 0
    period_cache = 0
    period_cost = 0.0
    fallback_reqs = 0

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

        if r.team_id:
            tslot = team_agg.setdefault(
                r.team_id,
                {"today_tokens": 0, "period_tokens": 0, "period_cost": 0.0, "requests": 0},
            )
            tslot["period_tokens"] += r.total_tokens
            tslot["period_cost"] = round(tslot["period_cost"] + r.cost_amount, 6)
            tslot["requests"] += 1
            if is_today:
                tslot["today_tokens"] += r.total_tokens

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
        limit = getattr(sbx, "daily_token_limit", None)
        pct = round((st["today_tokens"] / limit) * 100, 1) if limit and limit > 0 else None
        by_sandbox.append(
            {
                "sandbox_id": sbx.id,
                "slug": sbx.slug,
                "display_name": sbx.effective_display_name or sbx.slug,
                "role_title": sbx.role_title,
                "ownership_mode": getattr(sbx, "ownership_mode", "personal") or "personal",
                "today_tokens": st["today_tokens"],
                "today_cost": st["today_cost"],
                "daily_limit": limit,
                "budget_percent": pct,
                "budget_action": getattr(sbx, "budget_action", "block") or "block",
                "period_tokens": st["period_tokens"],
                "period_cost": st["period_cost"],
                "requests": st["requests"],
            }
        )
    by_sandbox.sort(key=lambda x: (-x["period_tokens"], -x["today_tokens"], x["slug"]))

    teams_by_id = {
        t.id: t
        for t in db.scalars(select(Team).where(Team.id.in_(list(team_agg.keys())))).all()
    } if team_agg else {}
    by_team = []
    for tid, st in team_agg.items():
        tm = teams_by_id.get(tid)
        by_team.append(
            {
                "team_id": tid,
                "team_name": tm.name if tm else tid,
                "department": tm.department if tm else None,
                "today_tokens": st["today_tokens"],
                "daily_budget": tm.daily_token_budget if tm else None,
                "period_tokens": st["period_tokens"],
                "period_cost": st["period_cost"],
                "requests": st["requests"],
            }
        )
    by_team.sort(key=lambda x: -x["period_tokens"])

    by_model = sorted(model_agg.values(), key=lambda x: -x["tokens"])
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
        },
        "daily_series": daily_series,
        "by_sandbox": by_sandbox,
        "by_team": by_team,
        "by_model": by_model,
    }
