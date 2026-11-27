ARG NODE_IMAGE=node:24-bookworm-slim
ARG PYTHON_IMAGE=python:3.13-slim

FROM ${NODE_IMAGE} AS frontend-builder

WORKDIR /workspace/frontend
ARG NPM_REGISTRY=
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

COPY frontend/package.json frontend/yarn.lock frontend/.yarnrc.yml ./
RUN if [ -n "${NPM_REGISTRY}" ]; then \
      export COREPACK_NPM_REGISTRY="${NPM_REGISTRY}"; \
    fi \
 && corepack enable \
 && corepack prepare yarn@4.18.1 --activate \
 && if [ -n "${NPM_REGISTRY}" ]; then \
      yarn config set npmRegistryServer "${NPM_REGISTRY}"; \
    fi \
 && yarn install --immutable

COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/public ./public
COPY frontend/src ./src
RUN yarn build

FROM ${PYTHON_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Optional Debian mirror host or URL (e.g. https://mirrors.aliyun.com). Supports both
# deb822 (debian.sources) and legacy sources.list layouts.
ARG APT_MIRROR=deb.debian.org
RUN if [ -n "${APT_MIRROR}" ] && [ "${APT_MIRROR}" != "deb.debian.org" ]; then \
      case "${APT_MIRROR}" in \
        http://*|https://*) mirror_url="${APT_MIRROR%/}" ;; \
        *) mirror_url="https://${APT_MIRROR}" ;; \
      esac; \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i "s|https\\?://deb.debian.org|${mirror_url}|g; s|https\\?://security.debian.org|${mirror_url}|g" /etc/apt/sources.list.d/debian.sources; \
      fi; \
      if [ -f /etc/apt/sources.list ]; then \
        sed -i "s|https\\?://deb.debian.org|${mirror_url}|g; s|https\\?://security.debian.org|${mirror_url}|g" /etc/apt/sources.list; \
      fi; \
      if [ ! -s /etc/ssl/certs/ca-certificates.crt ] && case "${mirror_url}" in https://*) true;; *) false;; esac; then \
        apt-get -o Acquire::Retries=5 -o Acquire::https::Verify-Peer=false update \
        && apt-get -o Acquire::Retries=5 -o Acquire::https::Verify-Peer=false install -y --no-install-recommends ca-certificates; \
      fi; \
    fi \
 && apt-get -o Acquire::Retries=5 update \
 && apt-get -o Acquire::Retries=5 install -y --no-install-recommends ca-certificates unixodbc \
 && rm -rf /var/lib/apt/lists/*

# Optional custom/enterprise CA bundle. Installed only if PEM certificates are present.
COPY ca-bundle.crt /tmp/ca-bundle.crt
RUN if grep -q "^-----BEGIN CERTIFICATE-----" /tmp/ca-bundle.crt 2>/dev/null; then \
      cp /tmp/ca-bundle.crt /usr/local/share/ca-certificates/custom-ca-bundle.crt; \
      update-ca-certificates; \
    fi \
 && rm -f /tmp/ca-bundle.crt

ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

# Optional PyPI mirror override (e.g. https://mirrors.aliyun.com/pypi/simple/).
ARG PIP_INDEX_URL=https://pypi.org/simple/
COPY requirements.txt /app/requirements.txt
RUN pip install --index-url "${PIP_INDEX_URL}" -r /app/requirements.txt \
 && rm -f /app/requirements.txt

COPY app /app/app
COPY --from=frontend-builder /workspace/app/web_dist /app/app/web_dist
RUN mkdir -p /data /app/plugins /app/sandbox_src

EXPOSE 9000

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9000/healthz')" || exit 1

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 9000 --workers ${MANAGER_WORKERS:-1}"]
