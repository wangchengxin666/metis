import React, { useEffect, useState } from 'react'
import {
  Clock,
  ExternalLink,
  FileText,
  Play,
  Plus,
  RotateCw,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react'
import { Badge, Button, Input, cn } from '../ui'
import { apiFetch } from '../../lib/client.ts'
import { localizeAction } from '../../lib/i18n.ts'
import { useI18n } from '../../lib/i18nContext'
import type { SandboxItem, WorkforceRuntimeData } from '../../types'

export function WorkforceDeliverySection({
  sandbox,
  isAdmin,
  apiBase,
  data,
  notify,
  onReload,
  onSandboxUpdated,
}: {
  sandbox: SandboxItem
  isAdmin: boolean
  apiBase: string
  data: WorkforceRuntimeData
  notify: (msg: string, type?: 'success' | 'error') => void
  onReload: () => Promise<void>
  onSandboxUpdated?: () => Promise<void> | void
}) {
  const { locale, t } = useI18n()
  const [actingSvc, setActingSvc] = useState<string | null>(null)
  const [togglingPreviewAuth, setTogglingPreviewAuth] = useState(false)
  const [exposeName, setExposeName] = useState('')
  const [exposePort, setExposePort] = useState('')
  const [exposingApp, setExposingApp] = useState(false)
  const [svcName, setSvcName] = useState('')
  const [svcCommand, setSvcCommand] = useState('')
  const [addingSvc, setAddingSvc] = useState(false)
  const [svcLogTarget, setSvcLogTarget] = useState<string | null>(null)
  const [svcLogText, setSvcLogText] = useState('')
  const [loadingSvcLog, setLoadingSvcLog] = useState(false)
  const [cronSchedule, setCronSchedule] = useState('')
  const [cronCommand, setCronCommand] = useState('')
  const [addingCron, setAddingCron] = useState(false)

  useEffect(() => {
    setSvcLogTarget(null)
    setSvcLogText('')
  }, [sandbox.id])

  const handleServiceAction = async (name: string, action: 'start' | 'stop' | 'restart') => {
    setActingSvc(`${name}:${action}`)
    try {
      await apiFetch(`${apiBase}/${sandbox.id}/services/${encodeURIComponent(name)}/${action}`, {
        method: 'POST',
      })
      notify(
        t('dialog.workforce.serviceActionSuccess', {
          name,
          action: localizeAction(locale, action),
        }),
      )
      await onReload()
    } catch (err: any) {
      notify(err.message || 'Service action failed', 'error')
    } finally {
      setActingSvc(null)
    }
  }

  const handleViewServiceLogs = async (name: string) => {
    if (svcLogTarget === name) {
      setSvcLogTarget(null)
      return
    }
    setSvcLogTarget(name)
    setLoadingSvcLog(true)
    try {
      const res = await apiFetch<{ logs: string }>(
        `${apiBase}/${sandbox.id}/services/${encodeURIComponent(name)}/logs?tail=120`,
      )
      setSvcLogText(res.logs || t('admin.noLogs'))
    } catch (err: any) {
      setSvcLogText(err.message || 'Failed to read logs')
    } finally {
      setLoadingSvcLog(false)
    }
  }

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!svcName.trim() || !svcCommand.trim()) return
    setAddingSvc(true)
    try {
      await apiFetch(`${apiBase}/${sandbox.id}/services`, {
        method: 'POST',
        body: JSON.stringify({ name: svcName.trim(), command: svcCommand.trim() }),
      })
      notify(t('dialog.workforce.serviceAdded', { name: svcName.trim() }))
      setSvcName('')
      setSvcCommand('')
      await onReload()
    } catch (err: any) {
      notify(err.message || 'Failed to add service', 'error')
    } finally {
      setAddingSvc(false)
    }
  }

  const handleRemoveService = async (name: string) => {
    setActingSvc(`${name}:remove`)
    try {
      await apiFetch(`${apiBase}/${sandbox.id}/services/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      })
      notify(t('dialog.workforce.serviceRemoved', { name }))
      if (svcLogTarget === name) setSvcLogTarget(null)
      await onReload()
    } catch (err: any) {
      notify(err.message || 'Failed to remove service', 'error')
    } finally {
      setActingSvc(null)
    }
  }

  const handleExposeApp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!exposeName.trim() || !exposePort.trim()) return
    const portNum = Number.parseInt(exposePort.trim(), 10)
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) return
    setExposingApp(true)
    try {
      await apiFetch(`${apiBase}/${sandbox.id}/apps`, {
        method: 'POST',
        body: JSON.stringify({ name: exposeName.trim().toLowerCase(), port: portNum }),
      })
      notify(t('dialog.workforce.appExposed', { name: exposeName.trim().toLowerCase() }))
      setExposeName('')
      setExposePort('')
      await onReload()
    } catch (err: any) {
      notify(err.message || 'Expose failed', 'error')
    } finally {
      setExposingApp(false)
    }
  }

  const handleUnexposeApp = async (name: string) => {
    try {
      await apiFetch(`${apiBase}/${sandbox.id}/apps/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      })
      notify(t('dialog.workforce.appUnexposed', { name }))
      await onReload()
    } catch (err: any) {
      notify(err.message || 'Remove failed', 'error')
    }
  }

  const handleTogglePreviewAuth = async () => {
    if (!isAdmin) return
    const current = data.preview_auth_mode || sandbox.preview_auth_mode || 'public'
    const next = current === 'authenticated' ? 'public' : 'authenticated'
    setTogglingPreviewAuth(true)
    try {
      await apiFetch<SandboxItem>(`/api/sandboxes/${sandbox.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ preview_auth_mode: next }),
      })
      notify(t('dialog.workforce.previewModeSaved'))
      await onSandboxUpdated?.()
      await onReload()
    } catch (err: any) {
      notify(err.message || 'Toggle failed', 'error')
    } finally {
      setTogglingPreviewAuth(false)
    }
  }

  const handleAddCron = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cronSchedule.trim() || !cronCommand.trim()) return
    setAddingCron(true)
    try {
      await apiFetch(`${apiBase}/${sandbox.id}/cron`, {
        method: 'POST',
        body: JSON.stringify({
          schedule: cronSchedule.trim(),
          command: cronCommand.trim(),
        }),
      })
      notify(t('dialog.workforce.cronAdded'))
      setCronSchedule('')
      setCronCommand('')
      await onReload()
    } catch (err: any) {
      notify(err.message || 'Cron add failed', 'error')
    } finally {
      setAddingCron(false)
    }
  }

  const handleRemoveCron = async (rawLine: string) => {
    if (!rawLine) return
    try {
      await apiFetch(`${apiBase}/${sandbox.id}/cron?raw=${encodeURIComponent(rawLine)}`, {
        method: 'DELETE',
      })
      notify(t('dialog.workforce.cronRemoved'))
      await onReload()
    } catch (err: any) {
      notify(err.message || 'Cron remove failed', 'error')
    }
  }

  const serviceList = data.user_services || data.services || []
  const effectivePreviewAuth = data.preview_auth_mode || sandbox.preview_auth_mode || 'public'

  return (
    <>
            {/* 1. Exposed Preview Web Apps (sandbox-expose) */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2.5">
              <div className="font-medium text-zinc-200 flex flex-wrap items-center justify-between gap-2">
                <span>{t('dialog.workforce.appsTitle')}</span>
                <div className="flex items-center gap-1.5">
                  {isAdmin ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={togglingPreviewAuth}
                      onClick={handleTogglePreviewAuth}
                    >
                      <ShieldCheck
                        className={cn(
                          'h-3 w-3',
                          effectivePreviewAuth === 'authenticated'
                            ? 'text-amber-400'
                            : 'text-emerald-400',
                        )}
                      />
                      {effectivePreviewAuth === 'authenticated'
                        ? t('dialog.workforce.previewAuthOnly')
                        : t('dialog.workforce.previewPublic')}
                    </Button>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      {effectivePreviewAuth === 'authenticated'
                        ? t('dialog.workforce.previewAuthOnly')
                        : t('dialog.workforce.previewPublic')}
                    </Badge>
                  )}
                  <Badge variant="outline">{data.exposed_apps.length}</Badge>
                </div>
              </div>
              {data.exposed_apps.length === 0 ? (
                <p className="text-zinc-500 leading-relaxed">{t('dialog.workforce.appsEmpty')}</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {data.exposed_apps.map((app) => (
                    <div
                      key={app.name}
                      className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold text-emerald-400">
                            {app.name}
                          </span>
                          {(app.target || app.port) && (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {app.target || `:${app.port}`}
                            </Badge>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-zinc-400 truncate mt-0.5">
                          {app.mount_path || app.url}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="emerald"
                          size="sm"
                          onClick={() => window.open(app.url, '_blank')}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {t('dialog.workforce.openAppBtn')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-rose-400 hover:text-rose-300"
                          title={t('dialog.workforce.unexposeBtn')}
                          onClick={() => handleUnexposeApp(app.name)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <form onSubmit={handleExposeApp} className="flex flex-col sm:flex-row gap-2 pt-1">
                <Input
                  placeholder={t('dialog.workforce.exposeNamePlaceholder')}
                  value={exposeName}
                  onChange={(e) => setExposeName(e.target.value)}
                />
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  className="sm:w-36"
                  placeholder={t('dialog.workforce.exposePortPlaceholder')}
                  value={exposePort}
                  onChange={(e) => setExposePort(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={exposingApp || !exposeName.trim() || !exposePort.trim()}
                  className="shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('dialog.workforce.exposeBtn')}
                </Button>
              </form>
            </div>

            {/* 2. Background Daemons (sandbox-service) */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2.5">
              <div className="font-medium text-zinc-200 flex items-center justify-between">
                <span>{t('dialog.workforce.servicesTitle')}</span>
                <Badge variant="outline">{serviceList.length}</Badge>
              </div>
              {serviceList.length === 0 ? (
                <p className="text-zinc-500 leading-relaxed">{t('dialog.workforce.servicesEmpty')}</p>
              ) : (
                <div className="divide-y divide-zinc-800/70">
                  {serviceList.map((svc) => {
                    const isRunning = svc.status.toUpperCase() === 'RUNNING'
                    return (
                      <div
                        key={svc.name}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium text-zinc-100">{svc.name}</span>
                            <Badge variant={isRunning ? 'success' : 'secondary'}>
                              {svc.status}
                            </Badge>
                          </div>
                          {svc.command && (
                            <div className="font-mono text-[11px] text-zinc-400 truncate mt-0.5">
                              {svc.command}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 shrink-0">
                          {isRunning ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!!actingSvc}
                              onClick={() => handleServiceAction(svc.name, 'stop')}
                            >
                              <Square className="h-3 w-3 text-amber-400" />
                              {t('portal.stopBtn')}
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!!actingSvc}
                              onClick={() => handleServiceAction(svc.name, 'start')}
                            >
                              <Play className="h-3 w-3 text-emerald-400" />
                              {t('portal.startBtn')}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!!actingSvc}
                            onClick={() => handleServiceAction(svc.name, 'restart')}
                          >
                            <RotateCw className="h-3 w-3" />
                            {t('portal.restartBtn')}
                          </Button>
                          <Button
                            variant={svcLogTarget === svc.name ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handleViewServiceLogs(svc.name)}
                          >
                            <FileText className="h-3 w-3" />
                            {t('dialog.workforce.serviceLogsBtn')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-400 hover:text-rose-300"
                            disabled={!!actingSvc}
                            title={t('dialog.workforce.removeBtn')}
                            onClick={() => handleRemoveService(svc.name)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {svcLogTarget && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/90 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="font-mono">service logs: {svcLogTarget}</span>
                    <button
                      type="button"
                      onClick={() => setSvcLogTarget(null)}
                      className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                  <pre className="max-h-48 overflow-auto font-mono text-[11px] text-zinc-300 whitespace-pre-wrap break-all">
                    {loadingSvcLog ? t('dialog.logs.loading') : svcLogText}
                  </pre>
                </div>
              )}
              <form onSubmit={handleAddService} className="flex flex-col sm:flex-row gap-2 pt-1">
                <Input
                  className="sm:w-40"
                  placeholder={t('dialog.workforce.svcNamePlaceholder')}
                  value={svcName}
                  onChange={(e) => setSvcName(e.target.value)}
                />
                <Input
                  className="flex-1"
                  placeholder={t('dialog.workforce.svcCmdPlaceholder')}
                  value={svcCommand}
                  onChange={(e) => setSvcCommand(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={addingSvc || !svcName.trim() || !svcCommand.trim()}
                  className="shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('dialog.workforce.addServiceBtn')}
                </Button>
              </form>
            </div>

            {/* 3. Cron Schedules (sandbox-cron) */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2.5">
              <div className="font-medium text-zinc-200 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-amber-400" />
                  {t('dialog.workforce.cronTitle')}
                </span>
                <Badge variant="outline">{data.cron_jobs.length}</Badge>
              </div>
              {data.cron_jobs.length === 0 ? (
                <p className="text-zinc-500 leading-relaxed">{t('dialog.workforce.cronEmpty')}</p>
              ) : (
                <div className="divide-y divide-zinc-800/70">
                  {data.cron_jobs.map((job, idx) => (
                    <div key={`${job.command}-${idx}`} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {job.name && (
                            <span className="font-mono font-medium text-zinc-200">{job.name}</span>
                          )}
                          <Badge variant="outline" className="font-mono text-[10px] text-amber-300">
                            {job.schedule}
                          </Badge>
                        </div>
                        <div className="font-mono text-[11px] text-zinc-400 truncate mt-0.5">
                          {job.command}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-rose-400 hover:text-rose-300 shrink-0"
                        title={t('dialog.workforce.removeBtn')}
                        onClick={() => handleRemoveCron(job.raw || `${job.schedule} ${job.command}`)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <form onSubmit={handleAddCron} className="flex flex-col sm:flex-row gap-2 pt-1">
                <Input
                  className="sm:w-44 font-mono"
                  placeholder={t('dialog.workforce.cronSchedPlaceholder')}
                  value={cronSchedule}
                  onChange={(e) => setCronSchedule(e.target.value)}
                />
                <Input
                  className="flex-1 font-mono"
                  placeholder={t('dialog.workforce.cronCmdPlaceholder')}
                  value={cronCommand}
                  onChange={(e) => setCronCommand(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={addingCron || !cronSchedule.trim() || !cronCommand.trim()}
                  className="shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('dialog.workforce.addCronBtn')}
                </Button>
              </form>
            </div>

    </>
  )
}
