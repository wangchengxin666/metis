"""Interactive IM approval action pages & Feishu card callback endpoints."""

from __future__ import annotations

import html as html_lib

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import (
    _ensure_sandbox_awake,
    _manager_error,
    resolve_docker,
    session_email,
    settings,
)
from ..services import audit, load_sandbox
from ..services.integrations import verify_approval_token
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
