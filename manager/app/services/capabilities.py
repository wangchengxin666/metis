"""Built-in catalog, CRUD, import/export, and targeted push services for MCP Servers and Agent Skills."""

from __future__ import annotations

import base64
import io
import json
import re
import stat
import zipfile
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..docker_service import BaseSandboxRuntime
from ..models import McpServer, Sandbox, SkillItem
from ..schemas import (
    McpServerCreate,
    McpServerUpdate,
    SkillCreate,
    SkillImportRequest,
    SkillUpdate,
    _validate_safe_extra_files,
)
from .common import Conflict, NotFoundError, audit

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None

_MCP_SLUG_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
_SKILL_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def resolve_push_target_sandboxes(
    db: Session,
    *,
    sandbox_ids: list[str] | None = None,
    template_keys: list[str] | None = None,
    include_stopped_explicit: bool = True,
) -> list[Sandbox]:
    """Resolve target digital employees by explicit sandbox_ids, template_keys, or all running."""
    query = select(Sandbox).where(Sandbox.deleted_at.is_(None))
    clean_ids = [str(s).strip() for s in (sandbox_ids or []) if str(s).strip()]
    clean_tpls = [str(t).strip() for t in (template_keys or []) if str(t).strip()]
    if clean_ids:
        query = query.where(Sandbox.id.in_(clean_ids))
        if not include_stopped_explicit:
            query = query.where(Sandbox.status == "running")
    elif clean_tpls:
        query = query.where(Sandbox.template.in_(clean_tpls), Sandbox.status == "running")
    else:
        query = query.where(Sandbox.status == "running")
    return list(db.scalars(query.order_by(Sandbox.created_at.asc())).all())


# ---------------------------------------------------------------------------
# Built-in MCP Server Catalog ("我们提供一些")
# ---------------------------------------------------------------------------

BUILTIN_MCP_SERVERS: list[dict[str, Any]] = [
    {
        "slug": "fetch",
        "name": "Fetch 网页抓取",
        "description": "抓取任意网页并自动提取转换为干净的 Markdown 内容，适合查阅在线文档、API 说明与技术博客，无需密钥开箱即用。",
        "category": "web",
        "transport": "stdio",
        "command": "uvx",
        "args": ["mcp-server-fetch"],
        "env": {},
        "cwd": "",
        "url": None,
        "headers": {},
        "tool_loading": "eager",
        "required_credentials": [],
    },
    {
        "slug": "sequential-thinking",
        "name": "Sequential Thinking 结构化推理",
        "description": "提供分步假设推演、分支反思与复杂架构拆解思考工具，帮助数字员工在多步骤研发与分析任务中保持逻辑严密。",
        "category": "reasoning",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
        "env": {},
        "cwd": "",
        "url": None,
        "headers": {},
        "tool_loading": "eager",
        "required_credentials": [],
    },
    {
        "slug": "memory",
        "name": "Memory 本地知识图谱",
        "description": "基于本地实体关系图谱的持久化记忆 MCP 服务，可用于记录项目约定、系统模块关系与跨对话上下文。",
        "category": "knowledge",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"],
        "env": {},
        "cwd": "",
        "url": None,
        "headers": {},
        "tool_loading": "eager",
        "required_credentials": [],
    },
    {
        "slug": "time",
        "name": "Time 时间与时区换算",
        "description": "提供精准的当前时间获取与跨时区时间转换能力，适合排班、日志时间对齐与国际化业务处理。",
        "category": "utility",
        "transport": "stdio",
        "command": "uvx",
        "args": ["mcp-server-time"],
        "env": {},
        "cwd": "",
        "url": None,
        "headers": {},
        "tool_loading": "eager",
        "required_credentials": [],
    },
    {
        "slug": "git",
        "name": "Git 仓库分析助手",
        "description": "结构化读取工作区 Git 状态、Commit 历史、分支差异与文件变更记录，适合代码审查与发布追踪。",
        "category": "dev",
        "transport": "stdio",
        "command": "uvx",
        "args": ["mcp-server-git", "--repository", "/home/workspace"],
        "env": {},
        "cwd": "/home/workspace",
        "url": None,
        "headers": {},
        "tool_loading": "eager",
        "required_credentials": [],
    },
    {
        "slug": "filesystem",
        "name": "Filesystem 工作区文件扩展",
        "description": "标准 MCP 工作区文件读写与目录检索服务（限定于 /home/workspace），便于与其他 MCP 工作流协同。",
        "category": "dev",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/workspace"],
        "env": {},
        "cwd": "/home/workspace",
        "url": None,
        "headers": {},
        "tool_loading": "on-demand",
        "required_credentials": [],
    },
    {
        "slug": "context7",
        "name": "Context7 最新技术文档",
        "description": "远程 Streamable HTTP MCP 服务：实时检索 React、FastAPI、Tailwind、Docker 等主流开源框架的最新版本文档与示例。",
        "category": "knowledge",
        "transport": "streamable-http",
        "command": None,
        "args": [],
        "env": {},
        "cwd": None,
        "url": "https://mcp.context7.com/mcp",
        "headers": {},
        "tool_loading": "eager",
        "required_credentials": [],
    },
    {
        "slug": "github",
        "name": "GitHub 仓库与 PR 协作",
        "description": "读写 GitHub（支持 GitHub.com、GitHub App 与企业内网 GHES 自定义域名）仓库代码、Issue 与 Pull Request；需配合凭据中心推送 `GITHUB_TOKEN` 使用。",
        "category": "dev",
        "transport": "stdio",
        "command": "node",
        "args": ["/home/workspace/.dsh-sandbox/github-mcp-launcher.cjs"],
        "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "${credential:GITHUB_TOKEN}"},
        "cwd": "",
        "url": None,
        "headers": {},
        "tool_loading": "eager",
        "required_credentials": ["GITHUB_TOKEN"],
    },
    {
        "slug": "brave-search",
        "name": "Brave 全网实时搜索",
        "description": "高质量全网网页与新闻搜索 MCP；需配合凭据中心推送 `BRAVE_API_KEY` 使用。",
        "category": "web",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-brave-search"],
        "env": {"BRAVE_API_KEY": "${credential:BRAVE_API_KEY}"},
        "cwd": "",
        "url": None,
        "headers": {},
        "tool_loading": "eager",
        "required_credentials": ["BRAVE_API_KEY"],
    },
    {
        "slug": "postgres",
        "name": "PostgreSQL 只读数据查询",
        "description": "连接 PostgreSQL 数据库执行结构探测与只读 SQL 分析；需配合凭据中心推送 `POSTGRES_URL` 连接串。",
        "category": "data",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres", "${credential:POSTGRES_URL}"],
        "env": {},
        "cwd": "",
        "url": None,
        "headers": {},
        "tool_loading": "on-demand",
        "required_credentials": ["POSTGRES_URL"],
    },
]


# ---------------------------------------------------------------------------
# Built-in Agent Skills Catalog ("我们提供一些")
# ---------------------------------------------------------------------------

BUILTIN_SKILLS: list[dict[str, Any]] = [
    {
        "slug": "code-review-checklist",
        "name": "代码审查与 PR 质检规范",
        "category": "engineering",
        "description": "执行结构化的代码审查与 Pull Request 质检，聚焦正确性、安全边界、并发竞态、性能退化与测试覆盖。",
        "when_to_use": "当用户要求评审代码、检查 git diff / PR、或在提交交付前进行自检时调用。",
        "extra_files": {
            "references/review-rubric.md": """# Review 严重级别与判定标准

- **P0 / Blocker**：越权/未鉴权访问、密钥硬编码泄露、SQL/命令注入、数据损坏或破坏向后兼容。
- **P1 / High**：异步竞态、错误处理吞异常、状态机边界漏洞、核心路径无自动化测试。
- **P2 / Medium**：重复逻辑可抽象、N+1 查询或明显性能隐患、类型契约不同步。
- **Nit**：命名或风格微调，不阻塞合入。
""",
            "scripts/precommit-check.sh": """#!/usr/bin/env bash
set -euo pipefail
git diff --check || { echo "Whitespace/conflict marker errors detected"; exit 1; }
echo "[OK] diff hygiene check passed"
""",
        },
        "content": """# 代码审查与 PR 质检清单

在提交代码或评审他人改动时，按以下优先级逐项核查并输出清晰结论（问题文件、行号、风险等级、修复建议）；判定口径见附属资源 `references/review-rubric.md`，提交前可运行 `scripts/precommit-check.sh`。

## 1. 正确性与边界条件
- 是否存在空值/未定义/越界未处理、异步竞态、错误被静默吞掉 (`catch {}`) 的情况？
- 状态机流转、分页、排序与权限校验是否覆盖边界输入（空集合、极大值、非法字符）？

## 2. 安全与最小权限
- 绝不在响应、日志或前端代码中暴露密钥、Token、私钥或内部敏感堆栈。
- 所有写操作与受保护查询是否经过鉴权与越权校验（Tenant / Owner / Role）？
- 文件路径操作是否防御路径穿越 (`..`)，命令执行是否避免 shell 注入？

## 3. 代码整洁与可维护性
- 是否有可抽取的重复逻辑？函数是否职责单一、嵌套浅显？
- 数据库迁移、Schema 与前后端类型定义是否保持同步？

## 4. 验证结论
- 列出实际运行过的 lint / typecheck / 单测 / 集成测试命令与真实通过情况；未运行的项明确标出。
""",
    },
    {
        "slug": "api-design-spec",
        "name": "RESTful API 与接口契约规范",
        "category": "engineering",
        "description": "设计或重构后端 HTTP API 时遵循的接口命名、状态码、分页、错误格式与向后兼容规范。",
        "when_to_use": "当设计新接口、编写 OpenAPI/Swagger 文档或进行前后端接口联调对齐时调用。",
        "extra_files": {
            "assets/openapi-template.yaml": """openapi: 3.1.0
info:
  title: Service API
  version: 1.0.0
paths:
  /healthz:
    get:
      summary: Health Check
      responses:
        "200":
          description: Service healthy
""",
        },
        "content": """# RESTful API 设计规范

> 可直接参考附属模板 `assets/openapi-template.yaml` 起草接口契约。

## 1. 资源命名与方法语义
- 使用复数名词表达资源集合（如 `/api/mcp-servers`、`/api/skills`），子动作使用动词后缀（如 `/{id}/push`）。
- `GET` 保持幂等只读；`POST` 创建或触发动作；`PATCH` 局部更新；`DELETE` 删除资源。

## 2. 状态码与错误载荷
- `200` 查询/动作成功，`201` 创建成功，`400/422` 参数校验失败，`401/403` 鉴权/越权，`404` 不存在，`409` 资源冲突。
- 统一返回 JSON `{ "detail": "清晰可读的错误信息" }`，避免向调用方泄露内部 SQL 或密钥。

## 3. 分页与过滤
- 列表接口支持 `limit` / `offset`（或 cursor）与明确的默认排序，返回结构包含 `items` 与 `total`。

## 4. 向后兼容
- 新增字段给出安全默认值；绝不随意修改已有字段类型或删除仍在使用的响应键。
""",
    },
    {
        "slug": "qa-e2e-verification",
        "name": "端到端验收与回归测试规范",
        "category": "qa",
        "description": "制定并执行功能验收计划、边界用例矩阵、自动化回归及缺陷复现报告。",
        "when_to_use": "当需要验证新功能上线质量、编写测试用例、排查回归缺陷或出具 QA 验收报告时调用。",
        "extra_files": {
            "references/e2e-report-template.md": """# E2E 验收报告模板

## 1. 测试环境与版本
- 目标地址 / 容器镜像 / 提交版本

## 2. 用例矩阵
| 用例编号 | 场景 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|
| TC-01 | 主流程 | 200 + 数据落库 | ... | PASS |

## 3. 缺陷记录
- 复现步骤 / 实际输出 / 期望行为 / 关键日志
""",
        },
        "content": """# 端到端验收与 QA 规范

输出验收报告或缺陷单时可直接套用 `references/e2e-report-template.md`。

## 1. 测试维度矩阵
- **主流程 Happy Path**：从入口操作到最终持久化与页面刷新回显完整走通。
- **权限与隔离**：验证未登录、普通成员、管理员各自边界（401 / 403）。
- **异常与边界**：空输入、超长文本、重复提交、目标离线/不存在时的提示与降级。

## 2. 真实环境核验
- 优先针对实际运行的 HTTP 接口与容器状态进行验证（记录请求状态码、关键响应字段与持久化证据）。
- 发现缺陷时必须附带：**复现步骤**、**实际输出**、**期望行为** 与 **相关日志片段**。
""",
    },
    {
        "slug": "incident-triage",
        "name": "线上故障排查与根因分析 SOP",
        "category": "devops",
        "description": "面对容器异常、服务不可达、502/超时或性能抖动时的标准化排查与止损流程。",
        "when_to_use": "当服务健康检查失败、接口报错、容器重启或需要编写故障复盘 (Postmortem) 时调用。",
        "content": """# 线上故障排查与止损 SOP

## 1. 快速止损与现场保留（前 5 分钟）
1. 确认影响范围（单实例 vs 全局、健康检查 `/healthz` 状态）。
2. 先收集当前容器状态与最近日志（`logs` / `status`），避免直接重建丢失现场日志。

## 2. 分层排查路径
- **网关与网络层**：检查 Traefik / Caddy 路由规则、端口监听 (`127.0.0.1:<port>`) 与上游健康状态。
- **进程与资源层**：检查 `supervisorctl status`、CPU/内存 OOM、磁盘空间 (`df -h`)。
- **配置与依赖层**：核验 `.credentials.yaml`、`cordis.patch.yml`、数据库连接与上游 API 限流/超时。

## 3. 根因报告格式
- 输出：**时间线** -> **直接原因与根因** -> **止损与修复方案** -> **防复发改进项**。
""",
    },
    {
        "slug": "prd-spec-writer",
        "name": "企业级 PRD 需求规格撰写",
        "category": "product",
        "description": "将模糊业务诉求转化为结构清晰、无歧义、可验收的产品需求文档 (PRD)。",
        "when_to_use": "当用户要求整理需求、撰写 PRD、拆解用户故事或定义验收标准 (AC) 时调用。",
        "content": """# 企业级 PRD 撰写模板

输出结构化的产品规格文档，避免空泛描述：

1. **背景与目标 (Why)**：解决什么业务痛点？核心成功指标是什么？
2. **范围与非目标 (Scope & Non-Goals)**：明确本期做什么、刻意不做什么。
3. **角色与用户故事 (User Stories)**：按角色拆解关键使用路径。
4. **功能规格与交互细节**：页面状态（空状态、加载中、报错、权限受限）、字段校验与默认值。
5. **可验证的验收标准 (Acceptance Criteria)**：使用「给定 (Given) / 当 (When) / 则 (Then)」列出可逐条测试的验收项。
""",
    },
    {
        "slug": "data-analysis-bi",
        "name": "数据分析与经营看板产出",
        "category": "data",
        "description": "规范化的数据清洗、指标口径对齐、异常波动归因以及可视化 Web 看板交付指南。",
        "when_to_use": "当分析 CSV/JSON/SQL 业务数据、生成统计图表或搭建 BI 看板时调用。",
        "extra_files": {
            "scripts/profile_csv.py": """#!/usr/bin/env python3
import csv, json, sys
from pathlib import Path

path = Path(sys.argv[1])
with path.open("r", encoding="utf-8", errors="replace") as fh:
    rows = list(csv.DictReader(fh))
cols = list(rows[0].keys()) if rows else []
nulls = {c: sum(1 for r in rows if not str(r.get(c, "")).strip()) for c in cols}
print(json.dumps({"rows": len(rows), "columns": cols, "null_counts": nulls}, ensure_ascii=False, indent=2))
""",
        },
        "content": """# 数据分析与看板产出规范

## 1. 口径先行
- 计算前明确时间窗口、去重主键、空值处理方式与分母定义，并在报告顶部注明统计口径。

## 2. 结论结构
- 先给**核心发现 (Executive Summary)** 与环比/同比变化，再附支撑表格与异常波动归因。
- 可直接运行附属脚本 `scripts/profile_csv.py <data.csv>` 快速统计行数与缺失值；使用 Python (`pandas` / `sqlite3` / `json`) 进行可复现计算，严禁心算或编造未在源数据出现的数值。

## 3. 交互式可视化交付
- 若需要交付网页看板，在本地启动只读 HTTP 服务后通过 `sandbox-service` + `sandbox-expose` 发布并回报真实预览 URL。
""",
    },
    {
        "slug": "security-audit-owasp",
        "name": "安全审计与密钥防泄露检查",
        "category": "security",
        "description": "针对 Web 应用与脚本执行 OWASP Top 10、权限越权、注入风险及敏感凭据泄露扫描。",
        "when_to_use": "当进行安全审查、检查代码是否存在漏洞或核查密钥存储安全性时调用。",
        "content": """# 安全审计核查清单 (OWASP & 密钥防护)

1. **身份认证与越权 (Broken Access Control)**：所有敏感路由是否校验当前用户/管理员/团队归属，是否存在 IDOR？
2. **注入与命令执行**：SQL 是否参数化？Subprocess 是否使用参数数组而非字符串拼接 shell？路径操作是否防穿越？
3. **XSS 与 SSRF**：用户可控 SVG/HTML 是否净化？外部 Webhook/URL 是否限制协议与内网访问风险？
4. **凭据与密钥安全**：禁止将 Token、私钥、API Key 明文写入仓库或接口响应；MCP 优先使用 `${credential:REF}` 引用 `.credentials.yaml`。
""",
    },
    {
        "slug": "weekly-report-digest",
        "name": "工作周报与高管简报生成",
        "category": "office",
        "description": "将零散的任务记录、Git 提交与协同纪要提炼为简洁、数据化、行动导向的周报或高管简报。",
        "when_to_use": "当需要总结本周进展、编写项目周报、整理会议纪要或汇报里程碑状态时调用。",
        "content": """# 周报与高管简报模板

以清晰、精炼、面向决策的风格输出：

## 本周核心成果 (Highlights)
- 按项目/业务线列出已完成交付物（附具体量化结果或可访问链接）。

## 风险与阻塞项 (Risks & Blockers)
- 需要决策或跨部门协助的事项，明确 **影响范围**、**期望协助人** 与 **建议方案**。

## 下周重点计划 (Next Week)
- 3–5 项可衡量的关键里程碑与预计完成时间。
""",
    },
]


# ---------------------------------------------------------------------------
# Helpers & Sync Serialization
# ---------------------------------------------------------------------------


def _serialize_list(items: list[str] | None) -> str:
    if not items:
        return "[]"
    cleaned = list(dict.fromkeys(str(x).strip() for x in items if str(x).strip()))
    return json.dumps(cleaned, ensure_ascii=False)


def _extract_credential_refs(env: dict[str, str], headers: dict[str, str], url: str | None, args: list[str]) -> list[str]:
    refs: list[str] = []
    pat = re.compile(r"\$\{credential:([A-Za-z_][A-Za-z0-9_]*)\}")
    for text in [url or "", *args, *env.values(), *headers.values()]:
        for match in pat.finditer(str(text)):
            ref = match.group(1)
            if ref not in refs:
                refs.append(ref)
    return refs


def mcp_server_to_runtime_entry(srv: McpServer) -> dict[str, Any]:
    """Build a strict DSH 0.2.3 `@deepseek-ai/dsh-mcp-manager` server entry."""
    tool_loading = srv.tool_loading if srv.tool_loading in {"eager", "on-demand"} else "eager"
    if srv.transport == "streamable-http":
        return {
            "transport": "streamable-http",
            "url": (srv.url or "").strip(),
            "headers": srv.headers,
            "enabled": bool(srv.enabled),
            "toolLoading": tool_loading,
        }
    entry: dict[str, Any] = {
        "transport": "stdio",
        "command": (srv.command or "").strip(),
        "args": srv.args,
        "env": srv.env,
        "enabled": bool(srv.enabled),
        "toolLoading": tool_loading,
    }
    if (srv.cwd or "").strip():
        entry["cwd"] = srv.cwd.strip()
    return entry


def render_skill_markdown(skill: SkillItem) -> str:
    """Render a valid DSH 0.2.3 SKILL.md document with YAML frontmatter."""
    fm: dict[str, Any] = {
        "name": skill.slug,
        "description": skill.description.strip(),
    }
    if skill.when_to_use and skill.when_to_use.strip():
        fm["whenToUse"] = skill.when_to_use.strip()
    if skill.disable_model_invocation:
        fm["disable-model-invocation"] = True
    if not skill.user_invocable:
        fm["user-invocable"] = False

    if yaml is not None:
        fm_text = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False).strip()
    else:  # pragma: no cover
        lines = [f"{k}: {json.dumps(v, ensure_ascii=False)}" for k, v in fm.items()]
        fm_text = "\n".join(lines)

    body = (skill.content or "").lstrip("\r\n")
    return f"---\n{fm_text}\n---\n\n{body.rstrip()}\n"


def parse_skill_markdown(raw_markdown: str) -> dict[str, Any]:
    """Parse SKILL.md frontmatter + body for 1-click skill import."""
    text = (raw_markdown or "").replace("\r\n", "\n").lstrip("\ufeff")
    if not text.startswith("---\n"):
        raise ValueError("SKILL.md 必须以 YAML frontmatter (---) 开头")
    rest = text[4:]
    end_idx = rest.find("\n---")
    if end_idx < 0:
        raise ValueError("SKILL.md 缺少结束的 --- frontmatter 分隔符")
    fm_raw = rest[:end_idx]
    body = rest[end_idx + 4 :].lstrip("\n")

    if yaml is not None:
        data = yaml.safe_load(fm_raw) or {}
    else:  # pragma: no cover
        data = {}
        for line in fm_raw.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                data[k.strip()] = v.strip().strip('"').strip("'")

    if not isinstance(data, dict):
        raise ValueError("SKILL.md frontmatter 格式无效")

    slug = str(data.get("name") or "").strip()
    description = str(data.get("description") or "").strip()
    when_to_use = str(data.get("whenToUse") or data.get("when_to_use") or "").strip() or None
    disable_model = bool(data.get("disable-model-invocation", False))
    user_invocable = bool(data.get("user-invocable", True))

    return {
        "slug": slug,
        "description": description,
        "when_to_use": when_to_use,
        "disable_model_invocation": disable_model,
        "user_invocable": user_invocable,
        "content": body,
    }


# ---------------------------------------------------------------------------
# MCP Server Seeding, CRUD & Push
# ---------------------------------------------------------------------------


def ensure_default_mcp_servers(db: Session) -> None:
    """Idempotently seed the built-in MCP Server catalog on startup."""
    changed = False
    for spec in BUILTIN_MCP_SERVERS:
        existing = db.scalar(select(McpServer).where(McpServer.slug == spec["slug"]))
        if existing is not None:
            # Seamlessly upgrade untouched legacy built-in github MCP to enterprise-capable launcher
            if (
                spec["slug"] == "github"
                and existing.is_builtin
                and existing.command == "npx"
                and existing.args == ["-y", "@modelcontextprotocol/server-github"]
            ):
                existing.command = spec.get("command")
                existing.args_json = json.dumps(spec.get("args") or [], ensure_ascii=False)
                existing.description = spec["description"]
                changed = True
            continue
        db.add(
            McpServer(
                slug=spec["slug"],
                name=spec["name"],
                description=spec["description"],
                category=spec["category"],
                transport=spec["transport"],
                command=spec.get("command"),
                args_json=json.dumps(spec.get("args") or [], ensure_ascii=False),
                env_json=json.dumps(spec.get("env") or {}, ensure_ascii=False),
                cwd=spec.get("cwd") or None,
                url=spec.get("url"),
                headers_json=json.dumps(spec.get("headers") or {}, ensure_ascii=False),
                tool_loading=spec.get("tool_loading") or "eager",
                enabled=True,
                required_credentials_json=json.dumps(
                    spec.get("required_credentials") or [], ensure_ascii=False
                ),
                is_builtin=True,
                created_by="system",
            )
        )
        changed = True
    if changed:
        db.commit()


def seed_builtin_mcp_servers(
    db: Session,
    *,
    overwrite: bool = False,
    actor: str | None = None,
) -> list[McpServer]:
    count = 0
    for spec in BUILTIN_MCP_SERVERS:
        existing = db.scalar(select(McpServer).where(McpServer.slug == spec["slug"]))
        if existing is None:
            db.add(
                McpServer(
                    slug=spec["slug"],
                    name=spec["name"],
                    description=spec["description"],
                    category=spec["category"],
                    transport=spec["transport"],
                    command=spec.get("command"),
                    args_json=json.dumps(spec.get("args") or [], ensure_ascii=False),
                    env_json=json.dumps(spec.get("env") or {}, ensure_ascii=False),
                    cwd=spec.get("cwd") or None,
                    url=spec.get("url"),
                    headers_json=json.dumps(spec.get("headers") or {}, ensure_ascii=False),
                    tool_loading=spec.get("tool_loading") or "eager",
                    enabled=True,
                    required_credentials_json=json.dumps(
                        spec.get("required_credentials") or [], ensure_ascii=False
                    ),
                    is_builtin=True,
                    created_by="system",
                )
            )
            count += 1
        elif overwrite:
            existing.name = spec["name"]
            existing.description = spec["description"]
            existing.category = spec["category"]
            existing.transport = spec["transport"]
            existing.command = spec.get("command")
            existing.args_json = json.dumps(spec.get("args") or [], ensure_ascii=False)
            existing.env_json = json.dumps(spec.get("env") or {}, ensure_ascii=False)
            existing.cwd = spec.get("cwd") or None
            existing.url = spec.get("url")
            existing.headers_json = json.dumps(spec.get("headers") or {}, ensure_ascii=False)
            existing.tool_loading = spec.get("tool_loading") or "eager"
            existing.required_credentials_json = json.dumps(
                spec.get("required_credentials") or [], ensure_ascii=False
            )
            existing.is_builtin = True
            count += 1
    audit(db, "mcp.seed_builtins", target="mcp-servers", detail=f"count={count},overwrite={overwrite}", actor=actor)
    db.commit()
    return list_mcp_servers(db)


def list_mcp_servers(db: Session) -> list[McpServer]:
    return list(
        db.scalars(
            select(McpServer).order_by(McpServer.is_builtin.desc(), McpServer.slug.asc())
        ).all()
    )


def create_mcp_server(
    db: Session,
    payload: McpServerCreate,
    *,
    actor: str | None = None,
) -> McpServer:
    slug = payload.slug.strip()
    if db.scalar(select(McpServer).where(McpServer.slug == slug)):
        raise Conflict(f"MCP 服务标识 '{slug}' 已存在")

    req_creds = payload.required_credentials or _extract_credential_refs(
        payload.env, payload.headers, payload.url, payload.args
    )
    srv = McpServer(
        slug=slug,
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
        category=(payload.category or "custom").strip() or "custom",
        transport=payload.transport,
        command=(payload.command or "").strip() or None if payload.transport == "stdio" else None,
        args_json=json.dumps(payload.args if payload.transport == "stdio" else [], ensure_ascii=False),
        env_json=json.dumps(payload.env if payload.transport == "stdio" else {}, ensure_ascii=False),
        cwd=(payload.cwd or "").strip() or None if payload.transport == "stdio" else None,
        url=payload.url if payload.transport == "streamable-http" else None,
        headers_json=json.dumps(
            payload.headers if payload.transport == "streamable-http" else {}, ensure_ascii=False
        ),
        tool_loading=payload.tool_loading,
        enabled=bool(payload.enabled),
        required_credentials_json=_serialize_list(req_creds),
        is_builtin=False,
        created_by=actor,
    )
    db.add(srv)
    audit(db, "mcp.create", target=srv.slug, detail=f"transport={srv.transport}", actor=actor)
    db.commit()
    db.refresh(srv)
    return srv


def update_mcp_server(
    db: Session,
    srv: McpServer,
    payload: McpServerUpdate,
    *,
    actor: str | None = None,
) -> McpServer:
    if payload.name is not None:
        srv.name = payload.name.strip()
    if payload.description is not None:
        srv.description = payload.description.strip() or None
    if payload.category is not None:
        srv.category = payload.category.strip() or "custom"
    if payload.transport is not None:
        srv.transport = payload.transport
    if payload.command is not None:
        srv.command = payload.command.strip() or None
    if payload.args is not None:
        srv.args_json = json.dumps(payload.args, ensure_ascii=False)
    if payload.env is not None:
        srv.env_json = json.dumps(payload.env, ensure_ascii=False)
    if payload.cwd is not None:
        srv.cwd = payload.cwd.strip() or None
    if payload.url is not None:
        srv.url = payload.url
    if payload.headers is not None:
        srv.headers_json = json.dumps(payload.headers, ensure_ascii=False)
    if payload.tool_loading is not None:
        srv.tool_loading = payload.tool_loading
    if payload.enabled is not None:
        srv.enabled = bool(payload.enabled)

    if srv.transport == "stdio":
        if not (srv.command or "").strip():
            raise ValueError("stdio MCP server requires a non-empty command")
        srv.url = None
        srv.headers_json = "{}"
    else:
        if not (srv.url or "").strip():
            raise ValueError("streamable-http MCP server requires a valid http(s) url")
        srv.command = None
        srv.args_json = "[]"
        srv.env_json = "{}"
        srv.cwd = None

    if payload.required_credentials is not None:
        srv.required_credentials_json = _serialize_list(payload.required_credentials)
    else:
        srv.required_credentials_json = _serialize_list(
            _extract_credential_refs(srv.env, srv.headers, srv.url, srv.args)
        )

    audit(db, "mcp.update", target=srv.slug, actor=actor)
    db.commit()
    db.refresh(srv)
    return srv


def delete_mcp_server(
    db: Session,
    srv: McpServer,
    *,
    actor: str | None = None,
) -> None:
    slug = srv.slug
    sid = srv.id
    for sbx in db.scalars(select(Sandbox).where(Sandbox.deleted_at.is_(None))).all():
        ids = sbx.mcp_server_ids
        if sid in ids:
            sbx.mcp_server_ids_json = json.dumps([x for x in ids if x != sid])
    audit(db, "mcp.delete", target=slug, actor=actor)
    db.delete(srv)
    db.commit()


def import_mcp_servers_json(
    db: Session,
    raw_content: str,
    *,
    overwrite: bool = False,
    actor: str | None = None,
) -> list[McpServer]:
    try:
        parsed = json.loads(raw_content)
    except Exception as exc:
        raise ValueError(f"MCP JSON 解析失败: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("MCP 配置必须是 JSON 对象")
    servers_map = parsed.get("mcpServers") if isinstance(parsed.get("mcpServers"), dict) else parsed
    if not isinstance(servers_map, dict) or not servers_map:
        raise ValueError("未找到有效的 mcpServers 条目")

    imported: list[McpServer] = []
    for raw_slug, cfg in servers_map.items():
        slug = str(raw_slug or "").strip()
        if not _MCP_SLUG_RE.fullmatch(slug):
            raise ValueError(f"非法 MCP 服务标识 '{slug}'（仅支持 1-32 位字母/数字/_/-）")
        if not isinstance(cfg, dict):
            raise ValueError(f"MCP 条目 '{slug}' 必须是 JSON 对象")
        transport = (
            "streamable-http"
            if cfg.get("transport") == "streamable-http" or (cfg.get("url") and not cfg.get("command"))
            else "stdio"
        )
        args_val = [str(x) for x in (cfg.get("args") or [])] if isinstance(cfg.get("args"), list) else []
        env_val = {str(k): str(v) for k, v in (cfg.get("env") or {}).items()} if isinstance(cfg.get("env"), dict) else {}
        hdr_val = {str(k): str(v) for k, v in (cfg.get("headers") or {}).items()} if isinstance(cfg.get("headers"), dict) else {}
        tool_loading = "on-demand" if cfg.get("toolLoading") == "on-demand" or cfg.get("tool_loading") == "on-demand" else "eager"
        existing = db.scalar(select(McpServer).where(McpServer.slug == slug))
        if existing is not None:
            if not overwrite:
                raise Conflict(f"MCP 服务 '{slug}' 已存在（可开启覆盖导入）")
            upd = McpServerUpdate(
                name=str(cfg.get("name") or existing.name or slug),
                description=str(cfg.get("description") or existing.description or "") or None,
                transport=transport,  # type: ignore[arg-type]
                command=str(cfg.get("command") or "") or None,
                args=args_val,
                env=env_val,
                cwd=str(cfg.get("cwd") or "") or None,
                url=str(cfg.get("url") or "") or None,
                headers=hdr_val,
                tool_loading=tool_loading,  # type: ignore[arg-type]
                enabled=bool(cfg.get("enabled", True)),
            )
            imported.append(update_mcp_server(db, existing, upd, actor=actor))
        else:
            cr = McpServerCreate(
                slug=slug,
                name=str(cfg.get("name") or slug),
                description=str(cfg.get("description") or "") or None,
                category=str(cfg.get("category") or "custom"),
                transport=transport,  # type: ignore[arg-type]
                command=str(cfg.get("command") or "") or None,
                args=args_val,
                env=env_val,
                cwd=str(cfg.get("cwd") or "") or None,
                url=str(cfg.get("url") or "") or None,
                headers=hdr_val,
                tool_loading=tool_loading,  # type: ignore[arg-type]
                enabled=bool(cfg.get("enabled", True)),
            )
            imported.append(create_mcp_server(db, cr, actor=actor))
    return imported


def push_mcp_servers(
    db: Session,
    docker: BaseSandboxRuntime,
    servers: list[McpServer],
    sandboxes: list[Sandbox],
    *,
    action: str = "push",
    actor: str | None = None,
) -> dict[str, Any]:
    upsert_map: dict[str, dict[str, Any]] = {}
    remove_slugs: list[str] = []
    if action == "remove":
        remove_slugs = [s.slug for s in servers]
    else:
        upsert_map = {s.slug: mcp_server_to_runtime_entry(s) for s in servers}

    results: list[dict[str, Any]] = []
    target_ids = [s.id for s in servers]
    for sbx in sandboxes:
        try:
            res = docker.sync_mcp_servers(
                sbx,
                upsert_servers=upsert_map if upsert_map else None,
                remove_slugs=remove_slugs if remove_slugs else None,
            )
        except Exception as exc:
            res = {"slug": sbx.slug, "sandbox_id": sbx.id, "ok": False, "skipped": False, "detail": str(exc)}
        if res.get("ok"):
            cur = sbx.mcp_server_ids
            if action == "remove":
                sbx.mcp_server_ids_json = json.dumps([x for x in cur if x not in target_ids])
            else:
                merged = list(dict.fromkeys([*cur, *target_ids]))
                sbx.mcp_server_ids_json = json.dumps(merged)
        results.append(res)

    synced = sum(1 for r in results if r.get("ok"))
    skipped = sum(1 for r in results if r.get("skipped"))
    failed = len(results) - synced - skipped
    slugs_label = ",".join(s.slug for s in servers[:5])
    if len(servers) > 5:
        slugs_label += f",+{len(servers) - 5}"
    audit(
        db,
        "mcp.remove" if action == "remove" else "mcp.push",
        target=slugs_label or "none",
        actor=actor,
        detail=f"action={action},synced={synced}/{len(results)},skipped={skipped}",
    )
    db.commit()
    return {
        "action": action,
        "items": [s.slug for s in servers],
        "synced": synced,
        "skipped": skipped,
        "failed": failed,
        "total": len(results),
        "results": results,
    }


def sync_bound_mcp_servers(
    db: Session,
    docker: BaseSandboxRuntime,
    sandbox: Sandbox,
    *,
    actor: str | None = None,
) -> dict[str, Any] | None:
    bound_ids = sandbox.mcp_server_ids
    if not bound_ids:
        return None
    servers = list(
        db.scalars(select(McpServer).where(McpServer.id.in_(bound_ids))).all()
    )
    if not servers:
        return None
    return push_mcp_servers(db, docker, servers, [sandbox], action="push", actor=actor)


# ---------------------------------------------------------------------------
# Agent Skill Seeding, CRUD & Push
# ---------------------------------------------------------------------------


def ensure_default_skills(db: Session) -> None:
    """Idempotently seed the built-in Agent Skills catalog on startup."""
    changed = False
    for spec in BUILTIN_SKILLS:
        existing = db.scalar(select(SkillItem).where(SkillItem.slug == spec["slug"]))
        if existing is not None:
            # Backfill bundled resources onto untouched built-in skills upgraded from older DBs
            if (
                existing.is_builtin
                and not existing.extra_files
                and spec.get("extra_files")
            ):
                existing.extra_files_json = json.dumps(
                    spec.get("extra_files") or {}, ensure_ascii=False
                )
                existing.content = spec["content"]
                changed = True
            continue
        db.add(
            SkillItem(
                slug=spec["slug"],
                name=spec["name"],
                description=spec["description"],
                when_to_use=spec.get("when_to_use"),
                category=spec["category"],
                content=spec["content"],
                extra_files_json=json.dumps(spec.get("extra_files") or {}, ensure_ascii=False),
                disable_model_invocation=False,
                user_invocable=True,
                is_builtin=True,
                created_by="system",
            )
        )
        changed = True
    if changed:
        db.commit()


def seed_builtin_skills(
    db: Session,
    *,
    overwrite: bool = False,
    actor: str | None = None,
) -> list[SkillItem]:
    count = 0
    for spec in BUILTIN_SKILLS:
        existing = db.scalar(select(SkillItem).where(SkillItem.slug == spec["slug"]))
        if existing is None:
            db.add(
                SkillItem(
                    slug=spec["slug"],
                    name=spec["name"],
                    description=spec["description"],
                    when_to_use=spec.get("when_to_use"),
                    category=spec["category"],
                    content=spec["content"],
                    extra_files_json=json.dumps(spec.get("extra_files") or {}, ensure_ascii=False),
                    disable_model_invocation=False,
                    user_invocable=True,
                    is_builtin=True,
                    created_by="system",
                )
            )
            count += 1
        elif overwrite:
            existing.name = spec["name"]
            existing.description = spec["description"]
            existing.when_to_use = spec.get("when_to_use")
            existing.category = spec["category"]
            existing.content = spec["content"]
            existing.extra_files_json = json.dumps(spec.get("extra_files") or {}, ensure_ascii=False)
            existing.is_builtin = True
            count += 1
    audit(db, "skill.seed_builtins", target="skills", detail=f"count={count},overwrite={overwrite}", actor=actor)
    db.commit()
    return list_skills(db)


def list_skills(db: Session) -> list[SkillItem]:
    return list(
        db.scalars(
            select(SkillItem).order_by(SkillItem.is_builtin.desc(), SkillItem.slug.asc())
        ).all()
    )


def create_skill(
    db: Session,
    payload: SkillCreate,
    *,
    actor: str | None = None,
) -> SkillItem:
    slug = payload.slug.strip()
    if db.scalar(select(SkillItem).where(SkillItem.slug == slug)):
        raise Conflict(f"Skill 标识 '{slug}' 已存在")
    skill = SkillItem(
        slug=slug,
        name=payload.name.strip(),
        description=payload.description.strip(),
        when_to_use=(payload.when_to_use or "").strip() or None,
        category=(payload.category or "custom").strip() or "custom",
        content=payload.content,
        extra_files_json=json.dumps(payload.extra_files or {}, ensure_ascii=False),
        disable_model_invocation=bool(payload.disable_model_invocation),
        user_invocable=bool(payload.user_invocable),
        is_builtin=False,
        created_by=actor,
    )
    db.add(skill)
    audit(db, "skill.create", target=skill.slug, actor=actor)
    db.commit()
    db.refresh(skill)
    return skill


def update_skill(
    db: Session,
    skill: SkillItem,
    payload: SkillUpdate,
    *,
    actor: str | None = None,
) -> SkillItem:
    if payload.name is not None:
        skill.name = payload.name.strip()
    if payload.description is not None:
        skill.description = payload.description.strip()
    if payload.when_to_use is not None:
        skill.when_to_use = payload.when_to_use.strip() or None
    if payload.category is not None:
        skill.category = payload.category.strip() or "custom"
    if payload.content is not None:
        skill.content = payload.content
    if payload.extra_files is not None:
        skill.extra_files_json = json.dumps(payload.extra_files, ensure_ascii=False)
    if payload.disable_model_invocation is not None:
        skill.disable_model_invocation = bool(payload.disable_model_invocation)
    if payload.user_invocable is not None:
        skill.user_invocable = bool(payload.user_invocable)

    audit(db, "skill.update", target=skill.slug, actor=actor)
    db.commit()
    db.refresh(skill)
    return skill


def delete_skill(
    db: Session,
    skill: SkillItem,
    *,
    actor: str | None = None,
) -> None:
    slug = skill.slug
    sid = skill.id
    for sbx in db.scalars(select(Sandbox).where(Sandbox.deleted_at.is_(None))).all():
        ids = sbx.skill_ids
        if sid in ids:
            sbx.skill_ids_json = json.dumps([x for x in ids if x != sid])
    audit(db, "skill.delete", target=slug, actor=actor)
    db.delete(skill)
    db.commit()


_MAX_ZIP_ENTRIES = 200
_MAX_ZIP_TOTAL_BYTES = 15 * 1024 * 1024
_MAX_ZIP_FILE_BYTES = 5 * 1024 * 1024


def encode_skill_resource(raw: bytes) -> str:
    """Encode UTF-8 text as plain text and binary resources as base64:<payload>."""
    if b"\x00" not in raw:
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            pass
    return "base64:" + base64.b64encode(raw).decode("ascii")


def decode_skill_resource(stored: str) -> bytes:
    text = str(stored or "")
    if text.startswith("base64:"):
        return base64.b64decode(text[7:].encode("ascii"))
    return text.encode("utf-8")


def _sanitize_slug_candidate(raw: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (raw or "").strip().lower()).strip("-")
    return cleaned[:64].strip("-")


def import_skill_zip(
    db: Session,
    zip_bytes: bytes,
    *,
    name: str | None = None,
    slug: str | None = None,
    category: str = "custom",
    overwrite: bool = False,
    filename_hint: str | None = None,
    actor: str | None = None,
) -> SkillItem:
    """Import an Agent Skill .zip bundle containing SKILL.md and optional resource directories."""
    if not zip_bytes:
        raise ValueError("上传的 ZIP 文件为空")
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
    except zipfile.BadZipFile as exc:
        raise ValueError("无效的 ZIP 压缩包") from exc

    with zf:
        raw_entries: dict[str, bytes] = {}
        total_bytes = 0
        for info in zf.infolist():
            if info.is_dir():
                continue
            # Reject Unix symlinks in zip
            unix_mode = (info.external_attr >> 16) & 0o170000
            if unix_mode == stat.S_IFLNK:
                raise ValueError(f"压缩包包含不安全的符号链接: {info.filename}")

            clean = info.filename.replace("\\", "/").lstrip("/")
            if not clean:
                continue
            parts = [p for p in clean.split("/") if p]
            if not parts:
                continue
            if any(p == ".." for p in parts):
                raise ValueError(f"压缩包包含非法路径: {info.filename}")
            # Ignore OS metadata & VCS directories
            if parts[0] == "__MACOSX" or ".git" in parts or parts[-1] == ".DS_Store":
                continue

            if len(raw_entries) >= _MAX_ZIP_ENTRIES:
                raise ValueError(f"压缩包文件数超过上限 ({_MAX_ZIP_ENTRIES})")
            if info.file_size > _MAX_ZIP_FILE_BYTES:
                raise ValueError(f"压缩包单文件过大: {info.filename} (最大 5MB)")
            data = zf.read(info)
            total_bytes += len(data)
            if total_bytes > _MAX_ZIP_TOTAL_BYTES:
                raise ValueError("压缩包解压后总大小超过 15MB 限制")
            raw_entries["/".join(parts)] = data

    skill_md_candidates = sorted(
        (p for p in raw_entries if p.rsplit("/", 1)[-1].lower() == "skill.md"),
        key=lambda p: (p.count("/"), len(p)),
    )
    if not skill_md_candidates:
        raise ValueError("压缩包中缺少 SKILL.md 文件")

    skill_md_path = skill_md_candidates[0]
    root_prefix = skill_md_path.rsplit("/", 1)[0] + "/" if "/" in skill_md_path else ""
    wrapper_name = skill_md_path.rsplit("/", 1)[0].rsplit("/", 1)[-1] if root_prefix else ""

    try:
        skill_md_text = raw_entries[skill_md_path].decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("SKILL.md 必须是 UTF-8 编码文本") from exc

    parsed = parse_skill_markdown(skill_md_text)
    fallback_stem = (filename_hint or "").rsplit(".", 1)[0]
    resolved_slug = (
        (slug or "").strip()
        or (parsed["slug"] or "").strip()
        or _sanitize_slug_candidate(wrapper_name or fallback_stem)
    )
    if not resolved_slug or not _SKILL_SLUG_RE.fullmatch(resolved_slug):
        raise ValueError("Skill 标识 (name/slug) 必须为 kebab-case（如 code-review-checklist）")

    extra_raw: dict[str, str] = {}
    for rel, content_bytes in sorted(raw_entries.items()):
        if rel == skill_md_path:
            continue
        if root_prefix:
            if not rel.startswith(root_prefix):
                continue
            sub_rel = rel[len(root_prefix) :]
        else:
            sub_rel = rel
        if not sub_rel or sub_rel.lower() == "skill.md":
            continue
        extra_raw[sub_rel] = encode_skill_resource(content_bytes)

    extra_files = _validate_safe_extra_files(extra_raw)
    description = parsed["description"] or f"Imported skill bundle {resolved_slug}"
    body = parsed["content"] or f"# {resolved_slug}\n"
    display_name = (name or "").strip() or resolved_slug

    existing = db.scalar(select(SkillItem).where(SkillItem.slug == resolved_slug))
    if existing is not None:
        if not overwrite:
            raise Conflict(f"Skill '{resolved_slug}' 已存在（可开启覆盖导入）")
        saved = update_skill(
            db,
            existing,
            SkillUpdate(
                name=display_name,
                description=description,
                when_to_use=parsed["when_to_use"],
                category=category,
                content=body,
                extra_files=extra_files,
                disable_model_invocation=parsed["disable_model_invocation"],
                user_invocable=parsed["user_invocable"],
            ),
            actor=actor,
        )
    else:
        saved = create_skill(
            db,
            SkillCreate(
                slug=resolved_slug,
                name=display_name,
                description=description,
                when_to_use=parsed["when_to_use"],
                category=category,
                content=body,
                extra_files=extra_files,
                disable_model_invocation=parsed["disable_model_invocation"],
                user_invocable=parsed["user_invocable"],
            ),
            actor=actor,
        )
    audit(
        db,
        "skill.import_zip",
        target=saved.slug,
        detail=f"resources={len(extra_files)},overwrite={overwrite}",
        actor=actor,
    )
    db.commit()
    return saved


def export_skill_zip(skill: SkillItem) -> tuple[str, bytes]:
    """Package a SkillItem (SKILL.md + all bundled resource files) into a clean .zip bundle."""
    buf = io.BytesIO()
    prefix = skill.slug
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{prefix}/SKILL.md", render_skill_markdown(skill).encode("utf-8"))
        for rel, stored in sorted(skill.extra_files.items()):
            raw_bytes = decode_skill_resource(stored)
            zi = zipfile.ZipInfo(f"{prefix}/{rel}")
            is_exec = rel.startswith("scripts/") or rel.lower().endswith((".sh", ".bash", ".py"))
            mode = 0o755 if is_exec else 0o644
            zi.external_attr = (stat.S_IFREG | mode) << 16
            zf.writestr(zi, raw_bytes)
    return f"{skill.slug}.zip", buf.getvalue()


def import_skill_markdown(
    db: Session,
    payload: SkillImportRequest,
    *,
    actor: str | None = None,
) -> SkillItem:
    parsed = parse_skill_markdown(payload.markdown)
    slug = (payload.slug or parsed["slug"] or "").strip()
    if not slug or not _SKILL_SLUG_RE.fullmatch(slug):
        raise ValueError("Skill name/slug 必须为 kebab-case（如 code-review-checklist）")
    description = parsed["description"] or f"Imported skill {slug}"
    body = parsed["content"] or f"# {slug}\n"
    display_name = (payload.name or "").strip() or slug

    existing = db.scalar(select(SkillItem).where(SkillItem.slug == slug))
    if existing is not None:
        if not payload.overwrite:
            raise Conflict(f"Skill '{slug}' 已存在（可开启覆盖导入）")
        return update_skill(
            db,
            existing,
            SkillUpdate(
                name=display_name,
                description=description,
                when_to_use=parsed["when_to_use"],
                category=payload.category,
                content=body,
                disable_model_invocation=parsed["disable_model_invocation"],
                user_invocable=parsed["user_invocable"],
            ),
            actor=actor,
        )

    return create_skill(
        db,
        SkillCreate(
            slug=slug,
            name=display_name,
            description=description,
            when_to_use=parsed["when_to_use"],
            category=payload.category,
            content=body,
            disable_model_invocation=parsed["disable_model_invocation"],
            user_invocable=parsed["user_invocable"],
        ),
        actor=actor,
    )


def push_skills(
    db: Session,
    docker: BaseSandboxRuntime,
    skills: list[SkillItem],
    sandboxes: list[Sandbox],
    *,
    action: str = "push",
    actor: str | None = None,
) -> dict[str, Any]:
    upsert_list: list[dict[str, Any]] = []
    remove_slugs: list[str] = []
    if action == "remove":
        remove_slugs = [s.slug for s in skills]
    else:
        upsert_list = [
            {
                "slug": s.slug,
                "skillMd": render_skill_markdown(s),
                "extraFiles": s.extra_files,
            }
            for s in skills
        ]

    results: list[dict[str, Any]] = []
    target_ids = [s.id for s in skills]
    for sbx in sandboxes:
        try:
            res = docker.sync_skills(
                sbx,
                upsert_skills=upsert_list if upsert_list else None,
                remove_slugs=remove_slugs if remove_slugs else None,
            )
        except Exception as exc:
            res = {"slug": sbx.slug, "sandbox_id": sbx.id, "ok": False, "skipped": False, "detail": str(exc)}
        if res.get("ok"):
            cur = sbx.skill_ids
            if action == "remove":
                sbx.skill_ids_json = json.dumps([x for x in cur if x not in target_ids])
            else:
                merged = list(dict.fromkeys([*cur, *target_ids]))
                sbx.skill_ids_json = json.dumps(merged)
        results.append(res)

    synced = sum(1 for r in results if r.get("ok"))
    skipped = sum(1 for r in results if r.get("skipped"))
    failed = len(results) - synced - skipped
    slugs_label = ",".join(s.slug for s in skills[:5])
    if len(skills) > 5:
        slugs_label += f",+{len(skills) - 5}"
    audit(
        db,
        "skill.remove" if action == "remove" else "skill.push",
        target=slugs_label or "none",
        actor=actor,
        detail=f"action={action},synced={synced}/{len(results)},skipped={skipped}",
    )
    db.commit()
    return {
        "action": action,
        "items": [s.slug for s in skills],
        "synced": synced,
        "skipped": skipped,
        "failed": failed,
        "total": len(results),
        "results": results,
    }


def sync_bound_skills(
    db: Session,
    docker: BaseSandboxRuntime,
    sandbox: Sandbox,
    *,
    actor: str | None = None,
) -> dict[str, Any] | None:
    bound_ids = sandbox.skill_ids
    if not bound_ids:
        return None
    skills = list(
        db.scalars(select(SkillItem).where(SkillItem.id.in_(bound_ids))).all()
    )
    if not skills:
        return None
    return push_skills(db, docker, skills, [sandbox], action="push", actor=actor)
