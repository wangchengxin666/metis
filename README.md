# DSH Dock

**Self-hosted multi-user cloud workspaces & control plane for DeepSeek Harness (DSH).**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Gateway: Traefik v3.7](https://img.shields.io/badge/Gateway-Traefik%20v3.7-24a1c1)
![Backend: FastAPI + SQLite](https://img.shields.io/badge/Control%20Plane-FastAPI%20%2B%20SQLite-009688)
![Frontend: React 19](https://img.shields.io/badge/Console-React%2019%20%2B%20Tailwind%20v4-61dafb)

[English](README.md) · [简体中文](README.zh-CN.md)

---

DSH Dock (`dsh-dock`) provisions isolated, persistent per-user **DeepSeek Harness (DSH)** Agent OS development containers behind a single-port **Traefik v3.7** gateway and a **FastAPI + React** management plane — complete with unified authentication (`OIDC` / local passwords & tokens), built-in plugin hosting, one-click `/home/workspace` backups, and agent-managed dev services.

## Architecture

```text
                        ┌──────────────────────────────────────────────┐
                        │        dsh-gateway (Traefik v3.7) :9000      │
                        │     Single-Domain Router + ForwardAuth       │
                        └───────┬──────────────────────────────┬───────┘
                                │                              │
        /, /admin, /my,         │                              │ /s/<slug>/*
        /api/*, /plugins/*      ▼                              ▼
                   ┌─────────────────────────┐    ┌─────────────────────────────┐
                   │ dsh-manager :9000       │    │ dsh-sbx-<slug> :8080        │
                   │ FastAPI + SQLite        │    │ (no host ports exposed)     │
                   │ React 19 Console SPA    │    │ Caddy + DSH + dsh-token     │
                   │ Built-in Plugin Registry│    │ User supervisord + cron     │
                   └─────────────────────────┘    │ /home/workspace (persistent)│
                                                  └─────────────────────────────┘
```

### Routing & Isolation Model

- **Zero Host Port Exposure (Managed Mode)**: Sandbox containers join only the internal `dsh-manager` Docker network and expose no host ports (`18000+` port sprawl is eliminated).
- **ForwardAuth DSH Gate**: Access to `/s/<slug>/`, `/s/<slug>/dsh/*`, and `/s/<slug>/_dsh-token` is verified centrally via `dsh-manager` (`/api/auth/verify-sandbox/{slug}`). Only the workspace owner or an active platform admin is permitted.
- **Open App & Preview Routes**: User services exposed via `sandbox-expose` (`/s/<slug>/apps/<name>/`) and ephemeral port forwarding (`/s/<slug>/p/<port>/`) stay open by default so apps can implement their own auth or webhooks cleanly.

## Key Features

- **Control Plane (`/admin`) & Self-Service Portal (`/my`)**:
  - Provision and manage user sandboxes with CPU, memory, PIDs (`512`), `no-new-privileges`, custom init scripts, Git repo bootstrapping, and reusable `SandboxTemplate` presets (ships with the built-in `agent-os` template).
  - Manage platform admins, local user accounts (`scrypt` password hashes) or SSO users, and encrypted LLM profiles (Fernet encryption backed by `SECRET_KEY`).
  - Live container stats, stripped ANSI logs, hot-recreation/image upgrades, and full `/home/workspace` tar archive downloads (`<slug>-home.tar`).
- **Flexible Authentication (`MANAGER_AUTH_MODE`)**:
  - `token`: Zero external IdP required. Admins authenticate via `MANAGER_ADMIN_TOKEN`; users sign in at `/login` with admin-provisioned passwords and can rotate their own passwords at `/my`.
  - `oidc`: Enterprise SSO via any standard OpenID Connect provider (Keycloak, Auth0, Authentik, Okta) with optional split internal discovery (`OIDC_DISCOVERY_URL`).
  - `none`: Trusted loopback/development mode.
- **Agent-Ready Runtime Image (`dsh-sandbox`)**:
  - Debian 13 (`trixie-slim`), Node.js 24, Python 3.13, `uv`, `pnpm`, `git`, `tmux`, `build-essential`, Caddy 2, `@deepseek-ai/dsh`, CJK locale (`zh_CN.UTF-8`), WQY fonts, and corporate CA support (`ca-bundle.crt`).
  - `WORKDIR /home/workspace` is the default workspace and persisted home volume.
  - Built-in CLI helpers + `sandbox-services` skill:
    - `sandbox-service`: manage persistent user services under user-level `supervisord`.
    - `sandbox-expose`: publish loopback ports at `/s/<slug>/apps/<name>/` via Caddy.
    - `sandbox-cron`: manage persistent user crontabs surviving container restarts.
- **Modular Build-Time Toolchains (`/opt/toolchain`)**:
  - Disabled by default (`INSTALL_TOOLCHAIN=false`) to keep the base image lean.
  - Enable `INSTALL_TOOLCHAIN=true` to execute custom drop-in installers from `sandbox/toolchain/toolchain.d/*.sh` in sorted order into `/opt/toolchain` (includes `10-dotnet.sh` as a reference).
- **Self-Hosted Plugin Index & NPM Registry**:
  - Mounts `plugins/` directly into `dsh-manager` and dynamically serves `/plugins/index.json`, inline SVG icons, `.tgz` bundles (`/plugins/packages/*.tgz`), and read-only npm packuments (`/plugins/npm/*`).
  - Ships with `@local/dsh-plugin-file-manager`, `@dsh-dock/workspace-user`, `@dsh-dock/custom-theme`, `@dsh-dock/sandbox-mesh`, and `@dsh-dock/sandbox-memory`, and supports automatic first-boot installation via `SANDBOX_AUTO_INSTALL_PLUGINS` (all five enabled by default).
- **Mirror & Internal Network Ready**:
  - Supports `DOCKER_REGISTRY`, `APT_MIRROR` (including HTTPS mirrors like `https://mirrors.aliyun.com`), `NODE_MIRROR` (e.g. `https://mirrors.aliyun.com/nodejs-release`), `NPM_REGISTRY`, `PIP_INDEX_URL`, and `CUSTOM_CA_BUNDLE_PATH`.

## Repository Layout

```text
.
├── LICENSE                         # MIT License
├── README.md                       # Project overview (English)
├── README.zh-CN.md                 # Project overview (简体中文)
├── sandbox/                        # Sandbox runtime image, supervisor, Caddy, & helpers
│   ├── Dockerfile                  # Parameterized sandbox image build
│   ├── docker-compose.yml          # Standalone sandbox compose (publishes :8080)
│   ├── .env.example                # Build args & standalone compose template
│   ├── Makefile                    # Convenience targets (env, build, up, logs, token, expose)
│   ├── toolchain/                  # Drop-in /opt/toolchain installers (toolchain.d/*.sh)
│   ├── docs/                       # Architecture, operations, OIDC, security, & troubleshooting
│   ├── tests/                      # dsh-token Node tests & containerized shell script tests
│   └── rootfs/                     # Entrypoint, Caddyfile renderer, supervisor, CLIs & skills
├── manager/                        # FastAPI control plane, Traefik gateway, & React SPA
│   ├── app/                        # Backend modules (config, db, models, docker_service, ...)
│   ├── frontend/                   # React 19 + TypeScript + Vite 7 + Tailwind v4 SPA
│   ├── tests/                      # Pytest unit & mock test suite
│   ├── docker-compose.yml          # Traefik v3.7 gateway + dsh-manager stack
│   ├── .env.example                # Control plane environment template
│   └── requirements*.txt           # Runtime and dev/test Python dependencies
└── plugins/                        # Hot-mounted DSH bundle plugins & index metadata
    ├── index.json                  # Discover catalog template
    ├── icons/                      # SVG plugin icons
    ├── file-manager/               # Built-in Server File Manager bundle + tests
    ├── workspace-user/             # Built-in Workspace User Identity & launcher menu
    ├── custom-theme/               # Built-in Custom Theme presets, token editor & branding
    ├── sandbox-mesh/               # Cross-sandbox pairing, LLM-moderated groups & Agent mesh
    └── sandbox-memory/             # Token-frugal sandbox environment awareness & long-term memory
```

## Quick Start

### 1. Build the Sandbox Image

```bash
cd sandbox
cp .env.example .env
docker compose build
```

> **Optional mirrors / toolchains**:
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

### 2. Start the Gateway & Control Plane

```bash
cd manager
cp .env.example .env
```

Edit `manager/.env` and replace the placeholders:

- `SECRET_KEY`: generate a random secret (`openssl rand -hex 32`)
- `MANAGER_ADMIN_TOKEN` (for `MANAGER_AUTH_MODE=token`) or `OIDC_*` (for `MANAGER_AUTH_MODE=oidc`)

Launch the stack:

```bash
docker compose up -d --build
```

Verify and access:

- Health check: `http://localhost:9000/healthz`
- Admin console: `http://localhost:9000/admin`
- User portal: `http://localhost:9000/my`
- Self-hosted plugin index: `http://localhost:9000/plugins/index.json`

## Documentation

| Component | Documentation |
| --- | --- |
| Manager & Control Plane | [manager/README.md](manager/README.md) |
| Sandbox Runtime | [sandbox/README.md](sandbox/README.md) |
| Architecture & Flows | [sandbox/docs/architecture.md](sandbox/docs/architecture.md) |
| Build & Operations | [sandbox/docs/operations.md](sandbox/docs/operations.md) |
| Custom Toolchains (`/opt/toolchain`) | [sandbox/toolchain/README.md](sandbox/toolchain/README.md) |
| Services & Port Exposure | [sandbox/docs/services.md](sandbox/docs/services.md) |
| OIDC & SSO Setup | [sandbox/docs/OIDC.md](sandbox/docs/OIDC.md) |
| Security Model | [sandbox/docs/security.md](sandbox/docs/security.md) |
| Troubleshooting | [sandbox/docs/troubleshooting.md](sandbox/docs/troubleshooting.md) |
| DSH Plugins | [plugins/README.md](plugins/README.md) |

## Running Tests

### Manager Backend (`pytest`)

```bash
cd manager
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
pytest -v
```

### Manager Frontend (`Yarn 4` + `Node >= 24`)

```bash
cd manager/frontend
corepack yarn install --immutable
corepack yarn typecheck
corepack yarn test
corepack yarn build
```

### Sandbox Scripts & Helpers

```bash
# Node token helper unit tests
node --test sandbox/tests/test_dsh_token.mjs

# Toolchain installer, Caddyfile renderer (+ caddy validate), expose/cron/service CLIs
docker run --rm --entrypoint /bin/bash -v "$PWD:/repo:ro" dsh-sandbox:latest \
  /repo/sandbox/tests/test_sandbox_scripts.sh /repo
```

### DSH Plugins (`file-manager`, `workspace-user`, `custom-theme`, `sandbox-mesh`, `sandbox-memory`)

```bash
docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" \
  -w /work/plugins/file-manager dsh-sandbox:latest -c "node .test/run.mjs"

docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" \
  -w /work/plugins/workspace-user dsh-sandbox:latest -c "node .test/run.mjs"

docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" \
  -w /work/plugins/custom-theme dsh-sandbox:latest -c "node .test/run.mjs"

docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" \
  -w /work/plugins/sandbox-mesh dsh-sandbox:latest -c "node .test/run.mjs"

docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" \
  -w /work/plugins/sandbox-memory dsh-sandbox:latest -c "node .test/run.mjs"
```

## Contributing

Contributions are welcome! Please read the component docs before opening a pull request, preserve LF line endings on shell scripts under `sandbox/`, and verify all test suites pass.

## License

Released under the [MIT License](LICENSE).
