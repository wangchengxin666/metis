# DSH Dock

**面向 DeepSeek Harness (DSH) 的自托管多用户云端工作区与控制平面。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Gateway: Traefik v3.7](https://img.shields.io/badge/Gateway-Traefik%20v3.7-24a1c1)
![Backend: FastAPI + SQLite](https://img.shields.io/badge/Control%20Plane-FastAPI%20%2B%20SQLite-009688)
![Frontend: React 19](https://img.shields.io/badge/Console-React%2019%20%2B%20Tailwind%20v4-61dafb)

[English](README.md) · [简体中文](README.zh-CN.md)

---

DSH Dock（代码库 `dsh-dock`）用于在 Docker 宿主机上按用户编排持久化、相互隔离的 **DeepSeek Harness (DSH)** Agent OS 开发沙箱，并通过单入口 **Traefik v3.7** 网关与 **FastAPI + React** 管理平面提供统一认证、资源管控、工作区备份以及内建插件市场托管。

## 架构概览

```text
                        ┌──────────────────────────────────────────────┐
                        │        dsh-gateway (Traefik v3.7) :9000      │
                        │          单域名网关 + ForwardAuth             │
                        └───────┬──────────────────────────────┬───────┘
                                │                              │
        /, /admin, /my,         │                              │ /s/<slug>/*
        /api/*, /plugins/*      ▼                              ▼
                   ┌─────────────────────────┐    ┌─────────────────────────────┐
                   │ dsh-manager :9000       │    │ dsh-sbx-<slug> :8080        │
                   │ FastAPI + SQLite        │    │ （宿主机零端口暴露）         │
                   │ React 19 管理台 SPA     │    │ Caddy + DSH + dsh-token     │
                   │ 内置插件索引与 npm 仓库 │    │ 用户级 supervisord + cron    │
                   └─────────────────────────┘    │ /home/workspace 持久化数据卷 │
                                                  └─────────────────────────────┘
```

## 核心特性

- **零宿主机端口暴露 + 单域名子路径网关**：受管沙箱容器只接入内部 `dsh-manager` 网络，由 Traefik `:9000` 按 `/s/<slug>/...` 统一转发至容器内 `:8080` Caddy。
- **精细化认证边界（Traefik ForwardAuth）**：
  - `/s/<slug>/`、`/s/<slug>/dsh/*`、`/s/<slug>/_dsh-token` 统一由 `dsh-manager` 验证，仅允许**沙箱归属人本人或平台管理员**访问；
  - `/s/<slug>/apps/*` 与 `/s/<slug>/p/*` 默认开放，由用户服务自行实现鉴权；
  - 支持三种模式：`token`（管理员 Token + 本地用户 `scrypt` 密码登录与自助改密）、`oidc`（Keycloak / Auth0 / Authentik / Okta 企业单点登录）及 `none`。
- **完整 `/home/workspace` 持久化与一键备份**：
  - 默认工作目录 `WORKDIR /home/workspace`，所有项目文件、DSH profile/session、用户服务、crontab 与 Caddy 路由均持久化于用户独立 Docker Volume；
  - 平台支持直接流式导出 `<slug>-home.tar` 完整用户目录备份。
- **Agent 原生运维能力**：
  - 容器内预装 `sandbox-service`（用户级 supervisord）、`sandbox-expose`（动态发布 `/apps/<name>/` 路由）、`sandbox-cron`（持久化用户定时任务）及 `sandbox-services` agent skill。
- **模块化构建期工具链（`/opt/toolchain`）**：
  - 基础镜像轻量可控（默认 `INSTALL_TOOLCHAIN=false`，含 Debian 13、Node 24、Python 3.13、`uv`、`pnpm`、`git`、`Caddy`、`@deepseek-ai/dsh` 与中文字体/locale）；
  - 按需启用 `INSTALL_TOOLCHAIN=true` 时，按文件名顺序执行 `sandbox/toolchain/toolchain.d/*.sh`（内置 `10-dotnet.sh` 参考脚本），将 SDK 安装至 `/opt/toolchain` 并自动注入交互式 Shell、`DSH` 与 `user-services` 环境。
- **自托管插件索引与只读 npm 仓库**：
  - `dsh-manager` 热挂载 `plugins/` 目录，自动提供 `/plugins/index.json`、内联 SVG 图标、`.tgz` 打包下载及只读 `/plugins/npm/*` packument，默认预装并自启安装 `file-manager`、`workspace-user`、`custom-theme`、`sandbox-mesh`（支持跨沙箱一对一互联、LLM 主持人多沙箱群聊协同、文件互传与独立话题上下文隔离）与 `sandbox-memory`（低 Token 沙箱环境感知与跨会话长期记忆中心，支持自动捕获与可视化手动管理）。
- **企业内网与国内镜像友好**：支持 `DOCKER_REGISTRY`、`APT_MIRROR`（含 `https://mirrors.aliyun.com` 等 HTTPS 源）、`NODE_MIRROR`（如 `https://mirrors.aliyun.com/nodejs-release`）、`NPM_REGISTRY`、`PIP_INDEX_URL` 与自定义企业 CA 证书。

## 快速开始

### 1. 构建沙箱镜像

```bash
cd sandbox
cp .env.example .env
docker compose build
```

如需启用国内镜像源或安装 `sandbox/toolchain/toolchain.d/*.sh` 中的自定义工具链：

```bash
docker build \
  --build-arg APT_MIRROR=https://mirrors.aliyun.com \
  --build-arg NODE_MIRROR=https://mirrors.aliyun.com/nodejs-release \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
  --build-arg INSTALL_TOOLCHAIN=true \
  -t dsh-sandbox:latest ./sandbox
```

### 2. 启动管理端与网关

```bash
cd manager
cp .env.example .env
# 修改 SECRET_KEY（建议 openssl rand -hex 32）与 MANAGER_ADMIN_TOKEN 或 OIDC_* 配置
docker compose up -d --build
```

访问入口：

- 管理控制台：`http://localhost:9000/admin`
- 用户自助门户：`http://localhost:9000/my`
- 健康检查：`http://localhost:9000/healthz`
- 插件发现索引：`http://localhost:9000/plugins/index.json`

## 测试

```bash
# 1. Manager 后端单元与 Mock 测试
cd manager && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt && pytest -v

# 2. Manager 前端类型检查、单元测试与构建
cd manager/frontend && corepack yarn install --immutable && corepack yarn typecheck && corepack yarn test && corepack yarn build

# 3. Sandbox helper 与容器内脚本测试
node --test sandbox/tests/test_dsh_token.mjs
docker run --rm --entrypoint /bin/bash -v "$PWD:/repo:ro" dsh-sandbox:latest /repo/sandbox/tests/test_sandbox_scripts.sh /repo

# 4. 内置插件测试
docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" -w /work/plugins/file-manager dsh-sandbox:latest -c "node .test/run.mjs"
docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" -w /work/plugins/workspace-user dsh-sandbox:latest -c "node .test/run.mjs"
docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" -w /work/plugins/custom-theme dsh-sandbox:latest -c "node .test/run.mjs"
docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" -w /work/plugins/sandbox-mesh dsh-sandbox:latest -c "node .test/run.mjs"
docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" -w /work/plugins/sandbox-memory dsh-sandbox:latest -c "node .test/run.mjs"
```

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
