# `@metis/sandbox-memory`

Token-frugal **live sandbox environment awareness** and **cross-session long-term memory** for DeepSeek Harness (DSH) sandboxes — with KV-cache-safe layered injection, zero-token automatic capture, native Harness recall/write tools, and a visual **Memory Center** UI for full inspection and manual control.

## Key Features

- **KV-Cache-Friendly Three-Layer Context Budget**:
  - **Static Standing Guide (`ctx.systemPrompt.section`, ~115 tokens)**: Fixed rules teaching the Agent to pull memory lazily and proactively record durable knowledge — never changes, 100% prefix-cache friendly.
  - **Cache-Safe Durable Context (`ctx.systemPrompt.context`)**: Materializes a **compact Sandbox Environment Snapshot** (public URLs, installed toolchains, `/home/workspace` projects, `sandbox-service` daemons, `sandbox-expose` routes, and `sandbox-cron` jobs — zero volatile PIDs/timestamps) plus a **strictly bounded Memory Index** (`maxIndexItems`, `maxIndexChars`).
  - **Lazy On-Demand Pull (`0` standing tokens)**: Full Markdown bodies of all memories and older entries beyond the index cap are fetched only when needed via `memory_search` and `memory_get`.
- **Three Complementary Auto-Write Channels (Zero Extra LLM Calls)**:
  - **Agent Native Tools**: 6 first-class Harness tools (`memory_save`, `memory_search`, `memory_get`, `memory_update`, `memory_delete`, `env_snapshot`) with clean `tool.call.toolview` chat cards (no raw JSON dumps).
  - **Zero-Token Turn-End Auto-Capture**: Subscribes to `session/event` to automatically capture explicit bilingual preferences/rules (`记住...`, `以后...`, `默认用...`, `remember that...`, `always use...`, `never...`) when the Agent did not already call `memory_save` in that turn.
  - **Automatic Environment Watching & Refresh**: Watches `~/.dsh-sandbox/services/conf.d`, `~/.dsh-sandbox/caddy/apps.d`, and `~/.dsh-sandbox/crontab` (plus tool-call mutation detection) so environment changes stay current automatically.
- **Full Transparency & Manual Management UI**:
  - Left-sidebar **Memory Center** panel + **Settings → Memory Center** section.
  - Browse, search (CJK-aware BM25), filter by category/source, create, edit, pin/unpin, pause/resume, delete, import/export JSON, inspect the **Live Environment Snapshot**, and preview the **exact injected prompt text & estimated token count**.
- **Human-Readable Persistence & Secret Safety**:
  - Persists atomically under `$DSH_HOME/memory/` (`memories.json`, auto-synced `MEMORY.md`, and `entries/<id>.md`).
  - Built-in secret redaction automatically scrubs API keys (`sk-*`), GitHub/AWS tokens, JWTs, Bearer tokens, PEM private keys, and password assignments from auto-captured and Agent-written memories.

## Configuration

Bundled plugin defaults in [cordis.patch.yml](cordis.patch.yml):

```yaml
- insert:
    - id: sandbox-memory
      name: '@metis/sandbox-memory'
      config:
        maxIndexItems: 30
        maxIndexChars: 2800
        autoCapture: true
        includeEnvSnapshot: true
```

## Build & Test

**After editing any `src/client/*.js`, `src/shared/*.js`, or `client.js.template`, rebuild `client.js` first:**

```bash
cd plugins/sandbox-memory
node scripts/build.mjs
node .test/run.mjs
```

From inside the built `dsh-sandbox` image:

```bash
docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" \
  -w /work/plugins/sandbox-memory dsh-sandbox:latest -c "node .test/run.mjs"
```
