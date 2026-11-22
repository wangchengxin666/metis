from __future__ import annotations

import re
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from .config import DEFAULT_AUTO_INSTALL_PLUGINS

_MEMORY_RE = re.compile(r"^[1-9][0-9]*(\.[0-9]+)?[kmg]$", re.IGNORECASE)


def _normalize_memory(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip().lower()
    if not _MEMORY_RE.fullmatch(value):
        raise ValueError("memory_limit must look like 512m, 4g, or 16g")
    return value


def _normalize_password(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if len(cleaned) < 6 or len(cleaned) > 128:
        raise ValueError("password length must be between 6 and 128 characters")
    return cleaned


class UserCreate(BaseModel):
    email: EmailStr
    display_name: str | None = None
    role: Literal["user", "admin"] = "user"
    password: str | None = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str | None) -> str | None:
        return _normalize_password(value)


class UserUpdate(BaseModel):
    display_name: str | None = None
    status: Literal["active", "disabled"] | None = None
    password: str | None = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str | None) -> str | None:
        return _normalize_password(value)


class UserPasswordChange(BaseModel):
    current_password: str | None = None
    new_password: str = Field(min_length=6, max_length=128)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    display_name: str | None
    role: str
    status: str
    has_password: bool = False
    sandbox_count: int = 0
    created_at: datetime | None = None


class AdminCreate(BaseModel):
    email: EmailStr
    display_name: str | None = None


class AdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    email: str
    display_name: str | None
    active: bool
    created_at: datetime


class TemplateCreate(BaseModel):
    key: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,62}$")
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    role_title: str | None = Field(default=None, max_length=128)
    role_description: str | None = Field(default=None, max_length=600)
    role_sop: str | None = Field(default=None, max_length=2000)
    default_llm_profile_id: str | None = None
    image_repo: str = "dsh-sandbox"
    image_tag: str = "latest"
    default_cpu_limit: float = Field(default=2.0, gt=0, le=64)
    default_memory_limit: str = "4g"
    auto_install_plugins: str | None = DEFAULT_AUTO_INSTALL_PLUGINS
    init_script: str | None = None
    default_env_json: str | None = "{}"

    @field_validator("default_memory_limit")
    @classmethod
    def validate_memory(cls, value: str) -> str:
        return _normalize_memory(value) or "4g"


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    role_title: str | None = Field(default=None, max_length=128)
    role_description: str | None = Field(default=None, max_length=600)
    role_sop: str | None = Field(default=None, max_length=2000)
    default_llm_profile_id: str | None = None
    image_repo: str | None = None
    image_tag: str | None = None
    default_cpu_limit: float | None = Field(default=None, gt=0, le=64)
    default_memory_limit: str | None = None
    auto_install_plugins: str | None = None
    init_script: str | None = None
    default_env_json: str | None = None

    @field_validator("default_memory_limit")
    @classmethod
    def validate_memory(cls, value: str | None) -> str | None:
        return _normalize_memory(value)


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    name: str
    description: str | None
    role_title: str | None = None
    role_description: str | None = None
    role_sop: str | None = None
    default_llm_profile_id: str | None = None
    image_repo: str
    image_tag: str
    default_cpu_limit: float
    default_memory_limit: str
    auto_install_plugins: str | None
    init_script: str | None
    default_env_json: str | None
    is_builtin: bool
    created_at: datetime
    updated_at: datetime


class SandboxCreate(BaseModel):
    email: EmailStr
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9-]{1,62}$")
    display_name: str | None = None
    initial_password: str | None = None
    image_repo: str | None = None
    image_tag: str | None = None
    template: str = "agent-os"
    role_title: str | None = Field(default=None, max_length=128)
    role_description: str | None = Field(default=None, max_length=600)
    role_sop: str | None = Field(default=None, max_length=2000)
    init_repo_url: str | None = None
    init_script: str | None = None
    auto_install_plugins: str | None = None
    llm_profile_id: str | None = None
    cpu_limit: float | None = Field(default=None, gt=0, le=64)
    memory_limit: str | None = None
    auto_sleep_exempt: bool = False
    preview_auth_mode: Literal["public", "authenticated"] = "public"
    daily_token_limit: int | None = Field(default=None, ge=1000, le=1_000_000_000)

    @field_validator("initial_password")
    @classmethod
    def validate_initial_password(cls, value: str | None) -> str | None:
        return _normalize_password(value)

    @field_validator("memory_limit")
    @classmethod
    def validate_memory(cls, value: str | None) -> str | None:
        return _normalize_memory(value)


class SandboxPatch(BaseModel):
    image_repo: str | None = None
    image_tag: str | None = None
    llm_profile_id: str | None = None
    cpu_limit: float | None = Field(default=None, gt=0, le=64)
    memory_limit: str | None = None
    auto_sleep_exempt: bool | None = None
    role_title: str | None = Field(default=None, max_length=128)
    role_description: str | None = Field(default=None, max_length=600)
    role_sop: str | None = Field(default=None, max_length=2000)
    preview_auth_mode: Literal["public", "authenticated"] | None = None
    daily_token_limit: int | None = Field(default=None, ge=0, le=1_000_000_000)
    rotate_webhook_token: bool = False

    @field_validator("memory_limit")
    @classmethod
    def validate_memory(cls, value: str | None) -> str | None:
        return _normalize_memory(value)


class SandboxOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    display_name: str | None = None
    slug: str
    container_id: str | None
    volume_name: str
    image_repo: str | None = "dsh-sandbox"
    image_tag: str
    template: str | None = "agent-os"
    role_title: str | None = None
    role_description: str | None = None
    role_sop: str | None = None
    init_repo_url: str | None = None
    auto_install_plugins: str | None = None
    llm_profile_id: str | None = None
    llm_profile_name: str | None = None
    cpu_limit: float | None
    memory_limit: str | None
    auto_sleep_exempt: bool = False
    disk_usage_mb: float | None = None
    disk_updated_at: datetime | None = None
    preview_auth_mode: str = "public"
    has_webhook_token: bool = False
    webhook_url: str | None = None
    daily_token_limit: int | None = None
    project_team_name: str | None = None
    status: str
    url: str
    created_at: datetime
    last_seen_at: datetime | None
    deleted_at: datetime | None


class PluginSyncRequest(BaseModel):
    mode: Literal["market_only", "reinstall_builtin", "reinstall_selected"] = "market_only"
    plugins: list[str] = Field(default_factory=list)
    sandbox_ids: list[str] | None = None


class IdleSleepPolicyOut(BaseModel):
    enabled: bool = False
    idle_minutes: int = Field(default=240, ge=5, le=43200)


class IdleSleepPolicyUpdate(BaseModel):
    enabled: bool
    idle_minutes: int = Field(default=240, ge=5, le=43200)


class SandboxList(BaseModel):
    items: list[SandboxOut]


class HealthOut(BaseModel):
    status: str
    database: str
    docker: str


LLM_API_PROTOCOLS = Literal[
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
]
LLM_REASONING_EFFORTS = Literal[
    "",
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
]
LLM_THINKING_FORMATS = Literal[
    "",
    "openai",
    "deepseek",
    "openrouter",
    "together",
    "baseten",
    "zai",
    "qwen",
    "chat-template",
    "qwen-chat-template",
    "string-thinking",
    "ant-ling",
]


class LlmProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    base_url: str = Field(min_length=1, max_length=512)
    model: str = Field(min_length=1, max_length=128)
    api_key: str = ""
    api_protocol: LLM_API_PROTOCOLS = "openai-completions"
    context_window: int | None = Field(default=None, ge=1024, le=10_000_000)
    max_tokens: int | None = Field(default=None, ge=128, le=1_000_000)
    supports_image: bool = False
    reasoning_effort: LLM_REASONING_EFFORTS | None = None
    thinking_format: LLM_THINKING_FORMATS | None = None


class LlmProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    base_url: str | None = Field(default=None, min_length=1, max_length=512)
    model: str | None = Field(default=None, min_length=1, max_length=128)
    api_key: str | None = None
    clear_api_key: bool = False
    api_protocol: LLM_API_PROTOCOLS | None = None
    context_window: int | None = Field(default=None, ge=1024, le=10_000_000)
    max_tokens: int | None = Field(default=None, ge=128, le=1_000_000)
    supports_image: bool | None = None
    reasoning_effort: LLM_REASONING_EFFORTS | None = None
    thinking_format: LLM_THINKING_FORMATS | None = None


class LlmProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    base_url: str
    model: str
    api_protocol: str = "openai-completions"
    context_window: int | None = None
    max_tokens: int | None = None
    supports_image: bool = False
    reasoning_effort: str | None = None
    thinking_format: str | None = None
    has_api_key: bool = False


class LlmProfilePushRequest(BaseModel):
    sandbox_ids: list[str] | None = None
    set_as_default: bool = True
    replace_managed: bool = False


_OIDC_RESERVED_SLUGS = {"start", "callback"}
_DOMAIN_RE = re.compile(
    r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$"
)


def _normalize_optional_http_url(value: str | None, field_name: str) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    parsed = urlsplit(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{field_name} must be a valid http:// or https:// URL")
    return cleaned


def _normalize_allowed_domains(value: str | None) -> str | None:
    if value is None:
        return None
    raw_items = re.split(r"[\s,;]+", value.strip())
    normalized: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        cleaned = item.strip().lower().lstrip("@")
        if not cleaned:
            continue
        if not _DOMAIN_RE.fullmatch(cleaned):
            raise ValueError(f"invalid email domain: {item}")
        if cleaned not in seen:
            seen.add(cleaned)
            normalized.append(cleaned)
    return ",".join(normalized) if normalized else None


class OidcProviderCreate(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,62}$")
    name: str = Field(min_length=1, max_length=128)
    enabled: bool = True
    issuer_url: str = Field(default="", max_length=512)
    discovery_url: str | None = Field(default=None, max_length=512)
    client_id: str = Field(min_length=1, max_length=255)
    client_secret: str = Field(default="", max_length=1024)
    scope: str = Field(default="openid profile email", max_length=255)
    email_claim: str = Field(default="email", max_length=128)
    logout_url: str | None = Field(default=None, max_length=512)
    allowed_domains: str | None = Field(default=None, max_length=512)
    allow_admin_login: bool = True
    sort_order: int = Field(default=100, ge=0, le=10000)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if cleaned in _OIDC_RESERVED_SLUGS:
            raise ValueError(f"slug '{cleaned}' is reserved")
        return cleaned

    @field_validator("name", "client_id")
    @classmethod
    def validate_non_empty_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("value cannot be empty")
        return cleaned

    @field_validator("issuer_url")
    @classmethod
    def validate_issuer_url(cls, value: str) -> str:
        return _normalize_optional_http_url(value, "issuer_url") or ""

    @field_validator("discovery_url")
    @classmethod
    def validate_discovery_url(cls, value: str | None) -> str | None:
        return _normalize_optional_http_url(value, "discovery_url")

    @field_validator("logout_url")
    @classmethod
    def validate_logout_url(cls, value: str | None) -> str | None:
        return _normalize_optional_http_url(value, "logout_url")

    @field_validator("scope")
    @classmethod
    def validate_scope(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        return cleaned or "openid profile email"

    @field_validator("email_claim")
    @classmethod
    def validate_email_claim(cls, value: str) -> str:
        cleaned = value.strip()
        return cleaned or "email"

    @field_validator("allowed_domains")
    @classmethod
    def validate_allowed_domains(cls, value: str | None) -> str | None:
        return _normalize_allowed_domains(value)

    @model_validator(mode="after")
    def validate_endpoints(self) -> OidcProviderCreate:
        if not self.issuer_url and not self.discovery_url:
            raise ValueError("issuer_url or discovery_url is required")
        return self


class OidcProviderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    issuer_url: str | None = Field(default=None, max_length=512)
    discovery_url: str | None = Field(default=None, max_length=512)
    client_id: str | None = Field(default=None, min_length=1, max_length=255)
    client_secret: str | None = Field(default=None, max_length=1024)
    clear_client_secret: bool = False
    scope: str | None = Field(default=None, max_length=255)
    email_claim: str | None = Field(default=None, max_length=128)
    logout_url: str | None = Field(default=None, max_length=512)
    allowed_domains: str | None = Field(default=None, max_length=512)
    allow_admin_login: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)

    @field_validator("name", "client_id")
    @classmethod
    def validate_optional_non_empty(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("value cannot be empty")
        return cleaned

    @field_validator("issuer_url")
    @classmethod
    def validate_issuer_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_optional_http_url(value, "issuer_url") or ""

    @field_validator("discovery_url")
    @classmethod
    def validate_discovery_url(cls, value: str | None) -> str | None:
        return _normalize_optional_http_url(value, "discovery_url")

    @field_validator("logout_url")
    @classmethod
    def validate_logout_url(cls, value: str | None) -> str | None:
        return _normalize_optional_http_url(value, "logout_url")

    @field_validator("scope")
    @classmethod
    def validate_scope(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()) or "openid profile email"

    @field_validator("email_claim")
    @classmethod
    def validate_email_claim(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or "email"

    @field_validator("allowed_domains")
    @classmethod
    def validate_allowed_domains(cls, value: str | None) -> str | None:
        return _normalize_allowed_domains(value)


class OidcProviderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    slug: str
    name: str
    enabled: bool
    issuer_url: str
    discovery_url: str | None = None
    client_id: str
    has_client_secret: bool = False
    scope: str = "openid profile email"
    email_claim: str = "email"
    logout_url: str | None = None
    allowed_domains: str | None = None
    allow_admin_login: bool = True
    sort_order: int = 100
    redirect_uri: str = ""
    post_logout_redirect_uri: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PublicOidcProviderOut(BaseModel):
    slug: str
    name: str
    login_url: str


class OidcProviderTestRequest(BaseModel):
    provider_id: str | None = None
    issuer_url: str | None = Field(default=None, max_length=512)
    discovery_url: str | None = Field(default=None, max_length=512)

    @field_validator("issuer_url")
    @classmethod
    def validate_issuer_url(cls, value: str | None) -> str | None:
        return _normalize_optional_http_url(value, "issuer_url")

    @field_validator("discovery_url")
    @classmethod
    def validate_discovery_url(cls, value: str | None) -> str | None:
        return _normalize_optional_http_url(value, "discovery_url")


class OidcProviderTestOut(BaseModel):
    ok: bool
    discovery_url: str = ""
    issuer: str | None = None
    authorization_endpoint: str | None = None
    token_endpoint: str | None = None
    end_session_endpoint: str | None = None
    supports_logout: bool = False
    detail: str = ""


class AuthPolicyOut(BaseModel):
    allow_local_user_login: bool = True
    admin_token_configured: bool = False
    auth_mode: str = "token"


class AuthPolicyUpdate(BaseModel):
    allow_local_user_login: bool


class BrandingOut(BaseModel):
    brand_name_zh: str = "Metis"
    brand_name_en: str = "Metis"
    brand_logo_svg: str = ""
    brand_favicon: str = ""


class BrandingUpdate(BaseModel):
    brand_name_zh: str = Field(min_length=1, max_length=64)
    brand_name_en: str = Field(min_length=1, max_length=64)
    brand_logo_svg: str | None = Field(default=None, max_length=32768)
    brand_favicon: str | None = Field(default=None, max_length=65536)

    @field_validator("brand_name_zh", "brand_name_en")
    @classmethod
    def validate_brand_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("brand name cannot be empty")
        return cleaned


class TeamAssembleRequest(BaseModel):
    team_name: str | None = Field(default=None, max_length=80)
    name: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=512)
    sandbox_ids: list[str] | None = None
    member_ids: list[str] | None = None
    moderator_slug: str | None = None
    moderator_id: str | None = None


class SandboxCloneRequest(BaseModel):
    email: EmailStr | None = None
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9-]{1,62}$")
    display_name: str | None = None
    role_title: str | None = Field(default=None, max_length=128)
    exclude_caches: bool = True
    copy_workspace: bool = True


class TaskDispatchRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    room_id: str | None = None
    approval_required: bool = False


class ApprovalDecisionRequest(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=1000)
    room_id: str | None = None


class WebhookEventPayload(BaseModel):
    source: str = Field(default="webhook", max_length=64)
    event: str = Field(default="task", max_length=64)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    wake_if_sleeping: bool = True


class CredentialProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    git_user_name: str | None = Field(default=None, max_length=128)
    git_user_email: str | None = Field(default=None, max_length=255)
    git_host: str = Field(default="github.com", max_length=255)
    git_token: str = ""
    ssh_private_key: str = ""
    env_vars_json: str = "{}"
    mcp_servers_json: str = "{}"


class CredentialProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    git_user_name: str | None = Field(default=None, max_length=128)
    git_user_email: str | None = Field(default=None, max_length=255)
    git_host: str | None = Field(default=None, max_length=255)
    git_token: str | None = None
    clear_git_token: bool = False
    ssh_private_key: str | None = None
    clear_ssh_key: bool = False
    env_vars_json: str | None = None
    mcp_servers_json: str | None = None


class CredentialProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    git_user_name: str | None = None
    git_user_email: str | None = None
    git_host: str = "github.com"
    has_git_token: bool = False
    has_ssh_key: bool = False
    has_env_vars: bool = False
    mcp_servers_json: str | None = "{}"
    created_at: datetime
    updated_at: datetime


class CredentialProfilePushRequest(BaseModel):
    sandbox_ids: list[str] | None = None


class ExposeAppRequest(BaseModel):
    name: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,47}$")
    port: int = Field(ge=1, le=65535)
    prefix: str | None = None


class UserServiceCreateRequest(BaseModel):
    name: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,47}$")
    command: str = Field(min_length=1, max_length=1024)


class CronJobCreateRequest(BaseModel):
    schedule: str = Field(min_length=5, max_length=128)
    command: str = Field(min_length=1, max_length=1024)


class SnapshotCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    note: str | None = Field(default=None, max_length=512)
    exclude_caches: bool = True


class SnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    sandbox_id: str
    sandbox_slug: str
    name: str
    note: str | None = None
    size_mb: float = 0.0
    created_by: str | None = None
    created_at: datetime


class SharedProjectSyncRequest(BaseModel):
    team_name: str = Field(min_length=1, max_length=128)
    sandbox_ids: list[str] = Field(min_length=1)
    file_name: str = Field(default="PROJECT_BRIEF.md", min_length=1, max_length=128)
    content: str = Field(min_length=1, max_length=200000)



