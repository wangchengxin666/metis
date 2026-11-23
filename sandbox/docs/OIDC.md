# OIDC 接入（任意 Standard Provider）

DSH 沙箱平台已将身份认证统一收口至外层 **Traefik + `dsh-manager` ForwardAuth**：容器内部不再运行 `oauth2-proxy`。`dsh-manager` 同时负责 `/admin`、`/my` 以及各沙箱 DSH 入口的身份鉴权。

```text
/s/<slug>/           -> Traefik ForwardAuth -> dsh-manager (/api/auth/verify-sandbox/<slug>)
/s/<slug>/dsh/*      -> Traefik ForwardAuth -> dsh-manager (HMAC 签名头) -> sandbox Caddy -> DSH (@metis/gateway-auth)
/s/<slug>/apps/*     -> 公开（服务自行实现鉴权）
/s/<slug>/p/*        -> 公开（服务自行实现鉴权）
/s/<slug>/healthz    -> 公开健康检查
```

## 方式一：管理后台内部配置（推荐，支持多个 OIDC 并与本地登录共存）

无需在 Docker `.env` 中写死 OIDC 环境变量，也不需要重启容器：

1. 使用默认的 `MANAGER_AUTH_MODE=token`（配置 `MANAGER_ADMIN_EMAIL`、`MANAGER_ADMIN_TOKEN`、`SECRET_KEY`、`MANAGER_PUBLIC_URL`）启动 `dsh-manager`；
2. 管理员登录 `/admin` 后，进入 **「认证 (Auth & SSO)」** Tab；
3. 添加一个或多个 OIDC 提供方（例如同时接入企业 Keycloak、Okta、飞书 / Authentik 等）：
   - `Client Secret` 使用平台 `SECRET_KEY` 通过 Fernet 加密后保存在 SQLite 数据库；
   - 每个提供方可单独配置：**启用/停用**、**按钮排序**、**内部 Discovery URL（Docker 分离网络解析）**、**自定义注销 URL**、**允许的邮箱域名白名单**、以及**是否允许命中平台管理员列表的邮箱获得管理员权限**；
   - 表单内置 **「测试发现端点」** 按钮和 **一键复制 Redirect URI / Post-Logout URI**；
4. 在同一页面的 **「登录方式策略」** 中，可随时切换是否允许普通用户使用「本地邮箱 + 密码」登录（默认与 OIDC 共存；管理员口令始终保留作为应急兜底，避免 IdP 故障锁死后台）；
5. 用户访问 `/login` 时，可自由选择任意已启用的 OIDC 按钮或本地账号登录；退出登录时仅对 OIDC 会话触发对应提供方的单点注销。

## 方式二：通过 `manager/.env` 首次引导（兼容旧部署）

若老环境已在 `manager/.env` 中配置了 `OIDC_*` 变量，`dsh-manager` 首次启动时会自动将其一次性导入为 `slug=default` 的内部 OIDC 提供方记录（之后即可直接在后台编辑、增删或扩展更多提供方）：

```dotenv
MANAGER_AUTH_MODE=oidc
MANAGER_ADMIN_EMAIL=admin@example.com
MANAGER_PUBLIC_URL=https://sandbox.example.com
MANAGER_INTERNAL_URL=http://dsh-manager:9000
SECRET_KEY=<32+ 随机字符>

OIDC_ISSUER_URL=https://idp.example.com/realms/main
# 可选：当 Manager 运行在 Docker 内且浏览器通过 localhost/外网访问 IdP 时，可填写容器内可达的 discovery 地址
# OIDC_DISCOVERY_URL=http://dsh-keycloak:8080/realms/main/.well-known/openid-configuration
OIDC_CLIENT_ID=dsh-sandbox
OIDC_CLIENT_SECRET=<client-secret>
OIDC_SCOPE=openid profile email
OIDC_EMAIL_CLAIM=email
```

## IdP 侧配置要点

- Confidential/web client（启用 Client authentication）+ Authorization Code flow（也支持不填 Client Secret 的 Public Client）；
- Redirect URI（按提供方 `slug` 区分，可在管理后台表单直接一键复制）：
  ```text
  <MANAGER_PUBLIC_URL>/auth/oidc/<slug>/callback
  ```
  例如 `https://sandbox.example.com/auth/oidc/keycloak/callback` 或本地调试 `http://localhost:9000/auth/oidc/keycloak/callback`（旧地址 `<MANAGER_PUBLIC_URL>/auth/callback` 仍作为兼容别名保留）；
- Post-logout Redirect URI（用于退出登录时同步注销 IdP 单点登录会话）：
  ```text
  <MANAGER_PUBLIC_URL>/login
  ```
  （在 Keycloak 等 IdP 的 **Valid post logout redirect URIs** 中登记 `<MANAGER_PUBLIC_URL>/login` 或 `<MANAGER_PUBLIC_URL>/*`；若 IdP 未提供标准 `end_session_endpoint`，可在提供方高级配置中显式指定注销地址，未配置时将在下次登录自动附加 `prompt=login`）；
- Scope 至少包含 `openid profile email`；
- Manager 通过提供方的 `email_claim`（默认 `email`，如改用 `preferred_username` 可相应修改）提取用户邮箱，先校验该提供方的邮箱域名白名单（如有），再与 `platform_admins`（需同时开启 `allow_admin_login`）或沙箱 owner 邮箱（大小写不敏感）比对；
- 已登录但被管理员禁用（`status != "active"`）的普通用户在访问 `/login`、OIDC 回调、`/my` 或 `/s/<slug>/dsh/*` 时会被拒绝（403 / 提示账号已禁用）。

## 登录后零重定向直达 DSH

首次访问 `/s/<slug>/dsh/`：

1. Traefik 先调用 `/api/auth/verify-sandbox/<slug>`：未登录会 302 跳转至 OIDC 登录（或本地 `/login`）；登录身份既非 owner 也非管理员则返回 403；
2. 鉴权通过后，Manager 签发短时效 HMAC-SHA256 请求头 `X-Metis-Gateway-Auth` 与身份头（`X-Auth-Request-Email` 等），由 Traefik 注入请求转发至沙箱 Caddy；
3. DSH 内置的 `@metis/gateway-auth` 服务拦截器验证 HMAC 签名与时间戳（防止容器内伪造头），校验通过即以 `workspace` 会话身份直接返回 `200` / WebSocket `101`，无需额外的 launch-token 跳转。
