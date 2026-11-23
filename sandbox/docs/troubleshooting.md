# 故障排查

## 入口与认证

| 现象 | 排查 |
| --- | --- |
| `/` 不是 DSH | Caddy 应 302 到 `${DSH_MOUNT}/`；检查 `DSH_MOUNT` 和 Caddy 日志 |
| `/dsh/` 502 | 容器内 DSH 没起，或外层 Traefik 无法连接容器 `:8080`；看 `[program:dsh]` 和 `dsh-manager` 日志 |
| 一直跳 IdP / 登录循环 | 检查 `manager/.env` 中的 `MANAGER_PUBLIC_URL` 与实际访问 scheme/host 是否一致；IdP 是否登记 `<MANAGER_PUBLIC_URL>/auth/callback` |
| 登录成功但 403 | 当前登录账号既不是工作区 owner，也不是 `platform_admins`，或账号已被管理员禁用 |
| `/dsh/` 返回 401 或要求 token | 确认沙箱已升级到 `dsh-sandbox:latest`（启用 `@metis/gateway-auth`），并检查 Traefik ForwardAuth `authResponseHeaders` 包含 `X-Metis-Gateway-Auth` 且容器内 `METIS_GATEWAY_AUTH_SECRET` 与 Manager 派生一致 |
| `/apps/*` 不跳登录 | 正常，apps 默认开放；鉴权由服务自己实现 |
| `/apps/*` 403 | 服务自己的认证拒绝了请求；与网关鉴权无关 |

## 服务

| 现象 | 排查 |
| --- | --- |
| `sandbox-service` 找不到服务 | `sandbox-service list`；检查 `~/.dsh-sandbox/services/conf.d` |
| 服务 FATAL / 反复重启 | `sandbox-service logs <name>` 和 `~/logs/<name>.err` |
| `/apps/x/` 404 | `sandbox-expose --list`；确认端口和前缀；检查 Caddy 日志 |
| `/apps/x/` 502 | 路由存在但后端没监听；`curl 127.0.0.1:<port>` |
| 页面能开但 JS/CSS 404 | 应用 base path 不是 `/apps/<name>/` |
| WebSocket 反复重连 | 外层代理是否转发 Upgrade；Caddy 内已配置长连接 |
| `/p/<port>/` 502 | 端口没有服务；检查服务是否监听 `127.0.0.1:<port>` |
| `/p/<port>/` 404 | 命中了保留端口，或端口不合法 |

## 非 root 无法执行系统命令

| 现象 | 原因 / 处理 |
| --- | --- |
| `runuser: failed to execute env/cp: Permission denied` | 检查 `/usr`、`/etc` 是否被 `COPY rootfs/ /` 带成了 `750`；Dockerfile 必须在 COPY 后 `chmod 0755 /usr /etc /usr/local /usr/local/bin` |
| `libc.so.6: cannot open shared object file: Permission denied` | 同上，通常是 `/usr` 或 `/usr/lib` 父目录不可穿过，不是 libc 文件本身 |

Git 不记录目录权限；服务器 checkout 的 `umask 027` 会让 `rootfs/usr` 变成 `750`，
`COPY rootfs/ /` 再把目标 `/usr` 设成 `750`。所以必须显式规范化目录模式。

## 环境与启动

| 现象 | 排查 |
| --- | --- |
| 改了 `.env` 不生效 | 容器 env 在创建时固定；需要重建容器，不能只 restart |
| `MANAGER_AUTH_MODE=oidc` 启动报错 | 确认 `manager/.env` 已配置 `OIDC_ISSUER_URL`（或 `OIDC_DISCOVERY_URL`）、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET` |
| 构建失败在 Docker Hub | 用 `DOCKER_REGISTRY=your-registry.example.com/docker` 等代理前缀 |
| apt 很慢 | 设置 `APT_MIRROR=https://mirrors.aliyun.com` |
| Node.js 下载慢或失败 | 设置 `NODE_MIRROR=https://mirrors.aliyun.com/nodejs-release` |
| `uv` 安装慢或 PyPI 失败 | 设置 `PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/` |
| Healthcheck 不出现 | Podman 使用 `--format docker` 构建；OCI 会丢弃 HEALTHCHECK |
| 容器启动后立刻退出 | `docker compose logs` / `podman logs`；常见是 env 缺失或目录权限 |

## 持久化与权限

| 现象 | 排查 |
| --- | --- |
| 容器重建后工作文件丢失 | volume 没挂到 `/home/workspace` |
| bind mount 不可写 | `sudo chown -R 1000:1000 ./home`，或用 `WORKSPACE_UID/WORKSPACE_GID` 重建 |
| 容器重建后服务没恢复 | 检查 `~/.dsh-sandbox/services/conf.d` 是否在 volume 中；`sandbox-service list` |
| 修改 skill 不生效 | 确认在 `~/.dsh/skills`，并开新会话；DSH 监视目录变化 |

## 快速诊断命令

```bash
docker compose logs -f
docker compose exec sandbox curl -fsS http://127.0.0.1:8080/healthz
docker compose exec sandbox supervisorctl -c /etc/supervisor/supervisord.conf status
docker compose exec -u workspace sandbox supervisorctl -c /home/workspace/.dsh-sandbox/services/supervisord.conf status
docker compose exec -u workspace sandbox sandbox-expose --list
```

外层代理/隧道还需要确认：

- 保留了原始 `Host`；
- 转发 WebSocket `Upgrade`；
- 没有把 `X-Forwarded-Proto` 固定错；
- 没有额外的 path rewrite。