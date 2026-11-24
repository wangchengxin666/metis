import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Moon, RefreshCw, Sun } from 'lucide-react'
import { AppShell } from './components/AppShell'
import { BrandMark, applyDocumentFavicon } from './components/BrandMark'
import { Button, cn } from './components/ui'
import {
  type AppRoute,
  ROUTE_TO_PATH,
  adminSectionFromRoute,
  apiFetch,
  extractProjectIdFromPath,
  isAdminRoute,
  resolveInitialRoute,
  resolveSafeNextPath,
  routeFromAdminSection,
} from './lib/client.ts'
import {
  Locale,
  MessageKey,
  detectInitialLocale,
  persistLocale,
  translate,
} from './lib/i18n.ts'
import { I18nContextValue, LocaleContext, LocaleToggle } from './lib/i18nContext'
import {
  applyBrandTheme,
  getStoredThemeModeOverride,
  mergeBrandTheme,
  setStoredThemeModeOverride,
} from './lib/theme'
import type { AuthMe, WorkspaceInboxData } from './types'
import { LoginView } from './views/LoginView'
import { UserPortalView } from './views/UserPortalView'
import { AdminConsoleView } from './views/admin/AdminConsoleView'
import { AnalyticsView } from './views/workspace/AnalyticsView'
import { InboxView } from './views/workspace/InboxView'
import { ProjectsView } from './views/workspace/ProjectsView'

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale())
  const [auth, setAuth] = useState<AuthMe | null>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const [route, setRoute] = useState<AppRoute>('projects')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    extractProjectIdFromPath(window.location.pathname),
  )
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [modeOverride, setModeOverride] = useState<'dark' | 'light' | null>(() =>
    getStoredThemeModeOverride(),
  )

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

  const brandName =
    locale === 'en'
      ? auth?.brand_name_en || translate(locale, 'app.brandTitle')
      : auth?.brand_name_zh || translate(locale, 'app.brandTitle')

  const effectiveThemeMode = modeOverride || mergeBrandTheme(auth?.brand_theme).mode

  useEffect(() => {
    persistLocale(locale)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
      document.title = brandName || translate(locale, 'app.documentTitle')
    }
  }, [locale, brandName])

  useEffect(() => {
    applyDocumentFavicon(auth?.brand_favicon, auth?.brand_logo_svg)
  }, [auth?.brand_favicon, auth?.brand_logo_svg])

  useEffect(() => {
    applyBrandTheme(auth?.brand_theme, modeOverride)
  }, [auth?.brand_theme, modeOverride])

  const handleToggleThemeMode = () => {
    const next: 'dark' | 'light' = effectiveThemeMode === 'light' ? 'dark' : 'light'
    setModeOverride(next)
    setStoredThemeModeOverride(next)
  }

  const notify = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const loadAuth = useCallback(async () => {
    try {
      const me = await apiFetch<AuthMe>('/api/auth/me')
      setAuth(me)
      const nextRoute = resolveInitialRoute(me, window.location.pathname)
      setRoute(nextRoute)
      setActiveProjectId(extractProjectIdFromPath(window.location.pathname))
    } catch {
      setRoute('login')
    } finally {
      setLoadingAuth(false)
    }
  }, [])

  const handleBrandingUpdated = useCallback(async () => {
    setModeOverride(null)
    setStoredThemeModeOverride(null)
    await loadAuth()
  }, [loadAuth])

  useEffect(() => {
    void loadAuth()
  }, [loadAuth])

  // Browser back/forward synchronization
  useEffect(() => {
    const onPopState = () => {
      if (!auth) return
      setRoute(resolveInitialRoute(auth, window.location.pathname))
      setActiveProjectId(extractProjectIdFromPath(window.location.pathname))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [auth])

  // Keep sidebar pending-approval badge fresh even when browsing other sections
  useEffect(() => {
    if (!auth?.authenticated) return
    let active = true
    const fetchBadge = async () => {
      try {
        const res = await apiFetch<WorkspaceInboxData>('/api/workspace/inbox')
        if (active) {
          setPendingApprovalsCount(
            res.summary.action_required_count ?? res.summary.pending_approvals_count,
          )
        }
      } catch {
        // silent background badge refresh
      }
    }
    void fetchBadge()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchBadge()
    }, 30000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [auth?.authenticated])

  const navigate = useCallback(
    (target: AppRoute) => {
      if (isAdminRoute(target) && !auth?.admin) {
        target = 'projects'
      }
      if (target === 'analytics' && !auth?.admin && !auth?.is_team_lead) {
        target = 'projects'
      }
      if (target === 'projects') {
        setActiveProjectId(null)
      }
      const nextPath = ROUTE_TO_PATH[target] || '/projects'
      if (window.location.pathname !== nextPath) {
        window.history.pushState({}, '', nextPath)
      }
      setRoute(target)
    },
    [auth?.admin, auth?.is_team_lead],
  )

  const handleSelectProjectId = useCallback((projectId: string | null) => {
    setActiveProjectId(projectId)
    const nextPath = projectId ? `/projects/${encodeURIComponent(projectId)}` : '/projects'
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }
  }, [])

  const handleLogout = async () => {
    try {
      const res = await apiFetch<{ ok: boolean; logout_url?: string | null }>('/api/auth/logout', {
        method: 'POST',
      })
      setAuth((prev) =>
        prev ? { ...prev, authenticated: false, email: '', admin: false } : null,
      )
      setPendingApprovalsCount(0)
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

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-400 text-sm">
        <RefreshCw className="h-4 w-4 animate-spin mr-2" /> {t('app.checkingSession')}
      </div>
    )
  }

  const toastNode = toast && (
    <div
      className={cn(
        'fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-[var(--brand-radius-md)] border px-4 py-3 text-sm font-medium shadow-2xl animate-in slide-in-from-bottom-3',
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
  )

  if (route === 'login' || !auth?.authenticated) {
    return (
      <LocaleContext.Provider value={i18nValue}>
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
          {toastNode}
          <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/88 backdrop-blur-md">
            <div className="mx-auto flex h-16 brand-container items-center justify-between px-5 sm:px-8">
              <div className="flex items-center gap-3">
                <BrandMark svg={auth?.brand_logo_svg} name={brandName} className="h-8 w-8" />
                <span className="font-semibold text-base tracking-tight">{brandName}</span>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleToggleThemeMode}
                  title={t('app.themeToggleLabel')}
                  aria-label={t('app.themeToggleLabel')}
                >
                  {effectiveThemeMode === 'light' ? (
                    <Moon className="h-4 w-4 text-zinc-300" />
                  ) : (
                    <Sun className="h-4 w-4 text-amber-400" />
                  )}
                </Button>
                <LocaleToggle />
              </div>
            </div>
          </header>
          <main className="flex-1 mx-auto w-full brand-container px-5 py-7 sm:px-8">
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
                const target =
                  nextPath && (isAdmin || !nextPath.startsWith('/admin'))
                    ? nextPath
                    : '/projects'
                window.history.pushState({}, '', target)
                await loadAuth()
              }}
              notify={notify}
            />
          </main>
        </div>
      </LocaleContext.Provider>
    )
  }

  return (
    <LocaleContext.Provider value={i18nValue}>
      {toastNode}
      <AppShell
        auth={auth}
        brandName={brandName}
        activeRoute={route}
        onNavigate={navigate}
        pendingApprovalsCount={pendingApprovalsCount}
        effectiveThemeMode={effectiveThemeMode}
        onToggleThemeMode={handleToggleThemeMode}
        onLogout={handleLogout}
      >
        {route === 'projects' && (
          <ProjectsView
            auth={auth}
            notify={notify}
            initialProjectId={activeProjectId}
            onSelectProjectId={handleSelectProjectId}
          />
        )}
        {route === 'inbox' && (
          <InboxView
            auth={auth}
            notify={notify}
            onPendingCountChange={setPendingApprovalsCount}
            onOpenProject={(projectId) => {
              handleSelectProjectId(projectId)
              setRoute('projects')
            }}
          />
        )}
        {route === 'workforce' && (
          <UserPortalView
            auth={auth}
            notify={notify}
            onOpenHiring={() => navigate('projects')}
          />
        )}
        {route === 'analytics' && (auth.admin || auth.is_team_lead) && (
          <AnalyticsView notify={notify} />
        )}
        {isAdminRoute(route) && auth.admin && (
          <AdminConsoleView
            auth={auth}
            publicUrl={auth.public_url || window.location.origin}
            activeSection={adminSectionFromRoute(route)}
            onSelectSection={(sec) => navigate(routeFromAdminSection(sec))}
            notify={notify}
            onBrandingUpdated={handleBrandingUpdated}
          />
        )}
      </AppShell>
    </LocaleContext.Provider>
  )
}
