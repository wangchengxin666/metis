#!/usr/bin/env bash
# Render the Caddyfile used by the sandbox.
#
# Supports both root-mounted sandboxes (SANDBOX_BASE_PATH="") and single-domain
# subpath-proxied sandboxes (SANDBOX_BASE_PATH="/s/<slug>").
#
# Under SANDBOX_BASE_PATH="/s/alice":
#   /s/alice/                -> 302 /s/alice/dsh/
#   /s/alice/dsh/*           -> DSH Web UI (127.0.0.1:3080; identity verified by outer gateway)
#   /s/alice/_dsh-token      -> token helper (127.0.0.1:3090)
#   /s/alice/apps/<name>/*   -> exposed user services (open by default)
#   /s/alice/p/<port>/*      -> temporary loopback port forwarder (open by default)
set -euo pipefail

out=${1:-/etc/caddy/Caddyfile}

CADDY_PORT=${CADDY_PORT:-8080}
DSH_PORT=${DSH_PORT:-3080}
SANDBOX_BASE_PATH=${SANDBOX_BASE_PATH:-}
SANDBOX_BASE_PATH=${SANDBOX_BASE_PATH%/}
DSH_MOUNT=${DSH_MOUNT:-${SANDBOX_BASE_PATH}/dsh}
APPS_DIR=${APPS_DIR:-/home/workspace/.dsh-sandbox/caddy/apps.d}
DSH_TOKEN_PORT=${DSH_TOKEN_PORT:-3090}
PUBLIC_SCHEME=${PUBLIC_SCHEME:-http}
DSH_TOKEN_COOKIE_NAME=$(printf '%s' "${DSH_TOKEN_COOKIE_NAME:-dsh_token_seen}" | tr -c 'A-Za-z0-9_-' '_')
DSH_GATEWAY_AUTH_ACTIVE=${DSH_GATEWAY_AUTH_ACTIVE:-false}

case "${DSH_MOUNT}" in
  /*) ;;
  *) echo "render-caddyfile: DSH_MOUNT must start with '/': ${DSH_MOUNT}" >&2; exit 1 ;;
esac
DSH_MOUNT=${DSH_MOUNT%/}
if [ -z "${DSH_MOUNT}" ]; then
  echo "render-caddyfile: DSH_MOUNT must not be '/'" >&2
  exit 1
fi

TOKEN_ROUTE="${SANDBOX_BASE_PATH}/_dsh-token"
PORT_PREFIX="${SANDBOX_BASE_PATH}/p"

case "${DSH_MOUNT}" in
  /healthz|"${PORT_PREFIX}"|"${PORT_PREFIX}"/*)
    echo "render-caddyfile: DSH_MOUNT collides with a reserved route: ${DSH_MOUNT}" >&2
    exit 1
    ;;
esac

# DSH sets Path=/ on its session cookie because it serves origin-root routes.
# Rewrite the scope to the public mount; add Secure when the browser leg is TLS.
if [ "${PUBLIC_SCHEME}" = "https" ]; then
  cookie_replacement="Path=${DSH_MOUNT}/; Secure;"
else
  cookie_replacement="Path=${DSH_MOUNT}/;"
fi

{
  cat <<EOF
{
	admin 127.0.0.1:2019
	auto_https off
	log {
		output stdout
		format console
	}
}

:${CADDY_PORT} {
	encode zstd gzip

	@health path /healthz ${SANDBOX_BASE_PATH}/healthz
	handle @health {
		respond "ok" 200
	}

	# The container homepage redirects to the DSH workspace.
	@root path / ${SANDBOX_BASE_PATH} ${SANDBOX_BASE_PATH}/
	redir @root ${DSH_MOUNT}/{?query} 302

	# Authentication for DSH routes (/dsh/*, /_dsh-token) is enforced at the
	# outer Traefik gateway via ForwardAuth; /apps/* and /p/* remain open by default.
EOF

  if [ "${DSH_GATEWAY_AUTH_ACTIVE}" != "true" ]; then
    cat <<EOF

	# Send a browser that has not completed a DSH launch-token exchange to
	# the loopback helper so /s/<slug>/ works seamlessly with Traefik ForwardAuth.
	@dshLanding {
		path ${DSH_MOUNT}/
		not query token=*
		not header Cookie *${DSH_TOKEN_COOKIE_NAME}*
	}
	redir @dshLanding ${TOKEN_ROUTE} 302

	@dshToken path ${TOKEN_ROUTE} /_dsh-token
	handle @dshToken {
		reverse_proxy 127.0.0.1:${DSH_TOKEN_PORT}
	}
EOF
  fi

  cat <<EOF

	# The bare mount must reach the listener as <mount>/ so relative assets resolve.
	@dshBare path ${DSH_MOUNT}
	redir @dshBare ${DSH_MOUNT}/{?query} 308

	handle_path ${DSH_MOUNT}/* {
		# Browser-facing mount differs from the listener's origin root.
		header >Set-Cookie "Path=/;" "${cookie_replacement}"
		header >Set-Cookie "SameSite=Strict" "SameSite=Lax"
		reverse_proxy 127.0.0.1:${DSH_PORT} {
			flush_interval -1
			stream_close_delay 5m
		}
	}
EOF

  if [ "${DSH_MOUNT}" != "/dsh" ]; then
    cat <<EOF

	# Fallback for direct container port access (/dsh/*) when SANDBOX_BASE_PATH is set
	@dshDirectBare path /dsh
	redir @dshDirectBare ${DSH_MOUNT}/{?query} 302
	@dshDirect path /dsh/*
	redir @dshDirect ${DSH_MOUNT}/{http.request.uri.path.file}{?query} 302
EOF
  fi

  reserved_paths="${PORT_PREFIX}/2019/* ${PORT_PREFIX}/${DSH_PORT}/* ${PORT_PREFIX}/${DSH_TOKEN_PORT}/* ${PORT_PREFIX}/${CADDY_PORT}/* /p/2019/* /p/${DSH_PORT}/* /p/${DSH_TOKEN_PORT}/* /p/${CADDY_PORT}/*"
  cat <<EOF

	# Convenience router: ${PORT_PREFIX}/<port>/... -> 127.0.0.1:<port>/...
	@portBare path_regexp portbare ^(${SANDBOX_BASE_PATH})?/p/([0-9]{2,5})\$
	redir @portBare {re.portbare.1}/p/{re.portbare.2}/ 308

	@portSvc {
		path_regexp portsvc ^(${SANDBOX_BASE_PATH})?/p/([0-9]{2,5})(/.*)\$
		not path ${reserved_paths}
	}
	handle @portSvc {
		rewrite * {re.portsvc.3}
		reverse_proxy 127.0.0.1:{re.portsvc.2} {
			header_up X-Forwarded-Prefix {re.portsvc.1}/p/{re.portsvc.2}
		}
	}

	# Drop-in routes written by sandbox-expose(1).
	import ${APPS_DIR}/*.caddy

	handle {
		respond "dsh-sandbox: no route for {path}" 404
	}
}
EOF
} >"${out}"

if [ -n "${CADDY_BIN:-}" ]; then
  "${CADDY_BIN}" validate --config "${out}" --adapter caddyfile >/dev/null
fi
