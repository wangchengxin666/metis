import React, { useState } from 'react'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '../components/ui'
import { apiFetch, resolveSafeNextPath } from '../lib/client.ts'
import { useI18n } from '../lib/i18nContext'
import type { AuthMe } from '../types'

export function LoginView({
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
  const hasAdminLogin = Boolean(
    auth?.admin_token_configured ||
      auth?.admin_password_configured ||
      auth?.auth_mode === 'token',
  )

  const [email, setEmail] = useState('')
  const [secret, setSecret] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
          password: secret,
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t('login.unifiedEmailLabel')}</Label>
        <Input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@company.com"
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          {hasAdminLogin ? t('login.unifiedSecretLabel') : t('login.passwordLabel')}
        </Label>
        <Input
          type="password"
          required
          autoComplete="current-password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={
            hasAdminLogin ? t('login.unifiedSecretPh') : t('login.passwordPlaceholder')
          }
        />
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? t('login.submitting') : t('login.unifiedSubmit')}
      </Button>
    </form>
  )

  return (
    <div className="flex min-h-[72vh] items-center justify-center">
      <Card className="w-full max-w-lg border-zinc-800/90 bg-zinc-900/80 shadow-2xl">
        <CardHeader>
          <CardTitle className="text-xl">{t('login.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {errorBannerText && (
            <div className="rounded-[var(--brand-radius-md)] border border-rose-500/40 bg-rose-950/60 p-3.5 text-sm text-rose-200 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              <span>{errorBannerText}</span>
            </div>
          )}

          {oidcProviders.length > 0 && (
            <div className="space-y-2.5">
              <div className="text-xs font-medium text-zinc-400">
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

          {oidcProviders.length > 0 && !allowLocalUser && hasAdminLogin ? (
            <details className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/50 p-3.5">
              <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-200 select-none">
                {t('login.adminFallbackToggle')}
              </summary>
              <div className="mt-3">{localForm}</div>
            </details>
          ) : allowLocalUser || hasAdminLogin ? (
            <>
              {oidcProviders.length > 0 && (
                <div className="relative flex items-center py-0.5">
                  <div className="flex-grow border-t border-zinc-800" />
                  <span className="mx-3 shrink-0 text-xs text-zinc-500">
                    {t('login.orLocalDivider')}
                  </span>
                  <div className="flex-grow border-t border-zinc-800" />
                </div>
              )}
              {localForm}
            </>
          ) : oidcProviders.length === 0 ? (
            <div className="rounded-[var(--brand-radius-md)] border border-amber-500/30 bg-amber-950/30 p-3.5 text-sm text-amber-200">
              {t('login.noMethodsAvailable')}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
