from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_AUTO_INSTALL_PLUGINS = "file-manager,workspace-user,custom-theme,sandbox-mesh,sandbox-memory"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:////data/dsh-manager.db"

    dsh_image_repo: str = "dsh-sandbox"
    dsh_image_tag: str = "latest"
    dsh_network: str = "dsh-manager"
    pull_missing_image: bool = False
    dsh_permission_mode: str = "danger-full-access"
    sandbox_memory: str = "4g"
    sandbox_cpus: float = 2.0
    sandbox_timezone: str = "UTC"
    custom_ca_bundle_path: str = ""
    health_timeout_seconds: int = 75
    background_tasks: bool = True
    reconcile_interval_seconds: int = 60
    idle_sleep_enabled: bool = False
    idle_sleep_minutes: int = 240
    restore_max_bytes: int = 512 * 1024 * 1024

    # Authentication modes:
    # - 'token' (default): built-in admin token + local user password + internal multi-OIDC SSO
    # - 'oidc': OIDC-first mode (auto-seeds legacy OIDC_* env vars into DB, defaults local user login off)
    # - 'none': passwordless local dev
    manager_auth_mode: Literal["oidc", "token", "none"] = "token"

    # Optional legacy/bootstrap OIDC settings (one-time seeded into DB on first start if configured).
    # Recommended: manage one or multiple OIDC providers directly in Admin Console -> Auth / SSO.
    oidc_issuer_url: str = ""
    # Optional internal OIDC discovery URL when manager runs inside Docker and
    # OIDC_ISSUER_URL is only resolvable from the host browser.
    oidc_discovery_url: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_scope: str = "openid profile email"
    oidc_email_claim: str = "email"
    # Optional explicit OIDC logout endpoint override (defaults to discovery `end_session_endpoint`).
    oidc_logout_url: str = ""

    manager_admin_email: str = "admin@example.com"
    manager_admin_token: str = ""
    manager_public_url: str = "http://localhost:9000"
    # Internal URL reachable by sandbox containers (defaults to manager_base_url).
    manager_internal_url: str = ""
    secret_key: str = "change-me-in-production"

    # Self-hosted plugin index & registry settings
    plugins_dir: str = ""
    plugin_source_type: Literal["npm", "git"] = "npm"
    plugin_npm_registry: str = ""
    plugin_git_url: str = ""
    plugin_git_commit: str = ""
    plugin_index_title_en: str = ""
    plugin_index_title_zh: str = ""
    plugin_index_author: str = ""
    # Comma-separated plugin slugs or URLs to auto-install into new sandboxes
    sandbox_auto_install_plugins: str = DEFAULT_AUTO_INSTALL_PLUGINS

    @property
    def manager_base_url(self) -> str:
        return (self.manager_public_url or "http://localhost:9000").rstrip("/")

    @property
    def public_host_header(self) -> str:
        parsed = urlsplit(self.manager_base_url)
        return parsed.netloc or "localhost:9000"

    def sandbox_url(self, slug: str) -> str:
        return f"{self.manager_base_url}/s/{slug}/"

    @property
    def sandbox_reachable_manager_url(self) -> str:
        if self.manager_internal_url:
            return self.manager_internal_url.rstrip("/")
        return self.manager_base_url

    @property
    def plugin_index_url(self) -> str:
        return f"{self.manager_base_url}/plugins/index.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
