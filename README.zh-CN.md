<p align="center">
  <img src="manager/frontend/public/favicon.svg" alt="Metis Logo" width="72" height="72" />
</p>

<h1 align="center">Metis</h1>

<p align="center">
  <strong>自托管企业级数字员工云与多智能体协同平台。</strong><br/>
  取名自古希腊实用智慧与谋略女神 Metis —— 面向研发、产品、测试、运维、财务、法务、HR、运营与数据分析等全公司岗位。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/Gateway-Traefik%20v3.7-24a1c1" alt="Gateway: Traefik v3.7" />
  <img src="https://img.shields.io/badge/Runtime-Docker%20%7C%20Remote%20Docker%20%7C%20Kubernetes-326ce5" alt="Runtime: Docker / K8s" />
  <img src="https://img.shields.io/badge/Database-SQLite%20%7C%20PostgreSQL%20%7C%20MySQL-009688" alt="Database: SQLite / Postgres / MySQL" />
  <img src="https://img.shields.io/badge/Console-React%2019%20%2B%20Tailwind%20v4-61dafb" alt="Console: React 19" />
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

---

**Metis** 用于为企业编排相互隔离、数据持久化、可自主协作的**数字员工云工位**，通过单端口 **Traefik v3.7** 动态网关与模块化 **FastAPI + React 19** 控制平面，为全公司不同岗位提供统一的岗位画像与私有 SOP、多模型热推送、企业凭据与 MCP 保险箱、任务派发与人工审批、入站事件 Webhook 自动唤醒、在线预览发布、Token 预算治理以及服务端一键快照回滚。

## 架构概览

```text
                        ┌──────────────────────────────────────────────────────┐
                        │            Traefik v3.7 统一网关 (:9000)             │
                        │       单域名动态 HTTP Provider 路由 + ForwardAuth     │
                        └───────────┬──────────────────────────────┬───────────┘
                                    │                              │
            /, /admin, /my,         │                              │ /s/<slug>/*
            /api/*, /plugins/*      ▼                              ▼
                 ┌──────────────────────────────────┐   ┌─────────────────────────────────┐
                 │ Metis 管理控制平面 (:9000)       │   │ 数字员工独立容器 / Pod           │
                 │ FastAPI（模块化路由与领域服务）  │   │ 本地 Docker / 远程 TLS / K8s    │
                 │ SQLite / PostgreSQL / MySQL      │   │ Caddy + Agent OS (Gateway Auth) │
                 │ React 19 控制台 & 个人门户       │   │ 用户级 supervisord + cron + mesh│
                 │ 内置插件仓库 + 服务端快照中心    │   │ /home/workspace 持久化存储卷    │
                 └──────────────────────────────────┘   └─────────────────────────────────┘
```

### 多运行时与零端口暴露隔离

- **多容器调度后端（`SANDBOX_RUNTIME`）**：
  - **本地 Docker**：通过宿主机 `/var/run/docker.sock` 运行在内网桥接网络中，零宿主机端口暴露。
  - **远程 Docker（TLS / SSH）**：配置 `DOCKER_HOST` 与 `DOCKER_PUBLIC_HOST` 即可跨机编排，自动映射临时端口并由 Traefik HTTP Provider 动态路由。
  - **Kubernetes（`SANDBOX_RUNTIME=kubernetes`）**：为每位数字员工编排 `StatefulSet` + `PVC` + `Service`，无缝对接 Traefik 动态路由或 CRD。
- **多关系型数据库（`DATABASE_URL`）**：单机开箱即用 SQLite，生产环境无缝切换 PostgreSQL / MySQL（支持自动 Schema 迁移与连接池）。
- **精细化访问边界（Traefik ForwardAuth + `@metis/gateway-auth`）**：
  - 数字员工工位（`/s/<slug>/`、`/s/<slug>/dsh/*`）通过 HMAC 签名网关头严格校验仅归属人或平台管理员可访问（零重定向直达 DSH）。
  - 发布的预览应用（`/s/<slug>/apps/<name>/`）支持按员工独立切换 **公开免登（Public）** 或 **仅登录成员（Authenticated）**，同时保留 `sandbox-mesh` 跨员工加密协同通信（`/s/<slug>/p/4090`）。

## 企业全链路核心能力

### 1. 岗位体系、团队协同与白标定制
- **14 套全公司标准岗位模板**：一键导入覆盖**研发产研**（架构师/Tech Lead、全栈、前端、后端、QA 测试、DevOps/SRE、产品经理、安全审计）与**职能业务**（行政高管助理、财务经营分析、法务合规审查、HR 招聘专员、市场内容运营、商业数据分析 BI），内置职责名片与私有作业规范（SOP）。
- **一键组建跨岗位项目组 + 共享知识目录**：自动完成组内成员两两加密互信配对（`sandbox-mesh`）、指定统筹主持人（Moderator）建群，并在每位成员的 `/home/workspace/shared/` 下自动写入 `TEAM_README.md` 与项目背景文档 `PROJECT_BRIEF.md`。
- **一键克隆数字员工**：完整复制镜像、岗位画像、SOP、模型配置以及 `/home/workspace` 代码文件与长期记忆。
- **白标品牌与主题设计 Token**：支持在控制台实时修改品牌名称、**上传/粘贴左上角自定义 Logo SVG**、**自定义浏览器 Favicon**（服务端严格 SVG 安全清洗防 XSS），以及配置全站 **主题与 Brand Design Tokens**（Dark / Light / Slate 三套基调、5 套企业预设、主色/强调色、圆角风格、字号缩放、可视宽度，支持实时预览与顶栏明暗快捷切换）。

### 2. 需求接入、人工审批与外部事件驱动
- **可视化任务派发 & 人工审批中心**：可在 `/admin` 或 `/my` 的「数字员工运行态与交付中心」直接派发带优先级与审批开关的任务，并对关键节点一键 **批准 / 驳回**。
- **入站事件 Webhook（`/api/webhooks/sandboxes/{slug}`）**：对接 GitHub、GitLab、飞书、企微、CI/CD 告警等外部事件，支持自动唤醒休眠中的数字员工并下发任务，支持后台一键重置密钥。

### 3. 研发与办公提效
- **企业凭据与 MCP 保险箱**：Fernet 加密存储 Git 身份、Git PAT、SSH 私钥（`id_ed25519`）、公共环境变量（`~/.dsh-sandbox/vault.env`）以及 MCP Servers 配置（`~/.dsh/mcp.json`），一键热下发至所有在岗数字员工，无需重建容器。
- **多协议大模型中枢**：统一管理 OpenAI Completions / Responses、Anthropic Messages、Google Gemini 等模型配置并热推送至运行中的数字员工。
- **在线预览发布、常驻服务与定时排班 CRUD**：在控制台直接新增/删除/启停 `sandbox-service` 服务并在线查看日志，一键发布/下线 `sandbox-expose` Web 预览端口，在线增删持久化 `sandbox-cron` 值守排班。

### 4. 安全治理、FinOps 与灾难恢复
- **多 OIDC 企业单点登录 & 混合认证**：后台可视化管理一个或多个 OIDC 提供方（Keycloak、Okta、Auth0、Authentik、飞书/企微 OIDC），支持 Discovery 连通性测试、邮箱域名白名单及本地密码开关。
- **Token 用量 FinOps 与自动休眠唤醒**：实时统计估算 Token 消耗、会话与协同消息数，支持为员工设置每日预算上限（`daily_token_limit`），配合闲置自动休眠与访问即秒级唤醒大幅节省算力。
- **服务端工作区快照中心**：秒级创建服务端工作区快照点并一键回滚（支持合并覆盖或清空重置），同时保留流式 `.tar` 导出与本地上传恢复。
- **自托管能力插件仓库（`@metis/*`）**：热挂载 `plugins/` 目录，自动提供 `/plugins/index.json`、`.tgz` 分发与只读 npm 仓库，默认预装全套 `@metis/*` 内置插件（`@metis/file-manager`、`@metis/workspace-user`、`@metis/custom-theme`、`@metis/sandbox-mesh`、`@metis/sandbox-memory` 与 **`@metis/work-delivery`** —— 只读优先的工作与交付中心，支持搜索筛选、折叠详情与分页浏览，通过 AI 对话直接创建交付物）。

## 仓库目录结构

```text
.
├── LICENSE                         # MIT 开源协议
├── README.md                       # 英文文档
├── README.zh-CN.md                 # 中文文档
├── sandbox/                        # 数字员工运行时镜像、Caddy、supervisord 与内置工具链
│   ├── Dockerfile                  # 参数化运行时镜像构建
│   ├── toolchain/                  # 可插拔构建期工具链 (/opt/toolchain)
│   ├── docs/                       # 架构、运维、OIDC、安全与故障排查文档
│   ├── tests/                      # Token 辅助脚本单测与容器内脚本测试
│   └── rootfs/                     # 启动脚本、Caddy 渲染器、CLI 与 Agent Skills
├── manager/                        # Metis 控制平面、Traefik 网关与 React 19 前端
│   ├── app/
│   │   ├── main.py                 # FastAPI 入口、生命周期、中间件与 SPA 路由
│   │   ├── deps.py                 # 鉴权守卫、序列化器与自动唤醒工具
│   │   ├── config.py / db.py / models.py / schemas.py / security.py / oidc.py / scheduler.py
│   │   ├── routers/                # 领域路由（system, auth, plugins, admin, sandboxes, workforce）
│   │   ├── services/               # 领域服务包（common, templates, sandboxes, policies, vault）
│   │   └── runtime/                # 多运行时抽象（base, traefik, sync, workforce, operations, docker, k8s）
│   ├── frontend/                   # React 19 + TypeScript + Vite 7 + Tailwind v4 SPA
│   │   ├── public/favicon.svg      # 默认 Metis 徽标
│   │   └── src/
│   │       ├── App.tsx / types.ts  # 应用主壳层与公共类型
│   │       ├── lib/                # API 客户端、格式化工具、国际化与中英文词典
│   │       ├── components/         # UI 基础组件、BrandMark、备份快照与运行态交付中心
│   │       └── views/              # 登录页、个人门户与模块化管理台 views/admin/*
│   ├── tests/                      # 完整 pytest 测试套件
│   ├── docker-compose.yml          # Traefik v3.7 网关 + Metis 控制平面编排
│   └── .env.example                # 环境变量模板（Docker / 远程 Docker / K8s / SQLite / PG / MySQL）
└── plugins/                        # 热挂载内置插件与索引元数据
    ├── file-manager/               # 服务端文件管理器
    ├── workspace-user/             # 用户身份与快捷入口栏
    ├── custom-theme/               # 主题与品牌定制插件
    ├── sandbox-mesh/               # 跨员工加密互联、主持人项目群聊、任务板与人工审批
    └── sandbox-memory/             # 低 Token 环境感知与长期记忆中心
```

## 快速开始

### 1. 构建运行时镜像

```bash
cd sandbox
cp .env.example .env
docker compose build
```

如需启用国内镜像源或安装 `sandbox/toolchain/toolchain.d/*.sh` 自定义工具链：

```bash
docker build \
  --build-arg APT_MIRROR=https://mirrors.aliyun.com \
  --build-arg NODE_MIRROR=https://mirrors.aliyun.com/nodejs-release \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
  --build-arg INSTALL_TOOLCHAIN=true \
  -t dsh-sandbox:latest ./sandbox
```

### 2. 启动 Metis 网关与管理控制台

```bash
cd manager
cp .env.example .env
# 修改 SECRET_KEY（建议 openssl rand -hex 32）与 MANAGER_ADMIN_TOKEN（或在控制台配置 OIDC）
# 可选：配置 DATABASE_URL 切换 PostgreSQL/MySQL，或配置 SANDBOX_RUNTIME=kubernetes / DOCKER_HOST
docker compose up -d --build
```

访问入口：

- 管理控制台：`http://localhost:9000/admin`
- 员工个人门户：`http://localhost:9000/my`
- 健康检查：`http://localhost:9000/healthz`
- 插件发现索引：`http://localhost:9000/plugins/index.json`

## 自动化测试

```bash
# 1. Manager 后端测试（pytest）
cd manager && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt && pytest -v

# 2. Manager 前端类型检查、单测与构建（Yarn 4）
cd manager/frontend && corepack yarn install --immutable && corepack yarn typecheck && corepack yarn test && corepack yarn build

# 3. Sandbox 辅助脚本与容器测试
node --test sandbox/tests/test_gateway_auth.mjs sandbox/tests/test_metis_dsh_config.mjs
docker run --rm --entrypoint /bin/bash -v "$PWD:/repo:ro" dsh-sandbox:latest /repo/sandbox/tests/test_sandbox_scripts.sh /repo

# 4. 内置插件测试
for p in file-manager workspace-user custom-theme sandbox-mesh sandbox-memory work-delivery; do
  docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" \
    -w "/work/plugins/$p" dsh-sandbox:latest -c "node .test/run.mjs"
done
```

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
