"""First-class Team / Department management, Team Lead RBAC, dual-ownership access checks, and self-service hiring."""

from __future__ import annotations

from datetime import timedelta
import re
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..config import Settings
from ..docker_service import BaseSandboxRuntime
from ..models import (
    LlmUsageLedger,
    PlaybookRun,
    PlaybookStepRun,
    ProvisionRequest,
    Sandbox,
    Team,
    TeamMember,
    TeamSandbox,
    User,
)
from ..schemas import ProvisionRequestCreate, TeamCreate, TeamUpdate
from .common import Conflict, NotFoundError, audit, utcnow
from .sandboxes import create_sandbox
from .templates import get_template_by_key


def _slugify_team(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")[:48]
    if not base or not base[0].isalnum():
        base = f"team-{abs(hash(name)) % 100000}"
    return base


def _unique_team_slug(db: Session, name: str, wanted: str | None = None) -> str:
    if wanted:
        clean = wanted.strip().lower()
        if db.scalar(select(Team).where(Team.slug == clean)):
            raise Conflict(f"团队标识 '{clean}' 已存在")
        return clean
    base = _slugify_team(name)
    cand = base
    for i in range(1, 500):
        if not db.scalar(select(Team).where(Team.slug == cand)):
            return cand
        cand = f"{base}-{i + 1}"
    raise Conflict("无法生成唯一团队标识")


def get_user_teams_summary(
    db: Session, email: str | None
) -> tuple[bool, list[str], list[dict[str, str]]]:
    """Return (is_team_lead, lead_team_ids, teams_list) for the given user email."""
    clean = (email or "").strip().lower()
    if not clean:
        return False, [], []
    rows = db.execute(
        select(TeamMember, Team)
        .join(Team, Team.id == TeamMember.team_id)
        .where(TeamMember.user_email == clean)
        .order_by(Team.name.asc())
    ).all()
    teams_list: list[dict[str, str]] = []
    lead_ids: list[str] = []
    for member, team in rows:
        teams_list.append(
            {
                "id": team.id,
                "slug": team.slug,
                "name": team.name,
                "role": member.role,
            }
        )
        if member.role == "lead":
            lead_ids.append(team.id)
    return bool(lead_ids), lead_ids, teams_list


def is_team_lead_for_team(db: Session, email: str | None, team_id: str) -> bool:
    clean = (email or "").strip().lower()
    if not clean:
        return False
    return bool(
        db.scalar(
            select(TeamMember.id).where(
                TeamMember.team_id == team_id,
                TeamMember.user_email == clean,
                TeamMember.role == "lead",
            )
        )
    )


def get_sandbox_team_ids(db: Session, sandbox_id: str) -> list[str]:
    return list(
        db.scalars(
            select(TeamSandbox.team_id).where(TeamSandbox.sandbox_id == sandbox_id)
        ).all()
    )


def get_sandbox_teams_map(db: Session, sandbox_ids: list[str]) -> dict[str, list[tuple[str, str]]]:
    if not sandbox_ids:
        return {}
    rows = db.execute(
        select(TeamSandbox.sandbox_id, Team.id, Team.name)
        .join(Team, Team.id == TeamSandbox.team_id)
        .where(TeamSandbox.sandbox_id.in_(sandbox_ids))
        .order_by(Team.name.asc())
    ).all()
    out: dict[str, list[tuple[str, str]]] = {}
    for sbx_id, tid, tname in rows:
        out.setdefault(sbx_id, []).append((tid, tname))
    return out


def can_user_open_sandbox_ide(
    db: Session,
    sandbox: Sandbox,
    email: str | None,
    is_admin: bool,
) -> bool:
    """Enforce layered DSH IDE access: personal -> owner/admin; shared -> owner/maintainer/Team Lead/admin."""
    if is_admin:
        return True
    clean = (email or "").strip().lower()
    if not clean:
        return False
    owner_email = sandbox.user.email.lower()
    if clean == owner_email:
        return True
    mode = (getattr(sandbox, "ownership_mode", None) or "personal").strip().lower()
    if mode != "shared":
        return False
    if clean in sandbox.maintainer_emails:
        return True
    # Team Leads of any team containing this shared sandbox may open its full DSH workspace
    team_ids = get_sandbox_team_ids(db, sandbox.id)
    if not team_ids:
        return False
    return bool(
        db.scalar(
            select(TeamMember.id).where(
                TeamMember.team_id.in_(team_ids),
                TeamMember.user_email == clean,
                TeamMember.role == "lead",
            )
        )
    )


def can_user_access_sandbox_frontstage(
    db: Session,
    sandbox: Sandbox,
    email: str | None,
    is_admin: bool,
) -> bool:
    """Frontstage access (inbox, intake, approvals, deliverables): includes authorized team members for shared FTEs."""
    if can_user_open_sandbox_ide(db, sandbox, email, is_admin):
        return True
    clean = (email or "").strip().lower()
    if not clean:
        return False
    mode = (getattr(sandbox, "ownership_mode", None) or "personal").strip().lower()
    if mode != "shared":
        return False
    team_ids = get_sandbox_team_ids(db, sandbox.id)
    if not team_ids:
        return False
    return bool(
        db.scalar(
            select(TeamMember.id).where(
                TeamMember.team_id.in_(team_ids),
                TeamMember.user_email == clean,
            )
        )
    )


def can_user_view_team_preview(
    db: Session,
    sandbox: Sandbox,
    email: str | None,
    is_admin: bool,
) -> bool:
    """Authorize preview_auth_mode='team': formal Team membership first, with legacy project_team_name fallback."""
    if is_admin:
        return True
    clean = (email or "").strip().lower()
    if not clean:
        return False
    if clean == sandbox.user.email.lower():
        return True
    team_ids = get_sandbox_team_ids(db, sandbox.id)
    if team_ids:
        if db.scalar(
            select(TeamMember.id).where(
                TeamMember.team_id.in_(team_ids),
                TeamMember.user_email == clean,
            )
        ):
            return True
    # Legacy project_team_name fallback for sandboxes assembled before formal TeamMember assignments
    team_name = (getattr(sandbox, "project_team_name", None) or "").strip()
    if team_name:
        return bool(
            db.scalar(
                select(Sandbox.id)
                .join(Sandbox.user)
                .where(
                    Sandbox.deleted_at.is_(None),
                    Sandbox.project_team_name == team_name,
                    User.email == clean,
                    User.status == "active",
                )
            )
        )
    return False


def list_accessible_sandboxes(
    db: Session,
    email: str | None,
    is_admin: bool,
) -> list[Sandbox]:
    """Return all sandboxes visible to this user in Metis Frontstage (personal owned + shared team FTEs + led team sandboxes)."""
    if is_admin:
        return list(
            db.scalars(
                select(Sandbox)
                .options(joinedload(Sandbox.user), joinedload(Sandbox.llm_profile))
                .where(Sandbox.deleted_at.is_(None))
                .order_by(Sandbox.created_at.asc())
            ).all()
        )
    clean = (email or "").strip().lower()
    if not clean:
        return []

    owned = list(
        db.scalars(
            select(Sandbox)
            .join(Sandbox.user)
            .options(joinedload(Sandbox.user), joinedload(Sandbox.llm_profile))
            .where(Sandbox.deleted_at.is_(None), User.email == clean)
            .order_by(Sandbox.created_at.asc())
        ).all()
    )
    by_id: dict[str, Sandbox] = {s.id: s for s in owned}

    member_rows = list(
        db.scalars(select(TeamMember).where(TeamMember.user_email == clean)).all()
    )
    if member_rows:
        all_team_ids = [m.team_id for m in member_rows]
        lead_team_ids = {m.team_id for m in member_rows if m.role == "lead"}
        ts_rows = list(
            db.scalars(
                select(TeamSandbox).where(TeamSandbox.team_id.in_(all_team_ids))
            ).all()
        )
        candidate_ids = list({r.sandbox_id for r in ts_rows if r.sandbox_id not in by_id})
        if candidate_ids:
            team_by_sbx: dict[str, set[str]] = {}
            for r in ts_rows:
                team_by_sbx.setdefault(r.sandbox_id, set()).add(r.team_id)
            candidates = list(
                db.scalars(
                    select(Sandbox)
                    .options(joinedload(Sandbox.user), joinedload(Sandbox.llm_profile))
                    .where(Sandbox.deleted_at.is_(None), Sandbox.id.in_(candidate_ids))
                    .order_by(Sandbox.created_at.asc())
                ).all()
            )
            for sbx in candidates:
                is_shared = (getattr(sbx, "ownership_mode", "personal") or "personal") == "shared"
                is_led = bool(team_by_sbx.get(sbx.id, set()) & lead_team_ids)
                if is_shared or is_led or clean in sbx.maintainer_emails:
                    by_id[sbx.id] = sbx

    # Also include shared sandboxes where user is listed directly as maintainer
    shared_candidates = list(
        db.scalars(
            select(Sandbox)
            .options(joinedload(Sandbox.user), joinedload(Sandbox.llm_profile))
            .where(
                Sandbox.deleted_at.is_(None),
                Sandbox.ownership_mode == "shared",
            )
        ).all()
    )
    for sbx in shared_candidates:
        if sbx.id not in by_id and clean in sbx.maintainer_emails:
            by_id[sbx.id] = sbx

    return sorted(by_id.values(), key=lambda s: s.created_at)


def serialize_team(
    db: Session,
    team: Team,
    *,
    viewer_email: str | None = None,
    is_admin: bool = False,
) -> dict[str, Any]:
    members = list(
        db.scalars(
            select(TeamMember)
            .where(TeamMember.team_id == team.id)
            .order_by(TeamMember.role.asc(), TeamMember.user_email.asc())
        ).all()
    )
    ts_rows = list(
        db.scalars(
            select(TeamSandbox).where(TeamSandbox.team_id == team.id)
        ).all()
    )
    sbx_ids = [r.sandbox_id for r in ts_rows]
    mod_ids = {r.sandbox_id for r in ts_rows if r.is_moderator}
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

    clean_viewer = (viewer_email or "").strip().lower()
    my_role = "admin" if is_admin else None
    for m in members:
        if m.user_email == clean_viewer:
            my_role = m.role
            break

    # Lightweight live project KPIs for the Project Space cards
    total_runs_count = int(
        db.scalar(select(func.count(PlaybookRun.id)).where(PlaybookRun.team_id == team.id)) or 0
    )
    active_runs_count = int(
        db.scalar(
            select(func.count(PlaybookRun.id)).where(
                PlaybookRun.team_id == team.id,
                PlaybookRun.status.in_(["running", "awaiting_approval"]),
            )
        )
        or 0
    )
    pending_step_approvals = int(
        db.scalar(
            select(func.count(PlaybookStepRun.id))
            .join(PlaybookRun, PlaybookRun.id == PlaybookStepRun.run_id)
            .where(
                PlaybookRun.team_id == team.id,
                PlaybookStepRun.status == "awaiting_approval",
            )
        )
        or 0
    )
    pending_hire_approvals = int(
        db.scalar(
            select(func.count(ProvisionRequest.id)).where(
                ProvisionRequest.team_id == team.id,
                ProvisionRequest.status == "pending",
            )
        )
        or 0
    )
    now_utc = utcnow()
    day_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    since_30d = now_utc - timedelta(days=30)
    team_ledger_scope = (
        or_(LlmUsageLedger.team_id == team.id, LlmUsageLedger.sandbox_id.in_(sbx_ids))
        if sbx_ids
        else (LlmUsageLedger.team_id == team.id)
    )
    today_cost_usd = float(
        db.scalar(
            select(func.coalesce(func.sum(LlmUsageLedger.cost_amount), 0.0)).where(
                team_ledger_scope,
                LlmUsageLedger.created_at >= day_start,
            )
        )
        or 0.0
    )
    period_cost_usd = float(
        db.scalar(
            select(func.coalesce(func.sum(LlmUsageLedger.cost_amount), 0.0)).where(
                team_ledger_scope,
                LlmUsageLedger.created_at >= since_30d,
            )
        )
        or 0.0
    )

    return {
        "id": team.id,
        "slug": team.slug,
        "name": team.name,
        "description": team.description,
        "department": team.department,
        "status": getattr(team, "status", "active") or "active",
        "mesh_room_id": getattr(team, "mesh_room_id", None),
        "daily_token_budget": team.daily_token_budget,
        "daily_cost_budget": getattr(team, "daily_cost_budget", None),
        "today_cost_usd": round(today_cost_usd, 6),
        "created_by": team.created_by,
        "created_at": team.created_at.isoformat() if team.created_at else None,
        "updated_at": team.updated_at.isoformat() if team.updated_at else None,
        "my_role": my_role,
        "can_manage": bool(is_admin or my_role == "lead"),
        "active_runs_count": active_runs_count,
        "total_runs_count": total_runs_count,
        "pending_approvals_count": pending_step_approvals + pending_hire_approvals,
        "period_cost_usd": round(period_cost_usd, 6),
        "members": [
            {
                "email": m.user_email,
                "role": m.role,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in members
        ],
        "sandboxes": [
            {
                "id": s.id,
                "slug": s.slug,
                "display_name": s.effective_display_name or s.slug,
                "owner_email": s.user.email if s.user else "",
                "role_title": s.role_title,
                "ownership_mode": getattr(s, "ownership_mode", "personal") or "personal",
                "status": s.status,
                "is_moderator": s.id in mod_ids,
            }
            for s in sandboxes
        ],
    }


def sync_project_mesh_group(
    db: Session,
    team: Team,
    docker: BaseSandboxRuntime | None,
    *,
    actor: str | None = None,
    removed_sandbox_slug: str | None = None,
) -> dict[str, Any]:
    """Automatically pair project digital employees and sync the live @metis/sandbox-mesh group room."""
    if docker is None:
        return {"ok": False, "skipped": True, "room_id": team.mesh_room_id, "detail": "runtime unavailable"}

    ts_rows = list(
        db.scalars(select(TeamSandbox).where(TeamSandbox.team_id == team.id)).all()
    )
    sbx_ids = [r.sandbox_id for r in ts_rows]
    mod_ids = {r.sandbox_id for r in ts_rows if r.is_moderator}
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

    if len(sandboxes) < 2:
        if (
            team.mesh_room_id
            and removed_sandbox_slug
            and sandboxes
            and hasattr(docker, "remove_mesh_group_member")
        ):
            try:
                docker.remove_mesh_group_member(sandboxes, team.mesh_room_id, removed_sandbox_slug)
            except Exception:
                pass
        if len(sandboxes) < 2 and team.mesh_room_id:
            team.mesh_room_id = None
            db.commit()
            db.refresh(team)
        return {
            "ok": False,
            "skipped": True,
            "room_id": team.mesh_room_id,
            "synced": 0,
            "total": len(sandboxes),
            "detail": "项目至少需要 2 位数字员工才会自动建立项目群聊",
        }

    mod_slug = next((s.slug for s in sandboxes if s.id in mod_ids), None)
    try:
        try:
            res = docker.assemble_mesh_team(
                sandboxes,
                team_name=team.name,
                moderator_slug=mod_slug,
                project_slug=team.slug,
                existing_room_id=team.mesh_room_id,
            )
        except TypeError:
            res = docker.assemble_mesh_team(
                sandboxes,
                team_name=team.name,
                moderator_slug=mod_slug,
            )
    except Exception as exc:
        return {
            "ok": False,
            "skipped": False,
            "room_id": team.mesh_room_id,
            "synced": 0,
            "total": len(sandboxes),
            "detail": str(exc)[:240],
        }

    if res.get("ok") and res.get("room_id"):
        new_room_id = str(res["room_id"]).strip()
        if new_room_id and team.mesh_room_id != new_room_id:
            team.mesh_room_id = new_room_id
            audit(
                db,
                "team.mesh_group_sync",
                target=team.name,
                detail=f"room_id={new_room_id},synced={res.get('synced')}/{len(sandboxes)}",
                actor=actor,
            )
            db.commit()
            db.refresh(team)
    return res


def create_team(
    db: Session,
    payload: TeamCreate,
    *,
    actor: str | None = None,
    docker: BaseSandboxRuntime | None = None,
    auto_add_creator_as_lead: bool = False,
) -> Team:
    clean_name = payload.name.strip()
    if db.scalar(select(Team).where(Team.name == clean_name)):
        raise Conflict(f"项目 '{clean_name}' 已存在")
    slug = _unique_team_slug(db, clean_name, payload.slug)

    team = Team(
        slug=slug,
        name=clean_name,
        description=(payload.description or "").strip() or None,
        department=(payload.department or "").strip() or None,
        status="active",
        daily_token_budget=(
            payload.daily_token_budget
            if payload.daily_token_budget and payload.daily_token_budget > 0
            else None
        ),
        daily_cost_budget=(
            round(float(payload.daily_cost_budget), 4)
            if payload.daily_cost_budget is not None and float(payload.daily_cost_budget) > 0
            else None
        ),
        created_by=actor,
    )
    db.add(team)
    db.flush()

    seen_emails: set[str] = set()
    lead_candidates = [str(em).strip().lower() for em in payload.lead_emails if str(em).strip()]
    if auto_add_creator_as_lead and actor:
        clean_actor = actor.strip().lower()
        if clean_actor and clean_actor not in lead_candidates:
            lead_candidates.insert(0, clean_actor)
    for clean_em in lead_candidates:
        if clean_em and clean_em not in seen_emails:
            seen_emails.add(clean_em)
            db.add(TeamMember(team_id=team.id, user_email=clean_em, role="lead"))
    for em in payload.member_emails:
        clean_em = str(em).strip().lower()
        if clean_em and clean_em not in seen_emails:
            seen_emails.add(clean_em)
            db.add(TeamMember(team_id=team.id, user_email=clean_em, role="member"))

    attached_sandboxes: list[Sandbox] = []
    if payload.sandbox_ids:
        sandboxes = list(
            db.scalars(
                select(Sandbox)
                .options(joinedload(Sandbox.user))
                .where(Sandbox.deleted_at.is_(None), Sandbox.id.in_(payload.sandbox_ids))
            ).all()
        )
        for sbx in sandboxes:
            db.add(
                TeamSandbox(
                    team_id=team.id,
                    sandbox_id=sbx.id,
                    is_moderator=sbx.id == payload.moderator_sandbox_id,
                )
            )
            if not sbx.project_team_name:
                sbx.project_team_name = clean_name
            attached_sandboxes.append(sbx)

    audit(
        db,
        "team.create",
        target=clean_name,
        detail=f"slug={slug},members={len(seen_emails)},sandboxes={len(attached_sandboxes)}",
        actor=actor,
    )
    db.commit()
    db.refresh(team)

    if docker is not None and len(attached_sandboxes) >= 2:
        try:
            sync_project_mesh_group(db, team, docker, actor=actor)
        except Exception:
            pass
    return team


def ensure_team_for_assembly(
    db: Session,
    *,
    team_name: str,
    sandboxes: list[Sandbox],
    moderator_slug: str | None = None,
    mesh_room_id: str | None = None,
    actor: str | None = None,
) -> Team:
    """Upsert a first-class Team when admin uses the quick Assemble Team action."""
    clean_name = team_name.strip()
    team = db.scalar(select(Team).where(Team.name == clean_name))
    if team is None:
        team = Team(
            slug=_unique_team_slug(db, clean_name),
            name=clean_name,
            mesh_room_id=(mesh_room_id or "").strip() or None,
            created_by=actor,
        )
        db.add(team)
        db.flush()
    elif mesh_room_id and mesh_room_id.strip():
        team.mesh_room_id = mesh_room_id.strip()

    existing_sbx_ids = set(
        db.scalars(select(TeamSandbox.sandbox_id).where(TeamSandbox.team_id == team.id)).all()
    )
    existing_member_emails = set(
        db.scalars(select(TeamMember.user_email).where(TeamMember.team_id == team.id)).all()
    )
    for sbx in sandboxes:
        if sbx.id not in existing_sbx_ids:
            db.add(
                TeamSandbox(
                    team_id=team.id,
                    sandbox_id=sbx.id,
                    is_moderator=sbx.slug == moderator_slug,
                )
            )
        owner_em = sbx.user.email.lower() if sbx.user else ""
        if owner_em and owner_em not in existing_member_emails:
            existing_member_emails.add(owner_em)
            db.add(TeamMember(team_id=team.id, user_email=owner_em, role="member"))
    return team


def update_team(
    db: Session,
    team: Team,
    payload: TeamUpdate,
    *,
    actor: str | None = None,
) -> Team:
    if payload.name is not None:
        clean_name = payload.name.strip()
        conflict = db.scalar(
            select(Team).where(Team.name == clean_name, Team.id != team.id)
        )
        if conflict:
            raise Conflict(f"团队 '{clean_name}' 已存在")
        team.name = clean_name
    if payload.description is not None:
        team.description = payload.description.strip() or None
    if payload.department is not None:
        team.department = payload.department.strip() or None
    if payload.status is not None and payload.status != getattr(team, "status", "active"):
        team.status = payload.status
        audit(
            db,
            "team.archive" if payload.status == "archived" else "team.restore",
            target=team.name,
            actor=actor,
        )
    if payload.daily_token_budget is not None:
        team.daily_token_budget = (
            payload.daily_token_budget if payload.daily_token_budget > 0 else None
        )
    if payload.daily_cost_budget is not None:
        team.daily_cost_budget = (
            round(float(payload.daily_cost_budget), 4)
            if float(payload.daily_cost_budget) > 0
            else None
        )
    audit(db, "team.update", target=team.name, actor=actor)
    db.commit()
    db.refresh(team)
    return team


def delete_team(db: Session, team: Team, *, actor: str | None = None) -> None:
    name = team.name
    db.query(TeamMember).where(TeamMember.team_id == team.id).delete()
    db.query(TeamSandbox).where(TeamSandbox.team_id == team.id).delete()
    audit(db, "team.delete", target=name, actor=actor)
    db.delete(team)
    db.commit()


def upsert_team_member(
    db: Session,
    team: Team,
    *,
    email: str,
    role: str = "member",
    actor: str | None = None,
) -> TeamMember:
    clean_em = email.strip().lower()
    row = db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team.id,
            TeamMember.user_email == clean_em,
        )
    )
    if row is None:
        row = TeamMember(team_id=team.id, user_email=clean_em, role=role)
        db.add(row)
    else:
        row.role = role
    audit(
        db,
        "team.member_upsert",
        target=team.name,
        detail=f"member={clean_em},role={role}",
        actor=actor,
    )
    db.commit()
    db.refresh(row)
    return row


def remove_team_member(
    db: Session,
    team: Team,
    email: str,
    *,
    actor: str | None = None,
) -> None:
    clean_em = email.strip().lower()
    row = db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team.id,
            TeamMember.user_email == clean_em,
        )
    )
    if row is None:
        raise NotFoundError(f"成员 {clean_em} 不在该团队中")
    db.delete(row)
    audit(
        db,
        "team.member_remove",
        target=team.name,
        detail=f"member={clean_em}",
        actor=actor,
    )
    db.commit()


def attach_sandbox_to_team(
    db: Session,
    team: Team,
    sandbox: Sandbox,
    *,
    is_moderator: bool = False,
    actor: str | None = None,
    docker: BaseSandboxRuntime | None = None,
) -> TeamSandbox:
    if is_moderator:
        others = list(
            db.scalars(
                select(TeamSandbox).where(
                    TeamSandbox.team_id == team.id,
                    TeamSandbox.sandbox_id != sandbox.id,
                    TeamSandbox.is_moderator.is_(True),
                )
            ).all()
        )
        for o in others:
            o.is_moderator = False

    row = db.scalar(
        select(TeamSandbox).where(
            TeamSandbox.team_id == team.id,
            TeamSandbox.sandbox_id == sandbox.id,
        )
    )
    if row is None:
        row = TeamSandbox(
            team_id=team.id,
            sandbox_id=sandbox.id,
            is_moderator=is_moderator,
        )
        db.add(row)
    else:
        row.is_moderator = is_moderator
    if not sandbox.project_team_name:
        sandbox.project_team_name = team.name
    audit(
        db,
        "team.sandbox_attach",
        target=team.name,
        detail=f"slug={sandbox.slug},moderator={is_moderator}",
        actor=actor,
    )
    db.commit()
    db.refresh(row)

    if docker is not None:
        try:
            sync_project_mesh_group(db, team, docker, actor=actor)
        except Exception:
            pass
    return row


def detach_sandbox_from_team(
    db: Session,
    team: Team,
    sandbox_id: str,
    *,
    actor: str | None = None,
    docker: BaseSandboxRuntime | None = None,
) -> None:
    row = db.scalar(
        select(TeamSandbox).where(
            TeamSandbox.team_id == team.id,
            TeamSandbox.sandbox_id == sandbox_id,
        )
    )
    if row is None:
        raise NotFoundError("该数字员工未关联到此团队")
    detached_sbx = db.get(Sandbox, sandbox_id)
    detached_slug = detached_sbx.slug if detached_sbx else None
    db.delete(row)
    audit(
        db,
        "team.sandbox_detach",
        target=team.name,
        detail=f"sandbox_id={sandbox_id}",
        actor=actor,
    )
    db.commit()

    if docker is not None:
        try:
            sync_project_mesh_group(
                db,
                team,
                docker,
                actor=actor,
                removed_sandbox_slug=detached_slug,
            )
        except Exception:
            pass


def serialize_provision_request(db: Session, req: ProvisionRequest) -> dict[str, Any]:
    team = db.get(Team, req.team_id) if req.team_id else None
    tpl = get_template_by_key(db, req.template_key)
    return {
        "id": req.id,
        "requester_email": req.requester_email,
        "team_id": req.team_id,
        "team_name": team.name if team else None,
        "template_key": req.template_key,
        "template_name": tpl.name if tpl else req.template_key,
        "ownership_mode": req.ownership_mode,
        "desired_slug": req.desired_slug,
        "role_title": req.role_title or (tpl.role_title if tpl else None),
        "reason": req.reason,
        "status": req.status,
        "reviewed_by": req.reviewed_by,
        "review_note": req.review_note,
        "provisioned_sandbox_id": req.provisioned_sandbox_id,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
    }


def create_provision_request(
    db: Session,
    payload: ProvisionRequestCreate,
    *,
    requester_email: str,
) -> ProvisionRequest:
    tpl = get_template_by_key(db, payload.template_key.strip())
    if tpl is None:
        raise NotFoundError(f"岗位模板不存在: {payload.template_key}")
    if payload.team_id:
        team = db.get(Team, payload.team_id)
        if team is None:
            raise NotFoundError("所选团队不存在")
    req = ProvisionRequest(
        requester_email=requester_email.strip().lower(),
        team_id=payload.team_id,
        template_key=tpl.key,
        ownership_mode=payload.ownership_mode,
        desired_slug=payload.desired_slug,
        role_title=(payload.role_title or "").strip() or tpl.role_title,
        reason=(payload.reason or "").strip() or None,
        status="pending",
    )
    db.add(req)
    audit(
        db,
        "workforce.provision_request",
        target=tpl.key,
        detail=f"requester={req.requester_email},mode={req.ownership_mode}",
        actor=req.requester_email,
    )
    db.commit()
    db.refresh(req)
    return req


def decide_provision_request(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    req: ProvisionRequest,
    *,
    decision: str,
    note: str = "",
    llm_profile_id: str | None = None,
    actor: str,
) -> tuple[ProvisionRequest, Sandbox | None]:
    if req.status != "pending":
        raise Conflict("该申请已被处理，无法重复审批")

    provisioned: Sandbox | None = None
    if decision == "approved":
        provisioned = create_sandbox(
            db,
            settings,
            docker,
            email=req.requester_email,
            slug=req.desired_slug,
            display_name=req.role_title,
            image_tag=None,
            template=req.template_key,
            role_title=req.role_title,
            llm_profile_id=llm_profile_id,
            ownership_mode=req.ownership_mode,
            team_ids=[req.team_id] if req.team_id else None,
            set_new_user_display_name=False,
        )
        req.provisioned_sandbox_id = provisioned.id
        req.status = "approved"
    else:
        req.status = "rejected"

    req.reviewed_by = actor
    req.review_note = note.strip() or None
    req.updated_at = utcnow()
    audit(
        db,
        f"workforce.provision_{decision}",
        target=req.id,
        detail=f"template={req.template_key},requester={req.requester_email},slug={provisioned.slug if provisioned else ''}",
        actor=actor,
    )
    db.commit()
    db.refresh(req)

    if decision == "approved" and req.team_id:
        try:
            target_team = db.get(Team, req.team_id)
            if target_team is not None:
                sync_project_mesh_group(db, target_team, docker, actor=actor)
        except Exception:
            pass

    return req, provisioned
