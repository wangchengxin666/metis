# 安全模型

## 认证边界

```text
/s/<slug>/           Traefik ForwardAuth (owner 或 admin)
/s/<slug>/dsh/*      Traefik ForwardAuth + @metis/gateway-auth HMAC 验签 (owner 或 admin)
/s/<slug>/apps/*     公开，服务自行鉴权
/s/<slug>/p/*        公开，服务自行鉴权
/s/<slug>/healthz    公开
```

平台鉴权完全集中在 `dsh-gateway` (Traefik) + `dsh-manager` ForwardAuth（兼容 `MANAGER_AUTH_MODE=oidc` SSO 与 `MANAGER_AUTH_MODE=token` 本地密码/Token 登录），容器内不再运行 `oauth2-proxy`。`/apps/*` 和 `/p/*` 默认开放，不经过 ForwardAuth。

这意味着：

- DSH 不会被未授权用户或非工作区本人打开；
- 你暴露的服务默认开放；
- 服务需要登录/token/API key 时，必须在服务内部实现；
- 不要依赖 `/p/` 或 `/apps/` 提供隐式安全。

## 容器边界

- 容器是安全边界。DSH 以 `workspace` 运行，`DSH_PERMISSION_MODE=danger-full-access`，
  agent 在容器内有完整文件/终端权限。
- OIDC client secret 保存在外层 `dsh-manager` 控制面，不再注入各个用户沙箱容器，降低了单容器内 secret 暴露面；用户配置的模型 API key 位于 `/home/workspace/.dsh`。
- 如需进一步限制出站访问，可通过防火墙或网络策略限制容器访问权限。
- 不要让 `workspace` 获得宿主机 Docker socket 或特权容器能力。

## 密钥

| 密钥 | 存放 |
| --- | --- |
| OIDC client secret / `SECRET_KEY` | `manager/.env`（gitignored，仅在控制面） |
| 模型 API key | 用户通过 Settings → Models 写入 `/home/workspace/.dsh` |
| DSH session 签名密钥 | `/home/workspace/.dsh` |
| CA 私钥 | 不在仓库中 |

`.env` 不提交。构建参数在 Dockerfile ARG 默认值里；仓库只包含
`.env.example`。

## CA 证书

`ca-bundle.crt` 是公开 CA 证书集合（184 张），不包含私钥。提交到内部仓库在技术上
是安全的；它可能包含内部 CA 的名称/主题信息。

如果安全策略不允许内部 CA 信息进入代码库：

- 构建时从外部挂载或注入 `ca-bundle.crt`；
- 或替换为只包含所需根证书的 bundle；
- 不要把任何私钥提交到仓库。

## 端口

托管模式下沙箱容器**不暴露任何宿主机端口**，所有外部流量均由外层 Traefik 网关进容器内 `:8080`。以下容器内部端口永远不应该通过 `/p/` 暴露：

```text
2019  Caddy admin
3080  DSH
8080  Caddy
```

## 对外暴露服务的建议

- 默认假设 `/apps/*` 和 `/p/*` 是公网可达的。
- 服务内部做认证：session、Bearer、mTLS、应用登录。
- 不要暴露调试端口、数据库管理端口、内部 admin API。
- 用最小权限运行服务；不要用 root。
- 对外 URL 通过 `sandbox-expose --info` 或 `$SANDBOX_PUBLIC_ORIGIN${SANDBOX_BASE_PATH}/apps/<name>/` 获取，不要硬编码 `:8080`。