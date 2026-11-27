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
  admin_password_configured?: boolean
  setup_completed?: boolean
  onboarding_step?: string
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
  is_team_lead?: boolean
  lead_team_ids?: string[]
  teams?: Array<{ id: string; slug: string; name: string; role: string }>
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
  credential_profile_ids?: string[]
  mcp_server_ids?: string[]
  skill_ids?: string[]
  cpu_limit: number
  memory_limit: string
  auto_sleep_exempt?: boolean
  disk_usage_mb?: number | null
  disk_updated_at?: string | null
  preview_auth_mode?: string
  has_webhook_token?: boolean
  webhook_url?: string | null
  daily_token_limit?: number | null
  daily_cost_limit?: number | null
  monthly_cost_limit?: number | null
  rpm_limit?: number | null
  tpm_limit?: number | null
  max_concurrent_requests?: number | null
  dlp_mode?: 'off' | 'redact' | 'block'
  budget_action?: 'block' | 'downgrade' | 'warn'
  has_gateway_api_key?: boolean
  ownership_mode?: 'personal' | 'shared'
  maintainer_emails?: string[]
  team_ids?: string[]
  team_names?: string[]
  can_open_ide?: boolean
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
  sop_version?: number
  default_llm_profile_id?: string | null
  default_credential_profile_ids?: string[]
  default_mcp_server_ids?: string[]
  default_skill_ids?: string[]
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
  preset_key?: string | null
  category?: string
  description?: string | null
  git_user_name?: string | null
  git_user_email?: string | null
  git_host: string
  github_auth_mode?: 'pat' | 'github_app' | string
  github_api_base_url?: string | null
  github_app_id?: string | null
  github_app_installation_id?: string | null
  github_tls_verify?: boolean
  has_git_token: boolean
  has_ssh_key: boolean
  has_github_app_private_key?: boolean
  has_github_app_cached_token?: boolean
  github_app_token_expires_at?: string | null
  has_env_vars: boolean
  env_var_keys?: string[]
  mcp_servers_json?: string | null
  created_at: string
  updated_at: string
}

export interface CredentialPresetItem {
  preset_key: string
  name: string
  category: string
  description: string
  git_user_name?: string
  git_user_email?: string
  git_host: string
  github_auth_mode?: 'pat' | 'github_app'
  github_api_base_url?: string
  github_tls_verify?: boolean
  suggested_env_keys: string[]
}

export interface McpServerItem {
  id: string
  slug: string
  name: string
  description?: string | null
  category: string
  transport: 'stdio' | 'streamable-http'
  command?: string | null
  args: string[]
  env: Record<string, string>
  cwd?: string | null
  url?: string | null
  headers: Record<string, string>
  tool_loading: 'eager' | 'on-demand'
  enabled: boolean
  required_credentials: string[]
  is_builtin: boolean
  created_by?: string | null
  pushed_sandbox_ids: string[]
  created_at: string
  updated_at: string
}

export interface SkillItem {
  id: string
  slug: string
  name: string
  description: string
  when_to_use?: string | null
  category: string
  content: string
  extra_files: Record<string, string>
  disable_model_invocation: boolean
  user_invocable: boolean
  is_builtin: boolean
  created_by?: string | null
  pushed_sandbox_ids: string[]
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
  gateway_enabled?: boolean
  input_price_per_1m?: number | null
  output_price_per_1m?: number | null
  cache_read_price_per_1m?: number | null
  cache_creation_price_per_1m?: number | null
  fallback_llm_profile_id?: string | null
  circuit_breaker_enabled?: boolean
  tpm_limit?: number | null
  dlp_mode?: 'off' | 'redact' | 'block'
  key_pool?: Array<{
    id: string
    label: string
    base_url?: string | null
    has_api_key: boolean
    weight: number
    enabled: boolean
  }>
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
  pull_missing_image?: boolean
  network_preset?: string
  sandbox_src_available?: boolean
  setup_completed?: boolean
  onboarding_step?: string
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
  database_backend?: string
  coordination?: {
    instance_id: string
    workers: number
    redis_configured: boolean
    redis_connected: boolean
    mode: string
    scheduler_leader?: string | null
    is_scheduler_leader: boolean
  }
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

export interface WorkspaceInboxTask {
  id: string
  room_id: string
  room_name: string
  thread_id?: string
  thread_title?: string
  title: string
  description: string
  summary: string
  status: string
  priority: string
  assignee_slug: string
  approval_required: boolean
  approval_status: string
  approval_decided_by?: string
  approval_note?: string
  artifacts: string[]
  created_at?: number | string | null
  updated_at?: number | string | null
  sandbox_id: string
  sandbox_slug: string
  sandbox_display_name: string | null
  role_title?: string | null
  project_team_id?: string | null
  project_team_name?: string | null
  sandbox_status: string
  sandbox_online: boolean
}

export interface WorkspacePlaybookApproval {
  id: string
  run_id: string
  run_title: string
  playbook_name: string
  stage_index: number
  stage_name: string
  role_hint: string
  sandbox_id: string | null
  sandbox_slug: string
  team_id: string | null
  project_team_name?: string | null
  output_summary: string
  deliverable_hint: string
  artifacts: string[]
  started_at?: string | null
  updated_at?: string | null
}

export interface WorkspaceTaskGroup {
  key: string
  room_id: string
  room_name: string
  thread_id: string
  title: string
  project_team_id?: string | null
  project_team_name?: string | null
  status: 'blocked' | 'pending_approval' | 'active' | 'done' | 'cancelled'
  counts: {
    total: number
    done: number
    active: number
    blocked: number
    cancelled: number
    pending_approvals: number
  }
  participants: Array<{
    sandbox_id: string
    sandbox_slug: string
    role_title?: string | null
  }>
  updated_at?: number | null
  tasks: WorkspaceInboxTask[]
}

export interface WorkspaceSandboxBadge {
  pending_approvals: number
  active_tasks: number
  blocked_tasks: number
  exposed_apps: number
  online: boolean
}

export interface WorkspaceInboxData {
  summary: {
    pending_approvals_count: number
    mesh_approvals_count?: number
    playbook_approvals_count?: number
    blocked_tasks_count: number
    action_required_count?: number
    active_tasks_count: number
    done_tasks_count: number
    active_groups_count?: number
    done_groups_count?: number
    running_sandboxes: number
    total_sandboxes: number
    exposed_apps_count: number
    last_synced_at: string | null
  }
  pending_approvals: WorkspaceInboxTask[]
  playbook_approvals?: WorkspacePlaybookApproval[]
  blocked_tasks: WorkspaceInboxTask[]
  task_groups?: WorkspaceTaskGroup[]
  tasks: WorkspaceInboxTask[]
  sandbox_badges: Record<string, WorkspaceSandboxBadge>
}

export interface WorkspaceDeliverableApp {
  name: string
  url: string
  mount_path: string
  target: string
  sandbox_id: string
  sandbox_slug: string
  sandbox_display_name: string | null
  role_title?: string | null
  project_team_name?: string | null
  preview_auth_mode: string
  sandbox_status: string
  online: boolean
}

export interface WorkspaceDeliverableArtifact {
  id: string
  value: string
  kind: 'url' | 'pr' | 'branch' | 'file'
  task_id: string
  task_title: string
  task_status: string
  room_name: string
  sandbox_id: string
  sandbox_slug: string
  sandbox_display_name: string | null
  role_title?: string | null
  project_team_name?: string | null
  updated_at?: number | string | null
}

export interface WorkspaceDeliverablesData {
  apps: WorkspaceDeliverableApp[]
  artifacts: WorkspaceDeliverableArtifact[]
  total_apps: number
  total_artifacts: number
  last_synced_at: string | null
}

export type NotificationChannelType = 'feishu' | 'wecom' | 'slack' | 'email' | 'webhook'
export type NotificationEventType =
  | 'approval.pending'
  | 'task.blocked'
  | 'task.done'
  | 'sandbox.unhealthy'
  | 'budget.warning'
  | 'budget.exceeded'
  | 'stage.timeout'

export interface NotificationChannelItem {
  id: string
  name: string
  channel_type: NotificationChannelType
  enabled: boolean
  target_hint?: string | null
  has_secret: boolean
  events: NotificationEventType[]
  scope_sandbox_ids: string[]
  smtp_host?: string | null
  smtp_port?: number | null
  smtp_from?: string | null
  smtp_to: string[]
  smtp_use_tls: boolean
  created_at: string
  updated_at: string
}

export interface NotificationDeliveryItem {
  id: string
  channel_id: string
  channel_name: string
  channel_type: string
  event_type: string
  dedupe_key?: string | null
  sandbox_slug?: string | null
  title: string
  status: 'sent' | 'failed'
  response_code?: number | null
  error_detail?: string | null
  created_at: string
}

export interface AuditLogItem {
  id: string
  actor: string | null
  action: string
  category?: string | null
  sandbox_slug?: string | null
  target: string | null
  detail: string | null
  created_at: string
}

export interface AuditLogPageData {
  items: AuditLogItem[]
  total: number
  limit: number
  offset: number
  categories: string[]
  actions: string[]
}

export interface TeamMemberItem {
  email: string
  role: 'lead' | 'member'
  created_at?: string | null
}

export interface TeamSandboxItem {
  id: string
  slug: string
  display_name: string | null
  owner_email: string
  role_title?: string | null
  ownership_mode: 'personal' | 'shared'
  status: string
  is_moderator: boolean
}

export interface TeamItem {
  id: string
  slug: string
  name: string
  description?: string | null
  department?: string | null
  daily_token_budget?: number | null
  daily_cost_budget?: number | null
  today_cost_usd?: number
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
  status?: 'active' | 'archived'
  mesh_room_id?: string | null
  my_role?: string | null
  can_manage: boolean
  active_runs_count?: number
  total_runs_count?: number
  pending_approvals_count?: number
  period_cost_usd?: number
  members: TeamMemberItem[]
  sandboxes: TeamSandboxItem[]
}

export interface ProvisionRequestItem {
  id: string
  requester_email: string
  team_id?: string | null
  team_name?: string | null
  template_key: string
  template_name: string
  ownership_mode: 'personal' | 'shared'
  desired_slug?: string | null
  role_title?: string | null
  reason?: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by?: string | null
  review_note?: string | null
  provisioned_sandbox_id?: string | null
  provisioned_slug?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface FinOpsSummaryData {
  today: {
    tokens: number
    cost: number
    requests: number
  }
  period: {
    days: number
    tokens: number
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cost: number
    requests: number
    fallback_requests: number
    error_requests?: number
    cache_savings_estimate?: number
  }
  daily_series: Array<{
    date: string
    tokens: number
    cost: number
    requests: number
  }>
  by_sandbox: Array<{
    sandbox_id: string
    slug: string
    display_name: string | null
    role_title?: string | null
    ownership_mode: string
    today_tokens: number
    today_cost: number
    daily_cost_limit?: number | null
    monthly_cost?: number
    monthly_cost_limit?: number | null
    monthly_budget_percent?: number | null
    rpm_limit?: number | null
    cost_budget_percent?: number | null
    daily_limit?: number | null
    budget_percent?: number | null
    budget_action: string
    period_tokens: number
    period_cost: number
    requests: number
  }>
  by_team: Array<{
    team_id: string
    team_name: string
    department?: string | null
    today_tokens: number
    today_cost: number
    daily_cost_budget?: number | null
    cost_budget_percent?: number | null
    daily_budget?: number | null
    period_tokens: number
    period_cost: number
    requests: number
  }>
  by_model: Array<{
    model: string
    api_protocol: string
    tokens: number
    cost: number
    requests: number
  }>
  circuit_breakers?: Record<
    string,
    {
      failures: number
      open: boolean
      cooldown_remaining_seconds: number
      last_error?: string
    }
  >
}

export interface PlaybookInputField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'file'
  required?: boolean
  placeholder?: string
  options?: string[]
}

export interface PlaybookStageSpec {
  id: string
  name: string
  role_hint?: string
  template_key_hint?: string
  parallel_group?: string | null
  depends_on?: string[]
  timeout_seconds?: number | null
  max_retries?: number
  on_reject_goto?: string | null
  approval_required?: boolean
  prompt_template: string
  deliverable_hint?: string
  skip_if?: string | null
}

export interface PlaybookItem {
  id: string
  key: string
  name: string
  category: 'engineering' | 'analytics' | 'legal' | 'operations' | 'custom'
  description?: string | null
  is_builtin: boolean
  enabled: boolean
  estimated_manual_hours: number
  input_fields: PlaybookInputField[]
  stages: PlaybookStageSpec[]
  deliverables_checklist: string[]
  schedule_cron?: string | null
  schedule_enabled?: boolean
  schedule_timezone?: string
  schedule_inputs?: Record<string, string>
  last_scheduled_at?: string | null
  has_webhook_secret?: boolean
  webhook_url?: string | null
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface PlaybookStepRunItem {
  id: string
  stage_index: number
  stage_id: string
  stage_name: string
  role_hint?: string | null
  parallel_group?: string | null
  depends_on?: string[]
  timeout_seconds?: number | null
  max_retries?: number
  retry_count?: number
  sla_warned_at?: string | null
  on_reject_goto?: string | null
  skip_if?: string | null
  sandbox_id?: string | null
  sandbox_slug?: string | null
  room_id?: string | null
  task_id?: string | null
  approval_required: boolean
  approval_status?: string | null
  approval_note?: string | null
  approval_decided_by?: string | null
  status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'rejected' | 'skipped'
  deliverable_hint?: string | null
  output_summary?: string | null
  artifacts: string[]
  started_at?: string | null
  completed_at?: string | null
}

export interface PlaybookRelayedArtifactItem {
  id: string
  stage_id?: string | null
  file_name: string
  size_bytes: number
  sha256?: string
  source_sandbox_slug?: string | null
  download_url?: string
  created_at?: string | null
}

export interface PlaybookRunTraceEventItem {
  id: string
  model: string
  routed_mode: string
  upstream_key_label?: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  cost_amount: number
  status_code: number
  latency_ms: number
  dlp_redacted_count: number
  created_at?: string | null
}

export interface PlaybookRunTraceResponse {
  run_id: string
  playbook_key: string
  title: string
  status: string
  total_llm_calls: number
  total_tokens: number
  total_cost_usd: number
  total_dlp_redactions: number
  stages: Array<{
    step_id: string
    stage_id: string
    stage_name: string
    sandbox_slug?: string | null
    status: string
    retry_count: number
    duration_seconds?: number | null
    llm_calls: number
    tokens: number
    cost_usd: number
    fallback_calls: number
    dlp_redactions: number
    events: PlaybookRunTraceEventItem[]
  }>
  artifacts: Array<{
    id: string
    stage_id?: string | null
    file_name: string
    source_sandbox_slug?: string | null
    source_path?: string | null
    size_bytes: number
    sha256?: string
  }>
}

export interface ToolPolicyRuleItem {
  id: string
  name: string
  enabled: boolean
  tool_pattern: string
  arg_regex?: string | null
  action: 'require_approval' | 'block' | 'audit'
  scope_sandbox_id?: string | null
  description?: string | null
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ToolApprovalRequestItem {
  id: string
  sandbox_id: string
  sandbox_slug: string
  rule_id?: string | null
  rule_name: string
  playbook_run_id?: string | null
  playbook_step_id?: string | null
  tool_name: string
  tool_args_summary: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  decided_by?: string | null
  decision_note?: string | null
  decided_at?: string | null
  expires_at?: string | null
  created_at?: string | null
}

export interface MemoryKnowledgeItem {
  id: string
  source_type: string
  source_id?: string | null
  template_id?: string | null
  team_id?: string | null
  title: string
  category: string
  tags_csv: string
  content: string
  enabled: boolean
  score?: number
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface PlaybookRunItem {
  id: string
  playbook_id: string
  playbook_key: string
  playbook_name: string
  team_id?: string | null
  execution_mode?: 'project_group' | 'isolated'
  title: string
  inputs: Record<string, string>
  role_assignments?: Record<string, string>
  uploaded_files: Array<{ sandbox_id?: string; slug?: string; path: string }>
  status: 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'
  current_stage_index: number
  progress_done: number
  progress_total: number
  created_by: string
  created_at?: string | null
  updated_at?: string | null
  completed_at?: string | null
  steps: PlaybookStepRunItem[]
  artifacts: Array<{ stage_name: string; value: string }>
  relayed_artifacts?: PlaybookRelayedArtifactItem[]
}

export interface ScorecardData {
  period_days: number
  hourly_rate_usd: number
  generated_at: string
  kpis: {
    total_employees: number
    total_tasks: number
    done_tasks: number
    active_tasks: number
    blocked_tasks: number
    completion_rate_pct: number | null
    blocked_rate_pct: number | null
    approvals_approved: number
    approvals_rejected: number
    approvals_pending: number
    first_pass_approval_rate_pct: number | null
    avg_cycle_hours: number | null
    playbook_runs_total: number
    playbook_runs_completed: number
    total_tokens: number
    total_cost_usd: number
    cost_per_task_usd: number | null
    estimated_hours_saved: number
    estimated_value_usd: number
    roi_multiple: number | null
  }
  by_sandbox: Array<{
    sandbox_id: string
    slug: string
    display_name: string
    role_title?: string | null
    ownership_mode: string
    total_tasks: number
    done_tasks: number
    blocked_tasks: number
    completion_rate_pct: number | null
    tokens: number
    cost_usd: number
    cost_per_task_usd: number | null
    estimated_hours_saved: number
  }>
  by_team: Array<{
    team_id: string
    team_name: string
    department?: string | null
    employees_count: number
    total_tasks: number
    done_tasks: number
    blocked_tasks: number
    cost_usd: number
    estimated_hours_saved: number
  }>
}

export interface SandboxMemoryItem {
  id: string
  title: string
  category: string
  source: string
  summary: string
  content: string
  tags: string[]
  pinned: boolean
  enabled: boolean
  updated_at?: number | string | null
}

export interface MemoryPromotionItem {
  id: string
  source_sandbox_id: string
  source_sandbox_slug: string
  memory_id: string
  memory_title: string
  memory_category: string
  promoted_content: string
  target_type: 'template_sop' | 'team_shared_doc'
  target_template_id?: string | null
  target_template_name?: string | null
  target_team_id?: string | null
  target_team_name?: string | null
  target_file_name?: string | null
  sop_version?: number | null
  rollout_sandbox_ids: string[]
  rollout_synced_count: number
  promoted_by: string
  created_at?: string | null
}

export interface SetupStatusData {
  setup_completed: boolean
  needs_setup: boolean
  onboarding_step: 'account' | 'images' | 'llm' | 'done' | string
  setup_code_configured: boolean
  setup_code_file_hint?: string | null
  default_admin_email: string
  default_image_repo: string
  default_image_tag: string
  base_image_present: boolean
  has_llm_profile: boolean
  database_backend: string
  sandbox_runtime: string
  sandbox_src_available: boolean
}

export interface PlatformRuntimeSettings {
  network_preset: 'direct' | 'cn-aliyun' | 'custom'
  docker_registry_mirror: string
  apt_mirror: string
  node_mirror: string
  npm_registry: string
  pip_index_url: string
  default_image_repo: string
  default_image_tag: string
  pull_missing_image: boolean
  default_cpus: number
  default_memory: string
  default_timezone: string
  default_auto_install_plugins: string
  sandbox_src_available: boolean
  sandbox_src_path?: string | null
  updated_at?: string | null
}

export interface ContainerRegistryItem {
  id: string
  name: string
  registry_host: string
  username: string
  has_password: boolean
  tls_verify: boolean
  is_default: boolean
  k8s_secret_name?: string | null
  last_test_ok?: boolean | null
  last_tested_at?: string | null
  last_error?: string | null
  created_at: string
  updated_at: string
}

export interface ContainerRegistryTestResult {
  ok: boolean
  registry_host: string
  detail: string
  k8s_synced: boolean
}

export interface ImageBuildJobItem {
  id: string
  job_key: string
  kind: 'pull' | 'base' | 'variant' | 'push' | string
  image_repo: string
  image_tag: string
  base_image?: string | null
  install_browser: boolean
  network_preset: string
  packages: {
    apt: string[]
    pip: string[]
    npm: string[]
  }
  custom_dockerfile?: string | null
  push_registry_id?: string | null
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | string
  progress_stage: string
  log_text: string
  error_message?: string | null
  image_id?: string | null
  size_bytes?: number | null
  created_by?: string | null
  created_at: string
  started_at?: string | null
  finished_at?: string | null
}

export interface ImagePruneResult {
  reclaimed_bytes: number
  deleted_images: string[]
}
