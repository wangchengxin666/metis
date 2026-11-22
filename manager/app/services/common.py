from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import AuditLog, PlatformAdmin, Sandbox, User
from ..security import hash_password


class ManagerError(RuntimeError):
    pass


class Conflict(ManagerError):
    pass


class NotFoundError(ManagerError):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _slug_base(email: str) -> str:
    local = email.split("@", 1)[0].lower()
    local = re.sub(r"[^a-z0-9]+", "-", local).strip("-")
    local = local[:48] or "user"
    if not local[0].isalnum():
        local = "u" + local
    return local


def unique_slug(db: Session, email: str, wanted: str | None) -> str:
    if wanted:
        if db.scalar(select(Sandbox).where(Sandbox.slug == wanted)):
            raise Conflict(f"slug already exists: {wanted}")
        return wanted

    base = _slug_base(email)
    candidate = base
    for index in range(1, 1000):
        exists = db.scalar(select(Sandbox).where(Sandbox.slug == candidate))
        if not exists:
            return candidate
        candidate = f"{base}-{index + 1}"
    raise Conflict("cannot allocate a unique slug")


def get_or_create_user(
    db: Session,
    email: str,
    display_name: str | None = None,
    password_hash: str | None = None,
) -> User:
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user:
        if user.status != "active":
            raise ManagerError(f"user {email} is disabled; re-enable before provisioning")
        if display_name:
            user.display_name = display_name
        if password_hash and not user.password_hash:
            user.password_hash = password_hash
        return user
    user = User(
        email=email,
        display_name=display_name,
        password_hash=password_hash,
    )
    db.add(user)
    db.flush()
    return user


def is_platform_admin(db: Session, email: str) -> bool:
    admin = db.get(PlatformAdmin, email.strip().lower())
    return bool(admin and admin.active)


def ensure_bootstrap_admin(db: Session, email: str) -> None:
    email = email.strip().lower()
    if db.get(PlatformAdmin, email) is None:
        db.add(PlatformAdmin(email=email, display_name="bootstrap", active=True))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()


def list_platform_admins(db: Session) -> list[PlatformAdmin]:
    return list(
        db.scalars(select(PlatformAdmin).order_by(PlatformAdmin.email)).all()
    )


def add_platform_admin(
    db: Session, email: str, display_name: str | None = None
) -> PlatformAdmin:
    email = email.strip().lower()
    admin = db.get(PlatformAdmin, email)
    if admin:
        admin.active = True
        if display_name:
            admin.display_name = display_name
    else:
        admin = PlatformAdmin(email=email, display_name=display_name, active=True)
        db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def deactivate_platform_admin(db: Session, email: str) -> PlatformAdmin:
    email = email.strip().lower()
    admin = db.get(PlatformAdmin, email)
    if not admin:
        raise NotFoundError(f"admin not found: {email}")
    admin.active = False
    db.commit()
    return admin


def audit(
    db: Session,
    action: str,
    target: str | None = None,
    detail: str | None = None,
    actor: str | None = None,
) -> None:
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            target=target,
            detail=detail,
            created_at=utcnow(),
        )
    )


def _normalize_init_script(script: str | None) -> str | None:
    if script is None or not script.strip():
        return None
    return script

