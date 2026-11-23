<p align="center">
  <img src="manager/frontend/public/favicon.svg" alt="Metis Logo" width="72" height="72" />
</p>

<h1 align="center">Metis</h1>

<p align="center">
  <strong>Self-hosted Enterprise Digital Workforce Cloud &amp; Multi-Agent Collaboration Platform.</strong><br/>
  Named after the Greek goddess of practical wisdom, counsel, and craft — built for every role across engineering and business teams.
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

**Metis** orchestrates isolated, persistent, autonomous **Digital Employees** (powered by Agent OS containers) behind a single-port **Traefik v3.7** gateway and a modular **FastAPI + React 19** control plane. Each digital employee gets its own role persona, private SOP, persistent `/home/workspace` disk & long-term memory, encrypted LLM brain, enterprise credentials/MCP vault, scheduled routines, web preview publishing, and peer-to-peer multi-agent team collaboration.

## Architecture

```text
                        ┌──────────────────────────────────────────────────────┐
                        │           Gateway (Traefik v3.7) :9000               │
                        │    Single-Domain Dynamic HTTP Router + ForwardAuth   │
                        └───────────┬──────────────────────────────┬───────────┘
                                    │                              │
            /, /admin, /my,         │                              │ /s/<slug>/*
            /api/*, /plugins/*      ▼                              ▼
                 ┌──────────────────────────────────┐   ┌─────────────────────────────────┐
                 │ Metis Control Plane (:9000)      │   │ Digital Employee Pod/Container  │
                 │ FastAPI (Modular Routers/Services│   │ Local Docker / Remote TLS / K8s │
                 │ SQLite / PostgreSQL / MySQL      │   │ Caddy + Agent OS (Gateway Auth) │
                 │ React 19 Console & User Portal   │   │ User supervisord + cron + mesh  │
                 │ Plugin Registry + Snapshot Vault │   │ /home/workspace (persistent)    │
                 └──────────────────────────────────┘   └─────────────────────────────────┘
```

### Multi-Runtime & Zero-Port Isolation

- **Pluggable Container Runtimes (`SANDBOX_RUNTIME`)**:
  - **Local Docker**: Connects via `/var/run/docker.sock` on the internal Docker bridge network with zero host ports exposed.
  - **Remote Docker over TLS/SSH (`DOCKER_HOST`)**: Manages remote Docker hosts cleanly with automatic ephemeral host port allocation and dynamic Traefik HTTP routing.
  - **Kubernetes (`SANDBOX_RUNTIME=kubernetes`)**: Provisions per-employee `StatefulSet` + `PersistentVolumeClaim` + `Service`, routing via Traefik HTTP Provider or Traefik CRDs.
- **Pluggable RDBMS (`DATABASE_URL`)**: Zero-config SQLite for single-node setups, or production PostgreSQL / MySQL with automatic schema migration and connection pooling.
- **Granular Access Control (Traefik ForwardAuth + `@metis/gateway-auth`)**:
  - Employee desks (`/s/<slug>/`, `/s/<slug>/dsh/*`) strictly allow only the owner or platform admins via HMAC-signed gateway headers (zero launch-token redirects).
  - Published preview apps (`/s/<slug>/apps/<name>/`) support per-employee **Public** (shareable demo link) or **Authenticated** (platform session required) access modes while preserving HMAC-authenticated `sandbox-mesh` peer traffic (`/s/<slug>/p/4090`).

## Enterprise Full-Lifecycle Capabilities

### 1. Organization, Roles & White-Label Branding
- **14 Built-In Company-Wide Role Templates**: One-click import covering both **Engineering** (*Tech Lead, Full-Stack, Frontend, Backend, QA, DevOps/SRE, Product Manager, Security Auditor*) and **Corporate & Business** (*Executive Assistant, Finance Analyst, Legal & Compliance, HR Specialist, Marketing & Growth, BI Data Analyst*), each with tailored `role_title`, `role_description`, private `role_sop`, and compute quotas.
- **1-Click Project Team Assembly & Shared Knowledge Space**: Automatically establishes pairwise cryptographic trust (`sandbox-mesh`), creates a Moderator-led project room, initializes `/home/workspace/shared/TEAM_README.md`, and syncs shared project briefs (`PROJECT_BRIEF.md`) across team members.
- **1-Click Employee Cloning**: Duplicate any digital employee's image, role persona, private SOP, LLM profile, and `/home/workspace` files/memory into a new colleague.
- **White-Label Branding & Theme Tokens**: Customize bilingual brand names, **top-left Logo SVG**, **browser Favicon** (with server-side XML/SVG XSS sanitization), plus live **Theme & Brand Design Tokens** (Dark / Light / Slate modes, 5 enterprise presets, primary/accent colors, corner radius, font scale, and layout width with real-time preview and quick header mode toggle).

### 2. Task Intake, Approvals & Event Automation
- **Task Dispatch & Human Approval Center**: Dispatch prioritized tasks into any employee's board directly from `/admin` or `/my`, and **Approve / Reject** human-in-the-loop checkpoints with one click.
- **Inbound Event Webhooks (`/api/webhooks/sandboxes/{slug}`)**: Triggered by GitHub, GitLab, Feishu, WeCom, Jira, or CI/CD pipelines — automatically wakes sleeping digital employees and dispatches tasks, with per-employee token rotation.

### 3. Development & Workspace Productivity
- **Enterprise Credentials & MCP Vault**: Fernet-encrypted central vault for Git author identity, Git PATs, SSH private keys (`id_ed25519`), environment variables (`~/.dsh-sandbox/vault.env`), and MCP servers (`~/.dsh/mcp.json`) — hot-pushed to running employees without container rebuilds.
- **Multi-Protocol LLM Brain Hub**: Manage OpenAI Completions, OpenAI Responses, Anthropic Messages, and Google Gemini profiles with hot-push to running employees.
- **Online Services, Preview Apps & Cron CRUD**: Start/stop/add/remove user-level `supervisord` daemons with inline log viewing, expose/unexpose live preview ports (`sandbox-expose`), and manage persistent schedules (`sandbox-cron`) straight from the UI.

### 4. Governance, FinOps & Recovery
- **Multi-OIDC Enterprise SSO & Hybrid Auth**: Manage multiple OIDC providers (Keycloak, Okta, Auth0, Authentik, Azure AD) in-app with live discovery probing, domain allowlists, and optional local password login.
- **LLM Token FinOps & Idle Auto-Sleep**: Real-time estimated token usage, session/message telemetry, per-employee daily token budget caps (`daily_token_limit`), and idle auto-sleep with instant auto-wake on access.
- **Server-Side Workspace Snapshots Center**: Create instant server-side workspace checkpoints, 1-click rollback (`merge` or `clean`), plus streaming `.tar` export/upload restore.
- **Self-Hosted Plugin Registry (`@metis/*`)**: Dynamically serves `/plugins/index.json`, SVG icons, `.tgz` bundles, and read-only `/plugins/npm/*` packuments for all 6 built-in `@metis/*` plugins (`@metis/file-manager`, `@metis/workspace-user`, `@metis/custom-theme`, `@metis/sandbox-mesh`, `@metis/sandbox-memory`, and `@metis/work-delivery` — read-first Work & Delivery Hub with search, status filters, expandable rows, pagination, and LLM-first conversational creation).

## Repository Layout

```text
.
├── LICENSE                         # MIT License
├── README.md                       # Project overview (English)
├── README.zh-CN.md                 # Project overview (简体中文)
├── sandbox/                        # Digital employee runtime image, Caddy, supervisor & CLIs
│   ├── Dockerfile                  # Parameterized runtime image build
│   ├── toolchain/                  # Drop-in /opt/toolchain installers (toolchain.d/*.sh)
│   ├── docs/                       # Architecture, operations, OIDC, security & troubleshooting
│   ├── tests/                      # Node token tests & containerized shell script tests
│   └── rootfs/                     # Entrypoint, Caddy renderer, supervisord, CLIs & skills
├── manager/                        # Metis Control Plane, Traefik Gateway & React 19 SPA
│   ├── app/
│   │   ├── main.py                 # FastAPI entrypoint, lifespan, middleware & SPA routes
│   │   ├── deps.py                 # Auth guards, serializers & wake helpers
│   │   ├── config.py / db.py / models.py / schemas.py / security.py / oidc.py / scheduler.py
│   │   ├── routers/                # Domain routers (system, auth, plugins, admin, sandboxes, workforce)
│   │   ├── services/               # Domain service package (common, templates, sandboxes, policies, vault)
│   │   └── runtime/                # Runtime backends (base, traefik, sync, workforce, operations, docker, k8s)
│   ├── frontend/                   # React 19 + TypeScript + Vite 7 + Tailwind v4 SPA
│   │   ├── public/favicon.svg      # Default Metis emblem
│   │   └── src/
│   │       ├── App.tsx / types.ts  # App shell & shared contracts
│   │       ├── lib/                # API client, formatting utils, i18n & locales (zh-CN / en)
│   │       ├── components/         # UI primitives, BrandMark, BackupRestore, Workforce Inspector cards
│   │       └── views/              # LoginView, UserPortalView & modular views/admin/* tabs & dialogs
│   ├── tests/                      # Comprehensive pytest suite (API, runtime, K8s, DB, services, plugins)
│   ├── docker-compose.yml          # Traefik v3.7 gateway + Metis control plane stack
│   └── .env.example                # Environment template (Docker, Remote Docker, K8s, SQLite/PG/MySQL)
└── plugins/                        # Hot-mounted plugins & index catalog
    ├── file-manager/               # Server File Manager
    ├── workspace-user/             # Workspace Identity & Launcher
    ├── custom-theme/               # Custom Theme & Token Editor
    ├── sandbox-mesh/               # Cross-employee P2P pairing, moderated rooms, task board & approvals
    └── sandbox-memory/             # Token-frugal environment awareness & long-term memory
```

## Quick Start

### 1. Build the Runtime Image

```bash
cd sandbox
cp .env.example .env
docker compose build
```

> **Optional mirrors & toolchains**:
>
> ```bash
> docker build \
>   --build-arg APT_MIRROR=https://mirrors.aliyun.com \
>   --build-arg NODE_MIRROR=https://mirrors.aliyun.com/nodejs-release \
>   --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
>   --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
>   --build-arg INSTALL_TOOLCHAIN=true \
>   -t dsh-sandbox:latest ./sandbox
> ```

### 2. Start Metis Gateway & Control Plane

```bash
cd manager
cp .env.example .env
```

Edit `manager/.env` and set:

- `SECRET_KEY`: random secret (`openssl rand -hex 32`)
- `MANAGER_ADMIN_TOKEN`: admin login token (for `MANAGER_AUTH_MODE=token`) or configure OIDC providers directly in the Admin Console
- Optional: `DATABASE_URL` (`postgresql+psycopg://...` or `mysql+pymysql://...`), `SANDBOX_RUNTIME=kubernetes`, or `DOCKER_HOST` for remote Docker hosts

Launch the stack:

```bash
docker compose up -d --build
```

Access endpoints:

- Admin Control Center: `http://localhost:9000/admin`
- User Portal: `http://localhost:9000/my`
- Health Check: `http://localhost:9000/healthz`
- Plugin Catalog Index: `http://localhost:9000/plugins/index.json`

## Documentation

| Component | Documentation |
| --- | --- |
| Control Plane & Multi-Runtime Setup | [manager/README.md](manager/README.md) |
| Sandbox Runtime | [sandbox/README.md](sandbox/README.md) |
| Architecture & Flows | [sandbox/docs/architecture.md](sandbox/docs/architecture.md) |
| Build & Operations | [sandbox/docs/operations.md](sandbox/docs/operations.md) |
| Custom Toolchains (`/opt/toolchain`) | [sandbox/toolchain/README.md](sandbox/toolchain/README.md) |
| Services & Port Exposure | [sandbox/docs/services.md](sandbox/docs/services.md) |
| OIDC & SSO Setup | [sandbox/docs/OIDC.md](sandbox/docs/OIDC.md) |
| Security Model | [sandbox/docs/security.md](sandbox/docs/security.md) |
| Troubleshooting | [sandbox/docs/troubleshooting.md](sandbox/docs/troubleshooting.md) |
| Plugins | [plugins/README.md](plugins/README.md) |

## Running Tests

### Backend (`pytest`)

```bash
cd manager
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
pytest -v
```

### Frontend (`Yarn 4` + `Node >= 24`)

```bash
cd manager/frontend
corepack yarn install --immutable
corepack yarn typecheck
corepack yarn test
corepack yarn build
```

### Sandbox Scripts & Plugins

```bash
# Node gateway-auth & metis-dsh-config unit tests
node --test sandbox/tests/test_gateway_auth.mjs sandbox/tests/test_metis_dsh_config.mjs

# Toolchain installer, Caddyfile renderer (+ caddy validate), expose/cron/service CLIs
docker run --rm --entrypoint /bin/bash -v "$PWD:/repo:ro" dsh-sandbox:latest \
  /repo/sandbox/tests/test_sandbox_scripts.sh /repo

# Built-in plugin suites
for p in file-manager workspace-user custom-theme sandbox-mesh sandbox-memory work-delivery; do
  docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" \
    -w "/work/plugins/$p" dsh-sandbox:latest -c "node .test/run.mjs"
done
```

## License

Released under the [MIT License](LICENSE).
