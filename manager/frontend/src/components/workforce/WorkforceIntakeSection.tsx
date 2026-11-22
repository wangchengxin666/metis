import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Globe, ListChecks, RefreshCw } from 'lucide-react'
import { Badge, Button, cn } from '../ui'
import { apiFetch } from '../../lib/client.ts'
import { copyTextToClipboard } from '../../lib/format'
import { useI18n } from '../../lib/i18nContext'
import type { SandboxItem, WorkforceRuntimeData } from '../../types'

const TASK_PAGE_SIZE = 8

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
    <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 p-4 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-base text-zinc-100 flex items-center gap-2">
          <Globe className="h-4 w-4 text-sky-400" />
          <span>{t('dialog.workforce.webhookTitle')}</span>
        </div>
        <div className="flex items-center gap-2">
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
              <Copy className="h-3.5 w-3.5" />
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
              <RefreshCw className={cn('h-3.5 w-3.5', rotatingWebhook && 'animate-spin')} />
              {t('dialog.workforce.rotateWebhookBtn')}
            </Button>
          )}
        </div>
      </div>
      {effectiveWebhookUrl ? (
        <code className="block truncate rounded-[var(--brand-radius-sm)] border border-zinc-800 bg-zinc-900/80 px-3 py-2 font-mono text-xs text-sky-300">
          POST {effectiveWebhookUrl}
        </code>
      ) : (
        <p className="text-sm text-zinc-400">{t('dialog.workforce.webhookNone')}</p>
      )}
    </div>
  )
}

export function WorkforceTaskObserverCard({
  sandbox,
  apiBase,
  meshSummary,
  searchQuery,
  taskFilter,
  onTaskFilterChange,
  notify,
  onReload,
}: {
  sandbox: SandboxItem
  apiBase: string
  meshSummary: WorkforceRuntimeData['mesh_summary']
  searchQuery: string
  taskFilter: 'all' | 'active' | 'done' | 'approval'
  onTaskFilterChange: (next: 'all' | 'active' | 'done' | 'approval') => void
  notify: (msg: string, type?: 'success' | 'error') => void
  onReload: () => Promise<void>
}) {
  const { t } = useI18n()
  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(null)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [limit, setLimit] = useState(TASK_PAGE_SIZE)

  useEffect(() => {
    setLimit(TASK_PAGE_SIZE)
  }, [searchQuery, taskFilter, sandbox.id])

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

  const allTasks = meshSummary?.tasks || []
  const pendingApprovals = meshSummary?.pending_approvals || []
  const q = searchQuery.trim().toLowerCase()

  const filteredTasks = allTasks.filter((tk) => {
    if (
      q &&
      !`${tk.title} ${tk.description || ''} ${tk.assignee_slug || ''} ${tk.id}`
        .toLowerCase()
        .includes(q)
    ) {
      return false
    }
    if (taskFilter === 'active') return tk.status !== 'done' && tk.status !== 'cancelled'
    if (taskFilter === 'done') return tk.status === 'done'
    if (taskFilter === 'approval') return Boolean(tk.approval_required && tk.approval_status === 'pending')
    return true
  })

  const remaining = filteredTasks.length - limit

  return (
    <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 p-4 space-y-3.5">
      <div className="font-medium text-zinc-100 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4 text-indigo-400" />
          {t('dialog.workforce.dispatchTitle')}
          <Badge variant="outline">{filteredTasks.length}</Badge>
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: `${t('dialog.workforce.filterAll')} (${allTasks.length})` },
              {
                id: 'active',
                label: `${t('dialog.workforce.filterActive')} (${meshSummary?.active_tasks_count ?? 0})`,
              },
              {
                id: 'done',
                label: `${t('dialog.workforce.filterDone')} (${meshSummary?.done_tasks_count ?? 0})`,
              },
              {
                id: 'approval',
                label: `${t('dialog.workforce.filterApproval')} (${pendingApprovals.length})`,
              },
            ] as const
          ).map((pf) => (
            <button
              key={pf.id}
              type="button"
              onClick={() => onTaskFilterChange(pf.id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer border',
                taskFilter === pf.id
                  ? 'brand-tab-active border-transparent'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700',
              )}
            >
              {pf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Pending Human Approvals */}
      {pendingApprovals.length > 0 && (
        <div className="space-y-2">
          {pendingApprovals.map((item) => (
            <div
              key={item.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-[var(--brand-radius-md)] border border-amber-500/35 bg-amber-950/25 px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm text-amber-100 truncate">{item.title}</div>
                <div className="text-xs text-amber-300/80 font-mono">
                  #{item.id}
                  {item.assignee_slug ? ` · @${item.assignee_slug}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
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

      {/* Compact Expandable Task List + Pagination */}
      {filteredTasks.length === 0 ? (
        <p className="text-sm text-zinc-400">
          {q ? t('dialog.workforce.noMatch', { query: searchQuery }) : '—'}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredTasks.slice(0, limit).map((tk) => {
            const expanded = expandedTaskId === tk.id
            return (
              <div
                key={tk.id}
                className="rounded-[var(--brand-radius-md)] border border-zinc-800/90 bg-zinc-900/50 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setExpandedTaskId(expanded ? null : tk.id)}
                  className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-zinc-800/35 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-zinc-400 shrink-0" />
                    )}
                    <span
                      className={cn(
                        'font-medium text-sm text-zinc-100 truncate',
                        tk.status === 'done' && 'line-through opacity-70',
                      )}
                    >
                      {tk.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {tk.assignee_slug && (
                      <span className="font-mono text-xs text-zinc-400 hidden sm:inline">
                        @{tk.assignee_slug}
                      </span>
                    )}
                    {tk.priority && tk.priority !== 'normal' && (
                      <Badge variant="outline" className="font-mono">
                        {tk.priority}
                      </Badge>
                    )}
                    <Badge variant={tk.status === 'done' ? 'success' : 'secondary'}>
                      {tk.status}
                    </Badge>
                  </div>
                </button>
                {expanded && (
                  <div className="border-t border-zinc-800/70 px-4 py-3 text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto bg-zinc-950/50">
                    {tk.description || `#${tk.id}`}
                  </div>
                )}
              </div>
            )
          })}

          {filteredTasks.length > TASK_PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 pt-1">
              {remaining > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLimit((n) => n + TASK_PAGE_SIZE)}
                >
                  {t('dialog.workforce.loadMoreBtn', { remaining })}
                </Button>
              )}
              {limit > TASK_PAGE_SIZE && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLimit(TASK_PAGE_SIZE)}
                >
                  {t('dialog.workforce.collapseBtn')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
