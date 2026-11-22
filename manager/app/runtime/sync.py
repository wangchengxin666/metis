from __future__ import annotations

import json
import re
from typing import Any

from ..models import LlmProfile, Sandbox
from ..plugin_registry import PluginRegistryService
from ..security import decrypt_secret

LEGACY_PLUGIN_PACKAGE_ALIASES: dict[str, tuple[str, ...]] = {
    "@metis/file-manager": ("@local/dsh-plugin-file-manager", "@dsh-dock/file-manager"),
    "@metis/workspace-user": ("@dsh-dock/workspace-user",),
    "@metis/custom-theme": ("@dsh-dock/custom-theme",),
    "@metis/sandbox-mesh": ("@dsh-dock/sandbox-mesh",),
    "@metis/sandbox-memory": ("@dsh-dock/sandbox-memory",),
    "@metis/work-delivery": ("@dsh-dock/work-delivery",),
}


def llm_provider_identifiers(profile: LlmProfile) -> tuple[str, str]:
    """Derive stable (provider_key, credential_ref) identifiers for a Manager LLM profile."""
    raw_id = re.sub(r"[^a-z0-9]", "", (profile.id or "").lower())
    suffix = raw_id[:12] if raw_id else "default"
    return f"mgr-{suffix}", f"DSH_LLM_MGR_{suffix.upper()}_KEY"


class SandboxSyncMixin:
    """Plugin Market and LLM hot-sync operations executed inside running sandboxes."""

    def sync_plugin_market(
        self,
        sandbox: Sandbox,
        reinstall_plugins: list[str] | None = None,
        force_reinstall: bool = False,
    ) -> dict[str, Any]:
        """Ensure Plugin Market config and optionally force-reinstall built-in plugins in a sandbox."""
        st = self._workload_status(sandbox)
        if st != "running":
            return {"slug": sandbox.slug, "ok": False, "detail": f"status={st}"}

        manager_url = self.settings.sandbox_reachable_manager_url
        index_url = f"{manager_url}/plugins/index.json"
        npm_registry = f"{manager_url}/plugins/npm"
        registry = PluginRegistryService(self.settings)
        registry_packages = {pkg.name: pkg for pkg in registry.list_packages()}

        explicit_targets: list[str] = []
        for raw_spec in reinstall_plugins or []:
            spec = raw_spec.strip()
            if not spec:
                continue
            pkg = registry.get_by_package_name(spec) or registry.get_by_slug_or_filename(spec)
            explicit_targets.append(pkg.name if pkg else spec)

        node_script = """
const fs = require('fs');
const indexUrl = process.env.INDEX_URL;
const npmRegistry = process.env.NPM_REGISTRY || '';
try { fs.rmSync('/home/workspace/.cache/pnpm', { recursive: true, force: true }); } catch {}
fs.mkdirSync('/home/workspace/.dsh-sandbox', { recursive: true });
fs.writeFileSync('/home/workspace/.dsh-sandbox/plugin-index-url.txt', indexUrl + '\\n');
if (npmRegistry) {
  fs.writeFileSync('/home/workspace/.dsh-sandbox/plugin-npm-registry.txt', npmRegistry + '\\n');
}
const profileDir = '/home/workspace/.dsh/profiles/web';
const pkgPath = profileDir + '/package.json';
const patchPath = profileDir + '/cordis.patch.yml';
const npmrcPath = profileDir + '/.npmrc';
if (npmRegistry && fs.existsSync(profileDir)) {
  const existing = fs.existsSync(npmrcPath) ? fs.readFileSync(npmrcPath, 'utf8') : '';
  const lines = existing.split(/\\r?\\n/).filter((l) => l.trim() !== '' && !/^registry\\s*=/.test(l.trim()));
  lines.unshift('registry=' + npmRegistry);
  fs.writeFileSync(npmrcPath, lines.join('\\n') + '\\n');
}
let installedDeps = [];
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  installedDeps = Object.keys(pkg.dependencies || {});
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  pkg.dsh.profile.bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
  const bundle = '@deepseek-ai/dsh-experimental-plugin-market-bundle';
  if (!pkg.dsh.profile.bundles.includes(bundle)) {
    pkg.dsh.profile.bundles.push(bundle);
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\\n');
  }
}
if (fs.existsSync(patchPath)) {
  let content = fs.readFileSync(patchPath, 'utf8');
  content = content.replace(/^\\s*\\[\\]\\s*$/m, '');
  if (!content.includes('id: plugin-market')) {
    content = content.trimEnd() + '\\n\\n- id: plugin-market\\n  name: "@deepseek-ai/dsh-plugin-market"\\n  config:\\n    indexes:\\n      - ' + JSON.stringify(indexUrl) + '\\n';
    fs.writeFileSync(patchPath, content);
  } else if (!content.includes(indexUrl)) {
    content = content.replace(/(- id: plugin-market[\\s\\S]*?indexes:)\\s*\\[\\s*\\]/, '$1\\n      - ' + JSON.stringify(indexUrl));
    if (!content.includes(indexUrl)) {
      content = content.replace(/(- id: plugin-market[\\s\\S]*?indexes:)/, '$1\\n      - ' + JSON.stringify(indexUrl));
    }
    fs.writeFileSync(patchPath, content);
  }
}
console.log('INSTALLED_DEPS=' + JSON.stringify(installedDeps));
"""
        ec1, out1 = self.exec_command(
            sandbox,
            ["node", "-e", node_script],
            user="workspace",
            environment={
                "INDEX_URL": index_url,
                "NPM_REGISTRY": npm_registry,
                "HOME": "/home/workspace",
            },
        )
        text1 = out1.decode("utf-8", errors="replace").strip() if out1 else ""
        if ec1 != 0:
            return {"slug": sandbox.slug, "ok": False, "detail": text1[-300:]}

        installed_deps: list[str] = []
        for line in text1.splitlines():
            if line.startswith("INSTALLED_DEPS="):
                try:
                    parsed = json.loads(line.split("=", 1)[1])
                    if isinstance(parsed, list):
                        installed_deps = [str(x) for x in parsed]
                except Exception:
                    pass

        targets_to_install = list(explicit_targets)
        if not targets_to_install and force_reinstall:
            configured = self._resolve_auto_install_plugins(sandbox.auto_install_plugins)
            configured_list = [x.strip() for x in configured.split(",") if x.strip()]
            installed_builtin = [name for name in installed_deps if name in registry_packages]
            seen_targets: set[str] = set()
            for item in [*installed_builtin, *configured_list]:
                if item not in seen_targets:
                    seen_targets.add(item)
                    targets_to_install.append(item)

        reinstalled: list[str] = []
        if targets_to_install:
            env = {
                "HOME": "/home/workspace",
                "DSH_HOME": "/home/workspace/.dsh",
                "npm_config_registry": npm_registry,
            }
            self.exec_command(
                sandbox,
                [
                    "sh",
                    "-c",
                    "rm -rf /home/workspace/.dsh/profiles/web/.pnpm-store "
                    "/home/workspace/.local/share/pnpm/store /home/workspace/.cache/pnpm",
                ],
                user="workspace",
                environment=env,
            )
            to_remove_set: set[str] = set()
            for p in targets_to_install:
                if p in installed_deps:
                    to_remove_set.add(p)
                for legacy_pkg in LEGACY_PLUGIN_PACKAGE_ALIASES.get(p, ()):
                    if legacy_pkg in installed_deps:
                        to_remove_set.add(legacy_pkg)
            to_remove = sorted(to_remove_set)
            if to_remove:
                self.exec_command(
                    sandbox,
                    ["dsh", "plugin", "--profile", "web", "remove", *to_remove],
                    user="workspace",
                    environment=env,
                )
            for spec in targets_to_install:
                cmd = ["dsh", "plugin", "--profile", "web", "add"]
                if not spec.startswith(("http://", "https://", "/", "file:")):
                    cmd.append(f"--registry={npm_registry}")
                cmd.append(spec)
                ec_add, out_add = self.exec_command(
                    sandbox, cmd, user="workspace", environment=env
                )
                if ec_add != 0:
                    add_msg = out_add.decode("utf-8", errors="replace").strip() if out_add else ""
                    return {
                        "slug": sandbox.slug,
                        "ok": False,
                        "reinstalled": reinstalled,
                        "detail": f"failed to install {spec}: {add_msg[-240:]}",
                    }
                reinstalled.append(spec)

        ec2, out2 = self.exec_command(
            sandbox,
            ["supervisorctl", "restart", "dsh"],
            user="root",
        )
        text = out2.decode("utf-8", errors="replace").strip() if out2 else ""
        return {
            "slug": sandbox.slug,
            "ok": ec2 == 0,
            "reinstalled": reinstalled,
            "detail": text[-300:] if text else "synced",
        }

    def sync_llm_profile(
        self,
        sandbox: Sandbox,
        profile: LlmProfile,
        *,
        set_as_default: bool = True,
        replace_managed: bool = False,
    ) -> dict[str, Any]:
        """Hot-push an LLM profile into a running sandbox's DSH config and restart dsh."""
        st = self._workload_status(sandbox)
        if st != "running":
            return {
                "slug": sandbox.slug,
                "sandbox_id": sandbox.id,
                "ok": False,
                "skipped": True,
                "detail": f"status={st}",
            }

        provider_key, cred_ref = llm_provider_identifiers(profile)
        api_key = ""
        if profile.api_key_ciphertext:
            try:
                api_key = decrypt_secret(profile.api_key_ciphertext)
            except ValueError:
                api_key = ""

        api_protocol = (profile.api_protocol or "openai-completions").strip()
        payload = {
            "providerKey": provider_key,
            "credRef": cred_ref,
            "displayName": profile.name,
            "apiProtocol": api_protocol,
            "baseUrl": profile.base_url,
            "model": profile.model,
            "apiKey": api_key or "local-no-key",
            "contextWindow": profile.context_window,
            "maxTokens": profile.max_tokens,
            "supportsImage": bool(profile.supports_image),
            "reasoningEffort": (profile.reasoning_effort or "").strip().lower(),
            "thinkingFormat": (
                (profile.thinking_format or "").strip()
                if api_protocol == "openai-completions"
                else ""
            ),
            "setAsDefault": bool(set_as_default),
            "replaceManaged": bool(replace_managed),
        }

        node_script = """
const fs = require('fs');
const path = require('path');
const yaml = require('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/yaml');

const cfg = JSON.parse(process.env.LLM_PUSH_PAYLOAD || '{}');
const validEfforts = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const dshHome = '/home/workspace/.dsh';
const profileDir = path.join(dshHome, 'profiles', 'web');
const patchPath = path.join(profileDir, 'cordis.patch.yml');
const credPath = path.join(dshHome, '.credentials.yaml');

fs.mkdirSync(profileDir, { recursive: true });

let entries = [];
if (fs.existsSync(patchPath)) {
  const raw = fs.readFileSync(patchPath, 'utf8');
  const parsed = yaml.parse(raw);
  if (Array.isArray(parsed)) entries = parsed;
}

let piAiEntry = entries.find((e) => e && typeof e === 'object' && e.id === 'llm-pi-ai');
if (!piAiEntry) {
  piAiEntry = { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: {} } };
  entries.push(piAiEntry);
}
if (!piAiEntry.name) piAiEntry.name = '@deepseek-ai/dsh-llm-pi-ai';
if (!piAiEntry.config || typeof piAiEntry.config !== 'object') piAiEntry.config = {};
if (!piAiEntry.config.providers || typeof piAiEntry.config.providers !== 'object') {
  piAiEntry.config.providers = {};
}
const providers = piAiEntry.config.providers;

let removedLegacyDefault = false;
const removedRefs = [];
const legacyBoot = providers['openai-compatible'];
if (legacyBoot && typeof legacyBoot === 'object' && legacyBoot.apiKeyEnv === 'DSH_DEFAULT_LLM_API_KEY') {
  if (
    cfg.replaceManaged
    || legacyBoot.displayName === cfg.displayName
    || legacyBoot.baseURL === cfg.baseUrl
  ) {
    delete providers['openai-compatible'];
    removedLegacyDefault = true;
  }
}
if (cfg.replaceManaged) {
  for (const key of Object.keys(providers)) {
    if (key.startsWith('mgr-') && key !== cfg.providerKey) {
      const ref = providers[key] && providers[key].apiKeyEnv;
      if (typeof ref === 'string' && ref.startsWith('DSH_LLM_MGR_')) {
        removedRefs.push(ref);
      }
      delete providers[key];
    }
  }
}

const modelEntry = {
  id: cfg.model,
  name: cfg.model,
  input: cfg.supportsImage ? ['text', 'image'] : ['text'],
};
if (Number.isFinite(cfg.contextWindow) && cfg.contextWindow >= 1024) {
  modelEntry.contextWindow = Math.floor(cfg.contextWindow);
}
if (Number.isFinite(cfg.maxTokens) && cfg.maxTokens >= 128) {
  modelEntry.maxTokens = Math.floor(cfg.maxTokens);
}
if (cfg.reasoningEffort === 'off') {
  modelEntry.reasoningEfforts = false;
} else if (validEfforts.has(cfg.reasoningEffort)) {
  modelEntry.reasoningEfforts = {
    off: null,
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  };
}

const providerObj = {
  api: cfg.apiProtocol || 'openai-completions',
  baseURL: cfg.baseUrl,
  displayName: cfg.displayName,
  apiKeyEnv: cfg.credRef,
};
if (validEfforts.has(cfg.reasoningEffort)) {
  providerObj.reasoning = cfg.reasoningEffort;
}
if (cfg.thinkingFormat && providerObj.api === 'openai-completions') {
  providerObj.compat = { thinkingFormat: cfg.thinkingFormat };
}
providerObj.models = [modelEntry];
providers[cfg.providerKey] = providerObj;

let defaultEntry = entries.find((e) => e && typeof e === 'object' && e.id === 'agent-default-model');
const shouldUpdateDefault = Boolean(cfg.setAsDefault)
  || (removedLegacyDefault && defaultEntry && defaultEntry.config && defaultEntry.config.provider === 'openai-compatible');
if (shouldUpdateDefault) {
  const defaultConfig = {
    provider: cfg.providerKey,
    model: cfg.model,
  };
  if (validEfforts.has(cfg.reasoningEffort) && cfg.reasoningEffort !== 'off') {
    defaultConfig.reasoningEffort = cfg.reasoningEffort;
  }
  if (!defaultEntry) {
    defaultEntry = { id: 'agent-default-model', config: defaultConfig };
    entries.unshift(defaultEntry);
  } else {
    defaultEntry.config = defaultConfig;
  }
}

const patchTmp = patchPath + '.tmp.' + process.pid;
fs.writeFileSync(patchTmp, yaml.stringify(entries), 'utf8');
fs.renameSync(patchTmp, patchPath);

let credDoc = { version: 1, refs: {} };
if (fs.existsSync(credPath)) {
  const rawCred = fs.readFileSync(credPath, 'utf8');
  const parsedCred = yaml.parse(rawCred);
  if (parsedCred && typeof parsedCred === 'object' && !Array.isArray(parsedCred)) {
    credDoc = parsedCred;
  }
}
credDoc.version = 1;
if (!credDoc.refs || typeof credDoc.refs !== 'object' || Array.isArray(credDoc.refs)) {
  credDoc.refs = {};
}
for (const oldRef of removedRefs) {
  delete credDoc.refs[oldRef];
}
credDoc.refs[cfg.credRef] = cfg.apiKey || 'local-no-key';

const credTmp = credPath + '.tmp.' + process.pid;
fs.writeFileSync(credTmp, yaml.stringify(credDoc), { encoding: 'utf8', mode: 0o600 });
fs.chmodSync(credTmp, 0o600);
fs.renameSync(credTmp, credPath);
fs.chmodSync(credPath, 0o600);
console.log('LLM_SYNC_OK:' + cfg.providerKey + ':' + cfg.model);
"""
        ec1, out1 = self.exec_command(
            sandbox,
            ["node", "-e", node_script],
            user="workspace",
            environment={
                "HOME": "/home/workspace",
                "DSH_HOME": "/home/workspace/.dsh",
                "LLM_PUSH_PAYLOAD": json.dumps(payload),
            },
        )
        text1 = out1.decode("utf-8", errors="replace").strip() if out1 else ""
        if ec1 != 0:
            return {
                "slug": sandbox.slug,
                "sandbox_id": sandbox.id,
                "ok": False,
                "skipped": False,
                "detail": text1[-300:] or f"node exit {ec1}",
            }

        ec2, out2 = self.exec_command(
            sandbox,
            ["supervisorctl", "restart", "dsh"],
            user="root",
        )
        text2 = out2.decode("utf-8", errors="replace").strip() if out2 else ""
        return {
            "slug": sandbox.slug,
            "sandbox_id": sandbox.id,
            "ok": ec2 == 0,
            "skipped": False,
            "provider": provider_key,
            "model": profile.model,
            "set_as_default": bool(set_as_default),
            "detail": text2[-300:] if text2 else "synced",
        }
