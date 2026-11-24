import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  MessageSquare,
  Paperclip,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
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
  Textarea,
  cn,
} from '../../components/ui'
import { apiFetch, parseApiErrorDetail } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type {
  AuthMe,
  PlaybookItem,
  PlaybookRunItem,
  PlaybookStepRunItem,
  SandboxItem,
  TeamItem,
} from '../../types'

const CATEGORY_COLORS: Record<string, string> = {
  engineering: 'border-indigo-500/40 text-indigo-300',
  analytics: 'border-sky-500/40 text-sky-300',
  legal: 'border-amber-500/40 text-amber-300',
  operations: 'border-emerald-500/40 text-emerald-300',
  custom: 'border-zinc-700 text-zinc-300',
}

export function PlaybooksView({
  auth,
  notify,
  projectId,
  projectName,
  projectMeshRoomId,
  projectSandboxes,
  mode = 'project',
}: {
  auth: AuthMe
  notify: (msg: string, type?: 'success' | 'error') => void
  projectId?: string
  projectName?: string
  projectMeshRoomId?: string | null
  projectSandboxes?: SandboxItem[]
  mode?: 'project' | 'admin-catalog'
}) {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  const isAdminCatalog = mode === 'admin-catalog'
  const [tab, setTab] = useState<'catalog' | 'runs'>(
    isAdminCatalog ? 'catalog' : projectId ? 'runs' : 'catalog',
  )
  const [playbooks, setPlaybooks] = useState<PlaybookItem[]>([])
  const [runs, setRuns] = useState<PlaybookRunItem[]>([])
  const [sandboxes, setSandboxes] = useState<SandboxItem[]>([])
  const [teams, setTeams] = useState<TeamItem[]>([])
  const [loading, setLoading] = useState(true)

  // Launch Playbook Modal
  const [launchPb, setLaunchPb] = useState<PlaybookItem | null>(null)
  const [runTitle, setRunTitle] = useState('')
  const [runTeamId, setRunTeamId] = useState(projectId || '')
  const [executionMode, setExecutionMode] = useState<'project_group' | 'isolated'>('isolated')
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [roleAssignments, setRoleAssignments] = useState<Record<string, string>>({})
  const [launchFiles, setLaunchFiles] = useState<File[]>([])
  const [launching, setLaunching] = useState(false)

  // Step Approve / Revise / Reject Modal
  const [decideCtx, setDecideCtx] = useState<{
    run: PlaybookRunItem
    step: PlaybookStepRunItem
    decision: 'approved' | 'revise' | 'rejected'
    manual?: boolean
  } | null>(null)
  const [stepNote, setStepNote] = useState('')
  const [stepSummary, setStepSummary] = useState('')
  const [stepArtifacts, setStepArtifacts] = useState('')
  const [submittingStep, setSubmittingStep] = useState(false)

  // Import YAML/JSON Modal (Admin)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importOverwrite, setImportOverwrite] = useState(false)
  const [importing, setImporting] = useState(false)
  const pollingRunsRef = useRef(false)

  const runsEndpoint = projectId
    ? `/api/playbook-runs?team_id=${encodeURIComponent(projectId)}`
    : '/api/playbook-runs'

  const effectiveSandboxes =
    projectSandboxes && projectSandboxes.length > 0 ? projectSandboxes : sandboxes

  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent)
    if (!silent) setLoading(true)
    try {
      const sbxUrl = auth.admin ? '/api/sandboxes' : '/api/my/sandboxes'
      const [pbRes, runRes, sbxRes, teamRes] = await Promise.all([
        apiFetch<{ items: PlaybookItem[] }>('/api/playbooks'),
        isAdminCatalog
          ? Promise.resolve({ items: [] as PlaybookRunItem[] })
          : apiFetch<{ items: PlaybookRunItem[] }>(runsEndpoint),
        projectSandboxes
          ? Promise.resolve({ items: projectSandboxes })
          : apiFetch<{ items: SandboxItem[] }>(sbxUrl).catch(() => ({ items: [] as SandboxItem[] })),
        projectId || isAdminCatalog
          ? Promise.resolve({ items: [] as TeamItem[] })
          : apiFetch<{ items: TeamItem[] }>('/api/teams').catch(() => ({ items: [] as TeamItem[] })),
      ])
      setPlaybooks(pbRes.items || [])
      setRuns(runRes.items || [])
      setSandboxes(sbxRes.items || [])
      setTeams(teamRes.items || [])
    } catch (err: any) {
      if (!silent) {
        notify(err.message || tRef.current('admin.loadFailed'), 'error')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [auth.admin, isAdminCatalog, notify, projectId, projectSandboxes, runsEndpoint])

  const pollRunsOnly = useCallback(async () => {
    if (pollingRunsRef.current || isAdminCatalog) return
    pollingRunsRef.current = true
    try {
      const runRes = await apiFetch<{ items: PlaybookRunItem[] }>(runsEndpoint)
      setRuns(runRes.items || [])
    } catch {
      // silent background sync
    } finally {
      pollingRunsRef.current = false
    }
  }, [isAdminCatalog, runsEndpoint])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const hasRunningRuns = runs.some((r) => r.status === 'running')

  useEffect(() => {
    if (tab !== 'runs' || !hasRunningRuns) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void pollRunsOnly()
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [tab, hasRunningRuns, pollRunsOnly])

  const selectedLaunchMeshRoomId = projectId
    ? projectMeshRoomId || null
    : teams.find((tm) => tm.id === runTeamId)?.mesh_room_id || null
  const canUseProjectGroup = Boolean((projectId || runTeamId) && selectedLaunchMeshRoomId)

  const openLaunch = (pb: PlaybookItem) => {
    setLaunchPb(pb)
    setRunTitle('')
    const defaultTeamId = projectId || teams[0]?.id || ''
    setRunTeamId(defaultTeamId)
    const defaultRoom = projectId
      ? projectMeshRoomId
      : teams.find((tm) => tm.id === defaultTeamId)?.mesh_room_id
    setExecutionMode(defaultRoom ? 'project_group' : 'isolated')
    const defaults: Record<string, string> = {}
    for (const f of pb.input_fields) {
      if (f.type === 'select' && f.options?.length) {
        defaults[f.key] = f.options[0]
      } else {
        defaults[f.key] = ''
      }
    }
    setInputValues(defaults)
    setRoleAssignments({})
    setLaunchFiles([])
  }

  const handleLaunchSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!launchPb) return
    setLaunching(true)
    try {
      const fd = new FormData()
      const inferredTitle =
        runTitle.trim() ||
        inputValues.feature_title ||
        inputValues.report_title ||
        inputValues.contract_name ||
        launchPb.name
      fd.append('title', inferredTitle)
      fd.append('team_id', runTeamId)
      fd.append('execution_mode', canUseProjectGroup ? executionMode : 'isolated')
      fd.append('inputs_json', JSON.stringify(inputValues))
      fd.append('role_assignments_json', JSON.stringify(roleAssignments))
      for (const f of launchFiles.slice(0, 5)) {
        fd.append('files', f, f.name)
      }
      const res = await fetch(`/api/playbooks/${launchPb.id}/runs`, {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try {
          msg = parseApiErrorDetail(await res.json(), res.status)
        } catch {
          // ignore
        }
        throw new Error(msg)
      }
      notify(t('playbooks.runStarted'))
      setLaunchPb(null)
      setTab('runs')
      await loadAll()
    } catch (err: any) {
      notify(err.message || 'Launch failed', 'error')
    } finally {
      setLaunching(false)
    }
  }

  const openStepDecide = (
    run: PlaybookRunItem,
    step: PlaybookStepRunItem,
    decision: 'approved' | 'revise' | 'rejected',
    manual = false,
  ) => {
    setDecideCtx({ run, step, decision, manual })
    setStepNote('')
    setStepSummary(step.output_summary || '')
    setStepArtifacts((step.artifacts || []).join('\n'))
  }

  const handleStepDecide = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!decideCtx) return
    setSubmittingStep(true)
    try {
      const artList = stepArtifacts
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
      await apiFetch(
        `/api/playbook-runs/${decideCtx.run.id}/steps/${decideCtx.step.id}/decide`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision: decideCtx.decision,
            note: stepNote,
            output_summary: decideCtx.decision === 'approved' ? (stepSummary.trim() || null) : null,
            artifacts: decideCtx.decision === 'approved' && artList.length ? artList : null,
          }),
        },
      )
      notify(
        decideCtx.decision === 'approved'
          ? t('playbooks.stepApproved')
          : decideCtx.decision === 'revise'
            ? t('playbooks.stepRevised')
            : t('playbooks.stepRejected'),
      )
      setDecideCtx(null)
      await loadAll({ silent: true })
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSubmittingStep(false)
    }
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!importText.trim()) return
    setImporting(true)
    try {
      await apiFetch('/api/playbooks/import', {
        method: 'POST',
        body: JSON.stringify({ content: importText, overwrite: importOverwrite }),
      })
      notify(t('playbooks.imported'))
      setImportOpen(false)
      setImportText('')
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setImporting(false)
    }
  }

  const activeRunsCount = runs.filter(
    (r) => r.status === 'running' || r.status === 'awaiting_approval',
  ).length

  return (
    <div className="space-y-6">
      {/* Header */}
      {!projectId && !isAdminCatalog ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
              {t('playbooks.title')}
            </h1>
            <p className="text-sm text-zinc-400 mt-1">{t('playbooks.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadAll()}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              {t('common.refresh')}
            </Button>
            {auth.admin && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" />
                {t('playbooks.importBtn')}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {/* Sub-tabs & compact toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center gap-2">
          {!isAdminCatalog && (
            <button
              type="button"
              onClick={() => setTab('runs')}
              className={cn(
                'inline-flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer',
                tab === 'runs'
                  ? 'brand-tab-active'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900',
              )}
            >
              <Layers className="h-4 w-4" />
              <span>{t('playbooks.tabRuns')}</span>
              {activeRunsCount > 0 ? (
                <Badge variant="warning">{activeRunsCount}</Badge>
              ) : (
                <Badge variant="outline">{runs.length}</Badge>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab('catalog')}
            className={cn(
              'inline-flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer',
              tab === 'catalog'
                ? 'brand-tab-active'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900',
            )}
          >
            <BookOpen className="h-4 w-4" />
            <span>{t('playbooks.tabCatalog')}</span>
            <Badge variant="outline">{playbooks.length}</Badge>
          </button>
        </div>

        {(projectId || isAdminCatalog) && (
          <div className="flex items-center gap-2">
            {hasRunningRuns && tab === 'runs' && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-indigo-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('playbooks.autoPollingHint')}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => void loadAll()}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              {t('common.refresh')}
            </Button>
            {auth.admin && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5" />
                {t('playbooks.importBtn')}
              </Button>
            )}
          </div>
        )}
      </div>

      {tab === 'catalog' ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          {playbooks.map((pb) => (
            <Card key={pb.id} className="border-zinc-800 flex flex-col justify-between">
              <CardHeader>
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <Badge
                    variant="outline"
                    className={CATEGORY_COLORS[pb.category] || CATEGORY_COLORS.custom}
                  >
                    {pb.category}
                  </Badge>
                  {pb.is_builtin && (
                    <Badge variant="secondary" className="text-[11px]">
                      <Sparkles className="h-3 w-3 mr-0.5 text-indigo-400" />
                      {t('playbooks.builtinBadge')}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[11px] font-mono">
                    {t('playbooks.estSaved', { hours: pb.estimated_manual_hours })}
                  </Badge>
                </div>
                <CardTitle className="text-lg">{pb.name}</CardTitle>
                {pb.description && (
                  <p className="text-xs text-zinc-400 leading-relaxed mt-1">{pb.description}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
                <div className="space-y-3">
                  {/* Stage Pipeline Chain */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      {t('playbooks.stagesCount', { count: pb.stages.length })}
                    </div>
                    <div className="space-y-1.5">
                      {pb.stages.map((st, idx) => (
                        <div
                          key={st.id}
                          className="flex items-center justify-between gap-2 rounded-[var(--brand-radius-sm)] border border-zinc-800/80 bg-zinc-950/60 px-2.5 py-1.5 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="h-4 w-4 rounded-full bg-zinc-800 text-zinc-300 text-[10px] font-mono flex items-center justify-center shrink-0">
                              {idx + 1}
                            </span>
                            <span className="text-zinc-200 truncate">{st.name}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {st.parallel_group && (
                              <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-300">
                                {t('playbooks.parallelBadge')}
                              </Badge>
                            )}
                            {st.approval_required && (
                              <span title={t('playbooks.approvalGate')}>
                                <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Checklist */}
                  {pb.deliverables_checklist.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                        {t('playbooks.checklistTitle')}
                      </div>
                      <ul className="space-y-1 text-xs text-zinc-400">
                        {pb.deliverables_checklist.slice(0, 4).map((c) => (
                          <li key={c} className="flex items-start gap-1.5">
                            <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                            <span>{c}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-zinc-800/70 flex items-center gap-2">
                  <Button className="flex-1" size="sm" onClick={() => openLaunch(pb)}>
                    <Play className="h-3.5 w-3.5" />
                    {t('playbooks.launchBtn')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(`/api/playbooks/${pb.id}/export?format=yaml`, '_blank')
                    }
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t('playbooks.exportYamlBtn')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : runs.length === 0 ? (
        <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
          <CardContent className="py-14 text-center space-y-3">
            <Layers className="h-8 w-8 text-zinc-500 mx-auto" />
            <p className="text-sm text-zinc-400">{t('playbooks.runsEmpty')}</p>
            <Button size="sm" onClick={() => setTab('catalog')}>
              <Play className="h-3.5 w-3.5" />
              {t('playbooks.tabCatalog')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {runs.map((run) => {
            const pct = run.progress_total
              ? Math.round((run.progress_done / run.progress_total) * 100)
              : 0
            return (
              <Card key={run.id} className="border-zinc-800">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        <span>{run.title}</span>
                        <Badge variant="outline" className="text-xs">
                          {run.playbook_name}
                        </Badge>
                        <Badge
                          variant={
                            run.status === 'completed'
                              ? 'success'
                              : run.status === 'failed'
                                ? 'destructive'
                                : run.status === 'awaiting_approval'
                                  ? 'warning'
                                  : 'secondary'
                          }
                        >
                          {run.status}
                        </Badge>
                        {run.execution_mode === 'project_group' && (
                          <Badge
                            variant="outline"
                            className="text-[11px] border-indigo-500/40 text-indigo-300"
                          >
                            <MessageSquare className="h-3 w-3 mr-1" />
                            {t('playbooks.modeGroupBadge')}
                          </Badge>
                        )}
                      </CardTitle>
                      <div className="text-xs text-zinc-400 font-mono">
                        by {run.created_by} · {run.progress_done}/{run.progress_total} ({pct}%)
                        {run.created_at ? ` · ${new Date(run.created_at).toLocaleString()}` : ''}
                      </div>
                    </div>
                    <div className="w-40">
                      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            run.status === 'completed'
                              ? 'bg-emerald-500'
                              : run.status === 'failed'
                                ? 'bg-rose-500'
                                : 'bg-indigo-500',
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Stage Timeline */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {run.steps.map((st, idx) => {
                      const isRunning = st.status === 'running'
                      const isAwaiting = st.status === 'awaiting_approval'
                      const hasWarning = Boolean(st.output_summary?.startsWith('⚠️'))
                      return (
                        <div
                          key={st.id}
                          className={cn(
                            'rounded-[var(--brand-radius-md)] border p-3.5 space-y-2.5 text-xs flex flex-col justify-between',
                            st.status === 'completed'
                              ? 'border-emerald-500/35 bg-emerald-950/15'
                              : isAwaiting
                                ? 'border-amber-500/50 bg-amber-950/20'
                                : isRunning
                                  ? hasWarning
                                    ? 'border-rose-500/45 bg-rose-950/20'
                                    : 'border-indigo-500/50 bg-indigo-950/20'
                                  : st.status === 'rejected'
                                    ? 'border-rose-500/40 bg-rose-950/20'
                                    : 'border-zinc-800 bg-zinc-950/50 opacity-70',
                          )}
                        >
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5 font-medium text-zinc-100">
                                {st.status === 'completed' ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                                ) : st.status === 'rejected' ? (
                                  <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                                ) : isRunning ? (
                                  hasWarning ? (
                                    <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                                  ) : (
                                    <Loader2 className="h-4 w-4 text-indigo-400 animate-spin shrink-0" />
                                  )
                                ) : isAwaiting ? (
                                  <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0" />
                                ) : (
                                  <Clock className="h-4 w-4 text-zinc-500 shrink-0" />
                                )}
                                <span>
                                  {idx + 1}. {st.stage_name}
                                </span>
                              </div>
                              {st.sandbox_slug && (
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  @{st.sandbox_slug}
                                </Badge>
                              )}
                            </div>
                            {st.deliverable_hint && (
                              <div className="text-zinc-400">{st.deliverable_hint}</div>
                            )}
                            {isRunning && !hasWarning && (
                              <div className="flex items-center gap-1.5 rounded bg-indigo-500/10 border border-indigo-500/25 px-2.5 py-1.5 text-[11px] text-indigo-200">
                                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                                <span>
                                  {t('playbooks.agentRunningHint', {
                                    slug: st.sandbox_slug || 'agent',
                                  })}
                                </span>
                              </div>
                            )}
                            {isAwaiting && (
                              <div className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/35 px-2 py-0.5 text-[11px] text-amber-300 font-medium">
                                <ShieldCheck className="h-3 w-3" />
                                <span>{t('playbooks.awaitingApprovalBadge')}</span>
                              </div>
                            )}
                            {st.output_summary && (
                              <div
                                className={cn(
                                  'rounded p-2.5 border whitespace-pre-wrap break-words max-h-52 overflow-y-auto leading-relaxed',
                                  hasWarning
                                    ? 'bg-rose-950/30 border-rose-500/35 text-rose-200'
                                    : 'bg-zinc-950/75 border-zinc-800/80 text-zinc-200',
                                )}
                              >
                                {st.output_summary}
                              </div>
                            )}
                            {st.artifacts.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {st.artifacts.map((a) => {
                                  const isLink = a.startsWith('http://') || a.startsWith('https://') || a.startsWith('/s/')
                                  return isLink ? (
                                    <a
                                      key={a}
                                      href={a}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] text-indigo-300 hover:bg-indigo-500/20 max-w-full truncate"
                                    >
                                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                      <span className="truncate">{a}</span>
                                    </a>
                                  ) : (
                                    <Badge key={a} variant="secondary" className="font-mono text-[10px] max-w-full truncate">
                                      <FileText className="h-2.5 w-2.5 mr-0.5 shrink-0" />
                                      <span className="truncate">{a}</span>
                                    </Badge>
                                  )
                                })}
                              </div>
                            )}
                          </div>

                          {isRunning && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-zinc-800/60">
                              {st.sandbox_id && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[11px]"
                                  onClick={() =>
                                    window.open(`/sandboxes/${st.sandbox_id}/open`, '_blank')
                                  }
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  {t('playbooks.openWorkspaceBtn')}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[11px] text-zinc-300"
                                onClick={() => openStepDecide(run, st, 'revise')}
                              >
                                <RotateCcw className="h-3 w-3" />
                                {t('playbooks.retryWakeBtn')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[11px] text-zinc-400 hover:text-zinc-200 ml-auto"
                                onClick={() => openStepDecide(run, st, 'approved', true)}
                              >
                                {t('playbooks.completeAdvanceBtn')}
                              </Button>
                            </div>
                          )}

                          {isAwaiting && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-amber-500/25">
                              <Button
                                size="sm"
                                className="h-7 text-xs flex-1"
                                onClick={() => openStepDecide(run, st, 'approved')}
                              >
                                <ArrowRight className="h-3 w-3" />
                                {t('playbooks.approveAdvanceBtn')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-amber-300 border-amber-500/40 hover:bg-amber-500/10"
                                onClick={() => openStepDecide(run, st, 'revise')}
                              >
                                <RotateCcw className="h-3 w-3" />
                                {t('playbooks.reviseStepBtn')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-rose-400 hover:text-rose-300"
                                onClick={() => openStepDecide(run, st, 'rejected')}
                              >
                                <X className="h-3 w-3" />
                                {t('playbooks.rejectStepBtn')}
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Launch Playbook Dialog */}
      <Dialog
        open={!!launchPb}
        onOpenChange={(o) => !o && !launching && setLaunchPb(null)}
        title={t('playbooks.launchDialogTitle', { name: launchPb?.name ?? '' })}
        maxWidth="max-w-2xl"
      >
        {launchPb && (
          <form onSubmit={handleLaunchSubmit} className="space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('playbooks.runTitleLabel')}</Label>
                <Input
                  required
                  placeholder={launchPb.name}
                  value={runTitle}
                  onChange={(e) => setRunTitle(e.target.value)}
                />
              </div>
              {!projectId ? (
                <div className="space-y-1.5">
                  <Label>{t('playbooks.runTeamLabel')}</Label>
                  <Select value={runTeamId} onChange={(e) => setRunTeamId(e.target.value)}>
                    <option value="">--</option>
                    {teams.map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>{t('projects.boundProjectLabel')}</Label>
                  <Input value={projectName || projectId} disabled />
                </div>
              )}
            </div>

            {canUseProjectGroup && (
              <div className="space-y-1.5">
                <Label>{t('playbooks.executionModeLabel')}</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(
                    [
                      {
                        key: 'project_group' as const,
                        title: t('playbooks.modeProjectGroup'),
                        desc: t('playbooks.modeProjectGroupDesc'),
                      },
                      {
                        key: 'isolated' as const,
                        title: t('playbooks.modeIsolated'),
                        desc: t('playbooks.modeIsolatedDesc'),
                      },
                    ]
                  ).map((opt) => {
                    const active = executionMode === opt.key
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setExecutionMode(opt.key)}
                        className={cn(
                          'rounded-[var(--brand-radius-sm)] border px-3 py-2 text-left transition-colors cursor-pointer',
                          active
                            ? 'border-indigo-500/70 bg-indigo-500/10 text-zinc-100'
                            : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
                        )}
                      >
                        <div className="text-xs font-medium">{opt.title}</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">{opt.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Dynamic Declarative Form Fields */}
            {launchPb.input_fields.map((field) => {
              if (field.type === 'file') {
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                      <Paperclip className="h-3.5 w-3.5 text-zinc-400" />
                      <span>{field.label}</span>
                    </Label>
                    <input
                      type="file"
                      multiple
                      onChange={(e) => setLaunchFiles(Array.from(e.target.files || []).slice(0, 5))}
                      className="block w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border file:border-zinc-700 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200 hover:file:bg-zinc-800"
                    />
                  </div>
                )
              }
              if (field.type === 'select') {
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label>{field.label}</Label>
                    <Select
                      value={inputValues[field.key] || ''}
                      onChange={(e) =>
                        setInputValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                    >
                      {(field.options || []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </Select>
                  </div>
                )
              }
              if (field.type === 'textarea') {
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label>{field.label}</Label>
                    <Textarea
                      rows={3}
                      required={field.required}
                      placeholder={field.placeholder}
                      value={inputValues[field.key] || ''}
                      onChange={(e) =>
                        setInputValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                    />
                  </div>
                )
              }
              return (
                <div key={field.key} className="space-y-1.5">
                  <Label>{field.label}</Label>
                  <Input
                    required={field.required}
                    placeholder={field.placeholder}
                    value={inputValues[field.key] || ''}
                    onChange={(e) =>
                      setInputValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </div>
              )
            })}

            {/* Role Assignments */}
            {effectiveSandboxes.length > 0 && (
              <div className="space-y-2 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="text-xs font-medium text-zinc-300">
                  {t('playbooks.roleAssignTitle')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {launchPb.stages.map((st, idx) => (
                    <div key={st.id} className="space-y-1">
                      <Label className="text-xs text-zinc-400">
                        {idx + 1}. {st.name} {st.role_hint ? `(${st.role_hint})` : ''}
                      </Label>
                      <Select
                        value={roleAssignments[st.id] || ''}
                        onChange={(e) =>
                          setRoleAssignments((prev) => ({ ...prev, [st.id]: e.target.value }))
                        }
                        className="h-8 text-xs"
                      >
                        <option value="">{t('playbooks.autoAssign')}</option>
                        {effectiveSandboxes.map((s) => (
                          <option key={s.id} value={s.id}>
                            @{s.slug} {s.role_title ? `· ${s.role_title}` : ''}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
              <Button type="button" variant="ghost" onClick={() => setLaunchPb(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={launching}>
                <Play className="h-4 w-4" />
                {launching ? t('playbooks.startingRun') : t('playbooks.startRunBtn')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Step Review, Revise & Advance Dialog */}
      <Dialog
        open={!!decideCtx}
        onOpenChange={(o) => !o && !submittingStep && setDecideCtx(null)}
        title={
          decideCtx?.decision === 'revise'
            ? t('playbooks.stepReviseTitle', { stage: decideCtx?.step.stage_name ?? '' })
            : decideCtx?.manual
              ? t('playbooks.stepManualTitle', { stage: decideCtx?.step.stage_name ?? '' })
              : t('playbooks.stepDecideTitle', { stage: decideCtx?.step.stage_name ?? '' })
        }
      >
        {decideCtx && (
          <form onSubmit={handleStepDecide} className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <Label>{t('playbooks.stepNoteLabel')}</Label>
              {decideCtx.decision === 'revise' ? (
                <Textarea
                  rows={4}
                  required
                  value={stepNote}
                  onChange={(e) => setStepNote(e.target.value)}
                  placeholder={t('playbooks.stepRevisePlaceholder')}
                />
              ) : (
                <Input
                  value={stepNote}
                  onChange={(e) => setStepNote(e.target.value)}
                  placeholder="LGTM / 验收通过..."
                />
              )}
            </div>
            {decideCtx.decision === 'approved' && (
              <>
                <div className="space-y-1.5">
                  <Label>{t('playbooks.stepSummaryLabel')}</Label>
                  <Textarea
                    rows={4}
                    value={stepSummary}
                    onChange={(e) => setStepSummary(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('playbooks.stepArtifactsLabel')}</Label>
                  <Textarea
                    rows={2}
                    placeholder="https://github.com/org/repo/pull/42"
                    value={stepArtifacts}
                    onChange={(e) => setStepArtifacts(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
              <Button type="button" variant="ghost" onClick={() => setDecideCtx(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant={decideCtx.decision === 'rejected' ? 'destructive' : 'default'}
                disabled={submittingStep}
              >
                {submittingStep
                  ? t('common.saving')
                  : decideCtx.decision === 'approved'
                    ? decideCtx.manual
                      ? t('playbooks.completeAdvanceBtn')
                      : t('playbooks.approveAdvanceBtn')
                    : decideCtx.decision === 'revise'
                      ? t('playbooks.reviseStepBtn')
                      : t('playbooks.rejectStepBtn')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Import Declarative Playbook Dialog */}
      <Dialog
        open={importOpen}
        onOpenChange={(o) => !o && !importing && setImportOpen(false)}
        title={t('playbooks.importTitle')}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleImport} className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label>{t('playbooks.importContentLabel')}</Label>
            <Textarea
              rows={12}
              required
              className="font-mono text-xs"
              placeholder={'key: custom-release\nname: Custom Release Flow\ncategory: engineering\nstages:\n  - id: review\n    name: Release Review\n    prompt_template: "Review release {{title}}"'}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={importOverwrite}
              onChange={(e) => setImportOverwrite(e.target.checked)}
              className="rounded border-zinc-700 accent-indigo-500"
            />
            <span>{t('playbooks.importOverwrite')}</span>
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setImportOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={importing}>
              <Upload className="h-4 w-4" />
              {importing ? t('common.saving') : t('playbooks.importBtn')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
