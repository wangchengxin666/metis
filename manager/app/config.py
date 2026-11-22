from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_AUTO_INSTALL_PLUGINS = "file-manager,workspace-user,custom-theme,sandbox-mesh,sandbox-memory,work-delivery"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:////data/dsh-manager.db"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout: int = 30
    db_pool_recycle: int = 1800

    # Sandbox runtime backend: 'docker' (local sock or remote TCP/SSH) or 'kubernetes'
    sandbox_runtime: Literal["docker", "kubernetes"] = "docker"

    # Optional remote Docker daemon & TLS configuration (defaults to docker.from_env())
    docker_host: str = ""
    docker_tls_verify: bool = False
    docker_tls_ca_cert: str = ""
    docker_tls_client_cert: str = ""
    docker_tls_client_key: str = ""
    # When set (e.g. '10.0.0.20'), publishes container :8080 to an ephemeral host port
    # on the remote Docker host and routes health checks + Traefik to http://<docker_public_host>:<port>.
    docker_public_host: str = ""
    docker_host_port_bind_ip: str = "0.0.0.0"

    # Kubernetes runtime settings (used when sandbox_runtime='kubernetes')
    k8s_namespace: str = "dsh-sandboxes"
    k8s_in_cluster: bool = True
    k8s_kubeconfig_path: str = ""
    k8s_context: str = ""
    k8s_storage_class: str = ""
    k8s_workspace_storage_size: str = "20Gi"
    k8s_image_pull_secret: str = ""
    k8s_image_pull_policy: Literal["IfNotPresent", "Always", "Never"] = "IfNotPresent"
    k8s_service_domain: str = "cluster.local"
    k8s_service_type: Literal["ClusterIP", "NodePort"] = "ClusterIP"
    # Optional K8s node IP/host (e.g. '127.0.0.1' or 'host.docker.internal') when dsh-manager
    # runs outside the K8s cluster and reaches sandbox pods via NodePort.
    k8s_public_host: str = ""
    k8s_routing_mode: Literal["traefik-http", "traefik-crd", "none"] = "traefik-http"
    k8s_traefik_entrypoint: str = "web"

    # Traefik dynamic HTTP provider settings (/api/internal/traefik/config)
    traefik_provider_token: str = ""
    traefik_entrypoint: str = "web"

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
    snapshots_dir: str = ""

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
    # Optional internal Traefik gateway URL reachable by sandbox containers for sandbox-mesh (/s/<slug>/p/4090).
    gateway_internal_url: str = ""
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

    @property
    def data_dir(self) -> Path:
        if self.snapshots_dir.strip():
            return Path(self.snapshots_dir.strip())
        url = (self.database_url or "").strip()
        if url.startswith("sqlite:///"):
            raw_path = url[len("sqlite:///") :]
            if raw_path and raw_path != ":memory:":
                return Path(raw_path).resolve().parent
        return Path("/data")


@lru_cache
def get_settings() -> Settings:
    return Settings()
