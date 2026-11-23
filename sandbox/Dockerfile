# ---------------------------------------------------------------------------
# Binary sources: reuse the official images instead of downloading tarballs.
# ---------------------------------------------------------------------------
# Full image prefix for Docker Hub images. Defaults to Docker Hub; override
# DOCKER_REGISTRY (e.g. your-registry.example.com/docker) in restricted networks.
ARG DOCKER_REGISTRY=docker.io/library
ARG CADDY_VERSION=2.11.9
ARG DEBIAN_VERSION=13-slim

FROM ${DOCKER_REGISTRY}/caddy:${CADDY_VERSION}-alpine AS caddy-bin

# ---------------------------------------------------------------------------
# Runtime image
# ---------------------------------------------------------------------------
FROM ${DOCKER_REGISTRY}/debian:${DEBIAN_VERSION}

ARG NODE_VERSION=24.22.3
ARG DSH_VERSION=0.2.2-rc.3
ARG INSTALL_BROWSER=false
ARG WORKSPACE_UID=1000
ARG WORKSPACE_GID=1000
# Optional Debian mirror host or URL (e.g. https://mirrors.aliyun.com),
# Node.js dist mirror (e.g. https://mirrors.aliyun.com/nodejs-release),
# npm registry, and PyPI index URL (e.g. https://mirrors.aliyun.com/pypi/simple/).
ARG APT_MIRROR=deb.debian.org
ARG NODE_MIRROR=https://nodejs.org/dist
ARG NPM_REGISTRY=
ARG PIP_INDEX_URL=https://pypi.org/simple/

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=UTC \
    TOOLCHAIN_DIR=/opt/toolchain \
    CHROME_BIN=/usr/bin/chromium \
    CHROMIUM_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    PATH=/opt/toolchain/bin:/usr/local/bin:/home/workspace/.npm-global/bin:/home/workspace/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin

RUN if [ -n "${APT_MIRROR}" ] && [ "${APT_MIRROR}" != "deb.debian.org" ]; then \
      case "${APT_MIRROR}" in \
        http://*|https://*) mirror_url="${APT_MIRROR%/}" ;; \
        *) mirror_url="https://${APT_MIRROR}" ;; \
      esac; \
      sed -i "s|https\\?://deb.debian.org|${mirror_url}|g; s|https\\?://security.debian.org|${mirror_url}|g" /etc/apt/sources.list.d/debian.sources; \
      if [ ! -s /etc/ssl/certs/ca-certificates.crt ] && case "${mirror_url}" in https://*) true;; *) false;; esac; then \
        apt-get -o Acquire::Retries=5 -o Acquire::https::Verify-Peer=false update \
        && apt-get -o Acquire::Retries=5 -o Acquire::https::Verify-Peer=false install -y --no-install-recommends ca-certificates; \
      fi; \
    fi \
 && apt-get -o Acquire::Retries=5 update \
 && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
      ca-certificates curl wget git openssh-client gnupg \
      build-essential pkg-config libssl-dev zlib1g-dev libffi-dev libsqlite3-dev \
      libicu-dev libunwind8 \
      python3 python3-venv python3-pip python3-dev pipx \
      jq ripgrep fd-find unzip zip xz-utils tar less nano vim-tiny tmux cron \
      procps htop iproute2 dnsutils netcat-openbsd rsync file tzdata \
      supervisor bubblewrap \
      locales fontconfig fonts-wqy-microhei \
 && localedef -i zh_CN -f UTF-8 zh_CN.UTF-8 \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/* \
 && ln -sf /usr/bin/fdfind /usr/local/bin/fd

# Optional Headless Chromium + Xvfb layer (enable with --build-arg INSTALL_BROWSER=true)
RUN if [ "${INSTALL_BROWSER}" = "true" ]; then \
      apt-get -o Acquire::Retries=5 update \
      && apt-get -o Acquire::Retries=5 install -y --no-install-recommends chromium xvfb dbus-x11 \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# ---------------------------------------------------------------------------
# Node.js (DSH itself requires Node >= 24.9)
# ---------------------------------------------------------------------------
# Set automatically by BuildKit; default keeps plain docker build on amd64.
ARG TARGETARCH=amd64
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) node_arch=x64 ;; \
      arm64) node_arch=arm64 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    node_mirror="${NODE_MIRROR:-https://nodejs.org/dist}"; \
    case "${node_mirror}" in \
      http://*|https://*) node_mirror="${node_mirror%/}" ;; \
      *) node_mirror="https://${node_mirror%/}" ;; \
    esac; \
    curl -fsSL --retry 3 "${node_mirror}/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -o /tmp/node.tar.xz; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner; \
    rm -f /tmp/node.tar.xz; \
    node --version; npm --version

# npm >= 11.6 blocks dependency install scripts unless approved. DSH needs
# node-pty's prebuild and koffi's native build, so allow the pinned packages'
# scripts explicitly for this build-time install.
ARG DSH_PACKAGE_VERSION=
RUN set -eux; \
    registry_flag=""; \
    if [ -n "${NPM_REGISTRY}" ]; then registry_flag="--registry=${NPM_REGISTRY}"; fi; \
    dsh_ver="${DSH_PACKAGE_VERSION:-${DSH_VERSION}}"; \
    npm install -g --no-fund --no-audit --dangerously-allow-all-scripts ${registry_flag} \
      "pnpm@10" "@deepseek-ai/dsh@${dsh_ver}" \
 && npm cache clean --force

# ---------------------------------------------------------------------------
# Reverse proxy binary
# ---------------------------------------------------------------------------
COPY --from=caddy-bin /usr/bin/caddy /usr/local/bin/caddy

# ---------------------------------------------------------------------------
# Optional custom / enterprise CA bundle. Installed only if PEM certificates
# are present in ca-bundle.crt, or mounted into /etc/dsh/ca/*.crt at runtime.
# ---------------------------------------------------------------------------
RUN mkdir -p /etc/dsh/ca
COPY ca-bundle.crt /tmp/ca-bundle.crt
RUN if grep -q "^-----BEGIN CERTIFICATE-----" /tmp/ca-bundle.crt 2>/dev/null; then \
      cp /tmp/ca-bundle.crt /usr/local/share/ca-certificates/custom-ca-bundle.crt; \
      update-ca-certificates; \
    fi \
 && rm -f /tmp/ca-bundle.crt

# Node uses its own store; Go/Python/git honor these. The file is regenerated
# by update-ca-certificates and includes both Debian roots and any custom CAs.
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt

# ---------------------------------------------------------------------------
# uv (Python package & runtime manager, installed via pip using PIP_INDEX_URL)
# ---------------------------------------------------------------------------
RUN set -eux; \
    pip_index="${PIP_INDEX_URL:-https://pypi.org/simple/}"; \
    trusted_flag=""; \
    case "${pip_index}" in \
      http://*) trusted_host="${pip_index#http://}"; trusted_host="${trusted_host%%/*}"; trusted_host="${trusted_host%%:*}"; trusted_flag="--trusted-host ${trusted_host}" ;; \
    esac; \
    pip3 install --no-cache-dir --break-system-packages --root-user-action=ignore \
      --index-url "${pip_index}" ${trusted_flag} uv; \
    uv --version; \
    uvx --version

# ---------------------------------------------------------------------------
# Optional custom toolchains (installed into /opt/toolchain when INSTALL_TOOLCHAIN=true).
# Scripts in sandbox/toolchain/toolchain.d/*.sh run in sorted filename order.
# ---------------------------------------------------------------------------
ARG INSTALL_TOOLCHAIN=false
COPY toolchain/ /tmp/toolchain-src/
RUN find /tmp/toolchain-src -type f -name '*.sh' -exec sed -i 's/\r$//' {} + \
 && chmod +x /tmp/toolchain-src/install.sh \
 && INSTALL_TOOLCHAIN="${INSTALL_TOOLCHAIN}" TARGETARCH="${TARGETARCH}" /tmp/toolchain-src/install.sh \
 && rm -rf /tmp/toolchain-src

# ---------------------------------------------------------------------------
# Users: workspace is the only account the agent runs as; caddy runs the proxy daemon.
# ---------------------------------------------------------------------------
RUN set -eux; \
    groupadd -g "${WORKSPACE_GID}" workspace; \
    useradd -m -u "${WORKSPACE_UID}" -g workspace -s /bin/bash workspace; \
    groupadd -r caddy; \
    useradd -r -g caddy -d /var/lib/caddy -s /usr/sbin/nologin caddy; \
    \
    install -d -o workspace -g workspace -m 0755 /home/workspace /home/workspace/.dsh; \
    install -d -o workspace -g caddy     -m 2775 /home/workspace/.dsh-sandbox /home/workspace/.dsh-sandbox/caddy /home/workspace/.dsh-sandbox/caddy/apps.d; \
    install -d -o caddy     -g caddy     -m 0755 /var/lib/caddy /var/lib/caddy/.config /var/lib/caddy/.local/share; \
    install -d -o workspace -g workspace -m 0755 /home/workspace/.npm-global /home/workspace/.local /home/workspace/.local/bin /home/workspace/logs; \
    \
    printf '# Drop-in Caddy routes. See sandbox-expose(1).\n' > /home/workspace/.dsh-sandbox/caddy/apps.d/00-empty.caddy; \
    chown workspace:caddy /home/workspace/.dsh-sandbox/caddy/apps.d/00-empty.caddy; \
    chmod 0644 /home/workspace/.dsh-sandbox/caddy/apps.d/00-empty.caddy; \
    \
    printf 'prefix=/home/workspace/.npm-global\n' > /home/workspace/.npmrc; \
    chown workspace:workspace /home/workspace/.npmrc

# ---------------------------------------------------------------------------
# Application files
# ---------------------------------------------------------------------------
COPY rootfs/ /
RUN sed -i 's/\r$//' \
      /usr/local/bin/dsh-token \
      /usr/local/bin/dsh-web \
      /usr/local/bin/entrypoint.sh \
      /usr/local/bin/render-caddyfile.sh \
      /usr/local/bin/sandbox-cron \
      /usr/local/bin/sandbox-expose \
      /usr/local/bin/sandbox-service \
      /usr/local/bin/user-services \
      /etc/dsh/*.yml \
      /opt/metis-gateway-auth/* \
      /etc/profile.d/toolchain.sh \
      /etc/supervisor/supervisord.conf \
 && chmod 0755 /usr /usr/local /usr/local/bin /etc /etc/dsh /etc/profile.d /etc/supervisor /opt /opt/metis-gateway-auth \
 && chmod -R a+rX /etc/dsh /opt/metis-gateway-auth \
 && chmod 0755 /usr/local/bin/* \
 && chmod 0644 /etc/profile.d/toolchain.sh /etc/supervisor/supervisord.conf \
 && grep -Fq '/opt/toolchain/env.sh' /etc/bash.bashrc \
    || printf '\n[ -r /opt/toolchain/env.sh ] && . /opt/toolchain/env.sh\n' >> /etc/bash.bashrc

# Pre-initialize the Web profile so the first start does not need extra work
# and so a bind-mounted empty HOME still has a template to fall back on.
USER workspace
RUN HOME=/home/workspace DSH_HOME=/home/workspace/.dsh dsh --profile web --help >/dev/null
USER root

# Build-time guard: root-mounted, subpath token-mode, and subpath gateway-auth variants must parse.
RUN CADDY_PORT=8080 DSH_PORT=3080 DSH_MOUNT=/dsh \
      APPS_DIR=/home/workspace/.dsh-sandbox/caddy/apps.d PUBLIC_SCHEME=http \
      /usr/local/bin/render-caddyfile.sh /tmp/Caddyfile.root \
 && caddy validate --config /tmp/Caddyfile.root --adapter caddyfile \
 && CADDY_PORT=8080 DSH_PORT=3080 SANDBOX_BASE_PATH=/s/alice DSH_MOUNT=/s/alice/dsh \
      APPS_DIR=/home/workspace/.dsh-sandbox/caddy/apps.d PUBLIC_SCHEME=https \
      /usr/local/bin/render-caddyfile.sh /tmp/Caddyfile.subpath \
 && caddy validate --config /tmp/Caddyfile.subpath --adapter caddyfile \
 && CADDY_PORT=8080 DSH_PORT=3080 SANDBOX_BASE_PATH=/s/alice DSH_MOUNT=/s/alice/dsh \
      APPS_DIR=/home/workspace/.dsh-sandbox/caddy/apps.d PUBLIC_SCHEME=https DSH_GATEWAY_AUTH_ACTIVE=true \
      /usr/local/bin/render-caddyfile.sh /tmp/Caddyfile.gwauth \
 && caddy validate --config /tmp/Caddyfile.gwauth --adapter caddyfile \
 && rm -f /tmp/Caddyfile.root /tmp/Caddyfile.subpath /tmp/Caddyfile.gwauth

ENV DSH_HOME=/home/workspace/.dsh \
    DSH_PERMISSION_MODE=danger-full-access \
    CADDY_PORT=8080 \
    DSH_PORT=3080 \
    DSH_MOUNT=/dsh \
    APPS_DIR=/home/workspace/.dsh-sandbox/caddy/apps.d

WORKDIR /home/workspace
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${CADDY_PORT:-8080}/healthz" || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
