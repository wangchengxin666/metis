# DSH plugins

Harness plugins that ship with this platform. Each directory is a DSH **bundle**:
a package whose `package.json` declares `dsh.bundle.patch` and whose patch
inserts the plugin rows into a profile.

| Plugin | What it adds |
|---|---|
| [file-manager](file-manager/README.md) | A server file manager page in the left sidebar: breadcrumbs and a path bar, upload, download (including ZIP of a directory or selection), inline preview, new folder, rename, delete. |
| [workspace-user](workspace-user/README.md) | Bottom-left sidebar launcher showing the current signed-in user's name and email, admin inspection status badge, and quick popup actions (`Settings`, `/my`, `/admin`, `/auth/logout`). |
| [custom-theme](custom-theme/README.md) | Out-of-the-box Aurora Blue default theme plus interactive Settings editor for presets, light/dark `--dsw-*` tokens, custom CSS variables, sidebar branding, JSON import/export, and Host persistence with zero-flash first paint. |
| [sandbox-mesh](sandbox-mesh/README.md) | Cross-sandbox 1-on-1 pairing (`Pair`) and LLM-moderated multi-sandbox group chat (`Group`) over Traefik with HMAC-SHA256 auth, per-thread Session context isolation (`New Topic`), live preparing/answering status animations, native Harness tools (`mesh_ask_peer`, `mesh_discuss_group`, `mesh_share_file`), and main-session `@` triggering. |
| [sandbox-memory](sandbox-memory/README.md) | Token-frugal live sandbox environment awareness + cross-session long-term memory with KV-cache-safe layered injection, zero-token turn-end auto-capture, native Harness tools (`memory_save`, `memory_search`, `memory_get`, `memory_update`, `memory_delete`, `env_snapshot`), and a visual Memory Center UI. |

## Self-Hosted Discover Index & Registry (via `dsh-manager`)

`dsh-manager` natively hosts this `plugins/` directory with zero external S3/MinIO or Git credential requirements:

| Endpoint | Purpose |
|---|---|
| `http://<manager>:9000/plugins/index.json` | Discover index URL (add under **Plugins → Discover → Add index source**) |
| `http://<manager>:9000/plugins/icons/<name>.svg` | Plugin icons referenced by `index.json` |
| `http://<manager>:9000/plugins/npm/<package>` | Built-in read-only npm registry used by Discover when `PLUGIN_SOURCE_TYPE=npm` |
| `http://<manager>:9000/plugins/packages/<slug>.tgz` | Direct tarball download for CLI installation |

### Automatic installation into sandboxes

By default (and configurable via `SANDBOX_AUTO_INSTALL_PLUGINS` in `manager/.env`), new sandboxes automatically install:

```dotenv
SANDBOX_AUTO_INSTALL_PLUGINS=file-manager,workspace-user,custom-theme,sandbox-mesh,sandbox-memory
```

Every sandbox created by the manager will automatically install these plugins from the manager's `/plugins/packages/<slug>.tgz` endpoints during first startup.

### Manual installation inside a sandbox

```sh
# From the manager's self-hosted tarball endpoint:
dsh plugin --profile web add http://<manager>:9000/plugins/packages/file-manager.tgz

# Or from a local directory checkout:
dsh plugin --profile web add /path/to/repo/plugins/file-manager
```

## Developing a plugin

Each plugin builds and tests standalone; `file-manager` for example:

```sh
cd plugins/file-manager
node scripts/build.mjs       # rebuild client.js, then run every check
```

To run the full `file-manager` test suite (which resolves `@deepseek-ai/cordis` and `@deepseek-ai/dsh-typert-protocol` peers from DSH) inside the built sandbox image:

```sh
docker run --rm --entrypoint bash -v "$PWD/plugins:/work/plugins" -w /work/plugins/file-manager dsh-sandbox:latest -c "node .test/run.mjs"
```

Because `dsh-manager` dynamically packages `plugins/<slug>/` into a `.tgz` and refreshes its SHA-1 / SHA-512 integrity whenever files in `plugins/<slug>/` change, updating a plugin on disk immediately updates the package served by `dsh-manager`.

## Optional: Publishing to an external S3/MinIO bucket or Git source

If you prefer hosting `plugins/index.json` and `plugins/icons/*` on an external S3/MinIO bucket with a Git source instead of `dsh-manager`:

1. Set `PLUGIN_SOURCE_TYPE=git`, `PLUGIN_GIT_URL=https://...`, and `PLUGIN_GIT_COMMIT=<sha>` in `manager/.env` (or edit `plugins/index.json`), or
2. Upload `plugins/index.json` and `plugins/icons/*` to your bucket with `--cache-control no-cache`.
