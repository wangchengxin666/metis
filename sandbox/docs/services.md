# 服务与暴露

## 先判断产物类型

| 产物 | 是否需要暴露 |
| --- | --- |
| DSH client / Host 插件 | 否，随 `/dsh/` 加载 |
| 只给插件/agent 用的后端 | 否，绑定 `127.0.0.1` 即可 |
| 浏览器访问的 Web 服务 | 是，`sandbox-expose` |
| 临时验证某个端口 | 是，`/p/<port>/` |
| 静态文件 | 起一个 loopback 静态服务器后 expose |

## sandbox-expose

```bash
sandbox-expose <name> <port> [prefix]
sandbox-expose --info
sandbox-expose --list
sandbox-expose --remove <name>
```

默认前缀与完整出站地址（在单域名 Traefik 网关模式下会自动带上 `SANDBOX_BASE_PATH`，如 `/s/alice`）：

```text
挂载路径：${SANDBOX_BASE_PATH}/apps/<name>/   (如 /s/alice/apps/web/)
出站 URL：${SANDBOX_PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/apps/<name>/  (如 http://localhost:9000/s/alice/apps/web/)
端口转发：${SANDBOX_PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/p/<port>/
```

可通过 `sandbox-expose --info` 或环境变量 `$SANDBOX_PUBLIC_ORIGIN`、`$SANDBOX_BASE_PATH`、`$SANDBOX_PUBLIC_URL`、`$DSH_PUBLIC_URL` 查看当前沙箱的真实出站域名和基础路径。

它会：

1. 校验端口不是内部保留端口；
2. 写入 `~/.dsh-sandbox/caddy/apps.d/<name>.caddy`；
3. reload Caddy；
4. 路由持久化到 home volume。

生成片段示意：

```caddyfile
@app_webBare path /apps/web
redir @app_webBare /apps/web/ 308

handle_path /apps/web/* {
    reverse_proxy 127.0.0.1:5173 {
        header_up X-Forwarded-Prefix /apps/web
    }
}
```

路径前缀会被剥离，应用收到的是 `/` 路径。

### 认证

`/apps/*` 是**公开**的，不经过外层 Traefik ForwardAuth。`sandbox-expose` 不添加任何认证，
`--auth` 已移除。需要登录、Bearer、mTLS 或 API key 时，在服务内部实现。

不要在 Caddy 片段里加认证：该文件由 `sandbox-expose` 管理，重新 expose 会覆盖。
如果必须用代理层，写独立的 `apps.d/<name>-auth.caddy` 并自行 reload，但推荐把认证
放在服务里。

### Base path

应用必须能挂在 `${SANDBOX_BASE_PATH}/apps/<name>/` 下：

```bash
# Vite
npm run dev -- --host 127.0.0.1 --port 5173 --base=${SANDBOX_BASE_PATH}/apps/web/

# Next.js
# next.config.js: basePath: `${process.env.SANDBOX_BASE_PATH || ''}/apps/web`
```

静态或自写服务应使用相对链接，或读取 `X-Forwarded-Prefix`。如果应用生成绝对路径
资源（`/assets/x.js`），页面会 404。

### 保留端口

`2019`（Caddy admin）、`3080`（DSH）、`8080`（Caddy）永远不可 expose。

## sandbox-service

`sandbox-service` 管理用户级 supervisord，让服务在 DSH 重启和容器重启后自动恢复。

```bash
cd ~/web

sandbox-service add web "npm run dev -- --host 127.0.0.1 --port 5173 --base=/apps/web/"
sandbox-service list
sandbox-service status web
sandbox-service logs web
sandbox-service restart web
sandbox-service stop web
sandbox-service remove web
```

复杂命令：

```bash
sandbox-service add web "bash -lc 'cd ~/web && npm run dev -- --host 127.0.0.1 --port 5173'"
```

配置和日志：

```text
~/.dsh-sandbox/services/supervisord.conf
~/.dsh-sandbox/services/conf.d/<name>.conf
~/logs/<name>.log
~/logs/<name>.err
```

直接操作嵌套 supervisor：

```bash
supervisorctl -c ~/.dsh-sandbox/services/supervisord.conf status
supervisorctl -c ~/.dsh-sandbox/services/supervisord.conf reread
supervisorctl -c ~/.dsh-sandbox/services/supervisord.conf update
```

容器内没有 systemd，不要使用 `systemctl --user` 或 `loginctl enable-linger`。

## 临时端口路由

`/p/<port>/...` 始终可用，反代到 `127.0.0.1:<port>`：

```text
${SANDBOX_PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/p/5173/
```

它是公开的，适合临时调试；长期服务请用 `sandbox-service` + `sandbox-expose`。
保留端口返回 404。

## DSH 插件

本地插件安装到 web profile：

```bash
dsh plugin --profile web add /home/workspace/my-dsh-plugin
```

在 **Settings → Plugins** 启用。client 插件通常 HMR；Host 插件需要重启 DSH 进程。
插件 profile 位于 `/home/workspace/.dsh`，容器重建后仍然存在。

如果插件自带 HTTP 后端：

- 只给插件用：绑定 loopback，配置 `http://127.0.0.1:<port>`，不要 expose；
- 需要人访问：`sandbox-service` + `sandbox-expose`，并在服务内部做认证。

## 内置 skill

镜像包含 `sandbox-services` skill：

```text
/etc/dsh/skills/sandbox-services/SKILL.md
~/.dsh/skills/sandbox-services/SKILL.md
```

DSH 的 filesystem skill provider 会扫描 `$DSH_HOME/skills`。新会话中 agent 可以按需
使用它；也可以直接编辑 home volume 里的文件，DSH 会监视变化。