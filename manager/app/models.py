from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Unicode,
    UnicodeText,
    text,
)
from sqlalchemy.dialects import mssql as mssql_dialect
from sqlalchemy.dialects import mysql as mysql_dialect
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .config import DEFAULT_AUTO_INSTALL_PLUGINS
from .db import Base

LONG_TEXT = (
    UnicodeText()
    .with_variant(mssql_dialect.NVARCHAR(length=None), "mssql")
    .with_variant(mysql_dialect.LONGTEXT(), "mysql")
)
PORTABLE_DATETIME = DateTime().with_variant(mssql_dialect.DATETIME2(), "mssql")


def _parse_id_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            seen: set[str] = set()
            result: list[str] = []
            for item in parsed:
                val = str(item or "").strip()
                if val and val not in seen:
                    seen.add(val)
                    result.append(val)
            return result
    except Exception:
        pass
    return []


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(Unicode(320), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(32), default="user")
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)

    sandboxes: Mapped[list[Sandbox]] = relationship(back_populates="user")


class PlatformAdmin(Base):
    __tablename__ = "platform_admins"

    email: Mapped[str] = mapped_column(Unicode(320), primary_key=True)
    display_name: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)


class LlmProfile(Base):
    __tablename__ = "llm_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(Unicode(128))
    base_url: Mapped[str] = mapped_column(Unicode(512))
    model: Mapped[str] = mapped_column(Unicode(128))
    api_protocol: Mapped[str] = mapped_column(String(64), default="openai-completions")
    context_window: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    supports_image: Mapped[bool] = mapped_column(Boolean, default=False)
    reasoning_effort: Mapped[str | None] = mapped_column(String(32), nullable=True)
    thinking_format: Mapped[str | None] = mapped_column(String(64), nullable=True)
    api_key_ciphertext: Mapped[str] = mapped_column(LONG_TEXT, default="")
    gateway_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    input_price_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    output_price_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    cache_read_price_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    cache_creation_price_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    key_pool_json: Mapped[str] = mapped_column(LONG_TEXT, default="[]")
    tpm_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dlp_mode: Mapped[str] = mapped_column(String(32), default="off")  # off|redact|block
    fallback_llm_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    circuit_breaker_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)

    @property
    def has_api_key(self) -> bool:
        return bool(self.api_key_ciphertext)

    @property
    def key_pool(self) -> list[dict[str, Any]]:
        try:
            items = json.loads(getattr(self, "key_pool_json", None) or "[]")
            if not isinstance(items, list):
                return []
            out = []
            for idx, item in enumerate(items):
                if isinstance(item, dict):
                    out.append(
                        {
                            "id": str(item.get("id") or f"k{idx + 1}"),
                            "label": str(item.get("label") or f"key-{idx + 1}"),
                            "base_url": str(item.get("base_url") or "") or None,
                            "has_api_key": bool(item.get("api_key_ciphertext")),
                            "weight": max(1, int(item.get("weight") or 1)),
                            "enabled": bool(item.get("enabled", True)),
                        }
                    )
            return out
        except Exception:
            return []


class SandboxTemplate(Base):
    __tablename__ = "sandbox_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(Unicode(128))
    description: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    role_title: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    role_description: Mapped[str | None] = mapped_column(Unicode(600), nullable=True)
    role_sop: Mapped[str | None] = mapped_column(LONG_TEXT, nullable=True)
    sop_version: Mapped[int] = mapped_column(Integer, default=1)
    default_llm_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    default_credential_profile_ids_json: Mapped[str | None] = mapped_column(
        LONG_TEXT, default="[]", nullable=True
    )
    default_mcp_server_ids_json: Mapped[str | None] = mapped_column(
        LONG_TEXT, default="[]", nullable=True
    )
    default_skill_ids_json: Mapped[str | None] = mapped_column(
        LONG_TEXT, default="[]", nullable=True
    )
    image_repo: Mapped[str] = mapped_column(String(255), default="dsh-sandbox")
    image_tag: Mapped[str] = mapped_column(String(128), default="latest")
    default_cpu_limit: Mapped[float] = mapped_column(Float, default=2.0)
    default_memory_limit: Mapped[str] = mapped_column(String(32), default="4g")
    auto_install_plugins: Mapped[str | None] = mapped_column(
        Unicode(512), default=DEFAULT_AUTO_INSTALL_PLUGINS, nullable=True
    )
    init_script: Mapped[str | None] = mapped_column(LONG_TEXT, nullable=True)
    default_env_json: Mapped[str | None] = mapped_column(LONG_TEXT, default="{}", nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )

    @property
    def default_credential_profile_ids(self) -> list[str]:
        return _parse_id_list(self.default_credential_profile_ids_json)

    @property
    def default_mcp_server_ids(self) -> list[str]:
        return _parse_id_list(self.default_mcp_server_ids_json)

    @property
    def default_skill_ids(self) -> list[str]:
        return _parse_id_list(self.default_skill_ids_json)


class Sandbox(Base):
    __tablename__ = "sandboxes"
    __table_args__ = (
        Index(
            "ix_sandboxes_gateway_api_key",
            "gateway_api_key",
            unique=True,
            sqlite_where=text("gateway_api_key IS NOT NULL"),
            postgresql_where=text("gateway_api_key IS NOT NULL"),
            mssql_where=text("gateway_api_key IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    container_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    volume_name: Mapped[str] = mapped_column(String(128))
    image_repo: Mapped[str | None] = mapped_column(
        String(255), default="dsh-sandbox", nullable=True
    )
    image_tag: Mapped[str] = mapped_column(String(128))
    template: Mapped[str | None] = mapped_column(
        String(64), default="agent-os", nullable=True
    )
    role_title: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    role_description: Mapped[str | None] = mapped_column(Unicode(600), nullable=True)
    role_sop: Mapped[str | None] = mapped_column(LONG_TEXT, nullable=True)
    init_repo_url: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    init_script: Mapped[str | None] = mapped_column(LONG_TEXT, nullable=True)
    extra_env_json: Mapped[str | None] = mapped_column(LONG_TEXT, nullable=True)
    auto_install_plugins: Mapped[str | None] = mapped_column(
        Unicode(512), nullable=True
    )
    cpu_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    memory_limit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    auto_sleep_exempt: Mapped[bool] = mapped_column(Boolean, default=False)
    disk_usage_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    disk_updated_at: Mapped[datetime | None] = mapped_column(PORTABLE_DATETIME, nullable=True)
    preview_auth_mode: Mapped[str] = mapped_column(String(32), default="public")
    webhook_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    daily_token_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    daily_cost_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    monthly_cost_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    rpm_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tpm_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_concurrent_requests: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dlp_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    budget_action: Mapped[str] = mapped_column(String(32), default="block")
    gateway_api_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ownership_mode: Mapped[str] = mapped_column(String(32), default="personal")
    maintainer_emails_json: Mapped[str | None] = mapped_column(LONG_TEXT, default="[]", nullable=True)
    project_team_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    credential_profile_ids_json: Mapped[str | None] = mapped_column(
        LONG_TEXT, default="[]", nullable=True
    )
    mcp_server_ids_json: Mapped[str | None] = mapped_column(
        LONG_TEXT, default="[]", nullable=True
    )
    skill_ids_json: Mapped[str | None] = mapped_column(
        LONG_TEXT, default="[]", nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), default="creating")
    llm_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("llm_profiles.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow, onupdate=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(PORTABLE_DATETIME, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(PORTABLE_DATETIME, nullable=True)

    user: Mapped[User] = relationship(back_populates="sandboxes")
    llm_profile: Mapped[LlmProfile | None] = relationship()

    @property
    def effective_display_name(self) -> str | None:
        if self.display_name:
            return self.display_name
        if self.user and self.user.display_name:
            return self.user.display_name
        return None

    @property
    def credential_profile_ids(self) -> list[str]:
        return _parse_id_list(self.credential_profile_ids_json)

    @property
    def mcp_server_ids(self) -> list[str]:
        return _parse_id_list(self.mcp_server_ids_json)

    @property
    def skill_ids(self) -> list[str]:
        return _parse_id_list(self.skill_ids_json)

    @property
    def maintainer_emails(self) -> list[str]:
        return [e.lower() for e in _parse_id_list(self.maintainer_emails_json)]


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    action: Mapped[str] = mapped_column(String(64))
    category: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    sandbox_slug: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    target: Mapped[str | None] = mapped_column(String(128), nullable=True)
    detail: Mapped[str | None] = mapped_column(LONG_TEXT, nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(LONG_TEXT)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )


class OidcProvider(Base):
    __tablename__ = "oidc_providers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(Unicode(128))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    issuer_url: Mapped[str] = mapped_column(Unicode(512), default="")
    discovery_url: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    client_id: Mapped[str] = mapped_column(Unicode(255))
    client_secret_ciphertext: Mapped[str] = mapped_column(LONG_TEXT, default="")
    scope: Mapped[str] = mapped_column(Unicode(255), default="openid profile email")
    email_claim: Mapped[str] = mapped_column(String(128), default="email")
    logout_url: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    allowed_domains: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    allow_admin_login: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )

    @property
    def has_client_secret(self) -> bool:
        return bool(self.client_secret_ciphertext)

    @property
    def effective_discovery_url(self) -> str:
        if self.discovery_url and self.discovery_url.strip():
            return self.discovery_url.strip()
        issuer = (self.issuer_url or "").strip().rstrip("/")
        if issuer:
            return f"{issuer}/.well-known/openid-configuration"
        return ""


class CredentialProfile(Base):
    __tablename__ = "credential_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(Unicode(128), unique=True)
    preset_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category: Mapped[str] = mapped_column(String(32), default="custom")
    description: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    git_user_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    git_user_email: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    git_host: Mapped[str] = mapped_column(Unicode(255), default="github.com")
    github_auth_mode: Mapped[str] = mapped_column(String(32), default="pat")
    github_api_base_url: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    github_app_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    github_app_installation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    github_tls_verify: Mapped[bool] = mapped_column(Boolean, default=True)
    git_token_ciphertext: Mapped[str] = mapped_column(LONG_TEXT, default="")
    ssh_private_key_ciphertext: Mapped[str] = mapped_column(LONG_TEXT, default="")
    github_app_private_key_ciphertext: Mapped[str] = mapped_column(LONG_TEXT, default="")
    github_app_cached_token_ciphertext: Mapped[str] = mapped_column(LONG_TEXT, default="")
    github_app_token_expires_at: Mapped[datetime | None] = mapped_column(PORTABLE_DATETIME, nullable=True)
    env_vars_ciphertext: Mapped[str] = mapped_column(LONG_TEXT, default="")
    mcp_servers_json: Mapped[str | None] = mapped_column(LONG_TEXT, default="{}", nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )

    @property
    def has_git_token(self) -> bool:
        return bool(self.git_token_ciphertext)

    @property
    def has_ssh_key(self) -> bool:
        return bool(self.ssh_private_key_ciphertext)

    @property
    def has_github_app_private_key(self) -> bool:
        return bool(self.github_app_private_key_ciphertext)

    @property
    def has_github_app_cached_token(self) -> bool:
        return bool(self.github_app_cached_token_ciphertext)

    @property
    def has_env_vars(self) -> bool:
        return bool(self.env_vars_ciphertext)

    @property
    def env_var_keys(self) -> list[str]:
        if not self.env_vars_ciphertext:
            return []
        try:
            from .security import decrypt_secret

            parsed = json.loads(decrypt_secret(self.env_vars_ciphertext))
            if isinstance(parsed, dict):
                return sorted(str(k) for k in parsed.keys() if str(k).strip())
        except Exception:
            pass
        return []


class McpServer(Base):
    __tablename__ = "mcp_servers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(Unicode(128))
    description: Mapped[str | None] = mapped_column(Unicode(600), nullable=True)
    category: Mapped[str] = mapped_column(String(32), default="custom")
    transport: Mapped[str] = mapped_column(String(32), default="stdio")  # stdio|streamable-http
    command: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    args_json: Mapped[str] = mapped_column(LONG_TEXT, default="[]")
    env_json: Mapped[str] = mapped_column(LONG_TEXT, default="{}")
    cwd: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    url: Mapped[str | None] = mapped_column(Unicode(1024), nullable=True)
    headers_json: Mapped[str] = mapped_column(LONG_TEXT, default="{}")
    tool_loading: Mapped[str] = mapped_column(String(32), default="eager")  # eager|on-demand
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    required_credentials_json: Mapped[str] = mapped_column(LONG_TEXT, default="[]")
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )

    @property
    def args(self) -> list[str]:
        try:
            parsed = json.loads(self.args_json or "[]")
            return [str(x) for x in parsed] if isinstance(parsed, list) else []
        except Exception:
            return []

    @property
    def env(self) -> dict[str, str]:
        try:
            parsed = json.loads(self.env_json or "{}")
            return {str(k): str(v) for k, v in parsed.items()} if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    @property
    def headers(self) -> dict[str, str]:
        try:
            parsed = json.loads(self.headers_json or "{}")
            return {str(k): str(v) for k, v in parsed.items()} if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    @property
    def required_credentials(self) -> list[str]:
        return _parse_id_list(self.required_credentials_json)


class SkillItem(Base):
    __tablename__ = "skills"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(Unicode(128))
    description: Mapped[str] = mapped_column(Unicode(600))
    when_to_use: Mapped[str | None] = mapped_column(Unicode(600), nullable=True)
    category: Mapped[str] = mapped_column(String(32), default="custom")
    content: Mapped[str] = mapped_column(LONG_TEXT, default="")
    extra_files_json: Mapped[str] = mapped_column(LONG_TEXT, default="{}")
    disable_model_invocation: Mapped[bool] = mapped_column(Boolean, default=False)
    user_invocable: Mapped[bool] = mapped_column(Boolean, default=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )

    @property
    def extra_files(self) -> dict[str, str]:
        try:
            parsed = json.loads(self.extra_files_json or "{}")
            return {str(k): str(v) for k, v in parsed.items()} if isinstance(parsed, dict) else {}
        except Exception:
            return {}


class WorkspaceSnapshot(Base):
    __tablename__ = "workspace_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    sandbox_id: Mapped[str] = mapped_column(String(36), index=True)
    sandbox_slug: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(Unicode(128))
    note: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    file_path: Mapped[str] = mapped_column(Unicode(512))
    size_mb: Mapped[float] = mapped_column(Float, default=0.0)
    created_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)


class SandboxRuntimeSnapshot(Base):
    __tablename__ = "sandbox_runtime_snapshots"

    sandbox_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sandbox_slug: Mapped[str] = mapped_column(String(64), index=True)
    online: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(32), default="stopped")
    payload_json: Mapped[str] = mapped_column(LONG_TEXT, default="{}")
    pending_approvals_count: Mapped[int] = mapped_column(Integer, default=0)
    active_tasks_count: Mapped[int] = mapped_column(Integer, default=0)
    blocked_tasks_count: Mapped[int] = mapped_column(Integer, default=0)
    exposed_apps_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )


class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(Unicode(128), unique=True)
    channel_type: Mapped[str] = mapped_column(String(32), index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    config_ciphertext: Mapped[str] = mapped_column(LONG_TEXT, default="")
    target_hint: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    events_json: Mapped[str] = mapped_column(LONG_TEXT, default="[]")
    scope_sandbox_ids_json: Mapped[str | None] = mapped_column(
        LONG_TEXT, default="[]", nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )

    @property
    def events(self) -> list[str]:
        return _parse_id_list(self.events_json)

    @property
    def scope_sandbox_ids(self) -> list[str]:
        return _parse_id_list(self.scope_sandbox_ids_json)


class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    channel_id: Mapped[str] = mapped_column(String(36), index=True)
    channel_name: Mapped[str] = mapped_column(Unicode(128))
    channel_type: Mapped[str] = mapped_column(String(32))
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(191), index=True, nullable=True)
    sandbox_slug: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(Unicode(255))
    status: Mapped[str] = mapped_column(String(32), default="sent")
    response_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_detail: Mapped[str | None] = mapped_column(LONG_TEXT, nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow, index=True)


class LlmUsageLedger(Base):
    __tablename__ = "llm_usage_ledger"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    sandbox_id: Mapped[str] = mapped_column(String(36), index=True)
    sandbox_slug: Mapped[str] = mapped_column(String(64), index=True)
    team_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    llm_profile_id: Mapped[str] = mapped_column(String(36), index=True)
    model: Mapped[str] = mapped_column(Unicode(128))
    api_protocol: Mapped[str] = mapped_column(String(64), default="openai-completions")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_creation_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_amount: Mapped[float] = mapped_column(Float, default=0.0)
    routed_mode: Mapped[str] = mapped_column(String(32), default="primary")  # primary|fallback
    status_code: Mapped[int] = mapped_column(Integer, default=200)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    playbook_run_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    playbook_step_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    mesh_task_id: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    upstream_key_label: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    dlp_redacted_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow, index=True)


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(Unicode(128), unique=True)
    description: Mapped[str | None] = mapped_column(Unicode(600), nullable=True)
    department: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)  # active|archived
    mesh_room_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    daily_token_budget: Mapped[int | None] = mapped_column(Integer, nullable=True)
    daily_cost_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    user_email: Mapped[str] = mapped_column(Unicode(320), index=True)
    role: Mapped[str] = mapped_column(String(32), default="member")  # lead|member
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)


class TeamSandbox(Base):
    __tablename__ = "team_sandboxes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    sandbox_id: Mapped[str] = mapped_column(String(36), index=True)
    is_moderator: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)


class ProvisionRequest(Base):
    __tablename__ = "provision_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    requester_email: Mapped[str] = mapped_column(Unicode(320), index=True)
    team_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    template_key: Mapped[str] = mapped_column(String(64))
    ownership_mode: Mapped[str] = mapped_column(String(32), default="personal")
    desired_slug: Mapped[str | None] = mapped_column(String(64), nullable=True)
    role_title: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    reason: Mapped[str | None] = mapped_column(Unicode(600), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)  # pending|approved|rejected
    reviewed_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    provisioned_sandbox_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )


class Playbook(Base):
    __tablename__ = "playbooks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(Unicode(128))
    category: Mapped[str] = mapped_column(String(32), default="engineering")
    description: Mapped[str | None] = mapped_column(Unicode(600), nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    estimated_manual_hours: Mapped[float] = mapped_column(Float, default=4.0)
    input_fields_json: Mapped[str] = mapped_column(LONG_TEXT, default="[]")
    stages_json: Mapped[str] = mapped_column(LONG_TEXT, default="[]")
    deliverables_checklist_json: Mapped[str] = mapped_column(LONG_TEXT, default="[]")
    schedule_cron: Mapped[str | None] = mapped_column(String(128), nullable=True)
    schedule_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    schedule_timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    schedule_inputs_json: Mapped[str] = mapped_column(LONG_TEXT, default="{}")
    last_scheduled_at: Mapped[datetime | None] = mapped_column(PORTABLE_DATETIME, nullable=True)
    webhook_secret_ciphertext: Mapped[str] = mapped_column(LONG_TEXT, default="")
    created_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )

    @property
    def input_fields(self) -> list[dict]:
        try:
            data = json.loads(self.input_fields_json or "[]")
            return data if isinstance(data, list) else []
        except Exception:
            return []

    @property
    def stages(self) -> list[dict]:
        try:
            data = json.loads(self.stages_json or "[]")
            return data if isinstance(data, list) else []
        except Exception:
            return []

    @property
    def deliverables_checklist(self) -> list[str]:
        try:
            data = json.loads(self.deliverables_checklist_json or "[]")
            return [str(x) for x in data if str(x).strip()] if isinstance(data, list) else []
        except Exception:
            return []


class PlaybookRun(Base):
    __tablename__ = "playbook_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    playbook_id: Mapped[str] = mapped_column(ForeignKey("playbooks.id", ondelete="CASCADE"), index=True)
    playbook_key: Mapped[str] = mapped_column(String(64), index=True)
    playbook_name: Mapped[str] = mapped_column(Unicode(128))
    team_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    execution_mode: Mapped[str] = mapped_column(String(32), default="isolated")  # project_group|isolated
    title: Mapped[str] = mapped_column(Unicode(255))
    inputs_json: Mapped[str] = mapped_column(LONG_TEXT, default="{}")
    uploaded_files_json: Mapped[str] = mapped_column(LONG_TEXT, default="[]")
    role_assignments_json: Mapped[str] = mapped_column(LONG_TEXT, default="{}")
    status: Mapped[str] = mapped_column(String(32), default="running", index=True)
    current_stage_index: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(Unicode(320), index=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )
    completed_at: Mapped[datetime | None] = mapped_column(PORTABLE_DATETIME, nullable=True)


class PlaybookStepRun(Base):
    __tablename__ = "playbook_step_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("playbook_runs.id", ondelete="CASCADE"), index=True)
    stage_index: Mapped[int] = mapped_column(Integer, default=0)
    stage_id: Mapped[str] = mapped_column(String(64))
    stage_name: Mapped[str] = mapped_column(Unicode(128))
    role_hint: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    parallel_group: Mapped[str | None] = mapped_column(String(64), nullable=True)
    depends_on_json: Mapped[str | None] = mapped_column(LONG_TEXT, default="[]", nullable=True)
    timeout_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_retries: Mapped[int] = mapped_column(Integer, default=0)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    sla_warned_at: Mapped[datetime | None] = mapped_column(PORTABLE_DATETIME, nullable=True)
    on_reject_goto: Mapped[str | None] = mapped_column(String(64), nullable=True)
    skip_if: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    sandbox_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    sandbox_slug: Mapped[str | None] = mapped_column(String(64), nullable=True)
    room_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    prompt_rendered: Mapped[str | None] = mapped_column(LONG_TEXT, nullable=True)
    approval_required: Mapped[bool] = mapped_column(Boolean, default=False)
    approval_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    approval_note: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    approval_decided_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    deliverable_hint: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    output_summary: Mapped[str | None] = mapped_column(LONG_TEXT, nullable=True)
    artifacts_json: Mapped[str | None] = mapped_column(LONG_TEXT, default="[]", nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(PORTABLE_DATETIME, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(PORTABLE_DATETIME, nullable=True)

    @property
    def depends_on(self) -> list[str]:
        try:
            data = json.loads(self.depends_on_json or "[]")
            if isinstance(data, list):
                return [str(x).strip() for x in data if str(x).strip()]
        except Exception:
            pass
        return []


class MemoryPromotion(Base):
    __tablename__ = "memory_promotions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_sandbox_id: Mapped[str] = mapped_column(String(36), index=True)
    source_sandbox_slug: Mapped[str] = mapped_column(String(64))
    memory_id: Mapped[str] = mapped_column(String(64))
    memory_title: Mapped[str] = mapped_column(Unicode(255))
    memory_category: Mapped[str] = mapped_column(String(32), default="workflow")
    promoted_content: Mapped[str] = mapped_column(LONG_TEXT)
    target_type: Mapped[str] = mapped_column(String(32), default="template_sop")  # template_sop|team_shared_doc
    target_template_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    target_template_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    target_team_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    target_team_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    target_file_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    sop_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rollout_sandbox_ids_json: Mapped[str] = mapped_column(LONG_TEXT, default="[]")
    rollout_synced_count: Mapped[int] = mapped_column(Integer, default=0)
    promoted_by: Mapped[str] = mapped_column(Unicode(320), index=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow, index=True)


class PlaybookArtifact(Base):
    """Persistent DB-backed artifact store enabling cross-sandbox relay across distributed Manager replicas."""

    __tablename__ = "playbook_artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("playbook_runs.id", ondelete="CASCADE"), index=True)
    step_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    stage_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_sandbox_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_sandbox_slug: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_path: Mapped[str] = mapped_column(Unicode(512))
    file_name: Mapped[str] = mapped_column(Unicode(255))
    content_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64), default="")
    content_b64: Mapped[str] = mapped_column(LONG_TEXT, default="")
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow, index=True)


class ToolPolicyRule(Base):
    """Tool/command-level governance rule requiring HITL approval or blocking dangerous actions."""

    __tablename__ = "tool_policy_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(Unicode(128), unique=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    tool_pattern: Mapped[str] = mapped_column(String(255))
    arg_regex: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    action: Mapped[str] = mapped_column(String(32), default="require_approval")  # require_approval|block|audit
    scope_sandbox_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    description: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    created_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )


class ToolApprovalRequest(Base):
    """Pending/decided human-in-the-loop authorization request for high-risk tool calls."""

    __tablename__ = "tool_approval_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    sandbox_id: Mapped[str] = mapped_column(String(36), index=True)
    sandbox_slug: Mapped[str] = mapped_column(String(64), index=True)
    rule_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    rule_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    playbook_run_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    playbook_step_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    tool_name: Mapped[str] = mapped_column(String(128), index=True)
    tool_args_summary: Mapped[str] = mapped_column(LONG_TEXT, default="")
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)  # pending|approved|rejected|expired
    decided_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(PORTABLE_DATETIME, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(PORTABLE_DATETIME, nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow, index=True)


class MemoryKnowledgeEntry(Base):
    """Indexed organizational knowledge entries powering portable Top-K BM25/TF-IDF recall."""

    __tablename__ = "memory_knowledge_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_type: Mapped[str] = mapped_column(String(32), default="promotion")  # promotion|template_sop|team_doc|manual
    source_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    template_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    team_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    title: Mapped[str] = mapped_column(Unicode(255))
    category: Mapped[str] = mapped_column(String(64), default="workflow", index=True)
    tags_csv: Mapped[str] = mapped_column(Unicode(512), default="")
    content: Mapped[str] = mapped_column(LONG_TEXT, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )


class ClusterLease(Base):
    """Database fallback lease table for multi-replica leader election & locking when Redis is absent."""

    __tablename__ = "cluster_leases"

    lease_name: Mapped[str] = mapped_column(String(128), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[datetime] = mapped_column(PORTABLE_DATETIME, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        PORTABLE_DATETIME, default=utcnow, onupdate=utcnow
    )


