"""Admin CRUD, connectivity test, and delivery logs for outbound notification channels."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import _manager_error, require_admin_api, session_email, settings
from ..models import NotificationChannel
from ..schemas import (
    NotificationChannelCreate,
    NotificationChannelOut,
    NotificationChannelUpdate,
    NotificationDeliveryOut,
    NotificationTestOut,
)
from ..services import get_branding_config
from ..services.notifications import (
    channel_to_out,
    create_notification_channel,
    delete_notification_channel,
    list_notification_channels,
    list_notification_deliveries,
    test_notification_channel,
    update_notification_channel,
)

router = APIRouter()


@router.get("/api/notification-channels", response_model=list[NotificationChannelOut])
def api_list_notification_channels(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return [channel_to_out(c) for c in list_notification_channels(db)]


@router.post(
    "/api/notification-channels",
    response_model=NotificationChannelOut,
    status_code=201,
)
def api_create_notification_channel(
    payload: NotificationChannelCreate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        channel = create_notification_channel(
            db,
            payload,
            actor=session_email(request) or settings.manager_admin_email,
        )
        return channel_to_out(channel)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.patch(
    "/api/notification-channels/{channel_id}",
    response_model=NotificationChannelOut,
)
def api_update_notification_channel(
    channel_id: str,
    payload: NotificationChannelUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    channel = db.get(NotificationChannel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="通知通道不存在")
    try:
        updated = update_notification_channel(
            db,
            channel,
            payload,
            actor=session_email(request) or settings.manager_admin_email,
        )
        return channel_to_out(updated)
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/notification-channels/{channel_id}")
def api_delete_notification_channel(
    channel_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    channel = db.get(NotificationChannel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="通知通道不存在")
    delete_notification_channel(
        db,
        channel,
        actor=session_email(request) or settings.manager_admin_email,
    )
    return {"ok": True}


@router.post(
    "/api/notification-channels/{channel_id}/test",
    response_model=NotificationTestOut,
)
def api_test_notification_channel(
    channel_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    channel = db.get(NotificationChannel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="通知通道不存在")
    brand = get_branding_config(db)
    brand_name = str(brand.get("brand_name_zh") or brand.get("brand_name_en") or "Metis")
    res = test_notification_channel(
        db,
        settings,
        channel,
        brand_name=brand_name,
        actor=session_email(request) or settings.manager_admin_email,
    )
    return NotificationTestOut(
        ok=res.ok,
        channel_id=channel.id,
        channel_name=channel.name,
        status_code=res.status_code,
        detail=res.detail,
    )


@router.get("/api/notification-deliveries", response_model=list[NotificationDeliveryOut])
def api_list_notification_deliveries(
    channel_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return list_notification_deliveries(
        db,
        channel_id=channel_id,
        status=status,
        limit=limit,
    )
