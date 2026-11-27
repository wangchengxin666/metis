from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import AuditLog, PlatformAdmin, Sandbox, User
from ..security import hash_password


_SLUG_DETAIL_RE = re.compile(r"(?:^|[,\s])slug=([a-z0-9][a-z0-9_-]{0,63})", re.IGNORECASE)


def infer_audit_category(action: str) -> str:
    act = (action or "").strip().lower()
    if act.startswith("sandbox.approval_") or act.startswith("playbook.step_"):
        return "approval"
    if (
        act.startswith("sandbox.task_")
        or act.startswith("sandbox.webhook_")
        or act.startswith("team.")
        or act.startswith("playbook.")
        or act.startswith("memory.")
        or act.startswith("workforce.")
    ):
        return "workforce"
    if (
        act.startswith("credential.")
        or act.startswith("auth.")
        or act.startswith("oidc.")
        or act.startswith("user.")
        or act.startswith("admin.")
    ):
        return "security"
    if act.startswith("notification."):
        return "notification"
    if act.startswith("sandbox.") or act.startswith("template."):
        return "sandbox"
    return "system"


def extract_audit_slug(detail: str | None) -> str | None:
    if not detail:
        return None
    m = _SLUG_DETAIL_RE.search(detail)
    return m.group(1).lower() if m else None


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
    *,
    overwrite_display_name: bool = False,
) -> User:
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user:
        if user.status != "active":
            raise ManagerError(f"user {email} is disabled; re-enable before provisioning")
        if overwrite_display_name and display_name:
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
        db.add(PlatformAdmin(email=email, display_name=None, active=True))
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
    *,
    category: str | None = None,
    sandbox_slug: str | None = None,
) -> None:
    resolved_category = (category or infer_audit_category(action)).strip().lower()
    resolved_slug = (sandbox_slug or extract_audit_slug(detail) or "").strip().lower() or None
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            category=resolved_category,
            sandbox_slug=resolved_slug,
            target=target,
            detail=detail,
            created_at=utcnow(),
        )
    )


def query_audit_logs(
    db: Session,
    *,
    q: str | None = None,
    category: str | None = None,
    action: str | None = None,
    actor: str | None = None,
    sandbox_slug: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[AuditLog], int, list[str], list[str]]:
    stmt = select(AuditLog)
    count_stmt = select(func.count(AuditLog.id))
    conditions = []

    if q and q.strip():
        like = f"%{q.strip()}%"
        conditions.append(
            or_(
                AuditLog.action.ilike(like),
                AuditLog.actor.ilike(like),
                AuditLog.target.ilike(like),
                AuditLog.detail.ilike(like),
                AuditLog.sandbox_slug.ilike(like),
            )
        )
    if category and category.strip() and category.strip() != "all":
        cat = category.strip().lower()
        conditions.append(AuditLog.category == cat)
    if action and action.strip() and action.strip() != "all":
        conditions.append(AuditLog.action == action.strip())
    if actor and actor.strip():
        conditions.append(AuditLog.actor.ilike(f"%{actor.strip()}%"))
    if sandbox_slug and sandbox_slug.strip():
        slug_val = sandbox_slug.strip().lower()
        conditions.append(
            or_(
                AuditLog.sandbox_slug == slug_val,
                AuditLog.detail.ilike(f"%slug={slug_val}%"),
            )
        )
    if date_from is not None:
        conditions.append(AuditLog.created_at >= date_from)
    if date_to is not None:
        conditions.append(AuditLog.created_at <= date_to)

    for cond in conditions:
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)

    total = int(db.scalar(count_stmt) or 0)
    rows = list(
        db.scalars(
            stmt.order_by(AuditLog.created_at.desc())
            .offset(max(0, offset))
            .limit(max(1, min(limit, 500)))
        ).all()
    )
    # Backfill category/slug dynamically on legacy rows returned from DB
    for row in rows:
        if not row.category:
            row.category = infer_audit_category(row.action)
        if not row.sandbox_slug and row.detail:
            row.sandbox_slug = extract_audit_slug(row.detail)

    raw_actions = [
        str(a)
        for a in db.scalars(select(AuditLog.action).distinct().order_by(AuditLog.action.asc())).all()
        if a
    ]
    categories = sorted(
        {
            str(c)
            for c in db.scalars(select(AuditLog.category).distinct()).all()
            if c
        }
        | {infer_audit_category(a) for a in raw_actions}
    )
    return rows, total, categories, raw_actions


def _normalize_init_script(script: str | None) -> str | None:
    if script is None or not script.strip():
        return None
    return script

