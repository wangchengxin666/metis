import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bell,
  CheckCircle2,
  Edit3,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
  XCircle,
} from 'lucide-react'
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
  cn,
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type {
  NotificationChannelItem,
  NotificationChannelType,
  NotificationDeliveryItem,
  NotificationEventType,
  SandboxItem,
} from '../../types'

const ALL_EVENTS: NotificationEventType[] = [
  'approval.pending',
  'task.blocked',
  'task.done',
  'sandbox.unhealthy',
  'budget.warning',
  'budget.exceeded',
  'stage.timeout',
]

interface ChannelFormState {
  name: string
  channel_type: NotificationChannelType
  enabled: boolean
  webhook_url: string
  signing_secret: string
  smtp_host: string
  smtp_port: string
  smtp_username: string
  smtp_password: string
  smtp_from: string
  smtp_to: string
  smtp_use_tls: boolean
  events: NotificationEventType[]
  scope_sandbox_ids: string[]
}

const EMPTY_FORM: ChannelFormState = {
  name: '',
  channel_type: 'feishu',
  enabled: true,
  webhook_url: '',
  signing_secret: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_username: '',
  smtp_password: '',
  smtp_from: '',
  smtp_to: '',
  smtp_use_tls: true,
  events: [...ALL_EVENTS],
  scope_sandbox_ids: [],
}

export function NotificationsTab({
  sandboxes,
  notify,
}: {
  sandboxes: SandboxItem[]
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  const [channels, setChannels] = useState<NotificationChannelItem[]>([])
  const [deliveries, setDeliveries] = useState<NotificationDeliveryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<NotificationChannelItem | null>(null)
  const [form, setForm] = useState<ChannelFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [chRes, delRes] = await Promise.all([
        apiFetch<NotificationChannelItem[]>('/api/notification-channels'),
        apiFetch<NotificationDeliveryItem[]>('/api/notification-deliveries?limit=40'),
      ])
      setChannels(chRes)
      setDeliveries(delRes)
    } catch (err: any) {
      notify(err.message || tRef.current('admin.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const eventLabel = (ev: string) => {
    if (ev === 'approval.pending') return t('notif.eventApproval')
    if (ev === 'task.blocked') return t('notif.eventBlocked')
    if (ev === 'task.done') return t('notif.eventDone')
    if (ev === 'sandbox.unhealthy') return t('notif.eventUnhealthy')
    if (ev === 'budget.warning') return t('notif.eventBudgetWarn')
    if (ev === 'budget.exceeded') return t('notif.eventBudgetExceeded')
    if (ev === 'stage.timeout') return t('notif.eventStageTimeout')
    return ev
  }

  const typeLabel = (ct: string) => {
    if (ct === 'feishu') return t('notif.typeFeishu')
    if (ct === 'wecom') return t('notif.typeWecom')
    if (ct === 'slack') return t('notif.typeSlack')
    if (ct === 'email') return t('notif.typeEmail')
    return t('notif.typeWebhook')
  }

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  const openEdit = (ch: NotificationChannelItem) => {
    setEditing(ch)
    setForm({
      name: ch.name,
      channel_type: ch.channel_type,
      enabled: ch.enabled,
      webhook_url: '',
      signing_secret: '',
      smtp_host: ch.smtp_host || '',
      smtp_port: ch.smtp_port ? String(ch.smtp_port) : '587',
      smtp_username: '',
      smtp_password: '',
      smtp_from: ch.smtp_from || '',
      smtp_to: (ch.smtp_to || []).join(', '),
      smtp_use_tls: ch.smtp_use_tls,
      events: ch.events.length ? ch.events : [...ALL_EVENTS],
      scope_sandbox_ids: ch.scope_sandbox_ids || [],
    })
    setModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const recipients = form.smtp_to
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter(Boolean)
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        enabled: form.enabled,
        events: form.events,
        scope_sandbox_ids: form.scope_sandbox_ids,
      }
      if (!editing) {
        body.channel_type = form.channel_type
      }
      if (form.channel_type === 'email') {
        body.smtp_host = form.smtp_host.trim()
        body.smtp_port = Number.parseInt(form.smtp_port, 10) || 587
        if (form.smtp_username.trim()) body.smtp_username = form.smtp_username.trim()
        if (form.smtp_password.trim()) body.smtp_password = form.smtp_password.trim()
        if (form.smtp_from.trim()) body.smtp_from = form.smtp_from.trim()
        body.smtp_to = recipients
        body.smtp_use_tls = form.smtp_use_tls
      } else {
        if (form.webhook_url.trim()) body.webhook_url = form.webhook_url.trim()
        if (form.signing_secret.trim()) body.signing_secret = form.signing_secret.trim()
      }

      if (editing) {
        await apiFetch(`/api/notification-channels/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      } else {
        await apiFetch('/api/notification-channels', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      }
      notify(t('notif.saved'))
      setModalOpen(false)
      await loadData()
    } catch (err: any) {
      notify(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleEnabled = async (ch: NotificationChannelItem) => {
    try {
      await apiFetch(`/api/notification-channels/${ch.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !ch.enabled }),
      })
      await loadData()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleTest = async (ch: NotificationChannelItem) => {
    setTestingId(ch.id)
    try {
      const res = await apiFetch<{ ok: boolean; detail: string }>(
        `/api/notification-channels/${ch.id}/test`,
        { method: 'POST' },
      )
      if (res.ok) {
        notify(t('notif.testOk', { name: ch.name }))
      } else {
        notify(t('notif.testFailed', { detail: res.detail || 'failed' }), 'error')
      }
      await loadData()
    } catch (err: any) {
      notify(t('notif.testFailed', { detail: err.message }), 'error')
    } finally {
      setTestingId(null)
    }
  }

  const handleDelete = async (ch: NotificationChannelItem) => {
    if (!window.confirm(t('notif.deleteConfirm', { name: ch.name }))) return
    try {
      await apiFetch(`/api/notification-channels/${ch.id}`, { method: 'DELETE' })
      notify(t('notif.deleted'))
      await loadData()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-indigo-400" />
                <span>{t('notif.title')}</span>
                <Badge variant="outline">{channels.length}</Badge>
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void loadData()}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                {t('common.refresh')}
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                {t('notif.addBtn')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <p className="text-sm text-zinc-500 py-10 text-center max-w-lg mx-auto leading-relaxed">
              {t('notif.empty')}
            </p>
          ) : (
            <div className="divide-y divide-zinc-800/70">
              {channels.map((ch) => (
                <div
                  key={ch.id}
                  className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {ch.channel_type === 'email' ? (
                        <Mail className="h-4 w-4 text-sky-400 shrink-0" />
                      ) : (
                        <Webhook className="h-4 w-4 text-indigo-400 shrink-0" />
                      )}
                      <span className="font-medium text-zinc-100">{ch.name}</span>
                      <Badge variant="outline">{typeLabel(ch.channel_type)}</Badge>
                      <button
                        type="button"
                        onClick={() => void handleToggleEnabled(ch)}
                        className="cursor-pointer"
                      >
                        <Badge variant={ch.enabled ? 'success' : 'secondary'}>
                          {ch.enabled ? t('common.active') : t('common.inactive')}
                        </Badge>
                      </button>
                      {ch.has_secret && (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                          Signed
                        </Badge>
                      )}
                    </div>
                    {ch.target_hint && (
                      <div className="font-mono text-xs text-zinc-400 truncate">
                        {ch.target_hint}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {ch.events.map((ev) => (
                        <Badge key={ev} variant="secondary" className="text-[11px]">
                          {eventLabel(ev)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testingId === ch.id}
                      onClick={() => void handleTest(ch)}
                    >
                      <Send className="h-3.5 w-3.5" />
                      {testingId === ch.id ? t('notif.testing') : t('notif.testBtn')}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(ch)}>
                      <Edit3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-rose-400 hover:text-rose-300"
                      onClick={() => void handleDelete(ch)}
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

      {/* Delivery Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span>{t('notif.deliveriesTitle')}</span>
            <Badge variant="outline">{deliveries.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deliveries.length === 0 ? (
            <p className="text-sm text-zinc-500 py-6 text-center">{t('notif.deliveriesEmpty')}</p>
          ) : (
            <div className="divide-y divide-zinc-800/60 max-h-80 overflow-y-auto text-xs">
              {deliveries.map((d) => (
                <div
                  key={d.id}
                  className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    {d.status === 'sent' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    )}
                    <Badge variant="outline">{d.channel_name}</Badge>
                    <Badge variant="secondary">{eventLabel(d.event_type)}</Badge>
                    <span className="text-zinc-200 truncate">{d.title}</span>
                    {d.sandbox_slug && (
                      <span className="font-mono text-zinc-500">@{d.sandbox_slug}</span>
                    )}
                    {d.error_detail && (
                      <span className="text-rose-400 truncate max-w-xs">{d.error_detail}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-zinc-500 font-mono">
                    {d.response_code ? <span>HTTP {d.response_code}</span> : null}
                    <span>{new Date(d.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Channel Modal */}
      <Dialog
        open={modalOpen}
        onOpenChange={(o) => !o && !saving && setModalOpen(false)}
        title={
          editing
            ? t('notif.dialogEditTitle', { name: editing.name })
            : t('notif.dialogCreateTitle')
        }
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleSave} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('notif.nameLabel')}</Label>
              <Input
                required
                placeholder={t('notif.namePlaceholder')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('notif.typeLabel')}</Label>
              <Select
                disabled={Boolean(editing)}
                value={form.channel_type}
                onChange={(e) =>
                  setForm({ ...form, channel_type: e.target.value as NotificationChannelType })
                }
              >
                <option value="feishu">{t('notif.typeFeishu')}</option>
                <option value="wecom">{t('notif.typeWecom')}</option>
                <option value="slack">{t('notif.typeSlack')}</option>
                <option value="email">{t('notif.typeEmail')}</option>
                <option value="webhook">{t('notif.typeWebhook')}</option>
              </Select>
            </div>
          </div>

          {form.channel_type === 'email' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('notif.smtpHostLabel')}</Label>
                <Input
                  required
                  placeholder="smtp.exmail.qq.com"
                  value={form.smtp_host}
                  onChange={(e) => setForm({ ...form, smtp_host: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('notif.smtpPortLabel')}</Label>
                <Input
                  type="number"
                  value={form.smtp_port}
                  onChange={(e) => setForm({ ...form, smtp_port: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('notif.smtpUserLabel')}</Label>
                <Input
                  value={form.smtp_username}
                  onChange={(e) => setForm({ ...form, smtp_username: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('notif.smtpPassLabel')}</Label>
                <Input
                  type="password"
                  placeholder={editing?.has_secret ? t('notif.secretKeepHint') : ''}
                  value={form.smtp_password}
                  onChange={(e) => setForm({ ...form, smtp_password: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('notif.smtpFromLabel')}</Label>
                <Input
                  placeholder="metis@corp.com"
                  value={form.smtp_from}
                  onChange={(e) => setForm({ ...form, smtp_from: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('notif.smtpToLabel')}</Label>
                <Input
                  required
                  placeholder="cto@corp.com, lead@corp.com"
                  value={form.smtp_to}
                  onChange={(e) => setForm({ ...form, smtp_to: e.target.value })}
                />
              </div>
              <label className="sm:col-span-2 flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.smtp_use_tls}
                  onChange={(e) => setForm({ ...form, smtp_use_tls: e.target.checked })}
                  className="rounded border-zinc-700 accent-indigo-500"
                />
                <span>{t('notif.smtpTlsLabel')}</span>
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t('notif.webhookUrlLabel')}</Label>
                <Input
                  required={!editing}
                  placeholder={
                    editing
                      ? t('notif.webhookUrlKeepHint')
                      : 'https://open.feishu.cn/open-apis/bot/v2/hook/...'
                  }
                  value={form.webhook_url}
                  onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('notif.secretLabel')}</Label>
                <Input
                  type="password"
                  placeholder={editing?.has_secret ? t('notif.secretKeepHint') : ''}
                  value={form.signing_secret}
                  onChange={(e) => setForm({ ...form, signing_secret: e.target.value })}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>{t('notif.eventsLabel')}</Label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_EVENTS.map((ev) => {
                const checked = form.events.includes(ev)
                return (
                  <label
                    key={ev}
                    className="flex items-center gap-2 rounded-[var(--brand-radius-sm)] border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          events: e.target.checked
                            ? [...prev.events, ev]
                            : prev.events.filter((x) => x !== ev),
                        }))
                      }
                      className="rounded border-zinc-700 accent-indigo-500"
                    />
                    <span>{eventLabel(ev)}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {sandboxes.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t('notif.scopeLabel')}</Label>
              <div className="max-h-32 overflow-y-auto rounded-[var(--brand-radius-sm)] border border-zinc-800 bg-zinc-950/50 p-2 grid grid-cols-2 gap-1.5 text-xs">
                {sandboxes.map((sbx) => {
                  const checked = form.scope_sandbox_ids.includes(sbx.id)
                  return (
                    <label key={sbx.id} className="flex items-center gap-2 text-zinc-300 cursor-pointer truncate">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            scope_sandbox_ids: e.target.checked
                              ? [...prev.scope_sandbox_ids, sbx.id]
                              : prev.scope_sandbox_ids.filter((id) => id !== sbx.id),
                          }))
                        }
                        className="rounded border-zinc-700 accent-indigo-500 shrink-0"
                      />
                      <span className="font-mono truncate">@{sbx.slug}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="rounded border-zinc-700 accent-indigo-500"
            />
            <span>{t('notif.enabledLabel')}</span>
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
