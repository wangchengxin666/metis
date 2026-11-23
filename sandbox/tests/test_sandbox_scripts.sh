#!/usr/bin/env bash
# Containerized unit & mock test suite for sandbox shell scripts and modular toolchain installer.
# Expected to run inside Linux (e.g. dsh-sandbox:latest) with /repo mounted read-only.
set -euo pipefail

REPO_ROOT=${1:-/repo}
unset DSH_MOUNT SANDBOX_BASE_PATH SANDBOX_PUBLIC_ORIGIN SANDBOX_PUBLIC_URL DSH_PUBLIC_URL PUBLIC_SCHEME || true
TMP_WORK=$(mktemp -d /tmp/sandbox-script-tests.XXXXXX)
trap 'rm -rf "${TMP_WORK}"' EXIT

echo "==> 1. Testing sandbox/toolchain/install.sh (INSTALL_TOOLCHAIN=false vs true)"
cp -r "${REPO_ROOT}/sandbox/toolchain" "${TMP_WORK}/tc-src"
# Replace 10-dotnet.sh in temp copy with fast deterministic mock plugins
rm -rf "${TMP_WORK}/tc-src/toolchain.d"
mkdir -p "${TMP_WORK}/tc-src/toolchain.d"
cat >"${TMP_WORK}/tc-src/toolchain.d/10-first.sh" <<'EOF'
#!/usr/bin/env bash
echo "first:${TARGETARCH}:${WORKSPACE_UID}:${WORKSPACE_GID}" >>"${TOOLCHAIN_DIR}/order.log"
mkdir -p "${TOOLCHAIN_DIR}/fake/bin"
printf '#!/usr/bin/env bash\necho fake-cli\n' >"${TOOLCHAIN_DIR}/fake/bin/fakecli"
chmod +x "${TOOLCHAIN_DIR}/fake/bin/fakecli"
toolchain_append_env "export FAKE_TOOL_HOME=\"\${TOOLCHAIN_DIR}/fake\""
toolchain_add_path "${TOOLCHAIN_DIR}/fake/bin"
toolchain_link_bin "${TOOLCHAIN_DIR}/fake/bin/fakecli"
EOF
cat >"${TMP_WORK}/tc-src/toolchain.d/20-second.sh" <<'EOF'
#!/usr/bin/env bash
echo "second" >>"${TOOLCHAIN_DIR}/order.log"
EOF
cat >"${TMP_WORK}/tc-src/toolchain.d/99-ignored.txt" <<'EOF'
should never run
EOF
chmod +x "${TMP_WORK}/tc-src/toolchain.d/"*.sh

# Case A: disabled
TC_OFF="${TMP_WORK}/opt-tc-off"
INSTALL_TOOLCHAIN=false TOOLCHAIN_DIR="${TC_OFF}" "${TMP_WORK}/tc-src/install.sh"
test -f "${TC_OFF}/env.sh"
test ! -f "${TC_OFF}/order.log"

# Case B: enabled
TC_ON="${TMP_WORK}/opt-tc-on"
INSTALL_TOOLCHAIN=true TARGETARCH=amd64 WORKSPACE_UID=1000 WORKSPACE_GID=1000 TOOLCHAIN_DIR="${TC_ON}" "${TMP_WORK}/tc-src/install.sh"
test -f "${TC_ON}/order.log"
order=$(cat "${TC_ON}/order.log")
[ "${order}" = $'first:amd64:1000:1000\nsecond' ]
test -L "${TC_ON}/bin/fakecli"
[ "$("${TC_ON}/bin/fakecli")" = "fake-cli" ]
bash -c ". '${TC_ON}/env.sh' && [ \"\${FAKE_TOOL_HOME}\" = \"/opt/toolchain/fake\" ] && case \":\$PATH:\" in *\":${TC_ON}/fake/bin:\"*|*) true;; esac"
echo "    PASS toolchain install.sh"

echo "==> 2. Testing render-caddyfile.sh + real caddy validate"
RENDER="${REPO_ROOT}/sandbox/rootfs/usr/local/bin/render-caddyfile.sh"
APPS_DIR="${TMP_WORK}/apps.d"
mkdir -p "${APPS_DIR}"

APPS_DIR="${APPS_DIR}" CADDY_BIN=caddy "${RENDER}" "${TMP_WORK}/Caddyfile.root"
grep -q 'handle_path /dsh/\*' "${TMP_WORK}/Caddyfile.root"
grep -q 'Path=/dsh/;' "${TMP_WORK}/Caddyfile.root"

SANDBOX_BASE_PATH="/s/alice" PUBLIC_SCHEME="https" \
  APPS_DIR="${APPS_DIR}" CADDY_BIN=caddy "${RENDER}" "${TMP_WORK}/Caddyfile.sub"
grep -q 'handle_path /s/alice/dsh/\*' "${TMP_WORK}/Caddyfile.sub"
grep -q 'Path=/s/alice/dsh/; Secure;' "${TMP_WORK}/Caddyfile.sub"

if DSH_MOUNT="/" APPS_DIR="${APPS_DIR}" "${RENDER}" "${TMP_WORK}/bad1" 2>/dev/null; then
  echo "ERROR: DSH_MOUNT=/ should have failed" >&2; exit 1
fi
if DSH_MOUNT="relative" APPS_DIR="${APPS_DIR}" "${RENDER}" "${TMP_WORK}/bad2" 2>/dev/null; then
  echo "ERROR: relative DSH_MOUNT should have failed" >&2; exit 1
fi
if SANDBOX_BASE_PATH="/s/alice" DSH_MOUNT="/s/alice/p/3000" APPS_DIR="${APPS_DIR}" "${RENDER}" "${TMP_WORK}/bad3" 2>/dev/null; then
  echo "ERROR: reserved prefix collision should have failed" >&2; exit 1
fi
echo "    PASS render-caddyfile.sh"

echo "==> 3. Testing sandbox-expose with mock caddy stub"
STUB_BIN="${TMP_WORK}/stub-bin"
mkdir -p "${STUB_BIN}"
cat >"${STUB_BIN}/caddy" <<'EOF'
#!/usr/bin/env bash
if [ "${MOCK_CADDY_FAIL:-0}" = "1" ]; then
  echo "mock caddy error" >&2
  exit 1
fi
exit 0
EOF
chmod +x "${STUB_BIN}/caddy"

EXPOSE="${REPO_ROOT}/sandbox/rootfs/usr/local/bin/sandbox-expose"
OUT_INFO=$(SANDBOX_BASE_PATH="/s/alice" SANDBOX_PUBLIC_ORIGIN="https://hub.example.com" "${EXPOSE}" --info)
echo "${OUT_INFO}" | grep -q 'APPS_BASE_URL=https://hub.example.com/s/alice/apps/'

EMPTY_LIST=$(PATH="${STUB_BIN}:${PATH}" SANDBOX_APPS_DIR="${APPS_DIR}" SANDBOX_CADDY_CONFIG="${TMP_WORK}/Caddyfile.sub" "${EXPOSE}" --list)
[ "${EMPTY_LIST}" = "no exposed services" ]

ADD_OUT=$(PATH="${STUB_BIN}:${PATH}" SANDBOX_APPS_DIR="${APPS_DIR}" SANDBOX_CADDY_CONFIG="${TMP_WORK}/Caddyfile.sub" \
  SANDBOX_BASE_PATH="/s/alice" SANDBOX_PUBLIC_ORIGIN="https://hub.example.com" "${EXPOSE}" web 5173)
echo "${ADD_OUT}" | grep -q 'https://hub.example.com/s/alice/apps/web/'
grep -q 'handle_path /s/alice/apps/web/\*' "${APPS_DIR}/web.caddy"
grep -q 'handle_path /apps/web/\*' "${APPS_DIR}/web.caddy"

PATH="${STUB_BIN}:${PATH}" SANDBOX_APPS_DIR="${APPS_DIR}" SANDBOX_CADDY_CONFIG="${TMP_WORK}/Caddyfile.sub" \
  SANDBOX_BASE_PATH="/s/alice" SANDBOX_PUBLIC_ORIGIN="https://hub.example.com" "${EXPOSE}" --list | grep -q '/s/alice/apps/web/'

# Validation failure cases
for bad_args in "--auth web 5173" "BadName 5173" "web abc" "web 8080" "web 3080" "web 2019" "web 70000" "web 5173 /"; do
  if PATH="${STUB_BIN}:${PATH}" SANDBOX_APPS_DIR="${APPS_DIR}" SANDBOX_CADDY_CONFIG="${TMP_WORK}/Caddyfile.sub" \
    "${EXPOSE}" ${bad_args} >/dev/null 2>&1; then
    echo "ERROR: sandbox-expose should reject: ${bad_args}" >&2; exit 1
  fi
done

# Rollback on Caddy failure
if MOCK_CADDY_FAIL=1 PATH="${STUB_BIN}:${PATH}" SANDBOX_APPS_DIR="${APPS_DIR}" SANDBOX_CADDY_CONFIG="${TMP_WORK}/Caddyfile.sub" \
  SANDBOX_BASE_PATH="/s/alice" "${EXPOSE}" broken 9999 >/dev/null 2>&1; then
  echo "ERROR: sandbox-expose should fail when caddy validation fails" >&2; exit 1
fi
test ! -f "${APPS_DIR}/broken.caddy"

PATH="${STUB_BIN}:${PATH}" SANDBOX_APPS_DIR="${APPS_DIR}" SANDBOX_CADDY_CONFIG="${TMP_WORK}/Caddyfile.sub" "${EXPOSE}" --remove web >/dev/null
test ! -f "${APPS_DIR}/web.caddy"
echo "    PASS sandbox-expose"

echo "==> 4. Testing sandbox-cron with mock crontab"
TEST_HOME="${TMP_WORK}/home"
mkdir -p "${TEST_HOME}/logs"
cat >"${STUB_BIN}/crontab" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "-r" ]; then
  rm -f "${TMP_WORK}/active-crontab"
  exit 0
fi
cp "\$1" "${TMP_WORK}/active-crontab"
EOF
chmod +x "${STUB_BIN}/crontab"

CRON="${REPO_ROOT}/sandbox/rootfs/usr/local/bin/sandbox-cron"
HOME="${TEST_HOME}" PATH="${STUB_BIN}:${PATH}" "${CRON}" add "0 9 * * * echo hi" >/dev/null
HOME="${TEST_HOME}" PATH="${STUB_BIN}:${PATH}" "${CRON}" list | grep -q '0 9 \* \* \* echo hi'
grep -q '0 9 \* \* \* echo hi' "${TMP_WORK}/active-crontab"
HOME="${TEST_HOME}" PATH="${STUB_BIN}:${PATH}" "${CRON}" clear >/dev/null
[ ! -s "${TEST_HOME}/.dsh-sandbox/crontab" ]
echo "    PASS sandbox-cron"

echo "==> 5. Testing sandbox-service with mock supervisorctl"
mkdir -p "${TEST_HOME}/.dsh-sandbox/services/conf.d"
touch "${TEST_HOME}/.dsh-sandbox/services/supervisord.conf"
cat >"${STUB_BIN}/supervisorctl" <<'EOF'
#!/usr/bin/env bash
echo "supervisorctl:$*" >>"${SUP_LOG:-/dev/null}"
EOF
chmod +x "${STUB_BIN}/supervisorctl"

SVC="${REPO_ROOT}/sandbox/rootfs/usr/local/bin/sandbox-service"
export SUP_LOG="${TMP_WORK}/sup.log"

[ "$(HOME="${TEST_HOME}" PATH="${STUB_BIN}:${PATH}" "${SVC}" list)" = "no user services" ]
HOME="${TEST_HOME}" PATH="${STUB_BIN}:${PATH}" "${SVC}" add api "python3 -m http.server 5000" >/dev/null
test -f "${TEST_HOME}/.dsh-sandbox/services/conf.d/api.conf"
grep -q '\[program:api\]' "${TEST_HOME}/.dsh-sandbox/services/conf.d/api.conf"
if HOME="${TEST_HOME}" PATH="${STUB_BIN}:${PATH}" "${SVC}" add api "dup" >/dev/null 2>&1; then
  echo "ERROR: duplicate service should fail" >&2; exit 1
fi
HOME="${TEST_HOME}" PATH="${STUB_BIN}:${PATH}" "${SVC}" restart api >/dev/null
HOME="${TEST_HOME}" PATH="${STUB_BIN}:${PATH}" "${SVC}" stop api >/dev/null
HOME="${TEST_HOME}" PATH="${STUB_BIN}:${PATH}" "${SVC}" remove api >/dev/null
test ! -f "${TEST_HOME}/.dsh-sandbox/services/conf.d/api.conf"
echo "    PASS sandbox-service"

echo "ALL SANDBOX SCRIPT TESTS PASSED"
