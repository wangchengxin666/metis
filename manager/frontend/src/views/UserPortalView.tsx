import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  Briefcase,
  Copy,
  Download,
  ExternalLink,
  FileText,
  KeyRound,
  Lock,
  Paperclip,
  Play,
  RefreshCw,
  RotateCw,
  Send,
  Sparkles,
  Square,
} from 'lucide-react'
import {
  ActionMenu,
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
} from '../components/ui'
import { BackupRestoreDialog } from '../components/BackupRestoreDialog'
import { WorkforceInspectorDialog } from '../components/WorkforceInspectorDialog'
import { apiFetch, parseApiErrorDetail } from '../lib/client.ts'
import { copyTextToClipboard, fetchRunningStats, formatDiskSize, mergeStatsMap } from '../lib/format'
import { localizeAction, localizeStatus } from '../lib/i18n.ts'
import { useI18n } from '../lib/i18nContext'
import type {
  AuthMe,
  SandboxItem,
  SandboxStats,
  WorkspaceInboxData,
  WorkspaceSandboxBadge,
} from '../types'

export function UserPortalView({
  auth,
  notify,
  onOpenHiring,
}: {
  auth: AuthMe | null
  notify: (msg: string, type?: 'success' | 'error') => void
  onOpenHiring?: () => void
}) {
  const { locale, t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  const [sandboxes, setSandboxes] = useState<SandboxItem[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, SandboxStats>>({})
  const [badgesMap, setBadgesMap] = useState<Record<string, WorkspaceSandboxBadge>>({})
  const [loading, setLoading] = useState(true)
  const refreshingRef = useRef(false)
  const statsInFlightRef = useRef(false)
  const [logsTarget, setLogsTarget] = useState<SandboxItem | null>(null)
  const [logsText, setLogsText] = useState('')
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [backupTarget, setBackupTarget] = useState<SandboxItem | null>(null)
  const [workforceTarget, setWorkforceTarget] = useState<SandboxItem | null>(null)
  const [intakeTarget, setIntakeTarget] = useState<SandboxItem | null>(null)
  const [intakeForm, setIntakeForm] = useState({
    title: '',
    description: '',
    priority: 'normal',
    approval_required: false,
  })
  const [intakeFiles, setIntakeFiles] = useState<File[]>([])
  const [submittingIntake, setSubmittingIntake] = useState(false)
  const [pwModalOpen, setPwModalOpen] = useState(false)
  const [pwForm, setPwForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [savingPw, setSavingPw] = useState(false)

  const apiBase = auth?.admin ? '/api/sandboxes' : '/api/my/sandboxes'

  const openLogsModal = async (sbx: SandboxItem) => {
    setLogsTarget(sbx)
    setLoadingLogs(true)
    try {
      const res = await apiFetch<{ logs: string }>(`/api/sandboxes/${sbx.id}/logs?tail=400`)
      const cleaned = (res.logs || t('admin.noLogs')).replace(
        /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]/g,
        '',
      )
      setLogsText(cleaned)
    } catch (err: any) {
      setLogsText(t('admin.logsLoadFailed', { message: err.message }))
    } finally {
      setLoadingLogs(false)
    }
  }

  const loadMySandboxes = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent)
    if (silent && refreshingRef.current) return
    refreshingRef.current = true
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams(window.location.search)
      const qEmail = params.get('email') || ''
      const listUrl = auth?.admin && !qEmail
        ? '/api/sandboxes?refresh=true'
        : `/api/my/sandboxes?refresh=true${(qEmail || auth?.email) ? `&email=${encodeURIComponent(qEmail || auth?.email || '')}` : ''}`
      const [res, inboxRes] = await Promise.all([
        apiFetch<{ items: SandboxItem[] }>(listUrl),
        apiFetch<WorkspaceInboxData>('/api/workspace/inbox').catch(() => null),
      ])
      setSandboxes(res.items)
      if (inboxRes?.sandbox_badges) {
        setBadgesMap(inboxRes.sandbox_badges)
      }
      if (!statsInFlightRef.current) {
        statsInFlightRef.current = true
        void fetchRunningStats(res.items, apiBase, { includeDisk: !silent })
          .then((nextStats) => {
            setStatsMap((prev) => mergeStatsMap(prev, nextStats))
            if (Object.keys(nextStats).length > 0) {
              setSandboxes((prev) =>
                prev.map((item) =>
                  nextStats[item.id]?.disk_usage_mb != null
                    ? { ...item, disk_usage_mb: nextStats[item.id].disk_usage_mb }
                    : item,
                ),
              )
            }
          })
          .catch(() => {})
          .finally(() => {
            statsInFlightRef.current = false
          })
      }
    } catch (err: any) {
      if (!silent) {
        notify(err.message || tRef.current('portal.loadFailed'), 'error')
      }
    } finally {
      refreshingRef.current = false
      if (!silent) setLoading(false)
    }
  }, [auth, apiBase, notify])

  useEffect(() => {
    void loadMySandboxes()
  }, [loadMySandboxes])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadMySandboxes({ silent: true })
      }
    }, 8000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadMySandboxes({ silent: true })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadMySandboxes])

  const handleAction = async (sbx: SandboxItem, action: 'start' | 'stop' | 'restart') => {
    try {
      notify(t('portal.actionRunning', { action: localizeAction(locale, action) }))
      await apiFetch(`${apiBase}/${sbx.id}/${action}`, { method: 'POST' })
      notify(t('portal.actionSuccess'))
      await loadMySandboxes()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const openIntakeModal = (sbx: SandboxItem) => {
    setIntakeTarget(sbx)
    setIntakeForm({ title: '', description: '', priority: 'normal', approval_required: false })
    setIntakeFiles([])
  }

  const handleSubmitIntake = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!intakeTarget || !intakeForm.title.trim()) return
    setSubmittingIntake(true)
    try {
      const fd = new FormData()
      fd.append('title', intakeForm.title.trim())
      fd.append('description', intakeForm.description)
      fd.append('priority', intakeForm.priority)
      fd.append('approval_required', intakeForm.approval_required ? 'true' : 'false')
      for (const f of intakeFiles.slice(0, 5)) {
        fd.append('files', f, f.name)
      }
      const res = await fetch(`/api/workspace/sandboxes/${intakeTarget.id}/intake`, {
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
      notify(t('intake.submitted', { slug: intakeTarget.slug }))
      setIntakeTarget(null)
      await loadMySandboxes()
    } catch (err: any) {
      notify(err.message || 'Submit failed', 'error')
    } finally {
      setSubmittingIntake(false)
    }
  }

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            {t('portal.bannerTitle')}
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            {t('portal.accountPrefix')}
            <span className="text-zinc-200 font-mono">{auth?.email}</span>
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {onOpenHiring && (
            <Button variant="outline" size="sm" onClick={onOpenHiring}>
              <Sparkles className="h-4 w-4 text-indigo-400" />
              {t('intake.hireShortcut')}
            </Button>
          )}
          {!auth?.admin &&
            (auth?.allow_local_user_login ?? auth?.auth_mode !== 'oidc') &&
            (auth?.auth_method !== 'oidc' || auth?.has_password) && (
            <Button variant="outline" size="sm" onClick={() => setPwModalOpen(true)}>
              <KeyRound className="h-4 w-4" />
              {t('portal.changePwBtn')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void loadMySandboxes()}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {t('portal.refreshBtn')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">{t('portal.loadingList')}</div>
      ) : sandboxes.length === 0 ? (
        <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
          <CardContent className="py-16 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/80 text-zinc-400">
              <Lock className="h-5 w-5" />
            </div>
            <h3 className="text-base font-medium text-zinc-100">{t('portal.emptyTitle')}</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
              {t('portal.emptyBefore')}
              <code className="text-zinc-200">{auth?.default_admin_email || 'admin@example.com'}</code>
              {t('portal.emptyAfter')}
            </p>
            {onOpenHiring && (
              <div className="pt-2">
                <Button size="sm" onClick={onOpenHiring}>
                  <Sparkles className="h-4 w-4" />
                  {t('intake.hireShortcut')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-5">
          {sandboxes.map((sbx) => {
            const st = statsMap[sbx.id]
            const badge = badgesMap[sbx.id]
            const isRunning = sbx.status === 'running'
            const canOpenIde = sbx.can_open_ide !== false
            const isShared = sbx.ownership_mode === 'shared'
            return (
              <Card key={sbx.id} className="border-zinc-800 flex flex-col justify-between">
                <CardContent className="p-6 space-y-5 flex-1 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={cn(
                              'h-2.5 w-2.5 rounded-full shrink-0',
                              isRunning ? 'bg-emerald-400' : 'bg-amber-400',
                            )}
                            title={localizeStatus(locale, sbx.status)}
                          />
                          <h2 className="text-lg font-semibold text-zinc-100 tracking-tight truncate">
                            {sbx.display_name || sbx.slug}
                          </h2>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isShared && (
                            <Badge variant="outline" className="border-sky-500/40 text-sky-300">
                              {t('sandbox.badgeShared')}
                            </Badge>
                          )}
                          {sbx.role_title && (
                            <Badge variant="secondary">
                              <Briefcase className="h-3 w-3 mr-0.5" />
                              {sbx.role_title}
                            </Badge>
                          )}
                          {(sbx.team_names && sbx.team_names.length > 0
                            ? sbx.team_names
                            : sbx.project_team_name
                              ? [sbx.project_team_name]
                              : []
                          ).map((tName) => (
                            <Badge
                              key={tName}
                              variant="outline"
                              className="border-violet-500/40 text-violet-300"
                            >
                              {tName}
                            </Badge>
                          ))}
                          {badge && badge.pending_approvals > 0 && (
                            <Badge variant="warning">
                              {t('inbox.filterPending')} {badge.pending_approvals}
                            </Badge>
                          )}
                          {badge && badge.blocked_tasks > 0 && (
                            <Badge variant="destructive">
                              {t('inbox.filterBlocked')} {badge.blocked_tasks}
                            </Badge>
                          )}
                          {badge && badge.exposed_apps > 0 && (
                            <Badge variant="outline" className="border-sky-500/40 text-sky-300">
                              {t('inbox.kpiApps')} {badge.exposed_apps}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ActionMenu
                        label={t('common.moreActions')}
                        header={
                          <div className="space-y-0.5 font-mono">
                            <div>
                              @{sbx.slug} · {localizeStatus(locale, sbx.status)}
                            </div>
                            {isRunning && st ? (
                              <div>
                                CPU {st.cpu_percent}% · MEM {st.memory_usage_mb}MB
                                {sbx.disk_usage_mb != null
                                  ? ` · ${formatDiskSize(sbx.disk_usage_mb)}`
                                  : ''}
                              </div>
                            ) : (
                              <div>
                                {t('portal.specLabel', {
                                  cpu: sbx.cpu_limit,
                                  memory: sbx.memory_limit,
                                })}
                              </div>
                            )}
                          </div>
                        }
                        items={[
                          {
                            label: t('intake.openBtn'),
                            icon: <Send className="h-4 w-4 text-indigo-400" />,
                            onClick: () => openIntakeModal(sbx),
                          },
                          ...(canOpenIde
                            ? [
                                isRunning
                                  ? {
                                      label: t('portal.stopBtn'),
                                      icon: <Square className="h-4 w-4 text-amber-400" />,
                                      onClick: () => handleAction(sbx, 'stop'),
                                      dividerBefore: true,
                                    }
                                  : {
                                      label: t('portal.startBtn'),
                                      icon: <Play className="h-4 w-4 text-emerald-400" />,
                                      onClick: () => handleAction(sbx, 'start'),
                                      dividerBefore: true,
                                    },
                                {
                                  label: t('portal.restartBtn'),
                                  icon: <RotateCw className="h-4 w-4" />,
                                  onClick: () => handleAction(sbx, 'restart'),
                                },
                                {
                                  label: t('portal.backupBtn'),
                                  icon: <Download className="h-4 w-4" />,
                                  onClick: () => setBackupTarget(sbx),
                                  dividerBefore: true,
                                },
                                {
                                  label: t('portal.logsBtn'),
                                  icon: <FileText className="h-4 w-4" />,
                                  onClick: () => openLogsModal(sbx),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </div>

                    {sbx.role_description && (
                      <p className="text-sm text-zinc-400 leading-relaxed line-clamp-2">
                        {sbx.role_description}
                      </p>
                    )}
                  </div>

                  <div className="pt-4 border-t border-zinc-800/70 flex items-center gap-2.5">
                    {canOpenIde ? (
                      <Button
                        variant="default"
                        className="flex-1"
                        onClick={() => window.open(`/sandboxes/${sbx.id}/open`, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4" />
                        {t('portal.openBtn')}
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        className="flex-1"
                        onClick={() => openIntakeModal(sbx)}
                      >
                        <Send className="h-4 w-4" />
                        {t('intake.openBtn')}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setWorkforceTarget(sbx)}
                    >
                      <Activity className="h-4 w-4 text-indigo-400" />
                      {t('portal.workforceBtn')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Structured Task Intake Modal with File Attachments */}
      <Dialog
        open={!!intakeTarget}
        onOpenChange={(o) => !o && !submittingIntake && setIntakeTarget(null)}
        title={t('intake.dialogTitle', {
          name: intakeTarget?.display_name || intakeTarget?.slug || '',
        })}
        description={t('intake.dialogDesc')}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSubmitIntake} className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label>{t('intake.titleLabel')}</Label>
            <Input
              required
              placeholder={t('intake.titlePlaceholder')}
              value={intakeForm.title}
              onChange={(e) => setIntakeForm({ ...intakeForm, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('intake.descLabel')}</Label>
            <Textarea
              rows={4}
              placeholder={t('intake.descPlaceholder')}
              value={intakeForm.description}
              onChange={(e) => setIntakeForm({ ...intakeForm, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label>{t('intake.priorityLabel')}</Label>
              <Select
                value={intakeForm.priority}
                onChange={(e) => setIntakeForm({ ...intakeForm, priority: e.target.value })}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </div>
            <label className="flex items-center gap-2 rounded-[var(--brand-radius-sm)] border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={intakeForm.approval_required}
                onChange={(e) =>
                  setIntakeForm({ ...intakeForm, approval_required: e.target.checked })
                }
                className="rounded border-zinc-700 accent-indigo-500"
              />
              <span>{t('intake.approvalLabel')}</span>
            </label>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Paperclip className="h-3.5 w-3.5 text-zinc-400" />
              <span>{t('intake.filesLabel')}</span>
            </Label>
            <input
              type="file"
              multiple
              onChange={(e) => setIntakeFiles(Array.from(e.target.files || []).slice(0, 5))}
              className="block w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border file:border-zinc-700 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200 hover:file:bg-zinc-800"
            />
            {intakeFiles.length > 0 && (
              <div className="text-xs text-zinc-400 space-y-0.5 pt-1">
                <div>{t('intake.filesHint', { count: intakeFiles.length })}</div>
                <div className="flex flex-wrap gap-1.5">
                  {intakeFiles.map((f) => (
                    <Badge key={f.name} variant="secondary" className="font-mono text-[11px]">
                      {f.name} ({Math.max(1, Math.round(f.size / 1024))} KB)
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
            <Button
              type="button"
              variant="ghost"
              disabled={submittingIntake}
              onClick={() => setIntakeTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submittingIntake}>
              <Send className="h-4 w-4" />
              {submittingIntake ? t('intake.submitting') : t('intake.submitBtn')}
            </Button>
          </div>
        </form>
      </Dialog>

      <WorkforceInspectorDialog
        sandbox={
          workforceTarget
            ? sandboxes.find((s) => s.id === workforceTarget.id) ?? workforceTarget
            : null
        }
        isAdmin={Boolean(auth?.admin)}
        onClose={() => setWorkforceTarget(null)}
        notify={notify}
        onSandboxUpdated={loadMySandboxes}
      />

      <BackupRestoreDialog
        sandbox={backupTarget}
        isAdmin={Boolean(auth?.admin)}
        onClose={() => setBackupTarget(null)}
        notify={notify}
        onRestored={loadMySandboxes}
      />

      {/* User Portal Logs Modal */}
      <Dialog
        open={!!logsTarget}
        onOpenChange={(o) => !o && setLogsTarget(null)}
        title={t('portal.logsTitle', { slug: logsTarget?.slug ?? '' })}
        maxWidth="max-w-4xl"
      >
        <div className="space-y-3">
          <div className="flex justify-end items-center">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => logsTarget && openLogsModal(logsTarget)}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loadingLogs && 'animate-spin')} />
                {t('dialog.logs.refresh')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void copyTextToClipboard(logsText).then((ok) =>
                    notify(ok ? t('portal.logsCopied') : t('common.copyFailed'), ok ? 'success' : 'error')
                  )
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                {t('dialog.logs.copy')}
              </Button>
            </div>
          </div>
          <pre className="h-96 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-all">
            {loadingLogs ? t('dialog.logs.loading') : logsText}
          </pre>
        </div>
      </Dialog>

      {/* Change My Password Modal */}
      <Dialog
        open={pwModalOpen}
        onOpenChange={(o) => !o && setPwModalOpen(false)}
        title={t('portal.pwDialogTitle')}
        description={t('portal.pwDialogDesc', { email: auth?.email ?? '' })}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (pwForm.new_password !== pwForm.confirm_password) {
              notify(t('portal.pwMismatch'), 'error')
              return
            }
            setSavingPw(true)
            try {
              await apiFetch('/api/my/password', {
                method: 'POST',
                body: JSON.stringify({
                  current_password: pwForm.current_password || null,
                  new_password: pwForm.new_password,
                }),
              })
              notify(t('portal.pwChanged'))
              setPwModalOpen(false)
              setPwForm({ current_password: '', new_password: '', confirm_password: '' })
            } catch (err: any) {
              notify(err.message, 'error')
            } finally {
              setSavingPw(false)
            }
          }}
          className="space-y-4 text-xs"
        >
          {auth?.has_password && (
            <div className="space-y-1.5">
              <Label>{t('portal.currentPwLabel')}</Label>
              <Input
                type="password"
                required
                value={pwForm.current_password}
                onChange={(e) =>
                  setPwForm({ ...pwForm, current_password: e.target.value })
                }
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{t('portal.newPwLabel')}</Label>
            <Input
              type="password"
              required
              minLength={6}
              value={pwForm.new_password}
              onChange={(e) =>
                setPwForm({ ...pwForm, new_password: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('portal.confirmPwLabel')}</Label>
            <Input
              type="password"
              required
              minLength={6}
              value={pwForm.confirm_password}
              onChange={(e) =>
                setPwForm({ ...pwForm, confirm_password: e.target.value })
              }
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setPwModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingPw}>
              {savingPw ? t('portal.submitting') : t('portal.pwSubmit')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
