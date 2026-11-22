import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, LogOut, RefreshCw } from 'lucide-react'
import { BrandMark, applyDocumentFavicon } from './components/BrandMark'
import { Badge, Button, cn } from './components/ui'
import { apiFetch, resolveInitialView, resolveSafeNextPath } from './lib/client.ts'
import {
  Locale,
  MessageKey,
  detectInitialLocale,
  persistLocale,
  translate,
} from './lib/i18n.ts'
import { I18nContextValue, LocaleContext, LocaleToggle } from './lib/i18nContext'
import type { AuthMe } from './types'
import { LoginView } from './views/LoginView'
import { UserPortalView } from './views/UserPortalView'
import { AdminConsoleView } from './views/admin/AdminConsoleView'

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

  const brandName =
    locale === 'en'
      ? auth?.brand_name_en || translate(locale, 'app.brandTitle')
      : auth?.brand_name_zh || translate(locale, 'app.brandTitle')

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
              <BrandMark svg={auth?.brand_logo_svg} name={brandName} />
              <span className="font-semibold text-sm tracking-tight">{brandName}</span>
              {auth?.sandbox_runtime && (
                <Badge variant="outline" className="hidden sm:inline-flex font-mono text-[10px] uppercase">
                  {auth.sandbox_runtime}
                </Badge>
              )}
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
              onBrandingUpdated={loadAuth}
            />
          )}
          {view === 'my' && <UserPortalView auth={auth} notify={notify} />}
        </main>
      </div>
    </LocaleContext.Provider>
  )
}

