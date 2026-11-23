# 架构

## 设计约束

- **一个容器**：DSH、Caddy、supervisor、用户服务都在同一个文件系统里。
- **零容器宿主机端口暴露（托管模式）**：所有外部流量经由外层 Traefik 网关转发至容器内 `:8080` Caddy，不向宿主机暴露 `18000+` 端口。
- **网关统一鉴权**：只有 DSH 相关路径由 Traefik + `dsh-manager` ForwardAuth（OIDC / 本地密码）校验身份；`/apps/*` 与 `/p/*` 服务默认开放，鉴权由服务自行实现。
- **非 root 用户隔离**：DSH 和用户服务以 `workspace` 运行；Caddy 使用独立系统用户。
- **可预期的路径**：所有对外 URL 都是 `/s/<slug>/...`（或独立调试时的 `/...`），不依赖额外 DNS 或端口。

## 进程模型

```text
PID 1  supervisord (root)
├── caddy             :8080
├── cron
├── user-services     用户级 supervisord (workspace)
│   └── 用户定义的服务
└── dsh               127.0.0.1:3080 (workspace)
```

容器级 supervisor 保证 Caddy、cron 和用户服务编排器在 DSH 重启时仍然运行。
DSH 进程自身崩溃时由 supervisor 拉起；用户服务由嵌套 supervisor 管理。

## 路径规划

```text
/s/<slug>/                302 /s/<slug>/dsh/         (Traefik ForwardAuth: owner / admin)
/s/<slug>/dsh/*           DSH Web GUI / API / WS     (Traefik ForwardAuth + @metis/gateway-auth)
/s/<slug>/apps/<name>/*   用户服务（sandbox-expose）  (默认公开，服务自行鉴权)
/s/<slug>/p/<port>/*      loopback 端口临时转发       (默认公开，服务自行鉴权)
/s/<slug>/healthz         Caddy 健康检查
```

除 DSH 入口和 `/dsh/*` 外，其余路径不经过平台 ForwardAuth。

## 认证流程

```text
Browser
  │  GET /s/<slug>/dsh/
  ▼
Traefik (:9000) ── ForwardAuth ──▶ dsh-manager /api/auth/verify-sandbox/<slug>
                                     │  校验 session / OIDC 或本地密码 / owner 或 admin
                                     │  未登录 → 302 /login 或 /auth/oidc/start
                                     │  无权限 → 403
                                     ▼  通过 (200) + 注入 X-Metis-Gateway-Auth (HMAC)
Caddy (:8080) ── 剥离 /dsh 前缀 ──▶ DSH (127.0.0.1:3080, @metis/gateway-auth 验签放行)
```

登录成功后访问 `/s/<slug>/dsh/` 直接返回 `200`（WebSocket 直接 `101`），无需中间重定向或额外 cookie。

## Caddy 的角色

DSH 以 origin-root 方式提供 `/api`、`/assets` 等路径，但浏览器通过 `/dsh/` 访问。
Caddy 必须：

- 剥掉 `/dsh` 前缀，再转给 `127.0.0.1:3080`；
- 把 DSH 的 `Set-Cookie: Path=/` 改写为 `Path=/dsh/`；
- 保留浏览器 `Host`，供 DSH 的 trusted-host 校验；
- 透传 WebSocket Upgrade，并关闭长连接缓冲；
- 把 `/dsh` 308 到 `/dsh/`，保证相对资源正确解析。

这些规则集中在 `rootfs/usr/local/bin/render-caddyfile.sh`，容器启动时生成 Caddyfile
并校验。

## 临时端口路由

`/p/<port>/...` 始终开启，反代到 `127.0.0.1:<port>`。它是公开的，适合临时调试。
以下内部端口永远被排除：

| 端口 | 用途 |
| --- | --- |
| `2019` | Caddy admin API |
| `3080` | DSH |
| `8080` | Caddy 自身（仅容器网络 / 网关转发，托管模式不暴露到宿主机） |

## 持久化

`/home/workspace` 是唯一需要持久化的目录：

- 用户工作区与项目文件直接保存在 `/home/workspace/` 下
- `.dsh/`（profile、session、模型配置、skill）
- `.dsh-sandbox/`（Caddy apps 路由、用户 supervisord 配置）
- `logs/`

Compose 使用 named volume；也可以 bind mount，但需要保证 UID `1000` 可写。