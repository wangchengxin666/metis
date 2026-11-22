import { useState } from 'react'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
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
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { generatePassword } from '../../lib/format'
import { useI18n } from '../../lib/i18nContext'
import type { AdminItem, OverviewData, UserItem } from '../../types'

export interface UsersTabProps {
  users: UserItem[]
  admins: AdminItem[]
  overview: OverviewData | null
  enabledOidcCount: number
  effectiveAllowLocalUser: boolean
  onRefresh: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}

export function UsersTab({
  users,
  admins,
  overview,
  enabledOidcCount,
  effectiveAllowLocalUser,
  onRefresh,
  notify,
}: UsersTabProps) {
  const { t } = useI18n()
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

  return (
    <>
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
                    await onRefresh()
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
                              await onRefresh()
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
                              await onRefresh()
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
                    await onRefresh()
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
              await onRefresh()
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

    </>
  )
}
