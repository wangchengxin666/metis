"""Built-in Metis LLM Gateway transparent proxy & FinOps ledger endpoints."""

from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import SessionLocal, get_db
from ..deps import (
    _ensure_active_user,
    _is_authenticated_admin,
    require_user_api,
    settings,
)
from ..models import LlmProfile, Sandbox, TeamMember, TeamSandbox
from ..security import decrypt_secret
from ..services.common import audit
from ..services.llm_gateway import (
    SseUsageAccumulator,
    acquire_sandbox_concurrency,
    apply_outbound_dlp,
    build_finops_summary,
    check_sandbox_rpm_limit,
    check_sandbox_tpm_limit,
    collect_sandbox_vault_secrets,
    evaluate_budget_and_route,
    extract_detailed_usage_from_payload,
    get_circuit_breaker_snapshot,
    is_upstream_circuit_open,
    record_llm_usage,
    record_upstream_failure,
    record_upstream_key_failure,
    record_upstream_key_success,
    record_upstream_success,
    release_sandbox_concurrency,
    resolve_fallback_chain,
    resolve_gateway_trace_context,
    resolve_upstream_targets,
)

router = APIRouter()

_RETRYABLE_UPSTREAM_STATUSES = {429, 500, 502, 503, 504}

_HOP_BY_HOP_HEADERS = {
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "authorization",
    "x-api-key",
    "accept-encoding",
}


def _extract_virtual_key(request: Request) -> str:
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    xkey = (request.headers.get("x-api-key") or "").strip()
    if xkey:
        return xkey
    qkey = (request.query_params.get("key") or "").strip()
    return qkey


def _build_upstream_attempt(
    profile: LlmProfile,
    *,
    method: str,
    subpath: str,
    raw_body: bytes,
    orig_headers: Any,
    orig_query: Any,
    override_model: bool,
    force_stream_hint: bool,
    upstream_target: dict[str, str] | None = None,
) -> tuple[str, str, dict[str, str], dict[str, str], bytes, str, bool]:
    protocol = (profile.api_protocol or "openai-completions").strip()
    requested_model = profile.model
    is_stream = force_stream_hint
    body_bytes = raw_body
    if raw_body and method in {"POST", "PUT"}:
        try:
            body_json = json.loads(raw_body.decode("utf-8"))
            if isinstance(body_json, dict):
                is_stream = is_stream or bool(body_json.get("stream"))
                mutated = False
                if override_model:
                    body_json["model"] = profile.model
                    requested_model = profile.model
                    mutated = True
                elif body_json.get("model"):
                    requested_model = str(body_json["model"])
                if (
                    is_stream
                    and protocol == "openai-completions"
                    and "stream_options" not in body_json
                ):
                    body_json["stream_options"] = {"include_usage": True}
                    mutated = True
                elif protocol != "openai-completions" and "stream_options" in body_json:
                    body_json.pop("stream_options", None)
                    mutated = True
                if mutated:
                    body_bytes = json.dumps(body_json, ensure_ascii=False).encode("utf-8")
        except Exception:
            pass

    if upstream_target is not None:
        upstream_key = str(upstream_target.get("api_key") or "")
        base_clean = str(upstream_target.get("base_url") or profile.base_url).rstrip("/")
    else:
        upstream_key = ""
        if profile.api_key_ciphertext:
            try:
                upstream_key = decrypt_secret(profile.api_key_ciphertext)
            except ValueError:
                upstream_key = ""
        base_clean = profile.base_url.rstrip("/")

    sub_clean = subpath.lstrip("/")
    if base_clean.endswith("/v1") and sub_clean.startswith("v1/"):
        sub_clean = sub_clean[3:]
    upstream_url = f"{base_clean}/{sub_clean}" if sub_clean else base_clean
    forward_params = {k: v for k, v in orig_query.items() if k != "key"}

    forward_headers: dict[str, str] = {}
    for k, v in orig_headers.items():
        if k.lower() in _HOP_BY_HOP_HEADERS:
            continue
        forward_headers[k] = v
    if upstream_key:
        if protocol == "anthropic-messages":
            forward_headers["x-api-key"] = upstream_key
        elif protocol == "google-generative-ai":
            forward_params["key"] = upstream_key
        else:
            forward_headers["Authorization"] = f"Bearer {upstream_key}"

    return (
        protocol,
        upstream_url,
        forward_params,
        forward_headers,
        body_bytes,
        requested_model,
        is_stream,
    )


@router.api_route(
    "/api/llm-gateway/p/{profile_id}/{subpath:path}",
    methods=["GET", "POST", "PUT", "DELETE"],
    include_in_schema=False,
)
async def llm_gateway_proxy(
    profile_id: str,
    subpath: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Transparent streaming/JSON LLM proxy authenticating sandboxes via virtual keys, budgets, RPM/TPM/concurrency guardrails, DLP, and HA failover."""
    vkey = _extract_virtual_key(request)
    if not vkey:
        return JSONResponse(
            status_code=401,
            content={"error": {"message": "Missing Metis virtual gateway key", "type": "auth_error"}},
        )

    sandbox = db.scalar(
        select(Sandbox)
        .options(joinedload(Sandbox.user))
        .where(Sandbox.gateway_api_key == vkey, Sandbox.deleted_at.is_(None))
    )
    if sandbox is None:
        return JSONResponse(
            status_code=401,
            content={"error": {"message": "Invalid Metis virtual gateway key", "type": "auth_error"}},
        )

    profile = db.get(LlmProfile, profile_id)
    if profile is None:
        return JSONResponse(
            status_code=404,
            content={"error": {"message": "LLM profile not found", "type": "not_found"}},
        )

    rpm_ok, retry_after = check_sandbox_rpm_limit(sandbox)
    if not rpm_ok:
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(retry_after)},
            content={
                "error": {
                    "message": (
                        f"RPM rate limit exceeded for @{sandbox.slug} "
                        f"(limit={getattr(sandbox, 'rpm_limit', None)} req/min)."
                    ),
                    "type": "rate_limit_exceeded",
                    "code": "rpm_limit_exceeded",
                }
            },
        )

    tpm_ok, tpm_retry = check_sandbox_tpm_limit(sandbox, profile)
    if not tpm_ok:
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(tpm_retry)},
            content={
                "error": {
                    "message": (
                        f"TPM token rate limit exceeded for @{sandbox.slug} "
                        f"(limit={getattr(sandbox, 'tpm_limit', None) or getattr(profile, 'tpm_limit', None)} tok/min)."
                    ),
                    "type": "rate_limit_exceeded",
                    "code": "tpm_limit_exceeded",
                }
            },
        )

    budget_eval = evaluate_budget_and_route(db, settings, sandbox, profile)
    decision = budget_eval.decision
    target_profile = budget_eval.profile
    if decision == "block":
        return JSONResponse(
            status_code=429,
            content={
                "error": {
                    "message": budget_eval.error_message
                    or f"Daily budget exceeded for @{sandbox.slug}.",
                    "type": "budget_exceeded",
                    "code": budget_eval.error_code or "daily_cost_limit_exceeded",
                }
            },
        )

    raw_body = await request.body()
    eff_dlp = (getattr(sandbox, "dlp_mode", None) or getattr(target_profile, "dlp_mode", None) or "off").strip().lower()
    dlp_redacted_count = 0
    if eff_dlp in {"redact", "block"} and raw_body and request.method in {"POST", "PUT"}:
        vault_secrets = collect_sandbox_vault_secrets(db, sandbox)
        scrubbed_body, hit_count, hit_types = apply_outbound_dlp(
            raw_body, mode=eff_dlp, extra_secrets=vault_secrets
        )
        if hit_count > 0:
            if eff_dlp == "block":
                audit(
                    db,
                    "llm_gateway.dlp_blocked",
                    target=sandbox.id,
                    detail=f"slug={sandbox.slug},types={','.join(hit_types)},hits={hit_count}",
                )
                db.commit()
                return JSONResponse(
                    status_code=403,
                    content={
                        "error": {
                            "message": f"Outbound DLP policy blocked sensitive content ({', '.join(hit_types)}).",
                            "type": "dlp_policy_violation",
                            "code": "dlp_policy_violation",
                        }
                    },
                )
            raw_body = scrubbed_body
            dlp_redacted_count = hit_count

    conc_ok, conc_token = acquire_sandbox_concurrency(
        sandbox, default_limit=int(getattr(settings, "llm_gateway_concurrent_limit", 32) or 32)
    )
    if not conc_ok:
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": "2"},
            content={
                "error": {
                    "message": f"Concurrent in-flight request limit reached for @{sandbox.slug}.",
                    "type": "rate_limit_exceeded",
                    "code": "concurrency_limit_exceeded",
                }
            },
        )

    stream_owns_conc_token = False
    try:
        # Assemble ordered HA attempts across multi-hop fallback chain and per-profile key pools
        fallback_chain = resolve_fallback_chain(db, target_profile, max_hops=4)
        candidate_profiles: list[tuple[LlmProfile, str, bool]] = []
        if decision == "primary" and is_upstream_circuit_open(target_profile) and fallback_chain:
            for hop_idx, fb in enumerate(fallback_chain):
                if not is_upstream_circuit_open(fb) or hop_idx == len(fallback_chain) - 1:
                    candidate_profiles.append((fb, "fallback", True))
        else:
            candidate_profiles.append(
                (target_profile, decision, decision == "fallback")
            )
            if decision == "primary":
                for fb in fallback_chain:
                    if not is_upstream_circuit_open(fb) or fb == fallback_chain[-1]:
                        candidate_profiles.append((fb, "fallback", True))

        expanded_attempts: list[tuple[LlmProfile, str, bool, dict[str, str], bool]] = []
        for prof_item, mode_item, override_model in candidate_profiles:
            key_targets = resolve_upstream_targets(prof_item)
            for k_idx, kt in enumerate(key_targets):
                is_last_key_for_prof = k_idx == len(key_targets) - 1
                expanded_attempts.append(
                    (prof_item, mode_item, override_model, kt, is_last_key_for_prof)
                )

        trace_ctx = resolve_gateway_trace_context(db, sandbox, request.headers)
        force_stream_hint = (
            "streamGenerateContent" in subpath or request.query_params.get("alt") == "sse"
        )
        timeout = httpx.Timeout(
            float(getattr(settings, "llm_gateway_read_timeout_seconds", 300.0) or 300.0),
            connect=float(getattr(settings, "llm_gateway_connect_timeout_seconds", 15.0) or 15.0),
        )
        cb_threshold = int(getattr(settings, "llm_gateway_circuit_breaker_threshold", 3) or 3)
        cb_cooldown = int(getattr(settings, "llm_gateway_circuit_breaker_cooldown_seconds", 60) or 60)

        started = time.perf_counter()
        sandbox_id = sandbox.id

        for idx, (attempt_prof, attempt_mode, override_model, key_target, is_last_key) in enumerate(expanded_attempts):
            has_next_attempt = idx + 1 < len(expanded_attempts)
            key_id = key_target["key_id"]
            key_label = key_target["label"]
            (
                protocol,
                upstream_url,
                forward_params,
                forward_headers,
                attempt_body,
                requested_model,
                is_stream,
            ) = _build_upstream_attempt(
                attempt_prof,
                method=request.method,
                subpath=subpath,
                raw_body=raw_body,
                orig_headers=request.headers,
                orig_query=request.query_params,
                override_model=override_model,
                force_stream_hint=force_stream_hint,
                upstream_target=key_target,
            )
            attempt_prof_id = attempt_prof.id

            if is_stream:
                client = httpx.AsyncClient(timeout=timeout)
                req = client.build_request(
                    request.method,
                    upstream_url,
                    params=forward_params,
                    headers=forward_headers,
                    content=attempt_body,
                )
                try:
                    upstream_resp = await client.send(req, stream=True)
                except Exception as exc:
                    await client.aclose()
                    elapsed_ms = int((time.perf_counter() - started) * 1000)
                    record_upstream_key_failure(attempt_prof, key_id, reason=str(exc))
                    if is_last_key:
                        record_upstream_failure(
                            attempt_prof,
                            reason=str(exc),
                            threshold=cb_threshold,
                            cooldown_seconds=cb_cooldown,
                        )
                    record_llm_usage(
                        db,
                        sandbox=sandbox,
                        profile=attempt_prof,
                        model=requested_model,
                        input_tokens=0,
                        output_tokens=0,
                        cache_read_tokens=0,
                        total_tokens=0,
                        routed_mode=attempt_mode,
                        status_code=502,
                        latency_ms=elapsed_ms,
                        upstream_key_label=key_label,
                        dlp_redacted_count=dlp_redacted_count,
                        **trace_ctx,
                    )
                    if has_next_attempt:
                        continue
                    return JSONResponse(
                        status_code=502,
                        content={"error": {"message": f"Upstream LLM unreachable: {exc}", "type": "gateway_error"}},
                    )

                status_code = upstream_resp.status_code
                if status_code in _RETRYABLE_UPSTREAM_STATUSES and has_next_attempt:
                    elapsed_ms = int((time.perf_counter() - started) * 1000)
                    record_upstream_key_failure(attempt_prof, key_id, reason=f"HTTP {status_code}")
                    if is_last_key:
                        record_upstream_failure(
                            attempt_prof,
                            reason=f"HTTP {status_code}",
                            threshold=cb_threshold,
                            cooldown_seconds=cb_cooldown,
                        )
                    await upstream_resp.aclose()
                    await client.aclose()
                    record_llm_usage(
                        db,
                        sandbox=sandbox,
                        profile=attempt_prof,
                        model=requested_model,
                        input_tokens=0,
                        output_tokens=0,
                        cache_read_tokens=0,
                        total_tokens=0,
                        routed_mode=attempt_mode,
                        status_code=status_code,
                        latency_ms=elapsed_ms,
                        upstream_key_label=key_label,
                        dlp_redacted_count=dlp_redacted_count,
                        **trace_ctx,
                    )
                    continue

                media_type = upstream_resp.headers.get("content-type") or "text/event-stream"
                stream_owns_conc_token = True

                async def _stream_and_meter(
                    _upstream_resp=upstream_resp,
                    _client=client,
                    _protocol=protocol,
                    _attempt_prof_id=attempt_prof_id,
                    _requested_model=requested_model,
                    _attempt_mode=attempt_mode,
                    _status_code=status_code,
                    _key_id=key_id,
                    _key_label=key_label,
                    _is_last_key=is_last_key,
                    _conc_token=conc_token,
                ) -> AsyncIterator[bytes]:
                    acc = SseUsageAccumulator(_protocol)
                    try:
                        async for chunk in _upstream_resp.aiter_bytes():
                            if chunk:
                                acc.feed(chunk)
                                yield chunk
                    finally:
                        release_sandbox_concurrency(sandbox, _conc_token)
                        await _upstream_resp.aclose()
                        await _client.aclose()
                        elapsed_ms = int((time.perf_counter() - started) * 1000)
                        inp, out, cr, cc, tot = acc.finalize_detailed()
                        with SessionLocal() as ledger_db:
                            sbx_obj = ledger_db.get(Sandbox, sandbox_id)
                            prof_obj = ledger_db.get(LlmProfile, _attempt_prof_id)
                            if prof_obj is not None:
                                if _status_code < 400:
                                    record_upstream_key_success(prof_obj.id, _key_id)
                                    record_upstream_success(prof_obj.id)
                                elif _status_code in _RETRYABLE_UPSTREAM_STATUSES:
                                    record_upstream_key_failure(
                                        prof_obj, _key_id, reason=f"HTTP {_status_code}"
                                    )
                                    if _is_last_key:
                                        record_upstream_failure(
                                            prof_obj,
                                            reason=f"HTTP {_status_code}",
                                            threshold=cb_threshold,
                                            cooldown_seconds=cb_cooldown,
                                        )
                            if sbx_obj and prof_obj:
                                record_llm_usage(
                                    ledger_db,
                                    sandbox=sbx_obj,
                                    profile=prof_obj,
                                    model=_requested_model,
                                    input_tokens=inp,
                                    output_tokens=out,
                                    cache_read_tokens=cr,
                                    cache_creation_tokens=cc,
                                    total_tokens=tot,
                                    routed_mode=_attempt_mode,
                                    status_code=_status_code,
                                    latency_ms=elapsed_ms,
                                    upstream_key_label=_key_label,
                                    dlp_redacted_count=dlp_redacted_count,
                                    **trace_ctx,
                                )

                return StreamingResponse(
                    _stream_and_meter(),
                    status_code=status_code,
                    media_type=media_type,
                    headers={
                        "Cache-Control": "no-cache",
                        "X-Accel-Buffering": "no",
                    },
                )

            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    upstream_resp = await client.request(
                        request.method,
                        upstream_url,
                        params=forward_params,
                        headers=forward_headers,
                        content=attempt_body,
                    )
            except Exception as exc:
                elapsed_ms = int((time.perf_counter() - started) * 1000)
                record_upstream_key_failure(attempt_prof, key_id, reason=str(exc))
                if is_last_key:
                    record_upstream_failure(
                        attempt_prof,
                        reason=str(exc),
                        threshold=cb_threshold,
                        cooldown_seconds=cb_cooldown,
                    )
                record_llm_usage(
                    db,
                    sandbox=sandbox,
                    profile=attempt_prof,
                    model=requested_model,
                    input_tokens=0,
                    output_tokens=0,
                    cache_read_tokens=0,
                    total_tokens=0,
                    routed_mode=attempt_mode,
                    status_code=502,
                    latency_ms=elapsed_ms,
                    upstream_key_label=key_label,
                    dlp_redacted_count=dlp_redacted_count,
                    **trace_ctx,
                )
                if has_next_attempt:
                    continue
                return JSONResponse(
                    status_code=502,
                    content={"error": {"message": f"Upstream LLM unreachable: {exc}", "type": "gateway_error"}},
                )

            elapsed_ms = int((time.perf_counter() - started) * 1000)
            if upstream_resp.status_code in _RETRYABLE_UPSTREAM_STATUSES:
                record_upstream_key_failure(
                    attempt_prof, key_id, reason=f"HTTP {upstream_resp.status_code}"
                )
                if is_last_key:
                    record_upstream_failure(
                        attempt_prof,
                        reason=f"HTTP {upstream_resp.status_code}",
                        threshold=cb_threshold,
                        cooldown_seconds=cb_cooldown,
                    )
                if has_next_attempt:
                    record_llm_usage(
                        db,
                        sandbox=sandbox,
                        profile=attempt_prof,
                        model=requested_model,
                        input_tokens=0,
                        output_tokens=0,
                        cache_read_tokens=0,
                        total_tokens=0,
                        routed_mode=attempt_mode,
                        status_code=upstream_resp.status_code,
                        latency_ms=elapsed_ms,
                        upstream_key_label=key_label,
                        dlp_redacted_count=dlp_redacted_count,
                        **trace_ctx,
                    )
                    continue
            elif upstream_resp.status_code < 400:
                record_upstream_key_success(attempt_prof.id, key_id)
                record_upstream_success(attempt_prof.id)

            inp = out = cr = cc = tot = 0
            try:
                parsed_resp = upstream_resp.json()
                if isinstance(parsed_resp, dict):
                    inp, out, cr, cc, tot = extract_detailed_usage_from_payload(parsed_resp, protocol)
            except Exception:
                pass

            record_llm_usage(
                db,
                sandbox=sandbox,
                profile=attempt_prof,
                model=requested_model,
                input_tokens=inp,
                output_tokens=out,
                cache_read_tokens=cr,
                cache_creation_tokens=cc,
                total_tokens=tot,
                routed_mode=attempt_mode,
                status_code=upstream_resp.status_code,
                latency_ms=elapsed_ms,
                upstream_key_label=key_label,
                dlp_redacted_count=dlp_redacted_count,
                **trace_ctx,
            )
            resp_headers = {}
            if upstream_resp.headers.get("content-type"):
                resp_headers["content-type"] = upstream_resp.headers["content-type"]
            return Response(
                content=upstream_resp.content,
                status_code=upstream_resp.status_code,
                headers=resp_headers,
            )

        return JSONResponse(
            status_code=502,
            content={"error": {"message": "Upstream LLM unavailable", "type": "gateway_error"}},
        )
    finally:
        if not stream_owns_conc_token:
            release_sandbox_concurrency(sandbox, conc_token)


@router.get("/api/finops/summary")
def api_finops_summary(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
    team_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """FinOps cost & token usage dashboard scoped to Platform Admins or Team Leads."""
    is_admin = _is_authenticated_admin(request, db)
    if is_admin:
        query = (
            select(Sandbox)
            .options(joinedload(Sandbox.user))
            .where(Sandbox.deleted_at.is_(None))
        )
        if team_id:
            sbx_ids = list(
                db.scalars(
                    select(TeamSandbox.sandbox_id).where(TeamSandbox.team_id == team_id)
                ).all()
            )
            query = query.where(Sandbox.id.in_(sbx_ids)) if sbx_ids else query.where(Sandbox.id == "")
        sandboxes = list(db.scalars(query.order_by(Sandbox.slug.asc())).all())
        summary = build_finops_summary(db, sandboxes, days=days, team_id=team_id)
        summary["circuit_breakers"] = get_circuit_breaker_snapshot()
        return summary

    email = require_user_api(request)
    _ensure_active_user(db, email)
    lead_team_ids = list(
        db.scalars(
            select(TeamMember.team_id).where(
                TeamMember.user_email == email,
                TeamMember.role == "lead",
            )
        ).all()
    )
    if not lead_team_ids:
        raise HTTPException(status_code=403, detail="仅平台管理员或团队负责人 (Team Lead) 可查看成本账单")
    if team_id and team_id not in lead_team_ids:
        raise HTTPException(status_code=403, detail="无权查看其他团队的成本账单")
    scoped_team_ids = [team_id] if team_id else lead_team_ids
    sbx_ids = list(
        db.scalars(
            select(TeamSandbox.sandbox_id).where(TeamSandbox.team_id.in_(scoped_team_ids))
        ).all()
    )
    sandboxes = (
        list(
            db.scalars(
                select(Sandbox)
                .options(joinedload(Sandbox.user))
                .where(Sandbox.deleted_at.is_(None), Sandbox.id.in_(sbx_ids))
                .order_by(Sandbox.slug.asc())
            ).all()
        )
        if sbx_ids
        else []
    )
    return build_finops_summary(db, sandboxes, days=days, team_id=team_id)
