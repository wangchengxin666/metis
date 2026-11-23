#!/usr/bin/env bash
# Root entrypoint: prepare the home volume, render runtime configs, then hand
# the container to supervisord (caddy + dsh-token + dsh + user-services).
set -euo pipefail

log() { printf '[entrypoint] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "entrypoint must run as root"

WORKSPACE_USER=workspace
CADDY_PORT=${CADDY_PORT:-8080}
DSH_PORT=${DSH_PORT:-3080}
SANDBOX_BASE_PATH=${SANDBOX_BASE_PATH:-}
SANDBOX_BASE_PATH=${SANDBOX_BASE_PATH%/}
if [ -n "${SANDBOX_BASE_PATH}" ] && [[ "${SANDBOX_BASE_PATH}" != /* ]]; then
  SANDBOX_BASE_PATH="/${SANDBOX_BASE_PATH}"
fi
if [ -z "${DSH_MOUNT:-}" ] || { [ -n "${SANDBOX_BASE_PATH}" ] && [ "${DSH_MOUNT}" = "/dsh" ]; }; then
  DSH_MOUNT="${SANDBOX_BASE_PATH}/dsh"
fi
DSH_MOUNT=${DSH_MOUNT%/}
APPS_DIR=${APPS_DIR:-/home/workspace/.dsh-sandbox/caddy/apps.d}
DSH_TOKEN_PORT=${DSH_TOKEN_PORT:-3090}

# ---------------------------------------------------------------------------
# Public URL
# ---------------------------------------------------------------------------
PUBLIC_URL=${DSH_PUBLIC_URL:-}
if [ -z "${PUBLIC_URL}" ]; then
  PUBLIC_URL="http://localhost:${CADDY_PORT}${DSH_MOUNT}/"
  log "WARN: DSH_PUBLIC_URL is unset; advertising ${PUBLIC_URL}."
  log "WARN: set it to the browser-facing URL (e.g. https://sandbox.example.com/s/alice/dsh/)."
fi
[ "${PUBLIC_URL%/}" = "${PUBLIC_URL}" ] || PUBLIC_URL=${PUBLIC_URL%/}
PUBLIC_URL="${PUBLIC_URL}/"

if [[ ! "${PUBLIC_URL}" =~ ^(https?)://([^/]+)(/.*)$ ]]; then
  die "DSH_PUBLIC_URL must look like https://host[:port][/prefix]/ (got: ${PUBLIC_URL})"
fi
PUBLIC_SCHEME=${BASH_REMATCH[1]}
PUBLIC_HOST=${BASH_REMATCH[2]}
PUBLIC_PATH=${BASH_REMATCH[3]}
if [ "${PUBLIC_PATH}" != "${DSH_MOUNT}/" ]; then
  die "DSH_MOUNT (${DSH_MOUNT}) does not match the path in DSH_PUBLIC_URL (${PUBLIC_PATH}); they must be identical"
fi
PUBLIC_ORIGIN="${PUBLIC_SCHEME}://${PUBLIC_HOST}"
PUBLIC_HOSTNAME=${PUBLIC_HOST%%:*}

SANDBOX_PUBLIC_ORIGIN=${SANDBOX_PUBLIC_ORIGIN:-${PUBLIC_ORIGIN}}
SANDBOX_PUBLIC_ORIGIN=${SANDBOX_PUBLIC_ORIGIN%/}
SANDBOX_PUBLIC_URL=${SANDBOX_PUBLIC_URL:-${SANDBOX_PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/}
[ "${SANDBOX_PUBLIC_URL%/}" = "${SANDBOX_PUBLIC_URL}" ] || SANDBOX_PUBLIC_URL=${SANDBOX_PUBLIC_URL%/}
SANDBOX_PUBLIC_URL="${SANDBOX_PUBLIC_URL}/"

DSH_TRUSTED_HOSTS=${DSH_TRUSTED_HOSTS:-${PUBLIC_HOST}}
DSH_PUBLIC_URL=${PUBLIC_URL}
export CADDY_PORT DSH_PORT SANDBOX_BASE_PATH DSH_MOUNT APPS_DIR DSH_TOKEN_PORT
export PUBLIC_URL PUBLIC_SCHEME PUBLIC_HOST PUBLIC_HOSTNAME PUBLIC_ORIGIN
export SANDBOX_PUBLIC_ORIGIN SANDBOX_PUBLIC_URL
export DSH_TRUSTED_HOSTS DSH_PUBLIC_URL

# ---------------------------------------------------------------------------
# Home volume and directories
# ---------------------------------------------------------------------------
install -d -o "${WORKSPACE_USER}" -g "${WORKSPACE_USER}" -m 0755 /home/workspace /home/workspace/.dsh
install -d -o "${WORKSPACE_USER}" -g "${WORKSPACE_USER}" -m 0755 /home/workspace/default-workspace
install -d -o "${WORKSPACE_USER}" -g "${WORKSPACE_USER}" -m 0755 /home/workspace/.dsh/skills
# Existing volumes may contain root-owned skill dirs from older images.
chown -R "${WORKSPACE_USER}:${WORKSPACE_USER}" /home/workspace/.dsh/skills 2>/dev/null || true
chmod -R a+rX /home/workspace/.dsh/skills 2>/dev/null || true
if [ -d /etc/dsh/skills ]; then
  for skill in /etc/dsh/skills/*; do
    [ -e "${skill}" ] || continue
    name=$(basename "${skill}")
    install -d -o "${WORKSPACE_USER}" -g "${WORKSPACE_USER}" -m 0755 "/home/workspace/.dsh/skills/${name}"
    runuser -u "${WORKSPACE_USER}" -- cp -R "${skill}/." "/home/workspace/.dsh/skills/${name}/"
  done
fi
install -d -o "${WORKSPACE_USER}" -g "${WORKSPACE_USER}" -m 0755 /home/workspace/logs /home/workspace/.npm-global /home/workspace/.local /home/workspace/.local/bin
install -d -o "${WORKSPACE_USER}" -g "${WORKSPACE_USER}" -m 0755 \
  /home/workspace/.dsh-sandbox/services /home/workspace/.dsh-sandbox/services/conf.d
install -d -o "${WORKSPACE_USER}" -g caddy -m 2775 \
  /home/workspace/.dsh-sandbox /home/workspace/.dsh-sandbox/caddy "${APPS_DIR}"
install -d -o caddy -g caddy -m 0755 /var/lib/caddy /var/lib/caddy/.config /var/lib/caddy/.local/share

printf '%s\n' "${SANDBOX_BASE_PATH}" >/home/workspace/.dsh-sandbox/base-path.txt
printf '%s\n' "${SANDBOX_PUBLIC_ORIGIN}" >/home/workspace/.dsh-sandbox/public-origin.txt
printf '%s\n' "${SANDBOX_PUBLIC_URL}" >/home/workspace/.dsh-sandbox/public-url.txt
jq -n \
  --arg public_origin "${SANDBOX_PUBLIC_ORIGIN}" \
  --arg base_path "${SANDBOX_BASE_PATH}" \
  --arg public_url "${SANDBOX_PUBLIC_URL}" \
  --arg dsh_mount "${DSH_MOUNT}" \
  --arg dsh_public_url "${PUBLIC_URL}" \
  --arg apps_base_url "${SANDBOX_PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/apps/" \
  --arg port_proxy_base_url "${SANDBOX_PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/p/" \
  '{
    public_origin: $public_origin,
    base_path: $base_path,
    public_url: $public_url,
    dsh_mount: $dsh_mount,
    dsh_public_url: $dsh_public_url,
    apps_base_url: $apps_base_url,
    port_proxy_base_url: $port_proxy_base_url
  }' >/home/workspace/.dsh-sandbox/info.json
chown "${WORKSPACE_USER}:${WORKSPACE_USER}" \
  /home/workspace/.dsh-sandbox/base-path.txt \
  /home/workspace/.dsh-sandbox/public-origin.txt \
  /home/workspace/.dsh-sandbox/public-url.txt \
  /home/workspace/.dsh-sandbox/info.json

# User-level supervisord: long-running services under the home volume.
if [ ! -f /home/workspace/.dsh-sandbox/services/supervisord.conf ]; then
  cat >/home/workspace/.dsh-sandbox/services/supervisord.conf <<'EOF'
[supervisord]
nodaemon=true
logfile=/home/workspace/logs/user-supervisord.log
logfile_maxbytes=10MB
logfile_backups=3
loglevel=info
pidfile=/home/workspace/.dsh-sandbox/services/supervisord.pid
childlogdir=/home/workspace/logs

[unix_http_server]
file=/home/workspace/.dsh-sandbox/services/supervisor.sock
chmod=0700

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[supervisorctl]
serverurl=unix:///home/workspace/.dsh-sandbox/services/supervisor.sock

[include]
files = /home/workspace/.dsh-sandbox/services/conf.d/*.conf
EOF
  chown "${WORKSPACE_USER}:${WORKSPACE_USER}" /home/workspace/.dsh-sandbox/services/supervisord.conf
  chmod 0644 /home/workspace/.dsh-sandbox/services/supervisord.conf
fi

install -d -m 0755 /etc/caddy /etc/supervisor/conf.d /var/log/supervisor

# ---------------------------------------------------------------------------
# Refresh the system trust store when custom/enterprise CA certs are provided
# ---------------------------------------------------------------------------
if compgen -G "/etc/dsh/ca/*.crt" >/dev/null 2>&1; then
  for cert in /etc/dsh/ca/*.crt; do
    if grep -q "^-----BEGIN CERTIFICATE-----" "${cert}" 2>/dev/null; then
      cp "${cert}" "/usr/local/share/ca-certificates/$(basename "${cert}")"
    fi
  done
fi
if compgen -G "/usr/local/share/ca-certificates/*.crt" >/dev/null 2>&1; then
  update-ca-certificates >/dev/null 2>&1 || log "WARN: update-ca-certificates failed"
fi

if [ ! -f "${APPS_DIR}/00-empty.caddy" ]; then
  printf '# Drop-in Caddy routes. See sandbox-expose(1).\n' >"${APPS_DIR}/00-empty.caddy"
fi
chown "${WORKSPACE_USER}:caddy" "${APPS_DIR}/00-empty.caddy"
chmod 0644 "${APPS_DIR}/00-empty.caddy"

# A bind-mounted empty HOME has no pre-built profile; build it once here.
if [ ! -f /home/workspace/.dsh/profiles/web/package.json ]; then
  log "initializing the DSH web profile under /home/workspace/.dsh"
  runuser -u "${WORKSPACE_USER}" -- env HOME=/home/workspace DSH_HOME=/home/workspace/.dsh \
    dsh --profile web --help >/dev/null
fi

# ---------------------------------------------------------------------------
# Workspace Template & Initial Git Repository Clone
# ---------------------------------------------------------------------------
SANDBOX_TEMPLATE=${SANDBOX_TEMPLATE:-agent-os}
template_marker="/home/workspace/.dsh-sandbox/.template_initialized"
if [ ! -f "${template_marker}" ]; then
  log "initializing workspace template: ${SANDBOX_TEMPLATE}"
  case "${SANDBOX_TEMPLATE}" in
    fullstack-web)
      install -d -o "${WORKSPACE_USER}" -g "${WORKSPACE_USER}" -m 0755 /home/workspace/web-app
      cat >/home/workspace/web-app/server.js <<'EOF'
const http = require('node:http');
const port = Number(process.env.PORT || 5173);
http.createServer((req, res) => {
  const prefix = req.headers['x-forwarded-prefix'] || '';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
    <h1>Fullstack Sandbox App</h1>
    <p>Running inside your persistent Agent OS workspace.</p>
    <p>Mounted prefix: <code>${prefix || '/'}</code> · Request path: <code>${req.url}</code></p>
  </body></html>`);
}).listen(port, '127.0.0.1', () => console.log('listening on 127.0.0.1:' + port));
EOF
      chown "${WORKSPACE_USER}:${WORKSPACE_USER}" /home/workspace/web-app/server.js
      ;;
    python-data)
      install -d -o "${WORKSPACE_USER}" -g "${WORKSPACE_USER}" -m 0755 /home/workspace/data-lab
      cat >/home/workspace/data-lab/main.py <<'EOF'
"""Starter Python data & automation script in your persistent Agent OS."""
import platform
import sys

def main() -> None:
    print(f"Python {sys.version} on {platform.platform()}")

if __name__ == "__main__":
    main()
EOF
      chown "${WORKSPACE_USER}:${WORKSPACE_USER}" /home/workspace/data-lab/main.py
      ;;
    minimal)
      ;;
    *)
      if [ ! -f /home/workspace/README.md ]; then
        cat >/home/workspace/README.md <<EOF
# Agent OS Workspace

Welcome to your persistent remote DeepSeek Harness environment.

- **DSH URL**: \`${PUBLIC_URL}\`
- **Expose a web service**: \`sandbox-service add web "node server.js"\` + \`sandbox-expose web 5173\` -> \`${PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/apps/web/\`
- **Quick port forward**: \`${PUBLIC_ORIGIN}${SANDBOX_BASE_PATH}/p/<port>/\`
- **Persistent cron**: \`sandbox-cron add "0 9 * * * /home/workspace/task.sh"\`
- **Headless Chromium**: \`/usr/bin/chromium --headless --dump-dom https://example.com\`
EOF
        chown "${WORKSPACE_USER}:${WORKSPACE_USER}" /home/workspace/README.md
      fi
      ;;
  esac
  printf '%s\n' "${SANDBOX_TEMPLATE}" >"${template_marker}"
  chown "${WORKSPACE_USER}:${WORKSPACE_USER}" "${template_marker}"
fi

if [ -n "${SANDBOX_INIT_SCRIPT:-}" ]; then
  script_marker="/home/workspace/.dsh-sandbox/.init_script_executed"
  if [ ! -f "${script_marker}" ]; then
    log "executing template initialization script"
    printf '%s\n' "${SANDBOX_INIT_SCRIPT}" >/home/workspace/.dsh-sandbox/init-template.sh
    chown "${WORKSPACE_USER}:${WORKSPACE_USER}" /home/workspace/.dsh-sandbox/init-template.sh
    chmod 0755 /home/workspace/.dsh-sandbox/init-template.sh
    if runuser -u "${WORKSPACE_USER}" -- env HOME=/home/workspace DSH_HOME=/home/workspace/.dsh \
      bash -lc "cd /home/workspace && /home/workspace/.dsh-sandbox/init-template.sh"; then
      date -u +"%Y-%m-%dT%H:%M:%SZ" >"${script_marker}"
      chown "${WORKSPACE_USER}:${WORKSPACE_USER}" "${script_marker}"
    else
      log "WARN: template initialization script exited non-zero; continuing startup"
    fi
  fi
fi

if [ -n "${SANDBOX_INIT_REPO_URL:-}" ]; then
  repo_marker="/home/workspace/.dsh-sandbox/.init_repo_cloned"
  if [ ! -f "${repo_marker}" ]; then
    log "cloning initial repository: ${SANDBOX_INIT_REPO_URL}"
    repo_name=$(basename "${SANDBOX_INIT_REPO_URL}" .git)
    target_dir="/home/workspace/${repo_name}"
    if [ ! -e "${target_dir}" ]; then
      if runuser -u "${WORKSPACE_USER}" -- git clone "${SANDBOX_INIT_REPO_URL}" "${target_dir}"; then
        printf '%s\n' "${SANDBOX_INIT_REPO_URL}" >"${repo_marker}"
        chown "${WORKSPACE_USER}:${WORKSPACE_USER}" "${repo_marker}"
      else
        log "WARN: git clone ${SANDBOX_INIT_REPO_URL} failed; continuing startup"
      fi
    fi
  fi
fi

# Record self-hosted plugin index URL / npm registry and auto-install configured plugins
npm_registry="${DSH_PLUGIN_NPM_REGISTRY:-}"
if [ -z "${npm_registry}" ] && [[ "${DSH_PLUGIN_INDEX_URL:-}" == */index.json ]]; then
  npm_registry="${DSH_PLUGIN_INDEX_URL%/index.json}/npm"
fi
if [ -n "${DSH_PLUGIN_INDEX_URL:-}" ]; then
  printf '%s\n' "${DSH_PLUGIN_INDEX_URL}" >/home/workspace/.dsh-sandbox/plugin-index-url.txt
  chown "${WORKSPACE_USER}:${WORKSPACE_USER}" /home/workspace/.dsh-sandbox/plugin-index-url.txt
  log "plugin index URL configured: ${DSH_PLUGIN_INDEX_URL}"
fi
if [ -n "${DSH_EXTRA_PLUGIN_INDEX_URLS:-}" ]; then
  printf '%s\n' "${DSH_EXTRA_PLUGIN_INDEX_URLS}" >/home/workspace/.dsh-sandbox/plugin-extra-indexes.json
  chown "${WORKSPACE_USER}:${WORKSPACE_USER}" /home/workspace/.dsh-sandbox/plugin-extra-indexes.json
  log "extra plugin index sources configured"
fi
if [ -n "${npm_registry}" ]; then
  printf '%s\n' "${npm_registry}" >/home/workspace/.dsh-sandbox/plugin-npm-registry.txt
  chown "${WORKSPACE_USER}:${WORKSPACE_USER}" /home/workspace/.dsh-sandbox/plugin-npm-registry.txt
  web_profile_dir="/home/workspace/.dsh/profiles/web"
  if [ -d "${web_profile_dir}" ]; then
    NPM_REGISTRY="${npm_registry}" WEB_NPMRC="${web_profile_dir}/.npmrc" node -e '
      const fs = require("fs");
      const p = process.env.WEB_NPMRC;
      const reg = process.env.NPM_REGISTRY;
      const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
      const lines = cur.split(/\r?\n/).filter((l) => l.trim() !== "" && !/^registry\s*=/.test(l.trim()));
      lines.unshift("registry=" + reg);
      fs.writeFileSync(p, lines.join("\n") + "\n");
    ' || true
    chown "${WORKSPACE_USER}:${WORKSPACE_USER}" "${web_profile_dir}/.npmrc" 2>/dev/null || true
  fi
fi

if [ -n "${DSH_AUTO_INSTALL_PLUGINS:-}" ] && [ "${SANDBOX_TEMPLATE}" != "minimal" ]; then
  marker_file="/home/workspace/.dsh/.auto_installed_plugins"
  touch "${marker_file}"
  chown "${WORKSPACE_USER}:${WORKSPACE_USER}" "${marker_file}"

  # Legacy direct-tarball lockfiles without an integrity field break pnpm 10+ under nodeLinker=hoisted.
  web_lock="/home/workspace/.dsh/profiles/web/pnpm-lock.yaml"
  if [ -f "${web_lock}" ] && grep -qE 'resolution: \{tarball:' "${web_lock}" 2>/dev/null; then
    log "cleaning legacy tarball-only pnpm lockfile without integrity hashes"
    rm -f "${web_lock}" /home/workspace/.dsh/profiles/web/node_modules/.pnpm/lock.yaml
  fi

  IFS=',' read -r -a plugin_specs <<<"${DSH_AUTO_INSTALL_PLUGINS}"
  for spec in "${plugin_specs[@]}"; do
    spec=$(printf '%s' "${spec}" | awk '{gsub(/^[ \t]+|[ \t]+$/, ""); print}')
    [ -n "${spec}" ] || continue
    if ! grep -Fxq "${spec}" "${marker_file}" 2>/dev/null; then
      log "auto-installing DSH plugin into web profile: ${spec}"
      install_ok=0
      if [ -n "${npm_registry}" ] && [[ "${spec}" != http://* && "${spec}" != https://* && "${spec}" != /* && "${spec}" != file:* ]]; then
        if runuser -u "${WORKSPACE_USER}" -- env HOME=/home/workspace DSH_HOME=/home/workspace/.dsh \
          dsh plugin --profile web add "--registry=${npm_registry}" "${spec}"; then
          install_ok=1
        fi
      else
        if runuser -u "${WORKSPACE_USER}" -- env HOME=/home/workspace DSH_HOME=/home/workspace/.dsh \
          dsh plugin --profile web add "${spec}"; then
          install_ok=1
        fi
      fi
      if [ "${install_ok}" -eq 1 ]; then
        printf '%s\n' "${spec}" >>"${marker_file}"
      else
        log "WARN: failed to auto-install plugin ${spec}; skipping"
      fi
    fi
  done
fi

# Clean up any legacy per-container oauth2-proxy supervisor configs from upgrades
rm -f /etc/supervisor/conf.d/10-oauth2-proxy.conf /etc/supervisor/conf.d/11-oauth2-apps.conf

# ---------------------------------------------------------------------------
# Runtime configuration
# ---------------------------------------------------------------------------
DSH_GATEWAY_AUTH_MODE=${DSH_GATEWAY_AUTH_MODE:-auto}
DSH_GATEWAY_AUTH_ACTIVE=false
if [ "${DSH_GATEWAY_AUTH_MODE}" = "gateway" ]; then
  DSH_GATEWAY_AUTH_ACTIVE=true
elif [ "${DSH_GATEWAY_AUTH_MODE}" = "auto" ] \
  && [ -n "${METIS_GATEWAY_AUTH_SECRET:-}" ] \
  && [ -d /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-authentication-token ]; then
  DSH_GATEWAY_AUTH_ACTIVE=true
fi
export DSH_GATEWAY_AUTH_ACTIVE

/usr/local/bin/render-caddyfile.sh /etc/caddy/Caddyfile
/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
chmod 0644 /etc/caddy/Caddyfile

# Restore persistent user crontab if present
if [ -s /home/workspace/.dsh-sandbox/crontab ]; then
  runuser -u "${WORKSPACE_USER}" -- /usr/local/bin/sandbox-cron sync || log "WARN: failed to restore user crontab"
fi

cat >/etc/supervisor/conf.d/00-runtime.conf <<'EOF'
[program:cron]
command=/usr/sbin/cron -f
user=root
priority=12
autostart=true
autorestart=true
startsecs=1
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true

[program:user-services]
command=/usr/local/bin/user-services
user=workspace
directory=/home/workspace
environment=HOME="/home/workspace",PATH="/home/workspace/.npm-global/bin:/home/workspace/.local/bin:/opt/toolchain/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
priority=22
autostart=true
autorestart=true
startsecs=2
stopasgroup=true
killasgroup=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true

[program:caddy]
command=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
user=caddy
environment=HOME="/var/lib/caddy",XDG_CONFIG_HOME="/var/lib/caddy/.config",XDG_DATA_HOME="/var/lib/caddy/.local/share"
priority=10
autostart=true
autorestart=true
startsecs=2
stopasgroup=true
killasgroup=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
EOF

if [ "${DSH_GATEWAY_AUTH_ACTIVE}" != "true" ]; then
  cat >>/etc/supervisor/conf.d/00-runtime.conf <<'EOF'

[program:dsh-token]
command=/usr/local/bin/dsh-token
user=workspace
directory=/home/workspace
environment=HOME="/home/workspace",DSH_HOME="/home/workspace/.dsh"
priority=18
autostart=true
autorestart=true
startsecs=1
stopasgroup=true
killasgroup=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
EOF
fi

cat >>/etc/supervisor/conf.d/00-runtime.conf <<'EOF'

[program:dsh]
command=/usr/local/bin/dsh-web
user=workspace
directory=/home/workspace
environment=HOME="/home/workspace",DSH_HOME="/home/workspace/.dsh",PATH="/home/workspace/.npm-global/bin:/home/workspace/.local/bin:/opt/toolchain/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
priority=20
autostart=true
autorestart=true
startsecs=3
stopasgroup=true
killasgroup=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
EOF

log "public URL: ${PUBLIC_URL}"
log "DSH listener: 127.0.0.1:${DSH_PORT} (mount ${DSH_MOUNT}, base ${SANDBOX_BASE_PATH:-/}); Caddy: :${CADDY_PORT}"
if [ "${DSH_GATEWAY_AUTH_ACTIVE}" = "true" ]; then
  log "auth mode: metis-gateway-auth (zero-redirect Traefik ForwardAuth via ctx.connection.authentication)"
else
  log "auth mode: dsh-token (launch-token cookie exchange)"
fi

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf -n
