import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  ExternalLink,
  FolderKanban,
  GitBranch,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  User,
  XCircle,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  Input,
  Label,
  Select,
  Textarea,
  cn,
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type {
  AuthMe,
  SandboxItem,
  ToolApprovalRequestItem,
  WorkspaceInboxData,
  WorkspaceInboxTask,
  WorkspacePlaybookApproval,
  WorkspaceTaskGroup,
} from '../../types'

const GROUP_PAGE_SIZE = 15

type InboxTab = 'todo' | 'active' | 'done'
type GroupByMode = 'task' | 'project' | 'employee'

function formatRelativeShort(ts: number | string | null | undefined, locale: string): string {
  if (!ts) return ''
  const ms =
    typeof ts === 'number'
      ? ts < 1e12
        ? ts * 1000
        : ts
      : Date.parse(String(ts))
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  const isZh = locale === 'zh-CN'
  if (diffSec < 60) return isZh ? '刚刚' : 'just now'
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60)
    return isZh ? `${m} 分钟前` : `${m}m ago`
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600)
    return isZh ? `${h} 小时前` : `${h}h ago`
  }
  const d = Math.floor(diffSec / 86400)
  if (d < 14) return isZh ? `${d} 天前` : `${d}d ago`
  return new Date(ms).toLocaleDateString()
}

export function InboxView({
  auth,
  notify,
  onPendingCountChange,
  onOpenProject,
}: {
  auth: AuthMe
  notify: (msg: string, type?: 'success' | 'error') => void
  onPendingCountChange?: (count: number) => void
  onOpenProject?: (projectId: string) => void
}) {
  const { t, locale } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  const [data, setData] = useState<WorkspaceInboxData | null>(null)
  const [sandboxes, setSandboxes] = useState<SandboxItem[]>([])
  const [toolApprovals, setToolApprovals] = useState<ToolApprovalRequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const [activeTab, setActiveTab] = useState<InboxTab>('todo')
  const [groupBy, setGroupBy] = useState<GroupByMode>('task')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Record<string, boolean>>({})
  const [expandedTaskKey, setExpandedTaskKey] = useState<string | null>(null)
  const [limit, setLimit] = useState(GROUP_PAGE_SIZE)

  // Approval notes & busy state
  const [notesMap, setNotesMap] = useState<Record<string, string>>({})
  const [decidingKey, setDecidingKey] = useState<string | null>(null)
  const [updatingTaskKey, setUpdatingTaskKey] = useState<string | null>(null)

  // Quick Dispatch Task Modal
  const [dispatchOpen, setDispatchOpen] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [dispatchForm, setDispatchForm] = useState({
    sandbox_id: '',
    title: '',
    description: '',
    priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    approval_required: false,
  })

  const apiBase = auth.admin ? '/api/sandboxes' : '/api/my/sandboxes'

  const loadInbox = useCallback(
    async (opts?: { refresh?: boolean; silent?: boolean }) => {
      const refresh = Boolean(opts?.refresh)
      const silent = Boolean(opts?.silent)
      if (refresh) setSyncing(true)
      else if (!silent) setLoading(true)
      try {
        const [inboxRes, sbxRes, toolRes] = await Promise.all([
          apiFetch<WorkspaceInboxData>(`/api/workspace/inbox${refresh ? '?refresh=true' : ''}`),
          apiFetch<{ items: SandboxItem[] }>(apiBase),
          apiFetch<{ items: ToolApprovalRequestItem[] }>('/api/tool-approvals?status=pending').catch(
            () => ({ items: [] as ToolApprovalRequestItem[] }),
          ),
        ])
        setData(inboxRes)
        setSandboxes(sbxRes.items || [])
        const pendingTools = toolRes.items || []
        setToolApprovals(pendingTools)
        onPendingCountChange?.(
          (inboxRes.summary.action_required_count ?? inboxRes.summary.pending_approvals_count) +
            pendingTools.length,
        )
      } catch (err: any) {
        if (!silent) {
          notify(err.message || tRef.current('admin.loadFailed'), 'error')
        }
      } finally {
        setSyncing(false)
        if (!silent) setLoading(false)
      }
    },
    [apiBase, notify, onPendingCountChange],
  )

  useEffect(() => {
    void loadInbox()
  }, [loadInbox])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadInbox({ silent: true })
      }
    }, 15000)
    return () => window.clearInterval(timer)
  }, [loadInbox])

  const handleForceSync = async () => {
    setSyncing(true)
    try {
      const res = await apiFetch<{ refreshed: number; total: number }>('/api/workspace/refresh', {
        method: 'POST',
      })
      notify(t('inbox.syncedToast', { refreshed: res.refreshed, total: res.total }))
      await loadInbox({ silent: true })
    } catch (err: any) {
      notify(err.message || t('admin.loadFailed'), 'error')
    } finally {
      setSyncing(false)
    }
  }

  const handleApprovalDecision = async (
    task: WorkspaceInboxTask,
    decision: 'approved' | 'rejected',
  ) => {
    const key = `mesh:${task.room_id}:${task.id}`
    setDecidingKey(key)
    try {
      await apiFetch(
        `${apiBase}/${task.sandbox_id}/approvals/${encodeURIComponent(task.id)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            note: (notesMap[key] || '').trim(),
            room_id: task.room_id || null,
          }),
        },
      )
      notify(t('dialog.workforce.approvalDecided', { decision }))
      setNotesMap((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      await loadInbox({ silent: true })
    } catch (err: any) {
      notify(err.message || 'Decision failed', 'error')
    } finally {
      setDecidingKey(null)
    }
  }

  const handlePlaybookStepDecision = async (
    item: WorkspacePlaybookApproval,
    decision: 'approved' | 'revise' | 'rejected',
  ) => {
    const key = `pb:${item.run_id}:${item.id}`
    setDecidingKey(key)
    try {
      await apiFetch(
        `/api/playbook-runs/${encodeURIComponent(item.run_id)}/steps/${encodeURIComponent(item.id)}/decide`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            note: (notesMap[key] || '').trim(),
          }),
        },
      )
      notify(
        t(
          decision === 'approved'
            ? 'playbooks.stepApproved'
            : decision === 'revise'
              ? 'playbooks.stepRevised'
              : 'playbooks.stepRejected',
        ),
      )
      setNotesMap((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      await loadInbox({ silent: true })
    } catch (err: any) {
      notify(err.message || t('admin.loadFailed'), 'error')
    } finally {
      setDecidingKey(null)
    }
  }

  const handleToolApprovalDecision = async (
    item: ToolApprovalRequestItem,
    decision: 'approved' | 'rejected',
  ) => {
    const key = `tool:${item.id}`
    setDecidingKey(key)
    try {
      await apiFetch(`/api/tool-approvals/${encodeURIComponent(item.id)}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          note: (notesMap[key] || '').trim(),
        }),
      })
      notify(t('inbox.toolDecided', { decision }))
      setNotesMap((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      await loadInbox({ silent: true })
    } catch (err: any) {
      notify(err.message || t('admin.loadFailed'), 'error')
    } finally {
      setDecidingKey(null)
    }
  }

  const handleTaskStatusUpdate = async (
    task: WorkspaceInboxTask,
    status: 'done' | 'cancelled',
  ) => {
    const key = `${task.room_id}:${task.id}`
    setUpdatingTaskKey(key)
    try {
      await apiFetch(
        `${apiBase}/${task.sandbox_id}/tasks/${encodeURIComponent(task.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status,
            room_id: task.room_id || null,
            notify_moderator: false,
          }),
        },
      )
      notify(t(status === 'done' ? 'inbox.taskResolvedToast' : 'inbox.taskDismissedToast'))
      await loadInbox({ silent: true })
    } catch (err: any) {
      notify(err.message || t('admin.loadFailed'), 'error')
    } finally {
      setUpdatingTaskKey(null)
    }
  }

  const runningSandboxes = sandboxes.filter((s) => s.status === 'running')

  const openDispatchDialog = () => {
    setDispatchForm({
      sandbox_id: runningSandboxes[0]?.id || '',
      title: '',
      description: '',
      priority: 'normal',
      approval_required: false,
    })
    setDispatchOpen(true)
  }

  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dispatchForm.sandbox_id || !dispatchForm.title.trim()) return
    setDispatching(true)
    try {
      await apiFetch(`${apiBase}/${dispatchForm.sandbox_id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: dispatchForm.title.trim(),
          description: dispatchForm.description.trim(),
          priority: dispatchForm.priority,
          approval_required: dispatchForm.approval_required,
        }),
      })
      notify(t('dialog.workforce.taskDispatched'))
      setDispatchOpen(false)
      await loadInbox({ silent: true })
    } catch (err: any) {
      notify(err.message || 'Dispatch failed', 'error')
    } finally {
      setDispatching(false)
    }
  }

  const toggleGroup = (gKey: string) => {
    setExpandedGroupKeys((prev) => ({ ...prev, [gKey]: !prev[gKey] }))
  }

  const summary = data?.summary
  const pendingApprovals = data?.pending_approvals || []
  const playbookApprovals = data?.playbook_approvals || []
  const blockedTasks = data?.blocked_tasks || []

  // Fall back to constructing groups client-side if talking to an older backend response
  const allGroups: WorkspaceTaskGroup[] = useMemo(() => {
    if (Array.isArray(data?.task_groups)) return data.task_groups
    const rawTasks = data?.tasks || []
    return rawTasks.map((tk) => ({
      key: `${tk.room_id}:${tk.id}`,
      room_id: tk.room_id,
      room_name: tk.room_name,
      thread_id: tk.thread_id || '',
      title: tk.title,
      project_team_id: tk.project_team_id || null,
      project_team_name: tk.project_team_name || null,
      status:
        tk.status === 'blocked'
          ? 'blocked'
          : tk.approval_required && tk.approval_status === 'pending'
            ? 'pending_approval'
            : tk.status === 'done'
              ? 'done'
              : tk.status === 'cancelled'
                ? 'cancelled'
                : 'active',
      counts: {
        total: tk.status === 'cancelled' ? 0 : 1,
        done: tk.status === 'done' ? 1 : 0,
        active: tk.status !== 'done' && tk.status !== 'cancelled' ? 1 : 0,
        blocked: tk.status === 'blocked' ? 1 : 0,
        cancelled: tk.status === 'cancelled' ? 1 : 0,
        pending_approvals: tk.approval_required && tk.approval_status === 'pending' ? 1 : 0,
      },
      participants: [
        {
          sandbox_id: tk.sandbox_id,
          sandbox_slug: tk.sandbox_slug,
          role_title: tk.role_title || null,
        },
      ],
      updated_at: typeof tk.updated_at === 'number' ? tk.updated_at : null,
      tasks: [tk],
    }))
  }, [data])

  const activeGroups = useMemo(
    () =>
      allGroups.filter((g) =>
        g.status === 'blocked' || g.status === 'pending_approval' || g.status === 'active',
      ),
    [allGroups],
  )

  const doneGroups = useMemo(
    () =>
      allGroups.filter(
        (g) => g.status === 'done' || (showCancelled && g.status === 'cancelled'),
      ),
    [allGroups, showCancelled],
  )

  const actionRequiredCount =
    pendingApprovals.length + playbookApprovals.length + blockedTasks.length + toolApprovals.length

  const currentTabGroups = activeTab === 'active' ? activeGroups : doneGroups
  const q = searchQuery.trim().toLowerCase()

  const filteredGroups = useMemo(() => {
    if (!q) return currentTabGroups
    return currentTabGroups.filter((g) => {
      const groupHaystack = `${g.title} ${g.room_name} ${g.project_team_name || ''} ${g.participants.map((p) => p.sandbox_slug).join(' ')}`
      if (groupHaystack.toLowerCase().includes(q)) return true
      return g.tasks.some((tk) =>
        `${tk.title} ${tk.description} ${tk.summary} ${tk.sandbox_slug} ${tk.role_title || ''}`
          .toLowerCase()
          .includes(q),
      )
    })
  }, [currentTabGroups, q])

  const cancelledCountInTab = useMemo(
    () =>
      allGroups
        .filter((g) =>
          activeTab === 'active'
            ? g.status === 'blocked' || g.status === 'pending_approval' || g.status === 'active'
            : g.status === 'done' || g.status === 'cancelled',
        )
        .reduce((acc, g) => acc + g.counts.cancelled, 0),
    [allGroups, activeTab],
  )

  const projectBuckets = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string
        projectId: string | null
        projectName: string
        groups: WorkspaceTaskGroup[]
        doneSubtasks: number
        totalSubtasks: number
      }
    >()
    for (const g of filteredGroups) {
      const pName = g.project_team_name || t('inbox.unassignedProject')
      const pKey = g.project_team_id || `name:${pName}`
      const slot = map.get(pKey) || {
        key: pKey,
        projectId: g.project_team_id || null,
        projectName: pName,
        groups: [],
        doneSubtasks: 0,
        totalSubtasks: 0,
      }
      slot.groups.push(g)
      slot.doneSubtasks += g.counts.done
      slot.totalSubtasks += g.counts.total
      map.set(pKey, slot)
    }
    return [...map.values()]
  }, [filteredGroups, t])

  const employeeBuckets = useMemo(() => {
    const map = new Map<
      string,
      {
        sandbox_id: string
        sandbox_slug: string
        role_title: string | null
        tasks: Array<WorkspaceInboxTask & { groupTitle: string }>
        doneCount: number
        blockedCount: number
      }
    >()
    for (const g of filteredGroups) {
      for (const tk of g.tasks) {
        if (!showCancelled && tk.status === 'cancelled') continue
        const key = tk.sandbox_slug || tk.sandbox_id
        const slot = map.get(key) || {
          sandbox_id: tk.sandbox_id,
          sandbox_slug: tk.sandbox_slug,
          role_title: tk.role_title || null,
          tasks: [],
          doneCount: 0,
          blockedCount: 0,
        }
        slot.tasks.push({ ...tk, groupTitle: g.title })
        if (tk.status === 'done') slot.doneCount += 1
        if (tk.status === 'blocked') slot.blockedCount += 1
        map.set(key, slot)
      }
    }
    return [...map.values()].sort((a, b) => b.blockedCount - a.blockedCount || b.tasks.length - a.tasks.length)
  }, [filteredGroups, showCancelled])

  const renderTaskDetailBox = (tk: WorkspaceInboxTask) => {
    const key = `${tk.room_id}:${tk.id}`
    return (
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 text-zinc-400">
          <div className="flex flex-wrap items-center gap-2 font-mono">
            <span>#{tk.id}</span>
            <span>· @{tk.sandbox_slug}</span>
            {tk.role_title && <span>· {tk.role_title}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {tk.status === 'blocked' && (
              <>
                <Button
                  type="button"
                  variant="emerald"
                  size="sm"
                  className="whitespace-nowrap h-7 px-2.5 text-xs"
                  disabled={updatingTaskKey === key}
                  onClick={() => void handleTaskStatusUpdate(tk, 'done')}
                >
                  <Check className="h-3 w-3" />
                  {t('inbox.resolveBlockedBtn')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="whitespace-nowrap h-7 px-2.5 text-xs"
                  disabled={updatingTaskKey === key}
                  onClick={() => void handleTaskStatusUpdate(tk, 'cancelled')}
                >
                  <XCircle className="h-3 w-3" />
                  {t('inbox.dismissBlockedBtn')}
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="whitespace-nowrap h-7 px-2.5 text-xs"
              onClick={() => window.open(`/sandboxes/${tk.sandbox_id}/open`, '_blank')}
            >
              <ExternalLink className="h-3 w-3" />
              {t('inbox.openEmployeeBtn')}
            </Button>
          </div>
        </div>
        {tk.description && (
          <p className="text-zinc-300 whitespace-pre-wrap leading-relaxed">{tk.description}</p>
        )}
        {tk.summary && (
          <p
            className={cn(
              'whitespace-pre-wrap leading-relaxed',
              tk.status === 'blocked'
                ? 'text-rose-300/90'
                : tk.status === 'cancelled'
                  ? 'text-zinc-500'
                  : 'text-emerald-300/90',
            )}
          >
            {tk.summary}
          </p>
        )}
        {tk.artifacts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {tk.artifacts.map((art, idx) => (
              <Badge key={idx} variant="outline" className="font-mono text-[11px]">
                {art}
              </Badge>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderGroupCard = (g: WorkspaceTaskGroup, hideProjectBadge = false) => {
    const expanded = Boolean(expandedGroupKeys[g.key])
    const visibleSubtasks = showCancelled
      ? g.tasks
      : g.tasks.filter((tk) => tk.status !== 'cancelled')
    const progressPct =
      g.counts.total > 0 ? Math.round((g.counts.done / g.counts.total) * 100) : g.status === 'done' ? 100 : 0
    const singleStandalone = visibleSubtasks.length === 1 && g.counts.cancelled === 0

    return (
      <div
        key={g.key}
        className={cn(
          'rounded-[var(--brand-radius-md)] border bg-zinc-950/60 overflow-hidden transition-colors',
          g.status === 'blocked'
            ? 'border-rose-500/40'
            : g.status === 'pending_approval'
              ? 'border-amber-500/40'
              : 'border-zinc-800/90 hover:border-zinc-700/90',
        )}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleGroup(g.key)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleGroup(g.key)
            }
          }}
          className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-zinc-900/50 transition-colors cursor-pointer"
        >
          <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
            <span className="mt-0.5 sm:mt-0 text-zinc-400 shrink-0">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
            <span className="mt-0.5 sm:mt-0 shrink-0">
              {g.status === 'done' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : g.status === 'blocked' ? (
                <AlertTriangle className="h-4 w-4 text-rose-400" />
              ) : g.status === 'pending_approval' ? (
                <ShieldAlert className="h-4 w-4 text-amber-400" />
              ) : (
                <Clock className="h-4 w-4 text-indigo-400" />
              )}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm text-zinc-100 truncate">{g.title}</span>
                {!hideProjectBadge && g.project_team_name && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (g.project_team_id && onOpenProject) {
                        onOpenProject(g.project_team_id)
                      }
                    }}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border border-violet-500/35 bg-violet-950/30 px-2 py-0.5 text-[11px] text-violet-300',
                      g.project_team_id && onOpenProject && 'hover:bg-violet-900/40 cursor-pointer',
                    )}
                  >
                    <FolderKanban className="h-3 w-3 shrink-0" />
                    <span className="truncate max-w-[160px]">{g.project_team_name}</span>
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <div className="flex flex-wrap items-center gap-1">
                  {g.participants.slice(0, 3).map((p) => (
                    <span
                      key={p.sandbox_slug}
                      className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300"
                    >
                      @{p.sandbox_slug}
                    </span>
                  ))}
                  {g.participants.length > 3 && (
                    <span className="text-[11px] text-zinc-500">+{g.participants.length - 3}</span>
                  )}
                </div>
                {g.updated_at && (
                  <span className="text-zinc-500">· {formatRelativeShort(g.updated_at, locale)}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pl-7 sm:pl-0 shrink-0">
            {g.counts.total > 1 ? (
              <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      g.status === 'blocked'
                        ? 'bg-rose-400'
                        : g.status === 'done'
                          ? 'bg-emerald-400'
                          : 'bg-indigo-400',
                    )}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="font-mono text-xs text-zinc-300 whitespace-nowrap">
                  {g.counts.done}/{g.counts.total}
                </span>
              </div>
            ) : (
              <Badge
                variant={
                  g.status === 'done'
                    ? 'success'
                    : g.status === 'blocked'
                      ? 'destructive'
                      : g.status === 'pending_approval'
                        ? 'warning'
                        : 'secondary'
                }
                className="whitespace-nowrap"
              >
                {g.status === 'done'
                  ? t('inbox.tabDone')
                  : g.status === 'blocked'
                    ? t('inbox.filterBlocked')
                    : g.status === 'pending_approval'
                      ? t('inbox.filterPending')
                      : t('inbox.tabActive')}
              </Badge>
            )}
          </div>
        </div>

        {expanded && (
          <div className="border-t border-zinc-800/80 bg-zinc-950/80 px-4 py-3">
            {singleStandalone ? (
              renderTaskDetailBox(visibleSubtasks[0])
            ) : (
              <div className="space-y-1.5">
                {visibleSubtasks.map((tk, idx) => {
                  const subKey = `${tk.room_id}:${tk.id}`
                  const subOpen = expandedTaskKey === subKey
                  return (
                    <div
                      key={subKey}
                      className="rounded-[var(--brand-radius-sm)] border border-zinc-800/70 bg-zinc-900/35 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedTaskKey(subOpen ? null : subKey)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-800/30 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="font-mono text-[11px] text-zinc-500 w-5 text-right shrink-0">
                            {idx + 1}.
                          </span>
                          <span
                            className={cn(
                              'text-xs font-medium text-zinc-200 truncate',
                              tk.status === 'cancelled' && 'line-through text-zinc-500',
                            )}
                          >
                            {tk.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-[11px] text-zinc-400 hidden sm:inline">
                            @{tk.sandbox_slug}
                          </span>
                          <Badge
                            variant={
                              tk.status === 'done'
                                ? 'success'
                                : tk.status === 'blocked'
                                  ? 'destructive'
                                  : tk.status === 'cancelled'
                                    ? 'outline'
                                    : 'secondary'
                            }
                            className="text-[11px] whitespace-nowrap"
                          >
                            {tk.status}
                          </Badge>
                        </div>
                      </button>
                      {subOpen && (
                        <div className="border-t border-zinc-800/70 px-3 py-2.5 bg-zinc-950/70">
                          {renderTaskDetailBox(tk)}
                        </div>
                      )}
                    </div>
                  )
                })}

                {!showCancelled && g.counts.cancelled > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowCancelled(true)}
                    className="w-full pt-1.5 text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                  >
                    {t('inbox.hiddenCancelledHint', { count: g.counts.cancelled })}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const remainingGroups = filteredGroups.length - limit

  return (
    <div className="space-y-5">
      {/* Compact Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">{t('inbox.title')}</h1>
          {summary?.last_synced_at && (
            <span className="text-xs text-zinc-500 font-mono">
              {t('inbox.lastSynced', { time: new Date(summary.last_synced_at).toLocaleTimeString() })}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={syncing}
            onClick={() => void handleForceSync()}
          >
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
            {syncing ? t('inbox.syncing') : t('inbox.syncBtn')}
          </Button>
          <Button
            size="sm"
            disabled={runningSandboxes.length === 0}
            onClick={openDispatchDialog}
          >
            <Plus className="h-4 w-4" />
            {t('inbox.dispatchBtn')}
          </Button>
        </div>
      </div>

      {/* 3-Tab Action-First Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-900/70 p-1 gap-1">
          {(
            [
              {
                id: 'todo' as const,
                label: t('inbox.tabTodo'),
                count: actionRequiredCount,
                highlight: actionRequiredCount > 0,
              },
              {
                id: 'active' as const,
                label: t('inbox.tabActive'),
                count: activeGroups.length,
                highlight: false,
              },
              {
                id: 'done' as const,
                label: t('inbox.tabDone'),
                count: doneGroups.length,
                highlight: false,
              },
            ]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id)
                setLimit(GROUP_PAGE_SIZE)
              }}
              className={cn(
                'inline-flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap',
                activeTab === tab.id
                  ? 'brand-tab-active shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-100',
              )}
            >
              <span>{tab.label}</span>
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-mono',
                  tab.highlight
                    ? 'bg-rose-500/25 text-rose-200 border border-rose-500/40'
                    : activeTab === tab.id
                      ? 'bg-white/15 text-current'
                      : 'bg-zinc-800 text-zinc-400',
                )}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Grouping & Search Controls (only on Active / Done tabs) */}
        {activeTab !== 'todo' && (
          <div className="flex flex-wrap items-center gap-2 flex-1 sm:flex-initial justify-end">
            <div className="relative min-w-[200px] flex-1 sm:w-60 sm:flex-initial">
              <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                className="pl-9 h-9 text-xs"
                placeholder={t('inbox.searchPlaceholderV2')}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setLimit(GROUP_PAGE_SIZE)
                }}
              />
            </div>

            <div className="inline-flex items-center rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-900/70 p-0.5">
              {(
                [
                  { id: 'task' as const, label: t('inbox.groupByTask'), icon: Layers },
                  { id: 'project' as const, label: t('inbox.groupByProject'), icon: FolderKanban },
                  { id: 'employee' as const, label: t('inbox.groupByEmployee'), icon: User },
                ]
              ).map((m) => {
                const Icon = m.icon
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setGroupBy(m.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-[var(--brand-radius-sm)] px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                      groupBy === m.id
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{m.label}</span>
                  </button>
                )
              })}
            </div>

            {cancelledCountInTab > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-xs text-zinc-400 hover:text-zinc-200 whitespace-nowrap"
                onClick={() => setShowCancelled((v) => !v)}
              >
                {showCancelled ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showCancelled
                  ? t('inbox.hideCancelledBtn')
                  : t('inbox.showCancelledBtn', { count: cancelledCountInTab })}
              </Button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">{t('portal.loadingList')}</div>
      ) : activeTab === 'todo' ? (
        /* TAB 1: ACTION REQUIRED (INBOX ZERO) */
        actionRequiredCount === 0 ? (
          <Card className="border-zinc-800/80 bg-zinc-950/40">
            <CardContent className="py-14 px-6 flex flex-col items-center text-center space-y-3">
              <div className="h-12 w-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-zinc-100">{t('inbox.zeroTitle')}</h2>
                <p className="text-sm text-zinc-400 max-w-md">{t('inbox.zeroDesc')}</p>
              </div>
              {(activeGroups.length > 0 || doneGroups.length > 0) && (
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  {activeGroups.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveTab('active')}
                    >
                      {t('inbox.jumpActiveBtn', { count: activeGroups.length })}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {doneGroups.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveTab('done')}
                    >
                      {t('inbox.jumpDoneBtn', { count: doneGroups.length })}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {/* 1. Blocked Task Alerts */}
            {blockedTasks.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-rose-300">
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                  <span>{t('inbox.blockedTitle')}</span>
                  <Badge variant="destructive">{blockedTasks.length}</Badge>
                </div>
                <div className="space-y-2.5">
                  {blockedTasks.map((tk) => {
                    const key = `${tk.room_id}:${tk.id}`
                    const busy = updatingTaskKey === key
                    return (
                      <div
                        key={`blk:${key}`}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-[var(--brand-radius-md)] border border-rose-500/35 bg-rose-950/20 px-4 py-3.5"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-sm text-zinc-100">{tk.title}</span>
                            {tk.project_team_name && (
                              <Badge variant="outline" className="border-violet-500/40 text-violet-300 text-[11px]">
                                {tk.project_team_name}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-zinc-400 flex flex-wrap items-center gap-2">
                            <span className="font-mono text-rose-300">@{tk.sandbox_slug}</span>
                            {tk.role_title && <span>· {tk.role_title}</span>}
                            {tk.summary && <span className="text-zinc-300">· {tk.summary}</span>}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <Button
                            type="button"
                            variant="emerald"
                            size="sm"
                            className="whitespace-nowrap"
                            disabled={busy}
                            onClick={() => void handleTaskStatusUpdate(tk, 'done')}
                          >
                            <Check className="h-3.5 w-3.5" />
                            {t('inbox.resolveBlockedBtn')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="whitespace-nowrap"
                            disabled={busy}
                            onClick={() => void handleTaskStatusUpdate(tk, 'cancelled')}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            {t('inbox.dismissBlockedBtn')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="whitespace-nowrap"
                            onClick={() => window.open(`/sandboxes/${tk.sandbox_id}/open`, '_blank')}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {t('inbox.openEmployeeBtn')}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 2. Unified Playbook Pending Stage Approvals */}
            {playbookApprovals.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                  <GitBranch className="h-4 w-4 text-amber-400" />
                  <span>{t('inbox.playbookApprovalsTitle')}</span>
                  <Badge variant="warning">{playbookApprovals.length}</Badge>
                </div>
                <div className="space-y-3">
                  {playbookApprovals.map((item) => {
                    const key = `pb:${item.run_id}:${item.id}`
                    const busy = decidingKey === key
                    return (
                      <div
                        key={key}
                        className="rounded-[var(--brand-radius-md)] border border-amber-500/35 bg-amber-950/15 p-4 space-y-3"
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                          <div className="space-y-1.5 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="border-indigo-500/40 text-indigo-300 text-[11px]">
                                {t('inbox.stageBadge', { n: item.stage_index + 1, name: item.stage_name })}
                              </Badge>
                              <span className="font-semibold text-sm text-zinc-100">{item.run_title}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                              {item.sandbox_slug && (
                                <span className="font-mono text-zinc-200">@{item.sandbox_slug}</span>
                              )}
                              <span>· {item.playbook_name}</span>
                              {item.project_team_name && (
                                <Badge variant="outline" className="border-violet-500/40 text-violet-300 text-[11px]">
                                  {item.project_team_name}
                                </Badge>
                              )}
                            </div>
                            {item.output_summary && (
                              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap line-clamp-4">
                                {item.output_summary}
                              </p>
                            )}
                            {item.artifacts.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {item.artifacts.map((art, i) => (
                                  <Badge key={i} variant="outline" className="font-mono text-[11px]">
                                    {art}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {item.team_id && onOpenProject && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="whitespace-nowrap"
                                onClick={() => onOpenProject(item.team_id!)}
                              >
                                <FolderKanban className="h-3.5 w-3.5" />
                                {t('inbox.openProjectBtn')}
                              </Button>
                            )}
                            {item.sandbox_id && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="whitespace-nowrap"
                                onClick={() => window.open(`/sandboxes/${item.sandbox_id}/open`, '_blank')}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {t('inbox.openEmployeeBtn')}
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-amber-500/20">
                          <Input
                            className="flex-1 h-9 text-xs"
                            placeholder={t('inbox.approvalNotePlaceholder')}
                            value={notesMap[key] || ''}
                            onChange={(e) =>
                              setNotesMap((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                          />
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <Button
                              type="button"
                              variant="emerald"
                              size="sm"
                              className="whitespace-nowrap"
                              disabled={busy}
                              onClick={() => void handlePlaybookStepDecision(item, 'approved')}
                            >
                              <Check className="h-3.5 w-3.5" />
                              {t('playbooks.approveAdvanceBtn')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="whitespace-nowrap border-amber-500/40 text-amber-300 hover:bg-amber-950/40"
                              disabled={busy}
                              onClick={() => void handlePlaybookStepDecision(item, 'revise')}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              {t('playbooks.reviseStepBtn')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="whitespace-nowrap border-rose-500/40 text-rose-300 hover:bg-rose-950/40"
                              disabled={busy}
                              onClick={() => void handlePlaybookStepDecision(item, 'rejected')}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              {t('dialog.workforce.rejectBtn')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 2.5 High-Risk Tool HITL Approvals */}
            {toolApprovals.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                  <span>{t('inbox.toolApprovalsTitle')}</span>
                  <Badge variant="warning">{toolApprovals.length}</Badge>
                </div>
                <div className="space-y-3">
                  {toolApprovals.map((item) => {
                    const key = `tool:${item.id}`
                    const busy = decidingKey === key
                    return (
                      <div
                        key={key}
                        className="rounded-[var(--brand-radius-md)] border border-amber-500/35 bg-amber-950/15 p-4 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-semibold text-zinc-100">
                            @{item.sandbox_slug}
                          </span>
                          <Badge variant="warning">{item.tool_name}</Badge>
                          <span className="text-zinc-400">{item.rule_name}</span>
                        </div>
                        {item.tool_args_summary && (
                          <pre className="text-[11px] font-mono text-zinc-200 bg-zinc-950/70 rounded p-2 overflow-x-auto">
                            {item.tool_args_summary}
                          </pre>
                        )}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                          <Input
                            className="flex-1 h-8 text-xs"
                            placeholder={t('inbox.approvalNotePlaceholder')}
                            value={notesMap[key] || ''}
                            onChange={(e) =>
                              setNotesMap((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                          />
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              type="button"
                              variant="emerald"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleToolApprovalDecision(item, 'approved')}
                            >
                              <Check className="h-3.5 w-3.5" />
                              {t('inbox.toolApproveBtn')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-rose-500/40 text-rose-300 hover:bg-rose-950/40"
                              disabled={busy}
                              onClick={() => void handleToolApprovalDecision(item, 'rejected')}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              {t('inbox.toolRejectBtn')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 3. Mesh Task Approval Gates */}
            {pendingApprovals.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                  <span>{t('inbox.approvalsTitle')}</span>
                  <Badge variant="warning">{pendingApprovals.length}</Badge>
                </div>
                <div className="space-y-3">
                  {pendingApprovals.map((item) => {
                    const key = `mesh:${item.room_id}:${item.id}`
                    const busy = decidingKey === key
                    return (
                      <div
                        key={key}
                        className="rounded-[var(--brand-radius-md)] border border-amber-500/35 bg-amber-950/20 p-4 space-y-3"
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                          <div className="space-y-1.5 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-sm text-zinc-100">{item.title}</span>
                              {item.priority && item.priority !== 'normal' && (
                                <Badge variant="warning" className="font-mono uppercase text-[11px]">
                                  {item.priority}
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                              <span className="font-mono text-zinc-200">@{item.sandbox_slug}</span>
                              {item.role_title && (
                                <Badge variant="secondary">
                                  <Briefcase className="h-3 w-3 mr-0.5" />
                                  {item.role_title}
                                </Badge>
                              )}
                              {item.project_team_name && (
                                <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                                  {item.project_team_name}
                                </Badge>
                              )}
                              <span className="font-mono text-zinc-500">#{item.id}</span>
                            </div>
                            {(item.summary || item.description) && (
                              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                                {item.summary || item.description}
                              </p>
                            )}
                            {item.artifacts.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {item.artifacts.map((art, i) => (
                                  <Badge key={i} variant="outline" className="font-mono text-[11px]">
                                    {art}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="whitespace-nowrap shrink-0"
                            onClick={() => window.open(`/sandboxes/${item.sandbox_id}/open`, '_blank')}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {t('inbox.openEmployeeBtn')}
                          </Button>
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-amber-500/20">
                          <Input
                            className="flex-1 h-9 text-xs"
                            placeholder={t('inbox.approvalNotePlaceholder')}
                            value={notesMap[key] || ''}
                            onChange={(e) =>
                              setNotesMap((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                          />
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              type="button"
                              variant="emerald"
                              size="sm"
                              className="whitespace-nowrap"
                              disabled={busy}
                              onClick={() => void handleApprovalDecision(item, 'approved')}
                            >
                              <Check className="h-3.5 w-3.5" />
                              {t('dialog.workforce.approveBtn')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="whitespace-nowrap border-rose-500/40 text-rose-300 hover:bg-rose-950/40"
                              disabled={busy}
                              onClick={() => void handleApprovalDecision(item, 'rejected')}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              {t('dialog.workforce.rejectBtn')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

          </div>
        )
      ) : filteredGroups.length === 0 ? (
        <Card className="border-zinc-800/80 bg-zinc-950/40">
          <CardContent className="py-12 text-center text-sm text-zinc-500">
            {activeTab === 'active' ? t('inbox.emptyActive') : t('inbox.emptyDone')}
          </CardContent>
        </Card>
      ) : groupBy === 'task' ? (
        /* GROUP BY PRIMARY TASK (COLLAPSIBLE PARENT WORKSTREAM CARDS) */
        <div className="space-y-2.5">
          {filteredGroups.slice(0, limit).map((g) => renderGroupCard(g, false))}
          {filteredGroups.length > GROUP_PAGE_SIZE && (
            <div className="flex justify-center gap-2 pt-2">
              {remainingGroups > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLimit((n) => n + GROUP_PAGE_SIZE)}
                >
                  {t('dialog.workforce.loadMoreBtn', { remaining: remainingGroups })}
                </Button>
              )}
              {limit > GROUP_PAGE_SIZE && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLimit(GROUP_PAGE_SIZE)}
                >
                  {t('dialog.workforce.collapseBtn')}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : groupBy === 'project' ? (
        /* GROUP BY PROJECT */
        <div className="space-y-4">
          {projectBuckets.map((proj) => (
            <div
              key={proj.key}
              className="rounded-[var(--brand-radius-md)] border border-zinc-800/80 bg-zinc-950/35 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800/70">
                <div className="flex items-center gap-2">
                  <FolderKanban className="h-4 w-4 text-violet-400" />
                  <span className="font-semibold text-sm text-zinc-100">{proj.projectName}</span>
                  <Badge variant="outline" className="text-[11px] font-mono">
                    {t('inbox.projectBucketMeta', {
                      groups: proj.groups.length,
                      done: proj.doneSubtasks,
                      total: proj.totalSubtasks,
                    })}
                  </Badge>
                </div>
                {proj.projectId && onOpenProject && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs whitespace-nowrap"
                    onClick={() => onOpenProject(proj.projectId!)}
                  >
                    {t('inbox.openProjectBtn')}
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {proj.groups.map((g) => renderGroupCard(g, true))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* GROUP BY DIGITAL EMPLOYEE */
        <div className="space-y-4">
          {employeeBuckets.map((emp) => (
            <div
              key={emp.sandbox_slug}
              className="rounded-[var(--brand-radius-md)] border border-zinc-800/80 bg-zinc-950/35 p-4 space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800/70">
                <div className="flex flex-wrap items-center gap-2">
                  <User className="h-4 w-4 text-sky-400" />
                  <span className="font-mono font-semibold text-sm text-zinc-100">
                    @{emp.sandbox_slug}
                  </span>
                  {emp.role_title && <Badge variant="secondary">{emp.role_title}</Badge>}
                  <span className="text-xs text-zinc-400 font-mono">
                    {emp.doneCount}/{emp.tasks.length}
                  </span>
                  {emp.blockedCount > 0 && (
                    <Badge variant="destructive">{t('inbox.blockedCount', { count: emp.blockedCount })}</Badge>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs whitespace-nowrap"
                  onClick={() => window.open(`/sandboxes/${emp.sandbox_id}/open`, '_blank')}
                >
                  <ExternalLink className="h-3 w-3" />
                  {t('inbox.openEmployeeBtn')}
                </Button>
              </div>
              <div className="space-y-1.5">
                {emp.tasks.map((tk) => {
                  const subKey = `emp:${tk.room_id}:${tk.id}`
                  const subOpen = expandedTaskKey === subKey
                  return (
                    <div
                      key={subKey}
                      className="rounded-[var(--brand-radius-sm)] border border-zinc-800/70 bg-zinc-900/35 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedTaskKey(subOpen ? null : subKey)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-800/30 transition-colors cursor-pointer"
                      >
                        <div className="min-w-0 flex-1 flex items-center gap-2">
                          <span
                            className={cn(
                              'text-xs font-medium text-zinc-200 truncate',
                              tk.status === 'cancelled' && 'line-through text-zinc-500',
                            )}
                          >
                            {tk.title}
                          </span>
                          {tk.project_team_name && (
                            <span className="text-[11px] text-zinc-500 truncate hidden md:inline">
                              · {tk.project_team_name}
                            </span>
                          )}
                        </div>
                        <Badge
                          variant={
                            tk.status === 'done'
                              ? 'success'
                              : tk.status === 'blocked'
                                ? 'destructive'
                                : tk.status === 'cancelled'
                                  ? 'outline'
                                  : 'secondary'
                          }
                          className="text-[11px] whitespace-nowrap shrink-0"
                        >
                          {tk.status}
                        </Badge>
                      </button>
                      {subOpen && (
                        <div className="border-t border-zinc-800/70 px-3 py-2.5 bg-zinc-950/70">
                          {renderTaskDetailBox(tk)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dispatch Task Modal */}
      <Dialog
        open={dispatchOpen}
        onOpenChange={(o) => !o && !dispatching && setDispatchOpen(false)}
        title={t('inbox.dispatchDialogTitle')}
      >
        {runningSandboxes.length === 0 ? (
          <p className="text-sm text-zinc-400 py-4">{t('inbox.dispatchNoRunning')}</p>
        ) : (
          <form onSubmit={handleDispatchSubmit} className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <Label>{t('inbox.dispatchTargetLabel')}</Label>
              <Select
                value={dispatchForm.sandbox_id}
                onChange={(e) => setDispatchForm({ ...dispatchForm, sandbox_id: e.target.value })}
              >
                {runningSandboxes.map((sbx) => (
                  <option key={sbx.id} value={sbx.id}>
                    {sbx.display_name || sbx.slug} (@{sbx.slug})
                    {sbx.role_title ? ` · ${sbx.role_title}` : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.workforce.taskTitlePlaceholder')}</Label>
              <Input
                required
                value={dispatchForm.title}
                onChange={(e) => setDispatchForm({ ...dispatchForm, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.workforce.taskDescPlaceholder')}</Label>
              <Textarea
                rows={3}
                value={dispatchForm.description}
                onChange={(e) => setDispatchForm({ ...dispatchForm, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div className="space-y-1.5">
                <Label>{t('inbox.dispatchPriorityLabel')}</Label>
                <Select
                  value={dispatchForm.priority}
                  onChange={(e) =>
                    setDispatchForm({
                      ...dispatchForm,
                      priority: e.target.value as 'low' | 'normal' | 'high' | 'urgent',
                    })
                  }
                >
                  <option value="low">low</option>
                  <option value="normal">normal</option>
                  <option value="high">high</option>
                  <option value="urgent">urgent</option>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-300 pt-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dispatchForm.approval_required}
                  onChange={(e) =>
                    setDispatchForm({ ...dispatchForm, approval_required: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-900 accent-indigo-500"
                />
                <span>{t('dialog.workforce.approvalRequiredLabel')}</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <Button type="button" variant="ghost" onClick={() => setDispatchOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={dispatching}>
                <Send className="h-3.5 w-3.5" />
                {dispatching ? t('common.saving') : t('dialog.workforce.dispatchBtn')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  )
}
