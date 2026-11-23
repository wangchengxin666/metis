# DSH Sandbox

一个容器、一个端口，交付完整的 DeepSeek Harness 开发环境。

`Node 24` · `Python 3.13` · `Caddy` · `supervisor`（可选 `/opt/toolchain` 扩展 `.NET` 等工具链）

---

## 概览

DSH Sandbox 把 DSH Web、开发工具链和长期运行的服务收进一个**单端口、非 root** 的容器。
浏览器只访问 Caddy；DSH 是唯一需要登录的入口，其他服务保持开放，由服务自己决定如何鉴权。

| 能力 | 说明 |
| --- | --- |
| **单一入口** | 对外统一经由 Traefik 网关进入容器 `:8080` Caddy（独立运行可映射 `${HOST_PORT:-8080}:8080`） |
| **开箱即用** | Node、Python、git、tmux、uv、pnpm、企业 CA、中文 locale/字体，支持通过 `INSTALL_TOOLCHAIN=true` 在镜像构建时按顺序执行 `toolchain/toolchain.d/*.sh` 安装自定义工具链至 `/opt/toolchain` |
| **DSH 专属认证** | `/s/<slug>/dsh/*` 由 Traefik + `dsh-manager` ForwardAuth（OIDC 或本地密码）鉴权；`/apps/*` 与 `/p/*` 默认开放 |
| **服务模型** | `sandbox-service` 管常驻进程，`sandbox-expose` 挂载 `/apps/<name>/` |
| **临时端口** | `/p/<port>/` 始终可用，适合快速验证 |
| **Agent 友好** | 内置 `sandbox-services` skill，告诉 agent 如何起服务、暴露 URL、排查问题 |
| **可复现** | 固定版本、构建参数与运行时 env 完全分离 |

## 架构

```text
                    ┌──────────────── dsh-sandbox ────────────────┐
Traefik / (:8080) ─▶│ Caddy                                      │
                    │ ├── /                 → 302 /dsh/          │
                    │ ├── /dsh/*            → DSH (Gateway Auth) │
                    │ ├── /apps/<name>/*    → user services      │
                    │ ├── /p/<port>/*       → loopback ports     │
                    │ └── /healthz          → 200                │
                    │                                            │
                    │ supervisor                                 │
                    │ ├── caddy                                  │
                    │ ├── dsh            (user: workspace)       │
                    │ └── user-services  (user: workspace)       │
                    └────────────────────────────────────────────┘
```

认证边界很窄：**只有 DSH** 由网关鉴权（平台管理员或工作区所属本人）。`/apps/*`、`/p/*` 默认公开，
鉴权由服务自己实现。

## 快速开始

```bash
cp .env.example .env
chmod 600 .env

# 独立调试可直接构建运行：
make up
```

打开：

```text
http://<host>:8080/
```

首页会跳转到 `/dsh/`。托管模式下，Traefik ForwardAuth 签发 `X-Metis-Gateway-Auth` HMAC 请求头，DSH 内的 `@metis/gateway-auth` 校验通过后直接放行（无需 token 重定向）；独立调试模式下可使用 `make token` 查看 DSH launch token。

手动运行：

```bash
docker run -d --name dsh-sandbox -p 18086:8080 \
  -e DSH_PUBLIC_URL=http://localhost:18086/dsh/ \
  -v dsh-sandbox-home:/home/workspace \
  dsh-sandbox:latest
```

## 访问与认证

| 路径 | 行为 |
| --- | --- |
| `/` | 302 到 `/dsh/` |
| `/dsh/*` | **Traefik ForwardAuth（Owner / Admin）+ `@metis/gateway-auth` HMAC 校验** |
| `/apps/<name>/` | 公开；服务自己实现鉴权 |
| `/p/<port>/` | 公开；临时端口转发 |
| `/healthz` | 公开健康检查 |

> `/apps/*` 和 `/p/*` 一旦暴露，任何能访问 8080 的人都能访问。需要登录、Bearer、
> mTLS 或 API key 时，请在你的服务内部实现。

## 文档

| 文档 | 内容 |
| --- | --- |
| [架构](docs/architecture.md) | 进程模型、路径规划、DSH token 流程 |
| [构建与运维](docs/operations.md) | 构建参数、env 分层、Compose、持久化 |
| [自定义工具链](toolchain/README.md) | `INSTALL_TOOLCHAIN=true` 与 `toolchain.d/*.sh` 扩展指南 |
| [服务与暴露](docs/services.md) | DSH 插件、`sandbox-service`、`sandbox-expose`、`sandbox-cron`、base path |
| [OIDC](docs/OIDC.md) | Manager 统一 OIDC + Traefik ForwardAuth 配置与 Keycloak 示例 |
| [安全模型](docs/security.md) | 认证边界、容器边界、CA、密钥 |
| [故障排查](docs/troubleshooting.md) | 登录、路由、服务、资源问题 |

## 安全与 CA

- 容器是安全边界：DSH 以 `workspace` 运行，没有 sudo，服务只在容器内监听。
- `ca-bundle.crt` 是公开 CA 证书集合（184 张），**不含私钥**；提交到内网仓库是安全的。
  如果安全策略不允许内部 CA 名称进入代码库，可在构建时从外部挂载或替换该文件。
- 不要把 `.env` 提交到仓库；它已在 `.gitignore` 中。
- 不要把 Caddy admin 或 DSH 的内部端口通过 `/p/` 暴露。

## 目录

```text
.
├── Dockerfile
├── docker-compose.yml
├── Makefile
├── .env.example              # 构建参数与单容器调试环境变量模板
├── docs/                     # 架构、构建、服务、OIDC、安全与排查文档
├── toolchain/                # 模块化工具链安装框架 (install.sh + toolchain.d/*.sh)
├── tests/                    # gateway-auth (Node) 与容器脚本测试 (Bash + Caddy)
├── ca-bundle.crt
└── rootfs/                   # entrypoint、Caddy、supervisor、skill、helper
```