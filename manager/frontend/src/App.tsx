import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Terminal,
  Plus,
  Play,
  Square,
  RotateCw,
  Trash2,
  ExternalLink,
  Download,
  Cpu,
  Layers,
  Package,
  KeyRound,
  Users,
  ShieldCheck,
  Copy,
  Check,
  RefreshCw,
  Sliders,
  FileText,
  LogOut,
  Box,
  Sparkles,
  AlertCircle,
  Lock,
  Edit3,
  Globe,
  Upload,
  Moon,
  Send,
} from 'lucide-react'
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Input,
  Textarea,
  Select,
  Label,
  Progress,
  Dialog,
  cn,
} from './components/ui'
import {
  apiFetch,
  parseApiErrorDetail,
  resolveInitialView,
  resolveSafeNextPath,
  slugifyOidcName,
} from './lib/client.ts'
import {
  DEFAULT_LOCALE,
  Locale,
  MessageKey,
  detectInitialLocale,
  localizeAction,
  localizeStatus,
  persistLocale,
  pickLocalizedText,
  translate,
} from './lib/i18n.ts'

interface I18nContextValue {
  locale: Locale
  setLocale: (next: Locale) => void
  t: (key: MessageKey, vars?: Record<string, string | number | null | undefined>) => string
}

const LocaleContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
})

function useI18n() {
  return useContext(LocaleContext)
}

function LocaleToggle() {
  const { locale, setLocale, t } = useI18n()
  return (
    <div
      className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5"
      role="group"
      aria-label={t('app.localeToggleLabel')}
      title={t('app.localeToggleLabel')}
    >
      <Globe className="mx-1.5 h-3.5 w-3.5 text-zinc-400" />
      <button
        type="button"
        onClick={() => setLocale('zh-CN')}
        className={cn(
          'rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
          locale === 'zh-CN'
            ? 'bg-zinc-100 text-zinc-950 shadow-xs'
            : 'text-zinc-400 hover:text-zinc-100',
        )}
      >
        中文
      </button>
      <button
        type="button"
        onClick={() => setLocale('en')}
        className={cn(
          'rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
          locale === 'en'
            ? 'bg-zinc-100 text-zinc-950 shadow-xs'
            : 'text-zinc-400 hover:text-zinc-100',
        )}
      >
        EN
      </button>
    </div>
  )
}

interface PublicOidcProvider {
  slug: string
  name: string
  login_url: string
}

interface OidcProviderItem {
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

interface OidcTestResult {
  ok: boolean
  discovery_url: string
  issuer?: string | null
  authorization_endpoint?: string | null
  token_endpoint?: string | null
  end_session_endpoint?: string | null
  supports_logout: boolean
  detail: string
}

interface AuthMe {
  authenticated: boolean
  email: string
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
}

interface SandboxItem {
  id: string
  email: string
  display_name: string | null
  slug: string
  container_id: string | null
  volume_name: string
  image_repo: string
  image_tag: string
  template: string
  init_repo_url: string | null
  auto_install_plugins: string | null
  llm_profile_id: string | null
  llm_profile_name: string | null
  cpu_limit: number
  memory_limit: string
  auto_sleep_exempt?: boolean
  disk_usage_mb?: number | null
  disk_updated_at?: string | null
  status: string
  url: string
  created_at: string
  last_seen_at: string | null
}

interface SandboxStats {
  cpu_percent: number
  memory_usage_mb: number
  memory_limit_mb: number
  disk_usage_bytes?: number | null
  disk_usage_mb?: number | null
  disk_fs_total_mb?: number | null
  disk_fs_avail_mb?: number | null
  disk_fs_used_percent?: number | null
}

interface TemplateItem {
  id: string
  key: string
  name: string
  description: string | null
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

interface LlmProfileItem {
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

interface PluginItem {
  slug: string
  package_name: string
  version: string
  display_name_zh: string
  display_name_en: string
  description_zh: string
  description_en: string
  author: string
  category: string
  icon_url: string | null
  tarball_url: string
  npm_packument_url: string
  install_command: string
}

interface LocalImageItem {
  full_name: string
  repo: string
  tag: string
  id: string
  size_mb: number
}

interface OverviewData {
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

function formatDiskSize(mb?: number | null): string {
  if (mb === null || mb === undefined || Number.isNaN(mb)) return '—'
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

function computeDiskPercent(st?: SandboxStats | null, fallbackUsageMb?: number | null): number | null {
  if (!st) return null
  if (st.disk_fs_used_percent != null && !Number.isNaN(st.disk_fs_used_percent)) {
    return Math.max(0, Math.min(100, Math.round(st.disk_fs_used_percent)))
  }
  const usage = st.disk_usage_mb ?? fallbackUsageMb
  if (usage != null && st.disk_fs_total_mb && st.disk_fs_total_mb > 0) {
    return Math.max(0, Math.min(100, Math.round((usage / st.disk_fs_total_mb) * 100)))
  }
  return null
}

async function fetchRunningStats(
  items: SandboxItem[],
  apiPrefix: '/api/sandboxes' | '/api/my/sandboxes',
): Promise<Record<string, SandboxStats>> {
  const running = items.filter((s) => s.status === 'running')
  if (running.length === 0) return {}
  const entries = await Promise.all(
    running.map(async (s) => {
      try {
        const st = await apiFetch<SandboxStats>(`${apiPrefix}/${s.id}/stats`)
        return [s.id, st] as const
      } catch {
        return null
      }
    }),
  )
  const map: Record<string, SandboxStats> = {}
  for (const entry of entries) {
    if (entry) map[entry[0]] = entry[1]
  }
  return map
}

function ResourceUsageBars({
  stats,
  fallbackDiskMb,
}: {
  stats: SandboxStats
  fallbackDiskMb?: number | null
}) {
  const memPct =
    stats.memory_limit_mb > 0
      ? Math.round((stats.memory_usage_mb / stats.memory_limit_mb) * 100)
      : 0
  const diskPct = computeDiskPercent(stats, fallbackDiskMb)
  const diskTitle =
    stats.disk_fs_total_mb != null
      ? `${formatDiskSize(stats.disk_fs_avail_mb)} free / ${formatDiskSize(stats.disk_fs_total_mb)}`
      : undefined

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-zinc-400">CPU</span>
        <span className="font-mono text-zinc-200">{stats.cpu_percent}%</span>
      </div>
      <Progress value={Math.min(100, stats.cpu_percent)} />
      <div className="flex justify-between text-[11px]">
        <span className="text-zinc-400">MEM</span>
        <span className="font-mono text-zinc-200">
          {stats.memory_usage_mb} / {stats.memory_limit_mb} MB ({memPct}%)
        </span>
      </div>
      <Progress value={memPct} />
      <div className="flex justify-between text-[11px] pt-0.5" title={diskTitle}>
        <span className="text-zinc-400">DISK</span>
        <span className="font-mono text-zinc-200">
          {formatDiskSize(stats.disk_usage_mb ?? fallbackDiskMb)}
          {diskPct != null ? ` (${diskPct}%)` : ''}
        </span>
      </div>
      {diskPct != null && <Progress value={diskPct} />}
    </div>
  )
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  if (typeof window !== 'undefined' && window.isSecureContext !== false && navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to execCommand fallback
    }
  }
  if (typeof document === 'undefined' || !document.createElement) return false
  const container = document.activeElement?.parentElement || document.body
  if (!container) return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.position = 'fixed'
  ta.style.top = '-9999px'
  ta.style.left = '-9999px'
  ta.style.opacity = '0'
  const prevFocus = document.activeElement as HTMLElement | null
  container.appendChild(ta)
  let ok = false
  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = Boolean(document.execCommand?.('copy'))
  } catch {
    ok = false
  } finally {
    ta.remove()
    try {
      prevFocus?.focus?.({ preventScroll: true })
    } catch {}
  }
  return ok
}

function BackupRestoreDialog({
  sandbox,
  isAdmin,
  onClose,
  notify,
  onRestored,
}: {
  sandbox: SandboxItem | null
  isAdmin: boolean
  onClose: () => void
  notify: (msg: string, type?: 'success' | 'error') => void
  onRestored: () => Promise<void> | void
}) {
  const { t } = useI18n()
  const [excludeCaches, setExcludeCaches] = useState(true)
  const [restoreMode, setRestoreMode] = useState<'merge' | 'clean'>('merge')
  const [file, setFile] = useState<File | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    setFile(null)
    setRestoreMode('merge')
    setRestoring(false)
  }, [sandbox?.id])

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sandbox || !file) {
      notify(t('dialog.backup.noFile'), 'error')
      return
    }
    setRestoring(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('mode', restoreMode)
      const endpoint = isAdmin
        ? `/api/sandboxes/${sandbox.id}/restore`
        : `/api/my/sandboxes/${sandbox.id}/restore`
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload, res.status))
      }
      notify(
        t('dialog.backup.restoreSuccess', {
          count: payload?.restored_entries ?? 0,
        }),
      )
      await onRestored()
      onClose()
    } catch (err: any) {
      notify(err.message || 'Restore failed', 'error')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Dialog
      open={!!sandbox}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.backup.title', { slug: sandbox?.slug ?? '' })}
    >
      <div className="space-y-4 text-xs">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
          <div className="font-medium text-zinc-200">{t('dialog.backup.exportTitle')}</div>
          <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeCaches}
              onChange={(e) => setExcludeCaches(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
            />
            <span>{t('dialog.backup.excludeCachesLabel')}</span>
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (!sandbox) return
              window.open(
                `/api/sandboxes/${sandbox.id}/backup?exclude_caches=${excludeCaches ? 'true' : 'false'}`,
                '_blank',
              )
            }}
          >
            <Download className="h-3.5 w-3.5" />
            {t('dialog.backup.downloadBtn')}
          </Button>
        </div>

        <form
          onSubmit={handleRestore}
          className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3"
        >
          <div className="font-medium text-zinc-200">{t('dialog.backup.restoreTitle')}</div>
          <div className="space-y-1.5">
            <Label>{t('dialog.backup.fileLabel')}</Label>
            <Input
              type="file"
              accept=".tar,.tar.gz,.tgz,.tar.bz2,.tar.xz"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('dialog.backup.modeLabel')}</Label>
            <Select
              value={restoreMode}
              onChange={(e) => setRestoreMode(e.target.value as 'merge' | 'clean')}
            >
              <option value="merge">{t('dialog.backup.modeMerge')}</option>
              <option value="clean">{t('dialog.backup.modeClean')}</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={restoring || !file}>
              <Upload className="h-3.5 w-3.5" />
              {restoring ? t('dialog.backup.restoring') : t('dialog.backup.restoreBtn')}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  )
}

interface UserItem {
  id: string
  email: string
  display_name: string | null
  role: string
  status: string
  has_password: boolean
  sandbox_count: number
  created_at?: string | null
}

interface AdminItem {
  email: string
  display_name: string | null
  active: boolean
  created_at: string
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale())
  const [auth, setAuth] = useState<AuthMe | null>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const [view, setView] = useState<'admin' | 'my' | 'login'>('admin')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number | null | undefined>) =>
      translate(locale, key, vars),
    [locale],
  )

  const i18nValue = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, t],
  )

  useEffect(() => {
    persistLocale(locale)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
      document.title = translate(locale, 'app.documentTitle')
    }
  }, [locale])

  const notify = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const loadAuth = useCallback(async () => {
    try {
      const me = await apiFetch<AuthMe>('/api/auth/me')
      setAuth(me)
      setView(resolveInitialView(me, window.location.pathname))
    } catch {
      setView('login')
    } finally {
      setLoadingAuth(false)
    }
  }, [])

  useEffect(() => {
    loadAuth()
  }, [loadAuth])

  const handleLogout = async () => {
    try {
      const res = await apiFetch<{ ok: boolean; logout_url?: string | null }>('/api/auth/logout', {
        method: 'POST',
      })
      setAuth((prev) =>
        prev ? { ...prev, authenticated: false, email: '', admin: false } : null,
      )
      if (res.logout_url) {
        window.location.assign(res.logout_url)
        return
      }
    } catch (err: any) {
      notify(err?.message || 'Logout failed', 'error')
      return
    }
    window.history.pushState({}, '', '/login')
    await loadAuth()
  }

  const switchView = (target: 'admin' | 'my') => {
    window.history.pushState({}, '', target === 'admin' ? '/admin' : '/my')
    setView(target)
  }

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-400 text-sm">
        <RefreshCw className="h-4 w-4 animate-spin mr-2" /> {t('app.checkingSession')}
      </div>
    )
  }

  return (
    <LocaleContext.Provider value={i18nValue}>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
        {toast && (
          <div
            className={cn(
              'fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-medium shadow-2xl animate-in slide-in-from-bottom-3',
              toast.type === 'error'
                ? 'border-rose-500/40 bg-rose-950/95 text-rose-200'
                : 'border-emerald-500/40 bg-emerald-950/95 text-emerald-200',
            )}
          >
            {toast.type === 'error' ? (
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            ) : (
              <Check className="h-4 w-4 text-emerald-400 shrink-0" />
            )}
            <span>{toast.text}</span>
          </div>
        )}

        {/* Top Header */}
        <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
                <Terminal className="h-4 w-4" />
              </div>
              <span className="font-semibold text-sm tracking-tight">DSH Sandbox Cloud</span>
            </div>

            <div className="flex items-center gap-2">
              {auth?.authenticated && (
                <>
                  {auth.admin && (
                    <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5">
                      <button
                        onClick={() => switchView('admin')}
                        className={cn(
                          'px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer',
                          view === 'admin'
                            ? 'bg-zinc-800 text-zinc-100 font-medium'
                            : 'text-zinc-400 hover:text-zinc-200',
                        )}
                      >
                        {t('app.nav.admin')}
                      </button>
                      <button
                        onClick={() => switchView('my')}
                        className={cn(
                          'px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer',
                          view === 'my'
                            ? 'bg-zinc-800 text-zinc-100 font-medium'
                            : 'text-zinc-400 hover:text-zinc-200',
                        )}
                      >
                        {t('app.nav.my')}
                      </button>
                    </div>
                  )}
                  <Badge variant="secondary" className="hidden md:inline-flex">
                    {auth.email}
                  </Badge>
                  {auth.auth_mode !== 'none' && (
                    <Button variant="ghost" size="sm" onClick={handleLogout}>
                      <LogOut className="h-3.5 w-3.5" />
                      {t('app.logout')}
                    </Button>
                  )}
                </>
              )}
              <LocaleToggle />
            </div>
          </div>
        </header>

        <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
          {view === 'login' && (
            <LoginView
              auth={auth}
              onSuccess={async (isAdmin) => {
                const nextPath = resolveSafeNextPath(
                  new URLSearchParams(window.location.search).get('next'),
                )
                if (nextPath && nextPath.startsWith('/s/')) {
                  window.location.assign(nextPath)
                  return
                }
                const target = isAdmin
                  ? nextPath || '/admin'
                  : nextPath && nextPath.startsWith('/my')
                    ? nextPath
                    : '/my'
                window.history.pushState({}, '', target)
                await loadAuth()
              }}
              notify={notify}
            />
          )}
          {view === 'admin' && auth?.admin && (
            <AdminConsoleView
              publicUrl={auth?.public_url || window.location.origin}
              notify={notify}
            />
          )}
          {view === 'my' && <UserPortalView auth={auth} notify={notify} />}
        </main>
      </div>
    </LocaleContext.Provider>
  )
}

/* -------------------------------------------------------------------------- */
/* Login View                                                                 */
/* -------------------------------------------------------------------------- */

function LoginView({
  auth,
  onSuccess,
  notify,
}: {
  auth: AuthMe | null
  onSuccess: (isAdmin: boolean) => void
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useI18n()
  const oidcProviders = auth?.oidc_providers ?? []
  const allowLocalUser = auth?.allow_local_user_login ?? auth?.auth_mode !== 'oidc'
  const hasAdminToken = auth?.admin_token_configured ?? auth?.auth_mode === 'token'
  const defaultAdminEmail = auth?.default_admin_email || 'admin@example.com'

  const [mode, setMode] = useState<'admin' | 'user'>(() =>
    hasAdminToken ? 'admin' : 'user',
  )
  const [email, setEmail] = useState(() => (hasAdminToken ? defaultAdminEmail : ''))
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!allowLocalUser && hasAdminToken && mode !== 'admin') {
      setMode('admin')
      setEmail(defaultAdminEmail)
    } else if (allowLocalUser && !hasAdminToken && mode !== 'user') {
      setMode('user')
      setEmail('')
    }
  }, [allowLocalUser, hasAdminToken, mode, defaultAdminEmail])

  const searchParams = new URLSearchParams(window.location.search)
  const urlError = searchParams.get('error')
  const nextPath = resolveSafeNextPath(searchParams.get('next'))

  const errorBannerText =
    urlError === 'disabled'
      ? t('login.disabledBanner')
      : urlError === 'domain_not_allowed'
        ? t('login.domainNotAllowedBanner')
        : urlError === 'oidc_no_email'
          ? t('login.oidcNoEmailBanner')
          : urlError === 'oidc_provider_disabled'
            ? t('login.oidcDisabledBanner')
            : urlError === 'oidc_failed'
              ? t('login.oidcFailedBanner')
              : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await apiFetch<{ authenticated: boolean; admin: boolean }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email,
          token: mode === 'admin' ? token : undefined,
          password: mode === 'user' ? password : undefined,
          mode,
        }),
      })
      notify(t('login.success'))
      onSuccess(res.admin)
    } catch (err: any) {
      notify(err.message || t('login.failed'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const localForm = (
    <div className="space-y-4">
      {hasAdminToken && allowLocalUser && (
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-950 p-1 border border-zinc-800">
          <button
            type="button"
            onClick={() => {
              setMode('admin')
              setEmail(defaultAdminEmail)
            }}
            className={cn(
              'rounded-md py-1.5 text-xs font-medium transition-colors cursor-pointer',
              mode === 'admin'
                ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200',
            )}
          >
            {t('login.modeAdmin')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('user')
              if (email === defaultAdminEmail) {
                setEmail('')
              }
            }}
            className={cn(
              'rounded-md py-1.5 text-xs font-medium transition-colors cursor-pointer',
              mode === 'user'
                ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200',
            )}
          >
            {t('login.modeUser')}
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label>
            {mode === 'admin' ? t('login.adminEmailLabel') : t('login.userEmailLabel')}
          </Label>
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
          />
        </div>

        {mode === 'admin' ? (
          <div className="space-y-1.5">
            <Label>{t('login.tokenLabel')}</Label>
            <Input
              type="password"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('login.tokenPlaceholder')}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>{t('login.passwordLabel')}</Label>
            <Input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
            />
          </div>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting
            ? t('login.submitting')
            : mode === 'admin'
              ? t('login.submitAdmin')
              : t('login.submitUser')}
        </Button>
      </form>
    </div>
  )

  return (
    <div className="flex min-h-[72vh] items-center justify-center">
      <Card className="w-full max-w-md border-zinc-800/90 bg-zinc-900/80 shadow-2xl">
        <CardHeader>
          <CardTitle className="text-lg">{t('login.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {errorBannerText && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/60 p-3 text-xs text-rose-200 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              <span>{errorBannerText}</span>
            </div>
          )}

          {oidcProviders.length > 0 && (
            <div className="space-y-2.5">
              <div className="text-[11px] font-medium text-zinc-400">
                {t('login.oidcSectionTitle')}
              </div>
              <div className="space-y-2">
                {oidcProviders.map((provider, idx) => (
                  <Button
                    key={provider.slug}
                    type="button"
                    variant={idx === 0 ? 'default' : 'outline'}
                    className="w-full"
                    onClick={() => {
                      const dest = nextPath
                        ? `${provider.login_url}?next=${encodeURIComponent(nextPath)}`
                        : provider.login_url
                      window.location.href = dest
                    }}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {t('login.oidcProviderButton', { name: provider.name })}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {oidcProviders.length > 0 && !allowLocalUser && hasAdminToken ? (
            <details className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
              <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200 select-none">
                {t('login.adminFallbackToggle')}
              </summary>
              <div className="mt-3">{localForm}</div>
            </details>
          ) : allowLocalUser || hasAdminToken ? (
            <>
              {oidcProviders.length > 0 && (
                <div className="relative flex items-center py-0.5">
                  <div className="flex-grow border-t border-zinc-800" />
                  <span className="mx-3 shrink-0 text-[11px] text-zinc-500">
                    {t('login.orLocalDivider')}
                  </span>
                  <div className="flex-grow border-t border-zinc-800" />
                </div>
              )}
              {localForm}
            </>
          ) : oidcProviders.length === 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200">
              {t('login.noMethodsAvailable')}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Admin Console View                                                         */
/* -------------------------------------------------------------------------- */

function AdminConsoleView({
  publicUrl,
  notify,
}: {
  publicUrl: string
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { locale, t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const formatStatus = (status: string) => localizeStatus(locale, status)
  const formatAction = (action: 'start' | 'stop' | 'restart' | 'recreate') =>
    localizeAction(locale, action)

  const [activeTab, setActiveTab] = useState<
    'sandboxes' | 'templates' | 'plugins' | 'llm' | 'users' | 'sso'
  >('sandboxes')

  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [sandboxes, setSandboxes] = useState<SandboxItem[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, SandboxStats>>({})
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [llmProfiles, setLlmProfiles] = useState<LlmProfileItem[]>([])
  const [oidcProviders, setOidcProviders] = useState<OidcProviderItem[]>([])
  const [pluginsData, setPluginsData] = useState<{
    index_url: string
    npm_registry_url: string
    source_type: string
    auto_install_default: string
    items: PluginItem[]
  } | null>(null)
  const [users, setUsers] = useState<UserItem[]>([])
  const [admins, setAdmins] = useState<AdminItem[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Modals state
  const [createSbxOpen, setCreateSbxOpen] = useState(false)
  const [sbxForm, setSbxForm] = useState({
    email: '',
    display_name: '',
    initial_password: '',
    slug: '',
    template: 'agent-os',
    image_repo: 'dsh-sandbox',
    image_tag: 'latest',
    cpu_limit: '2.0',
    memory_limit: '4g',
    llm_profile_id: '',
    init_repo_url: '',
    auto_install_plugins: 'file-manager',
    init_script: '',
    auto_sleep_exempt: false,
  })
  const [creatingSbx, setCreatingSbx] = useState(false)

  // Edit Sandbox Modal
  const [editSbx, setEditSbx] = useState<SandboxItem | null>(null)
  const [editSbxForm, setEditSbxForm] = useState({
    cpu_limit: '2.0',
    memory_limit: '4g',
    image_repo: 'dsh-sandbox',
    image_tag: 'latest',
    llm_profile_id: '',
    auto_sleep_exempt: false,
  })
  const [savingSbx, setSavingSbx] = useState(false)

  // Backup & Restore Modal + Idle Sleep Policy
  const [backupTarget, setBackupTarget] = useState<SandboxItem | null>(null)
  const [sleepPolicy, setSleepPolicy] = useState({
    enabled: false,
    idle_minutes: '240',
  })
  const [savingSleepPolicy, setSavingSleepPolicy] = useState(false)
  const [syncingPlugins, setSyncingPlugins] = useState(false)

  // Delete Sandbox Modal
  const [deleteSbxTarget, setDeleteSbxTarget] = useState<SandboxItem | null>(null)
  const [purgeVolume, setPurgeVolume] = useState(false)

  // Logs Modal
  const [logsTarget, setLogsTarget] = useState<SandboxItem | null>(null)
  const [logsText, setLogsText] = useState('')
  const [loadingLogs, setLoadingLogs] = useState(false)

  // Template Modal (Create / Edit)
  const [tplModalOpen, setTplModalOpen] = useState(false)
  const [editingTpl, setEditingTpl] = useState<TemplateItem | null>(null)
  const [tplForm, setTplForm] = useState({
    key: '',
    name: '',
    description: '',
    image_repo: 'dsh-sandbox',
    image_tag: 'latest',
    default_cpu_limit: '2.0',
    default_memory_limit: '4g',
    auto_install_plugins: 'file-manager',
    init_script: '',
    default_env_json: '{}',
  })
  const [savingTpl, setSavingTpl] = useState(false)

  // LLM Profile Form (Create / Edit)
  const EMPTY_LLM_FORM = {
    name: '',
    api_protocol: 'openai-completions',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    api_key: '',
    context_window: '128000',
    max_tokens: '8192',
    supports_image: false,
    reasoning_effort: '',
    thinking_format: '',
  }
  const [editingLlmId, setEditingLlmId] = useState<string | null>(null)
  const [llmForm, setLlmForm] = useState(EMPTY_LLM_FORM)
  const [pushLlmTarget, setPushLlmTarget] = useState<LlmProfileItem | null>(null)
  const [pushLlmSelectedIds, setPushLlmSelectedIds] = useState<string[]>([])
  const [pushLlmSetDefault, setPushLlmSetDefault] = useState(true)
  const [pushLlmReplaceManaged, setPushLlmReplaceManaged] = useState(false)
  const [pushingLlm, setPushingLlm] = useState(false)
  const [pushLlmResults, setPushLlmResults] = useState<
    Array<{ slug: string; ok: boolean; skipped?: boolean; detail?: string }> | null
  >(null)

  // Admin / User Form
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [newAdminName, setNewAdminName] = useState('')
  const [newUserForm, setNewUserForm] = useState({
    email: '',
    display_name: '',
    password: '',
  })
  const [creatingUser, setCreatingUser] = useState(false)
  const [resetPwTarget, setResetPwTarget] = useState<UserItem | null>(null)
  const [resetPwValue, setResetPwValue] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  // Auth Policy & Multi-OIDC Provider Form
  const EMPTY_OIDC_FORM = {
    slug: '',
    name: '',
    enabled: true,
    issuer_url: '',
    discovery_url: '',
    client_id: '',
    client_secret: '',
    clear_client_secret: false,
    scope: 'openid profile email',
    email_claim: 'email',
    logout_url: '',
    allowed_domains: '',
    allow_admin_login: true,
    sort_order: '100',
  }
  const [allowLocalUserLogin, setAllowLocalUserLogin] = useState(true)
  const [savingAuthPolicy, setSavingAuthPolicy] = useState(false)
  const [editingOidcId, setEditingOidcId] = useState<string | null>(null)
  const [oidcForm, setOidcForm] = useState(EMPTY_OIDC_FORM)
  const [oidcSlugTouched, setOidcSlugTouched] = useState(false)
  const [savingOidc, setSavingOidc] = useState(false)
  const [testingOidc, setTestingOidc] = useState(false)
  const [oidcTestResult, setOidcTestResult] = useState<OidcTestResult | null>(null)

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => chars[b % chars.length]).join('')
  }

  const copyText = async (key: string, text: string) => {
    const ok = await copyTextToClipboard(text)
    if (ok) {
      setCopiedKey(key)
      notify(t('common.copied'))
      setTimeout(() => setCopiedKey(null), 2000)
    } else {
      notify(t('common.copyFailed'), 'error')
    }
  }

  const refreshingLiveRef = useRef(false)

  const refreshLiveStatus = useCallback(async () => {
    if (refreshingLiveRef.current) return
    refreshingLiveRef.current = true
    try {
      const [ov, sbxRes] = await Promise.all([
        apiFetch<OverviewData>('/api/overview'),
        apiFetch<{ items: SandboxItem[] }>('/api/sandboxes?refresh=true'),
      ])
      setOverview(ov)
      setSandboxes(sbxRes.items)
      const nextStats = await fetchRunningStats(sbxRes.items, '/api/sandboxes')
      setStatsMap(nextStats)
    } catch {
      // Background polling errors stay silent to avoid spamming toasts
    } finally {
      refreshingLiveRef.current = false
    }
  }, [])

  const refreshAll = useCallback(async () => {
    try {
      const [ov, sbxRes, tplRes, llmRes, plgRes, usrRes, admRes, oidcRes] = await Promise.all([
        apiFetch<OverviewData>('/api/overview'),
        apiFetch<{ items: SandboxItem[] }>('/api/sandboxes?refresh=true'),
        apiFetch<TemplateItem[]>('/api/templates'),
        apiFetch<LlmProfileItem[]>('/api/llm-profiles'),
        apiFetch<any>('/api/plugins'),
        apiFetch<UserItem[]>('/api/users'),
        apiFetch<AdminItem[]>('/api/admins'),
        apiFetch<OidcProviderItem[]>('/api/oidc-providers'),
      ])
      setOverview(ov)
      setSleepPolicy({
        enabled: Boolean(ov.idle_sleep_enabled),
        idle_minutes: String(ov.idle_sleep_minutes ?? 240),
      })
      setAllowLocalUserLogin(ov.allow_local_user_login ?? ov.manager_auth_mode !== 'oidc')
      setSandboxes(sbxRes.items)
      setTemplates(tplRes)
      setLlmProfiles(llmRes)
      setPluginsData(plgRes)
      setUsers(usrRes)
      setAdmins(admRes)
      setOidcProviders(oidcRes)

      const nextStats = await fetchRunningStats(sbxRes.items, '/api/sandboxes')
      setStatsMap(nextStats)
    } catch (err: any) {
      notify(err.message || tRef.current('admin.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshLiveStatus()
      }
    }, 8000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshLiveStatus()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshLiveStatus])

  // Apply template defaults when selecting a template in Create Sandbox modal
  const applyTemplateToSandboxForm = (tplKey: string, tplList = templates) => {
    const found = tplList.find((t) => t.key === tplKey)
    if (found) {
      setSbxForm((prev) => ({
        ...prev,
        template: found.key,
        image_repo: found.image_repo,
        image_tag: found.image_tag,
        cpu_limit: String(found.default_cpu_limit),
        memory_limit: found.default_memory_limit,
        auto_install_plugins: found.auto_install_plugins || '',
        init_script: found.init_script || '',
      }))
    } else {
      setSbxForm((prev) => ({ ...prev, template: tplKey }))
    }
  }

  const openProvisionModalWithTemplate = (tplKey = 'agent-os') => {
    applyTemplateToSandboxForm(tplKey)
    setCreateSbxOpen(true)
  }

  const handleCreateSandbox = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreatingSbx(true)
    try {
      await apiFetch('/api/sandboxes', {
        method: 'POST',
        body: JSON.stringify({
          email: sbxForm.email.trim(),
          display_name: sbxForm.display_name.trim() || null,
          initial_password: sbxForm.initial_password.trim() || null,
          slug: sbxForm.slug.trim() || null,
          template: sbxForm.template,
          image_repo: sbxForm.image_repo.trim() || null,
          image_tag: sbxForm.image_tag.trim() || null,
          cpu_limit: parseFloat(sbxForm.cpu_limit) || 2.0,
          memory_limit: sbxForm.memory_limit.trim() || '4g',
          llm_profile_id: sbxForm.llm_profile_id || null,
          init_repo_url: sbxForm.init_repo_url.trim() || null,
          auto_install_plugins: sbxForm.auto_install_plugins.trim(),
          init_script: sbxForm.init_script,
          auto_sleep_exempt: sbxForm.auto_sleep_exempt,
        }),
      })
      notify(t('admin.sandboxProvisioned', { email: sbxForm.email }))
      setCreateSbxOpen(false)
      setSbxForm((prev) => ({
        ...prev,
        email: '',
        display_name: '',
        initial_password: '',
        slug: '',
      }))
      await refreshAll()
    } catch (err: any) {
      notify(err.message || t('admin.sandboxCreateFailed'), 'error')
    } finally {
      setCreatingSbx(false)
    }
  }

  const handleSandboxAction = async (
    sbx: SandboxItem,
    action: 'start' | 'stop' | 'restart' | 'recreate',
  ) => {
    const actionLabel = formatAction(action)
    try {
      notify(t('admin.sandboxActionRunning', { slug: sbx.slug, action: actionLabel }))
      await apiFetch(`/api/sandboxes/${sbx.id}/${action}`, { method: 'POST' })
      notify(t('admin.sandboxActionSuccess', { slug: sbx.slug, action: actionLabel }))
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleSaveSandboxSpec = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editSbx) return
    setSavingSbx(true)
    try {
      await apiFetch(`/api/sandboxes/${editSbx.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          cpu_limit: parseFloat(editSbxForm.cpu_limit) || editSbx.cpu_limit,
          memory_limit: editSbxForm.memory_limit.trim() || editSbx.memory_limit,
          image_repo: editSbxForm.image_repo.trim(),
          image_tag: editSbxForm.image_tag.trim(),
          llm_profile_id: editSbxForm.llm_profile_id,
          auto_sleep_exempt: editSbxForm.auto_sleep_exempt,
        }),
      })
      notify(t('admin.sandboxUpdated', { slug: editSbx.slug }))
      setEditSbx(null)
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSavingSbx(false)
    }
  }

  const handleSaveSleepPolicy = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingSleepPolicy(true)
    try {
      const minutes = Math.max(5, parseInt(sleepPolicy.idle_minutes, 10) || 240)
      await apiFetch('/api/policies/idle-sleep', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: sleepPolicy.enabled,
          idle_minutes: minutes,
        }),
      })
      notify(t('admin.sandboxes.sleepPolicySaved'))
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSavingSleepPolicy(false)
    }
  }

  const openPushLlmDialog = (profile: LlmProfileItem) => {
    setPushLlmTarget(profile)
    setPushLlmSelectedIds(
      sandboxes.filter((s) => s.status === 'running').map((s) => s.id),
    )
    setPushLlmSetDefault(true)
    setPushLlmReplaceManaged(false)
    setPushLlmResults(null)
  }

  const handlePushLlm = async () => {
    if (!pushLlmTarget || pushLlmSelectedIds.length === 0) return
    setPushingLlm(true)
    setPushLlmResults(null)
    try {
      notify(
        t('admin.llmPushing', {
          name: pushLlmTarget.name,
          count: pushLlmSelectedIds.length,
        }),
      )
      const res = await apiFetch<{
        synced: number
        skipped: number
        failed: number
        total: number
        results: Array<{ slug: string; ok: boolean; skipped?: boolean; detail?: string }>
      }>(`/api/llm-profiles/${pushLlmTarget.id}/push`, {
        method: 'POST',
        body: JSON.stringify({
          sandbox_ids: pushLlmSelectedIds,
          set_as_default: pushLlmSetDefault,
          replace_managed: pushLlmReplaceManaged,
        }),
      })
      setPushLlmResults(res.results || [])
      notify(
        t('admin.llmPushed', {
          name: pushLlmTarget.name,
          synced: res.synced,
          total: res.total,
        }),
        res.failed > 0 ? 'error' : 'success',
      )
      await refreshAll()
    } catch (err: any) {
      notify(err.message || t('admin.llmPushFailed'), 'error')
    } finally {
      setPushingLlm(false)
    }
  }

  const handleSyncPlugins = async (
    mode: 'market_only' | 'reinstall_builtin' | 'reinstall_selected',
    plugins: string[] = [],
  ) => {
    setSyncingPlugins(true)
    try {
      notify(
        mode === 'market_only'
          ? t('admin.pluginsSyncing')
          : t('admin.pluginsReinstalling'),
      )
      const res = await apiFetch<{ synced: number }>('/api/plugins/sync-sandboxes', {
        method: 'POST',
        body: JSON.stringify({ mode, plugins }),
      })
      notify(
        mode === 'market_only'
          ? t('admin.pluginsSynced', { count: res.synced })
          : t('admin.pluginsReinstalled', { count: res.synced }),
      )
      await refreshAll()
    } catch (err: any) {
      notify(err.message || t('admin.pluginsSyncFailed'), 'error')
    } finally {
      setSyncingPlugins(false)
    }
  }

  const handleConfirmDeleteSandbox = async () => {
    if (!deleteSbxTarget) return
    try {
      await apiFetch(
        `/api/sandboxes/${deleteSbxTarget.id}?purge_volume=${purgeVolume ? 'true' : 'false'}`,
        { method: 'DELETE' },
      )
      notify(t('admin.sandboxDestroyed', { slug: deleteSbxTarget.slug }))
      setDeleteSbxTarget(null)
      setPurgeVolume(false)
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const openLogsModal = async (sbx: SandboxItem) => {
    setLogsTarget(sbx)
    setLoadingLogs(true)
    try {
      const res = await apiFetch<{ logs: string }>(`/api/sandboxes/${sbx.id}/logs?tail=400`)
      const cleaned = (res.logs || '')
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/\u2009/g, ' ')
      setLogsText(cleaned || t('admin.noLogs'))
    } catch (err: any) {
      setLogsText(t('admin.logsLoadFailed', { message: err.message }))
    } finally {
      setLoadingLogs(false)
    }
  }

  const openCreateTemplateModal = () => {
    setEditingTpl(null)
    setTplForm({
      key: '',
      name: '',
      description: '',
      image_repo: overview?.default_image_repo || 'dsh-sandbox',
      image_tag: overview?.default_image_tag || 'latest',
      default_cpu_limit: '2.0',
      default_memory_limit: '4g',
      auto_install_plugins: 'file-manager',
      init_script: '',
      default_env_json: '{}',
    })
    setTplModalOpen(true)
  }

  const openEditTemplateModal = (tpl: TemplateItem) => {
    setEditingTpl(tpl)
    setTplForm({
      key: tpl.key,
      name: tpl.name,
      description: tpl.description || '',
      image_repo: tpl.image_repo,
      image_tag: tpl.image_tag,
      default_cpu_limit: String(tpl.default_cpu_limit),
      default_memory_limit: tpl.default_memory_limit,
      auto_install_plugins: tpl.auto_install_plugins || '',
      init_script: tpl.init_script || '',
      default_env_json: tpl.default_env_json || '{}',
    })
    setTplModalOpen(true)
  }

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingTpl(true)
    try {
      if (editingTpl) {
        await apiFetch(`/api/templates/${editingTpl.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: tplForm.name.trim(),
            description: tplForm.description.trim() || null,
            image_repo: tplForm.image_repo.trim(),
            image_tag: tplForm.image_tag.trim(),
            default_cpu_limit: parseFloat(tplForm.default_cpu_limit) || 2.0,
            default_memory_limit: tplForm.default_memory_limit.trim(),
            auto_install_plugins: tplForm.auto_install_plugins.trim(),
            init_script: tplForm.init_script,
            default_env_json: tplForm.default_env_json.trim() || '{}',
          }),
        })
        notify(t('admin.templateUpdated', { name: tplForm.name }))
      } else {
        await apiFetch('/api/templates', {
          method: 'POST',
          body: JSON.stringify({
            key: tplForm.key.trim(),
            name: tplForm.name.trim(),
            description: tplForm.description.trim() || null,
            image_repo: tplForm.image_repo.trim(),
            image_tag: tplForm.image_tag.trim(),
            default_cpu_limit: parseFloat(tplForm.default_cpu_limit) || 2.0,
            default_memory_limit: tplForm.default_memory_limit.trim(),
            auto_install_plugins: tplForm.auto_install_plugins.trim(),
            init_script: tplForm.init_script,
            default_env_json: tplForm.default_env_json.trim() || '{}',
          }),
        })
        notify(t('admin.templateCreated', { name: tplForm.name }))
      }
      setTplModalOpen(false)
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSavingTpl(false)
    }
  }

  const handleDeleteTemplate = async (tpl: TemplateItem) => {
    if (!window.confirm(t('admin.templateDeleteConfirm', { name: tpl.name, key: tpl.key }))) return
    try {
      await apiFetch(`/api/templates/${tpl.id}`, { method: 'DELETE' })
      notify(t('admin.templateDeleted', { key: tpl.key }))
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleSaveAuthPolicy = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingAuthPolicy(true)
    try {
      await apiFetch('/api/auth/policy', {
        method: 'PUT',
        body: JSON.stringify({ allow_local_user_login: allowLocalUserLogin }),
      })
      notify(t('admin.authPolicy.saved'))
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSavingAuthPolicy(false)
    }
  }

  const resetOidcForm = () => {
    setEditingOidcId(null)
    setOidcForm(EMPTY_OIDC_FORM)
    setOidcSlugTouched(false)
    setOidcTestResult(null)
  }

  const handleTestOidcDiscovery = async (override?: {
    provider_id?: string
    issuer_url?: string
    discovery_url?: string
  }) => {
    setTestingOidc(true)
    if (!override) setOidcTestResult(null)
    try {
      const res = await apiFetch<OidcTestResult>('/api/oidc-providers/test', {
        method: 'POST',
        body: JSON.stringify(
          override ?? {
            provider_id: editingOidcId || undefined,
            issuer_url: oidcForm.issuer_url.trim() || null,
            discovery_url: oidcForm.discovery_url.trim() || null,
          },
        ),
      })
      if (!override) {
        setOidcTestResult(res)
      }
      if (res.ok) {
        notify(
          `${t('admin.oidc.testOk')} (${res.supports_logout ? t('admin.oidc.testLogoutYes') : t('admin.oidc.testLogoutNo')})`,
        )
      } else {
        notify(res.detail || 'Discovery failed', 'error')
      }
    } catch (err: any) {
      if (!override) {
        setOidcTestResult({
          ok: false,
          discovery_url: '',
          supports_logout: false,
          detail: err.message || 'Discovery failed',
        })
      }
      notify(err.message || 'Discovery failed', 'error')
    } finally {
      setTestingOidc(false)
    }
  }

  const handleSaveOidcProvider = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingOidc(true)
    try {
      const sortOrderNum = parseInt(oidcForm.sort_order, 10)
      const normalizedSort = Number.isFinite(sortOrderNum)
        ? Math.max(0, Math.min(10000, sortOrderNum))
        : 100
      if (editingOidcId) {
        await apiFetch(`/api/oidc-providers/${editingOidcId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: oidcForm.name.trim(),
            enabled: oidcForm.enabled,
            issuer_url: oidcForm.issuer_url.trim(),
            discovery_url: oidcForm.discovery_url.trim() || null,
            client_id: oidcForm.client_id.trim(),
            client_secret: oidcForm.client_secret.trim() || null,
            clear_client_secret: oidcForm.clear_client_secret,
            scope: oidcForm.scope.trim() || 'openid profile email',
            email_claim: oidcForm.email_claim.trim() || 'email',
            logout_url: oidcForm.logout_url.trim() || null,
            allowed_domains: oidcForm.allowed_domains.trim() || null,
            allow_admin_login: oidcForm.allow_admin_login,
            sort_order: normalizedSort,
          }),
        })
      } else {
        await apiFetch('/api/oidc-providers', {
          method: 'POST',
          body: JSON.stringify({
            slug: oidcForm.slug.trim().toLowerCase(),
            name: oidcForm.name.trim(),
            enabled: oidcForm.enabled,
            issuer_url: oidcForm.issuer_url.trim(),
            discovery_url: oidcForm.discovery_url.trim() || null,
            client_id: oidcForm.client_id.trim(),
            client_secret: oidcForm.client_secret.trim(),
            scope: oidcForm.scope.trim() || 'openid profile email',
            email_claim: oidcForm.email_claim.trim() || 'email',
            logout_url: oidcForm.logout_url.trim() || null,
            allowed_domains: oidcForm.allowed_domains.trim() || null,
            allow_admin_login: oidcForm.allow_admin_login,
            sort_order: normalizedSort,
          }),
        })
      }
      notify(t('admin.oidc.saved'))
      resetOidcForm()
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSavingOidc(false)
    }
  }

  const handleToggleOidcProvider = async (provider: OidcProviderItem) => {
    try {
      const nextEnabled = !provider.enabled
      await apiFetch(`/api/oidc-providers/${provider.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      notify(
        nextEnabled
          ? t('admin.oidc.toggledOn', { name: provider.name })
          : t('admin.oidc.toggledOff', { name: provider.name }),
      )
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleDeleteOidcProvider = async (provider: OidcProviderItem) => {
    if (
      !window.confirm(
        t('admin.oidc.deleteConfirm', { name: provider.name, slug: provider.slug }),
      )
    ) {
      return
    }
    try {
      await apiFetch(`/api/oidc-providers/${provider.id}`, { method: 'DELETE' })
      if (editingOidcId === provider.id) {
        resetOidcForm()
      }
      notify(t('admin.oidc.deleted', { name: provider.name }))
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const enabledOidcCount = oidcProviders.filter((p) => p.enabled).length
  const effectiveAllowLocalUser =
    overview?.allow_local_user_login ?? overview?.manager_auth_mode !== 'oidc'
  const cleanPublicBase = publicUrl.replace(/\/+$/, '')
  const previewSlug = oidcForm.slug.trim().toLowerCase() || '<slug>'
  const previewRedirectUri = `${cleanPublicBase}/auth/oidc/${previewSlug}/callback`
  const previewPostLogoutUri = `${cleanPublicBase}/login`

  return (
    <div className="space-y-6">
      {/* KPI Metrics Row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-400">{t('admin.kpi.sandboxesTitle')}</p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-emerald-400">
                  {overview?.running_sandboxes ?? 0}
                </span>
                <span className="text-sm text-zinc-500">/ {overview?.total_sandboxes ?? 0}</span>
              </div>
            </div>
            <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-400 border border-emerald-500/20">
              <Box className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-400">{t('admin.kpi.quotaTitle')}</p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-zinc-100">
                  {overview?.allocated_cpus ?? 0}
                </span>
                <span className="text-xs text-zinc-400">{t('admin.kpi.quotaUnit')}</span>
              </div>
            </div>
            <div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-400 border border-indigo-500/20">
              <Cpu className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-zinc-700 transition-colors"
          onClick={() => setActiveTab('templates')}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-400">{t('admin.kpi.templatesTitle')}</p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-zinc-100">
                  {templates.length}
                </span>
                {t('admin.kpi.templatesUnit') && (
                  <span className="text-xs text-zinc-400">{t('admin.kpi.templatesUnit')}</span>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-amber-500/10 p-2.5 text-amber-400 border border-amber-500/20">
              <Layers className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-zinc-700 transition-colors"
          onClick={() => setActiveTab('plugins')}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-400">{t('admin.kpi.pluginsTitle')}</p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-zinc-100">
                  {pluginsData?.items.length ?? 0}
                </span>
                {t('admin.kpi.pluginsUnit') && (
                  <span className="text-xs text-zinc-400">{t('admin.kpi.pluginsUnit')}</span>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-400 border border-violet-500/20">
              <Package className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-zinc-900/90 p-1 border border-zinc-800/90">
          {[
            {
              id: 'sandboxes',
              label: t('admin.tabs.sandboxes'),
              icon: Terminal,
              count: sandboxes.length,
            },
            {
              id: 'templates',
              label: t('admin.tabs.templates'),
              icon: Layers,
              count: templates.length,
            },
            {
              id: 'plugins',
              label: t('admin.tabs.plugins'),
              icon: Package,
              count: pluginsData?.items.length ?? 0,
            },
            { id: 'llm', label: t('admin.tabs.llm'), icon: KeyRound, count: llmProfiles.length },
            { id: 'users', label: t('admin.tabs.users'), icon: Users, count: users.length },
            { id: 'sso', label: t('admin.tabs.sso'), icon: ShieldCheck, count: enabledOidcCount },
          ].map((tab) => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all cursor-pointer',
                  active
                    ? 'bg-zinc-100 text-zinc-950 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.2 text-[10px]',
                    active ? 'bg-zinc-900/15 text-zinc-900' : 'bg-zinc-800 text-zinc-400',
                  )}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
          {activeTab === 'templates' ? (
            <Button size="sm" onClick={openCreateTemplateModal}>
              <Plus className="h-3.5 w-3.5" />
              {t('admin.newTemplateBtn')}
            </Button>
          ) : (
            <Button size="sm" onClick={() => openProvisionModalWithTemplate('agent-os')}>
              <Plus className="h-3.5 w-3.5" />
              {t('admin.provisionSandboxBtn')}
            </Button>
          )}
        </div>
      </div>

      {/* TAB 1: Sandboxes Management */}
      {activeTab === 'sandboxes' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSaveSleepPolicy}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-2.5 text-xs"
          >
            <div className="flex items-center gap-2 text-zinc-200">
              <Moon className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
              <span className="font-medium">{t('admin.sandboxes.sleepPolicyTitle')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sleepPolicy.enabled}
                  onChange={(e) =>
                    setSleepPolicy({ ...sleepPolicy, enabled: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-900 accent-indigo-500"
                />
                <span>{t('admin.sandboxes.sleepEnableLabel')}</span>
              </label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={5}
                  max={43200}
                  className="h-7 w-20 text-xs"
                  value={sleepPolicy.idle_minutes}
                  onChange={(e) =>
                    setSleepPolicy({ ...sleepPolicy, idle_minutes: e.target.value })
                  }
                />
                <span className="text-zinc-400">{t('admin.sandboxes.sleepMinutesUnit')}</span>
              </div>
              <Button type="submit" variant="outline" size="sm" disabled={savingSleepPolicy}>
                {savingSleepPolicy ? t('common.saving') : t('admin.sandboxes.sleepSaveBtn')}
              </Button>
            </div>
          </form>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800/80 bg-zinc-950/60 text-zinc-400">
                    <th className="py-3.5 px-4 font-medium">{t('admin.sandboxes.colWorkspace')}</th>
                    <th className="py-3.5 px-4 font-medium">{t('admin.sandboxes.colTemplate')}</th>
                    <th className="py-3.5 px-4 font-medium">{t('admin.sandboxes.colStatus')}</th>
                    <th className="py-3.5 px-4 font-medium w-52">
                      {t('admin.sandboxes.colResources')}
                    </th>
                    <th className="py-3.5 px-4 font-medium text-right">
                      {t('admin.sandboxes.colActions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {sandboxes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-zinc-500">
                        {t('admin.sandboxes.empty')}
                      </td>
                    </tr>
                  ) : (
                    sandboxes.map((sbx) => {
                      const st = statsMap[sbx.id]
                      return (
                        <tr key={sbx.id} className="hover:bg-zinc-800/25 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-sm text-zinc-100">
                                {sbx.slug}
                              </span>
                              {sbx.llm_profile_name && (
                                <Badge variant="outline" className="text-[10px]">
                                  LLM: {sbx.llm_profile_name}
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 text-zinc-400">
                              {sbx.display_name ? `${sbx.display_name} (${sbx.email})` : sbx.email}
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <Badge variant="secondary">{sbx.template}</Badge>
                              <span className="font-mono text-[11px] text-zinc-400">
                                {sbx.image_repo}:{sbx.image_tag}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px] text-zinc-500">
                              {sbx.cpu_limit} vCPU · {sbx.memory_limit}
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  sbx.status === 'running'
                                    ? 'success'
                                    : sbx.status === 'starting' || sbx.status === 'creating'
                                      ? 'warning'
                                      : 'destructive'
                                }
                              >
                                <span
                                  className={cn(
                                    'h-1.5 w-1.5 rounded-full',
                                    sbx.status === 'running' ? 'bg-emerald-400' : 'bg-rose-400',
                                  )}
                                />
                                {formatStatus(sbx.status)}
                              </Badge>
                              {sbx.auto_sleep_exempt && (
                                <Badge variant="outline" className="text-[10px]">
                                  <Moon className="h-2.5 w-2.5 mr-1" />
                                  {t('admin.sandboxes.keepAliveBadge')}
                                </Badge>
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            {sbx.status === 'running' && st ? (
                              <ResourceUsageBars stats={st} fallbackDiskMb={sbx.disk_usage_mb} />
                            ) : (
                              <div className="space-y-1">
                                <span className="text-zinc-500 text-[11px] block">
                                  {t('admin.sandboxes.notRunning')}
                                </span>
                                {sbx.disk_usage_mb != null && (
                                  <span className="text-zinc-400 text-[11px] font-mono block">
                                    {t('admin.sandboxes.diskCachedLabel', {
                                      size: formatDiskSize(sbx.disk_usage_mb),
                                    })}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="emerald"
                                size="sm"
                                onClick={() => window.open(`/sandboxes/${sbx.id}/open`, '_blank')}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {t('admin.sandboxes.openWorkspace')}
                              </Button>

                              {sbx.status === 'running' ? (
                                <Button
                                  variant="outline"
                                  size="icon"
                                  title={t('admin.sandboxes.stopTooltip')}
                                  onClick={() => handleSandboxAction(sbx, 'stop')}
                                >
                                  <Square className="h-3.5 w-3.5 text-amber-400" />
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="icon"
                                  title={t('admin.sandboxes.startTooltip')}
                                  onClick={() => handleSandboxAction(sbx, 'start')}
                                >
                                  <Play className="h-3.5 w-3.5 text-emerald-400" />
                                </Button>
                              )}

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.restartTooltip')}
                                onClick={() => handleSandboxAction(sbx, 'restart')}
                              >
                                <RotateCw className="h-3.5 w-3.5" />
                              </Button>

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.logsTooltip')}
                                onClick={() => openLogsModal(sbx)}
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </Button>

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.editTooltip')}
                                onClick={() => {
                                  setEditSbx(sbx)
                                  setEditSbxForm({
                                    cpu_limit: String(sbx.cpu_limit),
                                    memory_limit: sbx.memory_limit,
                                    image_repo: sbx.image_repo || 'dsh-sandbox',
                                    image_tag: sbx.image_tag,
                                    llm_profile_id: sbx.llm_profile_id || '',
                                    auto_sleep_exempt: Boolean(sbx.auto_sleep_exempt),
                                  })
                                }}
                              >
                                <Sliders className="h-3.5 w-3.5" />
                              </Button>

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.backupTooltip')}
                                onClick={() => setBackupTarget(sbx)}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.destroyTooltip')}
                                className="hover:border-rose-500/50 hover:text-rose-400"
                                onClick={() => {
                                  setDeleteSbxTarget(sbx)
                                  setPurgeVolume(false)
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 2: Image & Environment Templates Management */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {templates.map((tpl) => (
              <Card key={tpl.id} className="flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <CardTitle>{tpl.name}</CardTitle>
                    <Badge variant="secondary" className="font-mono">
                      {tpl.key}
                    </Badge>
                  </div>
                  {tpl.description && (
                    <p className="text-xs text-zinc-400 mt-1">{tpl.description}</p>
                  )}
                </CardHeader>

                <CardContent className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3">
                    <div>
                      <span className="text-zinc-500 block">{t('admin.templates.imageLabel')}</span>
                      <span className="font-mono text-zinc-200 mt-0.5 block">
                        {tpl.image_repo}:{tpl.image_tag}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">{t('admin.templates.quotaLabel')}</span>
                      <span className="font-mono text-zinc-200 mt-0.5 block">
                        {tpl.default_cpu_limit} vCPU · {tpl.default_memory_limit}
                      </span>
                    </div>
                    <div className="col-span-2 pt-1 border-t border-zinc-800/60">
                      <span className="text-zinc-500 block">
                        {t('admin.templates.pluginsLabel')}
                      </span>
                      <span className="font-mono text-zinc-300 mt-0.5 block">
                        {tpl.auto_install_plugins || t('admin.templates.pluginsNone')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60">
                    <Button
                      variant="emerald"
                      size="sm"
                      onClick={() => openProvisionModalWithTemplate(tpl.key)}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {t('admin.templates.provisionBtn')}
                    </Button>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditTemplateModal(tpl)}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        {t('admin.templates.editBtn')}
                      </Button>
                      {!tpl.is_builtin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="hover:text-rose-400"
                          onClick={() => handleDeleteTemplate(tpl)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {overview && overview.local_images.length > 0 && (
            <details className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-4 text-xs">
              <summary className="cursor-pointer font-medium text-zinc-300 select-none">
                {t('admin.templates.localImagesToggle', { count: overview.local_images.length })}
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {overview.local_images.map((img) => (
                  <div
                    key={img.full_name}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2"
                  >
                    <span className="font-mono font-medium text-zinc-200 truncate">{img.full_name}</span>
                    <Badge variant="outline">{img.size_mb} MB</Badge>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* TAB 3: Self-Hosted Plugin Registry */}
      {activeTab === 'plugins' && pluginsData && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/65 px-5 py-4">
            <h3 className="text-sm font-semibold text-zinc-100">{t('admin.plugins.title')}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={syncingPlugins}
                onClick={() => handleSyncPlugins('market_only')}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', syncingPlugins && 'animate-spin')} />
                {t('admin.plugins.syncBtn')}
              </Button>
              <Button
                variant="emerald"
                size="sm"
                disabled={syncingPlugins}
                onClick={() => handleSyncPlugins('reinstall_builtin')}
              >
                <Package className="h-3.5 w-3.5" />
                {t('admin.plugins.reinstallAllBtn')}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {pluginsData.items.map((plg) => (
              <Card key={plg.slug}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {plg.icon_url ? (
                        <img
                          src={plg.icon_url}
                          alt={plg.slug}
                          className="h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 p-1.5"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
                          <Package className="h-5 w-5 text-indigo-400" />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle>
                            {pickLocalizedText(
                              locale,
                              plg.display_name_zh,
                              plg.display_name_en,
                              plg.slug,
                            )}
                          </CardTitle>
                          <Badge variant="success">v{plg.version}</Badge>
                        </div>
                        <p className="font-mono text-xs text-zinc-400 mt-0.5">{plg.package_name}</p>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <p className="text-zinc-300 leading-relaxed">
                    {pickLocalizedText(locale, plg.description_zh, plg.description_en)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={syncingPlugins}
                      onClick={() => handleSyncPlugins('reinstall_selected', [plg.slug])}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', syncingPlugins && 'animate-spin')} />
                      {t('admin.plugins.reinstallOneBtn')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyText(plg.slug, plg.install_command)}
                    >
                      {copiedKey === plg.slug ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(plg.tarball_url, '_blank')}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t('admin.plugins.downloadTgz')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <details className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-4 text-xs">
            <summary className="cursor-pointer font-medium text-zinc-300 select-none">
              {t('admin.plugins.devDetailsToggle')}
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-zinc-500 block">{t('admin.plugins.indexUrlLabel')}</span>
                  <code className="text-indigo-400 font-mono mt-0.5 block truncate">
                    {pluginsData.index_url}
                  </code>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyText('idx', pluginsData.index_url)}
                >
                  {copiedKey === 'idx' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-zinc-500 block">{t('admin.plugins.npmUrlLabel')}</span>
                  <code className="text-emerald-400 font-mono mt-0.5 block truncate">
                    {pluginsData.npm_registry_url}
                  </code>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyText('npm', pluginsData.npm_registry_url)}
                >
                  {copiedKey === 'npm' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* TAB 4: LLM Profiles */}
      {activeTab === 'llm' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>
                  {editingLlmId ? t('admin.llm.editTitle') : t('admin.llm.addTitle')}
                </CardTitle>
                {editingLlmId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingLlmId(null)
                      setLlmForm(EMPTY_LLM_FORM)
                    }}
                  >
                    {t('admin.llm.cancelEditBtn')}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    const ctxNum = llmForm.context_window.trim()
                      ? Number.parseInt(llmForm.context_window.trim(), 10)
                      : null
                    const maxNum = llmForm.max_tokens.trim()
                      ? Number.parseInt(llmForm.max_tokens.trim(), 10)
                      : null
                    const body: Record<string, unknown> = {
                      name: llmForm.name.trim(),
                      api_protocol: llmForm.api_protocol || 'openai-completions',
                      base_url: llmForm.base_url.trim(),
                      model: llmForm.model.trim(),
                      context_window: Number.isFinite(ctxNum as number) ? ctxNum : null,
                      max_tokens: Number.isFinite(maxNum as number) ? maxNum : null,
                      supports_image: Boolean(llmForm.supports_image),
                      reasoning_effort: llmForm.reasoning_effort || null,
                      thinking_format:
                        (llmForm.api_protocol || 'openai-completions') === 'openai-completions'
                          ? llmForm.thinking_format || null
                          : null,
                    }
                    if (!editingLlmId || llmForm.api_key.trim()) {
                      body.api_key = llmForm.api_key.trim()
                    }
                    if (editingLlmId) {
                      await apiFetch(`/api/llm-profiles/${editingLlmId}`, {
                        method: 'PATCH',
                        body: JSON.stringify(body),
                      })
                    } else {
                      await apiFetch('/api/llm-profiles', {
                        method: 'POST',
                        body: JSON.stringify(body),
                      })
                    }
                    notify(t('admin.llmSaved'))
                    setEditingLlmId(null)
                    setLlmForm(EMPTY_LLM_FORM)
                    await refreshAll()
                  } catch (err: any) {
                    notify(err.message, 'error')
                  }
                }}
                className="space-y-3"
              >
                <div className="space-y-1">
                  <Label>{t('admin.llm.nameLabel')}</Label>
                  <Input
                    required
                    placeholder={t('admin.llm.namePlaceholder')}
                    value={llmForm.name}
                    onChange={(e) => setLlmForm({ ...llmForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('admin.llm.apiProtocolLabel')}</Label>
                  <Select
                    value={llmForm.api_protocol}
                    onChange={(e) => {
                      const nextProto = e.target.value
                      setLlmForm({
                        ...llmForm,
                        api_protocol: nextProto,
                        thinking_format:
                          nextProto === 'openai-completions' ? llmForm.thinking_format : '',
                      })
                    }}
                  >
                    <option value="openai-completions">OpenAI Completions (v1/chat/completions)</option>
                    <option value="openai-responses">OpenAI Responses (v1/responses)</option>
                    <option value="anthropic-messages">Anthropic Messages (v1/messages)</option>
                    <option value="google-generative-ai">Google Generative AI (Gemini)</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{t('admin.llm.baseUrlLabel')}</Label>
                  <Input
                    required
                    value={llmForm.base_url}
                    onChange={(e) => setLlmForm({ ...llmForm, base_url: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('admin.llm.modelLabel')}</Label>
                  <Input
                    required
                    value={llmForm.model}
                    onChange={(e) => setLlmForm({ ...llmForm, model: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('admin.llm.apiKeyLabel')}</Label>
                  <Input
                    type="password"
                    placeholder={editingLlmId ? t('admin.llm.apiKeyEditHint') : 'sk-...'}
                    value={llmForm.api_key}
                    onChange={(e) => setLlmForm({ ...llmForm, api_key: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>{t('admin.llm.contextWindowLabel')}</Label>
                    <Input
                      type="number"
                      min={1024}
                      max={10000000}
                      step={1}
                      placeholder="128000"
                      value={llmForm.context_window}
                      onChange={(e) => setLlmForm({ ...llmForm, context_window: e.target.value })}
                    />
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {['128000', '256000', '1000000'].map((v) => (
                        <button
                          key={v}
                          type="button"
                          className="rounded border border-zinc-700/80 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                          onClick={() => setLlmForm({ ...llmForm, context_window: v })}
                        >
                          {v === '1000000' ? '1M' : `${Number(v) / 1000}K`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>{t('admin.llm.maxTokensLabel')}</Label>
                    <Input
                      type="number"
                      min={128}
                      max={1000000}
                      step={1}
                      placeholder="8192"
                      value={llmForm.max_tokens}
                      onChange={(e) => setLlmForm({ ...llmForm, max_tokens: e.target.value })}
                    />
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {['8192', '16384', '32000', '64000'].map((v) => (
                        <button
                          key={v}
                          type="button"
                          className="rounded border border-zinc-700/80 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                          onClick={() => setLlmForm({ ...llmForm, max_tokens: v })}
                        >
                          {`${Math.round(Number(v) / 1000)}K`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>{t('admin.llm.reasoningEffortLabel')}</Label>
                    <Select
                      value={llmForm.reasoning_effort}
                      onChange={(e) => setLlmForm({ ...llmForm, reasoning_effort: e.target.value })}
                    >
                      <option value="">{t('admin.llm.reasoningAuto')}</option>
                      <option value="off">{t('admin.llm.reasoningOff')}</option>
                      <option value="minimal">{t('admin.llm.reasoningMinimal')}</option>
                      <option value="low">{t('admin.llm.reasoningLow')}</option>
                      <option value="medium">{t('admin.llm.reasoningMedium')}</option>
                      <option value="high">{t('admin.llm.reasoningHigh')}</option>
                      <option value="xhigh">{t('admin.llm.reasoningXhigh')}</option>
                      <option value="max">{t('admin.llm.reasoningMax')}</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{t('admin.llm.thinkingFormatLabel')}</Label>
                    <Select
                      disabled={llmForm.api_protocol !== 'openai-completions'}
                      value={
                        llmForm.api_protocol === 'openai-completions'
                          ? llmForm.thinking_format
                          : ''
                      }
                      onChange={(e) => setLlmForm({ ...llmForm, thinking_format: e.target.value })}
                    >
                      <option value="">
                        {llmForm.api_protocol === 'openai-completions'
                          ? t('admin.llm.thinkingFormatAuto')
                          : t('admin.llm.thinkingFormatCompletionsOnly')}
                      </option>
                      <option value="openai">openai (reasoning_effort)</option>
                      <option value="deepseek">deepseek (thinking)</option>
                      <option value="qwen">qwen (enable_thinking)</option>
                      <option value="openrouter">openrouter</option>
                      <option value="zai">zai</option>
                      <option value="together">together</option>
                      <option value="chat-template">chat-template</option>
                      <option value="qwen-chat-template">qwen-chat-template</option>
                    </Select>
                  </div>
                </div>
                <label className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={llmForm.supports_image}
                    onChange={(e) => setLlmForm({ ...llmForm, supports_image: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-zinc-600"
                  />
                  <span>{t('admin.llm.supportsImageLabel')}</span>
                </label>
                <Button type="submit" className="w-full">
                  <Plus className="h-3.5 w-3.5" />
                  {editingLlmId ? t('admin.llm.updateBtn') : t('admin.llm.saveBtn')}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t('admin.llm.listTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {llmProfiles.length === 0 ? (
                <p className="text-xs text-zinc-500 py-8 text-center">{t('admin.llm.empty')}</p>
              ) : (
                <div className="divide-y divide-zinc-800/70">
                  {llmProfiles.map((p) => {
                    const boundCount = sandboxes.filter((s) => s.llm_profile_id === p.id).length
                    return (
                    <div key={p.id} className="flex items-start justify-between gap-3 py-3 text-xs">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-zinc-100">{p.name}</span>
                          {boundCount > 0 ? (
                            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
                              {t('admin.llm.boundCount', { count: boundCount })}
                            </Badge>
                          ) : null}
                          <Badge variant="outline" className="text-[10px]">
                            {p.api_protocol || 'openai-completions'}
                          </Badge>
                          {p.context_window ? (
                            <Badge variant="outline" className="text-[10px]">
                              {p.context_window >= 1000000
                                ? `${(p.context_window / 1000000).toFixed(p.context_window % 1000000 === 0 ? 0 : 1)}M ctx`
                                : `${Math.round(p.context_window / 1000)}K ctx`}
                            </Badge>
                          ) : null}
                          {p.max_tokens ? (
                            <Badge variant="outline" className="text-[10px]">
                              {`${Math.round(p.max_tokens / 1000)}K out`}
                            </Badge>
                          ) : null}
                          {p.supports_image ? (
                            <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-300">
                              {t('admin.llm.badgeVision')}
                            </Badge>
                          ) : null}
                          {p.reasoning_effort ? (
                            <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-300">
                              {`${t('admin.llm.badgeThinking')}: ${p.reasoning_effort}`}
                            </Badge>
                          ) : null}
                          <Badge variant="outline" className="text-[10px] text-zinc-400">
                            {p.has_api_key ? t('admin.llm.badgeKeySet') : t('admin.llm.badgeNoKey')}
                          </Badge>
                        </div>
                        <div className="font-mono text-zinc-400 truncate">
                          {p.model} · {p.base_url}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={sandboxes.length === 0}
                          onClick={() => openPushLlmDialog(p)}
                        >
                          <Send className="h-3 w-3" />
                          {t('admin.llm.pushBtn')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingLlmId(p.id)
                            setLlmForm({
                              name: p.name,
                              api_protocol: p.api_protocol || 'openai-completions',
                              base_url: p.base_url,
                              model: p.model,
                              api_key: '',
                              context_window: p.context_window ? String(p.context_window) : '',
                              max_tokens: p.max_tokens ? String(p.max_tokens) : '',
                              supports_image: Boolean(p.supports_image),
                              reasoning_effort: p.reasoning_effort || '',
                              thinking_format: p.thinking_format || '',
                            })
                          }}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-400 hover:text-rose-300"
                          onClick={async () => {
                            await apiFetch(`/api/llm-profiles/${p.id}`, { method: 'DELETE' })
                            if (editingLlmId === p.id) {
                              setEditingLlmId(null)
                              setLlmForm(EMPTY_LLM_FORM)
                            }
                            notify(t('admin.llmDeleted'))
                            await refreshAll()
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 5: Users, Admins & Audit Log */}
      {activeTab === 'users' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{t('admin.users.title')}</CardTitle>
                <Badge variant="outline">
                  {enabledOidcCount > 0 && effectiveAllowLocalUser
                    ? t('admin.users.hybridBadge')
                    : enabledOidcCount > 0
                      ? t('admin.users.oidcBadge')
                      : t('admin.users.localBadge')}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  setCreatingUser(true)
                  try {
                    await apiFetch('/api/users', {
                      method: 'POST',
                      body: JSON.stringify({
                        email: newUserForm.email.trim(),
                        display_name: newUserForm.display_name.trim() || null,
                        password: newUserForm.password.trim() || null,
                      }),
                    })
                    notify(t('admin.userAdded', { email: newUserForm.email.trim() }))
                    setNewUserForm({ email: '', display_name: '', password: '' })
                    await refreshAll()
                  } catch (err: any) {
                    notify(err.message, 'error')
                  } finally {
                    setCreatingUser(false)
                  }
                }}
                className="grid grid-cols-1 gap-2 sm:grid-cols-12"
              >
                <div className="sm:col-span-4">
                  <Input
                    type="email"
                    required
                    placeholder={t('admin.users.emailPlaceholder')}
                    value={newUserForm.email}
                    onChange={(e) =>
                      setNewUserForm({ ...newUserForm, email: e.target.value })
                    }
                  />
                </div>
                <div className="sm:col-span-3">
                  <Input
                    placeholder={t('admin.users.namePlaceholder')}
                    value={newUserForm.display_name}
                    onChange={(e) =>
                      setNewUserForm({ ...newUserForm, display_name: e.target.value })
                    }
                  />
                </div>
                <div className="sm:col-span-3 flex gap-1.5">
                  <Input
                    type="text"
                    required={effectiveAllowLocalUser && enabledOidcCount === 0}
                    minLength={6}
                    placeholder={
                      enabledOidcCount > 0 || !effectiveAllowLocalUser
                        ? t('admin.users.pwPlaceholderOidc')
                        : t('admin.users.pwPlaceholderLocal')
                    }
                    value={newUserForm.password}
                    onChange={(e) =>
                      setNewUserForm({ ...newUserForm, password: e.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewUserForm({
                        ...newUserForm,
                        password: generatePassword(),
                      })
                    }
                    title={t('admin.users.pwGenTitle')}
                  >
                    {t('admin.users.pwGenShort')}
                  </Button>
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <Button type="submit" size="sm" className="w-full" disabled={creatingUser}>
                    <Plus className="h-3.5 w-3.5" />
                    {t('admin.users.addBtn')}
                  </Button>
                </div>
              </form>

              {users.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  {t('admin.users.empty')}
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/70 text-xs">
                  {users.map((u) => (
                    <div
                      key={u.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-zinc-200">{u.email}</span>
                        {u.display_name && (
                          <span className="text-zinc-400">({u.display_name})</span>
                        )}
                        <Badge variant={u.status === 'active' ? 'success' : 'warning'}>
                          {u.status === 'active' ? t('common.active') : t('common.disabled')}
                        </Badge>
                        {enabledOidcCount > 0 ? (
                          u.has_password ? (
                            <Badge variant="secondary">{t('admin.users.oidcPlusPw')}</Badge>
                          ) : null
                        ) : effectiveAllowLocalUser && !u.has_password ? (
                          <Badge variant="warning">{t('admin.users.pwUnset')}</Badge>
                        ) : null}
                        <Badge variant="outline">
                          {t('admin.users.sandboxCount', { count: u.sandbox_count })}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setResetPwTarget(u)
                            setResetPwValue('')
                          }}
                        >
                          <KeyRound className="h-3 w-3" />
                          {u.has_password ? t('admin.users.resetPw') : t('admin.users.setPw')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const nextStatus = u.status === 'active' ? 'disabled' : 'active'
                            try {
                              await apiFetch(`/api/users/${u.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ status: nextStatus }),
                              })
                              notify(
                                nextStatus === 'active'
                                  ? t('admin.userEnabled', { email: u.email })
                                  : t('admin.userDisabled', { email: u.email }),
                              )
                              await refreshAll()
                            } catch (err: any) {
                              notify(err.message, 'error')
                            }
                          }}
                        >
                          {u.status === 'active'
                            ? t('admin.users.disableBtn')
                            : t('admin.users.enableBtn')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={u.sandbox_count > 0}
                          title={
                            u.sandbox_count > 0
                              ? t('admin.users.deleteDisabledTip')
                              : t('admin.users.deleteTip')
                          }
                          onClick={async () => {
                            try {
                              await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' })
                              notify(t('admin.userDeleted', { email: u.email }))
                              await refreshAll()
                            } catch (err: any) {
                              notify(err.message, 'error')
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('admin.admins.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    await apiFetch('/api/admins', {
                      method: 'POST',
                      body: JSON.stringify({
                        email: newAdminEmail.trim(),
                        display_name: newAdminName.trim() || null,
                      }),
                    })
                    notify(t('admin.adminAdded'))
                    setNewAdminEmail('')
                    setNewAdminName('')
                    await refreshAll()
                  } catch (err: any) {
                    notify(err.message, 'error')
                  }
                }}
                className="flex gap-2"
              >
                <Input
                  type="email"
                  required
                  placeholder={t('admin.admins.emailPlaceholder')}
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                />
                <Input
                  placeholder={t('admin.admins.namePlaceholder')}
                  value={newAdminName}
                  onChange={(e) => setNewAdminName(e.target.value)}
                />
                <Button type="submit" size="sm">
                  {t('admin.admins.addBtn')}
                </Button>
              </form>

              <div className="divide-y divide-zinc-800/70 text-xs">
                {admins.map((a) => (
                  <div key={a.email} className="flex items-center justify-between py-2.5">
                    <div>
                      <span className="font-medium text-zinc-200">{a.email}</span>
                      {a.display_name && (
                        <span className="ml-2 text-zinc-500">({a.display_name})</span>
                      )}
                    </div>
                    <Badge variant={a.active ? 'success' : 'secondary'}>
                      {a.active ? t('common.active') : t('common.inactive')}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('admin.audit.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-80 overflow-y-auto divide-y divide-zinc-800/60 text-xs">
                {overview?.audit_logs.map((log) => (
                  <div key={log.id} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <Badge variant="outline" className="font-mono text-[10px] mr-2">
                        {log.action}
                      </Badge>
                      <span className="text-zinc-300 font-mono">{log.target}</span>
                      {log.detail && (
                        <span className="ml-2 text-zinc-500">({log.detail})</span>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-500 shrink-0">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 6: Auth Policy & Multi-OIDC Providers */}
      {activeTab === 'sso' && (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-4">
              <form
                onSubmit={handleSaveAuthPolicy}
                className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between text-xs"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-indigo-400 shrink-0" />
                    <span className="font-medium text-zinc-100">{t('admin.authPolicy.title')}</span>
                    <Badge
                      variant={overview?.admin_token_configured ? 'success' : 'warning'}
                      className="text-[10px]"
                    >
                      {overview?.admin_token_configured
                        ? t('admin.authPolicy.adminFallbackConfigured')
                        : t('admin.authPolicy.adminFallbackMissing')}
                    </Badge>
                  </div>
                  <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowLocalUserLogin}
                      onChange={(e) => setAllowLocalUserLogin(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-zinc-600 accent-indigo-500"
                    />
                    <span>{t('admin.authPolicy.allowLocalUserLabel')}</span>
                  </label>
                  {!allowLocalUserLogin && enabledOidcCount === 0 && (
                    <p className="text-[11px] text-amber-300">
                      {t('admin.authPolicy.noOidcWarning')}
                    </p>
                  )}
                </div>
                <Button type="submit" size="sm" disabled={savingAuthPolicy} className="shrink-0 self-start lg:self-center">
                  {savingAuthPolicy ? t('common.saving') : t('common.save')}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>
                    {editingOidcId ? t('admin.oidc.editTitle') : t('admin.oidc.addTitle')}
                  </CardTitle>
                  {editingOidcId && (
                    <Button type="button" variant="ghost" size="sm" onClick={resetOidcForm}>
                      {t('admin.llm.cancelEditBtn')}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveOidcProvider} className="space-y-3 text-xs">
                  <div className="space-y-1">
                    <Label>{t('admin.oidc.nameLabel')}</Label>
                    <Input
                      required
                      placeholder={t('admin.oidc.namePlaceholder')}
                      value={oidcForm.name}
                      onChange={(e) => {
                        const nextName = e.target.value
                        setOidcForm((prev) => ({
                          ...prev,
                          name: nextName,
                          slug:
                            !editingOidcId && !oidcSlugTouched
                              ? slugifyOidcName(nextName)
                              : prev.slug,
                        }))
                      }}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>{t('admin.oidc.slugLabel')}</Label>
                    <Input
                      required
                      disabled={!!editingOidcId}
                      pattern="^[a-z0-9][a-z0-9-]{0,62}$"
                      placeholder={t('admin.oidc.slugPlaceholder')}
                      value={oidcForm.slug}
                      onChange={(e) => {
                        setOidcSlugTouched(true)
                        setOidcForm({ ...oidcForm, slug: e.target.value.toLowerCase() })
                      }}
                    />
                  </div>

                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5 space-y-2">
                    <div className="text-[11px] font-medium text-zinc-400">
                      {t('admin.oidc.callbackPreviewTitle')}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-1 text-[10px] text-zinc-500">
                        <span>{t('admin.oidc.redirectUriLabel')}</span>
                        <button
                          type="button"
                          onClick={() => copyText('oidc-redirect-preview', previewRedirectUri)}
                          className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 cursor-pointer"
                        >
                          {copiedKey === 'oidc-redirect-preview' ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{t('common.copied') === '已复制' ? '复制' : 'Copy'}</span>
                        </button>
                      </div>
                      <code className="block truncate rounded bg-zinc-900 px-2 py-1 font-mono text-[10px] text-zinc-200">
                        {previewRedirectUri}
                      </code>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-1 text-[10px] text-zinc-500">
                        <span>{t('admin.oidc.postLogoutUriLabel')}</span>
                        <button
                          type="button"
                          onClick={() => copyText('oidc-logout-preview', previewPostLogoutUri)}
                          className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 cursor-pointer"
                        >
                          {copiedKey === 'oidc-logout-preview' ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{t('common.copied') === '已复制' ? '复制' : 'Copy'}</span>
                        </button>
                      </div>
                      <code className="block truncate rounded bg-zinc-900 px-2 py-1 font-mono text-[10px] text-zinc-200">
                        {previewPostLogoutUri}
                      </code>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label>{t('admin.oidc.issuerLabel')}</Label>
                    <Input
                      placeholder={t('admin.oidc.issuerPlaceholder')}
                      value={oidcForm.issuer_url}
                      onChange={(e) => setOidcForm({ ...oidcForm, issuer_url: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>{t('admin.oidc.clientIdLabel')}</Label>
                    <Input
                      required
                      value={oidcForm.client_id}
                      onChange={(e) => setOidcForm({ ...oidcForm, client_id: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>{t('admin.oidc.clientSecretLabel')}</Label>
                    <Input
                      type="password"
                      placeholder={editingOidcId ? t('admin.oidc.clientSecretEditHint') : ''}
                      value={oidcForm.client_secret}
                      onChange={(e) =>
                        setOidcForm({
                          ...oidcForm,
                          client_secret: e.target.value,
                          clear_client_secret: e.target.value ? false : oidcForm.clear_client_secret,
                        })
                      }
                    />
                    {editingOidcId && (
                      <label className="flex items-center gap-2 pt-1 text-[11px] text-zinc-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={oidcForm.clear_client_secret}
                          onChange={(e) =>
                            setOidcForm({
                              ...oidcForm,
                              clear_client_secret: e.target.checked,
                              client_secret: e.target.checked ? '' : oidcForm.client_secret,
                            })
                          }
                          className="h-3 w-3 rounded border-zinc-600"
                        />
                        <span>{t('admin.oidc.clearSecretLabel')}</span>
                      </label>
                    )}
                  </div>

                  <details className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-2.5">
                    <summary className="cursor-pointer font-medium text-zinc-300 select-none">
                      {t('admin.oidc.advancedToggle')}
                    </summary>
                    <div className="mt-3 space-y-2.5">
                      <div className="space-y-1">
                        <Label>{t('admin.oidc.discoveryUrlLabel')}</Label>
                        <Input
                          placeholder={t('admin.oidc.discoveryUrlPlaceholder')}
                          value={oidcForm.discovery_url}
                          onChange={(e) =>
                            setOidcForm({ ...oidcForm, discovery_url: e.target.value })
                          }
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label>{t('admin.oidc.scopeLabel')}</Label>
                          <Input
                            value={oidcForm.scope}
                            onChange={(e) => setOidcForm({ ...oidcForm, scope: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>{t('admin.oidc.emailClaimLabel')}</Label>
                          <Input
                            value={oidcForm.email_claim}
                            onChange={(e) =>
                              setOidcForm({ ...oidcForm, email_claim: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label>{t('admin.oidc.logoutUrlLabel')}</Label>
                        <Input
                          placeholder="https://idp.example.com/logout"
                          value={oidcForm.logout_url}
                          onChange={(e) =>
                            setOidcForm({ ...oidcForm, logout_url: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>{t('admin.oidc.allowedDomainsLabel')}</Label>
                        <Input
                          placeholder={t('admin.oidc.allowedDomainsPlaceholder')}
                          value={oidcForm.allowed_domains}
                          onChange={(e) =>
                            setOidcForm({ ...oidcForm, allowed_domains: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>{t('admin.oidc.sortOrderLabel')}</Label>
                        <Input
                          type="number"
                          min={0}
                          max={10000}
                          value={oidcForm.sort_order}
                          onChange={(e) =>
                            setOidcForm({ ...oidcForm, sort_order: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  </details>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-zinc-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={oidcForm.enabled}
                        onChange={(e) => setOidcForm({ ...oidcForm, enabled: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-zinc-600 accent-emerald-500"
                      />
                      <span>{t('admin.oidc.enabledLabel')}</span>
                    </label>
                    <label className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-zinc-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={oidcForm.allow_admin_login}
                        onChange={(e) =>
                          setOidcForm({ ...oidcForm, allow_admin_login: e.target.checked })
                        }
                        className="h-3.5 w-3.5 rounded border-zinc-600 accent-indigo-500"
                      />
                      <span>{t('admin.oidc.allowAdminLabel')}</span>
                    </label>
                  </div>

                  {oidcTestResult && (
                    <div
                      className={cn(
                        'rounded-lg border p-2.5 text-[11px] space-y-1',
                        oidcTestResult.ok
                          ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                          : 'border-rose-500/40 bg-rose-950/40 text-rose-200',
                      )}
                    >
                      <div className="font-medium">
                        {oidcTestResult.ok ? t('admin.oidc.testOk') : oidcTestResult.detail}
                      </div>
                      {oidcTestResult.ok && (
                        <div className="text-[10px] opacity-85 space-y-0.5">
                          {oidcTestResult.issuer && (
                            <div className="font-mono truncate">issuer: {oidcTestResult.issuer}</div>
                          )}
                          <div>
                            {oidcTestResult.supports_logout
                              ? t('admin.oidc.testLogoutYes')
                              : t('admin.oidc.testLogoutNo')}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={
                        testingOidc ||
                        (!oidcForm.issuer_url.trim() && !oidcForm.discovery_url.trim())
                      }
                      onClick={() => handleTestOidcDiscovery()}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', testingOidc && 'animate-spin')} />
                      {testingOidc ? t('admin.oidc.testing') : t('admin.oidc.testBtn')}
                    </Button>
                    <Button type="submit" size="sm" className="flex-1" disabled={savingOidc}>
                      <Plus className="h-3.5 w-3.5" />
                      {savingOidc
                        ? t('common.saving')
                        : editingOidcId
                          ? t('admin.oidc.updateBtn')
                          : t('admin.oidc.saveBtn')}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t('admin.oidc.listTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                {oidcProviders.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-10 text-center max-w-md mx-auto leading-relaxed">
                    {t('admin.oidc.empty')}
                  </p>
                ) : (
                  <div className="divide-y divide-zinc-800/70">
                    {oidcProviders.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 py-3.5 text-xs"
                      >
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-zinc-100">{p.name}</span>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {p.slug}
                            </Badge>
                            <Badge
                              variant={p.enabled ? 'success' : 'secondary'}
                              className="text-[10px]"
                            >
                              {p.enabled
                                ? t('admin.oidc.badgeEnabled')
                                : t('admin.oidc.badgeDisabled')}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px]',
                                p.allow_admin_login
                                  ? 'border-indigo-500/40 text-indigo-300'
                                  : 'border-zinc-700 text-zinc-400',
                              )}
                            >
                              {p.allow_admin_login
                                ? t('admin.oidc.badgeAdminAllowed')
                                : t('admin.oidc.badgeUserOnly')}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] text-zinc-400">
                              {p.has_client_secret
                                ? t('admin.oidc.badgeSecretSet')
                                : t('admin.oidc.badgeNoSecret')}
                            </Badge>
                            {p.allowed_domains && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-amber-500/40 text-amber-300"
                              >
                                {t('admin.oidc.badgeDomains', { domains: p.allowed_domains })}
                              </Badge>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-zinc-400 truncate">
                            {p.issuer_url || p.discovery_url} · client_id: {p.client_id}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                            <code className="rounded bg-zinc-900/90 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 truncate max-w-md">
                              {p.redirect_uri}
                            </code>
                            <button
                              type="button"
                              onClick={() => copyText(`oidc-cb-${p.id}`, p.redirect_uri)}
                              className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                            >
                              {copiedKey === `oidc-cb-${p.id}` ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              <span>{t('admin.oidc.copyCallbackBtn')}</span>
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={testingOidc}
                            onClick={() =>
                              handleTestOidcDiscovery({ provider_id: p.id })
                            }
                          >
                            {t('admin.oidc.testShortBtn')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleOidcProvider(p)}
                          >
                            {p.enabled ? t('admin.users.disableBtn') : t('admin.users.enableBtn')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingOidcId(p.id)
                              setOidcSlugTouched(true)
                              setOidcTestResult(null)
                              setOidcForm({
                                slug: p.slug,
                                name: p.name,
                                enabled: p.enabled,
                                issuer_url: p.issuer_url || '',
                                discovery_url: p.discovery_url || '',
                                client_id: p.client_id,
                                client_secret: '',
                                clear_client_secret: false,
                                scope: p.scope || 'openid profile email',
                                email_claim: p.email_claim || 'email',
                                logout_url: p.logout_url || '',
                                allowed_domains: p.allowed_domains || '',
                                allow_admin_login: p.allow_admin_login,
                                sort_order: String(p.sort_order ?? 100),
                              })
                            }}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-400 hover:text-rose-300"
                            onClick={() => handleDeleteOidcProvider(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* DIALOG 1: Provision New Sandbox */}
      <Dialog
        open={createSbxOpen}
        onOpenChange={setCreateSbxOpen}
        title={t('dialog.provision.title')}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreateSandbox} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('dialog.provision.emailLabel')}</Label>
              <Input
                type="email"
                required
                list="existing-users-list"
                placeholder="employee@example.com"
                value={sbxForm.email}
                onChange={(e) => setSbxForm({ ...sbxForm, email: e.target.value })}
              />
              <datalist id="existing-users-list">
                {users.map((u) => (
                  <option key={u.id} value={u.email}>
                    {u.display_name || u.email}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.provision.nameLabel')}</Label>
              <Input
                placeholder={t('dialog.provision.namePlaceholder')}
                value={sbxForm.display_name}
                onChange={(e) => setSbxForm({ ...sbxForm, display_name: e.target.value })}
              />
            </div>

            {effectiveAllowLocalUser && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t('dialog.provision.pwLabel')}</Label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    minLength={6}
                    placeholder={t('dialog.provision.pwPlaceholder')}
                    value={sbxForm.initial_password}
                    onChange={(e) =>
                      setSbxForm({ ...sbxForm, initial_password: e.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSbxForm({ ...sbxForm, initial_password: generatePassword() })
                    }
                  >
                    {t('dialog.provision.pwGenBtn')}
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t('dialog.provision.templateLabel')}</Label>
              <Select
                value={sbxForm.template}
                onChange={(e) => applyTemplateToSandboxForm(e.target.value)}
              >
                {templates.map((tpl) => (
                  <option key={tpl.key} value={tpl.key}>
                    {tpl.name} ({tpl.key})
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t('dialog.provision.llmLabel')}</Label>
              <Select
                value={sbxForm.llm_profile_id}
                onChange={(e) => setSbxForm({ ...sbxForm, llm_profile_id: e.target.value })}
              >
                <option value="">{t('dialog.provision.llmNone')}</option>
                {llmProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.model})
                  </option>
                ))}
              </Select>
            </div>

            <details className="sm:col-span-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
              <summary className="cursor-pointer font-medium text-zinc-300 select-none">
                {t('dialog.provision.advancedToggle')}
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.slugLabel')}</Label>
                  <Input
                    placeholder={t('dialog.provision.slugPlaceholder')}
                    value={sbxForm.slug}
                    onChange={(e) => setSbxForm({ ...sbxForm, slug: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.pluginsLabel')}</Label>
                  <Input
                    placeholder="file-manager"
                    value={sbxForm.auto_install_plugins}
                    onChange={(e) =>
                      setSbxForm({ ...sbxForm, auto_install_plugins: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.repoLabel')}</Label>
                  <Input
                    value={sbxForm.image_repo}
                    onChange={(e) => setSbxForm({ ...sbxForm, image_repo: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.tagLabel')}</Label>
                  <Input
                    value={sbxForm.image_tag}
                    onChange={(e) => setSbxForm({ ...sbxForm, image_tag: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.cpuLabel')}</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="64"
                    value={sbxForm.cpu_limit}
                    onChange={(e) => setSbxForm({ ...sbxForm, cpu_limit: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.memLabel')}</Label>
                  <Input
                    value={sbxForm.memory_limit}
                    onChange={(e) => setSbxForm({ ...sbxForm, memory_limit: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t('dialog.provision.repoUrlLabel')}</Label>
                  <Input
                    placeholder="https://github.com/org/repo.git"
                    value={sbxForm.init_repo_url}
                    onChange={(e) => setSbxForm({ ...sbxForm, init_repo_url: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t('dialog.provision.initScriptLabel')}</Label>
                  <Textarea
                    rows={3}
                    placeholder="#!/usr/bin/env bash"
                    value={sbxForm.init_script}
                    onChange={(e) => setSbxForm({ ...sbxForm, init_script: e.target.value })}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sbxForm.auto_sleep_exempt}
                      onChange={(e) =>
                        setSbxForm({ ...sbxForm, auto_sleep_exempt: e.target.checked })
                      }
                      className="rounded border-zinc-700 bg-zinc-900 accent-indigo-500"
                    />
                    <span>{t('dialog.provision.autoSleepExemptLabel')}</span>
                  </label>
                </div>
              </div>
            </details>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setCreateSbxOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={creatingSbx}>
              {creatingSbx ? t('dialog.provision.submitting') : t('dialog.provision.submit')}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 2: Create / Edit Sandbox Template */}
      <Dialog
        open={tplModalOpen}
        onOpenChange={setTplModalOpen}
        title={
          editingTpl
            ? t('dialog.template.editTitle', { name: editingTpl.name })
            : t('dialog.template.createTitle')
        }
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveTemplate} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('dialog.template.keyLabel')}</Label>
              <Input
                required
                disabled={!!editingTpl}
                placeholder={t('dialog.template.keyPlaceholder')}
                value={tplForm.key}
                onChange={(e) => setTplForm({ ...tplForm, key: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.template.nameLabel')}</Label>
              <Input
                required
                placeholder={t('dialog.template.namePlaceholder')}
                value={tplForm.name}
                onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('dialog.template.descLabel')}</Label>
              <Input
                placeholder={t('dialog.template.descPlaceholder')}
                value={tplForm.description}
                onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })}
              />
            </div>

            {overview && overview.local_images.length > 0 && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t('dialog.template.localPickLabel')}</Label>
                <Select
                  value={`${tplForm.image_repo}:${tplForm.image_tag}`}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val.includes(':')) {
                      const [r, tag] = val.split(':')
                      setTplForm({ ...tplForm, image_repo: r, image_tag: tag })
                    }
                  }}
                >
                  {overview.local_images.map((img) => (
                    <option key={img.full_name} value={img.full_name}>
                      {img.full_name} ({img.size_mb} MB)
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t('dialog.template.repoLabel')}</Label>
              <Input
                required
                value={tplForm.image_repo}
                onChange={(e) => setTplForm({ ...tplForm, image_repo: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.template.tagLabel')}</Label>
              <Input
                required
                value={tplForm.image_tag}
                onChange={(e) => setTplForm({ ...tplForm, image_tag: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('dialog.template.cpuLabel')}</Label>
              <Input
                type="number"
                step="0.5"
                min="0.5"
                max="64"
                value={tplForm.default_cpu_limit}
                onChange={(e) => setTplForm({ ...tplForm, default_cpu_limit: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.template.memLabel')}</Label>
              <Input
                value={tplForm.default_memory_limit}
                onChange={(e) =>
                  setTplForm({ ...tplForm, default_memory_limit: e.target.value })
                }
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('dialog.template.pluginsLabel')}</Label>
              <Input
                value={tplForm.auto_install_plugins}
                onChange={(e) =>
                  setTplForm({ ...tplForm, auto_install_plugins: e.target.value })
                }
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('dialog.template.initScriptLabel')}</Label>
              <Textarea
                rows={4}
                placeholder="#!/usr/bin/env bash"
                value={tplForm.init_script}
                onChange={(e) => setTplForm({ ...tplForm, init_script: e.target.value })}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('dialog.template.envJsonLabel')}</Label>
              <Textarea
                rows={2}
                value={tplForm.default_env_json}
                onChange={(e) => setTplForm({ ...tplForm, default_env_json: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setTplModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingTpl}>
              {savingTpl ? t('common.saving') : t('dialog.template.submit')}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 3.5: Push LLM Profile to Sandboxes */}
      <Dialog
        open={!!pushLlmTarget}
        onOpenChange={(o) => !o && !pushingLlm && setPushLlmTarget(null)}
        title={t('dialog.pushLlm.title', { name: pushLlmTarget?.name ?? '' })}
        description={t('dialog.pushLlm.desc')}
      >
        {pushLlmTarget && (
          <div className="space-y-4 text-xs">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-zinc-100">{pushLlmTarget.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {pushLlmTarget.api_protocol || 'openai-completions'}
                </Badge>
                <Badge variant="outline" className="text-[10px] text-zinc-400">
                  {pushLlmTarget.has_api_key ? t('admin.llm.badgeKeySet') : t('admin.llm.badgeNoKey')}
                </Badge>
              </div>
              <div className="font-mono text-[11px] text-zinc-400 truncate">
                {pushLlmTarget.model} · {pushLlmTarget.base_url}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{t('dialog.pushLlm.targetsLabel')}</Label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="rounded border border-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                    onClick={() =>
                      setPushLlmSelectedIds(
                        sandboxes.filter((s) => s.status === 'running').map((s) => s.id),
                      )
                    }
                  >
                    {t('dialog.pushLlm.selectRunning', {
                      count: sandboxes.filter((s) => s.status === 'running').length,
                    })}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                    onClick={() => setPushLlmSelectedIds([])}
                  >
                    {t('dialog.pushLlm.clearAll')}
                  </button>
                </div>
              </div>

              {sandboxes.length === 0 ? (
                <p className="text-zinc-500 py-4 text-center">{t('dialog.pushLlm.noSandboxes')}</p>
              ) : (
                <div className="max-h-56 overflow-y-auto divide-y divide-zinc-800/70 rounded-md border border-zinc-800 bg-zinc-950/60">
                  {sandboxes.map((sbx) => {
                    const isRunning = sbx.status === 'running'
                    const checked = pushLlmSelectedIds.includes(sbx.id)
                    return (
                      <label
                        key={sbx.id}
                        className={cn(
                          'flex items-center justify-between gap-3 px-3 py-2',
                          isRunning ? 'cursor-pointer hover:bg-zinc-900/70' : 'opacity-55 cursor-not-allowed',
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            disabled={!isRunning || pushingLlm}
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPushLlmSelectedIds((prev) =>
                                  prev.includes(sbx.id) ? prev : [...prev, sbx.id],
                                )
                              } else {
                                setPushLlmSelectedIds((prev) => prev.filter((id) => id !== sbx.id))
                              }
                            }}
                            className="h-3.5 w-3.5 rounded border-zinc-600 accent-indigo-500"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 rounded-full shrink-0',
                                  isRunning ? 'bg-emerald-400' : 'bg-zinc-500',
                                )}
                              />
                              <span className="font-mono font-medium text-zinc-100">{sbx.slug}</span>
                              {sbx.display_name ? (
                                <span className="text-zinc-400 truncate">({sbx.display_name})</span>
                              ) : null}
                            </div>
                            <div className="text-[11px] text-zinc-500 truncate">
                              {isRunning
                                ? sbx.llm_profile_name
                                  ? t('dialog.pushLlm.currentModel', { name: sbx.llm_profile_name })
                                  : sbx.email
                                : t('dialog.pushLlm.stoppedSkip')}
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] shrink-0',
                            isRunning
                              ? 'border-emerald-500/40 text-emerald-300'
                              : 'border-zinc-700 text-zinc-500',
                          )}
                        >
                          {localizeStatus(locale, sbx.status)}
                        </Badge>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={pushingLlm}
                  checked={pushLlmSetDefault}
                  onChange={(e) => setPushLlmSetDefault(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-600 accent-indigo-500"
                />
                <span>{t('dialog.pushLlm.setDefaultLabel')}</span>
              </label>
              <label className="flex items-center gap-2 text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={pushingLlm}
                  checked={pushLlmReplaceManaged}
                  onChange={(e) => setPushLlmReplaceManaged(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-600 accent-indigo-500"
                />
                <span>{t('dialog.pushLlm.replaceManagedLabel')}</span>
              </label>
            </div>

            {pushLlmResults && pushLlmResults.length > 0 && (
              <div className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-900/50 p-2.5">
                <div className="text-[11px] font-medium text-zinc-300">
                  {t('dialog.pushLlm.resultTitle')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pushLlmResults.map((r) => (
                    <Badge
                      key={r.slug}
                      variant="outline"
                      className={cn(
                        'text-[10px] font-mono',
                        r.ok
                          ? 'border-emerald-500/40 text-emerald-300'
                          : r.skipped
                            ? 'border-amber-500/40 text-amber-300'
                            : 'border-rose-500/40 text-rose-300',
                      )}
                      title={r.detail || ''}
                    >
                      {r.slug} {r.ok ? '✓' : r.skipped ? '—' : '✕'}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <Button
                type="button"
                variant="ghost"
                disabled={pushingLlm}
                onClick={() => setPushLlmTarget(null)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                disabled={pushingLlm || pushLlmSelectedIds.length === 0}
                onClick={handlePushLlm}
              >
                <Send className="h-3.5 w-3.5" />
                {pushingLlm
                  ? t('dialog.pushLlm.submitting')
                  : t('dialog.pushLlm.submit', { count: pushLlmSelectedIds.length })}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* DIALOG 3: Edit Sandbox Spec / Image / LLM */}
      <Dialog
        open={!!editSbx}
        onOpenChange={(o) => !o && setEditSbx(null)}
        title={t('dialog.editSandbox.title', { slug: editSbx?.slug ?? '' })}
      >
        <form onSubmit={handleSaveSandboxSpec} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('dialog.editSandbox.cpuLabel')}</Label>
              <Input
                type="number"
                step="0.5"
                value={editSbxForm.cpu_limit}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, cpu_limit: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.editSandbox.memLabel')}</Label>
              <Input
                value={editSbxForm.memory_limit}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, memory_limit: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.editSandbox.repoLabel')}</Label>
              <Input
                value={editSbxForm.image_repo}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, image_repo: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.editSandbox.tagLabel')}</Label>
              <Input
                value={editSbxForm.image_tag}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, image_tag: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>{t('dialog.editSandbox.llmLabel')}</Label>
              <Select
                value={editSbxForm.llm_profile_id}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, llm_profile_id: e.target.value })
                }
              >
                <option value="">{t('dialog.editSandbox.llmNone')}</option>
                {llmProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.model})
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2 pt-1">
              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editSbxForm.auto_sleep_exempt}
                  onChange={(e) =>
                    setEditSbxForm({ ...editSbxForm, auto_sleep_exempt: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-900 accent-indigo-500"
                />
                <span>{t('dialog.editSandbox.autoSleepExemptLabel')}</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setEditSbx(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingSbx}>
              {savingSbx ? t('dialog.editSandbox.submitting') : t('dialog.editSandbox.submit')}
            </Button>
          </div>
        </form>
      </Dialog>

      <BackupRestoreDialog
        sandbox={backupTarget}
        isAdmin={true}
        onClose={() => setBackupTarget(null)}
        notify={notify}
        onRestored={refreshAll}
      />

      {/* DIALOG 4: Container Logs */}
      <Dialog
        open={!!logsTarget}
        onOpenChange={(o) => !o && setLogsTarget(null)}
        title={t('dialog.logs.title', { slug: logsTarget?.slug ?? '' })}
        maxWidth="max-w-4xl"
      >
        <div className="space-y-3">
          <div className="flex justify-end items-center">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => logsTarget && openLogsModal(logsTarget)}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loadingLogs && 'animate-spin')} />
                {t('dialog.logs.refresh')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyText('logs', logsText)}
              >
                <Copy className="h-3.5 w-3.5" />
                {t('dialog.logs.copy')}
              </Button>
            </div>
          </div>
          <pre className="h-96 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-[11px] text-zinc-300 leading-relaxed">
            {loadingLogs ? t('dialog.logs.loading') : logsText}
          </pre>
        </div>
      </Dialog>

      {/* DIALOG 5: Delete Sandbox Confirmation */}
      <Dialog
        open={!!deleteSbxTarget}
        onOpenChange={(o) => !o && setDeleteSbxTarget(null)}
        title={t('dialog.destroy.title', { slug: deleteSbxTarget?.slug ?? '' })}
        description={t('dialog.destroy.owner', { email: deleteSbxTarget?.email ?? '' })}
      >
        <div className="space-y-4 text-xs">
          <label className="flex items-center gap-2.5 rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 text-rose-200 cursor-pointer">
            <input
              type="checkbox"
              checked={purgeVolume}
              onChange={(e) => setPurgeVolume(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700"
            />
            <span>
              {t('dialog.destroy.purgeBefore')}
              <code>{deleteSbxTarget?.volume_name}</code>
              {t('dialog.destroy.purgeAfter')}
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDeleteSbxTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteSandbox}>
              {t('dialog.destroy.confirm')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* DIALOG 6: Reset User Password */}
      <Dialog
        open={!!resetPwTarget}
        onOpenChange={(o) => !o && setResetPwTarget(null)}
        title={t('dialog.resetPw.title', { email: resetPwTarget?.email ?? '' })}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!resetPwTarget) return
            setSavingPw(true)
            try {
              await apiFetch(`/api/users/${resetPwTarget.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ password: resetPwValue.trim() }),
              })
              notify(t('admin.passwordUpdated', { email: resetPwTarget.email }))
              setResetPwTarget(null)
              setResetPwValue('')
              await refreshAll()
            } catch (err: any) {
              notify(err.message, 'error')
            } finally {
              setSavingPw(false)
            }
          }}
          className="space-y-4 text-xs"
        >
          <div className="space-y-1.5">
            <Label>{t('dialog.resetPw.label')}</Label>
            <div className="flex gap-2">
              <Input
                type="text"
                required
                minLength={6}
                placeholder={t('dialog.resetPw.placeholder')}
                value={resetPwValue}
                onChange={(e) => setResetPwValue(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setResetPwValue(generatePassword())}
              >
                {t('dialog.provision.pwGenBtn')}
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setResetPwTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingPw}>
              {savingPw ? t('common.saving') : t('dialog.resetPw.submit')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* User Portal View (/my) — Strictly Admin-Provisioned Only!                  */
/* -------------------------------------------------------------------------- */

function UserPortalView({
  auth,
  notify,
}: {
  auth: AuthMe | null
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { locale, t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  const [sandboxes, setSandboxes] = useState<SandboxItem[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, SandboxStats>>({})
  const [loading, setLoading] = useState(true)
  const refreshingRef = useRef(false)
  const [logsTarget, setLogsTarget] = useState<SandboxItem | null>(null)
  const [logsText, setLogsText] = useState('')
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [backupTarget, setBackupTarget] = useState<SandboxItem | null>(null)
  const [pwModalOpen, setPwModalOpen] = useState(false)
  const [pwForm, setPwForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [savingPw, setSavingPw] = useState(false)

  const openLogsModal = async (sbx: SandboxItem) => {
    setLogsTarget(sbx)
    setLoadingLogs(true)
    try {
      const res = await apiFetch<{ logs: string }>(`/api/sandboxes/${sbx.id}/logs?tail=400`)
      const cleaned = (res.logs || t('admin.noLogs')).replace(
        /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]/g,
        '',
      )
      setLogsText(cleaned)
    } catch (err: any) {
      setLogsText(t('admin.logsLoadFailed', { message: err.message }))
    } finally {
      setLoadingLogs(false)
    }
  }

  const loadMySandboxes = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent)
    if (silent && refreshingRef.current) return
    refreshingRef.current = true
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams(window.location.search)
      const qEmail = params.get('email') || auth?.email || ''
      const res = await apiFetch<{ items: SandboxItem[] }>(
        `/api/my/sandboxes?refresh=true${qEmail ? `&email=${encodeURIComponent(qEmail)}` : ''}`,
      )
      setSandboxes(res.items)
      const nextStats = await fetchRunningStats(res.items, '/api/my/sandboxes')
      setStatsMap(nextStats)
      if (Object.keys(nextStats).length > 0) {
        setSandboxes((prev) =>
          prev.map((item) =>
            nextStats[item.id]?.disk_usage_mb != null
              ? { ...item, disk_usage_mb: nextStats[item.id].disk_usage_mb }
              : item,
          ),
        )
      }
    } catch (err: any) {
      if (!silent) {
        notify(err.message || tRef.current('portal.loadFailed'), 'error')
      }
    } finally {
      refreshingRef.current = false
      if (!silent) setLoading(false)
    }
  }, [auth, notify])

  useEffect(() => {
    void loadMySandboxes()
  }, [loadMySandboxes])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadMySandboxes({ silent: true })
      }
    }, 8000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadMySandboxes({ silent: true })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadMySandboxes])

  const handleAction = async (sbx: SandboxItem, action: 'start' | 'stop' | 'restart') => {
    try {
      notify(t('portal.actionRunning', { action: localizeAction(locale, action) }))
      await apiFetch(`/api/my/sandboxes/${sbx.id}/${action}`, { method: 'POST' })
      notify(t('portal.actionSuccess'))
      await loadMySandboxes()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('portal.bannerTitle')}</h1>
          <p className="text-xs text-zinc-400 mt-1">
            {t('portal.accountPrefix')}
            <span className="text-zinc-200 font-mono">{auth?.email}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!auth?.admin &&
            (auth?.allow_local_user_login ?? auth?.auth_mode !== 'oidc') &&
            (auth?.auth_method !== 'oidc' || auth?.has_password) && (
            <Button variant="outline" size="sm" onClick={() => setPwModalOpen(true)}>
              <KeyRound className="h-3.5 w-3.5" />
              {t('portal.changePwBtn')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void loadMySandboxes()}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('portal.refreshBtn')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-xs text-zinc-500">{t('portal.loadingList')}</div>
      ) : sandboxes.length === 0 ? (
        <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
          <CardContent className="py-14 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/80 text-zinc-400">
              <Lock className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-medium text-zinc-200">{t('portal.emptyTitle')}</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
              {t('portal.emptyBefore')}
              <code className="text-zinc-300">{auth?.default_admin_email || 'admin@example.com'}</code>
              {t('portal.emptyAfter')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {sandboxes.map((sbx) => (
            <Card key={sbx.id} className="border-zinc-800">
              <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-base font-semibold text-zinc-100">
                      {sbx.slug}
                    </span>
                    <Badge variant={sbx.status === 'running' ? 'success' : 'warning'}>
                      {localizeStatus(locale, sbx.status)}
                    </Badge>
                    <Badge variant="secondary">{sbx.template}</Badge>
                  </div>
                  <div className="text-xs text-zinc-400 font-mono">
                    <span>
                      {t('portal.specLabel', {
                        cpu: sbx.cpu_limit,
                        memory: sbx.memory_limit,
                      })}
                      {sbx.disk_usage_mb != null
                        ? t('portal.diskLabel', { disk: formatDiskSize(sbx.disk_usage_mb) })
                        : ''}
                    </span>
                  </div>
                  {sbx.status === 'running' && statsMap[sbx.id] && (
                    <div className="pt-1 max-w-xs">
                      <ResourceUsageBars stats={statsMap[sbx.id]} fallbackDiskMb={sbx.disk_usage_mb} />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="emerald"
                    onClick={() => window.open(`/sandboxes/${sbx.id}/open`, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t('portal.openBtn')}
                  </Button>
                  {sbx.status === 'running' ? (
                    <Button variant="outline" size="sm" onClick={() => handleAction(sbx, 'stop')}>
                      <Square className="h-3.5 w-3.5 text-amber-400" />
                      {t('portal.stopBtn')}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => handleAction(sbx, 'start')}>
                      <Play className="h-3.5 w-3.5 text-emerald-400" />
                      {t('portal.startBtn')}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleAction(sbx, 'restart')}>
                    <RotateCw className="h-3.5 w-3.5" />
                    {t('portal.restartBtn')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openLogsModal(sbx)}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {t('portal.logsBtn')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBackupTarget(sbx)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t('portal.backupBtn')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <BackupRestoreDialog
        sandbox={backupTarget}
        isAdmin={false}
        onClose={() => setBackupTarget(null)}
        notify={notify}
        onRestored={loadMySandboxes}
      />

      {/* User Portal Logs Modal */}
      <Dialog
        open={!!logsTarget}
        onOpenChange={(o) => !o && setLogsTarget(null)}
        title={t('portal.logsTitle', { slug: logsTarget?.slug ?? '' })}
        maxWidth="max-w-4xl"
      >
        <div className="space-y-3">
          <div className="flex justify-end items-center">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => logsTarget && openLogsModal(logsTarget)}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loadingLogs && 'animate-spin')} />
                {t('dialog.logs.refresh')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void copyTextToClipboard(logsText).then((ok) =>
                    notify(ok ? t('portal.logsCopied') : t('common.copyFailed'), ok ? 'success' : 'error')
                  )
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                {t('dialog.logs.copy')}
              </Button>
            </div>
          </div>
          <pre className="h-96 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-all">
            {loadingLogs ? t('dialog.logs.loading') : logsText}
          </pre>
        </div>
      </Dialog>

      {/* Change My Password Modal */}
      <Dialog
        open={pwModalOpen}
        onOpenChange={(o) => !o && setPwModalOpen(false)}
        title={t('portal.pwDialogTitle')}
        description={t('portal.pwDialogDesc', { email: auth?.email ?? '' })}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (pwForm.new_password !== pwForm.confirm_password) {
              notify(t('portal.pwMismatch'), 'error')
              return
            }
            setSavingPw(true)
            try {
              await apiFetch('/api/my/password', {
                method: 'POST',
                body: JSON.stringify({
                  current_password: pwForm.current_password || null,
                  new_password: pwForm.new_password,
                }),
              })
              notify(t('portal.pwChanged'))
              setPwModalOpen(false)
              setPwForm({ current_password: '', new_password: '', confirm_password: '' })
            } catch (err: any) {
              notify(err.message, 'error')
            } finally {
              setSavingPw(false)
            }
          }}
          className="space-y-4 text-xs"
        >
          {auth?.has_password && (
            <div className="space-y-1.5">
              <Label>{t('portal.currentPwLabel')}</Label>
              <Input
                type="password"
                required
                value={pwForm.current_password}
                onChange={(e) =>
                  setPwForm({ ...pwForm, current_password: e.target.value })
                }
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{t('portal.newPwLabel')}</Label>
            <Input
              type="password"
              required
              minLength={6}
              value={pwForm.new_password}
              onChange={(e) =>
                setPwForm({ ...pwForm, new_password: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('portal.confirmPwLabel')}</Label>
            <Input
              type="password"
              required
              minLength={6}
              value={pwForm.confirm_password}
              onChange={(e) =>
                setPwForm({ ...pwForm, confirm_password: e.target.value })
              }
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setPwModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingPw}>
              {savingPw ? t('portal.submitting') : t('portal.pwSubmit')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
