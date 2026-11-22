import { useEffect, useState } from 'react'
import {
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Play,
  RotateCw,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react'
import { Badge, Button, cn } from '../ui'
import { apiFetch } from '../../lib/client.ts'
import { localizeAction } from '../../lib/i18n.ts'
import { useI18n } from '../../lib/i18nContext'
import { formatScheduleHuman } from '../../lib/theme'
import type { SandboxItem, WorkforceRuntimeData } from '../../types'

const LIST_PAGE_SIZE = 8

export function WorkforceAppsCard({
  sandbox,
  isAdmin,
  apiBase,
  data,
  searchQuery,
  notify,
  onReload,
  onSandboxUpdated,
}: {
  sandbox: SandboxItem
  isAdmin: boolean
  apiBase: string
  data: WorkforceRuntimeData
  searchQuery: string
  notify: (msg: string, type?: 'success' | 'error') => void
  onReload: () => Promise<void>
  onSandboxUpdated?: () => Promise<void> | void
}) {
  const { t } = useI18n()
  const [togglingPreviewAuth, setTogglingPreviewAuth] = useState(false)
  const [limit, setLimit] = useState(LIST_PAGE_SIZE)

  useEffect(() => {
    setLimit(LIST_PAGE_SIZE)
  }, [searchQuery, sandbox.id])

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

  const effectivePreviewAuth = data.preview_auth_mode || sandbox.preview_auth_mode || 'public'
  const q = searchQuery.trim().toLowerCase()
  const filteredApps = (data.exposed_apps || []).filter(
    (app) => !q || `${app.name} ${app.mount_path || ''} ${app.target || ''}`.toLowerCase().includes(q),
  )
  const remaining = filteredApps.length - limit

  return (
    <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
      <div className="font-medium text-zinc-100 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4 text-emerald-400" />
          {t('dialog.workforce.appsTitle')}
          <Badge variant="outline">{filteredApps.length}</Badge>
        </span>
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
                'h-3.5 w-3.5',
                effectivePreviewAuth === 'authenticated' ? 'text-amber-400' : 'text-emerald-400',
              )}
            />
            {effectivePreviewAuth === 'authenticated'
              ? t('dialog.workforce.previewAuthOnly')
              : t('dialog.workforce.previewPublic')}
          </Button>
        ) : (
          <Badge variant="outline">
            {effectivePreviewAuth === 'authenticated'
              ? t('dialog.workforce.previewAuthOnly')
              : t('dialog.workforce.previewPublic')}
          </Badge>
        )}
      </div>

      {filteredApps.length === 0 ? (
        <p className="text-sm text-zinc-400 leading-relaxed">
          {q ? t('dialog.workforce.noMatch', { query: searchQuery }) : t('dialog.workforce.appsEmpty')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filteredApps.slice(0, limit).map((app) => (
              <div
                key={app.name}
                className="flex items-center justify-between gap-3 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-900/70 p-3.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-base text-emerald-400 truncate">
                      {app.name}
                    </span>
                    {(app.target || app.port) && (
                      <Badge variant="outline" className="font-mono text-xs">
                        {app.target || `:${app.port}`}
                      </Badge>
                    )}
                  </div>
                  <div className="font-mono text-xs text-zinc-400 truncate mt-1">
                    {app.mount_path || app.url}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
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
                    size="icon"
                    className="text-rose-400 hover:text-rose-300"
                    title={t('dialog.workforce.unexposeBtn')}
                    onClick={() => handleUnexposeApp(app.name)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {filteredApps.length > LIST_PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 pt-1">
              {remaining > 0 && (
                <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + LIST_PAGE_SIZE)}>
                  {t('dialog.workforce.loadMoreBtn', { remaining })}
                </Button>
              )}
              {limit > LIST_PAGE_SIZE && (
                <Button variant="ghost" size="sm" onClick={() => setLimit(LIST_PAGE_SIZE)}>
                  {t('dialog.workforce.collapseBtn')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function WorkforceScheduleCard({
  sandbox,
  apiBase,
  data,
  searchQuery,
  notify,
  onReload,
}: {
  sandbox: SandboxItem
  apiBase: string
  data: WorkforceRuntimeData
  searchQuery: string
  notify: (msg: string, type?: 'success' | 'error') => void
  onReload: () => Promise<void>
}) {
  const { locale, t } = useI18n()
  const [limit, setLimit] = useState(LIST_PAGE_SIZE)

  useEffect(() => {
    setLimit(LIST_PAGE_SIZE)
  }, [searchQuery, sandbox.id])

  const handleRemoveCron = async (rawLine: string) => {
    if (!rawLine) return
    try {
      await apiFetch(`${apiBase}/${sandbox.id}/cron?raw=${encodeURIComponent(rawLine)}`, {
        method: 'DELETE',
      })
      notify(t('dialog.workforce.cronRemoved'))
      await onReload()
    } catch (err: any) {
      notify(err.message || 'Schedule remove failed', 'error')
    }
  }

  const q = searchQuery.trim().toLowerCase()
  const filteredJobs = (data.cron_jobs || []).filter(
    (job) =>
      !q ||
      `${job.schedule} ${formatScheduleHuman(job.schedule, locale)} ${job.command} ${job.name || ''}`
        .toLowerCase()
        .includes(q),
  )
  const remaining = filteredJobs.length - limit

  return (
    <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
      <div className="font-medium text-zinc-100 flex items-center justify-between">
        <span className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-amber-400" />
          {t('dialog.workforce.cronTitle')}
        </span>
        <Badge variant="outline">{filteredJobs.length}</Badge>
      </div>

      {filteredJobs.length === 0 ? (
        <p className="text-sm text-zinc-400 leading-relaxed">
          {q ? t('dialog.workforce.noMatch', { query: searchQuery }) : t('dialog.workforce.cronEmpty')}
        </p>
      ) : (
        <>
          <div className="divide-y divide-zinc-800/70">
            {filteredJobs.slice(0, limit).map((job, idx) => (
              <div
                key={`${job.command}-${idx}`}
                className="py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning" title={job.schedule}>
                      <Clock className="h-3 w-3" />
                      {formatScheduleHuman(job.schedule, locale)}
                    </Badge>
                    {job.name && <span className="font-medium text-zinc-100">{job.name}</span>}
                    <span className="font-mono text-xs text-zinc-500">{job.schedule}</span>
                  </div>
                  <div className="font-mono text-xs text-zinc-300 truncate">{job.command}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-rose-400 hover:text-rose-300 shrink-0"
                  title={t('dialog.workforce.removeBtn')}
                  onClick={() => handleRemoveCron(job.raw || `${job.schedule} ${job.command}`)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          {filteredJobs.length > LIST_PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 pt-1">
              {remaining > 0 && (
                <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + LIST_PAGE_SIZE)}>
                  {t('dialog.workforce.loadMoreBtn', { remaining })}
                </Button>
              )}
              {limit > LIST_PAGE_SIZE && (
                <Button variant="ghost" size="sm" onClick={() => setLimit(LIST_PAGE_SIZE)}>
                  {t('dialog.workforce.collapseBtn')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function WorkforceServicesCard({
  sandbox,
  apiBase,
  data,
  searchQuery,
  notify,
  onReload,
}: {
  sandbox: SandboxItem
  apiBase: string
  data: WorkforceRuntimeData
  searchQuery: string
  notify: (msg: string, type?: 'success' | 'error') => void
  onReload: () => Promise<void>
}) {
  const { locale, t } = useI18n()
  const [actingSvc, setActingSvc] = useState<string | null>(null)
  const [svcLogTarget, setSvcLogTarget] = useState<string | null>(null)
  const [svcLogText, setSvcLogText] = useState('')
  const [loadingSvcLog, setLoadingSvcLog] = useState(false)

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

  const q = searchQuery.trim().toLowerCase()
  const serviceList = (data.user_services || data.services || []).filter(
    (svc) => !q || `${svc.name} ${svc.command || ''} ${svc.status}`.toLowerCase().includes(q),
  )

  return (
    <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
      <div className="font-medium text-zinc-100 flex items-center justify-between">
        <span className="text-base">{t('dialog.workforce.servicesTitle')}</span>
        <Badge variant="outline">{serviceList.length}</Badge>
      </div>
      {serviceList.length === 0 ? (
        <p className="text-sm text-zinc-400 leading-relaxed">
          {q ? t('dialog.workforce.noMatch', { query: searchQuery }) : t('dialog.workforce.servicesEmpty')}
        </p>
      ) : (
        <div className="divide-y divide-zinc-800/70">
          {serviceList.map((svc) => {
            const isRunning = svc.status.toUpperCase() === 'RUNNING'
            return (
              <div
                key={svc.name}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-zinc-100">{svc.name}</span>
                    <Badge variant={isRunning ? 'success' : 'secondary'}>{svc.status}</Badge>
                  </div>
                  {svc.command && (
                    <div className="font-mono text-xs text-zinc-400 truncate mt-1">
                      {svc.command}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {isRunning ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!actingSvc}
                      onClick={() => handleServiceAction(svc.name, 'stop')}
                    >
                      <Square className="h-3.5 w-3.5 text-amber-400" />
                      {t('portal.stopBtn')}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!actingSvc}
                      onClick={() => handleServiceAction(svc.name, 'start')}
                    >
                      <Play className="h-3.5 w-3.5 text-emerald-400" />
                      {t('portal.startBtn')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!actingSvc}
                    onClick={() => handleServiceAction(svc.name, 'restart')}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    {t('portal.restartBtn')}
                  </Button>
                  <Button
                    variant={svcLogTarget === svc.name ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleViewServiceLogs(svc.name)}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {t('dialog.workforce.serviceLogsBtn')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-rose-400 hover:text-rose-300"
                    disabled={!!actingSvc}
                    title={t('dialog.workforce.removeBtn')}
                    onClick={() => handleRemoveService(svc.name)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {svcLogTarget && (
        <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-900/90 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-mono">service logs: {svcLogTarget}</span>
            <button
              type="button"
              onClick={() => setSvcLogTarget(null)}
              className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              ✕
            </button>
          </div>
          <pre className="max-h-56 overflow-auto font-mono text-xs text-zinc-300 whitespace-pre-wrap break-all">
            {loadingSvcLog ? t('dialog.logs.loading') : svcLogText}
          </pre>
        </div>
      )}
    </div>
  )
}
