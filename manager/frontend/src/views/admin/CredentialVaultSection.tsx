import { useState } from 'react'
import { Edit3, Lock, Plus, Send, Trash2 } from 'lucide-react'
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
  Textarea,
  cn,
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type { CredentialProfileItem, SandboxItem, TemplateItem } from '../../types'

const EMPTY_CRED_FORM = {
  name: '',
  git_user_name: '',
  git_user_email: '',
  git_host: 'github.com',
  git_token: '',
  ssh_private_key: '',
  env_vars_json: '{}',
  mcp_servers_json: '{}',
}

export interface CredentialVaultSectionProps {
  credentialProfiles: CredentialProfileItem[]
  sandboxes: SandboxItem[]
  templates?: TemplateItem[]
  onRefresh: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}

export function CredentialVaultSection({
  credentialProfiles,
  sandboxes,
  templates = [],
  onRefresh,
  notify,
}: CredentialVaultSectionProps) {
  const { t } = useI18n()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [credForm, setCredForm] = useState(EMPTY_CRED_FORM)
  const [savingCred, setSavingCred] = useState(false)

  // Targeted Push Dialog (least-privilege)
  const [pushTarget, setPushTarget] = useState<CredentialProfileItem | null>(null)
  const [pushMode, setPushMode] = useState<'sandboxes' | 'templates' | 'all'>('sandboxes')
  const [selectedSandboxIds, setSelectedSandboxIds] = useState<string[]>([])
  const [selectedTemplateKeys, setSelectedTemplateKeys] = useState<string[]>([])
  const [pushing, setPushing] = useState(false)

  const runningSandboxes = sandboxes.filter((s) => s.status === 'running')

  const openCreateModal = () => {
    setEditingId(null)
    setCredForm(EMPTY_CRED_FORM)
    setModalOpen(true)
  }

  const openEditModal = (c: CredentialProfileItem) => {
    setEditingId(c.id)
    setCredForm({
      name: c.name,
      git_user_name: c.git_user_name || '',
      git_user_email: c.git_user_email || '',
      git_host: c.git_host || 'github.com',
      git_token: '',
      ssh_private_key: '',
      env_vars_json: '',
      mcp_servers_json: c.mcp_servers_json || '{}',
    })
    setModalOpen(true)
  }

  const openPushModal = (c: CredentialProfileItem) => {
    setPushTarget(c)
    const preBoundIds = runningSandboxes
      .filter((s) => (s.credential_profile_ids || []).includes(c.id))
      .map((s) => s.id)
    setPushMode('sandboxes')
    setSelectedSandboxIds(preBoundIds)
    const preBoundTpls = templates
      .filter((tpl) => (tpl.default_credential_profile_ids || []).includes(c.id))
      .map((tpl) => tpl.key)
    setSelectedTemplateKeys(preBoundTpls)
  }

  const handleConfirmPush = async () => {
    if (!pushTarget) return
    const body: Record<string, unknown> = {}
    if (pushMode === 'sandboxes') {
      if (selectedSandboxIds.length === 0) {
        notify(t('admin.vault.pushSelectRequired'), 'error')
        return
      }
      body.sandbox_ids = selectedSandboxIds
    } else if (pushMode === 'templates') {
      if (selectedTemplateKeys.length === 0) {
        notify(t('admin.vault.pushSelectRequired'), 'error')
        return
      }
      body.template_keys = selectedTemplateKeys
    }

    setPushing(true)
    try {
      const res = await apiFetch<{ synced: number; total: number }>(
        `/api/credential-profiles/${pushTarget.id}/push`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      notify(
        t('admin.vault.pushed', {
          name: pushTarget.name,
          synced: res.synced,
          total: res.total,
        }),
      )
      setPushTarget(null)
    } catch (err: any) {
      notify(err.message || 'Push failed', 'error')
    } finally {
      setPushing(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-indigo-400 shrink-0" />
              <span>{t('admin.vault.title')}</span>
              <Badge variant="outline">{credentialProfiles.length}</Badge>
            </CardTitle>
            <Button type="button" size="sm" onClick={openCreateModal}>
              <Plus className="h-4 w-4" />
              {t('admin.vault.addBtn')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {credentialProfiles.length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center max-w-lg mx-auto leading-relaxed">
              {t('admin.vault.empty')}
            </p>
          ) : (
            <div className="divide-y divide-zinc-800/70">
              {credentialProfiles.map((c) => {
                let mcpCount = 0
                try {
                  const parsed = JSON.parse(c.mcp_servers_json || '{}')
                  if (parsed && typeof parsed === 'object') {
                    mcpCount = Object.keys(parsed.mcpServers || parsed).length
                  }
                } catch {}
                const boundSbxCount = sandboxes.filter((s) =>
                  (s.credential_profile_ids || []).includes(c.id),
                ).length
                const boundTplCount = templates.filter((tpl) =>
                  (tpl.default_credential_profile_ids || []).includes(c.id),
                ).length

                return (
                  <div
                    key={c.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 text-sm"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-zinc-100">{c.name}</span>
                        <Badge variant="outline" className="font-mono">
                          {c.git_host}
                        </Badge>
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
                        {c.has_env_vars && (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                            Env
                          </Badge>
                        )}
                        {mcpCount > 0 && (
                          <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                            MCP ({mcpCount})
                          </Badge>
                        )}
                        {(boundTplCount > 0 || boundSbxCount > 0) && (
                          <Badge variant="secondary" className="text-[11px]">
                            {boundTplCount} tpl · {boundSbxCount} emp
                          </Badge>
                        )}
                      </div>
                      {(c.git_user_name || c.git_user_email) && (
                        <div className="font-mono text-xs text-zinc-400">
                          {[c.git_user_name, c.git_user_email].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={sandboxes.length === 0}
                        onClick={() => openPushModal(c)}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {t('admin.vault.pushBtn')}
                      </Button>
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
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Credential Modal */}
      <Dialog
        open={modalOpen}
        onOpenChange={(o) => !o && !savingCred && setModalOpen(false)}
        title={editingId ? t('admin.vault.editTitle') : t('admin.vault.addBtn')}
        description={t('admin.vault.title')}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!credForm.name.trim()) return
            setSavingCred(true)
            try {
              const payload: Record<string, unknown> = {
                name: credForm.name.trim(),
                git_user_name: credForm.git_user_name.trim() || null,
                git_user_email: credForm.git_user_email.trim() || null,
                git_host: credForm.git_host.trim() || 'github.com',
                mcp_servers_json: credForm.mcp_servers_json.trim() || '{}',
              }
              if (!editingId || credForm.git_token.trim()) {
                payload.git_token = credForm.git_token.trim()
              }
              if (!editingId || credForm.ssh_private_key.trim()) {
                payload.ssh_private_key = credForm.ssh_private_key.trim()
              }
              if (!editingId || credForm.env_vars_json.trim()) {
                payload.env_vars_json = credForm.env_vars_json.trim() || '{}'
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
          <div className="space-y-1.5">
            <Label>{t('admin.vault.nameLabel')}</Label>
            <Input
              required
              placeholder={t('admin.vault.namePlaceholder')}
              value={credForm.name}
              onChange={(e) => setCredForm({ ...credForm, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('admin.vault.gitNameLabel')}</Label>
              <Input
                placeholder="Digital Bot"
                value={credForm.git_user_name}
                onChange={(e) => setCredForm({ ...credForm, git_user_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.vault.gitEmailLabel')}</Label>
              <Input
                type="email"
                placeholder="bot@corp.com"
                value={credForm.git_user_email}
                onChange={(e) => setCredForm({ ...credForm, git_user_email: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('admin.vault.gitHostLabel')}</Label>
              <Input
                value={credForm.git_host}
                onChange={(e) => setCredForm({ ...credForm, git_host: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.vault.gitTokenLabel')}</Label>
              <Input
                type="password"
                placeholder={editingId ? t('notif.secretKeepHint') : 'ghp_... / glpat-...'}
                value={credForm.git_token}
                onChange={(e) => setCredForm({ ...credForm, git_token: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('admin.vault.sshKeyLabel')}</Label>
            <Textarea
              rows={2}
              placeholder={editingId ? t('notif.secretKeepHint') : '-----BEGIN OPENSSH PRIVATE KEY-----'}
              value={credForm.ssh_private_key}
              onChange={(e) => setCredForm({ ...credForm, ssh_private_key: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('admin.vault.envJsonLabel')}</Label>
            <Textarea
              rows={2}
              className="font-mono text-xs"
              placeholder={editingId ? t('notif.secretKeepHint') : '{}'}
              value={credForm.env_vars_json}
              onChange={(e) => setCredForm({ ...credForm, env_vars_json: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('admin.vault.mcpJsonLabel')}</Label>
            <Textarea
              rows={2}
              className="font-mono text-xs"
              placeholder='{"github":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}}'
              value={credForm.mcp_servers_json}
              onChange={(e) => setCredForm({ ...credForm, mcp_servers_json: e.target.value })}
            />
          </div>
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

      {/* Targeted Least-Privilege Push Modal */}
      <Dialog
        open={!!pushTarget}
        onOpenChange={(o) => !o && !pushing && setPushTarget(null)}
        title={t('admin.vault.pushDialogTitle', { name: pushTarget?.name ?? '' })}
        description={t('admin.vault.pushDialogDesc')}
      >
        {pushTarget && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'sandboxes', label: t('admin.vault.pushModeSandboxes') },
                  { id: 'templates', label: t('admin.vault.pushModeTemplates') },
                  { id: 'all', label: t('admin.vault.pushModeAll') },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPushMode(m.id)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-medium border cursor-pointer transition-colors',
                    pushMode === m.id
                      ? 'brand-tab-active border-transparent'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-100',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {pushMode === 'sandboxes' && (
              <div className="max-h-56 overflow-y-auto divide-y divide-zinc-800/70 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60">
                {sandboxes.map((sbx) => {
                  const isRunning = sbx.status === 'running'
                  const checked = selectedSandboxIds.includes(sbx.id)
                  return (
                    <label
                      key={sbx.id}
                      className={cn(
                        'flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs',
                        isRunning ? 'cursor-pointer hover:bg-zinc-900/60' : 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          disabled={!isRunning}
                          checked={checked}
                          onChange={(e) =>
                            setSelectedSandboxIds((prev) =>
                              e.target.checked
                                ? [...prev, sbx.id]
                                : prev.filter((id) => id !== sbx.id),
                            )
                          }
                          className="rounded border-zinc-600 accent-indigo-500"
                        />
                        <span className="font-mono text-zinc-100">@{sbx.slug}</span>
                        {sbx.role_title && (
                          <span className="text-zinc-400 truncate">· {sbx.role_title}</span>
                        )}
                      </div>
                      <Badge variant={isRunning ? 'success' : 'secondary'}>{sbx.status}</Badge>
                    </label>
                  )
                })}
              </div>
            )}

            {pushMode === 'templates' && (
              <div className="max-h-56 overflow-y-auto divide-y divide-zinc-800/70 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60">
                {templates.map((tpl) => {
                  const checked = selectedTemplateKeys.includes(tpl.key)
                  const matchCount = runningSandboxes.filter((s) => s.template === tpl.key).length
                  return (
                    <label
                      key={tpl.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs cursor-pointer hover:bg-zinc-900/60"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedTemplateKeys((prev) =>
                              e.target.checked
                                ? [...prev, tpl.key]
                                : prev.filter((k) => k !== tpl.key),
                            )
                          }
                          className="rounded border-zinc-600 accent-indigo-500"
                        />
                        <span className="font-medium text-zinc-100">{tpl.name}</span>
                        <span className="font-mono text-zinc-500">({tpl.key})</span>
                      </div>
                      <Badge variant="outline">{matchCount} running</Badge>
                    </label>
                  )
                })}
              </div>
            )}

            {pushMode === 'all' && (
              <div className="rounded-[var(--brand-radius-md)] border border-amber-500/35 bg-amber-950/20 p-3.5 text-xs text-amber-200 leading-relaxed">
                {t('admin.vault.pushAllWarning', { count: runningSandboxes.length })}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
              <Button type="button" variant="ghost" onClick={() => setPushTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" disabled={pushing} onClick={() => void handleConfirmPush()}>
                <Send className="h-3.5 w-3.5" />
                {pushing ? t('common.saving') : t('admin.vault.pushConfirmBtn')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  )
}
