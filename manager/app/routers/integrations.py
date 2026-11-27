"""Interactive IM approval action pages & bidirectional Feishu/Slack/WeCom Bot callback endpoints."""

from __future__ import annotations

import hashlib
import hmac
import html as html_lib
import json
import re
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import (
    _ensure_sandbox_awake,
    _manager_error,
    resolve_docker,
    session_email,
    settings,
)
from ..models import NotificationChannel, Playbook, Sandbox
from ..security import decrypt_secret
from ..services import audit, load_sandbox
from ..services.integrations import verify_approval_token
from ..services.playbooks import serialize_playbook_run, start_playbook_run
from ..services.workspace_hub import refresh_sandbox_snapshot

router = APIRouter()


def _execute_signed_approval(
    db: Session,
    *,
    token: str,
    decision: str,
    note: str = "",
    actor: str = "im-card",
) -> dict:
    if decision not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="审批结果仅支持 approved 或 rejected")
    try:
        claims = verify_approval_token(settings.secret_key, token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    sandbox = load_sandbox(db, claims["sandbox_id"])
    docker = resolve_docker()
    if docker.status(sandbox) != "running":
        _ensure_sandbox_awake(db, sandbox)

    res = docker.decide_mesh_approval(
        sandbox,
        claims["task_id"],
        decision=decision,
        note=note.strip(),
        room_id=claims["room_id"] or None,
        actor=actor,
    )
    audit(
        db,
        f"sandbox.approval_{decision}",
        target=sandbox.id,
        actor=actor,
        detail=f"slug={sandbox.slug},task_id={claims['task_id']},via=im_callback",
    )
    db.commit()
    try:
        refresh_sandbox_snapshot(db, docker, sandbox, settings=settings, emit_notifications=False)
    except Exception:
        pass
    return {"ok": True, "slug": sandbox.slug, "task_id": claims["task_id"], "decision": decision, **res}


@router.get("/api/integrations/approvals/action", include_in_schema=False)
def approval_action_confirm_page(
    token: str = Query(..., min_length=10),
    decision: str = Query(default="approved"),
):
    """Render a safe POST confirmation card for IM/Email approval links (immune to link prefetchers)."""
    clean_decision = "rejected" if decision == "rejected" else "approved"
    try:
        claims = verify_approval_token(settings.secret_key, token)
    except ValueError as exc:
        err = html_lib.escape(str(exc))
        return HTMLResponse(
            content=f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>审批链接失效 - Metis</title>
<style>body{{margin:0;background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}}
.card{{max-width:440px;padding:28px;border-radius:14px;background:#18181b;border:1px solid #3f3f46}}</style></head>
<body><div class="card"><h2>审批链接无效或已过期</h2><p style="color:#a1a1aa;font-size:14px">{err}</p>
<a href="/inbox" style="color:#818cf8;font-size:13px">前往 Metis 全局收件箱</a></div></body></html>""",
            status_code=400,
        )

    esc_token = html_lib.escape(token, quote=True)
    esc_tid = html_lib.escape(claims["task_id"])
    btn_color = "#10b981" if clean_decision == "approved" else "#e11d48"
    btn_label = "确认批准通过" if clean_decision == "approved" else "确认驳回任务"
    return HTMLResponse(
        content=f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Metis 快捷审批确认</title>
<style>body{{margin:0;background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}}
.card{{max-width:460px;width:92%;padding:28px;border-radius:14px;background:#18181b;border:1px solid #27272a;box-shadow:0 20px 40px rgba(0,0,0,.5)}}
input,textarea{{width:100%;box-sizing:border-box;background:#09090b;color:#f4f4f5;border:1px solid #3f3f46;border-radius:8px;padding:10px;font-size:13px;margin:10px 0 16px}}
button{{width:100%;background:{btn_color};color:#fff;border:0;border-radius:8px;padding:11px;font-size:14px;font-weight:600;cursor:pointer}}</style></head>
<body><div class="card"><h2 style="margin:0 0 8px;font-size:18px">Metis 快捷人工审批</h2>
<p style="margin:0 0 14px;font-size:13px;color:#a1a1aa">任务编号：<code>#{esc_tid}</code></p>
<form method="post" action="/api/integrations/approvals/action">
<input type="hidden" name="token" value="{esc_token}" />
<input type="hidden" name="decision" value="{clean_decision}" />
<textarea name="note" rows="3" placeholder="可选：填写审批意见或驳回原因"></textarea>
<button type="submit">{btn_label}</button>
</form></div></body></html>"""
    )


@router.post("/api/integrations/approvals/action")
def execute_approval_action(
    request: Request,
    token: str = Form(...),
    decision: str = Form(...),
    note: str = Form(""),
    db: Session = Depends(get_db),
):
    actor = session_email(request) or "im-card-link"
    try:
        res = _execute_signed_approval(
            db, token=token, decision=decision, note=note, actor=actor
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _manager_error(exc) from exc

    accept = (request.headers.get("accept") or "").lower()
    if "text/html" in accept:
        label = "已批准通过" if decision == "approved" else "已驳回"
        return HTMLResponse(
            content=f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>审批完成 - Metis</title>
<style>body{{margin:0;background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}}
.card{{max-width:440px;padding:28px;border-radius:14px;background:#18181b;border:1px solid #27272a;text-align:center}}</style></head>
<body><div class="card"><h2 style="margin:0 0 10px;color:#34d399">审批已生效：{label}</h2>
<p style="font-size:13px;color:#a1a1aa">数字员工 <code>@{html_lib.escape(str(res['slug']))}</code> 将自动继续执行。</p>
<a href="/inbox" style="display:inline-block;margin-top:12px;color:#818cf8;font-size:13px">返回 Metis 收件箱</a></div></body></html>"""
        )
    return res


@router.post("/api/integrations/feishu/card-callback")
async def feishu_card_callback(
    request: Request,
    db: Session = Depends(get_db),
):
    """Feishu interactive card callback supporting URL verification challenge & direct Approve/Reject actions."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json payload")

    if isinstance(payload, dict) and payload.get("challenge"):
        return JSONResponse({"challenge": payload["challenge"]})

    action = payload.get("action") if isinstance(payload, dict) else {}
    val = action.get("value") if isinstance(action, dict) else {}
    if not isinstance(val, dict) or not val.get("token") or not val.get("decision"):
        raise HTTPException(status_code=400, detail="missing action token or decision")

    open_id = str(payload.get("open_id") or payload.get("operator", {}).get("open_id") or "feishu-user")
    res = _execute_signed_approval(
        db,
        token=str(val["token"]),
        decision=str(val["decision"]),
        note=str(val.get("note") or ""),
        actor=f"feishu:{open_id}",
    )
    status_text = "✅ 已通过飞书卡片批准" if res["decision"] == "approved" else "❌ 已通过飞书卡片驳回"
    return JSONResponse(
        {
            "toast": {"type": "success", "content": status_text},
            "card": {
                "header": {
                    "template": "green" if res["decision"] == "approved" else "red",
                    "title": {"tag": "plain_text", "content": f"Metis 审批完成 · @{res['slug']}"},
                },
                "elements": [
                    {
                        "tag": "markdown",
                        "content": f"{status_text}\n任务 `#{res['task_id']}` 已同步至数字员工。",
                    }
                ],
            },
        }
    )


def _extract_im_text_and_actor(channel_type: str, payload: dict) -> tuple[str, str]:
    ctype = channel_type.lower()
    if ctype == "feishu":
        event = payload.get("event") if isinstance(payload.get("event"), dict) else {}
        msg = event.get("message") if isinstance(event.get("message"), dict) else {}
        sender = event.get("sender") if isinstance(event.get("sender"), dict) else {}
        sender_id = (sender.get("sender_id") or {}).get("open_id") or "feishu-user"
        raw_content = str(msg.get("content") or payload.get("text") or "")
        if raw_content.strip().startswith("{"):
            try:
                raw_content = str(json.loads(raw_content).get("text") or "")
            except Exception:
                pass
        return raw_content.strip(), f"feishu:{sender_id}"
    if ctype == "slack":
        event = payload.get("event") if isinstance(payload.get("event"), dict) else {}
        raw_text = str(event.get("text") or payload.get("text") or "").strip()
        user_id = str(event.get("user") or payload.get("user_id") or "slack-user")
        return raw_text, f"slack:{user_id}"
    # WeCom / generic IM bot
    raw_text = str(
        payload.get("text", {}).get("content")
        if isinstance(payload.get("text"), dict)
        else (payload.get("content") or payload.get("text") or "")
    ).strip()
    actor_id = str(payload.get("from_user") or payload.get("userid") or "wecom-user")
    return raw_text, f"{ctype}:{actor_id}"


def _verify_im_inbound_auth(
    db: Session,
    channel_type: str,
    request: Request,
    payload: dict,
    raw_body: bytes,
) -> None:
    """Verify optional IM Bot verification token or Slack signing secret when configured."""
    channels = list(
        db.scalars(
            select(NotificationChannel).where(
                NotificationChannel.channel_type == channel_type,
                NotificationChannel.enabled == True,  # noqa: E712
            )
        ).all()
    )
    secrets_configured: list[str] = []
    for ch in channels:
        if ch.config_ciphertext:
            try:
                cfg = json.loads(decrypt_secret(ch.config_ciphertext))
                sec = str(cfg.get("signing_secret") or cfg.get("bot_token") or "").strip()
                if sec:
                    secrets_configured.append(sec)
            except Exception:
                pass
    if not secrets_configured:
        return

    provided_tok = str(
        request.headers.get("x-metis-im-token")
        or payload.get("token")
        or (payload.get("header") or {}).get("token")
        or ""
    ).strip()
    slack_sig = (request.headers.get("x-slack-signature") or "").strip()
    slack_ts = (request.headers.get("x-slack-request-timestamp") or "").strip()

    for sec in secrets_configured:
        if provided_tok and hmac.compare_digest(provided_tok, sec):
            return
        if channel_type == "slack" and slack_sig and slack_ts:
            base = f"v0:{slack_ts}:".encode("utf-8") + raw_body
            exp = "v0=" + hmac.new(sec.encode("utf-8"), base, hashlib.sha256).hexdigest()
            if hmac.compare_digest(exp, slack_sig):
                return
    raise HTTPException(status_code=401, detail="IM Bot 签名或 Token 校验失败")


@router.post("/api/integrations/im/{channel_type}/events")
async def im_bidirectional_events(
    channel_type: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Unified bidirectional IM Bot endpoint (Feishu, Slack, WeCom) for approvals and '/run <playbook> <title>' dispatch."""
    ctype = channel_type.strip().lower()
    if ctype not in {"feishu", "slack", "wecom"}:
        raise HTTPException(status_code=400, detail="不支持的 IM 渠道类型")

    raw_body = await request.body()
    content_type = (request.headers.get("content-type") or "").lower()
    payload: dict = {}
    if "application/x-www-form-urlencoded" in content_type:
        form_map = parse_qs(raw_body.decode("utf-8", errors="replace"))
        if "payload" in form_map and form_map["payload"]:
            try:
                payload = json.loads(form_map["payload"][0])
            except Exception:
                payload = {}
        else:
            payload = {k: v[0] for k, v in form_map.items() if v}
    else:
        try:
            payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except Exception:
            raise HTTPException(status_code=400, detail="invalid json payload")

    if not isinstance(payload, dict):
        payload = {}

    # 1. URL verification challenges
    if payload.get("challenge"):
        return JSONResponse({"challenge": payload["challenge"]})

    _verify_im_inbound_auth(db, ctype, request, payload, raw_body)

    # 2. Interactive card approval callbacks (Feishu / Slack / WeCom button payloads)
    if ctype == "slack" and payload.get("type") == "block_actions":
        actions = payload.get("actions") or []
        first = actions[0] if isinstance(actions, list) and actions else {}
        raw_val = first.get("value") if isinstance(first, dict) else ""
        try:
            act_val = json.loads(raw_val) if isinstance(raw_val, str) and raw_val.startswith("{") else {}
        except Exception:
            act_val = {}
        if act_val.get("token") and act_val.get("decision"):
            user_name = str((payload.get("user") or {}).get("username") or "slack-user")
            res = _execute_signed_approval(
                db,
                token=str(act_val["token"]),
                decision=str(act_val["decision"]),
                note=str(act_val.get("note") or ""),
                actor=f"slack:{user_name}",
            )
            return JSONResponse({"ok": True, "text": f"Metis 审批完成：{res['decision']} (@{res['slug']})", **res})

    if isinstance(payload.get("action"), dict) and isinstance(payload["action"].get("value"), dict):
        val = payload["action"]["value"]
        if val.get("token") and val.get("decision"):
            actor_id = str(payload.get("open_id") or (payload.get("operator") or {}).get("open_id") or f"{ctype}-user")
            res = _execute_signed_approval(
                db,
                token=str(val["token"]),
                decision=str(val["decision"]),
                note=str(val.get("note") or ""),
                actor=f"{ctype}:{actor_id}",
            )
            return JSONResponse({"ok": True, **res})

    # 3. Conversational IM command: `/run <playbook_key> <title...>` or `approve:<token>` / `reject:<token>`
    text, actor = _extract_im_text_and_actor(ctype, payload)
    clean_text = re.sub(r"<@[^>]+>", "", text).strip()

    cmd_match = re.match(r"^(?:/)?(approve|reject)\s+(\S+)(?:\s+(.*))?$", clean_text, re.IGNORECASE)
    if cmd_match:
        decision = "approved" if cmd_match.group(1).lower() == "approve" else "rejected"
        tok = cmd_match.group(2)
        note = (cmd_match.group(3) or "").strip()
        res = _execute_signed_approval(db, token=tok, decision=decision, note=note, actor=actor)
        return JSONResponse({"ok": True, "reply": f"已{('批准' if decision == 'approved' else '驳回')} @{res['slug']} 任务 #{res['task_id']}", **res})

    run_match = re.match(r"^(?:/run|run:)\s*([a-z0-9-]+)(?:\s+(.+))?$", clean_text, re.IGNORECASE)
    if run_match:
        pb_key = run_match.group(1).lower()
        pb = db.scalar(select(Playbook).where(Playbook.key == pb_key, Playbook.enabled == True))  # noqa: E712
        if not pb:
            return JSONResponse({"ok": False, "reply": f"未找到已启用的 Playbook '{pb_key}'"}, status_code=404)
        req_title = (run_match.group(2) or f"[{ctype.upper()}] {pb.name}").strip()
        accessible = list(db.scalars(select(Sandbox).where(Sandbox.deleted_at.is_(None))).all())
        first_field_key = pb.input_fields[0]["key"] if pb.input_fields else "topic"
        inputs = {first_field_key: req_title, "feature_title": req_title}
        run = start_playbook_run(
            db,
            settings,
            resolve_docker(),
            pb,
            title=req_title,
            inputs=inputs,
            role_assignments={},
            accessible_sandboxes=accessible,
            actor=actor,
        )
        run_url = f"{settings.manager_base_url}/workforce?run={run.id}"
        return JSONResponse(
            {
                "ok": True,
                "reply": f"🚀 已通过 {ctype.upper()} 触发 Playbook「{pb.name}」：{req_title}\n查看进度：{run_url}",
                "run": serialize_playbook_run(db, run),
            },
            status_code=201,
        )

    return JSONResponse({"ok": True, "ignored": True, "received_text": clean_text[:200]})
