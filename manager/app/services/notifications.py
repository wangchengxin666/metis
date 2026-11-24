"""Declarative multi-channel outbound notification engine with pluggable connectors."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import smtplib
import time
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Any, Callable
from urllib.parse import quote, urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import NotificationChannel, NotificationDelivery
from ..schemas import (
    NotificationChannelCreate,
    NotificationChannelOut,
    NotificationChannelUpdate,
)
from ..security import decrypt_secret, encrypt_secret
from .common import Conflict, NotFoundError, audit, utcnow
from .integrations import sign_approval_token

logger = logging.getLogger("dsh-manager.notifications")

DEFAULT_NOTIFICATION_EVENTS = [
    "approval.pending",
    "task.blocked",
    "task.done",
    "sandbox.unhealthy",
]

EVENT_LABELS: dict[str, tuple[str, str]] = {
    "approval.pending": ("人工审批请求", "Pending Approval"),
    "task.blocked": ("任务阻塞告警", "Task Blocked"),
    "task.done": ("任务已完成", "Task Completed"),
    "sandbox.unhealthy": ("数字员工异常离线", "Employee Unhealthy"),
    "budget.warning": ("预算预警", "Budget Warning"),
    "budget.exceeded": ("预算超限触发", "Budget Exceeded"),
    "notification.test": ("通知通道连通性测试", "Notification Channel Test"),
}


@dataclass(slots=True)
class NotificationEvent:
    event_type: str
    title: str
    summary: str = ""
    severity: str = "info"  # info | warning | danger | success
    sandbox_id: str | None = None
    sandbox_slug: str | None = None
    role_title: str | None = None
    project_team_name: str | None = None
    task_id: str | None = None
    action_url: str | None = None
    dedupe_key: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class DeliveryResult:
    ok: bool
    status_code: int | None = None
    detail: str = ""


def mask_url_hint(url: str | None) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    parsed = urlsplit(raw)
    host = parsed.netloc
    path = parsed.path or ""
    if len(path) > 12:
        masked_path = f"{path[:6]}...****{path[-4:]}"
    elif len(path) > 4:
        masked_path = f"...****{path[-4:]}"
    else:
        masked_path = path
    return f"{parsed.scheme}://{host}{masked_path}"


def _build_target_hint(channel_type: str, cfg: dict[str, Any]) -> str:
    if channel_type == "email":
        host = str(cfg.get("smtp_host") or "")
        to_list = cfg.get("smtp_to") or []
        preview = ", ".join(str(x) for x in to_list[:2])
        if len(to_list) > 2:
            preview += f" (+{len(to_list) - 2})"
        return f"smtp://{host} -> {preview}" if preview else f"smtp://{host}"
    return mask_url_hint(str(cfg.get("webhook_url") or ""))


def _decrypt_config(channel: NotificationChannel) -> dict[str, Any]:
    if not channel.config_ciphertext:
        return {}
    try:
        raw = decrypt_secret(channel.config_ciphertext)
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}


def channel_to_out(channel: NotificationChannel) -> NotificationChannelOut:
    cfg = _decrypt_config(channel)
    has_secret = bool(cfg.get("signing_secret") or cfg.get("smtp_password"))
    return NotificationChannelOut(
        id=channel.id,
        name=channel.name,
        channel_type=channel.channel_type,
        enabled=bool(channel.enabled),
        target_hint=channel.target_hint or _build_target_hint(channel.channel_type, cfg),
        has_secret=has_secret,
        events=channel.events,
        scope_sandbox_ids=channel.scope_sandbox_ids,
        smtp_host=str(cfg.get("smtp_host")) if cfg.get("smtp_host") else None,
        smtp_port=int(cfg["smtp_port"]) if cfg.get("smtp_port") else None,
        smtp_from=str(cfg.get("smtp_from")) if cfg.get("smtp_from") else None,
        smtp_to=[str(x) for x in (cfg.get("smtp_to") or [])],
        smtp_use_tls=bool(cfg.get("smtp_use_tls", True)),
        created_at=channel.created_at,
        updated_at=channel.updated_at,
    )


def _feishu_sign(timestamp: str, secret: str) -> str:
    string_to_sign = f"{timestamp}\n{secret}".encode("utf-8")
    digest = hmac.new(string_to_sign, b"", digestmod=hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def _send_feishu(cfg: dict[str, Any], event: NotificationEvent, brand_name: str) -> DeliveryResult:
    url = str(cfg.get("webhook_url") or "").strip()
    if not url:
        return DeliveryResult(ok=False, detail="missing feishu webhook_url")

    template_color = {
        "warning": "orange",
        "danger": "red",
        "success": "green",
    }.get(event.severity, "blue")

    ev_zh, _ = EVENT_LABELS.get(event.event_type, (event.event_type, event.event_type))
    lines = []
    if event.sandbox_slug:
        role_suffix = f" ({event.role_title})" if event.role_title else ""
        lines.append(f"**数字员工**: `@{event.sandbox_slug}`{role_suffix}")
    if event.project_team_name:
        lines.append(f"**项目组**: {event.project_team_name}")
    if event.summary:
        lines.append(f"\n{event.summary}")

    elements: list[dict[str, Any]] = [
        {"tag": "markdown", "content": "\n".join(lines) or event.title}
    ]
    feishu_actions: list[dict[str, Any]] = []
    approve_url = str(event.metadata.get("approve_url") or "")
    reject_url = str(event.metadata.get("reject_url") or "")
    approval_token = str(event.metadata.get("approval_token") or "")
    if approve_url and reject_url:
        approve_btn: dict[str, Any] = {
            "tag": "button",
            "text": {"tag": "plain_text", "content": "✅ 一键批准"},
            "type": "primary",
            "url": approve_url,
        }
        reject_btn: dict[str, Any] = {
            "tag": "button",
            "text": {"tag": "plain_text", "content": "❌ 驳回"},
            "type": "danger",
            "url": reject_url,
        }
        if approval_token:
            approve_btn["value"] = {"token": approval_token, "decision": "approved"}
            reject_btn["value"] = {"token": approval_token, "decision": "rejected"}
        feishu_actions.extend([approve_btn, reject_btn])
    if event.action_url:
        feishu_actions.append(
            {
                "tag": "button",
                "text": {"tag": "plain_text", "content": "前往 Metis 处理"},
                "type": "default" if feishu_actions else "primary",
                "url": event.action_url,
            }
        )
    if feishu_actions:
        elements.append({"tag": "action", "actions": feishu_actions})

    body: dict[str, Any] = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": template_color,
                "title": {
                    "tag": "plain_text",
                    "content": f"[{brand_name}] {ev_zh}: {event.title}",
                },
            },
            "elements": elements,
        },
    }
    secret = str(cfg.get("signing_secret") or "").strip()
    if secret:
        ts = str(int(time.time()))
        body["timestamp"] = ts
        body["sign"] = _feishu_sign(ts, secret)

    with httpx.Client(timeout=5.0) as client:
        resp = client.post(url, json=body)
    ok = 200 <= resp.status_code < 300
    detail = resp.text[:300]
    if ok:
        try:
            data = resp.json()
            if isinstance(data, dict) and data.get("code") not in (None, 0):
                ok = False
                detail = str(data.get("msg") or data)[:300]
        except Exception:
            pass
    return DeliveryResult(ok=ok, status_code=resp.status_code, detail=detail)


def _send_wecom(cfg: dict[str, Any], event: NotificationEvent, brand_name: str) -> DeliveryResult:
    url = str(cfg.get("webhook_url") or "").strip()
    if not url:
        return DeliveryResult(ok=False, detail="missing wecom webhook_url")

    ev_zh, _ = EVENT_LABELS.get(event.event_type, (event.event_type, event.event_type))
    color_tag = {
        "warning": "warning",
        "danger": "warning",
        "success": "info",
    }.get(event.severity, "comment")

    md_lines = [
        f"### [{brand_name}] <font color=\"{color_tag}\">{ev_zh}</font>",
        f"> **事项**：{event.title}",
    ]
    if event.sandbox_slug:
        role_suffix = f" · {event.role_title}" if event.role_title else ""
        md_lines.append(f"> **数字员工**：`@{event.sandbox_slug}`{role_suffix}")
    if event.project_team_name:
        md_lines.append(f"> **项目组**：{event.project_team_name}")
    if event.summary:
        md_lines.append(f"\n{event.summary}")
    approve_url = str(event.metadata.get("approve_url") or "")
    reject_url = str(event.metadata.get("reject_url") or "")
    if approve_url and reject_url:
        md_lines.append(f"\n[✅ 一键批准]({approve_url})  |  [❌ 一键驳回]({reject_url})")
    if event.action_url:
        md_lines.append(f"\n[点击前往 Metis 处理]({event.action_url})")

    payload = {"msgtype": "markdown", "markdown": {"content": "\n".join(md_lines)}}
    with httpx.Client(timeout=5.0) as client:
        resp = client.post(url, json=payload)
    ok = 200 <= resp.status_code < 300
    detail = resp.text[:300]
    if ok:
        try:
            data = resp.json()
            if isinstance(data, dict) and data.get("errcode") not in (None, 0):
                ok = False
                detail = str(data.get("errmsg") or data)[:300]
        except Exception:
            pass
    return DeliveryResult(ok=ok, status_code=resp.status_code, detail=detail)


def _send_slack(cfg: dict[str, Any], event: NotificationEvent, brand_name: str) -> DeliveryResult:
    url = str(cfg.get("webhook_url") or "").strip()
    if not url:
        return DeliveryResult(ok=False, detail="missing slack webhook_url")

    _, ev_en = EVENT_LABELS.get(event.event_type, (event.event_type, event.event_type))
    header_text = f"[{brand_name}] {ev_en}: {event.title}"[:150]
    fields: list[dict[str, str]] = []
    if event.sandbox_slug:
        fields.append({"type": "mrkdwn", "text": f"*Employee:*\n`@{event.sandbox_slug}`"})
    if event.role_title:
        fields.append({"type": "mrkdwn", "text": f"*Role:*\n{event.role_title}"})
    if event.project_team_name:
        fields.append({"type": "mrkdwn", "text": f"*Team:*\n{event.project_team_name}"})

    blocks: list[dict[str, Any]] = [
        {"type": "header", "text": {"type": "plain_text", "text": header_text}},
    ]
    if fields:
        blocks.append({"type": "section", "fields": fields})
    if event.summary:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": event.summary[:2500]}})
    slack_elements: list[dict[str, Any]] = []
    approve_url = str(event.metadata.get("approve_url") or "")
    reject_url = str(event.metadata.get("reject_url") or "")
    if approve_url and reject_url:
        slack_elements.extend(
            [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Approve"},
                    "style": "primary",
                    "url": approve_url,
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Reject"},
                    "style": "danger",
                    "url": reject_url,
                },
            ]
        )
    if event.action_url:
        btn: dict[str, Any] = {
            "type": "button",
            "text": {"type": "plain_text", "text": "Open in Metis"},
            "url": event.action_url,
        }
        if not slack_elements:
            btn["style"] = "primary"
        slack_elements.append(btn)
    if slack_elements:
        blocks.append({"type": "actions", "elements": slack_elements})

    payload = {"text": header_text, "blocks": blocks}
    with httpx.Client(timeout=5.0) as client:
        resp = client.post(url, json=payload)
    return DeliveryResult(
        ok=200 <= resp.status_code < 300,
        status_code=resp.status_code,
        detail=resp.text[:300],
    )


def _send_webhook(cfg: dict[str, Any], event: NotificationEvent, brand_name: str) -> DeliveryResult:
    url = str(cfg.get("webhook_url") or "").strip()
    if not url:
        return DeliveryResult(ok=False, detail="missing webhook_url")

    payload = {
        "brand": brand_name,
        "event": event.event_type,
        "severity": event.severity,
        "title": event.title,
        "summary": event.summary,
        "sandbox_id": event.sandbox_id,
        "sandbox_slug": event.sandbox_slug,
        "role_title": event.role_title,
        "project_team_name": event.project_team_name,
        "task_id": event.task_id,
        "action_url": event.action_url,
        "metadata": event.metadata,
        "timestamp": utcnow().isoformat() + "Z",
    }
    raw_bytes = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-Metis-Event": event.event_type,
    }
    secret = str(cfg.get("signing_secret") or "").strip()
    if secret:
        sig = hmac.new(secret.encode("utf-8"), raw_bytes, hashlib.sha256).hexdigest()
        headers["X-Metis-Signature"] = f"sha256={sig}"

    with httpx.Client(timeout=5.0) as client:
        resp = client.post(url, content=raw_bytes, headers=headers)
    return DeliveryResult(
        ok=200 <= resp.status_code < 300,
        status_code=resp.status_code,
        detail=resp.text[:300],
    )


def _send_email(cfg: dict[str, Any], event: NotificationEvent, brand_name: str) -> DeliveryResult:
    host = str(cfg.get("smtp_host") or "").strip()
    port = int(cfg.get("smtp_port") or 587)
    username = str(cfg.get("smtp_username") or "").strip()
    password = str(cfg.get("smtp_password") or "")
    sender = str(cfg.get("smtp_from") or username or "noreply@metis.local").strip()
    recipients = [str(r).strip() for r in (cfg.get("smtp_to") or []) if str(r).strip()]
    use_tls = bool(cfg.get("smtp_use_tls", True))
    if not host or not recipients:
        return DeliveryResult(ok=False, detail="incomplete SMTP configuration")

    ev_zh, _ = EVENT_LABELS.get(event.event_type, (event.event_type, event.event_type))
    msg = EmailMessage()
    msg["Subject"] = f"[{brand_name}] {ev_zh}: {event.title}"
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)

    approve_url = str(event.metadata.get("approve_url") or "")
    reject_url = str(event.metadata.get("reject_url") or "")
    plain_lines = [
        f"{ev_zh}: {event.title}",
        f"Digital Employee: @{event.sandbox_slug}" if event.sandbox_slug else "",
        f"Role: {event.role_title}" if event.role_title else "",
        f"Team: {event.project_team_name}" if event.project_team_name else "",
        "",
        event.summary or "",
        "",
        f"Approve: {approve_url}" if approve_url else "",
        f"Reject: {reject_url}" if reject_url else "",
        f"Open in Metis: {event.action_url}" if event.action_url else "",
    ]
    msg.set_content("\n".join(line for line in plain_lines if line is not None))

    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=5.0) as server:
            if username:
                server.login(username, password)
            server.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=5.0) as server:
            if use_tls:
                server.starttls()
            if username:
                server.login(username, password)
            server.send_message(msg)
    return DeliveryResult(ok=True, status_code=250, detail=f"sent to {len(recipients)} recipients")


ConnectorFn = Callable[[dict[str, Any], NotificationEvent, str], DeliveryResult]

CONNECTOR_REGISTRY: dict[str, ConnectorFn] = {
    "feishu": _send_feishu,
    "wecom": _send_wecom,
    "slack": _send_slack,
    "email": _send_email,
    "webhook": _send_webhook,
}


def list_notification_channels(db: Session) -> list[NotificationChannel]:
    return list(
        db.scalars(
            select(NotificationChannel).order_by(NotificationChannel.created_at.desc())
        ).all()
    )


def create_notification_channel(
    db: Session,
    payload: NotificationChannelCreate,
    *,
    actor: str | None = None,
) -> NotificationChannel:
    clean_name = payload.name.strip()
    if db.scalar(select(NotificationChannel).where(NotificationChannel.name == clean_name)):
        raise Conflict(f"通知通道 '{clean_name}' 已存在")

    cfg: dict[str, Any] = {}
    if payload.channel_type == "email":
        cfg = {
            "smtp_host": (payload.smtp_host or "").strip(),
            "smtp_port": payload.smtp_port or 587,
            "smtp_username": (payload.smtp_username or "").strip(),
            "smtp_password": (payload.smtp_password or "").strip(),
            "smtp_from": (payload.smtp_from or "").strip(),
            "smtp_to": [x.strip() for x in payload.smtp_to if x.strip()],
            "smtp_use_tls": bool(payload.smtp_use_tls),
        }
    else:
        cfg = {
            "webhook_url": (payload.webhook_url or "").strip(),
            "signing_secret": (payload.signing_secret or "").strip(),
        }

    events = list(dict.fromkeys(payload.events or DEFAULT_NOTIFICATION_EVENTS))
    scope_ids = list(dict.fromkeys(x.strip() for x in payload.scope_sandbox_ids if x.strip()))

    channel = NotificationChannel(
        name=clean_name,
        channel_type=payload.channel_type,
        enabled=payload.enabled,
        config_ciphertext=encrypt_secret(json.dumps(cfg, ensure_ascii=False)),
        target_hint=_build_target_hint(payload.channel_type, cfg),
        events_json=json.dumps(events),
        scope_sandbox_ids_json=json.dumps(scope_ids),
    )
    db.add(channel)
    audit(
        db,
        "notification.channel_create",
        target=clean_name,
        detail=f"type={payload.channel_type},events={','.join(events)}",
        actor=actor,
    )
    db.commit()
    db.refresh(channel)
    return channel


def update_notification_channel(
    db: Session,
    channel: NotificationChannel,
    payload: NotificationChannelUpdate,
    *,
    actor: str | None = None,
) -> NotificationChannel:
    cfg = _decrypt_config(channel)
    if payload.name is not None:
        clean_name = payload.name.strip()
        existing = db.scalar(
            select(NotificationChannel).where(
                NotificationChannel.name == clean_name,
                NotificationChannel.id != channel.id,
            )
        )
        if existing:
            raise Conflict(f"通知通道 '{clean_name}' 已存在")
        channel.name = clean_name
    if payload.enabled is not None:
        channel.enabled = payload.enabled

    if channel.channel_type == "email":
        if payload.smtp_host is not None:
            cfg["smtp_host"] = payload.smtp_host.strip()
        if payload.smtp_port is not None:
            cfg["smtp_port"] = payload.smtp_port
        if payload.smtp_username is not None:
            cfg["smtp_username"] = payload.smtp_username.strip()
        if payload.smtp_password is not None and payload.smtp_password.strip():
            cfg["smtp_password"] = payload.smtp_password.strip()
        if payload.smtp_from is not None:
            cfg["smtp_from"] = payload.smtp_from.strip()
        if payload.smtp_to is not None:
            cfg["smtp_to"] = [x.strip() for x in payload.smtp_to if x.strip()]
        if payload.smtp_use_tls is not None:
            cfg["smtp_use_tls"] = payload.smtp_use_tls
    else:
        if payload.webhook_url is not None:
            cfg["webhook_url"] = payload.webhook_url.strip()
        if payload.clear_signing_secret:
            cfg["signing_secret"] = ""
        elif payload.signing_secret is not None and payload.signing_secret.strip():
            cfg["signing_secret"] = payload.signing_secret.strip()

    channel.config_ciphertext = encrypt_secret(json.dumps(cfg, ensure_ascii=False))
    channel.target_hint = _build_target_hint(channel.channel_type, cfg)

    if payload.events is not None:
        channel.events_json = json.dumps(list(dict.fromkeys(payload.events)))
    if payload.scope_sandbox_ids is not None:
        scope_ids = list(
            dict.fromkeys(x.strip() for x in payload.scope_sandbox_ids if x.strip())
        )
        channel.scope_sandbox_ids_json = json.dumps(scope_ids)

    audit(
        db,
        "notification.channel_update",
        target=channel.name,
        detail=f"type={channel.channel_type},enabled={channel.enabled}",
        actor=actor,
    )
    db.commit()
    db.refresh(channel)
    return channel


def delete_notification_channel(
    db: Session,
    channel: NotificationChannel,
    *,
    actor: str | None = None,
) -> None:
    name = channel.name
    audit(db, "notification.channel_delete", target=name, actor=actor)
    db.delete(channel)
    db.commit()


def list_notification_deliveries(
    db: Session,
    *,
    channel_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[NotificationDelivery]:
    stmt = select(NotificationDelivery)
    if channel_id:
        stmt = stmt.where(NotificationDelivery.channel_id == channel_id)
    if status:
        stmt = stmt.where(NotificationDelivery.status == status)
    stmt = stmt.order_by(NotificationDelivery.created_at.desc()).limit(max(1, min(limit, 200)))
    return list(db.scalars(stmt).all())


def _deliver_to_channel(
    db: Session,
    channel: NotificationChannel,
    event: NotificationEvent,
    *,
    brand_name: str,
    skip_dedupe: bool = False,
) -> DeliveryResult:
    if not skip_dedupe and event.dedupe_key:
        already = db.scalar(
            select(NotificationDelivery.id).where(
                NotificationDelivery.channel_id == channel.id,
                NotificationDelivery.dedupe_key == event.dedupe_key,
                NotificationDelivery.status == "sent",
            )
        )
        if already:
            return DeliveryResult(ok=True, detail="deduplicated")

    connector = CONNECTOR_REGISTRY.get(channel.channel_type)
    if connector is None:
        res = DeliveryResult(ok=False, detail=f"unsupported channel type: {channel.channel_type}")
    else:
        cfg = _decrypt_config(channel)
        try:
            res = connector(cfg, event, brand_name)
        except Exception as exc:
            logger.warning("notification delivery failed (%s): %s", channel.name, exc)
            res = DeliveryResult(ok=False, detail=str(exc)[:300])

    delivery = NotificationDelivery(
        channel_id=channel.id,
        channel_name=channel.name,
        channel_type=channel.channel_type,
        event_type=event.event_type,
        dedupe_key=event.dedupe_key,
        sandbox_slug=event.sandbox_slug,
        title=event.title[:255],
        status="sent" if res.ok else "failed",
        response_code=res.status_code,
        error_detail=None if res.ok else (res.detail or "delivery failed")[:1000],
    )
    db.add(delivery)
    return res


def dispatch_notification_event(
    db: Session,
    settings: Settings,
    event: NotificationEvent,
    *,
    brand_name: str = "Metis",
) -> dict[str, int]:
    """Send an event to all enabled subscribed channels with per-channel idempotent deduplication."""
    base = settings.manager_base_url.rstrip("/")
    if not event.action_url:
        if event.task_id:
            event.action_url = f"{base}/inbox?task={event.task_id}"
        else:
            event.action_url = f"{base}/inbox"

    if (
        event.event_type == "approval.pending"
        and event.sandbox_id
        and event.task_id
        and not event.metadata.get("approve_url")
    ):
        try:
            approval_token = sign_approval_token(
                settings.secret_key,
                sandbox_id=event.sandbox_id,
                task_id=event.task_id,
                room_id=str(event.metadata.get("room_id") or ""),
            )
            encoded_tok = quote(approval_token, safe="")
            event.metadata["approval_token"] = approval_token
            event.metadata["approve_url"] = (
                f"{base}/api/integrations/approvals/action?token={encoded_tok}&decision=approved"
            )
            event.metadata["reject_url"] = (
                f"{base}/api/integrations/approvals/action?token={encoded_tok}&decision=rejected"
            )
        except Exception:
            pass

    channels = list(
        db.scalars(
            select(NotificationChannel).where(NotificationChannel.enabled.is_(True))
        ).all()
    )
    sent = 0
    failed = 0
    skipped = 0
    for ch in channels:
        subscribed = ch.events
        if subscribed and event.event_type not in subscribed:
            skipped += 1
            continue
        scope_ids = ch.scope_sandbox_ids
        if scope_ids and event.sandbox_id and event.sandbox_id not in scope_ids:
            skipped += 1
            continue
        res = _deliver_to_channel(db, ch, event, brand_name=brand_name)
        if res.detail == "deduplicated":
            skipped += 1
        elif res.ok:
            sent += 1
        else:
            failed += 1
    if sent or failed:
        try:
            db.commit()
        except Exception:
            db.rollback()
    return {"sent": sent, "failed": failed, "skipped": skipped}


def test_notification_channel(
    db: Session,
    settings: Settings,
    channel: NotificationChannel,
    *,
    brand_name: str = "Metis",
    actor: str | None = None,
) -> DeliveryResult:
    event = NotificationEvent(
        event_type="notification.test",
        title="通道连通性验证成功",
        summary=f"这是一条来自 {brand_name} 控制平面的测试通知，用于验证通道「{channel.name}」的推送配置。",
        severity="info",
        action_url=f"{settings.manager_base_url.rstrip('/')}/inbox",
    )
    res = _deliver_to_channel(db, channel, event, brand_name=brand_name, skip_dedupe=True)
    audit(
        db,
        "notification.channel_test",
        target=channel.name,
        detail=f"type={channel.channel_type},ok={res.ok},code={res.status_code}",
        actor=actor,
    )
    db.commit()
    return res
