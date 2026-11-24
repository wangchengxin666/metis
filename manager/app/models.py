from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, Unicode
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .config import DEFAULT_AUTO_INSTALL_PLUGINS
from .db import Base


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
    gateway_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    input_price_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    output_price_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    fallback_llm_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
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
    sop_version: Mapped[int] = mapped_column(Integer, default=1)
    default_llm_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    default_credential_profile_ids_json: Mapped[str | None] = mapped_column(
        Text, default="[]", nullable=True
    )
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

    @property
    def default_credential_profile_ids(self) -> list[str]:
        return _parse_id_list(self.default_credential_profile_ids_json)


class Sandbox(Base):
    __tablename__ = "sandboxes"

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
    budget_action: Mapped[str] = mapped_column(String(32), default="block")
    gateway_api_key: Mapped[str | None] = mapped_column(String(128), unique=True, index=True, nullable=True)
    ownership_mode: Mapped[str] = mapped_column(String(32), default="personal")
    maintainer_emails_json: Mapped[str | None] = mapped_column(Text, default="[]", nullable=True)
    project_team_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    credential_profile_ids_json: Mapped[str | None] = mapped_column(
        Text, default="[]", nullable=True
    )
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


class SandboxRuntimeSnapshot(Base):
    __tablename__ = "sandbox_runtime_snapshots"

    sandbox_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sandbox_slug: Mapped[str] = mapped_column(String(64), index=True)
    online: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(32), default="stopped")
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    pending_approvals_count: Mapped[int] = mapped_column(Integer, default=0)
    active_tasks_count: Mapped[int] = mapped_column(Integer, default=0)
    blocked_tasks_count: Mapped[int] = mapped_column(Integer, default=0)
    exposed_apps_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )


class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(Unicode(128), unique=True)
    channel_type: Mapped[str] = mapped_column(String(32), index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    config_ciphertext: Mapped[str] = mapped_column(Text, default="")
    target_hint: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    events_json: Mapped[str] = mapped_column(Text, default="[]")
    scope_sandbox_ids_json: Mapped[str | None] = mapped_column(
        Text, default="[]", nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
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
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


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
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_amount: Mapped[float] = mapped_column(Float, default=0.0)
    routed_mode: Mapped[str] = mapped_column(String(32), default="primary")  # primary|fallback
    status_code: Mapped[int] = mapped_column(Integer, default=200)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


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
    created_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    user_email: Mapped[str] = mapped_column(Unicode(320), index=True)
    role: Mapped[str] = mapped_column(String(32), default="member")  # lead|member
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class TeamSandbox(Base):
    __tablename__ = "team_sandboxes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    sandbox_id: Mapped[str] = mapped_column(String(36), index=True)
    is_moderator: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
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
    input_fields_json: Mapped[str] = mapped_column(Text, default="[]")
    stages_json: Mapped[str] = mapped_column(Text, default="[]")
    deliverables_checklist_json: Mapped[str] = mapped_column(Text, default="[]")
    created_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
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
    inputs_json: Mapped[str] = mapped_column(Text, default="{}")
    uploaded_files_json: Mapped[str] = mapped_column(Text, default="[]")
    role_assignments_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(32), default="running", index=True)
    current_stage_index: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(Unicode(320), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PlaybookStepRun(Base):
    __tablename__ = "playbook_step_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("playbook_runs.id", ondelete="CASCADE"), index=True)
    stage_index: Mapped[int] = mapped_column(Integer, default=0)
    stage_id: Mapped[str] = mapped_column(String(64))
    stage_name: Mapped[str] = mapped_column(Unicode(128))
    role_hint: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    parallel_group: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sandbox_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    sandbox_slug: Mapped[str | None] = mapped_column(String(64), nullable=True)
    room_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    prompt_rendered: Mapped[str | None] = mapped_column(Text, nullable=True)
    approval_required: Mapped[bool] = mapped_column(Boolean, default=False)
    approval_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    approval_note: Mapped[str | None] = mapped_column(Unicode(512), nullable=True)
    approval_decided_by: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    deliverable_hint: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    output_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifacts_json: Mapped[str | None] = mapped_column(Text, default="[]", nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MemoryPromotion(Base):
    __tablename__ = "memory_promotions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_sandbox_id: Mapped[str] = mapped_column(String(36), index=True)
    source_sandbox_slug: Mapped[str] = mapped_column(String(64))
    memory_id: Mapped[str] = mapped_column(String(64))
    memory_title: Mapped[str] = mapped_column(Unicode(255))
    memory_category: Mapped[str] = mapped_column(String(32), default="workflow")
    promoted_content: Mapped[str] = mapped_column(Text)
    target_type: Mapped[str] = mapped_column(String(32), default="template_sop")  # template_sop|team_shared_doc
    target_template_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    target_template_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    target_team_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    target_team_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    target_file_name: Mapped[str | None] = mapped_column(Unicode(128), nullable=True)
    sop_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rollout_sandbox_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    rollout_synced_count: Mapped[int] = mapped_column(Integer, default=0)
    promoted_by: Mapped[str] = mapped_column(Unicode(320), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


