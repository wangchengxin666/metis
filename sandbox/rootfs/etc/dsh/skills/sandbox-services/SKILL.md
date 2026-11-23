---
name: sandbox-services
description: Run, supervise, expose, and diagnose long-running development services in this DSH sandbox. Use when a task needs a persistent dev server, a browser-reachable /apps URL, the container's outbound domain/URLs, a service that survives DSH or container restarts, or a decision between a DSH plugin and an exposed service.
whenToUse: The user asks to start or daemonize a service, expose a local port, find the public URL/domain to share externally, keep a dev server running after logout/restart, publish an app under /apps, or develop a DSH plugin that also owns an HTTP backend.
---

# Sandbox services & outbound URLs

All browser traffic enters through the outer gateway and container Caddy (`:8080`).
Because sandboxes may run behind a **single-domain Traefik subpath gateway** (for example `http://localhost:9000/s/alice/`) or directly on a standalone port (`http://localhost:8080/`), **never hardcode `http://<host>:8080/apps/...` or `--base=/apps/...`**. Always inspect the container's live outbound domain and base path first!

## 0. Discover this sandbox's outbound domain & base path

Run `sandbox-expose --info` (or inspect env vars / state files):

```bash
sandbox-expose --info
# Reads ~/.dsh-sandbox/info.json, or check env vars directly:
echo "ORIGIN=$SANDBOX_PUBLIC_ORIGIN"     # e.g. http://localhost:9000
echo "BASE_PATH=$SANDBOX_BASE_PATH"       # e.g. /s/alice (empty in standalone port mode)
echo "PUBLIC_URL=$SANDBOX_PUBLIC_URL"     # e.g. http://localhost:9000/s/alice/
echo "DSH_PUBLIC_URL=$DSH_PUBLIC_URL"     # e.g. http://localhost:9000/s/alice/dsh/
```

Persistent state files (readable even from cron jobs where env vars are stripped):

```text
~/.dsh-sandbox/info.json
~/.dsh-sandbox/public-origin.txt
~/.dsh-sandbox/base-path.txt
~/.dsh-sandbox/public-url.txt
```

Actual URL layout for this sandbox (`$SANDBOX_PUBLIC_ORIGIN` + `$SANDBOX_BASE_PATH`):

```text
${SANDBOX_PUBLIC_URL}                     -> 302 ${DSH_PUBLIC_URL} (Authenticated: owner & admin only)
${DSH_PUBLIC_URL}                         -> DSH Web UI          (Authenticated: owner & admin only)
${SANDBOX_PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/apps/<name>/ -> Exposed service (Public by default)
${SANDBOX_PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/p/<port>/    -> Port forwarder  (Public by default)
```

There is **no systemd**. Never use `systemctl --user` or `loginctl enable-linger`
inside the container; they are host-level concepts and are not available here.

## 1. Decide what the thing is

| Artifact | Exposure |
| --- | --- |
| DSH client/Host plugin | Loads inside DSH; no port, no `sandbox-expose` |
| Service used only by a plugin/agent | Bind `127.0.0.1:<port>`; no expose |
| Service a human opens in a browser | `sandbox-service` + `sandbox-expose`; public by default, add auth inside the service if needed |
| Static files | Run a small loopback server, then expose |

A DSH plugin that starts its own HTTP backend follows the service path for that
backend; the plugin itself still rides on `${SANDBOX_BASE_PATH}/dsh/`.

## 2. Long-running service with the user supervisord (`sandbox-service`) & Cron (`sandbox-cron`)

For scheduled / periodic jobs that survive container restarts, use `sandbox-cron`:

```bash
sandbox-cron add "0 9 * * * /home/workspace/daily-report.sh >> /home/workspace/logs/cron.log 2>&1"
sandbox-cron list
sandbox-cron clear
```

`sandbox-service` writes a program into the user-level supervisord. The
container-level supervisord starts that user instance as `workspace`, so services
survive **DSH restarts and container restarts**; configuration and logs live in
the home volume. User services automatically inherit `SANDBOX_PUBLIC_ORIGIN`,
`SANDBOX_BASE_PATH`, `SANDBOX_PUBLIC_URL`, `DSH_PUBLIC_URL`, and `PATH`.

```bash
cd ~/web

# Always use ${SANDBOX_BASE_PATH}/apps/<name>/ as the base path!
sandbox-service add web "npm run dev -- --host 127.0.0.1 --port 5173 --base=${SANDBOX_BASE_PATH}/apps/web/"

sandbox-service list
sandbox-service status web
sandbox-service logs web
sandbox-service restart web
sandbox-service stop web
sandbox-service remove web
```

Complex shell commands:

```bash
sandbox-service add web "bash -lc 'cd ~/web && npm run dev -- --host 127.0.0.1 --port 5173 --base=${SANDBOX_BASE_PATH}/apps/web/'"
```

Paths:

```text
~/.dsh-sandbox/services/conf.d/<name>.conf
~/.dsh-sandbox/services/supervisord.conf
~/logs/<name>.log
~/logs/<name>.err
```

Direct supervisor control:

```bash
supervisorctl -c ~/.dsh-sandbox/services/supervisord.conf status
supervisorctl -c ~/.dsh-sandbox/services/supervisord.conf reread
supervisorctl -c ~/.dsh-sandbox/services/supervisord.conf update
```

Do not edit the **system** supervisor at `/etc/supervisor`; it is root-owned.
Use `sandbox-service` only.

## 3. Expose the loopback port (`sandbox-expose`)

The service must listen on `127.0.0.1` (recommended) or at least only inside the
container; never try to publish a Docker port.

```bash
sandbox-expose web 5173
# Prints the exact outbound public URL, port URL, and mount path, e.g.:
#   public URL:  http://localhost:9000/s/alice/apps/web/
#   port URL:    http://localhost:9000/s/alice/p/5173/
#   mount path:  /s/alice/apps/web/
```

The route is **open by default** (no outer gateway ForwardAuth). If
the service needs authentication, implement it inside the service (session cookie,
Bearer token, login form, API key). Only DSH routes (`${SANDBOX_BASE_PATH}/`,
`${SANDBOX_BASE_PATH}/dsh/*`) enforce owner/admin identity auth.

Useful forms:

```bash
sandbox-expose --info                   # show domain & URL layout
sandbox-expose --list                   # list routes with full public URLs
sandbox-expose --remove web
sandbox-expose web 5173 /apps/custom/   # automatically scoped under $SANDBOX_BASE_PATH
```

`sandbox-expose` writes `~/.dsh-sandbox/caddy/apps.d/web.caddy` and reloads
Caddy. The route persists in the home volume. Do not edit generated snippets by
hand; regenerate them.

Reserved ports (never expose): `2019` (Caddy admin), `3080` (DSH), `8080` (Caddy).
`sandbox-expose` rejects them, and `/p/<port>/` returns 404 for them.

## 4. Authentication and base paths

- **Gateway identity auth protects DSH only** (`${SANDBOX_BASE_PATH}/`,
  `${SANDBOX_BASE_PATH}/dsh/*`).
- `/apps/*` and `/p/*` are **open by default** (no platform login gate). If your app
  needs access control, implement authentication inside the application itself.
- The app must work under `${SANDBOX_BASE_PATH}/apps/<name>/`:
  - **Vite**: `--base=${SANDBOX_BASE_PATH}/apps/web/` (or relative `base: './'`)
  - **Next.js**: `basePath: `${process.env.SANDBOX_BASE_PATH || ''}/apps/web``
  - **Express / FastAPI / static**: use relative links, or strip prefix relying on Caddy `handle_path` and read `X-Forwarded-Prefix` if constructing redirects.
- WebSocket is proxied transparently through both Traefik and Caddy. Keep streams under `${SANDBOX_BASE_PATH}/apps/<name>/`.
- Always report the exact `public URL` printed by `sandbox-expose` (`${SANDBOX_PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/apps/<name>/`) back to the user!

## 5. DSH plugin development

Install a local plugin bundle into the web profile:

```bash
dsh plugin --profile web add /home/workspace/my-dsh-plugin
```

Then enable it in **Settings -> Plugins** (or the plugin manager). The profile
lives in `/home/workspace/.dsh`, so it survives container recreation.

If the plugin needs an HTTP backend only for itself, bind `127.0.0.1:<port>` and
configure the plugin with `http://127.0.0.1:<port>` (no `sandbox-expose` needed).
If a human needs a standalone web UI, use `sandbox-service` + `sandbox-expose`.

## 6. Verify before reporting success

```bash
sandbox-service status web
curl -fsS http://127.0.0.1:5173/ >/dev/null && echo "loopback OK"
sandbox-expose --list
```

Then give the user the exact outbound URL (`public URL:` output by `sandbox-expose`, e.g. `${SANDBOX_PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/apps/web/`).

## 7. Troubleshooting

| Symptom | Check |
| --- | --- |
| `sandbox-service` says no such service | `sandbox-service list`; config under `~/.dsh-sandbox/services/conf.d` |
| Service `FATAL` / restart loop | `sandbox-service logs <name>` and `<name>.err` |
| Page loads but JS/CSS assets 404 | App base path is wrong; configure it with `${SANDBOX_BASE_PATH}/apps/<name>/` (check `sandbox-expose --info`) |
| Wrong host or port in shared link | Check `sandbox-expose --info` or `$SANDBOX_PUBLIC_URL`; never guess `:8080` behind Traefik |
| `/apps/x/` 404 | `sandbox-expose --list`; confirm the port and prefix; check Caddy logs |
| Service dies after container recreation | Config is persistent and autostart should recover it; check `sandbox-service status` and logs |
| Port rejected | It is one of the reserved internal ports |

Never expose DSH internals or Caddy admin; never run user
services as root; never use `systemctl`/`linger` inside this container.
