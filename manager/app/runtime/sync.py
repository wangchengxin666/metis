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
    """Plugin Market, LLM, and Brand Theme HMR hot-sync operations inside running sandboxes."""

    def sync_plugin_market(
        self,
        sandbox: Sandbox,
        reinstall_plugins: list[str] | None = None,
        force_reinstall: bool = False,
        extra_indexes: list[str] | None = None,
    ) -> dict[str, Any]:
        """Ensure Plugin Market config (via HMR) and optionally reinstall built-in plugins."""
        st = self._workload_status(sandbox)
        if st != "running":
            return {"slug": sandbox.slug, "ok": False, "detail": f"status={st}"}

        manager_url = self.settings.sandbox_reachable_manager_url
        index_url = f"{manager_url}/plugins/index.json"
        npm_registry = f"{manager_url}/plugins/npm"
        extra_list = [str(u).strip() for u in (extra_indexes or []) if str(u).strip()]
        registry = PluginRegistryService(self.settings)
        registry_packages = {pkg.name: pkg for pkg in registry.list_packages()}

        explicit_targets: list[str] = []
        for raw_spec in reinstall_plugins or []:
            spec = raw_spec.strip()
            if not spec:
                continue
            pkg = registry.get_by_package_name(spec) or registry.get_by_slug_or_filename(spec)
            explicit_targets.append(pkg.name if pkg else spec)

        ec1, out1 = self.exec_command(
            sandbox,
            ["/usr/local/bin/metis-dsh-config", "sync-market"],
            user="workspace",
            environment={
                "INDEX_URL": index_url,
                "EXTRA_INDEXES": json.dumps(extra_list, ensure_ascii=False),
                "NPM_REGISTRY": npm_registry,
                "HOME": "/home/workspace",
                "DSH_HOME": "/home/workspace/.dsh",
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
                "detail": text[-300:] if text else "reinstalled",
            }

        # market_only: plugin-market.indexes is Volatile and cordis.patch.yml is watched by dsh-hmr
        return {
            "slug": sandbox.slug,
            "ok": True,
            "reinstalled": [],
            "detail": "hmr-synced",
        }

    def sync_llm_profile(
        self,
        sandbox: Sandbox,
        profile: LlmProfile,
        *,
        set_as_default: bool = True,
        replace_managed: bool = False,
    ) -> dict[str, Any]:
        """Hot-push an LLM profile into a running sandbox via HMR (zero restart)."""
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

        ec1, out1 = self.exec_command(
            sandbox,
            ["/usr/local/bin/metis-dsh-config", "sync-llm"],
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
                "detail": text1[-300:] or f"metis-dsh-config exit {ec1}",
            }

        # Both cordis.patch.yml (dsh-hmr) and .credentials.yaml (dsh-credentials-local) auto-reload live
        return {
            "slug": sandbox.slug,
            "sandbox_id": sandbox.id,
            "ok": True,
            "skipped": False,
            "provider": provider_key,
            "model": profile.model,
            "set_as_default": bool(set_as_default),
            "detail": text1[-300:] if text1 else "hmr-synced",
        }

    def sync_brand_theme(
        self,
        sandbox: Sandbox,
        brand_config: dict[str, Any],
    ) -> dict[str, Any]:
        """Hot-push platform brand theme tokens to @metis/custom-theme Volatile config via HMR."""
        st = self._workload_status(sandbox)
        if st != "running":
            return {"slug": sandbox.slug, "ok": False, "skipped": True, "detail": f"status={st}"}

        theme = brand_config.get("brand_theme") if isinstance(brand_config.get("brand_theme"), dict) else {}
        payload = {
            "primary": str(theme.get("primary") or "#6366f1"),
            "accent": str(theme.get("accent") or "#06b6d4"),
            "mode": str(theme.get("mode") or "dark"),
            "brandTitle": str(brand_config.get("brand_name_zh") or brand_config.get("brand_name_en") or "Metis"),
            "brandLogoSvg": str(brand_config.get("brand_logo_svg") or ""),
        }
        ec, out = self.exec_command(
            sandbox,
            ["/usr/local/bin/metis-dsh-config", "sync-theme"],
            user="workspace",
            environment={
                "HOME": "/home/workspace",
                "DSH_HOME": "/home/workspace/.dsh",
                "METIS_BRAND_THEME_JSON": json.dumps(payload, ensure_ascii=False),
            },
        )
        text = out.decode("utf-8", errors="replace").strip() if out else ""
        return {
            "slug": sandbox.slug,
            "ok": ec == 0,
            "skipped": False,
            "detail": text[-200:] if text else "hmr-synced",
        }
