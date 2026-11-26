import { useState } from 'react'
import { Edit3, Globe, KeyRound, Lock, Plus, RefreshCw, Send, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { PushTargetDialog, type PushTargetSpec } from '../../components/PushTargetDialog'
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
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type {
  CredentialPresetItem,
  CredentialProfileItem,
  SandboxItem,
  TemplateItem,
} from '../../types'

interface EnvRow {
  key: string
  value: string
}

const EMPTY_CRED_FORM = {
  name: '',
  preset_key: '',
  category: 'custom',
  description: '',
  git_user_name: '',
  git_user_email: '',
  git_host: 'github.com',
  github_auth_mode: 'pat' as 'pat' | 'github_app',
  github_api_base_url: '',
  github_app_id: '',
  github_app_installation_id: '',
  github_app_private_key: '',
  github_tls_verify: true,
  git_token: '',
  ssh_private_key: '',
  env_vars_json: '{}',
  mcp_servers_json: '{}',
}

function inferGithubApiHint(rawHost: string): string {
  const cleaned = rawHost.trim().replace(/\/+$/, '')
  if (!cleaned) return 'https://api.github.com'
  const hasScheme = cleaned.startsWith('http://') || cleaned.startsWith('https://')
  const hostOnly = cleaned.replace(/^https?:\/\//, '').split('/')[0].toLowerCase()
  if (hostOnly === 'github.com' || hostOnly === 'api.github.com') return 'https://api.github.com'
  if (hostOnly.endsWith('.ghe.com') && !hostOnly.startsWith('api.')) return `https://api.${hostOnly}`
  const origin = hasScheme ? cleaned : `https://${hostOnly}`
  return `${origin}/api/v3`
}

export interface CredentialVaultSectionProps {
  credentialProfiles: CredentialProfileItem[]
  credentialPresets?: CredentialPresetItem[]
  sandboxes: SandboxItem[]
  templates?: TemplateItem[]
  onRefresh: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}

export function CredentialVaultSection({
  credentialProfiles,
  credentialPresets = [],
  sandboxes,
  templates = [],
  onRefresh,
  notify,
}: CredentialVaultSectionProps) {
  const { t } = useI18n()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [credForm, setCredForm] = useState(EMPTY_CRED_FORM)
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [rawEnvMode, setRawEnvMode] = useState(false)
  const [savingCred, setSavingCred] = useState(false)
  const [seedingPresets, setSeedingPresets] = useState(false)
  const [refreshingAppId, setRefreshingAppId] = useState<string | null>(null)
  const [pushTarget, setPushTarget] = useState<CredentialProfileItem | null>(null)

  const openCreateModal = () => {
    setEditingId(null)
    setCredForm(EMPTY_CRED_FORM)
    setEnvRows([])
    setRawEnvMode(false)
    setModalOpen(true)
  }

  const openFromPreset = (preset: CredentialPresetItem) => {
    const existing = credentialProfiles.find(
      (c) => c.preset_key === preset.preset_key || c.name === preset.name,
    )
    if (existing) {
      openEditModal(existing, preset.suggested_env_keys)
      return
    }
    setEditingId(null)
    setCredForm({
      ...EMPTY_CRED_FORM,
      name: preset.name,
      preset_key: preset.preset_key,
      category: preset.category || 'custom',
      description: preset.description || '',
      git_user_name: preset.git_user_name || '',
      git_user_email: preset.git_user_email || '',
      git_host: preset.git_host || 'github.com',
      github_auth_mode: preset.github_auth_mode === 'github_app' ? 'github_app' : 'pat',
      github_api_base_url: preset.github_api_base_url || '',
      github_tls_verify: preset.github_tls_verify !== false,
    })
    setEnvRows((preset.suggested_env_keys || []).map((k) => ({ key: k, value: '' })))
    setRawEnvMode(false)
    setModalOpen(true)
  }

  const openEditModal = (c: CredentialProfileItem, extraSuggestedKeys: string[] = []) => {
    setEditingId(c.id)
    setCredForm({
      name: c.name,
      preset_key: c.preset_key || '',
      category: c.category || 'custom',
      description: c.description || '',
      git_user_name: c.git_user_name || '',
      git_user_email: c.git_user_email || '',
      git_host: c.git_host || 'github.com',
      github_auth_mode: c.github_auth_mode === 'github_app' ? 'github_app' : 'pat',
      github_api_base_url: c.github_api_base_url || '',
      github_app_id: c.github_app_id || '',
      github_app_installation_id: c.github_app_installation_id || '',
      github_app_private_key: '',
      github_tls_verify: c.github_tls_verify !== false,
      git_token: '',
      ssh_private_key: '',
      env_vars_json: '',
      mcp_servers_json: c.mcp_servers_json || '{}',
    })
    const keys = Array.from(new Set([...(c.env_var_keys || []), ...extraSuggestedKeys]))
    setEnvRows(keys.map((k) => ({ key: k, value: '' })))
    setRawEnvMode(false)
    setModalOpen(true)
  }

  const handleRefreshAppToken = async (c: CredentialProfileItem) => {
    setRefreshingAppId(c.id)
    try {
      const res = await apiFetch<{
        ok: boolean
        expires_at?: string | null
        pushed?: { synced?: number } | null
      }>(`/api/credential-profiles/${c.id}/refresh-github-app`, {
        method: 'POST',
        body: JSON.stringify({ push_to_bound: true }),
      })
      notify(
        t('admin.vault.appTokenRefreshed', {
          synced: res.pushed?.synced ?? 0,
        }),
      )
      await onRefresh()
    } catch (err: any) {
      notify(err.message || 'Refresh failed', 'error')
    } finally {
      setRefreshingAppId(null)
    }
  }

  const handleSeedAllPresets = async () => {
    setSeedingPresets(true)
    try {
      await apiFetch('/api/credential-profiles/seed-presets', { method: 'POST' })
      notify(t('admin.vault.presetsSeeded'))
      await onRefresh()
    } catch (err: any) {
      notify(err.message || 'Seed failed', 'error')
    } finally {
      setSeedingPresets(false)
    }
  }

  const handleConfirmPush = async (spec: PushTargetSpec) => {
    if (!pushTarget) return
    const body: Record<string, unknown> = {}
    if (spec.sandbox_ids) body.sandbox_ids = spec.sandbox_ids
    if (spec.template_keys) body.template_keys = spec.template_keys
    const res = await apiFetch<{
      synced: number
      total: number
      results?: Array<{ slug: string; ok: boolean; skipped?: boolean; detail?: string }>
    }>(`/api/credential-profiles/${pushTarget.id}/push`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    notify(
      t('admin.vault.pushed', {
        name: pushTarget.name,
        synced: res.synced,
        total: res.total,
      }),
    )
    return res
  }

  const buildEffectiveEnvJson = (): string | undefined => {
    if (rawEnvMode) {
      const trimmed = credForm.env_vars_json.trim()
      if (!editingId || trimmed) return trimmed || '{}'
      return undefined
    }
    const obj: Record<string, string> = {}
    for (const row of envRows) {
      const k = row.key.trim()
      const v = row.value.trim()
      if (k && v) obj[k] = v
    }
    if (Object.keys(obj).length > 0) return JSON.stringify(obj)
    if (!editingId) return '{}'
    return undefined
  }

  return (
    <div className="space-y-5">
      {/* Header Bar matching Plugin Center */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--brand-radius-md)] border border-zinc-800/90 bg-zinc-900/65 px-5 py-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-indigo-400 shrink-0" />
            <h3 className="text-base font-semibold text-zinc-100">{t('admin.vault.title')}</h3>
            <Badge variant="outline">{credentialProfiles.length}</Badge>
          </div>
          <p className="text-xs text-zinc-400">{t('admin.vault.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {credentialPresets.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={seedingPresets}
              onClick={() => void handleSeedAllPresets()}
            >
              <Sparkles className="h-4 w-4 text-indigo-400" />
              {t('admin.vault.seedPresetsBtn')}
            </Button>
          )}
          <Button type="button" size="sm" onClick={openCreateModal}>
            <Plus className="h-4 w-4" />
            {t('admin.vault.addBtn')}
          </Button>
        </div>
      </div>

      {/* Configured Credential Bundles Grid (Plugin Center Card Style) */}
      {credentialProfiles.length > 0 && (
        <div className="space-y-2.5">
          <div className="text-xs font-medium text-zinc-400 px-0.5">
            {t('admin.vault.configuredSectionTitle')} ({credentialProfiles.length})
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {credentialProfiles.map((c) => {
              let mcpCount = 0
              try {
                const parsed = JSON.parse(c.mcp_servers_json || '{}')
                if (parsed && typeof parsed === 'object') {
                  mcpCount = Object.keys(parsed.mcpServers || parsed).length
                }
              } catch {}
              const boundSbxIds = sandboxes
                .filter((s) => (s.credential_profile_ids || []).includes(c.id))
                .map((s) => s.id)
              const isGithubApp = c.github_auth_mode === 'github_app'
              const isCustomDomain =
                c.git_host !== 'github.com' || Boolean(c.github_api_base_url)
              const hasAnySecret =
                c.has_git_token ||
                c.has_ssh_key ||
                Boolean(c.has_github_app_private_key) ||
                c.has_env_vars ||
                mcpCount > 0

              return (
                <Card key={c.id} className="flex flex-col justify-between">
                  <CardHeader className="pb-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
                          {isGithubApp ? (
                            <ShieldCheck className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <KeyRound className="h-4 w-4 text-indigo-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="truncate">{c.name}</CardTitle>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {c.git_host}
                            </Badge>
                            {isGithubApp && (
                              <Badge variant="secondary" className="text-[10px] border-indigo-500/40 text-indigo-300">
                                {t('admin.vault.githubAppBadge')}
                                {c.github_app_id ? ` #${c.github_app_id}` : ''}
                              </Badge>
                            )}
                            {isCustomDomain && (c.category === 'git' || isGithubApp || Boolean(c.github_api_base_url)) && (
                              <Badge variant="outline" className="text-[10px] border-cyan-500/40 text-cyan-300">
                                <Globe className="h-2.5 w-2.5 mr-1" />
                                {t('admin.vault.enterpriseBadge')}
                              </Badge>
                            )}
                            {c.github_tls_verify === false && (
                              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                                {t('admin.vault.insecureTlsBadge')}
                              </Badge>
                            )}
                            <Badge variant={hasAnySecret ? 'success' : 'secondary'} className="text-[10px]">
                              {hasAnySecret
                                ? t('admin.vault.readyBadge')
                                : t('admin.vault.needsSecretBadge')}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs flex-1 flex flex-col justify-between">
                    <div className="space-y-2.5">
                      {c.description && (
                        <p className="text-zinc-400 leading-relaxed">{c.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isGithubApp && c.has_github_app_private_key && (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                            App PEM
                          </Badge>
                        )}
                        {c.has_git_token && (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                            Git PAT
                          </Badge>
                        )}
                        {c.has_ssh_key && (
                          <Badge variant="outline" className="border-sky-500/40 text-sky-300">
                            SSH Key
                          </Badge>
                        )}
                        {(c.env_var_keys || []).map((ek) => (
                          <Badge
                            key={ek}
                            variant="outline"
                            className="border-amber-500/40 text-amber-300 font-mono text-[10px]"
                          >
                            {ek}
                          </Badge>
                        ))}
                        {c.has_env_vars && (c.env_var_keys || []).length === 0 && (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                            Env
                          </Badge>
                        )}
                        {mcpCount > 0 && (
                          <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                            MCP ({mcpCount})
                          </Badge>
                        )}
                        {boundSbxIds.length > 0 && (
                          <Badge variant="secondary" className="text-[10px]">
                            {t('cap.pushedCountBadge', { count: boundSbxIds.length })}
                          </Badge>
                        )}
                      </div>
                      {c.github_api_base_url && (
                        <div className="font-mono text-[11px] text-zinc-500 truncate">
                          API: {c.github_api_base_url}
                        </div>
                      )}
                      {isGithubApp && c.github_app_token_expires_at && (
                        <div className="text-[11px] text-emerald-400/80 truncate">
                          {t('admin.vault.tokenExpiresLabel', {
                            time: new Date(
                              c.github_app_token_expires_at.endsWith('Z')
                                ? c.github_app_token_expires_at
                                : `${c.github_app_token_expires_at}Z`,
                            ).toLocaleString(),
                          })}
                        </div>
                      )}
                      {(c.git_user_name || c.git_user_email) && (
                        <div className="font-mono text-[11px] text-zinc-500 truncate">
                          {[c.git_user_name, c.git_user_email].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/70">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={sandboxes.length === 0}
                        onClick={() => setPushTarget(c)}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {t('cap.push.pushToEmployeesBtn')}
                      </Button>
                      <div className="flex items-center gap-1">
                        {isGithubApp && c.has_github_app_private_key && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('admin.vault.refreshAppTokenBtn')}
                            disabled={refreshingAppId === c.id}
                            onClick={() => void handleRefreshAppToken(c)}
                          >
                            <RefreshCw
                              className={`h-4 w-4 text-emerald-400 ${refreshingAppId === c.id ? 'animate-spin' : ''}`}
                            />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => openEditModal(c)}>
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-rose-400 hover:text-rose-300"
                          onClick={async () => {
                            try {
                              await apiFetch(`/api/credential-profiles/${c.id}`, {
                                method: 'DELETE',
                              })
                              notify(t('admin.vault.deleted'))
                              await onRefresh()
                            } catch (err: any) {
                              notify(err.message, 'error')
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* Built-in Credential Presets Catalog ("我们提供一些") */}
      {credentialPresets.length > 0 && (
        <div className="space-y-2.5">
          <div className="text-xs font-medium text-zinc-400 px-0.5">
            {t('admin.vault.presetsSectionTitle')} ({credentialPresets.length})
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {credentialPresets.map((preset) => {
              const matched = credentialProfiles.find(
                (c) => c.preset_key === preset.preset_key || c.name === preset.name,
              )
              return (
                <Card key={preset.preset_key} className="border-zinc-800/80 bg-zinc-900/45">
                  <CardHeader className="pb-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-sm">{preset.name}</CardTitle>
                          <Badge variant="secondary" className="text-[10px]">
                            {t('cap.builtinBadge')}
                          </Badge>
                          {preset.github_auth_mode === 'github_app' && (
                            <Badge variant="outline" className="text-[10px] border-indigo-500/40 text-indigo-300">
                              {t('admin.vault.githubAppBadge')}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(preset.suggested_env_keys || []).map((k) => (
                            <code
                              key={k}
                              className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300"
                            >
                              {k}
                            </code>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs">
                    <p className="text-zinc-400 leading-relaxed">{preset.description}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant={matched ? 'outline' : 'default'}
                        size="sm"
                        onClick={() => openFromPreset(preset)}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {matched ? t('admin.vault.editSecretBtn') : t('admin.vault.usePresetBtn')}
                      </Button>
                      {matched && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={sandboxes.length === 0}
                          onClick={() => setPushTarget(matched)}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {t('cap.push.pushToEmployeesBtn')}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* Create / Edit Credential Modal */}
      <Dialog
        open={modalOpen}
        onOpenChange={(o) => !o && !savingCred && setModalOpen(false)}
        title={editingId ? t('admin.vault.editTitle') : t('admin.vault.addBtn')}
        description={t('admin.vault.modalDesc')}
        maxWidth="max-w-xl"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!credForm.name.trim()) return
            setSavingCred(true)
            try {
              const payload: Record<string, unknown> = {
                name: credForm.name.trim(),
                preset_key: credForm.preset_key.trim() || null,
                category: credForm.category || 'custom',
                description: credForm.description.trim() || null,
                git_user_name: credForm.git_user_name.trim() || null,
                git_user_email: credForm.git_user_email.trim() || null,
                git_host: credForm.git_host.trim() || 'github.com',
                github_auth_mode: credForm.github_auth_mode,
                github_api_base_url: credForm.github_api_base_url.trim(),
                github_app_id: credForm.github_app_id.trim() || null,
                github_app_installation_id: credForm.github_app_installation_id.trim() || null,
                github_tls_verify: credForm.github_tls_verify,
                mcp_servers_json: credForm.mcp_servers_json.trim() || '{}',
              }
              if (!editingId || credForm.git_token.trim()) {
                payload.git_token = credForm.git_token.trim()
              }
              if (!editingId || credForm.github_app_private_key.trim()) {
                payload.github_app_private_key = credForm.github_app_private_key.trim()
              }
              if (!editingId || credForm.ssh_private_key.trim()) {
                payload.ssh_private_key = credForm.ssh_private_key.trim()
              }
              const nextEnvJson = buildEffectiveEnvJson()
              if (nextEnvJson !== undefined) {
                payload.env_vars_json = nextEnvJson
              }
              if (editingId) {
                await apiFetch(`/api/credential-profiles/${editingId}`, {
                  method: 'PATCH',
                  body: JSON.stringify(payload),
                })
              } else {
                await apiFetch('/api/credential-profiles', {
                  method: 'POST',
                  body: JSON.stringify(payload),
                })
              }
              notify(t('admin.vault.saved'))
              setCredForm(EMPTY_CRED_FORM)
              setEditingId(null)
              setModalOpen(false)
              await onRefresh()
            } catch (err: any) {
              notify(err.message || 'Save failed', 'error')
            } finally {
              setSavingCred(false)
            }
          }}
          className="space-y-4 text-sm"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('admin.vault.nameLabel')}</Label>
              <Input
                required
                placeholder={t('admin.vault.namePlaceholder')}
                value={credForm.name}
                onChange={(e) => setCredForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('cap.categoryLabel')}</Label>
              <Select
                value={credForm.category}
                onChange={(e) => setCredForm((prev) => ({ ...prev, category: e.target.value }))}
              >
                <option value="git">Git</option>
                <option value="api">API</option>
                <option value="database">Database</option>
                <option value="im">IM</option>
                <option value="dev">Dev</option>
                <option value="custom">Custom</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('admin.vault.authModeLabel')}</Label>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              <button
                type="button"
                onClick={() => setCredForm((prev) => ({ ...prev, github_auth_mode: 'pat' }))}
                className={`rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  credForm.github_auth_mode === 'pat'
                    ? 'brand-tab-active'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {t('admin.vault.authModePat')}
              </button>
              <button
                type="button"
                onClick={() =>
                  setCredForm((prev) => ({
                    ...prev,
                    github_auth_mode: 'github_app',
                    category: prev.category === 'custom' ? 'git' : prev.category,
                  }))
                }
                className={`rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  credForm.github_auth_mode === 'github_app'
                    ? 'brand-tab-active'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {t('admin.vault.authModeGithubApp')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('admin.vault.gitNameLabel')}</Label>
              <Input
                placeholder="Digital Bot"
                value={credForm.git_user_name}
                onChange={(e) =>
                  setCredForm((prev) => ({ ...prev, git_user_name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.vault.gitEmailLabel')}</Label>
              <Input
                placeholder="bot@corp.com"
                value={credForm.git_user_email}
                onChange={(e) =>
                  setCredForm((prev) => ({ ...prev, git_user_email: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label>{t('admin.vault.gitHostLabel')}</Label>
              <Input
                placeholder="github.com 或 github.corp.internal"
                value={credForm.git_host}
                onChange={(e) => setCredForm((prev) => ({ ...prev, git_host: e.target.value }))}
              />
            </div>
            {credForm.github_auth_mode === 'pat' ? (
              <div className="space-y-1.5">
                <Label>{t('admin.vault.gitTokenLabel')}</Label>
                <Input
                  type="password"
                  placeholder={editingId ? t('notif.secretKeepHint') : 'ghp_... / glpat-...'}
                  value={credForm.git_token}
                  onChange={(e) => setCredForm((prev) => ({ ...prev, git_token: e.target.value }))}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{t('admin.vault.githubAppIdLabel')}</Label>
                <Input
                  required={credForm.github_auth_mode === 'github_app'}
                  placeholder="e.g. 123456"
                  value={credForm.github_app_id}
                  onChange={(e) =>
                    setCredForm((prev) => ({ ...prev, github_app_id: e.target.value }))
                  }
                />
              </div>
            )}
          </div>

          {(credForm.github_auth_mode === 'github_app' ||
            credForm.category === 'git' ||
            credForm.git_host.trim() !== 'github.com' ||
            Boolean(credForm.github_api_base_url.trim())) && (
            <div className="space-y-3 rounded-lg border border-zinc-800/90 bg-zinc-950/55 p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div className={`space-y-1.5 ${credForm.github_auth_mode === 'github_app' ? '' : 'sm:col-span-2'}`}>
                  <Label>{t('admin.vault.githubApiUrlLabel')}</Label>
                  <Input
                    className="font-mono text-xs"
                    placeholder={inferGithubApiHint(credForm.git_host)}
                    value={credForm.github_api_base_url}
                    onChange={(e) =>
                      setCredForm((prev) => ({ ...prev, github_api_base_url: e.target.value }))
                    }
                  />
                </div>
                {credForm.github_auth_mode === 'github_app' && (
                  <div className="space-y-1.5">
                    <Label>{t('admin.vault.githubAppInstallIdLabel')}</Label>
                    <Input
                      required
                      placeholder="e.g. 98765432"
                      value={credForm.github_app_installation_id}
                      onChange={(e) =>
                        setCredForm((prev) => ({
                          ...prev,
                          github_app_installation_id: e.target.value,
                        }))
                      }
                    />
                  </div>
                )}
              </div>

              {credForm.github_auth_mode === 'github_app' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label>{t('admin.vault.githubAppKeyLabel')}</Label>
                    <label className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-indigo-300 hover:bg-zinc-800 cursor-pointer">
                      <Upload className="h-3 w-3" />
                      {t('admin.vault.githubAppUploadPem')}
                      <input
                        type="file"
                        accept=".pem,.key,.txt"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const reader = new FileReader()
                          reader.onload = () => {
                            if (typeof reader.result === 'string') {
                              setCredForm((prev) => ({
                                ...prev,
                                github_app_private_key: reader.result as string,
                              }))
                            }
                          }
                          reader.readAsText(file)
                        }}
                      />
                    </label>
                  </div>
                  <Textarea
                    rows={3}
                    className="font-mono text-[11px]"
                    placeholder={
                      editingId
                        ? t('notif.secretKeepHint')
                        : '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----'
                    }
                    value={credForm.github_app_private_key}
                    onChange={(e) =>
                      setCredForm((prev) => ({ ...prev, github_app_private_key: e.target.value }))
                    }
                  />
                  <p className="text-[11px] text-emerald-400/90 leading-relaxed">
                    {t('admin.vault.githubAppHint')}
                  </p>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={credForm.github_tls_verify}
                  onChange={(e) =>
                    setCredForm((prev) => ({ ...prev, github_tls_verify: e.target.checked }))
                  }
                  className="rounded border-zinc-700 bg-zinc-900 text-indigo-500"
                />
                <span>{t('admin.vault.githubTlsVerifyLabel')}</span>
              </label>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('admin.vault.envKvLabel')}</Label>
              <button
                type="button"
                onClick={() => setRawEnvMode((v) => !v)}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
              >
                {rawEnvMode ? t('admin.vault.switchKvMode') : t('admin.vault.switchJsonMode')}
              </button>
            </div>
            {rawEnvMode ? (
              <Textarea
                rows={3}
                className="font-mono text-xs"
                placeholder={editingId ? t('notif.secretKeepHint') : '{"GITHUB_TOKEN":"ghp_..."}'}
                value={credForm.env_vars_json}
                onChange={(e) =>
                  setCredForm((prev) => ({ ...prev, env_vars_json: e.target.value }))
                }
              />
            ) : (
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                {envRows.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      className="font-mono text-xs h-8 flex-1"
                      placeholder="KEY (e.g. GITHUB_TOKEN)"
                      value={row.key}
                      onChange={(e) =>
                        setEnvRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)),
                        )
                      }
                    />
                    <Input
                      type="password"
                      className="font-mono text-xs h-8 flex-1"
                      placeholder={editingId ? t('notif.secretKeepHint') : 'secret value'}
                      value={row.value}
                      onChange={(e) =>
                        setEnvRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setEnvRows((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEnvRows((prev) => [...prev, { key: '', value: '' }])}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('admin.vault.addEnvRowBtn')}
                </Button>
              </div>
            )}
          </div>

          <details className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3 text-xs">
            <summary className="cursor-pointer font-medium text-zinc-400 select-none">
              {t('admin.vault.advancedToggle')}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label>{t('admin.vault.sshKeyLabel')}</Label>
                <Textarea
                  rows={2}
                  placeholder={editingId ? t('notif.secretKeepHint') : '-----BEGIN OPENSSH PRIVATE KEY-----'}
                  value={credForm.ssh_private_key}
                  onChange={(e) =>
                    setCredForm((prev) => ({ ...prev, ssh_private_key: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('admin.vault.mcpJsonLabel')}</Label>
                <Textarea
                  rows={2}
                  className="font-mono text-xs"
                  placeholder='{"github":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}}'
                  value={credForm.mcp_servers_json}
                  onChange={(e) =>
                    setCredForm((prev) => ({ ...prev, mcp_servers_json: e.target.value }))
                  }
                />
              </div>
            </div>
          </details>

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingCred}>
              {savingCred ? t('common.saving') : t('admin.vault.saveBtn')}
            </Button>
          </div>
        </form>
      </Dialog>

      <PushTargetDialog
        open={!!pushTarget}
        onOpenChange={(o) => !o && setPushTarget(null)}
        title={t('admin.vault.pushDialogTitle', { name: pushTarget?.name ?? '' })}
        description={t('admin.vault.pushDialogDesc')}
        sandboxes={sandboxes}
        templates={templates}
        alreadyPushedIds={
          pushTarget
            ? sandboxes
                .filter((s) => (s.credential_profile_ids || []).includes(pushTarget.id))
                .map((s) => s.id)
            : []
        }
        onConfirm={handleConfirmPush}
      />
    </div>
  )
}
