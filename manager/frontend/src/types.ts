// Shared API & UI data contracts for Metis Digital Workforce Cloud

export interface PublicOidcProvider {
  slug: string
  name: string
  login_url: string
}

export interface OidcProviderItem {
  id: string
  slug: string
  name: string
  enabled: boolean
  issuer_url: string
  discovery_url: string | null
  client_id: string
  has_client_secret: boolean
  scope: string
  email_claim: string
  logout_url: string | null
  allowed_domains: string | null
  allow_admin_login: boolean
  sort_order: number
  redirect_uri: string
  post_logout_redirect_uri: string
  created_at?: string | null
  updated_at?: string | null
}

export interface OidcTestResult {
  ok: boolean
  discovery_url: string
  issuer?: string | null
  authorization_endpoint?: string | null
  token_endpoint?: string | null
  end_session_endpoint?: string | null
  supports_logout: boolean
  detail: string
}

export interface BrandThemeTokens {
  mode: 'dark' | 'light' | 'slate'
  primary: string
  accent: string
  radius: 'sharp' | 'md' | 'rounded' | 'pill'
  font_scale: 'normal' | 'comfortable' | 'large'
  layout_width: 'standard' | 'wide' | 'full'
}

export interface AuthMe {
  authenticated: boolean
  email: string
  display_name?: string | null
  admin: boolean
  user_status?: string
  has_password?: boolean
  auth_mode: string
  auth_method?: string | null
  oidc_provider_slug?: string | null
  oidc_provider_name?: string | null
  allow_local_user_login?: boolean
  admin_token_configured?: boolean
  oidc_providers?: PublicOidcProvider[]
  default_admin_email: string
  public_url: string
  plugin_index_url: string
  brand_name_zh?: string
  brand_name_en?: string
  brand_logo_svg?: string
  brand_favicon?: string
  brand_theme?: BrandThemeTokens
  sandbox_runtime?: string
}

export interface SandboxItem {
  id: string
  email: string
  display_name: string | null
  slug: string
  container_id: string | null
  volume_name: string
  image_repo: string
  image_tag: string
  template: string
  role_title?: string | null
  role_description?: string | null
  role_sop?: string | null
  init_repo_url: string | null
  auto_install_plugins: string | null
  llm_profile_id: string | null
  llm_profile_name: string | null
  cpu_limit: number
  memory_limit: string
  auto_sleep_exempt?: boolean
  disk_usage_mb?: number | null
  disk_updated_at?: string | null
  preview_auth_mode?: string
  has_webhook_token?: boolean
  webhook_url?: string | null
  daily_token_limit?: number | null
  project_team_name?: string | null
  status: string
  url: string
  created_at: string
  last_seen_at: string | null
}

export interface SandboxStats {
  cpu_percent: number
  memory_usage_mb: number
  memory_limit_mb: number
  disk_usage_bytes?: number | null
  disk_usage_mb?: number | null
  disk_fs_total_mb?: number | null
  disk_fs_avail_mb?: number | null
  disk_fs_used_percent?: number | null
}

export interface TemplateItem {
  id: string
  key: string
  name: string
  description: string | null
  role_title?: string | null
  role_description?: string | null
  role_sop?: string | null
  default_llm_profile_id?: string | null
  image_repo: string
  image_tag: string
  default_cpu_limit: number
  default_memory_limit: string
  auto_install_plugins: string | null
  init_script: string | null
  default_env_json: string | null
  is_builtin: boolean
  updated_at: string
}

export interface RolePresetItem {
  key: string
  name: string
  role_title: string
  role_description: string
  description: string
  image_repo: string
  image_tag: string
  default_cpu_limit: number
  default_memory_limit: string
  auto_install_plugins: string
  role_sop: string
}

export interface WorkforceRuntimeData {
  online?: boolean
  status?: string
  slug?: string
  preview_auth_mode?: string
  has_webhook_token?: boolean
  role_title?: string | null
  role_description?: string | null
  role_sop?: string | null
  exposed_apps: Array<{
    name: string
    target?: string
    port?: number
    mount_path?: string
    prefix?: string
    url: string
  }>
  user_services?: Array<{
    name: string
    status: string
    detail?: string
    command: string
    directory: string
  }>
  services?: Array<{
    name: string
    status: string
    command: string
    directory: string
    autostart?: boolean
  }>
  cron_jobs: Array<{
    id?: string
    name?: string
    schedule: string
    command: string
    source?: 'dsh-schedule' | 'cron'
    status?: string
    raw?: string
  }>
  shared_files?: Array<{
    name: string
    size_bytes: number
  }>
  token_usage?: {
    estimated_tokens: number
    input_tokens?: number
    output_tokens?: number
    cache_read_tokens?: number
    sessions_count: number
    messages_count: number
    daily_limit?: number | null
    exact?: boolean
  }
  mesh_summary?: {
    role?: string
    description?: string
    has_sop?: boolean
    peers: Array<{ slug: string; owner_name?: string; role?: string; status?: string }>
    groups: Array<{ id: string; name: string; moderator_slug?: string; member_count: number }>
    tasks?: Array<{
      id: string
      room_id: string
      title: string
      description?: string
      status: string
      priority?: string
      assignee_slug?: string
      approval_required?: boolean
      approval_status?: string
    }>
    active_tasks_count: number
    done_tasks_count: number
    pending_approvals: Array<{ id: string; room_id?: string; title: string; assignee_slug?: string }>
  }
}

export interface SnapshotItem {
  id: string
  sandbox_id: string
  sandbox_slug: string
  name: string
  note?: string | null
  size_mb: number
  created_by?: string | null
  created_at: string
}

export interface CredentialProfileItem {
  id: string
  name: string
  git_user_name?: string | null
  git_user_email?: string | null
  git_host: string
  has_git_token: boolean
  has_ssh_key: boolean
  has_env_vars: boolean
  mcp_servers_json?: string | null
  created_at: string
  updated_at: string
}

export interface LlmProfileItem {
  id: string
  name: string
  base_url: string
  model: string
  api_protocol?: string
  context_window?: number | null
  max_tokens?: number | null
  supports_image?: boolean
  reasoning_effort?: string | null
  thinking_format?: string | null
  has_api_key?: boolean
}

export interface PluginIndexSource {
  url: string
  label: string
  kind: 'git' | 'http'
  enabled: boolean
}

export interface PluginItem {
  slug: string
  package_name: string
  version: string
  display_name_zh: string
  display_name_en: string
  description_zh: string
  description_en: string
  author: string
  category: string
  labels?: string[]
  icon_url: string | null
  tarball_url: string
  npm_packument_url: string
  install_command: string
}

export interface LocalImageItem {
  full_name: string
  repo: string
  tag: string
  id: string
  size_mb: number
}

export interface OverviewData {
  total_sandboxes: number
  running_sandboxes: number
  stopped_sandboxes: number
  allocated_cpus: number
  users_count: number
  templates_count: number
  plugins_count: number
  oidc_providers_count?: number
  enabled_oidc_providers_count?: number
  allow_local_user_login?: boolean
  admin_token_configured?: boolean
  default_image_repo: string
  default_image_tag: string
  default_cpus: number
  default_memory: string
  manager_auth_mode: string
  plugin_index_url: string
  idle_sleep_enabled?: boolean
  idle_sleep_minutes?: number
  brand_name_zh?: string
  brand_name_en?: string
  brand_logo_svg?: string
  brand_favicon?: string
  brand_theme?: BrandThemeTokens
  sandbox_runtime?: string
  local_images: LocalImageItem[]
  audit_logs: Array<{
    id: string
    actor: string | null
    action: string
    target: string | null
    detail: string | null
    created_at: string
  }>
}

export interface UserItem {
  id: string
  email: string
  display_name: string | null
  role: string
  status: string
  has_password: boolean
  sandbox_count: number
  created_at?: string | null
}

export interface AdminItem {
  email: string
  display_name: string | null
  active: boolean
  created_at: string
}
