"""Built-in Metis LLM Gateway transparent proxy & FinOps ledger endpoints."""

from __future__ import annotations

import json
import time
from typing import AsyncIterator

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
from ..services.llm_gateway import (
    build_finops_summary,
    evaluate_budget_and_route,
    extract_usage_from_payload,
    extract_usage_from_sse_text,
    record_llm_usage,
)

router = APIRouter()

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
    """Transparent streaming/JSON LLM proxy authenticating sandboxes via virtual keys and enforcing daily budgets."""
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

    protocol = (target_profile.api_protocol or "openai-completions").strip()
    raw_body = await request.body()
    requested_model = target_profile.model
    is_stream = False
    if raw_body and request.method in {"POST", "PUT"}:
        try:
            body_json = json.loads(raw_body.decode("utf-8"))
            if isinstance(body_json, dict):
                is_stream = bool(body_json.get("stream"))
                mutated = False
                if decision == "fallback":
                    body_json["model"] = target_profile.model
                    requested_model = target_profile.model
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
                if mutated:
                    raw_body = json.dumps(body_json, ensure_ascii=False).encode("utf-8")
        except Exception:
            pass

    if "streamGenerateContent" in subpath or request.query_params.get("alt") == "sse":
        is_stream = True

    upstream_key = ""
    if target_profile.api_key_ciphertext:
        try:
            upstream_key = decrypt_secret(target_profile.api_key_ciphertext)
        except ValueError:
            upstream_key = ""

    base_clean = target_profile.base_url.rstrip("/")
    sub_clean = subpath.lstrip("/")
    if base_clean.endswith("/v1") and sub_clean.startswith("v1/"):
        sub_clean = sub_clean[3:]
    upstream_url = f"{base_clean}/{sub_clean}" if sub_clean else base_clean
    forward_params = {k: v for k, v in request.query_params.items() if k != "key"}

    forward_headers: dict[str, str] = {}
    for k, v in request.headers.items():
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

    started = time.perf_counter()
    sandbox_id = sandbox.id
    target_profile_id = target_profile.id

    if is_stream:
        client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0))
        req = client.build_request(
            request.method,
            upstream_url,
            params=forward_params,
            headers=forward_headers,
            content=raw_body,
        )
        try:
            upstream_resp = await client.send(req, stream=True)
        except Exception as exc:
            await client.aclose()
            return JSONResponse(
                status_code=502,
                content={"error": {"message": f"Upstream LLM unreachable: {exc}", "type": "gateway_error"}},
            )

        status_code = upstream_resp.status_code
        media_type = upstream_resp.headers.get("content-type") or "text/event-stream"

        async def _stream_and_meter() -> AsyncIterator[bytes]:
            chunks_text: list[str] = []
            try:
                async for chunk in upstream_resp.aiter_bytes():
                    if chunk:
                        if len(chunks_text) < 2000:
                            chunks_text.append(chunk.decode("utf-8", errors="ignore"))
                        yield chunk
            finally:
                await upstream_resp.aclose()
                await client.aclose()
                elapsed_ms = int((time.perf_counter() - started) * 1000)
                inp, out, cr, tot = extract_usage_from_sse_text("".join(chunks_text), protocol)
                with SessionLocal() as ledger_db:
                    sbx_obj = ledger_db.get(Sandbox, sandbox_id)
                    prof_obj = ledger_db.get(LlmProfile, target_profile_id)
                    if sbx_obj and prof_obj:
                        record_llm_usage(
                            ledger_db,
                            sandbox=sbx_obj,
                            profile=prof_obj,
                            model=requested_model,
                            input_tokens=inp,
                            output_tokens=out,
                            cache_read_tokens=cr,
                            total_tokens=tot,
                            routed_mode=decision,
                            status_code=status_code,
                            latency_ms=elapsed_ms,
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
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
            upstream_resp = await client.request(
                request.method,
                upstream_url,
                params=forward_params,
                headers=forward_headers,
                content=raw_body,
            )
    except Exception as exc:
        return JSONResponse(
            status_code=502,
            content={"error": {"message": f"Upstream LLM unreachable: {exc}", "type": "gateway_error"}},
        )

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    inp = out = cr = tot = 0
    try:
        parsed_resp = upstream_resp.json()
        if isinstance(parsed_resp, dict):
            inp, out, cr, tot = extract_usage_from_payload(parsed_resp, protocol)
    except Exception:
        pass

    record_llm_usage(
        db,
        sandbox=sandbox,
        profile=target_profile,
        model=requested_model,
        input_tokens=inp,
        output_tokens=out,
        cache_read_tokens=cr,
        total_tokens=tot,
        routed_mode=decision,
        status_code=upstream_resp.status_code,
        latency_ms=elapsed_ms,
    )
    resp_headers = {}
    if upstream_resp.headers.get("content-type"):
        resp_headers["content-type"] = upstream_resp.headers["content-type"]
    return Response(
        content=upstream_resp.content,
        status_code=upstream_resp.status_code,
        headers=resp_headers,
    )


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
        return build_finops_summary(db, sandboxes, days=days, team_id=team_id)

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
