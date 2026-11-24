"""Declarative enterprise Playbook engine: presets, YAML/JSON import-export, and multi-stage run orchestration."""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..docker_service import BaseSandboxRuntime
from ..models import Playbook, PlaybookRun, PlaybookStepRun, Sandbox, SandboxRuntimeSnapshot, Team
from ..schemas import PlaybookCreate, PlaybookUpdate
from .common import Conflict, NotFoundError, audit, utcnow
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
                "parallel_group": "build_verify",
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
                "parallel_group": "build_verify",
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
    """Idempotently seed the 3 built-in enterprise showcase Playbooks."""
    existing_keys = set(db.scalars(select(Playbook.key)).all())
    added = False
    for spec in BUILTIN_PLAYBOOKS:
        if spec["key"] in existing_keys:
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
        added = True
    if added:
        db.commit()


def serialize_playbook(pb: Playbook) -> dict[str, Any]:
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
        "created_by": pb.created_by,
        "created_at": pb.created_at.isoformat() if pb.created_at else None,
        "updated_at": pb.updated_at.isoformat() if pb.updated_at else None,
    }


def list_playbooks(db: Session, *, enabled_only: bool = False) -> list[Playbook]:
    stmt = select(Playbook)
    if enabled_only:
        stmt = stmt.where(Playbook.enabled.is_(True))
    stmt = stmt.order_by(Playbook.is_builtin.desc(), Playbook.created_at.asc())
    return list(db.scalars(stmt).all())


def create_playbook(
    db: Session,
    payload: PlaybookCreate,
    *,
    actor: str | None = None,
) -> Playbook:
    clean_key = payload.key.strip().lower()
    if db.scalar(select(Playbook).where(Playbook.key == clean_key)):
        raise Conflict(f"Playbook '{clean_key}' 已存在")
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
    existing = db.scalar(select(Playbook).where(Playbook.key == spec.key.strip().lower()))
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


def _collect_previous_outputs_text(steps: list[PlaybookStepRun], up_to_idx: int) -> str:
    lines: list[str] = []
    for st in steps:
        if st.stage_index >= up_to_idx:
            break
        if st.status != "completed":
            continue
        summary = (st.output_summary or "").strip() or "已完成"
        try:
            arts = json.loads(st.artifacts_json or "[]")
        except Exception:
            arts = []
        art_line = f" | 产物: {', '.join(str(a) for a in arts)}" if arts else ""
        lines.append(f"- [{st.stage_name}](@{st.sandbox_slug or 'unassigned'}): {summary}{art_line}")
    return "\n".join(lines) if lines else "无前置阶段输出"


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
    variables["previous_outputs"] = _collect_previous_outputs_text(all_steps, step.stage_index)
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
    if step.deliverable_hint:
        rendered += f"\n\n### 预期交付物\n- {step.deliverable_hint}"
    rendered += (
        "\n\n### 执行要求\n"
        "请直接在本对话中完成任务并回复清晰、结构化的交付结论（如有生成文件请附带 `/home/workspace/...` 路径，"
        "如有预览服务请附带可访问 URL）。"
    )

    step.prompt_rendered = rendered
    step.started_at = utcnow()
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
                "description": rendered[:3900],
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

    # Only dispatch next wave if no prior step is still running or awaiting approval
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

    try:
        inputs = json.loads(run.inputs_json or "{}")
    except Exception:
        inputs = {}
    try:
        uploaded_meta = json.loads(run.uploaded_files_json or "[]")
    except Exception:
        uploaded_meta = []

    run.current_stage_index = first.stage_index
    for st in wave:
        sbx = sbx_by_id.get(st.sandbox_id) if st.sandbox_id else None
        paths = [
            str(m.get("path"))
            for m in uploaded_meta
            if isinstance(m, dict) and m.get("path") and (not m.get("sandbox_id") or m.get("sandbox_id") == st.sandbox_id)
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

    run.status = (
        "awaiting_approval"
        if any(s.status == "awaiting_approval" for s in steps)
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

    # Write uploaded files into unique assigned sandboxes
    uploaded_meta: list[dict[str, Any]] = []
    if files:
        seen_sbx_ids: set[str] = set()
        for sbx in resolved_assignments.values():
            if sbx is None or sbx.id in seen_sbx_ids:
                continue
            seen_sbx_ids.add(sbx.id)
            try:
                if docker.status(sbx) != "running":
                    docker.start(sbx)
                    docker.wait_healthy(sbx)
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
) -> bool:
    """Reconcile running Playbook steps against latest SandboxRuntimeSnapshots and auto-advance waves."""
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

    changed = False
    for step in steps:
        if step.status not in {"running", "awaiting_approval"} or not step.sandbox_id:
            continue

        # 1. Preferred: inspect live @metis/sandbox-mesh room replies for running steps
        sbx = sbx_by_id.get(step.sandbox_id)
        if (
            step.status == "running"
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
                    if step.approval_required:
                        step.status = "awaiting_approval"
                        step.approval_status = "pending"
                        _notify_step_awaiting_approval(db, settings, run, step)
                    else:
                        step.status = "completed"
                        step.completed_at = step.completed_at or utcnow()
                    changed = True
                    continue
                if prog.get("failed") and prog.get("error_text"):
                    err_txt = str(prog["error_text"]).strip()[:2000]
                    if step.output_summary != err_txt:
                        step.output_summary = err_txt
                        changed = True
                    continue

        # 2. Fallback: reconcile legacy task records in SandboxRuntimeSnapshot
        if not step.task_id:
            continue
        snap = snaps.get(step.sandbox_id)
        if not snap:
            continue
        try:
            payload = json.loads(snap.payload_json or "{}")
        except Exception:
            continue
        mesh = payload.get("mesh_summary") if isinstance(payload, dict) else {}
        tasks = mesh.get("tasks") if isinstance(mesh, dict) else []
        matched = next(
            (t for t in (tasks or []) if isinstance(t, dict) and str(t.get("id") or "") == step.task_id),
            None,
        )
        if not matched:
            continue
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
            if step.approval_required and t_appr != "approved":
                if step.status == "running":
                    step.status = "awaiting_approval"
                    step.approval_status = "pending"
                    _notify_step_awaiting_approval(db, settings, run, step)
                    changed = True
            else:
                step.status = "completed"
                step.completed_at = step.completed_at or utcnow()
                if step.approval_required:
                    step.approval_status = "approved"
                changed = True
        elif t_appr == "rejected":
            step.status = "rejected"
            step.approval_status = "rejected"
            step.completed_at = step.completed_at or utcnow()
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
    step.status = "completed" if decision == "approved" else "rejected"

    if decision == "approved":
        _dispatch_next_wave(db, settings, docker, run, steps, sbx_by_id, actor=actor)
    else:
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
    }
