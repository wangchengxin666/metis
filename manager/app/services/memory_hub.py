"""Organizational Memory Hub: inspect sandbox memories and promote curated learnings into versioned SOPs or Team Knowledge."""

from __future__ import annotations

import json
import math
import re
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from ..docker_service import BaseSandboxRuntime
from ..models import (
    MemoryKnowledgeEntry,
    MemoryPromotion,
    Sandbox,
    SandboxTemplate,
    Team,
    TeamSandbox,
)
from ..schemas import MemoryKnowledgeCreate, MemoryPromoteRequest
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
    db.flush()
    db.add(
        MemoryKnowledgeEntry(
            source_type="promotion",
            source_id=promo.id,
            template_id=tpl.id if tpl else None,
            team_id=team.id if team else None,
            title=clean_title,
            category=payload.memory_category.strip() or "workflow",
            tags_csv=f"{source_sandbox.slug},{payload.memory_category.strip()}",
            content=clean_content,
            enabled=True,
            created_by=actor,
        )
    )
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


def serialize_knowledge_entry(e: MemoryKnowledgeEntry) -> dict[str, Any]:
    return {
        "id": e.id,
        "source_type": e.source_type,
        "source_id": e.source_id,
        "template_id": e.template_id,
        "team_id": e.team_id,
        "title": e.title,
        "category": e.category,
        "tags_csv": e.tags_csv,
        "content": e.content,
        "enabled": bool(e.enabled),
        "created_by": e.created_by,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


def create_knowledge_entry(
    db: Session,
    payload: MemoryKnowledgeCreate,
    *,
    actor: str,
) -> MemoryKnowledgeEntry:
    entry = MemoryKnowledgeEntry(
        source_type="manual",
        template_id=(payload.template_id or "").strip() or None,
        team_id=(payload.team_id or "").strip() or None,
        title=payload.title.strip(),
        category=payload.category.strip() or "workflow",
        tags_csv=payload.tags_csv.strip(),
        content=payload.content.strip(),
        enabled=True,
        created_by=actor,
    )
    db.add(entry)
    audit(db, "memory.knowledge_create", target=entry.title[:64], actor=actor)
    db.commit()
    db.refresh(entry)
    return entry


def list_knowledge_entries(
    db: Session,
    *,
    team_id: str | None = None,
    template_id: str | None = None,
    limit: int = 80,
) -> list[MemoryKnowledgeEntry]:
    stmt = select(MemoryKnowledgeEntry).where(MemoryKnowledgeEntry.enabled == True)  # noqa: E712
    if team_id:
        stmt = stmt.where(
            or_(
                MemoryKnowledgeEntry.team_id == team_id,
                MemoryKnowledgeEntry.team_id.is_(None),
            )
        )
    if template_id:
        stmt = stmt.where(
            or_(
                MemoryKnowledgeEntry.template_id == template_id,
                MemoryKnowledgeEntry.template_id.is_(None),
            )
        )
    stmt = stmt.order_by(MemoryKnowledgeEntry.updated_at.desc()).limit(max(1, min(limit, 300)))
    return list(db.scalars(stmt).all())


def delete_knowledge_entry(db: Session, entry_id: str, *, actor: str) -> None:
    row = db.get(MemoryKnowledgeEntry, entry_id)
    if row is None:
        raise NotFoundError("知识记忆条目不存在")
    audit(db, "memory.knowledge_delete", target=row.id, actor=actor, detail=f"title={row.title[:64]}")
    db.delete(row)
    db.commit()


_WORD_RE = re.compile(r"[a-z0-9_.-]{2,}", re.IGNORECASE)
_CJK_RE = re.compile(r"[\u4e00-\u9fff]+")


def _tokenize_knowledge(text: str) -> list[str]:
    """Portable tokenizer producing lowercase ASCII words plus CJK bigrams/unigrams."""
    raw = (text or "").lower()
    tokens = _WORD_RE.findall(raw)
    for seg in _CJK_RE.findall(raw):
        if len(seg) == 1:
            tokens.append(seg)
        else:
            for idx in range(len(seg)):
                tokens.append(seg[idx])
                if idx + 1 < len(seg):
                    tokens.append(seg[idx : idx + 2])
    return tokens


def recall_relevant_memories(
    db: Session,
    query: str,
    *,
    team_id: str | None = None,
    template_id: str | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Portable BM25-weighted Top-K organizational memory recall across PostgreSQL/MSSQL/MySQL/SQLite."""
    q_tokens = set(_tokenize_knowledge(query))
    if not q_tokens:
        return []
    candidates = list_knowledge_entries(
        db, team_id=team_id, template_id=template_id, limit=250
    )
    if not candidates:
        return []

    doc_tokens_list: list[list[str]] = []
    df: dict[str, int] = {}
    for entry in candidates:
        toks = _tokenize_knowledge(f"{entry.title} {entry.tags_csv} {entry.category} {entry.content}")
        doc_tokens_list.append(toks)
        for t in set(toks):
            if t in q_tokens:
                df[t] = df.get(t, 0) + 1

    n_docs = len(candidates)
    avgdl = max(1.0, sum(len(d) for d in doc_tokens_list) / float(n_docs))
    k1 = 1.4
    b = 0.75

    scored: list[tuple[float, MemoryKnowledgeEntry]] = []
    for entry, d_toks in zip(candidates, doc_tokens_list):
        if not d_toks:
            continue
        tf_map: dict[str, int] = {}
        for t in d_toks:
            if t in q_tokens:
                tf_map[t] = tf_map.get(t, 0) + 1
        if not tf_map:
            continue
        dl = len(d_toks)
        score = 0.0
        for qt, tf in tf_map.items():
            idf = math.log(1.0 + (n_docs - df.get(qt, 0) + 0.5) / (df.get(qt, 0) + 0.5))
            denom = tf + k1 * (1.0 - b + b * (dl / avgdl))
            score += idf * ((tf * (k1 + 1.0)) / denom)
        if team_id and entry.team_id == team_id:
            score *= 1.15
        if template_id and entry.template_id == template_id:
            score *= 1.15
        if score > 0:
            scored.append((score, entry))

    scored.sort(key=lambda pair: (-pair[0], -(pair[1].updated_at.timestamp() if pair[1].updated_at else 0)))
    return [
        {
            **serialize_knowledge_entry(entry),
            "score": round(score, 4),
        }
        for score, entry in scored[: max(1, min(limit, 20))]
    ]
