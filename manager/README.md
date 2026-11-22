# dsh-manager

Single-host control plane and Traefik v3.7 gateway for per-user persistent DSH Agent OS sandboxes, with a built-in hot-mounted plugin index and package registry.

- FastAPI + Python 3.13 + SQLite + Docker SDK
- React 19 + TypeScript + Vite 7 + Tailwind CSS v4 + shadcn/ui SPA (built automatically in Docker multi-stage build)
- Traefik v3.7 single-domain subpath gateway (`/s/<slug>/...`) with `ForwardAuth` strict owner/admin workspace isolation
- Flexible hybrid auth: built-in Admin Token + local user password + **internal multi-OIDC SSO** (configured hot in Admin Console -> Auth & SSO, stored encrypted in SQLite, selectable on `/login`, shared uniformly across `/admin`, `/my`, and `/s/<slug>/dsh/*`)
- Admin-only workspace provisioning (`/admin`) + Built-in `agent-os` & custom Templates + Read/Control/Logs/Backup (`/home/workspace` -> `<slug>-home.tar`) user portal (`/my`)
- Zero host port bindings on managed sandboxes (containers join `dsh-manager` Docker network; Caddy listens internally on `:8080`)
- Dynamic hot-mounted DSH Plugin Discover Index (`/plugins/index.json`), inline icons, `.tgz` packager, and read-only npm registry (`/plugins/npm/*`)
- Optional LLM Profile pre-configuration injected into sandboxes at creation
- Per-sandbox CPU/memory limits, container log rotation, and `no-new-privileges` hardening

```text
gateway (traefik:v3.7) :9000
├── /                       -> manager UI & API
├── /s/<slug>/*             -> ForwardAuth (/api/auth/verify-sandbox/<slug>) -> sandbox container
├── /plugins/index.json     -> Auto-synthesized DSH Discover plugin index
├── /plugins/npm/*          -> Read-only npm registry for DSH plugins
└── /plugins/packages/*     -> Dynamic .tgz plugin bundles
```

## Run with Docker Compose

```bash
cp .env.example .env
# Edit SECRET_KEY and MANAGER_ADMIN_TOKEN (or OIDC_* settings)
docker compose up -d --build
curl -fsS http://127.0.0.1:9000/healthz
```

## Local run (uvicorn on the host)

```bash
cd manager
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Edit .env:
#   MANAGER_PUBLIC_URL=http://127.0.0.1:9000
#   MANAGER_AUTH_MODE=token
#   MANAGER_ADMIN_TOKEN=my-secret-token
#   SECRET_KEY=<32+ random chars>

export DATABASE_URL="sqlite:///$PWD/data/dsh-manager.db"
uvicorn app.main:app --host 127.0.0.1 --port 9000
```

## Tests

### Backend (`pytest`)

```bash
cd manager
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
pytest -v
```

### Frontend (`Node >= 24` + `Yarn 4`)

```bash
cd manager/frontend
corepack yarn install --immutable
corepack yarn typecheck
corepack yarn test
corepack yarn build
```

## Self-Hosted Plugin Index & Registry

`dsh-manager` mounts `../plugins` and automatically serves:

- `GET /plugins/index.json`: DSH Discover index. By default (`PLUGIN_SOURCE_TYPE=npm`), plugin sources point to the manager's built-in npm registry (`http://<manager>:9000/plugins/npm`), so sandboxes can install plugins from the Discover tab without needing Git credentials or an external S3/MinIO bucket.
- `GET /plugins/icons/<name>.svg`: Plugin icons.
- `GET /plugins/packages/<slug>.tgz`: Dynamically packaged npm tarball of `plugins/<slug>/`.
- `GET /plugins/npm/<pkg_name>`: Read-only npm packument metadata with SHA-1 `shasum` and SHA-512 `integrity`.

When `SANDBOX_AUTO_INSTALL_PLUGINS=file-manager` is set in `.env`, newly created sandboxes automatically install `file-manager` into the `web` profile on first boot.

## API

`/api/*` accepts either a logged-in admin session cookie or `Authorization: Bearer <MANAGER_ADMIN_TOKEN>`:

```bash
HOST=localhost:9000
TOKEN="replace-with-admin-token"

# Create a sandbox
curl -sS -X POST "http://$HOST/api/sandboxes" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","display_name":"Alice"}'

# List / refresh
curl -sS "http://$HOST/api/sandboxes?refresh=true" -H "Authorization: Bearer $TOKEN"

# Start / stop / restart
curl -sS -X POST "http://$HOST/api/sandboxes/<id>/start" -H "Authorization: Bearer $TOKEN"
curl -sS -X POST "http://$HOST/api/sandboxes/<id>/stop"  -H "Authorization: Bearer $TOKEN"

# Logs
curl -sS "http://$HOST/api/sandboxes/<id>/logs?tail=200" -H "Authorization: Bearer $TOKEN"
```
