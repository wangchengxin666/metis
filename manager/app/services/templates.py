from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import DEFAULT_AUTO_INSTALL_PLUGINS, Settings
from ..models import Sandbox, SandboxTemplate
from ..schemas import TemplateCreate, TemplateUpdate
from .common import Conflict, NotFoundError, _normalize_init_script, audit


ROLE_TEMPLATE_PRESETS: list[dict[str, str | float]] = [
    {
        "key": "tech-lead",
        "name": "系统架构师 & Tech Lead",
        "description": "负责系统边界划分、技术选型、跨岗位任务拆解 (DAG) 与代码架构评审，常作为项目组统筹主持人 (Moderator)。",
        "role_title": "系统架构师 & Tech Lead",
        "role_description": "负责系统架构设计、接口契约制定、多角色任务统筹派发与上线前质量把关。",
        "role_sop": (
            "担任架构师与技术统筹主持人。梳理系统边界与接口契约，通过 mesh_dispatch_tasks 拆解并行与分阶段任务（附依赖关系），"
            "在架构定稿、生产发布等关键节点通过 mesh_request_approval 发起人工审批确认。"
        ),
        "default_cpu_limit": 4.0,
        "default_memory_limit": "8g",
    },
    {
        "key": "fullstack-eng",
        "name": "全栈研发工程师",
        "description": "独立负责从数据模型、后端 API、前端 UI 到自动化单测与本地预览发布的端到端功能交付。",
        "role_title": "全栈研发工程师",
        "role_description": "负责从数据库、后端接口、前端界面到自动化测试的端到端独立功能交付。",
        "role_sop": (
            "独立承接端到端功能开发（数据模型、后端 API、前端 UI 与自动化测试）。使用配置的 Git/MCP 工具在功能分支提交代码，"
            "跑通完整构建与测试并可通过 sandbox-expose 启动预览服务，通过 mesh_task_update 回报分支、PR 与预览地址等产物。"
        ),
        "default_cpu_limit": 2.0,
        "default_memory_limit": "4g",
    },
    {
        "key": "frontend-eng",
        "name": "前端 UI 工程师",
        "description": "专注 React / TypeScript / Tailwind 组件研发、交互体验还原、响应式布局与前端工程化构建。",
        "role_title": "前端 UI 工程师",
        "role_description": "负责 React/CSS 组件、页面交互、状态管理与前端预览环境发布。",
        "role_sop": (
            "负责前端交互与界面实现。在独立功能分支开发，完成后执行 typecheck/test/build 并通过 sandbox-expose 暴露前端预览地址，"
            "通过 mesh_task_update 上报分支与预览链接产物，严禁触碰生产运维密钥。"
        ),
        "default_cpu_limit": 2.0,
        "default_memory_limit": "4g",
    },
    {
        "key": "backend-eng",
        "name": "后端与数据库专家",
        "description": "专注高可靠 API 设计、关系型数据库建模与迁移、分布式缓存、鉴权安全与服务端性能优化。",
        "role_title": "后端与数据库专家",
        "role_description": "负责 API 接口设计、数据库 Schema 与迁移、鉴权逻辑及服务端高并发性能优化。",
        "role_sop": (
            "负责接口设计与服务端实现。在功能分支编码，补齐单元测试与数据库迁移校验，"
            "通过 mesh_task_update 清晰回报接口契约、测试结果与分支/PR 产物。"
        ),
        "default_cpu_limit": 2.0,
        "default_memory_limit": "4g",
    },
    {
        "key": "qa-engineer",
        "name": "测试与质量保障专家 (QA)",
        "description": "负责自动化回归测试、端到端集成验收、边界用例设计、缺陷复现报告与发布准入核验。",
        "role_title": "测试与质量保障专家",
        "role_description": "负责自动化测试、联调验证、缺陷复现、性能压测与上线验收。",
        "role_sop": (
            "负责端到端测试与上线验收。拉取对应分支或访问预览地址，执行自动化与边界回归测试；"
            "若发现缺陷将任务标记为 blocked 并附精确复现步骤，验证通过后标记 done 并附测试报告。"
        ),
        "default_cpu_limit": 2.0,
        "default_memory_limit": "4g",
    },
    {
        "key": "devops-sre",
        "name": "DevOps 与 SRE 运维专家",
        "description": "负责容器化构建、Docker/Kubernetes 部署清单、CI/CD 流水线、定时巡检告警与故障恢复。",
        "role_title": "DevOps 与运维部署专家",
        "role_description": "负责 CI/CD 流水线、Docker/K8s 部署发布、监控巡检与回滚验证。",
        "role_sop": (
            "负责构建、发布与稳定性巡检。任何生产部署或高危变更前必须先调用 mesh_request_approval 获取人类批准，"
            "发布后校验健康状态并记录版本与访问地址到任务产物。"
        ),
        "default_cpu_limit": 2.0,
        "default_memory_limit": "4g",
    },
    {
        "key": "product-mgr",
        "name": "产品经理 (PM)",
        "description": "负责需求调研、用户故事梳理、PRD 规格文档编写、验收标准制定与项目里程碑跟进。",
        "role_title": "产品经理 / 需求分析",
        "role_description": "负责需求拆解、用户故事、PRD 规格编写、验收标准制定与里程碑推进。",
        "role_sop": (
            "将模糊诉求收敛为清晰的 PRD（含用户场景、边界非目标与可验证的验收标准）。"
            "需求定稿前调用 mesh_request_approval 经人工确认，交付后逐条核对验收标准。"
        ),
        "default_cpu_limit": 1.0,
        "default_memory_limit": "2g",
    },
    {
        "key": "security-auditor",
        "name": "安全审计与合规专家",
        "description": "负责代码安全审计 (OWASP Top 10)、鉴权与越权漏洞排查、密钥泄露扫描及第三方依赖合规审查。",
        "role_title": "安全审计与合规专家",
        "role_description": "负责威胁建模、鉴权/注入/XSS 代码安全审查、密钥扫描与依赖漏洞审计。",
        "role_sop": (
            "聚焦鉴权绕过、注入、XSS、密钥泄露与供应链漏洞审计。发现高危风险立即将对应任务标为 blocked 并给出明确修复方案；"
            "审计通过后通过 mesh_task_update 附审查清单与结论。"
        ),
        "default_cpu_limit": 2.0,
        "default_memory_limit": "4g",
    },
    # --- Corporate & All-Company Business Roles ---
    {
        "key": "exec-assistant",
        "name": "行政与高管助理",
        "description": "负责跨部门日程统筹、会议纪要整理、行动项跟踪、公文/邮件起草及周报汇总。",
        "role_title": "行政与高管助理",
        "role_description": "负责会议纪要与待办追踪、行政公文与双语邮件起草、跨部门事项催办与日程协调。",
        "role_sop": (
            "以简洁、准确、条理清晰的商务风格输出纪要与汇报（包含结论、责任人、截止时间与风险项）。"
            "涉及对外正式通知或重要日程变更前，通过 mesh_request_approval 经人类确认后再执行。"
        ),
        "default_cpu_limit": 1.0,
        "default_memory_limit": "2g",
    },
    {
        "key": "finance-analyst",
        "name": "财务与经营分析专员",
        "description": "负责月度/季度收支汇总、费用报销核对、现金流与预算差异分析、自动化经营报表生成。",
        "role_title": "财务与经营分析专员",
        "role_description": "负责财务数据核对、预算执行差异分析、成本结构拆解与经营周报/月报产出。",
        "role_sop": (
            "对每一项金额、口径与公式保持 100% 可追溯核验，产出表格时同时给出关键异常波动说明。"
            "严格遵守数据保密原则，任何付款指令、税表申报或正式财务口径发布前必须通过 mesh_request_approval 人工审批。"
        ),
        "default_cpu_limit": 2.0,
        "default_memory_limit": "4g",
    },
    {
        "key": "legal-counsel",
        "name": "法务与合规审查专员",
        "description": "负责合同条款风险排查、NDA/采购/服务协议红线标注、合规与隐私条款审核建议。",
        "role_title": "法务与合规审查专员",
        "role_description": "负责商业合同审查、违约责任与知识产权风险标注、数据隐私与合规政策核查。",
        "role_sop": (
            "逐条核查合同标的、付款条件、违约责任、知识产权归属、保密与争议解决条款；按高/中/低风险分级输出修订建议。"
            "所有法律意见与对外合同定稿前必须通过 mesh_request_approval 交由人类法务负责人最终签批。"
        ),
        "default_cpu_limit": 1.0,
        "default_memory_limit": "2g",
    },
    {
        "key": "hr-specialist",
        "name": "HR 招聘与组织发展专员",
        "description": "负责岗位 JD 编写、候选人简历结构化初筛、面试题库设计、入职指引与制度答疑。",
        "role_title": "HR 招聘与组织发展专员",
        "role_description": "负责招聘 JD 撰写、简历匹配度评估、结构化面试提纲制定与员工入职/制度支持。",
        "role_sop": (
            "基于岗位画像进行客观、无偏见的候选人能力维度评估，输出清晰的优势与待考察点清单。"
            "涉及 Offer 发放、薪酬口径或人事制度变更前，务必通过 mesh_request_approval 人工确认。"
        ),
        "default_cpu_limit": 1.0,
        "default_memory_limit": "2g",
    },
    {
        "key": "marketing-ops",
        "name": "市场与内容运营专员",
        "description": "负责品牌传播文案、多渠道社媒/公众号推文撰写、活动策划方案、竞品追踪与投放复盘。",
        "role_title": "市场与内容运营专员",
        "role_description": "负责多渠道内容创作、营销活动策划、竞品动态监控与增长漏斗复盘报告。",
        "role_sop": (
            "遵循企业品牌语调产出高转化文案与视觉排版建议，重大对外稿件在发布前交由法务/品牌负责人审批（mesh_request_approval），"
            "并可通过 sandbox-expose 发布落地页/活动 H5 预览供团队审阅。"
        ),
        "default_cpu_limit": 2.0,
        "default_memory_limit": "4g",
    },
    {
        "key": "data-bi-analyst",
        "name": "商业数据分析师 (BI)",
        "description": "负责业务指标体系拆解、SQL/Python 数据清洗分析、可视化报表与经营日报定时推送。",
        "role_title": "商业数据分析师 (BI)",
        "role_description": "负责业务指标诊断、漏斗与留存分析、自动化数据脚本及可视化经营看板产出。",
        "role_sop": (
            "先核实数据口径、时间窗口与空值处理逻辑，再给出结论与可落地的业务优化建议；"
            "可借助 sandbox-cron 定时刷新日报，并通过 sandbox-expose 发布交互式数据看板预览。"
        ),
        "default_cpu_limit": 2.0,
        "default_memory_limit": "4g",
    },
]


def seed_role_template_presets(
    db: Session,
    settings: Settings,
    *,
    actor: str | None = None,
) -> list[SandboxTemplate]:
    """Idempotently seed the 8 built-in enterprise R&D job role templates."""
    default_plugins = (
        settings.sandbox_auto_install_plugins or DEFAULT_AUTO_INSTALL_PLUGINS
    )
    created_or_updated: list[SandboxTemplate] = []
    for preset in ROLE_TEMPLATE_PRESETS:
        key = str(preset["key"])
        existing = get_template_by_key(db, key)
        if existing is None:
            tpl = SandboxTemplate(
                key=key,
                name=str(preset["name"]),
                description=str(preset["description"]),
                role_title=str(preset["role_title"]),
                role_description=str(preset["role_description"]),
                role_sop=str(preset["role_sop"]),
                image_repo=settings.dsh_image_repo,
                image_tag=settings.dsh_image_tag,
                default_cpu_limit=float(preset["default_cpu_limit"]),
                default_memory_limit=str(preset["default_memory_limit"]),
                auto_install_plugins=default_plugins,
                init_script=None,
                default_env_json="{}",
                is_builtin=False,
            )
            db.add(tpl)
            created_or_updated.append(tpl)
        else:
            if not existing.role_title:
                existing.role_title = str(preset["role_title"])
            if not existing.role_description:
                existing.role_description = str(preset["role_description"])
            if not existing.role_sop:
                existing.role_sop = str(preset["role_sop"])
            created_or_updated.append(existing)
    audit(
        db,
        "template.seed_presets",
        target="role-presets",
        detail=f"count={len(created_or_updated)}",
        actor=actor,
    )
    db.commit()
    return list_templates(db)


def ensure_default_templates(db: Session, settings: Settings) -> None:
    # Keep a single clean built-in default template ('agent-os'); admins can create custom ones.
    for extra_key in ("fullstack-web", "python-data", "minimal"):
        extra = db.scalar(
            select(SandboxTemplate).where(
                SandboxTemplate.key == extra_key,
                SandboxTemplate.is_builtin.is_(True),
            )
        )
        if extra is not None:
            db.delete(extra)

    legacy_default_init_script = "#!/usr/bin/env bash\nmkdir -p /home/workspace/projects\n"
    default_tpl = db.scalar(
        select(SandboxTemplate).where(SandboxTemplate.key == "agent-os")
    )
    default_plugins = (
        settings.sandbox_auto_install_plugins or DEFAULT_AUTO_INSTALL_PLUGINS
    )
    if default_tpl is None:
        db.add(
            SandboxTemplate(
                key="agent-os",
                name="默认 Agent OS 环境 (Default)",
                description="默认远程 DeepSeek Harness 操作系统环境，预装文件管理器、当前用户身份栏、自定义主题插件、进程守护 (sandbox-service) 与持久化定时任务 (sandbox-cron)。",
                image_repo=settings.dsh_image_repo,
                image_tag=settings.dsh_image_tag,
                default_cpu_limit=settings.sandbox_cpus,
                default_memory_limit=settings.sandbox_memory,
                auto_install_plugins=default_plugins,
                init_script=None,
                default_env_json="{}",
                is_builtin=True,
            )
        )
    elif default_tpl.is_builtin:
        if default_tpl.init_script == legacy_default_init_script:
            default_tpl.init_script = None
        if (default_tpl.auto_install_plugins or "").strip() in {
            "file-manager",
            "file-manager,workspace-user,custom-theme",
            "file-manager,workspace-user,custom-theme,sandbox-mesh",
        }:
            default_tpl.auto_install_plugins = default_plugins

    for sbx in db.scalars(select(Sandbox).where(Sandbox.deleted_at.is_(None))).all():
        if (sbx.auto_install_plugins or "").strip() in {
            "file-manager",
            "file-manager,workspace-user,custom-theme",
            "file-manager,workspace-user,custom-theme,sandbox-mesh",
        }:
            sbx.auto_install_plugins = default_plugins
    try:
        db.commit()
    except IntegrityError:
        db.rollback()


def list_templates(db: Session) -> list[SandboxTemplate]:
    return list(
        db.scalars(
            select(SandboxTemplate).order_by(
                SandboxTemplate.is_builtin.desc(), SandboxTemplate.key.asc()
            )
        ).all()
    )


def get_template_by_key(db: Session, key: str) -> SandboxTemplate | None:
    return db.scalar(select(SandboxTemplate).where(SandboxTemplate.key == key))


def create_template(db: Session, payload: TemplateCreate) -> SandboxTemplate:
    if get_template_by_key(db, payload.key):
        raise Conflict(f"模板标识 '{payload.key}' 已存在")
    tpl = SandboxTemplate(
        key=payload.key,
        name=payload.name,
        description=payload.description,
        role_title=(payload.role_title or "").strip() or None,
        role_description=(payload.role_description or "").strip() or None,
        role_sop=(payload.role_sop or "").strip() or None,
        default_llm_profile_id=(payload.default_llm_profile_id or "").strip() or None,
        image_repo=payload.image_repo.strip(),
        image_tag=payload.image_tag.strip(),
        default_cpu_limit=payload.default_cpu_limit,
        default_memory_limit=payload.default_memory_limit,
        auto_install_plugins=payload.auto_install_plugins,
        init_script=_normalize_init_script(payload.init_script),
        default_env_json=payload.default_env_json or "{}",
        is_builtin=False,
    )
    db.add(tpl)
    audit(db, "template.create", target=tpl.key, detail=f"image={tpl.image_repo}:{tpl.image_tag}")
    db.commit()
    db.refresh(tpl)
    return tpl


def update_template(
    db: Session, template_id: str, payload: TemplateUpdate
) -> SandboxTemplate:
    tpl = db.get(SandboxTemplate, template_id)
    if not tpl:
        raise NotFoundError(f"template not found: {template_id}")
    if payload.name is not None:
        tpl.name = payload.name
    if payload.description is not None:
        tpl.description = payload.description
    if payload.role_title is not None:
        tpl.role_title = payload.role_title.strip() or None
    if payload.role_description is not None:
        tpl.role_description = payload.role_description.strip() or None
    if payload.role_sop is not None:
        tpl.role_sop = payload.role_sop.strip() or None
    if payload.default_llm_profile_id is not None:
        tpl.default_llm_profile_id = payload.default_llm_profile_id.strip() or None
    if payload.image_repo is not None:
        tpl.image_repo = payload.image_repo.strip()
    if payload.image_tag is not None:
        tpl.image_tag = payload.image_tag.strip()
    if payload.default_cpu_limit is not None:
        tpl.default_cpu_limit = payload.default_cpu_limit
    if payload.default_memory_limit is not None:
        tpl.default_memory_limit = payload.default_memory_limit
    if payload.auto_install_plugins is not None:
        tpl.auto_install_plugins = payload.auto_install_plugins
    if payload.init_script is not None:
        tpl.init_script = _normalize_init_script(payload.init_script)
    if payload.default_env_json is not None:
        tpl.default_env_json = payload.default_env_json
    audit(db, "template.update", target=tpl.key)
    db.commit()
    db.refresh(tpl)
    return tpl


def delete_template(db: Session, template_id: str) -> None:
    tpl = db.get(SandboxTemplate, template_id)
    if not tpl:
        raise NotFoundError(f"template not found: {template_id}")
    audit(db, "template.delete", target=tpl.key)
    db.delete(tpl)
    db.commit()


