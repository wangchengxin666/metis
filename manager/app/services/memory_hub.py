"""Organizational Memory Hub: inspect sandbox memories and promote curated learnings into versioned SOPs or Team Knowledge."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..docker_service import BaseSandboxRuntime
from ..models import MemoryPromotion, Sandbox, SandboxTemplate, Team, TeamSandbox
from ..schemas import MemoryPromoteRequest
from .common import NotFoundError, audit, utcnow


def serialize_promotion(p: MemoryPromotion) -> dict[str, Any]:
    try:
        rollout_ids = json.loads(p.rollout_sandbox_ids_json or "[]")
    except Exception:
        rollout_ids = []
    return {
        "id": p.id,
        "source_sandbox_id": p.source_sandbox_id,
        "source_sandbox_slug": p.source_sandbox_slug,
        "memory_id": p.memory_id,
        "memory_title": p.memory_title,
        "memory_category": p.memory_category,
        "promoted_content": p.promoted_content,
        "target_type": p.target_type,
        "target_template_id": p.target_template_id,
        "target_template_name": p.target_template_name,
        "target_team_id": p.target_team_id,
        "target_team_name": p.target_team_name,
        "target_file_name": p.target_file_name,
        "sop_version": p.sop_version,
        "rollout_sandbox_ids": rollout_ids,
        "rollout_synced_count": int(p.rollout_synced_count or 0),
        "promoted_by": p.promoted_by,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def promote_sandbox_memory(
    db: Session,
    docker: BaseSandboxRuntime,
    source_sandbox: Sandbox,
    payload: MemoryPromoteRequest,
    *,
    actor: str,
) -> tuple[MemoryPromotion, dict[str, Any]]:
    clean_title = payload.memory_title.strip()
    clean_content = payload.promoted_content.strip()
    clean_rollout_ids = list(
        dict.fromkeys(str(x).strip() for x in payload.rollout_sandbox_ids if str(x).strip())
    )

    rollout_results: list[dict[str, Any]] = []
    synced_count = 0
    sop_version: int | None = None
    tpl: SandboxTemplate | None = None
    team: Team | None = None
    target_file: str | None = None

    if payload.target_type == "template_sop":
        if not payload.target_template_id:
            raise NotFoundError("请选择目标岗位模板")
        tpl = db.get(SandboxTemplate, payload.target_template_id)
        if tpl is None:
            raise NotFoundError("目标岗位模板不存在")

        next_ver = int(getattr(tpl, "sop_version", 1) or 1) + 1
        tpl.sop_version = next_ver
        sop_version = next_ver
        rule_block = (
            f"\n\n### [SOP v{next_ver}] {clean_title} (from @{source_sandbox.slug})\n"
            f"{clean_content}\n"
        )
        base_sop = (tpl.role_sop or "").rstrip()
        tpl.role_sop = (base_sop + rule_block).strip()
        tpl.updated_at = utcnow()

        # Optional canary or batch rollout to selected sandboxes
        if clean_rollout_ids:
            target_sandboxes = list(
                db.scalars(
                    select(Sandbox)
                    .options(joinedload(Sandbox.user))
                    .where(Sandbox.deleted_at.is_(None), Sandbox.id.in_(clean_rollout_ids))
                ).all()
            )
            for sbx in target_sandboxes:
                cur_sop = (sbx.role_sop or "").rstrip()
                sbx.role_sop = (cur_sop + rule_block).strip()
                res = docker.sync_role_profile(sbx)
                rollout_results.append(res)
                if res.get("ok"):
                    synced_count += 1
    else:
        if not payload.target_team_id:
            raise NotFoundError("请选择目标业务团队")
        team = db.get(Team, payload.target_team_id)
        if team is None:
            raise NotFoundError("目标团队不存在")
        target_file = (payload.target_file_name or "TEAM_PLAYBOOK_SOP.md").strip()

        # Determine team target sandboxes (all team sandboxes or canary subset)
        team_sbx_ids = list(
            db.scalars(
                select(TeamSandbox.sandbox_id).where(TeamSandbox.team_id == team.id)
            ).all()
        )
        effective_ids = (
            [sid for sid in clean_rollout_ids if sid in set(team_sbx_ids)]
            if clean_rollout_ids
            else team_sbx_ids
        )
        clean_rollout_ids = effective_ids
        if effective_ids:
            target_sandboxes = list(
                db.scalars(
                    select(Sandbox)
                    .options(joinedload(Sandbox.user))
                    .where(Sandbox.deleted_at.is_(None), Sandbox.id.in_(effective_ids))
                ).all()
            )
            doc_body = (
                f"# {clean_title}\n\n"
                f"> 来源：数字员工 `@{source_sandbox.slug}` 经验晋升 · 分类：`{payload.memory_category}` · 审核人：{actor}\n\n"
                f"{clean_content}\n"
            )
            sync_res = docker.sync_shared_project_file(
                target_sandboxes,
                team_name=team.name,
                file_name=target_file,
                content=doc_body,
                project_slug=team.slug,
            )
            rollout_results = list(sync_res.get("results") or [])
            synced_count = int(sync_res.get("synced") or 0)

    promo = MemoryPromotion(
        source_sandbox_id=source_sandbox.id,
        source_sandbox_slug=source_sandbox.slug,
        memory_id=payload.memory_id.strip(),
        memory_title=clean_title,
        memory_category=payload.memory_category.strip() or "workflow",
        promoted_content=clean_content,
        target_type=payload.target_type,
        target_template_id=tpl.id if tpl else None,
        target_template_name=tpl.name if tpl else None,
        target_team_id=team.id if team else None,
        target_team_name=team.name if team else None,
        target_file_name=target_file,
        sop_version=sop_version,
        rollout_sandbox_ids_json=json.dumps(clean_rollout_ids),
        rollout_synced_count=synced_count,
        promoted_by=actor,
    )
    db.add(promo)
    audit(
        db,
        "memory.promote_sop" if payload.target_type == "template_sop" else "memory.promote_team_doc",
        target=tpl.key if tpl else (team.name if team else source_sandbox.slug),
        actor=actor,
        detail=(
            f"slug={source_sandbox.slug},memory={clean_title[:48]},"
            f"version={sop_version or '-'},synced={synced_count}/{len(clean_rollout_ids)}"
        ),
    )
    db.commit()
    db.refresh(promo)
    return promo, {
        "synced": synced_count,
        "total": len(clean_rollout_ids),
        "results": rollout_results,
    }
