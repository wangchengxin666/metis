import { useState } from 'react'
import { Lock, Plus, Send, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type { CredentialProfileItem, SandboxItem } from '../../types'

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
  onRefresh: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}

export function CredentialVaultSection({
  credentialProfiles,
  sandboxes,
  onRefresh,
  notify,
}: CredentialVaultSectionProps) {
  const { t } = useI18n()
  const [credForm, setCredForm] = useState(EMPTY_CRED_FORM)
  const [savingCred, setSavingCred] = useState(false)
  const [pushingCredId, setPushingCredId] = useState<string | null>(null)

  return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Lock className="h-4 w-4 text-indigo-400 shrink-0" />
                <span>{t('admin.vault.title')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!credForm.name.trim()) return
                  setSavingCred(true)
                  try {
                    await apiFetch('/api/credential-profiles', {
                      method: 'POST',
                      body: JSON.stringify({
                        name: credForm.name.trim(),
                        git_user_name: credForm.git_user_name.trim() || null,
                        git_user_email: credForm.git_user_email.trim() || null,
                        git_host: credForm.git_host.trim() || 'github.com',
                        git_token: credForm.git_token.trim(),
                        ssh_private_key: credForm.ssh_private_key.trim(),
                        env_vars_json: credForm.env_vars_json.trim() || '{}',
                        mcp_servers_json: credForm.mcp_servers_json.trim() || '{}',
                      }),
                    })
                    notify(t('admin.vault.saved'))
                    setCredForm(EMPTY_CRED_FORM)
                    await onRefresh()
                  } catch (err: any) {
                    notify(err.message || 'Save failed', 'error')
                  } finally {
                    setSavingCred(false)
                  }
                }}
                className="space-y-3 text-xs"
              >
                <div className="space-y-1">
                  <Label>{t('admin.vault.nameLabel')}</Label>
                  <Input
                    required
                    placeholder={t('admin.vault.namePlaceholder')}
                    value={credForm.name}
                    onChange={(e) => setCredForm({ ...credForm, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>{t('admin.vault.gitNameLabel')}</Label>
                    <Input
                      placeholder="Digital Bot"
                      value={credForm.git_user_name}
                      onChange={(e) => setCredForm({ ...credForm, git_user_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t('admin.vault.gitEmailLabel')}</Label>
                    <Input
                      type="email"
                      placeholder="bot@corp.com"
                      value={credForm.git_user_email}
                      onChange={(e) => setCredForm({ ...credForm, git_user_email: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>{t('admin.vault.gitHostLabel')}</Label>
                    <Input
                      value={credForm.git_host}
                      onChange={(e) => setCredForm({ ...credForm, git_host: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t('admin.vault.gitTokenLabel')}</Label>
                    <Input
                      type="password"
                      placeholder="ghp_... / glpat-..."
                      value={credForm.git_token}
                      onChange={(e) => setCredForm({ ...credForm, git_token: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>{t('admin.vault.sshKeyLabel')}</Label>
                  <Textarea
                    rows={2}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    value={credForm.ssh_private_key}
                    onChange={(e) => setCredForm({ ...credForm, ssh_private_key: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('admin.vault.envJsonLabel')}</Label>
                  <Textarea
                    rows={2}
                    className="font-mono"
                    value={credForm.env_vars_json}
                    onChange={(e) => setCredForm({ ...credForm, env_vars_json: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('admin.vault.mcpJsonLabel')}</Label>
                  <Textarea
                    rows={2}
                    className="font-mono"
                    placeholder='{"github":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}}'
                    value={credForm.mcp_servers_json}
                    onChange={(e) => setCredForm({ ...credForm, mcp_servers_json: e.target.value })}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={savingCred}>
                  <Plus className="h-3.5 w-3.5" />
                  {savingCred ? t('common.saving') : t('admin.vault.saveBtn')}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">{t('admin.vault.title')}</CardTitle>
                <Badge variant="outline">{credentialProfiles.length}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {credentialProfiles.length === 0 ? (
                <p className="text-xs text-zinc-500 py-8 text-center max-w-md mx-auto leading-relaxed">
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
                    return (
                      <div
                        key={c.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 text-xs"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-zinc-100">{c.name}</span>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {c.git_host}
                            </Badge>
                            {c.has_git_token && (
                              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
                                Git PAT
                              </Badge>
                            )}
                            {c.has_ssh_key && (
                              <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-300">
                                SSH Key
                              </Badge>
                            )}
                            {c.has_env_vars && (
                              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                                Env
                              </Badge>
                            )}
                            {mcpCount > 0 && (
                              <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-300">
                                MCP ({mcpCount})
                              </Badge>
                            )}
                          </div>
                          {(c.git_user_name || c.git_user_email) && (
                            <div className="font-mono text-[11px] text-zinc-400">
                              {[c.git_user_name, c.git_user_email].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pushingCredId === c.id || sandboxes.length === 0}
                            onClick={async () => {
                              setPushingCredId(c.id)
                              try {
                                const res = await apiFetch<{ synced: number; total: number }>(
                                  `/api/credential-profiles/${c.id}/push`,
                                  { method: 'POST', body: JSON.stringify({}) },
                                )
                                notify(
                                  t('admin.vault.pushed', {
                                    name: c.name,
                                    synced: res.synced,
                                    total: res.total,
                                  }),
                                )
                              } catch (err: any) {
                                notify(err.message || 'Push failed', 'error')
                              } finally {
                                setPushingCredId(null)
                              }
                            }}
                          >
                            <Send className="h-3 w-3" />
                            {t('admin.vault.pushBtn')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
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

  )
}
