# `@metis/sandbox-mesh`

Cross-sandbox 1-on-1 pairing (`Pair`), LLM-moderated multi-sandbox group rooms (`Group`), workspace file transfer, and isolated **Human + DSH Agent** collaboration over Traefik with HMAC-SHA256 authentication.

## Key Features

- **Traefik-Native Cross-Network Routing (`/s/<slug>/p/4090`)**:
  - Binds locally on `127.0.0.1:4090` and communicates across containers in the same Docker Compose host (`http://dsh-gateway:9000` / internal proxy fallback) or federated `dsh-dock` clusters behind Traefik.
  - Supports **Same-Gateway Short Codes** (`alice.k8F9mP2x...`) and **Cross-Network Traefik URIs** (`https://dock.example.com/s/alice/p/4090#pair=alice.k8F9mP2x...`).
- **LLM-Controlled Group Moderator (Option B)**:
  - Each group appoints a Moderator (`moderatorSlug`). Untargeted human messages in a group wake **only** the Moderator (`group-moderator-duty`) while peer Agents stay silent (`awaiting-moderator-turn`).
  - The Moderator LLM dynamically inspects member specialties or container tasks, calls targeted peers via `mesh_ask_peer` (`phase: 'turn'`, waking only the called peer), waits for replies, and synthesizes a unified response.
  - Explicit human mentions (`@<slug>` or `@all`) still wake the targeted member(s) directly.
- **Per-Thread Session & Context Isolation (`New Topic`)**:
  - Collab Space agent conversations run inside dedicated sessions isolated under **`协同空间`** (`/home/workspace/collab-space`), auto-archiving when idle so normal chat lists stay clean while remaining 1-click inspectable from each room's **Agent Log** button.
  - Each `(roomId, threadId)` binds to its own Harness Session; `buildAgentWakePrompt` filters history strictly to the active `threadId`.
  - Clicking **New Topic** (or invoking `sandbox-peer new-topic <roomId>`) rotates `activeThreadId` across peers with inline visual dividers (`sm-topic-divider`) and is idempotent when the current thread is already fresh and empty (`canStartNewTopic`).
- **Live Preparing / Answering Animations**:
  - Hosts broadcast monotonic sequenced `/mesh/status` updates (`coordinating`, `preparing`, `answering`, `waiting_peer @<slug>`) over HMAC-signed endpoints with 150s TTL and spoof-protection (`targetSlug === verified.fromSlug`).
  - The chat UI speeds up polling while active and shows bouncing-dot typing bubbles (`.sm-typing-bubble`) alongside pulsing dots on active member tags (`.sm-dot-live`).
- **Shared Room Task Board, Parallel Fan-Out & Human Approval Gates**:
  - **`mesh_dispatch_tasks`**: Create tracked tasks with DAG dependencies (`dependsOn` / `dependsOnIndices`) and wake all runnable assigned sandboxes **in parallel** — supporting both non-blocking **`async`** mode (for long-running coding/testing/deployment turns with 15-minute timeout & 30s status heartbeats) and **`wait`** mode (parallel `Promise.all` for quick multi-role meetings/design reviews).
  - **`mesh_task_board` & `mesh_task_update`**: Replicated across room members over HMAC-signed `/mesh/task-sync` with monotonic version conflict resolution, tracking status (`todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`), progress summaries, and deliverable `artifacts` (git branches, PR/preview URLs, workspace paths), automatically unlocking dependent tasks and notifying the Moderator.
  - **`mesh_request_approval`**: Post interactive **Human Approval Gate** cards inline in the chat timeline for milestone sign-off (PRD approval, production release, risky changes). Agents can never self-approve; human **Approve / Reject** clicks (with optional feedback) replicate across peers and automatically wake the assigned sandbox to continue or revise.
- **Per-Sandbox Role SOP & MCP/Skill Composability**:
  - Configure each sandbox's public `role`/`description` alongside private, local-only **Role SOP (`instructions`)** (with 10 role presets including Product Manager, Architect/Tech Lead, Full-Stack Engineer, Frontend, Backend, QA, DevOps/SRE, Security Auditor, Data/AI, and Tech Writer). Each sandbox combines Mesh collaboration with its own locally configured MCP servers & Skills (Git, CI/CD, K8s, DB, etc.).
- **Native Harness Integration & CLI Bridge**:
  - Registers 9 first-class Harness tools (`mesh_list_peers`, `mesh_ask_peer`, `mesh_discuss_group`, `mesh_dispatch_tasks`, `mesh_task_board`, `mesh_task_update`, `mesh_request_approval`, `mesh_send_message`, `mesh_share_file`), native `tool.call.toolview` UI cards, a dynamic `sandbox-peer` Skill provider, and main-session `@` input trigger chips (`@[slug](dsh-mesh:...)` / `@[group](dsh-mesh-group:...)`).
  - Auto-provisions `/home/workspace/.local/bin/sandbox-peer` CLI and `~/.dsh/skills/sandbox-peer/SKILL.md`.
- **Zero-Trust Security Model**:
  - **One-Time Pairing**: 144-bit random base64url token (`DEFAULT_PAIR_TTL_MS = 5m`), `pairLimiter` (5 attempts/min), invalidated after 5 failed attempts or first consumption; derives `sharedSecret` using X25519 ECDH (with HMAC fallback).
  - **Signed Requests & Replay Protection**: Every `/mesh/*` route verifies `HMAC-SHA256` over `${METHOD}\n${cleanPath}\n${timestamp}\n${nonce}\n${sha256(body)}`, enforces a ±60s timestamp tolerance, and tracks nonces in a sliding-window replay guard.
  - **Loopback CLI Guard**: `/local/cli` requires a `0600` bearer token compared in constant time and rejects proxied traffic carrying `x-forwarded-prefix` or `x-forwarded-for` (`403`).
  - **File, Approval & Loop Safety**: `safeFileName` path sanitization + SHA-256 verification + `10 MiB` cap (`mesh-inbox/<roomId>/`); human-only enforcement on `/api/sandbox-mesh.approval-decide`; `maxAgentHops` (default `8`) prevents infinite loops.

## Configuration

Bundled plugin defaults in [cordis.patch.yml](cordis.patch.yml):

```yaml
- insert:
    - id: sandbox-mesh
      name: '@metis/sandbox-mesh'
      config:
        port: 4090
        maxAgentHops: 8
```

## Layout of the Package

| Path | Role |
|---|---|
| [index.js](index.js) | Host service (`createMeshService`), local `:4090` HTTP server, HMAC `/mesh/*` & `/local/cli` routes, `/api/sandbox-mesh.*` browser routes, live activity status map. |
| [client.js](client.js) / [client.js.template](client.js.template) | Built Web UI bundle, Cordis sidebar/main/settings slots, and native `@` input trigger source. |
| [src/host/crypto.js](src/host/crypto.js) | Token generation, key derivation, HMAC-SHA256 signing/verification, sliding-window replay guard, rate limiter. |
| [src/host/store.js](src/host/store.js) | Persistent state (`sandbox-mesh.json`), pairing, group rooms, per-thread session mapping, outbox queue. |
| [src/host/harness-bridge.js](src/host/harness-bridge.js) | Native Harness tools (`mesh_*`), dynamic Skill provider, `SessionController` wake driver, `ask_user_question` guard, live status hooks. |
| [src/host/agent-bridge.js](src/host/agent-bridge.js) | Provisioning `sandbox-peer` CLI (`0755`), local loopback token (`0600`), and `SKILL.md`. |
| [src/shared/protocol.js](src/shared/protocol.js) | Slug validation, mention/file-ref parsing, `evaluateAgentWake` routing, `canStartNewTopic`. |
| [src/client/](src/client/) | React UI (`mesh-page.js`), Markdown renderer (`markdown.js`), native DSH tool/prompt views (`tool-views.js`), state controller (`mesh-controller.js`), CSS (`styles.js`), `en`/`zh` copy (`locale.js`), SVG micro-icons (`icons.js`). |
| [scripts/](scripts/) & [.test/](.test/) | Bundle builder and 7-suite test runner (`bundle-load`, `client-live`, `endpoint-names`, `host-live`, `icon-check`, `locale-check`, `security-and-reliability`). |

## Build & Test

**After editing any `src/client/*.js` file or `client.js.template`, rebuild `client.js` first:**

```bash
cd plugins/sandbox-mesh
node scripts/build.mjs
node .test/run.mjs
```

From inside the built `dsh-sandbox` image (matching CI/container dependencies):

```bash
docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" \
  -w /work/plugins/sandbox-mesh dsh-sandbox:latest -c "node .test/run.mjs"
```
