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
  Play,
  RefreshCw,
  RotateCw,
  Square,
} from 'lucide-react'
import { Badge, Button, Card, CardContent, Dialog, Input, Label, cn } from '../components/ui'
import { BackupRestoreDialog } from '../components/BackupRestoreDialog'
import { ResourceUsageBars } from '../components/ResourceUsageBars'
import { WorkforceInspectorDialog } from '../components/WorkforceInspectorDialog'
import { apiFetch } from '../lib/client.ts'
import { copyTextToClipboard, fetchRunningStats, formatDiskSize } from '../lib/format'
import { localizeAction, localizeStatus } from '../lib/i18n.ts'
import { useI18n } from '../lib/i18nContext'
import type { AuthMe, SandboxItem, SandboxStats } from '../types'

export function UserPortalView({
  auth,
  notify,
}: {
  auth: AuthMe | null
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { locale, t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  const [sandboxes, setSandboxes] = useState<SandboxItem[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, SandboxStats>>({})
  const [loading, setLoading] = useState(true)
  const refreshingRef = useRef(false)
  const [logsTarget, setLogsTarget] = useState<SandboxItem | null>(null)
  const [logsText, setLogsText] = useState('')
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [backupTarget, setBackupTarget] = useState<SandboxItem | null>(null)
  const [workforceTarget, setWorkforceTarget] = useState<SandboxItem | null>(null)
  const [pwModalOpen, setPwModalOpen] = useState(false)
  const [pwForm, setPwForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [savingPw, setSavingPw] = useState(false)

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
      const qEmail = params.get('email') || auth?.email || ''
      const res = await apiFetch<{ items: SandboxItem[] }>(
        `/api/my/sandboxes?refresh=true${qEmail ? `&email=${encodeURIComponent(qEmail)}` : ''}`,
      )
      setSandboxes(res.items)
      const nextStats = await fetchRunningStats(res.items, '/api/my/sandboxes')
      setStatsMap(nextStats)
      if (Object.keys(nextStats).length > 0) {
        setSandboxes((prev) =>
          prev.map((item) =>
            nextStats[item.id]?.disk_usage_mb != null
              ? { ...item, disk_usage_mb: nextStats[item.id].disk_usage_mb }
              : item,
          ),
        )
      }
    } catch (err: any) {
      if (!silent) {
        notify(err.message || tRef.current('portal.loadFailed'), 'error')
      }
    } finally {
      refreshingRef.current = false
      if (!silent) setLoading(false)
    }
  }, [auth, notify])

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
      await apiFetch(`/api/my/sandboxes/${sbx.id}/${action}`, { method: 'POST' })
      notify(t('portal.actionSuccess'))
      await loadMySandboxes()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('portal.bannerTitle')}</h1>
          <p className="text-xs text-zinc-400 mt-1">
            {t('portal.accountPrefix')}
            <span className="text-zinc-200 font-mono">{auth?.email}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!auth?.admin &&
            (auth?.allow_local_user_login ?? auth?.auth_mode !== 'oidc') &&
            (auth?.auth_method !== 'oidc' || auth?.has_password) && (
            <Button variant="outline" size="sm" onClick={() => setPwModalOpen(true)}>
              <KeyRound className="h-3.5 w-3.5" />
              {t('portal.changePwBtn')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void loadMySandboxes()}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('portal.refreshBtn')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-xs text-zinc-500">{t('portal.loadingList')}</div>
      ) : sandboxes.length === 0 ? (
        <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
          <CardContent className="py-14 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/80 text-zinc-400">
              <Lock className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-medium text-zinc-200">{t('portal.emptyTitle')}</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
              {t('portal.emptyBefore')}
              <code className="text-zinc-300">{auth?.default_admin_email || 'admin@example.com'}</code>
              {t('portal.emptyAfter')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {sandboxes.map((sbx) => (
            <Card key={sbx.id} className="border-zinc-800">
              <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-mono text-base font-semibold text-zinc-100">
                      {sbx.slug}
                    </span>
                    <Badge variant={sbx.status === 'running' ? 'success' : 'warning'}>
                      {localizeStatus(locale, sbx.status)}
                    </Badge>
                    <Badge variant="secondary">{sbx.template}</Badge>
                    {sbx.role_title && (
                      <Badge
                        variant="outline"
                        className="border-indigo-500/40 text-indigo-300"
                      >
                        <Briefcase className="h-3 w-3 mr-1" />
                        {sbx.role_title}
                      </Badge>
                    )}
                  </div>
                  {sbx.role_description && (
                    <p className="text-xs text-zinc-300 leading-relaxed max-w-xl">
                      {sbx.role_description}
                    </p>
                  )}
                  <div className="text-xs text-zinc-400 font-mono">
                    <span>
                      {t('portal.specLabel', {
                        cpu: sbx.cpu_limit,
                        memory: sbx.memory_limit,
                      })}
                      {sbx.disk_usage_mb != null
                        ? t('portal.diskLabel', { disk: formatDiskSize(sbx.disk_usage_mb) })
                        : ''}
                    </span>
                  </div>
                  {sbx.status === 'running' && statsMap[sbx.id] && (
                    <div className="pt-1 max-w-xs">
                      <ResourceUsageBars stats={statsMap[sbx.id]} fallbackDiskMb={sbx.disk_usage_mb} />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="emerald"
                    onClick={() => window.open(`/sandboxes/${sbx.id}/open`, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t('portal.openBtn')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setWorkforceTarget(sbx)}
                  >
                    <Activity className="h-3.5 w-3.5 text-indigo-400" />
                    {t('portal.workforceBtn')}
                  </Button>
                  {sbx.status === 'running' ? (
                    <Button variant="outline" size="sm" onClick={() => handleAction(sbx, 'stop')}>
                      <Square className="h-3.5 w-3.5 text-amber-400" />
                      {t('portal.stopBtn')}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => handleAction(sbx, 'start')}>
                      <Play className="h-3.5 w-3.5 text-emerald-400" />
                      {t('portal.startBtn')}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleAction(sbx, 'restart')}>
                    <RotateCw className="h-3.5 w-3.5" />
                    {t('portal.restartBtn')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openLogsModal(sbx)}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {t('portal.logsBtn')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBackupTarget(sbx)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t('portal.backupBtn')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <WorkforceInspectorDialog
        sandbox={
          workforceTarget
            ? sandboxes.find((s) => s.id === workforceTarget.id) ?? workforceTarget
            : null
        }
        isAdmin={false}
        onClose={() => setWorkforceTarget(null)}
        notify={notify}
        onSandboxUpdated={loadMySandboxes}
      />

      <BackupRestoreDialog
        sandbox={backupTarget}
        isAdmin={false}
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
