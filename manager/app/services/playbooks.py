"""Declarative enterprise Playbook engine: presets, YAML/JSON import-export, and multi-stage run orchestration."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import posixpath
import re
import secrets
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..coordination import cluster_lock
from ..docker_service import BaseSandboxRuntime
from ..models import (
    LlmProfile,
    Playbook,
    PlaybookArtifact,
    PlaybookRun,
    PlaybookStepRun,
    Sandbox,
    SandboxRuntimeSnapshot,
    SandboxTemplate,
    Team,
)
from ..schemas import PlaybookCreate, PlaybookUpdate
from ..security import decrypt_secret, encrypt_secret
from .common import Conflict, ManagerError, NotFoundError, audit, utcnow
from .notifications import NotificationEvent, dispatch_notification_event
from .policies import get_branding_config
from .teams import sync_project_mesh_group

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None


BUILTIN_PLAYBOOKS: list[dict[str, Any]] = [
    {
        "key": "rd-feature-delivery",
        "name": "新需求端到端研发交付流",
        "category": "engineering",
        "description": "产研标杆样板间：从需求 PRD 定稿审批、架构拆解、前后端并行开发、QA 验收，到在线预览应用发布全链路闭环。",
        "estimated_manual_hours": 16.0,
        "input_fields": [
            {
                "key": "feature_title",
                "label": "需求名称",
                "type": "text",
                "required": True,
                "placeholder": "例如：客户自助发票导出模块",
            },
            {
                "key": "business_goal",
                "label": "业务背景与核心诉求",
                "type": "textarea",
                "required": True,
                "placeholder": "描述目标用户、解决什么痛点、核心交互路径...",
            },
            {
                "key": "target_repo",
                "label": "目标代码仓库 / 模块路径（可选）",
                "type": "text",
                "required": False,
                "placeholder": "例如：github.com/org/app 或 /home/workspace/app",
            },
            {
                "key": "acceptance_criteria",
                "label": "验收标准（可选）",
                "type": "textarea",
                "required": False,
                "placeholder": "列出必须满足的功能点与性能指标...",
            },
            {
                "key": "attachments",
                "label": "需求原型 / 参考文档（可选）",
                "type": "file",
                "required": False,
                "placeholder": "",
            },
        ],
        "stages": [
            {
                "id": "prd",
                "name": "需求定稿与人工审批",
                "role_hint": "产品经理 / Tech Lead",
                "template_key_hint": "lead",
                "parallel_group": None,
                "approval_required": True,
                "prompt_template": (
                    "请基于需求「{{feature_title}}」编写结构化 PRD 与验收清单。\n"
                    "业务背景：{{business_goal}}\n"
                    "补充验收标准：{{acceptance_criteria}}\n"
                    "产出包含：用户故事、边界条件、接口数据模型草案与关键风险点，提交后等待人工审批确认。"
                ),
                "deliverable_hint": "PRD 文档与验收清单（需人工审批）",
            },
            {
                "id": "arch",
                "name": "架构设计与任务拆解",
                "role_hint": "系统架构师",
                "template_key_hint": "architect",
                "parallel_group": None,
                "approval_required": False,
                "prompt_template": (
                    "请基于已批准的 PRD，针对目标仓库「{{target_repo}}」输出技术设计方案与 API 契约，"
                    "拆解清晰的前后端实现与测试要点。\n前置阶段输出：{{previous_outputs}}"
                ),
                "deliverable_hint": "技术架构方案与 API 契约",
            },
            {
                "id": "impl",
                "name": "核心功能开发与联调",
                "role_hint": "全栈研发工程师",
                "template_key_hint": "fullstack",
                "parallel_group": None,
                "approval_required": False,
                "prompt_template": (
                    "请根据架构方案完成「{{feature_title}}」前后端代码实现与自测，"
                    "并在本地启动可预览服务后通过 sandbox-expose 暴露预览链接。\n"
                    "前置阶段输出：{{previous_outputs}}"
                ),
                "deliverable_hint": "可运行代码 / PR 与预览端口",
            },
            {
                "id": "qa",
                "name": "自动化测试与 QA 验收",
                "role_hint": "测试与质量保障专家",
                "template_key_hint": "qa",
                "parallel_group": None,
                "approval_required": False,
                "prompt_template": (
                    "请针对「{{feature_title}}」编写并执行端到端与边界用例，输出缺陷清单与质量验收结论。\n"
                    "验收标准：{{acceptance_criteria}}\n前置阶段输出：{{previous_outputs}}"
                ),
                "deliverable_hint": "QA 测试报告与通过率结论",
            },
            {
                "id": "release",
                "name": "在线预览发布与最终验收",
                "role_hint": "全栈研发工程师 / DevOps",
                "template_key_hint": "devops",
                "parallel_group": None,
                "approval_required": True,
                "prompt_template": (
                    "请整合开发实现与 QA 验收报告，确认线上/预览环境地址可用，整理发布说明（Release Notes）"
                    "并发起最终人工上线验收审批。\n前置阶段输出：{{previous_outputs}}"
                ),
                "deliverable_hint": "在线预览链接 (/apps/*) 与上线审批单",
            },
        ],
        "deliverables_checklist": [
            "已确认的 PRD 与验收标准",
            "技术方案与接口契约文档",
            "通过自动化测试的代码变更 / PR",
            "可一键点击访问的在线预览应用 URL",
        ],
    },
    {
        "key": "bi-analysis-report",
        "name": "商业数据 BI 分析报告流",
        "category": "analytics",
        "description": "数据与业务职能样板间：上传原始业务数据（CSV/Excel/JSON），自动完成口径清洗、指标归因、可视化报告生成与负责人复核。",
        "estimated_manual_hours": 8.0,
        "input_fields": [
            {
                "key": "report_title",
                "label": "分析报告主题",
                "type": "text",
                "required": True,
                "placeholder": "例如：Q3 区域销售转化率波动归因分析",
            },
            {
                "key": "analysis_question",
                "label": "核心业务问题与指标口径",
                "type": "textarea",
                "required": True,
                "placeholder": "需要回答哪些关键问题？重点拆解哪些维度（渠道、区域、客群）？",
            },
            {
                "key": "audience",
                "label": "目标汇报对象",
                "type": "select",
                "required": True,
                "options": ["高管决策层", "业务部门负责人", "产研运营团队"],
            },
            {
                "key": "attachments",
                "label": "上传业务数据文件（CSV / Excel / JSON）",
                "type": "file",
                "required": False,
                "placeholder": "",
            },
        ],
        "stages": [
            {
                "id": "data_audit",
                "name": "数据清洗与口径核验",
                "role_hint": "数据分析师",
                "template_key_hint": "data",
                "parallel_group": None,
                "approval_required": False,
                "prompt_template": (
                    "请检查上传的数据文件，针对报告「{{report_title}}」完成缺失值、异常值与统计口径核验。\n"
                    "业务问题：{{analysis_question}}\n输出数据质量检查摘要与清洗脚本路径。"
                ),
                "deliverable_hint": "数据质量报告与清洗后数据集",
            },
            {
                "id": "bi_report",
                "name": "归因分析与可视化报告生成",
                "role_hint": "数据分析师 / BI 专家",
                "template_key_hint": "data",
                "parallel_group": None,
                "approval_required": False,
                "prompt_template": (
                    "请面向「{{audience}}」产出《{{report_title}}》完整分析报告（含核心结论、关键指标拆解表、异常归因与可执行建议），"
                    "如有条件可生成交互式 HTML 看板并通过 sandbox-expose 暴露预览。\n前置阶段输出：{{previous_outputs}}"
                ),
                "deliverable_hint": "商业分析报告 / 交互式可视化看板",
            },
            {
                "id": "exec_signoff",
                "name": "业务负责人复核发布",
                "role_hint": "业务负责人 / 行政助理",
                "template_key_hint": "assistant",
                "parallel_group": None,
                "approval_required": True,
                "prompt_template": (
                    "请提炼一页纸高管摘要（Executive Summary）并核对图表数据一致性，提交业务负责人人工复核发布。\n"
                    "前置阶段输出：{{previous_outputs}}"
                ),
                "deliverable_hint": "定稿汇报材料与人工审批签核",
            },
        ],
        "deliverables_checklist": [
            "数据口径核验与清洗记录",
            "核心指标趋势与异常归因分析报告",
            "可执行业务改进建议与复核签核",
        ],
    },
    {
        "key": "contract-compliance-review",
        "name": "合同条款合规初审流",
        "category": "legal",
        "description": "法务/采购职能样板间：上传合同文本，自动按我方角色逐条扫描高风险条款、生成修订替代措辞，并交由法务主管人工审批放行。",
        "estimated_manual_hours": 6.0,
        "input_fields": [
            {
                "key": "contract_name",
                "label": "合同名称 / 项目编号",
                "type": "text",
                "required": True,
                "placeholder": "例如：2026 年度 SaaS 企业服务采购主协议",
            },
            {
                "key": "counterparty",
                "label": "相对方名称",
                "type": "text",
                "required": True,
                "placeholder": "例如：某某科技有限公司",
            },
            {
                "key": "our_role",
                "label": "我方法律角色",
                "type": "select",
                "required": True,
                "options": ["甲方（采购方）", "乙方（服务提供方）", "战略合作方"],
            },
            {
                "key": "focus_areas",
                "label": "重点关注条款（可选）",
                "type": "textarea",
                "required": False,
                "placeholder": "例如：数据安全与隐私合规、违约责任上限、知识产权归属、付款与续约条款...",
            },
            {
                "key": "attachments",
                "label": "上传合同文件（PDF / DOCX / MD / TXT）",
                "type": "file",
                "required": False,
                "placeholder": "",
            },
        ],
        "stages": [
            {
                "id": "clause_scan",
                "name": "条款抽取与高风险扫描",
                "role_hint": "法务合规助理",
                "template_key_hint": "legal",
                "parallel_group": None,
                "approval_required": False,
                "prompt_template": (
                    "请以「{{our_role}}」立场审查合同《{{contract_name}}》（相对方：{{counterparty}}）。\n"
                    "重点审查域：{{focus_areas}}\n"
                    "请逐条提取高/中/低风险条款，说明法律与商业后果，并标注对应章节位置。"
                ),
                "deliverable_hint": "风险条款分级扫描清单",
            },
            {
                "id": "redline",
                "name": "修订建议与替代措辞起草",
                "role_hint": "法务合规助理",
                "template_key_hint": "legal",
                "parallel_group": None,
                "approval_required": False,
                "prompt_template": (
                    "基于风险扫描清单，为每一条中高风险条款撰写「原文 vs 建议修订文本 vs 谈判底线」三栏对照表。\n"
                    "前置阶段输出：{{previous_outputs}}"
                ),
                "deliverable_hint": "Redline 修订对照表与谈判策略",
            },
            {
                "id": "legal_signoff",
                "name": "法务主管合规审批放行",
                "role_hint": "法务主管",
                "template_key_hint": "legal",
                "parallel_group": None,
                "approval_required": True,
                "prompt_template": (
                    "请汇总合同初审结论（建议直接签署 / 修订后签署 / 退回重谈），形成一页纸合规审批意见并等待法务主管人工审批。\n"
                    "前置阶段输出：{{previous_outputs}}"
                ),
                "deliverable_hint": "法务合规审批意见书（需人工签核）",
            },
        ],
        "deliverables_checklist": [
            "高/中/低分级风险条款清单",
            "三栏 Redline 替代措辞对照表",
            "法务主管审批放行结论",
        ],
    },
]


def ensure_default_playbooks(db: Session) -> None:
    """Idempotently seed the 3 built-in enterprise showcase Playbooks and repair legacy impl/qa parallel bug."""
    existing_by_key = {pb.key: pb for pb in db.scalars(select(Playbook)).all()}
    changed = False
    for spec in BUILTIN_PLAYBOOKS:
        existing = existing_by_key.get(spec["key"])
        if existing is not None:
            # Repair legacy rd-feature-delivery preset where impl & qa mistakenly ran in parallel
            if spec["key"] == "rd-feature-delivery" and existing.is_builtin:
                stages = existing.stages
                impl_st = next((s for s in stages if s.get("id") == "impl"), None)
                qa_st = next((s for s in stages if s.get("id") == "qa"), None)
                if (
                    impl_st is not None
                    and qa_st is not None
                    and impl_st.get("parallel_group") == "build_verify"
                    and qa_st.get("parallel_group") == "build_verify"
                ):
                    impl_st["parallel_group"] = None
                    qa_st["parallel_group"] = None
                    existing.stages_json = json.dumps(stages, ensure_ascii=False)
                    changed = True
            continue
        db.add(
            Playbook(
                key=spec["key"],
                name=spec["name"],
                category=spec["category"],
                description=spec["description"],
                is_builtin=True,
                enabled=True,
                estimated_manual_hours=float(spec["estimated_manual_hours"]),
                input_fields_json=json.dumps(spec["input_fields"], ensure_ascii=False),
                stages_json=json.dumps(spec["stages"], ensure_ascii=False),
                deliverables_checklist_json=json.dumps(
                    spec["deliverables_checklist"], ensure_ascii=False
                ),
                created_by="system",
            )
        )
        changed = True
    if changed:
        db.commit()


def _parse_cron_field(field: str, min_v: int, max_v: int) -> set[int]:
    vals: set[int] = set()
    for part in field.split(","):
        p = part.strip()
        if not p:
            raise ValueError(f"Empty cron token in '{field}'")
        step = 1
        if "/" in p:
            p, step_raw = p.split("/", 1)
            step = int(step_raw)
            if step <= 0:
                raise ValueError(f"Invalid cron step '{step_raw}'")
        if p == "*":
            lo, hi = min_v, max_v
        elif "-" in p:
            a, b = p.split("-", 1)
            lo, hi = int(a), int(b)
        else:
            lo = hi = int(p)
            if step == 1:
                if lo < min_v or lo > max_v:
                    raise ValueError(f"Cron value {lo} out of [{min_v}, {max_v}]")
                vals.add(lo)
                continue
        if lo < min_v or hi > max_v or lo > hi:
            raise ValueError(f"Cron range {lo}-{hi} out of [{min_v}, {max_v}]")
        vals.update(range(lo, hi + 1, step))
    return vals


def validate_cron_expression(expr: str) -> str:
    clean = " ".join((expr or "").strip().split())
    parts = clean.split(" ")
    if len(parts) != 5:
        raise ValueError("Cron 表达式必须为 5 段格式：分 时 日 月 周，例如 '0 9 * * 1-5'")
    _parse_cron_field(parts[0], 0, 59)
    _parse_cron_field(parts[1], 0, 23)
    _parse_cron_field(parts[2], 1, 31)
    _parse_cron_field(parts[3], 1, 12)
    _parse_cron_field(parts[4], 0, 7)
    return clean


def _cron_matches_minute(expr: str, dt: datetime) -> bool:
    parts = validate_cron_expression(expr).split(" ")
    mins = _parse_cron_field(parts[0], 0, 59)
    hours = _parse_cron_field(parts[1], 0, 23)
    doms = _parse_cron_field(parts[2], 1, 31)
    months = _parse_cron_field(parts[3], 1, 12)
    dows_raw = _parse_cron_field(parts[4], 0, 7)
    dows = {0 if d == 7 else d for d in dows_raw}
    # Python weekday(): Mon=0..Sun=6 -> cron dow: Sun=0..Sat=6
    cron_dow = (dt.weekday() + 1) % 7
    return (
        dt.minute in mins
        and dt.hour in hours
        and dt.day in doms
        and dt.month in months
        and cron_dow in dows
    )


def serialize_playbook(pb: Playbook) -> dict[str, Any]:
    try:
        sched_inputs = json.loads(getattr(pb, "schedule_inputs_json", None) or "{}")
        if not isinstance(sched_inputs, dict):
            sched_inputs = {}
    except Exception:
        sched_inputs = {}
    return {
        "id": pb.id,
        "key": pb.key,
        "name": pb.name,
        "category": pb.category,
        "description": pb.description,
        "is_builtin": bool(pb.is_builtin),
        "enabled": bool(pb.enabled),
        "estimated_manual_hours": float(pb.estimated_manual_hours or 4.0),
        "input_fields": pb.input_fields,
        "stages": pb.stages,
        "deliverables_checklist": pb.deliverables_checklist,
        "schedule_cron": getattr(pb, "schedule_cron", None),
        "schedule_enabled": bool(getattr(pb, "schedule_enabled", False)),
        "schedule_timezone": getattr(pb, "schedule_timezone", "UTC") or "UTC",
        "schedule_inputs": sched_inputs,
        "last_scheduled_at": (
            pb.last_scheduled_at.isoformat() if getattr(pb, "last_scheduled_at", None) else None
        ),
        "has_webhook_secret": bool(getattr(pb, "webhook_secret_ciphertext", "")),
        "webhook_url": f"/api/hooks/playbooks/{pb.key}",
        "created_by": pb.created_by,
        "created_at": pb.created_at.isoformat() if pb.created_at else None,
        "updated_at": pb.updated_at.isoformat() if pb.updated_at else None,
    }


def list_playbooks(db: Session, *, enabled_only: bool = False) -> list[Playbook]:
    stmt = select(Playbook)
    if enabled_only:
        stmt = stmt.where(Playbook.enabled == True)  # noqa: E712
    stmt = stmt.order_by(Playbook.is_builtin.desc(), Playbook.created_at.asc())
    return list(db.scalars(stmt).all())


def _slugify_playbook_key(raw: str | None, fallback_name: str = "") -> str:
    src = (raw or "").strip().lower() or (fallback_name or "").strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", src).strip("-")[:54]
    if len(slug) < 2 or not slug[0].isalnum():
        slug = f"playbook-{secrets.token_hex(3)}"
    return slug


def _unique_playbook_key(db: Session, wanted: str | None, name: str) -> str:
    if wanted and wanted.strip():
        clean = wanted.strip().lower()
        if db.scalar(select(Playbook).where(Playbook.key == clean)):
            raise Conflict(f"Playbook '{clean}' 已存在")
        return clean
    base = _slugify_playbook_key(None, name)
    cand = base
    for i in range(2, 200):
        if not db.scalar(select(Playbook).where(Playbook.key == cand)):
            return cand
        cand = f"{base[:56]}-{i}"
    return f"playbook-{secrets.token_hex(4)}"


def create_playbook(
    db: Session,
    payload: PlaybookCreate,
    *,
    actor: str | None = None,
) -> Playbook:
    clean_key = _unique_playbook_key(db, payload.key, payload.name)
    cron_clean = (payload.schedule_cron or "").strip() or None
    if cron_clean:
        cron_clean = validate_cron_expression(cron_clean)
    elif payload.schedule_enabled:
        raise ValueError("启用定时编排前必须填写合法的 Cron 表达式")
    tz_clean = (payload.schedule_timezone or "UTC").strip() or "UTC"
    try:
        ZoneInfo(tz_clean)
    except Exception as exc:
        raise ValueError(f"无效的时区标识: {tz_clean}") from exc
    pb = Playbook(
        key=clean_key,
        name=payload.name.strip(),
        category=payload.category,
        description=(payload.description or "").strip() or None,
        is_builtin=False,
        enabled=payload.enabled,
        estimated_manual_hours=float(payload.estimated_manual_hours),
        input_fields_json=json.dumps(
            [f.model_dump() for f in payload.input_fields], ensure_ascii=False
        ),
        stages_json=json.dumps(
            [s.model_dump() for s in payload.stages], ensure_ascii=False
        ),
        deliverables_checklist_json=json.dumps(
            [x.strip() for x in payload.deliverables_checklist if x.strip()],
            ensure_ascii=False,
        ),
        schedule_cron=cron_clean,
        schedule_enabled=bool(payload.schedule_enabled and cron_clean),
        schedule_timezone=tz_clean,
        schedule_inputs_json=json.dumps(payload.schedule_inputs or {}, ensure_ascii=False),
        webhook_secret_ciphertext=(
            encrypt_secret(payload.webhook_secret.strip())
            if payload.webhook_secret and payload.webhook_secret.strip()
            else ""
        ),
        created_by=actor,
    )
    db.add(pb)
    audit(db, "playbook.create", target=clean_key, detail=f"name={pb.name}", actor=actor)
    db.commit()
    db.refresh(pb)
    return pb


def update_playbook(
    db: Session,
    pb: Playbook,
    payload: PlaybookUpdate,
    *,
    actor: str | None = None,
) -> Playbook:
    if payload.name is not None:
        pb.name = payload.name.strip()
    if payload.category is not None:
        pb.category = payload.category
    if payload.description is not None:
        pb.description = payload.description.strip() or None
    if payload.enabled is not None:
        pb.enabled = payload.enabled
    if payload.estimated_manual_hours is not None:
        pb.estimated_manual_hours = float(payload.estimated_manual_hours)
    if payload.input_fields is not None:
        pb.input_fields_json = json.dumps(
            [f.model_dump() for f in payload.input_fields], ensure_ascii=False
        )
    if payload.stages is not None:
        pb.stages_json = json.dumps(
            [s.model_dump() for s in payload.stages], ensure_ascii=False
        )
    if payload.deliverables_checklist is not None:
        pb.deliverables_checklist_json = json.dumps(
            [x.strip() for x in payload.deliverables_checklist if x.strip()],
            ensure_ascii=False,
        )
    if payload.schedule_cron is not None:
        cron_clean = payload.schedule_cron.strip() or None
        pb.schedule_cron = validate_cron_expression(cron_clean) if cron_clean else None
    if payload.schedule_timezone is not None:
        tz_clean = payload.schedule_timezone.strip() or "UTC"
        try:
            ZoneInfo(tz_clean)
        except Exception as exc:
            raise ValueError(f"无效的时区标识: {tz_clean}") from exc
        pb.schedule_timezone = tz_clean
    if payload.schedule_enabled is not None:
        if payload.schedule_enabled and not (pb.schedule_cron or "").strip():
            raise ValueError("启用定时编排前必须填写合法的 Cron 表达式")
        pb.schedule_enabled = bool(payload.schedule_enabled)
    if payload.schedule_inputs is not None:
        pb.schedule_inputs_json = json.dumps(payload.schedule_inputs, ensure_ascii=False)
    if payload.clear_webhook_secret:
        pb.webhook_secret_ciphertext = ""
    elif payload.webhook_secret is not None and payload.webhook_secret.strip():
        pb.webhook_secret_ciphertext = encrypt_secret(payload.webhook_secret.strip())
    pb.updated_at = utcnow()
    audit(db, "playbook.update", target=pb.key, detail=f"name={pb.name}", actor=actor)
    db.commit()
    db.refresh(pb)
    return pb


def delete_playbook(db: Session, pb: Playbook, *, actor: str | None = None) -> None:
    if pb.is_builtin:
        raise Conflict("内置样板间 Playbook 不可删除，可选择禁用")
    key = pb.key
    audit(db, "playbook.delete", target=key, actor=actor)
    db.delete(pb)
    db.commit()


def export_playbook_declarative(pb: Playbook, fmt: str = "yaml") -> tuple[str, str]:
    doc = {
        "schema_version": "metis.playbook/v1",
        "key": pb.key,
        "name": pb.name,
        "category": pb.category,
        "description": pb.description or "",
        "enabled": bool(pb.enabled),
        "estimated_manual_hours": float(pb.estimated_manual_hours or 4.0),
        "input_fields": pb.input_fields,
        "stages": pb.stages,
        "deliverables_checklist": pb.deliverables_checklist,
        "schedule_cron": getattr(pb, "schedule_cron", None),
        "schedule_enabled": bool(getattr(pb, "schedule_enabled", False)),
        "schedule_timezone": getattr(pb, "schedule_timezone", "UTC") or "UTC",
        "schedule_inputs": serialize_playbook(pb)["schedule_inputs"],
    }
    if fmt == "yaml" and yaml is not None:
        text = yaml.safe_dump(doc, allow_unicode=True, sort_keys=False)
        return text, "text/yaml; charset=utf-8"
    return json.dumps(doc, ensure_ascii=False, indent=2), "application/json; charset=utf-8"


def import_playbook_declarative(
    db: Session,
    raw_content: str,
    *,
    overwrite: bool = False,
    actor: str | None = None,
) -> Playbook:
    parsed: Any = None
    try:
        parsed = json.loads(raw_content)
    except Exception:
        if yaml is not None:
            parsed = yaml.safe_load(raw_content)
    if not isinstance(parsed, dict):
        raise ValueError("无法解析 Playbook 定义，请提供有效的 YAML 或 JSON 文档")

    spec = PlaybookCreate.model_validate(parsed)
    clean_key = (spec.key or "").strip().lower()
    existing = db.scalar(select(Playbook).where(Playbook.key == clean_key)) if clean_key else None
    if existing is not None:
        if not overwrite:
            raise Conflict(f"Playbook '{spec.key}' 已存在，如需覆盖请开启覆盖选项")
        return update_playbook(
            db,
            existing,
            PlaybookUpdate(
                name=spec.name,
                category=spec.category,
                description=spec.description,
                enabled=spec.enabled,
                estimated_manual_hours=spec.estimated_manual_hours,
                input_fields=spec.input_fields,
                stages=spec.stages,
                deliverables_checklist=spec.deliverables_checklist,
                schedule_cron=spec.schedule_cron,
                schedule_enabled=spec.schedule_enabled,
                schedule_timezone=spec.schedule_timezone,
                schedule_inputs=spec.schedule_inputs,
                webhook_secret=spec.webhook_secret,
            ),
            actor=actor,
        )
    return create_playbook(db, spec, actor=actor)


def _render_template(template: str, variables: dict[str, str]) -> str:
    def _repl(match: re.Match[str]) -> str:
        k = match.group(1).strip()
        val = variables.get(k, "")
        return val if val else "（未提供）"

    return re.sub(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}", _repl, template)


def _auto_pick_sandbox_for_stage(
    stage: dict[str, Any],
    accessible: list[Sandbox],
) -> Sandbox | None:
    if not accessible:
        return None
    tpl_hint = str(stage.get("template_key_hint") or "").strip().lower()
    role_hint = str(stage.get("role_hint") or "").strip().lower()
    keywords = [w for w in re.split(r"[\s/,|·&]+", role_hint) if len(w) >= 2]

    best: tuple[int, Sandbox] | None = None
    for sbx in accessible:
        score = 0
        if sbx.status == "running":
            score += 3
        tpl = (sbx.template or "").lower()
        slug = (sbx.slug or "").lower()
        rtitle = (sbx.role_title or "").lower()
        if tpl_hint and (tpl_hint in tpl or tpl_hint in slug):
            score += 10
        for kw in keywords:
            if kw in rtitle or kw in slug:
                score += 6
        if best is None or score > best[0]:
            best = (score, sbx)
    return best[1] if best else accessible[0]


def _collect_previous_outputs_text(
    steps: list[PlaybookStepRun],
    up_to_idx: int,
    *,
    depends_on: list[str] | None = None,
) -> str:
    dep_set = {str(d).strip() for d in (depends_on or []) if str(d).strip()}
    lines: list[str] = []
    for st in steps:
        is_dep = st.stage_id in dep_set
        if not dep_set and st.stage_index >= up_to_idx:
            break
        if dep_set and not is_dep and st.stage_index >= up_to_idx:
            continue
        if st.status != "completed":
            continue
        summary = (st.output_summary or "").strip() or "已完成"
        if len(summary) > 1200:
            summary = summary[:1200] + "…"
        try:
            arts = json.loads(st.artifacts_json or "[]")
        except Exception:
            arts = []
        art_line = f" | 产物: {', '.join(str(a) for a in arts)}" if arts else ""
        tag = " [前置依赖]" if is_dep else ""
        lines.append(f"- [{st.stage_name}{tag}](@{st.sandbox_slug or 'unassigned'}): {summary}{art_line}")
    return "\n".join(lines) if lines else "无前置阶段输出"


def _notify_step_sla_timeout(
    db: Session,
    settings: Settings,
    run: PlaybookRun,
    step: PlaybookStepRun,
) -> None:
    """Emit stage.timeout notification when a running step breaches its SLA timeout without recovery."""
    try:
        brand = get_branding_config(db)
        brand_name = str(brand.get("brand_name_zh") or brand.get("brand_name_en") or "Metis")
        timeout_sec = int(step.timeout_seconds or 0)
        dispatch_notification_event(
            db,
            settings,
            NotificationEvent(
                event_type="stage.timeout",
                title=f"[Playbook 阶段 SLA 超时] {run.title} · {step.stage_name}",
                summary=(
                    f"数字员工 @{step.sandbox_slug or 'agent'} 执行阶段「{step.stage_name}」已超过 SLA 时限"
                    f"（{timeout_sec}s，已自动重试 {int(step.retry_count or 0)}/{int(step.max_retries or 0)} 次），"
                    "请检查执行状态或介入重派/跳过。"
                ),
                severity="danger",
                sandbox_id=step.sandbox_id,
                sandbox_slug=step.sandbox_slug,
                task_id=step.task_id,
                action_url=(
                    f"{settings.manager_base_url.rstrip('/')}/projects/{run.team_id}"
                    if run.team_id
                    else f"{settings.manager_base_url.rstrip('/')}/projects"
                ),
                dedupe_key=f"playbook.sla:{run.id}:{step.id}:{int(step.retry_count or 0)}",
                metadata={"room_id": step.room_id or "", "timeout_seconds": timeout_sec},
            ),
            brand_name=brand_name,
        )
    except Exception:
        pass


def _notify_step_awaiting_approval(
    db: Session,
    settings: Settings,
    run: PlaybookRun,
    step: PlaybookStepRun,
) -> None:
    """Emit outbound approval.pending notification ONLY after the digital employee finishes and awaits review."""
    try:
        brand = get_branding_config(db)
        brand_name = str(brand.get("brand_name_zh") or brand.get("brand_name_en") or "Metis")
        preview = (step.output_summary or "").strip()[:240]
        summary_text = (
            f"数字员工 @{step.sandbox_slug or 'agent'} 已完成阶段「{step.stage_name}」的产出，等待人工审批。"
            + (f"\n产出摘要：{preview}" if preview else "")
        )
        dispatch_notification_event(
            db,
            settings,
            NotificationEvent(
                event_type="approval.pending",
                title=f"[Playbook 待审批] {run.title} · {step.stage_name}",
                summary=summary_text,
                severity="warning",
                sandbox_id=step.sandbox_id,
                sandbox_slug=step.sandbox_slug,
                task_id=step.task_id,
                action_url=(
                    f"{settings.manager_base_url.rstrip('/')}/projects/{run.team_id}"
                    if run.team_id
                    else f"{settings.manager_base_url.rstrip('/')}/projects"
                ),
                dedupe_key=f"playbook.approval:{run.id}:{step.id}:{step.task_id or ''}",
                metadata={"room_id": step.room_id or ""},
            ),
            brand_name=brand_name,
        )
    except Exception:
        pass


def _eval_skip_atom(atom: str, inputs: dict[str, Any], steps_by_id: dict[str, PlaybookStepRun]) -> bool:
    clean = atom.strip()
    if not clean:
        return False

    def resolve_operand(token: str) -> str:
        t = token.strip()
        if (t.startswith("'") and t.endswith("'")) or (t.startswith('"') and t.endswith('"')):
            return t[1:-1]
        if t.startswith("inputs."):
            return str(inputs.get(t[7:], "") or "")
        if t.startswith("stage."):
            parts = t.split(".", 2)
            if len(parts) == 3:
                st = steps_by_id.get(parts[1])
                if st is None:
                    return ""
                if parts[2] == "status":
                    return str(st.status or "")
                if parts[2] == "output":
                    return str(st.output_summary or "")
                if parts[2] == "approval_status":
                    return str(st.approval_status or "")
        return t

    for op_name in (" not contains ", " contains ", " != ", " == "):
        if op_name in clean:
            lhs_raw, rhs_raw = clean.split(op_name, 1)
            lhs = resolve_operand(lhs_raw)
            rhs = resolve_operand(rhs_raw)
            if op_name == " == ":
                return lhs.strip().lower() == rhs.strip().lower()
            if op_name == " != ":
                return lhs.strip().lower() != rhs.strip().lower()
            if op_name == " contains ":
                return rhs.lower() in lhs.lower()
            return rhs.lower() not in lhs.lower()

    negate = clean.startswith("!")
    target = clean[1:].strip() if negate else clean
    val = resolve_operand(target).strip().lower()
    truthy = bool(val) and val not in {"false", "0", "no", "off", "none", "null"}
    return (not truthy) if negate else truthy


def _evaluate_skip_condition(
    expr: str | None,
    inputs: dict[str, Any],
    steps: list[PlaybookStepRun],
) -> tuple[bool, str]:
    clean = (expr or "").strip()
    if not clean:
        return False, ""
    steps_by_id = {s.stage_id: s for s in steps}
    for or_part in clean.split("||"):
        and_parts = [p.strip() for p in or_part.split("&&") if p.strip()]
        if and_parts and all(_eval_skip_atom(p, inputs, steps_by_id) for p in and_parts):
            return True, clean
    return False, ""


def _capture_uploaded_artifacts(
    db: Session,
    run: PlaybookRun,
    files: list[tuple[str, bytes]],
) -> None:
    max_store = 5 * 1024 * 1024
    for idx, (fname, raw) in enumerate(files):
        if len(raw) > max_store:
            continue
        clean_name = posixpath.basename((fname or "").replace("\\", "/")).strip() or f"intake-{idx + 1}.bin"
        ctype, _ = mimetypes.guess_type(clean_name)
        db.add(
            PlaybookArtifact(
                run_id=run.id,
                step_id=None,
                stage_id="_intake",
                source_sandbox_id=None,
                source_sandbox_slug="user-upload",
                source_path=f"/home/workspace/shared-intake/pb-{run.id[:8]}/{clean_name}",
                file_name=clean_name[:255],
                content_type=(ctype or "application/octet-stream")[:128],
                size_bytes=len(raw),
                sha256=hashlib.sha256(raw).hexdigest(),
                content_b64=base64.b64encode(raw).decode("ascii"),
            )
        )


def _capture_step_artifacts(
    db: Session,
    docker: BaseSandboxRuntime,
    run: PlaybookRun,
    step: PlaybookStepRun,
    sandbox: Sandbox | None,
    candidate_paths: list[str],
) -> int:
    if sandbox is None or not candidate_paths or not hasattr(docker, "extract_workspace_files"):
        return 0
    existing_paths = set(
        db.scalars(
            select(PlaybookArtifact.source_path).where(
                PlaybookArtifact.run_id == run.id,
                PlaybookArtifact.step_id == step.id,
            )
        ).all()
    )
    to_fetch = [p for p in candidate_paths if p.startswith("/home/workspace/") and p not in existing_paths]
    if not to_fetch:
        return 0
    extracted = docker.extract_workspace_files(sandbox, to_fetch)
    added = 0
    for item in extracted:
        src_path = str(item.get("path") or "").strip()
        fname = str(item.get("file_name") or posixpath.basename(src_path) or "artifact.bin")
        b64 = str(item.get("content_b64") or "")
        if not src_path or src_path in existing_paths:
            continue
        ctype, _ = mimetypes.guess_type(fname)
        db.add(
            PlaybookArtifact(
                run_id=run.id,
                step_id=step.id,
                stage_id=step.stage_id,
                source_sandbox_id=sandbox.id,
                source_sandbox_slug=sandbox.slug,
                source_path=src_path[:512],
                file_name=fname[:255],
                content_type=(ctype or "application/octet-stream")[:128],
                size_bytes=int(item.get("size_bytes") or 0),
                sha256=str(item.get("sha256") or "")[:64],
                content_b64=b64,
            )
        )
        existing_paths.add(src_path)
        added += 1
    if added:
        db.flush()
    return added


def _materialize_upstream_artifacts(
    db: Session,
    docker: BaseSandboxRuntime,
    run: PlaybookRun,
    step: PlaybookStepRun,
    all_steps: list[PlaybookStepRun],
    sandbox: Sandbox,
) -> tuple[dict[str, list[str]], list[str]]:
    """Copy persistent DB PlaybookArtifacts from upstream stages into downstream sandbox shared folder."""
    if not hasattr(docker, "write_relayed_artifacts"):
        return {}, []
    deps = set(step.depends_on)
    if deps:
        by_stage_id = {s.stage_id: s for s in all_steps}
        allowed_stage_ids = {"_intake"}
        queue = list(deps)
        seen_ids: set[str] = set()
        while queue:
            cur_id = queue.pop(0)
            if cur_id in seen_ids:
                continue
            seen_ids.add(cur_id)
            allowed_stage_ids.add(cur_id)
            dep_step = by_stage_id.get(cur_id)
            if dep_step is not None and dep_step.status == "skipped":
                queue.extend(dep_step.depends_on)
    else:
        allowed_stage_ids = {s.stage_id for s in all_steps if s.stage_index < step.stage_index} | {"_intake"}

    rows = list(
        db.scalars(
            select(PlaybookArtifact)
            .where(PlaybookArtifact.run_id == run.id)
            .order_by(PlaybookArtifact.created_at.asc())
        ).all()
    )
    rel_rows = [r for r in rows if (r.stage_id or "") in allowed_stage_ids and r.content_b64]
    if not rel_rows:
        return {}, []

    files_payload: list[tuple[str, bytes]] = []
    stage_tags: list[str] = []
    for row in rel_rows:
        if row.source_sandbox_id == sandbox.id and row.stage_id != "_intake":
            # Avoid duplicating same-container scratch files unless from intake
            continue
        try:
            raw = base64.b64decode(row.content_b64.encode("ascii"))
        except Exception:
            continue
        prefixed = f"{row.stage_id or 'stage'}_{row.file_name}"
        files_payload.append((prefixed, raw))
        stage_tags.append(row.stage_id or "stage")

    if not files_payload:
        return {}, []
    try:
        written = docker.write_relayed_artifacts(sandbox, f"pb-{run.id[:8]}", files_payload)
    except Exception:
        return {}, []

    by_stage: dict[str, list[str]] = {}
    for st_tag, wpath in zip(stage_tags, written):
        by_stage.setdefault(st_tag, []).append(wpath)
    return by_stage, written


def _dispatch_step(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    run: PlaybookRun,
    step: PlaybookStepRun,
    all_steps: list[PlaybookStepRun],
    sandbox: Sandbox | None,
    *,
    inputs: dict[str, str],
    uploaded_paths: list[str],
    actor: str,
) -> None:
    variables = {str(k): str(v) for k, v in inputs.items()}
    variables["previous_outputs"] = _collect_previous_outputs_text(
        all_steps,
        step.stage_index,
        depends_on=step.depends_on,
    )
    for prev_st in all_steps:
        if prev_st.status == "completed":
            variables[f"stage.{prev_st.stage_id}.output"] = (
                prev_st.output_summary or ""
            ).strip() or "已完成"
            try:
                prev_arts = json.loads(prev_st.artifacts_json or "[]")
            except Exception:
                prev_arts = []
            variables[f"stage.{prev_st.stage_id}.artifacts"] = ", ".join(
                str(a) for a in prev_arts if str(a).strip()
            )
    relayed_by_stage: dict[str, list[str]] = {}
    relayed_paths: list[str] = []
    if sandbox is not None:
        try:
            if docker.status(sandbox) != "running":
                docker.start(sandbox)
                docker.wait_healthy(sandbox)
                sandbox.status = "running"
            relayed_by_stage, relayed_paths = _materialize_upstream_artifacts(
                db, docker, run, step, all_steps, sandbox
            )
        except Exception:
            relayed_by_stage, relayed_paths = {}, []
    for st_id_key, spaths in relayed_by_stage.items():
        variables[f"stage.{st_id_key}.shared_artifacts"] = ", ".join(spaths)

    rendered = _render_template(step.prompt_rendered or step.stage_name, variables)
    team = db.get(Team, run.team_id) if run.team_id else None
    if team is not None:
        rendered += (
            f"\n\n### 项目共享目录\n"
            f"- 本项目共享文档与知识目录为 `/home/workspace/shared/{team.slug}/`，"
            "请优先参考其中资料并将阶段通用产出同步至该目录。"
        )
    if uploaded_paths:
        rendered += "\n\n---\n### 随单附件路径\n" + "\n".join(f"- `{p}`" for p in uploaded_paths)
    if relayed_paths:
        rendered += (
            "\n\n### 跨阶段真实文件交付物（已同步至本沙箱目录，可直接读取）\n"
            + "\n".join(f"- `{p}`" for p in relayed_paths)
        )
    try:
        from .memory_hub import recall_relevant_memories

        tpl_id = None
        if sandbox is not None and sandbox.template:
            tpl_obj = db.scalar(select(SandboxTemplate).where(SandboxTemplate.key == sandbox.template))
            tpl_id = tpl_obj.id if tpl_obj else None
        recalled = recall_relevant_memories(
            db,
            f"{run.title} {step.stage_name} {rendered[:400]}",
            team_id=run.team_id,
            template_id=tpl_id,
            limit=3,
        )
        if recalled:
            snippets = [
                f"- **{m['title']}**: {str(m['content'] or '').strip()[:260]}"
                for m in recalled
            ]
            rendered += "\n\n### 组织经验库召回参考（Top-K RAG）\n" + "\n".join(snippets)
    except Exception:
        pass
    if step.deliverable_hint:
        rendered += f"\n\n### 预期交付物\n- {step.deliverable_hint}"
    total_stages = len(all_steps)
    if total_stages > 1:
        later_stages = [s.stage_name for s in all_steps if s.stage_index > step.stage_index]
        later_hint = (
            f"后续阶段（{' → '.join(later_stages[:4])}）将由 Playbook 在本阶段完成/审批后自动派发，请勿提前越界执行。"
            if later_stages
            else "本阶段为流程的最终收口阶段，请完成汇总交付。"
        )
        rendered += (
            f"\n\n### 阶段边界（第 {step.stage_index + 1}/{total_stages} 阶段：{step.stage_name}）\n"
            f"- 请仅聚焦并闭环本阶段的交付目标与验收要求；{later_hint}"
        )
    rendered += (
        "\n\n### 执行要求\n"
        "请直接在本对话中完成任务并回复清晰、结构化的交付结论（如有生成文件请附带 `/home/workspace/...` 路径，"
        "如有预览服务请附带可访问 URL）。"
    )

    step.prompt_rendered = rendered
    step.started_at = utcnow()
    step.sla_warned_at = None
    # Always start in 'running' so the digital employee executes first!
    # Only after the employee replies does an approval_required stage transition to 'awaiting_approval'.
    step.status = "running"
    step.approval_status = None
    step.output_summary = None

    use_project_group = (
        (getattr(run, "execution_mode", "isolated") or "isolated") == "project_group"
        and team is not None
        and bool(getattr(team, "mesh_room_id", None))
    )
    target_room_id = (
        step.room_id or str(team.mesh_room_id)
        if use_project_group and team is not None
        else (step.room_id or "")
    )
    room_name = (team.name if use_project_group and team is not None else f"Playbook: {run.title}")[:72]
    use_new_topic = (
        (step.stage_index == 0 and not step.room_id)
        if use_project_group
        else bool(step.room_id)
    )

    if sandbox is not None:
        step.sandbox_id = sandbox.id
        step.sandbox_slug = sandbox.slug
        try:
            if docker.status(sandbox) != "running":
                docker.start(sandbox)
                docker.wait_healthy(sandbox)
                sandbox.status = "running"
            dispatch_kwargs: dict[str, Any] = {
                "title": f"[{run.playbook_name}] {step.stage_name}: {run.title}"[:200],
                "description": rendered[:5500],
                "priority": "high" if step.approval_required else "normal",
                "room_id": target_room_id,
                "approval_required": bool(step.approval_required),
                "source": f"playbook:{run.playbook_key}",
                "actor": actor,
            }
            try:
                res = docker.dispatch_mesh_task(
                    sandbox,
                    room_name=room_name,
                    new_topic=use_new_topic,
                    **dispatch_kwargs,
                )
            except TypeError:
                res = docker.dispatch_mesh_task(sandbox, **dispatch_kwargs)
            step.task_id = str(res.get("task_id") or res.get("message_id") or "") or None
            if res.get("room_id"):
                step.room_id = str(res["room_id"])
            elif not step.room_id:
                step.room_id = f"playbook:{run.id[:8]}"
        except Exception as exc:
            step.output_summary = f"⚠️ 自动唤醒失败: {str(exc)[:240]}"
            if not step.room_id:
                step.room_id = f"playbook:{run.id[:8]}"
    else:
        step.room_id = step.room_id or f"playbook:{run.id[:8]}"
        step.output_summary = "⚠️ 未找到可用的数字员工执行本阶段，请先创建并启动数字员工或手动介入。"


def _dispatch_next_wave(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    run: PlaybookRun,
    steps: list[PlaybookStepRun],
    sbx_by_id: dict[str, Sandbox],
    *,
    actor: str,
) -> None:
    try:
        inputs = json.loads(run.inputs_json or "{}")
    except Exception:
        inputs = {}
    try:
        uploaded_meta = json.loads(run.uploaded_files_json or "[]")
    except Exception:
        uploaded_meta = []

    while True:
        pending = [s for s in steps if s.status == "pending"]
        if not pending:
            if all(s.status in {"completed", "skipped"} for s in steps):
                run.status = "completed"
                run.completed_at = utcnow()
            elif any(s.status == "awaiting_approval" for s in steps):
                run.status = "awaiting_approval"
            elif any(s.status == "rejected" for s in steps):
                run.status = "failed"
            return

        has_dag = any(bool(s.depends_on) for s in steps)
        if has_dag:
            done_ids = {s.stage_id for s in steps if s.status in {"completed", "skipped"}}
            rejected_ids = {s.stage_id for s in steps if s.status == "rejected"}
            wave = [
                cand
                for cand in pending
                if all(dep in done_ids for dep in cand.depends_on)
                and not any(dep in rejected_ids for dep in cand.depends_on)
            ]
            if not wave:
                if any(s.status == "awaiting_approval" for s in steps):
                    run.status = "awaiting_approval"
                elif any(s.status == "running" for s in steps):
                    run.status = "running"
                elif rejected_ids:
                    run.status = "failed"
                return
        else:
            if any(s.status in {"running", "awaiting_approval"} for s in steps):
                run.status = (
                    "awaiting_approval"
                    if any(s.status == "awaiting_approval" for s in steps)
                    else "running"
                )
                return

            first = pending[0]
            wave = [first]
            if first.parallel_group:
                for cand in pending[1:]:
                    if cand.parallel_group == first.parallel_group:
                        wave.append(cand)
                    else:
                        break

        skipped_any = False
        to_dispatch: list[PlaybookStepRun] = []
        for st in wave:
            matched_skip, skip_reason = _evaluate_skip_condition(
                getattr(st, "skip_if", None), inputs, steps
            )
            if matched_skip:
                st.status = "skipped"
                st.completed_at = utcnow()
                st.output_summary = f"条件跳过 (skip_if: {skip_reason})"
                skipped_any = True
                audit(
                    db,
                    "playbook.step_skipped",
                    target=run.id,
                    actor=actor,
                    detail=f"playbook={run.playbook_key},stage={st.stage_id},condition={skip_reason}",
                )
            else:
                to_dispatch.append(st)

        if to_dispatch:
            run.current_stage_index = to_dispatch[0].stage_index
            for st in to_dispatch:
                sbx = sbx_by_id.get(st.sandbox_id) if st.sandbox_id else None
                paths = [
                    str(m.get("path"))
                    for m in uploaded_meta
                    if isinstance(m, dict)
                    and m.get("path")
                    and (not m.get("sandbox_id") or m.get("sandbox_id") == st.sandbox_id)
                ]
                _dispatch_step(
                    db,
                    settings,
                    docker,
                    run,
                    st,
                    steps,
                    sbx,
                    inputs=inputs,
                    uploaded_paths=paths,
                    actor=actor,
                )
            break
        if not skipped_any:
            break

    if all(s.status in {"completed", "skipped"} for s in steps):
        run.status = "completed"
        run.completed_at = utcnow()
    else:
        run.status = (
            "awaiting_approval"
            if any(s.status == "awaiting_approval" for s in steps)
            and not any(s.status == "running" for s in steps)
            else "running"
        )
    run.updated_at = utcnow()


def start_playbook_run(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    pb: Playbook,
    *,
    title: str,
    inputs: dict[str, Any],
    role_assignments: dict[str, str],
    accessible_sandboxes: list[Sandbox],
    team_id: str | None = None,
    execution_mode: str = "isolated",
    files: list[tuple[str, bytes]] | None = None,
    actor: str,
) -> PlaybookRun:
    sbx_by_id = {s.id: s for s in accessible_sandboxes}
    stages = pb.stages
    if not stages:
        raise ValueError("该 Playbook 未定义任何执行阶段")

    effective_mode = (
        "project_group"
        if (execution_mode or "").strip().lower() == "project_group" and team_id
        else "isolated"
    )
    if effective_mode == "project_group" and team_id:
        team_obj = db.get(Team, team_id)
        if team_obj is None:
            effective_mode = "isolated"
        else:
            if not team_obj.mesh_room_id:
                try:
                    sync_project_mesh_group(db, team_obj, docker, actor=actor)
                except Exception:
                    pass
            if not team_obj.mesh_room_id:
                effective_mode = "isolated"

    run = PlaybookRun(
        playbook_id=pb.id,
        playbook_key=pb.key,
        playbook_name=pb.name,
        team_id=team_id,
        execution_mode=effective_mode,
        title=title.strip() or pb.name,
        inputs_json=json.dumps(inputs, ensure_ascii=False),
        uploaded_files_json="[]",
        role_assignments_json=json.dumps(role_assignments, ensure_ascii=False),
        status="running",
        current_stage_index=0,
        created_by=actor,
    )
    db.add(run)
    db.flush()

    resolved_assignments: dict[str, Sandbox | None] = {}
    steps: list[PlaybookStepRun] = []
    for idx, st in enumerate(stages):
        st_id = str(st.get("id") or f"stage_{idx + 1}")
        chosen_id = str(role_assignments.get(st_id) or "").strip()
        sbx = sbx_by_id.get(chosen_id) if chosen_id else _auto_pick_sandbox_for_stage(st, accessible_sandboxes)
        resolved_assignments[st_id] = sbx
        step = PlaybookStepRun(
            run_id=run.id,
            stage_index=idx,
            stage_id=st_id,
            stage_name=str(st.get("name") or st_id),
            role_hint=str(st.get("role_hint") or "") or None,
            parallel_group=str(st.get("parallel_group") or "") or None,
            depends_on_json=json.dumps(
                [str(d).strip() for d in (st.get("depends_on") or []) if str(d).strip()],
                ensure_ascii=False,
            ),
            timeout_seconds=(
                int(st["timeout_seconds"]) if st.get("timeout_seconds") else None
            ),
            max_retries=int(st.get("max_retries") or 0),
            retry_count=0,
            on_reject_goto=(str(st.get("on_reject_goto") or "").strip() or None),
            skip_if=(str(st.get("skip_if") or "").strip() or None),
            sandbox_id=sbx.id if sbx else None,
            sandbox_slug=sbx.slug if sbx else None,
            prompt_rendered=str(st.get("prompt_template") or st.get("name") or ""),
            approval_required=bool(st.get("approval_required")),
            status="pending",
            deliverable_hint=str(st.get("deliverable_hint") or "") or None,
            artifacts_json="[]",
        )
        db.add(step)
        steps.append(step)

    # Persist intake files into DB Artifact store + write into initial assigned sandboxes
    uploaded_meta: list[dict[str, Any]] = []
    if files:
        _capture_uploaded_artifacts(db, run, files)
        seen_sbx_ids: set[str] = set()
        for sbx in resolved_assignments.values():
            if sbx is None or sbx.id in seen_sbx_ids:
                continue
            seen_sbx_ids.add(sbx.id)
            try:
                if docker.status(sbx) != "running":
                    docker.start(sbx)
                    docker.wait_healthy(sandbox=sbx) if False else docker.wait_healthy(sbx)
                    sbx.status = "running"
                paths = docker.write_intake_files(sbx, f"pb-{run.id[:8]}", files)
                for p in paths:
                    uploaded_meta.append({"sandbox_id": sbx.id, "slug": sbx.slug, "path": p})
            except Exception:
                pass
    run.uploaded_files_json = json.dumps(uploaded_meta, ensure_ascii=False)
    run.role_assignments_json = json.dumps(
        {k: v.id for k, v in resolved_assignments.items() if v is not None},
        ensure_ascii=False,
    )
    db.flush()

    _dispatch_next_wave(db, settings, docker, run, steps, sbx_by_id, actor=actor)
    audit(
        db,
        "playbook.run_start",
        target=run.id,
        actor=actor,
        detail=f"playbook={pb.key},title={run.title[:60]},stages={len(steps)}",
    )
    db.commit()
    db.refresh(run)
    return run


def sync_playbook_run_progress(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    run: PlaybookRun,
    *,
    check_runtime: bool = True,
) -> bool:
    """Reconcile running Playbook steps against runtime/snapshots with distributed run-level locking."""
    if run.status in {"completed", "failed", "cancelled"}:
        return False
    if check_runtime:
        with cluster_lock(f"playbook_run:{run.id}", ttl_seconds=25.0, wait_seconds=5.0):
            db.refresh(run)
            if run.status in {"completed", "failed", "cancelled"}:
                return False
            return _sync_playbook_run_progress_unlocked(
                db, settings, docker, run, check_runtime=check_runtime
            )
    return _sync_playbook_run_progress_unlocked(
        db, settings, docker, run, check_runtime=check_runtime
    )


def _sync_playbook_run_progress_unlocked(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    run: PlaybookRun,
    *,
    check_runtime: bool = True,
) -> bool:
    if run.status in {"completed", "failed", "cancelled"}:
        return False

    steps = list(
        db.scalars(
            select(PlaybookStepRun)
            .where(PlaybookStepRun.run_id == run.id)
            .order_by(PlaybookStepRun.stage_index.asc())
        ).all()
    )
    if not steps:
        return False

    sbx_ids = list({s.sandbox_id for s in steps if s.sandbox_id})
    snaps = (
        {
            r.sandbox_id: r
            for r in db.scalars(
                select(SandboxRuntimeSnapshot).where(
                    SandboxRuntimeSnapshot.sandbox_id.in_(sbx_ids)
                )
            ).all()
        }
        if sbx_ids
        else {}
    )
    sbx_by_id = (
        {
            s.id: s
            for s in db.scalars(
                select(Sandbox).where(Sandbox.id.in_(sbx_ids), Sandbox.deleted_at.is_(None))
            ).all()
        }
        if sbx_ids
        else {}
    )

    try:
        run_inputs = json.loads(run.inputs_json or "{}")
    except Exception:
        run_inputs = {}
    try:
        uploaded_meta = json.loads(run.uploaded_files_json or "[]")
    except Exception:
        uploaded_meta = []

    now = utcnow()
    changed = False
    for step in steps:
        if step.status not in {"running", "awaiting_approval"} or not step.sandbox_id:
            continue

        # 1. Preferred: inspect live @metis/sandbox-mesh room replies for running steps
        sbx = sbx_by_id.get(step.sandbox_id)
        if (
            check_runtime
            and step.status == "running"
            and sbx is not None
            and step.room_id
            and hasattr(docker, "inspect_mesh_room_progress")
        ):
            try:
                prog = docker.inspect_mesh_room_progress(
                    sbx,
                    step.room_id,
                    since_message_id=step.task_id or "",
                )
            except Exception:
                prog = None
            if isinstance(prog, dict) and prog.get("ok"):
                if prog.get("completed"):
                    reply_text = str(prog.get("reply_text") or "").strip()
                    if reply_text:
                        step.output_summary = reply_text[:4000]
                    prog_arts = [
                        str(a).strip() for a in (prog.get("artifacts") or []) if str(a).strip()
                    ]
                    if prog_arts:
                        try:
                            existing_arts = json.loads(step.artifacts_json or "[]")
                        except Exception:
                            existing_arts = []
                        merged_arts = list(dict.fromkeys([*existing_arts, *prog_arts]))
                        step.artifacts_json = json.dumps(merged_arts, ensure_ascii=False)
                        _capture_step_artifacts(db, docker, run, step, sbx, prog_arts)
                    if step.approval_required:
                        step.status = "awaiting_approval"
                        step.approval_status = "pending"
                        _notify_step_awaiting_approval(db, settings, run, step)
                    else:
                        step.status = "completed"
                        step.completed_at = step.completed_at or now
                    changed = True
                    continue
                if prog.get("failed") and prog.get("error_text"):
                    err_txt = str(prog["error_text"]).strip()[:2000]
                    if step.output_summary != err_txt:
                        step.output_summary = err_txt
                        changed = True
                    continue

        # 2. Fallback: reconcile legacy task records in SandboxRuntimeSnapshot
        resolved_from_snapshot = False
        if step.task_id:
            snap = snaps.get(step.sandbox_id)
            if snap:
                try:
                    payload = json.loads(snap.payload_json or "{}")
                except Exception:
                    payload = None
                mesh = payload.get("mesh_summary") if isinstance(payload, dict) else {}
                tasks = mesh.get("tasks") if isinstance(mesh, dict) else []
                matched = next(
                    (
                        t
                        for t in (tasks or [])
                        if isinstance(t, dict) and str(t.get("id") or "") == step.task_id
                    ),
                    None,
                )
                if matched:
                    t_status = str(matched.get("status") or "").lower()
                    t_appr = str(matched.get("approval_status") or "").lower()
                    t_summary = str(matched.get("summary") or matched.get("description") or "").strip()
                    t_arts = [str(a) for a in (matched.get("artifacts") or []) if str(a).strip()]
                    if t_summary and not step.output_summary:
                        step.output_summary = t_summary[:2000]
                        changed = True
                    if t_arts:
                        step.artifacts_json = json.dumps(t_arts, ensure_ascii=False)
                        changed = True
                    if t_status in {"done", "in_review"}:
                        resolved_from_snapshot = True
                        if step.approval_required and t_appr != "approved":
                            if step.status == "running":
                                step.status = "awaiting_approval"
                                step.approval_status = "pending"
                                _notify_step_awaiting_approval(db, settings, run, step)
                                changed = True
                        else:
                            step.status = "completed"
                            step.completed_at = step.completed_at or now
                            if step.approval_required:
                                step.approval_status = "approved"
                            changed = True
                    elif t_appr == "rejected":
                        resolved_from_snapshot = True
                        step.status = "rejected"
                        step.approval_status = "rejected"
                        step.completed_at = step.completed_at or now
                        changed = True

        # 3. Enforce stage SLA timeout & bounded auto-retry when step is still running
        if (
            not resolved_from_snapshot
            and step.status == "running"
            and getattr(step, "timeout_seconds", None)
            and step.started_at is not None
        ):
            elapsed_sec = (now - step.started_at).total_seconds()
            if elapsed_sec >= int(step.timeout_seconds):
                cur_retries = int(getattr(step, "retry_count", 0) or 0)
                max_retries = int(getattr(step, "max_retries", 0) or 0)
                if cur_retries < max_retries and sbx is not None:
                    step.retry_count = cur_retries + 1
                    pb_obj = db.get(Playbook, run.playbook_id)
                    if pb_obj is not None:
                        orig_stage = next(
                            (s for s in pb_obj.stages if s.get("id") == step.stage_id), None
                        )
                        if orig_stage and orig_stage.get("prompt_template"):
                            step.prompt_rendered = str(orig_stage["prompt_template"])
                    step.prompt_rendered = (
                        f"{step.prompt_rendered or step.stage_name}\n\n"
                        f"### SLA 超时自动重试（第 {step.retry_count}/{max_retries} 次）\n"
                        f"上次派发已超过 {int(step.timeout_seconds)} 秒未回传终态结论，请立即收敛并输出完整交付结果。"
                    )
                    paths = [
                        str(m.get("path"))
                        for m in uploaded_meta
                        if isinstance(m, dict)
                        and m.get("path")
                        and (not m.get("sandbox_id") or m.get("sandbox_id") == sbx.id)
                    ]
                    _dispatch_step(
                        db,
                        settings,
                        docker,
                        run,
                        step,
                        steps,
                        sbx,
                        inputs=run_inputs if isinstance(run_inputs, dict) else {},
                        uploaded_paths=paths,
                        actor="system:sla",
                    )
                    audit(
                        db,
                        "playbook.step_auto_retry",
                        target=run.id,
                        actor="system:sla",
                        detail=f"playbook={run.playbook_key},stage={step.stage_id},retry={step.retry_count}/{max_retries}",
                    )
                    changed = True
                elif step.sla_warned_at is None:
                    step.sla_warned_at = now
                    _notify_step_sla_timeout(db, settings, run, step)
                    audit(
                        db,
                        "playbook.step_sla_timeout",
                        target=run.id,
                        actor="system:sla",
                        detail=f"playbook={run.playbook_key},stage={step.stage_id},timeout={step.timeout_seconds}s",
                    )
                    changed = True

    if changed:
        _dispatch_next_wave(db, settings, docker, run, steps, sbx_by_id, actor=run.created_by)
        db.commit()
    return changed


def decide_playbook_step(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    run: PlaybookRun,
    step: PlaybookStepRun,
    *,
    decision: str,
    note: str = "",
    output_summary: str | None = None,
    artifacts: list[str] | None = None,
    actor: str,
) -> PlaybookRun:
    with cluster_lock(f"playbook_run:{run.id}", ttl_seconds=25.0, wait_seconds=5.0):
        db.refresh(run)
        db.refresh(step)
        return _decide_playbook_step_unlocked(
            db,
            settings,
            docker,
            run,
            step,
            decision=decision,
            note=note,
            output_summary=output_summary,
            artifacts=artifacts,
            actor=actor,
        )


def _decide_playbook_step_unlocked(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    run: PlaybookRun,
    step: PlaybookStepRun,
    *,
    decision: str,
    note: str = "",
    output_summary: str | None = None,
    artifacts: list[str] | None = None,
    actor: str,
) -> PlaybookRun:
    steps = list(
        db.scalars(
            select(PlaybookStepRun)
            .where(PlaybookStepRun.run_id == run.id)
            .order_by(PlaybookStepRun.stage_index.asc())
        ).all()
    )
    sbx_ids = list({s.sandbox_id for s in steps if s.sandbox_id})
    sbx_by_id = (
        {
            s.id: s
            for s in db.scalars(
                select(Sandbox).where(Sandbox.id.in_(sbx_ids), Sandbox.deleted_at.is_(None))
            ).all()
        }
        if sbx_ids
        else {}
    )

    clean_note = note.strip()

    # Revision loop: send human feedback into the SAME mesh room to re-wake the digital employee!
    if decision == "revise":
        revision_prompt = clean_note or "请结合审核意见重新完善并补充本阶段的交付内容。"
        sbx = sbx_by_id.get(step.sandbox_id) if step.sandbox_id else None
        step.approval_status = "revision_requested"
        step.approval_note = revision_prompt
        step.approval_decided_by = actor
        step.status = "running"
        step.started_at = utcnow()
        step.sla_warned_at = None
        step.completed_at = None
        if sbx is not None:
            try:
                if docker.status(sbx) != "running":
                    docker.start(sbx)
                    docker.wait_healthy(sbx)
                    sbx.status = "running"
                rev_kwargs: dict[str, Any] = {
                    "title": f"[打回修改] {step.stage_name}: {run.title}"[:200],
                    "description": (
                        f"人工审核人（{actor}）已将本阶段打回修改，请严格按以下反馈修订并重新回复完整产出：\n\n"
                        f"{revision_prompt}"
                    ),
                    "priority": "high",
                    "room_id": step.room_id or "",
                    "approval_required": bool(step.approval_required),
                    "source": f"playbook:{run.playbook_key}",
                    "actor": actor,
                }
                try:
                    res = docker.dispatch_mesh_task(
                        sbx,
                        room_name=f"Playbook: {run.title}"[:72],
                        new_topic=False,
                        **rev_kwargs,
                    )
                except TypeError:
                    res = docker.dispatch_mesh_task(sbx, **rev_kwargs)
                if res.get("task_id") or res.get("message_id"):
                    step.task_id = str(res.get("task_id") or res.get("message_id"))
                if res.get("room_id"):
                    step.room_id = str(res["room_id"])
            except Exception as exc:
                step.output_summary = f"⚠️ 重新唤醒失败: {str(exc)[:240]}"
        run.status = "running"
        run.updated_at = utcnow()
        audit(
            db,
            "playbook.step_revise",
            target=run.id,
            actor=actor,
            detail=f"playbook={run.playbook_key},stage={step.stage_id},status={run.status}",
        )
        db.commit()
        db.refresh(run)
        return run

    # Best-effort sync approval/rejection note back to sandbox mesh room if linked
    if step.sandbox_id and step.task_id and step.sandbox_id in sbx_by_id and step.approval_required:
        try:
            docker.decide_mesh_approval(
                sbx_by_id[step.sandbox_id],
                step.task_id,
                decision=decision,
                note=clean_note,
                room_id=step.room_id,
                actor=actor,
            )
        except Exception:
            pass

    step.approval_status = decision
    step.approval_note = clean_note or None
    step.approval_decided_by = actor
    if output_summary is not None and output_summary.strip():
        step.output_summary = output_summary.strip()
    if artifacts is not None:
        step.artifacts_json = json.dumps(
            [a.strip() for a in artifacts if a.strip()], ensure_ascii=False
        )
    step.completed_at = utcnow()

    if decision == "approved":
        step.status = "completed"
        try:
            step_arts = json.loads(step.artifacts_json or "[]")
        except Exception:
            step_arts = []
        _capture_step_artifacts(
            db,
            docker,
            run,
            step,
            sbx_by_id.get(step.sandbox_id) if step.sandbox_id else None,
            [str(a) for a in step_arts],
        )
        _dispatch_next_wave(db, settings, docker, run, steps, sbx_by_id, actor=actor)
    else:
        # Conditional rework routing when stage configures `on_reject_goto` (bounded loop guard <= 3)
        goto_id = (getattr(step, "on_reject_goto", None) or "").strip()
        goto_step = (
            next((s for s in steps if s.stage_id == goto_id and s.id != step.id), None)
            if goto_id
            else None
        )
        rework_limit = max(3, int(getattr(step, "max_retries", 0) or 0) + 1)
        if goto_step is not None and int(step.retry_count or 0) < rework_limit:
            step.retry_count = int(step.retry_count or 0) + 1
            pb_obj = db.get(Playbook, run.playbook_id)
            stages_cfg = pb_obj.stages if pb_obj is not None else []
            # Reset target stage & dependent downstream stages back to pending cleanly
            reset_ids = {goto_step.stage_id, step.stage_id}
            # In sequential or DAG mode, reset stages reachable between goto_step and step
            for st in steps:
                if goto_step.stage_index <= st.stage_index <= step.stage_index:
                    if st.stage_id == goto_step.stage_id or st.stage_id == step.stage_id or not st.depends_on or any(d in reset_ids for d in st.depends_on):
                        reset_ids.add(st.stage_id)
            for st in steps:
                if st.stage_id in reset_ids:
                    st.status = "pending"
                    st.approval_status = None
                    st.completed_at = None
                    st.sla_warned_at = None
                    if orig := next((c for c in stages_cfg if c.get("id") == st.stage_id), None):
                        if orig.get("prompt_template"):
                            st.prompt_rendered = str(orig["prompt_template"])
            feedback_line = clean_note or "评审未通过，请针对评审意见修正并重新交付。"
            goto_step.retry_count = int(goto_step.retry_count or 0) + 1
            goto_step.prompt_rendered = (
                f"{goto_step.prompt_rendered or goto_step.stage_name}\n\n"
                f"### 驳回返工指令（来自阶段「{step.stage_name}」· 审核人 {actor} · 第 {step.retry_count} 次返工）\n"
                f"{feedback_line}"
            )
            _dispatch_next_wave(db, settings, docker, run, steps, sbx_by_id, actor=actor)
            audit(
                db,
                "playbook.step_rework",
                target=run.id,
                actor=actor,
                detail=f"playbook={run.playbook_key},from={step.stage_id},goto={goto_step.stage_id},loop={step.retry_count}",
            )
            db.commit()
            db.refresh(run)
            return run

        step.status = "rejected"
        run.status = "failed"
        run.updated_at = utcnow()

    audit(
        db,
        f"playbook.step_{decision}",
        target=run.id,
        actor=actor,
        detail=f"playbook={run.playbook_key},stage={step.stage_id},status={run.status}",
    )
    db.commit()
    db.refresh(run)
    return run


def cancel_playbook_run(
    db: Session,
    run: PlaybookRun,
    *,
    note: str = "",
    actor: str,
) -> PlaybookRun:
    """Cancel an in-flight Playbook run cleanly without deleting historical stage outputs."""
    if run.status in {"completed", "cancelled"}:
        return run
    steps = list(
        db.scalars(
            select(PlaybookStepRun)
            .where(PlaybookStepRun.run_id == run.id)
            .order_by(PlaybookStepRun.stage_index.asc())
        ).all()
    )
    now = utcnow()
    clean_note = note.strip() or "人工手动终止运行"
    for st in steps:
        if st.status in {"pending", "running", "awaiting_approval"}:
            st.status = "skipped"
            st.approval_note = clean_note
            st.approval_decided_by = actor
            st.completed_at = now
    run.status = "cancelled"
    run.completed_at = now
    run.updated_at = now
    audit(
        db,
        "playbook.run_cancel",
        target=run.id,
        actor=actor,
        detail=f"playbook={run.playbook_key},title={run.title[:60]}",
    )
    db.commit()
    db.refresh(run)
    return run


def retry_playbook_step(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    run: PlaybookRun,
    step: PlaybookStepRun,
    *,
    sandbox_id: str | None = None,
    note: str = "",
    accessible_sandboxes: list[Sandbox],
    actor: str,
) -> PlaybookRun:
    """Retry a Playbook stage (optionally reassigning to another accessible digital employee)."""
    steps = list(
        db.scalars(
            select(PlaybookStepRun)
            .where(PlaybookStepRun.run_id == run.id)
            .order_by(PlaybookStepRun.stage_index.asc())
        ).all()
    )
    sbx_by_id = {s.id: s for s in accessible_sandboxes}
    target_sbx: Sandbox | None = None
    if sandbox_id and sandbox_id.strip():
        target_sbx = sbx_by_id.get(sandbox_id.strip())
        if target_sbx is None:
            raise ManagerError("指定的数字员工不存在或无权指派")
        step.sandbox_id = target_sbx.id
        step.sandbox_slug = target_sbx.slug
        try:
            ra = json.loads(run.role_assignments_json or "{}")
            if not isinstance(ra, dict):
                ra = {}
        except Exception:
            ra = {}
        ra[step.stage_id] = target_sbx.id
        run.role_assignments_json = json.dumps(ra, ensure_ascii=False)
    elif step.sandbox_id:
        target_sbx = sbx_by_id.get(step.sandbox_id) or db.get(Sandbox, step.sandbox_id)

    try:
        inputs = json.loads(run.inputs_json or "{}")
    except Exception:
        inputs = {}
    try:
        uploaded_meta = json.loads(run.uploaded_files_json or "[]")
    except Exception:
        uploaded_meta = []
    paths = [
        str(m.get("path"))
        for m in uploaded_meta
        if isinstance(m, dict)
        and m.get("path")
        and (not m.get("sandbox_id") or m.get("sandbox_id") == (target_sbx.id if target_sbx else None))
    ]

    # Recover original template from playbook definition when available so prompt doesn't duplicate headers
    pb = db.get(Playbook, run.playbook_id)
    if pb is not None:
        orig_stage = next((s for s in pb.stages if s.get("id") == step.stage_id), None)
        if orig_stage and orig_stage.get("prompt_template"):
            step.prompt_rendered = str(orig_stage["prompt_template"])
    clean_note = note.strip()
    if clean_note:
        step.prompt_rendered = (
            f"{step.prompt_rendered or step.stage_name}\n\n### 重试补充要求（由 {actor} 指定）\n{clean_note}"
        )

    step.completed_at = None
    step.approval_note = clean_note or None
    _dispatch_step(
        db,
        settings,
        docker,
        run,
        step,
        steps,
        target_sbx,
        inputs=inputs if isinstance(inputs, dict) else {},
        uploaded_paths=paths,
        actor=actor,
    )
    run.status = "running"
    run.completed_at = None
    run.current_stage_index = step.stage_index
    run.updated_at = utcnow()
    audit(
        db,
        "playbook.step_retry",
        target=run.id,
        actor=actor,
        detail=f"playbook={run.playbook_key},stage={step.stage_id},slug={step.sandbox_slug or ''}",
    )
    db.commit()
    db.refresh(run)
    return run


def skip_playbook_step(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    run: PlaybookRun,
    step: PlaybookStepRun,
    *,
    note: str = "",
    actor: str,
) -> PlaybookRun:
    """Skip a stage and immediately dispatch the next wave."""
    steps = list(
        db.scalars(
            select(PlaybookStepRun)
            .where(PlaybookStepRun.run_id == run.id)
            .order_by(PlaybookStepRun.stage_index.asc())
        ).all()
    )
    sbx_ids = list({s.sandbox_id for s in steps if s.sandbox_id})
    sbx_by_id = (
        {
            s.id: s
            for s in db.scalars(
                select(Sandbox).where(Sandbox.id.in_(sbx_ids), Sandbox.deleted_at.is_(None))
            ).all()
        }
        if sbx_ids
        else {}
    )
    step.status = "skipped"
    step.approval_note = note.strip() or "人工跳过本阶段"
    step.approval_decided_by = actor
    step.completed_at = utcnow()
    _dispatch_next_wave(db, settings, docker, run, steps, sbx_by_id, actor=actor)
    run.updated_at = utcnow()
    audit(
        db,
        "playbook.step_skip",
        target=run.id,
        actor=actor,
        detail=f"playbook={run.playbook_key},stage={step.stage_id},status={run.status}",
    )
    db.commit()
    db.refresh(run)
    return run


def _strip_reasoning_and_extract_json(raw_text: str) -> dict[str, Any]:
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_text or "", flags=re.IGNORECASE).strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, flags=re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    if first_brace >= 0 and last_brace > first_brace:
        parsed = json.loads(cleaned[first_brace : last_brace + 1])
        if isinstance(parsed, dict):
            return parsed
    raise ManagerError("模型未返回合法的 JSON 结构，请重试或换一个描述")


def _call_llm_for_playbook_json(
    profile: LlmProfile,
    system_prompt: str,
    user_prompt: str,
) -> dict[str, Any]:
    raw_key = ""
    if profile.api_key_ciphertext:
        try:
            raw_key = decrypt_secret(profile.api_key_ciphertext)
        except ValueError:
            raw_key = ""
    base = (profile.base_url or "").strip().rstrip("/")
    if not base:
        raise ManagerError(f"模型配置「{profile.name}」缺少 Base URL")
    proto = (profile.api_protocol or "openai-completions").strip().lower()

    with httpx.Client(timeout=90.0) as client:
        if proto == "anthropic":
            url = f"{base}/v1/messages" if not base.endswith("/v1") else f"{base}/messages"
            headers = {
                "content-type": "application/json",
                "anthropic-version": "2023-06-01",
            }
            if raw_key:
                headers["x-api-key"] = raw_key
            resp = client.post(
                url,
                headers=headers,
                json={
                    "model": profile.model,
                    "max_tokens": 3000,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_prompt}],
                },
            )
            if resp.status_code >= 400:
                raise ManagerError(f"调用模型失败 (HTTP {resp.status_code}): {resp.text[:240]}")
            data = resp.json()
            text = "".join(
                str(b.get("text") or "")
                for b in (data.get("content") or [])
                if isinstance(b, dict) and b.get("type") == "text"
            )
            return _strip_reasoning_and_extract_json(text)

        if proto == "google-gemini":
            url = f"{base}/models/{profile.model}:generateContent"
            params = {"key": raw_key} if raw_key else {}
            resp = client.post(
                url,
                params=params,
                headers={"content-type": "application/json"},
                json={
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                    "generationConfig": {"temperature": 0.3, "maxOutputTokens": 3000},
                },
            )
            if resp.status_code >= 400:
                raise ManagerError(f"调用模型失败 (HTTP {resp.status_code}): {resp.text[:240]}")
            data = resp.json()
            cands = data.get("candidates") or []
            parts = ((cands[0].get("content") or {}).get("parts") or []) if cands else []
            text = "".join(str(p.get("text") or "") for p in parts if isinstance(p, dict))
            return _strip_reasoning_and_extract_json(text)

        # OpenAI-compatible (chat/completions or responses)
        headers = {"content-type": "application/json"}
        if raw_key:
            headers["authorization"] = f"Bearer {raw_key}"
        url = (
            f"{base}/chat/completions"
            if not base.endswith("/chat/completions")
            else base
        )
        resp = client.post(
            url,
            headers=headers,
            json={
                "model": profile.model,
                "temperature": 0.3,
                "max_tokens": 3000,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
        )
        if resp.status_code >= 400:
            raise ManagerError(f"调用模型失败 (HTTP {resp.status_code}): {resp.text[:240]}")
        data = resp.json()
        choices = data.get("choices") or []
        msg = (choices[0].get("message") or {}) if choices else {}
        text = str(msg.get("content") or "")
        return _strip_reasoning_and_extract_json(text)


def generate_playbook_draft_with_llm(
    db: Session,
    *,
    goal: str,
    category: str | None = None,
    stage_count: int | None = None,
    llm_profile_id: str | None = None,
) -> dict[str, Any]:
    """Generate a structured, editable Playbook draft from a plain-language goal using the configured LLM."""
    profile: LlmProfile | None = None
    if llm_profile_id and llm_profile_id.strip():
        profile = db.get(LlmProfile, llm_profile_id.strip())
    if profile is None:
        # Prefer a profile actively bound to templates, else the latest configured profile
        bound_id = db.scalar(
            select(SandboxTemplate.default_llm_profile_id)
            .where(SandboxTemplate.default_llm_profile_id.is_not(None))
            .limit(1)
        )
        if bound_id:
            profile = db.get(LlmProfile, bound_id)
    if profile is None:
        profile = db.scalar(select(LlmProfile).order_by(LlmProfile.created_at.desc()).limit(1))
    if profile is None:
        raise ManagerError("尚未配置 LLM 模型，请先在「模型与凭据」中配置至少一个可用模型")

    templates = list(db.scalars(select(SandboxTemplate).order_by(SandboxTemplate.name.asc())).all())
    tpl_hints = "\n".join(
        f"- key={t.key} | role={t.role_title or t.name}" for t in templates[:15]
    ) or "- key=fullstack | role=全栈研发工程师\n- key=qa | role=测试与质量保障专家\n- key=data | role=数据分析师"

    stage_hint = f"建议设计 {stage_count} 个阶段。" if stage_count else "建议设计 2 到 4 个高内聚的大阶段（宏观里程碑 + 必要的人工审批门禁，不要把开发和对应的测试放进同一个 parallel_group）。"
    cat_hint = f"分类优先使用 \"{category}\"。" if category else "category 只能是 engineering / analytics / legal / operations / custom 之一。"

    system_prompt = (
        "你是 Metis 企业数字员工协作平台的流程架构师。请根据用户的一句话业务目标，输出一个严格合法的 JSON 对象（不要任何 Markdown 说明或额外文字）。\n"
        "JSON Schema 如下：\n"
        "{\n"
        '  "key": "lowercase-kebab-case-slug",\n'
        '  "name": "简短中文流程名称",\n'
        '  "category": "engineering|analytics|legal|operations|custom",\n'
        '  "description": "1-2句清晰说明该流程的价值和适用场景",\n'
        '  "estimated_manual_hours": 4.0,\n'
        '  "input_fields": [\n'
        '    {"key": "snake_case_key", "label": "字段中文名", "type": "text|textarea|select|file", "required": true, "placeholder": "示例", "options": []}\n'
        "  ],\n"
        '  "stages": [\n'
        '    {"id": "snake_case_id", "name": "阶段名称", "role_hint": "适合岗位", "template_key_hint": "从可用模板选择", "parallel_group": null, "depends_on": [], "timeout_seconds": null, "max_retries": 0, "on_reject_goto": null, "approval_required": false, "prompt_template": "清晰的阶段指令，使用 {{变量键}}、{{previous_outputs}} 与 {{stage.前置id.output}}", "deliverable_hint": "预期交付物"}\n'
        "  ],\n"
        '  "deliverables_checklist": ["最终交付物1", "最终交付物2"]\n'
        "}\n"
        f"平台现有可用岗位模板：\n{tpl_hints}\n"
        "规则：\n"
        "1. 关键里程碑或对外发布/定稿节点建议设 approval_required=true；\n"
        "2. 仅当两个阶段真正无先后依赖时才设相同的 parallel_group 或并行 depends_on（例如两分支均 depends_on=[\"prd\"]），汇总验收阶段 depends_on=[\"branch_a\",\"branch_b\"]；\n"
        "3. 如需人工拒绝后自动退回上游返工，可设 on_reject_goto 为上游 stage id；\n"
        "4. 每个后续阶段的 prompt_template 应引用 {{previous_outputs}} 或 {{stage.<id>.output}} 与相关输入变量。"
    )
    user_prompt = f"用户目标：{goal.strip()}\n{cat_hint}\n{stage_hint}\n请直接输出 JSON："

    raw = _call_llm_for_playbook_json(profile, system_prompt, user_prompt)

    # Normalize & sanitize LLM JSON into guaranteed-valid PlaybookCreate shape
    valid_cats = {"engineering", "analytics", "legal", "operations", "custom"}
    chosen_cat = str(raw.get("category") or category or "custom").strip().lower()
    if chosen_cat not in valid_cats:
        chosen_cat = category if category in valid_cats else "custom"

    name = str(raw.get("name") or goal.strip()[:40]).strip()[:120] or "自定义协作流"
    raw_key = _slugify_playbook_key(str(raw.get("key") or ""), name)
    try:
        est_hours = max(0.5, min(200.0, float(raw.get("estimated_manual_hours") or 4.0)))
    except Exception:
        est_hours = 4.0

    norm_fields: list[dict[str, Any]] = []
    seen_fkeys: set[str] = set()
    for idx, f in enumerate(raw.get("input_fields") or []):
        if not isinstance(f, dict):
            continue
        fk = re.sub(r"[^a-z0-9_]+", "_", str(f.get("key") or f"field_{idx + 1}").strip().lower()).strip("_")[:48]
        if not fk or fk in seen_fkeys:
            fk = f"field_{idx + 1}"
        seen_fkeys.add(fk)
        ft = str(f.get("type") or "text").strip().lower()
        if ft not in {"text", "textarea", "select", "file"}:
            ft = "text"
        opts: list[str] = []
        for o in (f.get("options") or []):
            if isinstance(o, dict):
                val = str(o.get("label") or o.get("name") or o.get("value") or "").strip()
            else:
                val = str(o).strip()
            if val and val not in opts:
                opts.append(val)
        if ft == "select" and not opts:
            ft = "text"
        norm_fields.append(
            {
                "key": fk,
                "label": str(f.get("label") or fk).strip()[:120],
                "type": ft,
                "required": bool(f.get("required", idx == 0)),
                "placeholder": str(f.get("placeholder") or "").strip()[:200],
                "options": opts[:12],
            }
        )

    norm_stages: list[dict[str, Any]] = []
    seen_sids: set[str] = set()
    for idx, s in enumerate((raw.get("stages") or [])[:12]):
        if not isinstance(s, dict):
            continue
        sid = re.sub(r"[^a-z0-9_]+", "_", str(s.get("id") or f"stage_{idx + 1}").strip().lower()).strip("_")[:48]
        if not sid or sid in seen_sids:
            sid = f"stage_{idx + 1}"
        seen_sids.add(sid)
        sname = str(s.get("name") or f"阶段 {idx + 1}").strip()[:120]
        pt = str(s.get("prompt_template") or sname).strip()[:5800] or sname
        pg = str(s.get("parallel_group") or "").strip()[:48] or None
        raw_deps = s.get("depends_on") if isinstance(s.get("depends_on"), list) else []
        norm_deps = [
            re.sub(r"[^a-z0-9_]+", "_", str(d).strip().lower()).strip("_")[:48]
            for d in raw_deps
            if str(d).strip()
        ]
        try:
            t_sec = int(s["timeout_seconds"]) if s.get("timeout_seconds") else None
            if t_sec is not None:
                t_sec = max(10, min(86400 * 7, t_sec))
        except Exception:
            t_sec = None
        try:
            m_ret = max(0, min(5, int(s.get("max_retries") or 0)))
        except Exception:
            m_ret = 0
        goto_raw = re.sub(
            r"[^a-z0-9_]+", "_", str(s.get("on_reject_goto") or "").strip().lower()
        ).strip("_")[:48] or None
        norm_stages.append(
            {
                "id": sid,
                "name": sname,
                "role_hint": str(s.get("role_hint") or "").strip()[:120],
                "template_key_hint": str(s.get("template_key_hint") or "").strip()[:64],
                "parallel_group": pg,
                "depends_on": norm_deps,
                "timeout_seconds": t_sec,
                "max_retries": m_ret,
                "on_reject_goto": goto_raw,
                "approval_required": bool(s.get("approval_required", False)),
                "prompt_template": pt,
                "deliverable_hint": str(s.get("deliverable_hint") or "").strip()[:240],
            }
        )
    if not norm_stages:
        norm_stages.append(
            {
                "id": "execute",
                "name": "执行与交付",
                "role_hint": "数字员工",
                "template_key_hint": "",
                "parallel_group": None,
                "approval_required": True,
                "prompt_template": f"请完成以下目标并汇报交付成果：{goal.strip()}",
                "deliverable_hint": "结构化交付结论与产物链接",
            }
        )

    checklist = [
        str(x).strip()[:200]
        for x in (raw.get("deliverables_checklist") or [])
        if str(x).strip()
    ][:12]

    validated = PlaybookCreate(
        key=raw_key,
        name=name,
        category=chosen_cat,  # type: ignore[arg-type]
        description=str(raw.get("description") or "").strip()[:580] or None,
        enabled=True,
        estimated_manual_hours=est_hours,
        input_fields=norm_fields,  # type: ignore[arg-type]
        stages=norm_stages,  # type: ignore[arg-type]
        deliverables_checklist=checklist,
    )
    return {
        "draft": validated.model_dump(),
        "model": profile.model,
        "profile_name": profile.name,
    }


def serialize_playbook_run(db: Session, run: PlaybookRun) -> dict[str, Any]:
    steps = list(
        db.scalars(
            select(PlaybookStepRun)
            .where(PlaybookStepRun.run_id == run.id)
            .order_by(PlaybookStepRun.stage_index.asc())
        ).all()
    )
    try:
        inputs = json.loads(run.inputs_json or "{}")
    except Exception:
        inputs = {}
    try:
        uploaded = json.loads(run.uploaded_files_json or "[]")
    except Exception:
        uploaded = []
    try:
        role_assignments = json.loads(run.role_assignments_json or "{}")
        if not isinstance(role_assignments, dict):
            role_assignments = {}
    except Exception:
        role_assignments = {}

    serialized_steps = []
    all_artifacts: list[dict[str, str]] = []
    for st in steps:
        try:
            arts = json.loads(st.artifacts_json or "[]")
        except Exception:
            arts = []
        for a in arts:
            all_artifacts.append({"stage_name": st.stage_name, "value": str(a)})
        serialized_steps.append(
            {
                "id": st.id,
                "stage_index": st.stage_index,
                "stage_id": st.stage_id,
                "stage_name": st.stage_name,
                "role_hint": st.role_hint,
                "parallel_group": st.parallel_group,
                "depends_on": st.depends_on,
                "timeout_seconds": getattr(st, "timeout_seconds", None),
                "max_retries": int(getattr(st, "max_retries", 0) or 0),
                "retry_count": int(getattr(st, "retry_count", 0) or 0),
                "sla_warned_at": st.sla_warned_at.isoformat() if getattr(st, "sla_warned_at", None) else None,
                "on_reject_goto": getattr(st, "on_reject_goto", None),
                "skip_if": getattr(st, "skip_if", None),
                "sandbox_id": st.sandbox_id,
                "sandbox_slug": st.sandbox_slug,
                "room_id": st.room_id,
                "task_id": st.task_id,
                "approval_required": bool(st.approval_required),
                "approval_status": st.approval_status,
                "approval_note": st.approval_note,
                "approval_decided_by": st.approval_decided_by,
                "status": st.status,
                "deliverable_hint": st.deliverable_hint,
                "output_summary": st.output_summary,
                "artifacts": arts,
                "started_at": st.started_at.isoformat() if st.started_at else None,
                "completed_at": st.completed_at.isoformat() if st.completed_at else None,
            }
        )

    relayed_rows = list(
        db.scalars(
            select(PlaybookArtifact)
            .where(PlaybookArtifact.run_id == run.id)
            .order_by(PlaybookArtifact.created_at.asc())
        ).all()
    )
    relayed_list = [
        {
            "id": a.id,
            "step_id": a.step_id,
            "stage_id": a.stage_id,
            "source_sandbox_slug": a.source_sandbox_slug,
            "source_path": a.source_path,
            "file_name": a.file_name,
            "content_type": a.content_type,
            "size_bytes": int(a.size_bytes or 0),
            "sha256": a.sha256,
            "download_url": f"/api/playbook-runs/{run.id}/artifacts/{a.id}",
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in relayed_rows
    ]

    done_count = sum(1 for s in steps if s.status in {"completed", "skipped"})
    return {
        "id": run.id,
        "playbook_id": run.playbook_id,
        "playbook_key": run.playbook_key,
        "playbook_name": run.playbook_name,
        "team_id": run.team_id,
        "execution_mode": getattr(run, "execution_mode", "isolated") or "isolated",
        "title": run.title,
        "inputs": inputs,
        "role_assignments": role_assignments,
        "uploaded_files": uploaded,
        "status": run.status,
        "current_stage_index": run.current_stage_index,
        "progress_done": done_count,
        "progress_total": len(steps),
        "created_by": run.created_by,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "steps": serialized_steps,
        "artifacts": all_artifacts,
        "relayed_artifacts": relayed_list,
    }


def process_due_scheduled_playbooks(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
) -> int:
    """Trigger enabled cron-scheduled Playbooks cleanly (called by the cluster scheduler leader)."""
    scheduled = list(
        db.scalars(
            select(Playbook).where(
                Playbook.enabled == True,  # noqa: E712
                Playbook.schedule_enabled == True,  # noqa: E712
                Playbook.schedule_cron.is_not(None),
            )
        ).all()
    )
    triggered = 0
    now_utc = utcnow()
    slot_utc = now_utc.replace(second=0, microsecond=0)
    accessible: list[Sandbox] | None = None

    for pb in scheduled:
        cron_expr = (pb.schedule_cron or "").strip()
        if not cron_expr:
            continue
        if pb.last_scheduled_at is not None and pb.last_scheduled_at >= slot_utc:
            continue
        try:
            tz = ZoneInfo((pb.schedule_timezone or "UTC").strip() or "UTC")
            local_dt = now_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
            if not _cron_matches_minute(cron_expr, local_dt):
                continue
        except Exception:
            continue

        if accessible is None:
            accessible = list(
                db.scalars(
                    select(Sandbox).where(Sandbox.deleted_at.is_(None))
                ).all()
            )
        try:
            sched_inputs = json.loads(pb.schedule_inputs_json or "{}")
            if not isinstance(sched_inputs, dict):
                sched_inputs = {}
        except Exception:
            sched_inputs = {}

        pb.last_scheduled_at = now_utc
        db.flush()
        try:
            start_playbook_run(
                db,
                settings,
                docker,
                pb,
                title=f"[定时触发] {pb.name} ({local_dt.strftime('%Y-%m-%d %H:%M')})",
                inputs=sched_inputs,
                role_assignments={},
                accessible_sandboxes=accessible,
                actor="scheduler:cron",
            )
            triggered += 1
        except Exception:
            db.rollback()
    if triggered:
        db.commit()
    return triggered


def trigger_playbook_webhook(
    db: Session,
    settings: Settings,
    docker: BaseSandboxRuntime,
    pb: Playbook,
    *,
    secret_header: str = "",
    sig_header: str = "",
    raw_body: bytes = b"",
    payload_json: dict[str, Any] | None = None,
) -> PlaybookRun:
    """Authenticate an inbound Playbook Webhook request and launch a PlaybookRun."""
    stored_cipher = getattr(pb, "webhook_secret_ciphertext", "") or ""
    if not stored_cipher:
        raise ValueError("该 Playbook 尚未配置 Webhook Secret，请先在模板编辑中设置")
    expected_secret = decrypt_secret(stored_cipher)
    if not expected_secret:
        raise ValueError("Playbook Webhook Secret 解密失败")

    authorized = False
    if secret_header and hmac.compare_digest(secret_header.strip(), expected_secret):
        authorized = True
    elif sig_header and sig_header.startswith("sha256="):
        digest = hmac.new(expected_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
        authorized = hmac.compare_digest(sig_header[7:].strip().lower(), digest.lower())
    if not authorized:
        raise PermissionError("Webhook 签名或密钥校验失败")

    body = payload_json if isinstance(payload_json, dict) else {}
    raw_inputs = body.get("inputs") if isinstance(body.get("inputs"), dict) else body
    inputs = {
        str(k): str(v) if not isinstance(v, (dict, list)) else json.dumps(v, ensure_ascii=False)
        for k, v in raw_inputs.items()
        if str(k) not in {"title", "team_id", "execution_mode", "role_assignments"}
    }
    role_assignments = (
        {str(k): str(v) for k, v in body["role_assignments"].items() if v}
        if isinstance(body.get("role_assignments"), dict)
        else {}
    )
    accessible = list(
        db.scalars(select(Sandbox).where(Sandbox.deleted_at.is_(None))).all()
    )
    title = str(body.get("title") or f"[Webhook] {pb.name}").strip()
    team_id = str(body.get("team_id") or "").strip() or None
    exec_mode = str(body.get("execution_mode") or "isolated").strip()
    return start_playbook_run(
        db,
        settings,
        docker,
        pb,
        title=title,
        inputs=inputs,
        role_assignments=role_assignments,
        accessible_sandboxes=accessible,
        team_id=team_id,
        execution_mode=exec_mode,
        actor="webhook:playbook",
    )


def build_playbook_run_trace(db: Session, run: PlaybookRun) -> dict[str, Any]:
    """Build per-stage execution timeline, relayed artifacts, and LLM Gateway cost/token attribution."""
    from ..models import LlmUsageLedger

    steps = list(
        db.scalars(
            select(PlaybookStepRun)
            .where(PlaybookStepRun.run_id == run.id)
            .order_by(PlaybookStepRun.stage_index.asc())
        ).all()
    )
    ledger_rows = list(
        db.scalars(
            select(LlmUsageLedger)
            .where(LlmUsageLedger.playbook_run_id == run.id)
            .order_by(LlmUsageLedger.created_at.asc())
        ).all()
    )
    artifacts = list(
        db.scalars(
            select(PlaybookArtifact)
            .where(PlaybookArtifact.run_id == run.id)
            .order_by(PlaybookArtifact.created_at.asc())
        ).all()
    )

    by_step_id: dict[str, list[LlmUsageLedger]] = {}
    for row in ledger_rows:
        if row.playbook_step_id:
            by_step_id.setdefault(row.playbook_step_id, []).append(row)

    stage_traces: list[dict[str, Any]] = []
    for st in steps:
        calls = by_step_id.get(st.id, [])
        duration_sec: float | None = None
        if st.started_at and st.completed_at:
            duration_sec = round(max(0.0, (st.completed_at - st.started_at).total_seconds()), 2)
        stage_traces.append(
            {
                "step_id": st.id,
                "stage_id": st.stage_id,
                "stage_name": st.stage_name,
                "sandbox_slug": st.sandbox_slug,
                "status": st.status,
                "retry_count": int(st.retry_count or 0),
                "duration_seconds": duration_sec,
                "llm_calls": len(calls),
                "tokens": sum(int(c.total_tokens or 0) for c in calls),
                "cost_usd": round(sum(float(c.cost_amount or 0.0) for c in calls), 6),
                "fallback_calls": sum(1 for c in calls if c.routed_mode == "fallback"),
                "dlp_redactions": sum(int(getattr(c, "dlp_redacted_count", 0) or 0) for c in calls),
                "events": [
                    {
                        "id": c.id,
                        "model": c.model,
                        "routed_mode": c.routed_mode,
                        "upstream_key_label": getattr(c, "upstream_key_label", None),
                        "input_tokens": int(c.input_tokens or 0),
                        "output_tokens": int(c.output_tokens or 0),
                        "cache_read_tokens": int(c.cache_read_tokens or 0),
                        "cache_creation_tokens": int(getattr(c, "cache_creation_tokens", 0) or 0),
                        "cost_amount": float(c.cost_amount or 0.0),
                        "status_code": int(c.status_code or 200),
                        "latency_ms": int(c.latency_ms or 0),
                        "dlp_redacted_count": int(getattr(c, "dlp_redacted_count", 0) or 0),
                        "created_at": c.created_at.isoformat() if c.created_at else None,
                    }
                    for c in calls
                ],
            }
        )

    return {
        "run_id": run.id,
        "playbook_key": run.playbook_key,
        "title": run.title,
        "status": run.status,
        "total_llm_calls": len(ledger_rows),
        "total_tokens": sum(int(c.total_tokens or 0) for c in ledger_rows),
        "total_cost_usd": round(sum(float(c.cost_amount or 0.0) for c in ledger_rows), 6),
        "total_dlp_redactions": sum(int(getattr(c, "dlp_redacted_count", 0) or 0) for c in ledger_rows),
        "stages": stage_traces,
        "artifacts": [
            {
                "id": a.id,
                "stage_id": a.stage_id,
                "file_name": a.file_name,
                "source_sandbox_slug": a.source_sandbox_slug,
                "source_path": a.source_path,
                "size_bytes": int(a.size_bytes or 0),
                "sha256": a.sha256,
                "download_url": f"/api/playbook-runs/{run.id}/artifacts/{a.id}",
            }
            for a in artifacts
        ],
    }
