import React, { useEffect, useState } from 'react'
import { Check, Copy, Globe, RefreshCw, Send } from 'lucide-react'
import { Badge, Button, Input, Select, cn } from '../ui'
import { apiFetch } from '../../lib/client.ts'
import { copyTextToClipboard } from '../../lib/format'
import { useI18n } from '../../lib/i18nContext'
import type { SandboxItem, WorkforceRuntimeData } from '../../types'

export function WorkforceWebhookCard({
  sandbox,
  isAdmin,
  notify,
  onSandboxUpdated,
}: {
  sandbox: SandboxItem
  isAdmin: boolean
  notify: (msg: string, type?: 'success' | 'error') => void
  onSandboxUpdated?: () => Promise<void> | void
}) {
  const { t } = useI18n()
  const [localWebhookUrl, setLocalWebhookUrl] = useState<string | null>(sandbox.webhook_url || null)
  const [rotatingWebhook, setRotatingWebhook] = useState(false)

  useEffect(() => {
    setLocalWebhookUrl(sandbox.webhook_url || null)
  }, [sandbox.id, sandbox.webhook_url])

  const handleRotateWebhook = async () => {
    if (!isAdmin) return
    setRotatingWebhook(true)
    try {
      const updated = await apiFetch<SandboxItem>(`/api/sandboxes/${sandbox.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ rotate_webhook_token: true }),
      })
      setLocalWebhookUrl(updated.webhook_url || null)
      notify(t('dialog.workforce.webhookRotated'))
      await onSandboxUpdated?.()
    } catch (err: any) {
      notify(err.message || 'Rotate failed', 'error')
    } finally {
      setRotatingWebhook(false)
    }
  }

  const effectiveWebhookUrl = localWebhookUrl || sandbox.webhook_url || null
  return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium text-zinc-200 flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-sky-400" />
              <span>{t('dialog.workforce.webhookTitle')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {effectiveWebhookUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void copyTextToClipboard(effectiveWebhookUrl).then((ok) =>
                      notify(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'success' : 'error'),
                    )
                  }}
                >
                  <Copy className="h-3 w-3" />
                  {t('dialog.workforce.copyWebhookBtn')}
                </Button>
              )}
              {isAdmin && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={rotatingWebhook}
                  onClick={handleRotateWebhook}
                >
                  <RefreshCw className={cn('h-3 w-3', rotatingWebhook && 'animate-spin')} />
                  {t('dialog.workforce.rotateWebhookBtn')}
                </Button>
              )}
            </div>
          </div>
          {effectiveWebhookUrl ? (
            <code className="block truncate rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 font-mono text-[11px] text-sky-300">
              POST {effectiveWebhookUrl}
            </code>
          ) : (
            <p className="text-zinc-500">{t('dialog.workforce.webhookNone')}</p>
          )}
        </div>

  )
}

export function WorkforceTaskDispatchCard({
  sandbox,
  apiBase,
  meshSummary,
  notify,
  onReload,
}: {
  sandbox: SandboxItem
  apiBase: string
  meshSummary: WorkforceRuntimeData['mesh_summary']
  notify: (msg: string, type?: 'success' | 'error') => void
  onReload: () => Promise<void>
}) {
  const { t } = useI18n()
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskPriority, setTaskPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
  const [taskRoomId, setTaskRoomId] = useState('')
  const [taskApprovalRequired, setTaskApprovalRequired] = useState(false)
  const [dispatchingTask, setDispatchingTask] = useState(false)
  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(null)

  const handleDispatchTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!taskTitle.trim()) return
    setDispatchingTask(true)
    try {
      await apiFetch(`${apiBase}/${sandbox.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: taskTitle.trim(),
          description: taskDesc.trim(),
          priority: taskPriority,
          room_id: taskRoomId || null,
          approval_required: taskApprovalRequired,
        }),
      })
      notify(t('dialog.workforce.taskDispatched'))
      setTaskTitle('')
      setTaskDesc('')
      setTaskApprovalRequired(false)
      await onReload()
    } catch (err: any) {
      notify(err.message || 'Dispatch failed', 'error')
    } finally {
      setDispatchingTask(false)
    }
  }

  const handleApprovalDecision = async (
    taskId: string,
    decision: 'approved' | 'rejected',
    roomId?: string,
  ) => {
    setDecidingApprovalId(taskId)
    try {
      await apiFetch(`${apiBase}/${sandbox.id}/approvals/${encodeURIComponent(taskId)}`, {
        method: 'POST',
        body: JSON.stringify({ decision, room_id: roomId || null }),
      })
      notify(t('dialog.workforce.approvalDecided', { decision }))
      await onReload()
    } catch (err: any) {
      notify(err.message || 'Decision failed', 'error')
    } finally {
      setDecidingApprovalId(null)
    }
  }

  return (
            <div className="rounded-xl border border-indigo-500/30 bg-zinc-950/70 p-3.5 space-y-3">
              <div className="font-medium text-zinc-100 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Send className="h-3.5 w-3.5 text-indigo-400" />
                  {t('dialog.workforce.dispatchTitle')}
                </span>
                {meshSummary && meshSummary.pending_approvals.length > 0 && (
                  <Badge variant="warning">
                    {t('dialog.workforce.pendingApprovals', {
                      count: meshSummary.pending_approvals.length,
                    })}
                  </Badge>
                )}
              </div>

              {meshSummary && meshSummary.pending_approvals.length > 0 && (
                <div className="space-y-2">
                  {meshSummary.pending_approvals.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-amber-100 truncate">{item.title}</div>
                        <div className="text-[11px] text-amber-300/80 font-mono">
                          #{item.id}
                          {item.assignee_slug ? ` · @${item.assignee_slug}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          type="button"
                          variant="emerald"
                          size="sm"
                          disabled={decidingApprovalId === item.id}
                          onClick={() => handleApprovalDecision(item.id, 'approved', item.room_id)}
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t('dialog.workforce.approveBtn')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-rose-500/40 text-rose-300 hover:bg-rose-950/40"
                          disabled={decidingApprovalId === item.id}
                          onClick={() => handleApprovalDecision(item.id, 'rejected', item.room_id)}
                        >
                          {t('dialog.workforce.rejectBtn')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleDispatchTask} className="space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-6">
                    <Input
                      required
                      placeholder={t('dialog.workforce.taskTitlePlaceholder')}
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Select
                      value={taskPriority}
                      onChange={(e) => setTaskPriority(e.target.value as any)}
                    >
                      <option value="low">low</option>
                      <option value="normal">normal</option>
                      <option value="high">high</option>
                      <option value="urgent">urgent</option>
                    </Select>
                  </div>
                  <div className="sm:col-span-3">
                    <Select value={taskRoomId} onChange={(e) => setTaskRoomId(e.target.value)}>
                      <option value="">Direct Inbox</option>
                      {(meshSummary?.groups || []).map((g) => (
                        <option key={g.id} value={g.id}>
                          #{g.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <Input
                    className="flex-1"
                    placeholder={t('dialog.workforce.taskDescPlaceholder')}
                    value={taskDesc}
                    onChange={(e) => setTaskDesc(e.target.value)}
                  />
                  <label className="flex items-center gap-1.5 text-zinc-300 shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={taskApprovalRequired}
                      onChange={(e) => setTaskApprovalRequired(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900 accent-indigo-500"
                    />
                    <span>{t('dialog.workforce.approvalRequiredLabel')}</span>
                  </label>
                  <Button type="submit" size="sm" disabled={dispatchingTask || !taskTitle.trim()} className="shrink-0">
                    <Send className="h-3.5 w-3.5" />
                    {t('dialog.workforce.dispatchBtn')}
                  </Button>
                </div>
              </form>
            </div>

  )
}
