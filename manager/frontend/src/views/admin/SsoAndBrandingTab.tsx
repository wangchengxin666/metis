import React, { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Edit3,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { BrandMark, resolveFaviconHref } from '../../components/BrandMark'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  Input,
  Label,
  Select,
  Textarea,
  cn,
} from '../../components/ui'
import { apiFetch, slugifyOidcName } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import {
  DEFAULT_BRAND_THEME,
  THEME_PRESETS,
  applyBrandTheme,
  mergeBrandTheme,
} from '../../lib/theme'
import type { BrandThemeTokens, OidcProviderItem, OidcTestResult, OverviewData } from '../../types'

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

export interface SsoAndBrandingTabProps {
  publicUrl: string
  overview: OverviewData | null
  oidcProviders: OidcProviderItem[]
  copiedKey: string | null
  onCopy: (key: string, text: string) => void
  onRefresh: () => Promise<void>
  onBrandingUpdated?: () => Promise<void> | void
  notify: (msg: string, type?: 'success' | 'error') => void
}

export function SsoAndBrandingTab({
  publicUrl,
  overview,
  oidcProviders,
  copiedKey,
  onCopy,
  onRefresh,
  onBrandingUpdated,
  notify,
}: SsoAndBrandingTabProps) {
  const { locale, t } = useI18n()
  const [brandingForm, setBrandingForm] = useState<{
    brand_name_zh: string
    brand_name_en: string
    brand_logo_svg: string
    brand_favicon: string
    brand_theme: BrandThemeTokens
  }>({
    brand_name_zh: overview?.brand_name_zh || 'Metis',
    brand_name_en: overview?.brand_name_en || 'Metis',
    brand_logo_svg: overview?.brand_logo_svg || '',
    brand_favicon: overview?.brand_favicon || '',
    brand_theme: mergeBrandTheme(overview?.brand_theme),
  })
  const [savingBranding, setSavingBranding] = useState(false)

  const [allowLocalUserLogin, setAllowLocalUserLogin] = useState(
    overview?.allow_local_user_login ?? overview?.manager_auth_mode !== 'oidc',
  )
  const [savingAuthPolicy, setSavingAuthPolicy] = useState(false)

  const [sleepPolicy, setSleepPolicy] = useState({
    enabled: Boolean(overview?.idle_sleep_enabled),
    idle_minutes: String(overview?.idle_sleep_minutes ?? 240),
  })
  const [savingSleepPolicy, setSavingSleepPolicy] = useState(false)

  const [oidcModalOpen, setOidcModalOpen] = useState(false)
  const [editingOidcId, setEditingOidcId] = useState<string | null>(null)
  const [oidcForm, setOidcForm] = useState(EMPTY_OIDC_FORM)
  const [oidcSlugTouched, setOidcSlugTouched] = useState(false)
  const [savingOidc, setSavingOidc] = useState(false)
  const [testingOidc, setTestingOidc] = useState(false)
  const [oidcTestResult, setOidcTestResult] = useState<OidcTestResult | null>(null)

  const overviewThemeKey = JSON.stringify(overview?.brand_theme || null)

  useEffect(() => {
    if (overview) {
      setBrandingForm({
        brand_name_zh: overview.brand_name_zh || 'Metis',
        brand_name_en: overview.brand_name_en || 'Metis',
        brand_logo_svg: overview.brand_logo_svg || '',
        brand_favicon: overview.brand_favicon || '',
        brand_theme: mergeBrandTheme(overview.brand_theme),
      })
      setAllowLocalUserLogin(
        overview.allow_local_user_login ?? overview.manager_auth_mode !== 'oidc',
      )
      setSleepPolicy({
        enabled: Boolean(overview.idle_sleep_enabled),
        idle_minutes: String(overview.idle_sleep_minutes ?? 240),
      })
    }
  }, [
    overview?.brand_name_zh,
    overview?.brand_name_en,
    overview?.brand_logo_svg,
    overview?.brand_favicon,
    overviewThemeKey,
    overview?.allow_local_user_login,
    overview?.manager_auth_mode,
    overview?.idle_sleep_enabled,
    overview?.idle_sleep_minutes,
  ])

  const updateThemeTokens = (patch: Partial<BrandThemeTokens>) => {
    setBrandingForm((prev) => {
      const nextTheme = mergeBrandTheme({ ...prev.brand_theme, ...patch })
      applyBrandTheme(nextTheme, null)
      return { ...prev, brand_theme: nextTheme }
    })
  }

  const enabledOidcCount = oidcProviders.filter((p) => p.enabled).length
  const cleanPublicBase = publicUrl.replace(/\/+$/, '')
  const previewSlug = oidcForm.slug.trim().toLowerCase() || '<slug>'
  const previewRedirectUri = `${cleanPublicBase}/auth/oidc/${previewSlug}/callback`
  const previewPostLogoutUri = `${cleanPublicBase}/login`

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingBranding(true)
    try {
      await apiFetch('/api/branding', {
        method: 'PUT',
        body: JSON.stringify({
          brand_name_zh: brandingForm.brand_name_zh.trim(),
          brand_name_en: brandingForm.brand_name_en.trim(),
          brand_logo_svg: brandingForm.brand_logo_svg.trim(),
          brand_favicon: brandingForm.brand_favicon.trim(),
          brand_theme: brandingForm.brand_theme,
        }),
      })
      notify(t('admin.branding.saved'))
      await onBrandingUpdated?.()
      await onRefresh()
    } catch (err: any) {
      notify(err.message || 'Save failed', 'error')
    } finally {
      setSavingBranding(false)
    }
  }

  const handleUploadSvgFile = (file: File | null, targetField: 'brand_logo_svg' | 'brand_favicon') => {
    if (!file) return
    const isSvg = file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml'
    const reader = new FileReader()
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : ''
      if (value) {
        setBrandingForm((prev) => ({ ...prev, [targetField]: value.trim() }))
      }
    }
    if (isSvg) {
      reader.readAsText(file)
    } else if (targetField === 'brand_favicon') {
      reader.readAsDataURL(file)
    } else {
      notify(t('admin.branding.svgOnlyError'), 'error')
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
      await onRefresh()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSavingAuthPolicy(false)
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
      await onRefresh()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSavingSleepPolicy(false)
    }
  }

  const openAddOidcModal = () => {
    setEditingOidcId(null)
    setOidcForm(EMPTY_OIDC_FORM)
    setOidcSlugTouched(false)
    setOidcTestResult(null)
    setOidcModalOpen(true)
  }

  const openEditOidcModal = (p: OidcProviderItem) => {
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
    setOidcModalOpen(true)
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
      if (!override) setOidcTestResult(res)
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
      setOidcModalOpen(false)
      setEditingOidcId(null)
      setOidcForm(EMPTY_OIDC_FORM)
      await onRefresh()
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
      await onRefresh()
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
      notify(t('admin.oidc.deleted', { name: provider.name }))
      await onRefresh()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Brand & Theme Presets (Compact face, advanced SVG & Tokens collapsed) */}
      <Card>
        <CardContent className="p-5 sm:p-6">
          <form onSubmit={handleSaveBranding} className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-400 shrink-0" />
                <span className="font-semibold text-base text-zinc-100">
                  {t('admin.branding.title')}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-2 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 px-3 py-1.5">
                  <BrandMark
                    svg={brandingForm.brand_logo_svg}
                    name={brandingForm.brand_name_en || 'Metis'}
                    className="h-6 w-6 rounded-md"
                  />
                  <span className="font-medium text-zinc-200 max-w-36 truncate">
                    {brandingForm.brand_name_zh || brandingForm.brand_name_en}
                  </span>
                  <span className="text-zinc-600">|</span>
                  <img
                    src={resolveFaviconHref(
                      brandingForm.brand_favicon,
                      brandingForm.brand_logo_svg,
                    )}
                    alt="favicon preview"
                    className="h-4 w-4 rounded-xs object-contain"
                  />
                </div>
                <Button type="submit" size="sm" disabled={savingBranding} className="shrink-0">
                  {savingBranding ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('admin.branding.zhLabel')}</Label>
                <Input
                  required
                  value={brandingForm.brand_name_zh}
                  onChange={(e) =>
                    setBrandingForm({ ...brandingForm, brand_name_zh: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('admin.branding.enLabel')}</Label>
                <Input
                  required
                  value={brandingForm.brand_name_en}
                  onChange={(e) =>
                    setBrandingForm({ ...brandingForm, brand_name_en: e.target.value })
                  }
                />
              </div>
            </div>

            {/* 5 One-Click Enterprise Theme Presets */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="inline-flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 text-indigo-400" />
                  {t('admin.branding.themePresetLabel')}
                </Label>
                <button
                  type="button"
                  onClick={() => updateThemeTokens(DEFAULT_BRAND_THEME)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  {t('admin.branding.resetDefaultBtn')}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {THEME_PRESETS.map((preset) => {
                  const isMatch =
                    brandingForm.brand_theme.mode === preset.theme.mode &&
                    brandingForm.brand_theme.primary.toLowerCase() ===
                      preset.theme.primary.toLowerCase()
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => updateThemeTokens(preset.theme)}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-[var(--brand-radius-md)] border px-3.5 py-2 text-sm font-medium transition-all cursor-pointer',
                        isMatch
                          ? 'brand-tab-active border-transparent shadow-xs'
                          : 'border-zinc-800 bg-zinc-950/70 text-zinc-200 hover:border-zinc-700',
                      )}
                    >
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-white/30 shrink-0"
                        style={{ backgroundColor: preset.theme.primary }}
                      />
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-white/30 shrink-0 -ml-1.5"
                        style={{ backgroundColor: preset.theme.accent }}
                      />
                      <span>{locale === 'en' ? preset.label_en : preset.label_zh}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Advanced SVG & Fine-Grained Brand Tokens (Collapsed by default!) */}
            <details className="rounded-[var(--brand-radius-md)] border border-zinc-800/80 bg-zinc-950/40 px-4 py-3">
              <summary className="cursor-pointer font-medium text-zinc-300 hover:text-zinc-100 select-none">
                {t('admin.branding.advancedToggle')}
              </summary>

              <div className="mt-4 space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label>{t('admin.branding.logoLabel')}</Label>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-1 rounded-[var(--brand-radius-sm)] border border-zinc-700/80 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 hover:border-indigo-500/60 cursor-pointer">
                          <Upload className="h-3.5 w-3.5" />
                          <span>{t('admin.branding.uploadSvgBtn')}</span>
                          <input
                            type="file"
                            accept=".svg,image/svg+xml"
                            className="hidden"
                            onChange={(e) => {
                              handleUploadSvgFile(e.target.files?.[0] ?? null, 'brand_logo_svg')
                              e.target.value = ''
                            }}
                          />
                        </label>
                        {brandingForm.brand_logo_svg && (
                          <button
                            type="button"
                            onClick={() => setBrandingForm({ ...brandingForm, brand_logo_svg: '' })}
                            className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                          >
                            {t('admin.branding.resetDefaultBtn')}
                          </button>
                        )}
                      </div>
                    </div>
                    <Textarea
                      rows={3}
                      className="font-mono text-xs"
                      placeholder={t('admin.branding.logoPlaceholder')}
                      value={brandingForm.brand_logo_svg}
                      onChange={(e) =>
                        setBrandingForm({ ...brandingForm, brand_logo_svg: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label>{t('admin.branding.faviconLabel')}</Label>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-1 rounded-[var(--brand-radius-sm)] border border-zinc-700/80 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 hover:border-indigo-500/60 cursor-pointer">
                          <Upload className="h-3.5 w-3.5" />
                          <span>{t('admin.branding.uploadIconBtn')}</span>
                          <input
                            type="file"
                            accept=".svg,.png,.ico,.webp,image/svg+xml,image/png,image/x-icon,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              handleUploadSvgFile(e.target.files?.[0] ?? null, 'brand_favicon')
                              e.target.value = ''
                            }}
                          />
                        </label>
                        {brandingForm.brand_logo_svg && (
                          <button
                            type="button"
                            onClick={() =>
                              setBrandingForm({
                                ...brandingForm,
                                brand_favicon: brandingForm.brand_logo_svg,
                              })
                            }
                            className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
                          >
                            {t('admin.branding.sameAsLogoBtn')}
                          </button>
                        )}
                        {brandingForm.brand_favicon && (
                          <button
                            type="button"
                            onClick={() => setBrandingForm({ ...brandingForm, brand_favicon: '' })}
                            className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                          >
                            {t('admin.branding.resetDefaultBtn')}
                          </button>
                        )}
                      </div>
                    </div>
                    <Textarea
                      rows={3}
                      className="font-mono text-xs"
                      placeholder={t('admin.branding.faviconPlaceholder')}
                      value={brandingForm.brand_favicon}
                      onChange={(e) =>
                        setBrandingForm({ ...brandingForm, brand_favicon: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 pt-2 border-t border-zinc-800/70">
                  <div className="space-y-1.5">
                    <Label>{t('admin.branding.themeModeLabel')}</Label>
                    <Select
                      value={brandingForm.brand_theme.mode}
                      onChange={(e) =>
                        updateThemeTokens({ mode: e.target.value as BrandThemeTokens['mode'] })
                      }
                    >
                      <option value="dark">{t('admin.branding.themeModeDark')}</option>
                      <option value="light">{t('admin.branding.themeModeLight')}</option>
                      <option value="slate">{t('admin.branding.themeModeSlate')}</option>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t('admin.branding.themePrimaryLabel')}</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandingForm.brand_theme.primary}
                        onChange={(e) => updateThemeTokens({ primary: e.target.value })}
                        className="h-10 w-12 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950 p-1 cursor-pointer shrink-0"
                      />
                      <Input
                        className="font-mono"
                        value={brandingForm.brand_theme.primary}
                        onChange={(e) => {
                          const val = e.target.value.trim()
                          setBrandingForm((prev) => ({
                            ...prev,
                            brand_theme: { ...prev.brand_theme, primary: val },
                          }))
                          if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                            applyBrandTheme({ ...brandingForm.brand_theme, primary: val }, null)
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t('admin.branding.themeAccentLabel')}</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandingForm.brand_theme.accent}
                        onChange={(e) => updateThemeTokens({ accent: e.target.value })}
                        className="h-10 w-12 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950 p-1 cursor-pointer shrink-0"
                      />
                      <Input
                        className="font-mono"
                        value={brandingForm.brand_theme.accent}
                        onChange={(e) => {
                          const val = e.target.value.trim()
                          setBrandingForm((prev) => ({
                            ...prev,
                            brand_theme: { ...prev.brand_theme, accent: val },
                          }))
                          if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                            applyBrandTheme({ ...brandingForm.brand_theme, accent: val }, null)
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t('admin.branding.themeRadiusLabel')}</Label>
                    <Select
                      value={brandingForm.brand_theme.radius}
                      onChange={(e) =>
                        updateThemeTokens({ radius: e.target.value as BrandThemeTokens['radius'] })
                      }
                    >
                      <option value="sharp">{t('admin.branding.themeRadiusSharp')}</option>
                      <option value="md">{t('admin.branding.themeRadiusMd')}</option>
                      <option value="rounded">{t('admin.branding.themeRadiusRounded')}</option>
                      <option value="pill">{t('admin.branding.themeRadiusPill')}</option>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t('admin.branding.themeFontLabel')}</Label>
                    <Select
                      value={brandingForm.brand_theme.font_scale}
                      onChange={(e) =>
                        updateThemeTokens({
                          font_scale: e.target.value as BrandThemeTokens['font_scale'],
                        })
                      }
                    >
                      <option value="normal">{t('admin.branding.themeFontNormal')}</option>
                      <option value="comfortable">
                        {t('admin.branding.themeFontComfortable')}
                      </option>
                      <option value="large">{t('admin.branding.themeFontLarge')}</option>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t('admin.branding.themeWidthLabel')}</Label>
                    <Select
                      value={brandingForm.brand_theme.layout_width}
                      onChange={(e) =>
                        updateThemeTokens({
                          layout_width: e.target.value as BrandThemeTokens['layout_width'],
                        })
                      }
                    >
                      <option value="standard">{t('admin.branding.themeWidthStandard')}</option>
                      <option value="wide">{t('admin.branding.themeWidthWide')}</option>
                      <option value="full">{t('admin.branding.themeWidthFull')}</option>
                    </Select>
                  </div>
                </div>
              </div>
            </details>
          </form>
        </CardContent>
      </Card>

      {/* 2. Compact 2-Column Platform Policies (Auth Policy + Idle Auto-Sleep Policy) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <form
              onSubmit={handleSaveAuthPolicy}
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-indigo-400 shrink-0" />
                  <span className="font-semibold text-zinc-100">{t('admin.authPolicy.title')}</span>
                  <Badge variant={overview?.admin_token_configured ? 'success' : 'warning'}>
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
                    className="h-4 w-4 rounded border-zinc-600 accent-indigo-500"
                  />
                  <span>{t('admin.authPolicy.allowLocalUserLabel')}</span>
                </label>
                {!allowLocalUserLogin && enabledOidcCount === 0 && (
                  <p className="text-xs text-amber-300">{t('admin.authPolicy.noOidcWarning')}</p>
                )}
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={savingAuthPolicy} className="shrink-0 self-start sm:self-center">
                {savingAuthPolicy ? t('common.saving') : t('common.save')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <form
              onSubmit={handleSaveSleepPolicy}
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Moon className="h-4 w-4 text-indigo-400 shrink-0" />
                  <span className="font-semibold text-zinc-100">
                    {t('admin.sandboxes.sleepPolicyTitle')}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sleepPolicy.enabled}
                      onChange={(e) =>
                        setSleepPolicy({ ...sleepPolicy, enabled: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-zinc-600 accent-indigo-500"
                    />
                    <span>{t('admin.sandboxes.sleepEnableLabel')}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={5}
                      max={43200}
                      className="h-8 w-24 text-sm"
                      value={sleepPolicy.idle_minutes}
                      onChange={(e) =>
                        setSleepPolicy({ ...sleepPolicy, idle_minutes: e.target.value })
                      }
                    />
                    <span className="text-zinc-400">{t('admin.sandboxes.sleepMinutesUnit')}</span>
                  </div>
                </div>
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={savingSleepPolicy} className="shrink-0 self-start sm:self-center">
                {savingSleepPolicy ? t('common.saving') : t('admin.sandboxes.sleepSaveBtn')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* 3. OIDC SSO Providers (Clean List Only — Form Lives in Modal!) */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <span>{t('admin.oidc.listTitle')}</span>
              <Badge variant="outline">{oidcProviders.length}</Badge>
            </CardTitle>
            <Button type="button" size="sm" onClick={openAddOidcModal}>
              <Plus className="h-4 w-4" />
              {t('admin.oidc.addTitle')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {oidcProviders.length === 0 ? (
            <p className="text-sm text-zinc-500 py-10 text-center max-w-lg mx-auto leading-relaxed">
              {t('admin.oidc.empty')}
            </p>
          ) : (
            <div className="divide-y divide-zinc-800/70">
              {oidcProviders.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4 text-sm"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-100">{p.name}</span>
                      <Badge variant="outline" className="font-mono">
                        {p.slug}
                      </Badge>
                      <Badge variant={p.enabled ? 'success' : 'secondary'}>
                        {p.enabled ? t('admin.oidc.badgeEnabled') : t('admin.oidc.badgeDisabled')}
                      </Badge>
                      <Badge variant="outline">
                        {p.allow_admin_login
                          ? t('admin.oidc.badgeAdminAllowed')
                          : t('admin.oidc.badgeUserOnly')}
                      </Badge>
                      {p.allowed_domains && (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                          {t('admin.oidc.badgeDomains', { domains: p.allowed_domains })}
                        </Badge>
                      )}
                    </div>
                    <div className="font-mono text-xs text-zinc-400 truncate">
                      {p.issuer_url || p.discovery_url} · client_id: {p.client_id}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <code className="rounded bg-zinc-950 px-2 py-0.5 font-mono text-zinc-300 truncate max-w-md">
                        {p.redirect_uri}
                      </code>
                      <button
                        type="button"
                        onClick={() => onCopy(`oidc-cb-${p.id}`, p.redirect_uri)}
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 cursor-pointer"
                      >
                        {copiedKey === `oidc-cb-${p.id}` ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>{t('admin.oidc.copyCallbackBtn')}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testingOidc}
                      onClick={() => handleTestOidcDiscovery({ provider_id: p.id })}
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
                    <Button variant="ghost" size="icon" onClick={() => openEditOidcModal(p)}>
                      <Edit3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-rose-400 hover:text-rose-300"
                      onClick={() => handleDeleteOidcProvider(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit OIDC Provider Modal */}
      <Dialog
        open={oidcModalOpen}
        onOpenChange={(o) => !o && !savingOidc && setOidcModalOpen(false)}
        title={editingOidcId ? t('admin.oidc.editTitle') : t('admin.oidc.addTitle')}
      >
        <form onSubmit={handleSaveOidcProvider} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
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
          </div>

          <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 p-3 space-y-2">
            <div className="text-xs font-medium text-zinc-400">
              {t('admin.oidc.callbackPreviewTitle')}
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>{t('admin.oidc.redirectUriLabel')}</span>
                <button
                  type="button"
                  onClick={() => onCopy('oidc-redirect-preview', previewRedirectUri)}
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
              <code className="block truncate rounded bg-zinc-900 px-2.5 py-1 font-mono text-xs text-zinc-200">
                {previewRedirectUri}
              </code>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>{t('admin.oidc.postLogoutUriLabel')}</span>
                <button
                  type="button"
                  onClick={() => onCopy('oidc-logout-preview', previewPostLogoutUri)}
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
              <code className="block truncate rounded bg-zinc-900 px-2.5 py-1 font-mono text-xs text-zinc-200">
                {previewPostLogoutUri}
              </code>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('admin.oidc.issuerLabel')}</Label>
            <Input
              placeholder={t('admin.oidc.issuerPlaceholder')}
              value={oidcForm.issuer_url}
              onChange={(e) => setOidcForm({ ...oidcForm, issuer_url: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('admin.oidc.clientIdLabel')}</Label>
              <Input
                required
                value={oidcForm.client_id}
                onChange={(e) => setOidcForm({ ...oidcForm, client_id: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
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
            </div>
          </div>

          {editingOidcId && (
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
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
                className="h-3.5 w-3.5 rounded border-zinc-600"
              />
              <span>{t('admin.oidc.clearSecretLabel')}</span>
            </label>
          )}

          <details className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/50 p-3">
            <summary className="cursor-pointer font-medium text-zinc-300 select-none">
              {t('admin.oidc.advancedToggle')}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <Label>{t('admin.oidc.discoveryUrlLabel')}</Label>
                <Input
                  placeholder={t('admin.oidc.discoveryUrlPlaceholder')}
                  value={oidcForm.discovery_url}
                  onChange={(e) => setOidcForm({ ...oidcForm, discovery_url: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                    onChange={(e) => setOidcForm({ ...oidcForm, email_claim: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>{t('admin.oidc.logoutUrlLabel')}</Label>
                <Input
                  placeholder="https://idp.example.com/logout"
                  value={oidcForm.logout_url}
                  onChange={(e) => setOidcForm({ ...oidcForm, logout_url: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                    onChange={(e) => setOidcForm({ ...oidcForm, sort_order: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </details>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="flex items-center gap-2 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={oidcForm.enabled}
                onChange={(e) => setOidcForm({ ...oidcForm, enabled: e.target.checked })}
                className="h-4 w-4 rounded border-zinc-600 accent-emerald-500"
              />
              <span>{t('admin.oidc.enabledLabel')}</span>
            </label>
            <label className="flex items-center gap-2 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={oidcForm.allow_admin_login}
                onChange={(e) =>
                  setOidcForm({ ...oidcForm, allow_admin_login: e.target.checked })
                }
                className="h-4 w-4 rounded border-zinc-600 accent-indigo-500"
              />
              <span>{t('admin.oidc.allowAdminLabel')}</span>
            </label>
          </div>

          {oidcTestResult && (
            <div
              className={cn(
                'rounded-[var(--brand-radius-md)] border p-3 text-xs space-y-1',
                oidcTestResult.ok
                  ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                  : 'border-rose-500/40 bg-rose-950/40 text-rose-200',
              )}
            >
              <div className="font-medium">
                {oidcTestResult.ok ? t('admin.oidc.testOk') : oidcTestResult.detail}
              </div>
              {oidcTestResult.ok && (
                <div className="opacity-85 space-y-0.5">
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

          <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-zinc-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                testingOidc || (!oidcForm.issuer_url.trim() && !oidcForm.discovery_url.trim())
              }
              onClick={() => handleTestOidcDiscovery()}
            >
              <RefreshCw className={cn('h-4 w-4', testingOidc && 'animate-spin')} />
              {testingOidc ? t('admin.oidc.testing') : t('admin.oidc.testBtn')}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => setOidcModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={savingOidc}>
                {savingOidc
                  ? t('common.saving')
                  : editingOidcId
                    ? t('admin.oidc.updateBtn')
                    : t('admin.oidc.saveBtn')}
              </Button>
            </div>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
