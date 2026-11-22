from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, Unicode
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .config import DEFAULT_AUTO_INSTALL_PLUGINS
from .db import Base


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    sandboxes: Mapped[list[Sandbox]] = relationship(back_populates="user")


class PlatformAdmin(Base):
    __tablename__ = "platform_admins"

    email: Mapped[str] = mapped_column(Unicode(320), primary_key=True)
    display_name: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


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
    api_key_ciphertext: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @property
    def has_api_key(self) -> bool:
        return bool(self.api_key_ciphertext)


class SandboxTemplate(Base):
    __tablename__ = "sandbox_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(Unicode(128))
    description: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    role_title: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    role_description: Mapped[str | None] = mapped_column(Unicode(600), nullable=True)
    role_sop: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_llm_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    image_repo: Mapped[str] = mapped_column(String(255), default="dsh-sandbox")
    image_tag: Mapped[str] = mapped_column(String(128), default="latest")
    default_cpu_limit: Mapped[float] = mapped_column(Float, default=2.0)
    default_memory_limit: Mapped[str] = mapped_column(String(32), default="4g")
    auto_install_plugins: Mapped[str | None] = mapped_column(
        Unicode(512), default=DEFAULT_AUTO_INSTALL_PLUGINS, nullable=True
    )
    init_script: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_env_json: Mapped[str | None] = mapped_column(Text, default="{}", nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )


class Sandbox(Base):
    __tablename__ = "sandboxes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
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
    role_sop: Mapped[str | None] = mapped_column(Text, nullable=True)
    init_repo_url: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    init_script: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_env_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    auto_install_plugins: Mapped[str | None] = mapped_column(
        Unicode(512), nullable=True
    )
    cpu_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    memory_limit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    auto_sleep_exempt: Mapped[bool] = mapped_column(Boolean, default=False)
    disk_usage_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    disk_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    preview_auth_mode: Mapped[str] = mapped_column(String(32), default="public")
    webhook_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    daily_token_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    project_team_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="creating")
    llm_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("llm_profiles.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates="sandboxes")
    llm_profile: Mapped[LlmProfile | None] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str | None] = mapped_column(String(128), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
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
    client_secret_ciphertext: Mapped[str] = mapped_column(Text, default="")
    scope: Mapped[str] = mapped_column(Unicode(255), default="openid profile email")
    email_claim: Mapped[str] = mapped_column(String(128), default="email")
    logout_url: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    allowed_domains: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    allow_admin_login: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
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
    git_user_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    git_user_email: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    git_host: Mapped[str] = mapped_column(Unicode(255), default="github.com")
    git_token_ciphertext: Mapped[str] = mapped_column(Text, default="")
    ssh_private_key_ciphertext: Mapped[str] = mapped_column(Text, default="")
    env_vars_ciphertext: Mapped[str] = mapped_column(Text, default="")
    mcp_servers_json: Mapped[str | None] = mapped_column(Text, default="{}", nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )

    @property
    def has_git_token(self) -> bool:
        return bool(self.git_token_ciphertext)

    @property
    def has_ssh_key(self) -> bool:
        return bool(self.ssh_private_key_ciphertext)

    @property
    def has_env_vars(self) -> bool:
        return bool(self.env_vars_ciphertext)


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

