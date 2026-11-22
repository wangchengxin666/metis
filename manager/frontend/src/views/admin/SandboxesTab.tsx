import React, { useEffect, useState } from 'react'
import {
  Activity,
  Briefcase,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Moon,
  Play,
  RotateCw,
  Sliders,
  Square,
  Trash2,
  Users,
} from 'lucide-react'
import { Badge, Button, Card, Input, cn } from '../../components/ui'
import { ResourceUsageBars } from '../../components/ResourceUsageBars'
import { apiFetch } from '../../lib/client.ts'
import { formatDiskSize } from '../../lib/format'
import { localizeStatus } from '../../lib/i18n.ts'
import { useI18n } from '../../lib/i18nContext'
import type { OverviewData, SandboxItem, SandboxStats } from '../../types'

export interface SandboxesTabProps {
  sandboxes: SandboxItem[]
  statsMap: Record<string, SandboxStats>
  overview: OverviewData | null
  onRefresh: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
  onWorkforce: (sbx: SandboxItem) => void
  onSandboxAction: (sbx: SandboxItem, action: 'start' | 'stop' | 'restart' | 'recreate') => void
  onLogs: (sbx: SandboxItem) => void
  onEdit: (sbx: SandboxItem) => void
  onClone: (sbx: SandboxItem) => void
  onBackup: (sbx: SandboxItem) => void
  onDestroy: (sbx: SandboxItem) => void
}

export function SandboxesTab({
  sandboxes,
  statsMap,
  overview,
  onRefresh,
  notify,
  onWorkforce,
  onSandboxAction,
  onLogs,
  onEdit,
  onClone,
  onBackup,
  onDestroy,
}: SandboxesTabProps) {
  const { locale, t } = useI18n()
  const formatStatus = (status: string) => localizeStatus(locale, status)
  const [sleepPolicy, setSleepPolicy] = useState({
    enabled: Boolean(overview?.idle_sleep_enabled),
    idle_minutes: String(overview?.idle_sleep_minutes ?? 240),
  })
  const [savingSleepPolicy, setSavingSleepPolicy] = useState(false)

  useEffect(() => {
    if (overview) {
      setSleepPolicy({
        enabled: Boolean(overview.idle_sleep_enabled),
        idle_minutes: String(overview.idle_sleep_minutes ?? 240),
      })
    }
  }, [overview?.idle_sleep_enabled, overview?.idle_sleep_minutes])

  const handleSaveSleepPolicy = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingSleepPolicy(true)
    try {
      const minutes = Math.max(5, parseInt(sleepPolicy.idle_minutes, 10) || 240)
      await apiFetch('/api/policies/idle-sleep', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: sleepPolicy.enabled,
          idle_minutes: minutes,
        }),
      })
      notify(t('admin.sandboxes.sleepPolicySaved'))
      await onRefresh()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSavingSleepPolicy(false)
    }
  }

  return (
        <div className="space-y-4">
          <form
            onSubmit={handleSaveSleepPolicy}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-2.5 text-xs"
          >
            <div className="flex items-center gap-2 text-zinc-200">
              <Moon className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
              <span className="font-medium">{t('admin.sandboxes.sleepPolicyTitle')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sleepPolicy.enabled}
                  onChange={(e) =>
                    setSleepPolicy({ ...sleepPolicy, enabled: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-900 accent-indigo-500"
                />
                <span>{t('admin.sandboxes.sleepEnableLabel')}</span>
              </label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={5}
                  max={43200}
                  className="h-7 w-20 text-xs"
                  value={sleepPolicy.idle_minutes}
                  onChange={(e) =>
                    setSleepPolicy({ ...sleepPolicy, idle_minutes: e.target.value })
                  }
                />
                <span className="text-zinc-400">{t('admin.sandboxes.sleepMinutesUnit')}</span>
              </div>
              <Button type="submit" variant="outline" size="sm" disabled={savingSleepPolicy}>
                {savingSleepPolicy ? t('common.saving') : t('admin.sandboxes.sleepSaveBtn')}
              </Button>
            </div>
          </form>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800/80 bg-zinc-950/60 text-zinc-400">
                    <th className="py-3.5 px-4 font-medium">{t('admin.sandboxes.colWorkspace')}</th>
                    <th className="py-3.5 px-4 font-medium">{t('admin.sandboxes.colTemplate')}</th>
                    <th className="py-3.5 px-4 font-medium">{t('admin.sandboxes.colStatus')}</th>
                    <th className="py-3.5 px-4 font-medium w-52">
                      {t('admin.sandboxes.colResources')}
                    </th>
                    <th className="py-3.5 px-4 font-medium text-right">
                      {t('admin.sandboxes.colActions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {sandboxes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-zinc-500">
                        {t('admin.sandboxes.empty')}
                      </td>
                    </tr>
                  ) : (
                    sandboxes.map((sbx) => {
                      const st = statsMap[sbx.id]
                      return (
                        <tr key={sbx.id} className="hover:bg-zinc-800/25 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-semibold text-sm text-zinc-100">
                                {sbx.slug}
                              </span>
                              {sbx.role_title && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-indigo-500/40 text-indigo-300"
                                >
                                  <Briefcase className="h-2.5 w-2.5 mr-1" />
                                  {sbx.role_title}
                                </Badge>
                              )}
                              {sbx.project_team_name && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-violet-500/40 text-violet-300"
                                >
                                  <Users className="h-2.5 w-2.5 mr-1" />
                                  {sbx.project_team_name}
                                </Badge>
                              )}
                              {sbx.llm_profile_name && (
                                <Badge variant="outline" className="text-[10px]">
                                  LLM: {sbx.llm_profile_name}
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 text-zinc-400">
                              {sbx.display_name ? `${sbx.display_name} (${sbx.email})` : sbx.email}
                            </div>
                            {sbx.role_description && (
                              <div className="mt-0.5 text-[11px] text-zinc-500 max-w-md truncate">
                                {sbx.role_description}
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <Badge variant="secondary">{sbx.template}</Badge>
                              <span className="font-mono text-[11px] text-zinc-400">
                                {sbx.image_repo}:{sbx.image_tag}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px] text-zinc-500">
                              {sbx.cpu_limit} vCPU · {sbx.memory_limit}
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  sbx.status === 'running'
                                    ? 'success'
                                    : sbx.status === 'starting' || sbx.status === 'creating'
                                      ? 'warning'
                                      : 'destructive'
                                }
                              >
                                <span
                                  className={cn(
                                    'h-1.5 w-1.5 rounded-full',
                                    sbx.status === 'running' ? 'bg-emerald-400' : 'bg-rose-400',
                                  )}
                                />
                                {formatStatus(sbx.status)}
                              </Badge>
                              {sbx.auto_sleep_exempt && (
                                <Badge variant="outline" className="text-[10px]">
                                  <Moon className="h-2.5 w-2.5 mr-1" />
                                  {t('admin.sandboxes.keepAliveBadge')}
                                </Badge>
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            {sbx.status === 'running' && st ? (
                              <ResourceUsageBars stats={st} fallbackDiskMb={sbx.disk_usage_mb} />
                            ) : (
                              <div className="space-y-1">
                                <span className="text-zinc-500 text-[11px] block">
                                  {t('admin.sandboxes.notRunning')}
                                </span>
                                {sbx.disk_usage_mb != null && (
                                  <span className="text-zinc-400 text-[11px] font-mono block">
                                    {t('admin.sandboxes.diskCachedLabel', {
                                      size: formatDiskSize(sbx.disk_usage_mb),
                                    })}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="emerald"
                                size="sm"
                                onClick={() => window.open(`/sandboxes/${sbx.id}/open`, '_blank')}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {t('admin.sandboxes.openWorkspace')}
                              </Button>

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.workforceTooltip')}
                                onClick={() => onWorkforce(sbx)}
                              >
                                <Activity className="h-3.5 w-3.5 text-indigo-400" />
                              </Button>

                              {sbx.status === 'running' ? (
                                <Button
                                  variant="outline"
                                  size="icon"
                                  title={t('admin.sandboxes.stopTooltip')}
                                  onClick={() => onSandboxAction(sbx, 'stop')}
                                >
                                  <Square className="h-3.5 w-3.5 text-amber-400" />
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="icon"
                                  title={t('admin.sandboxes.startTooltip')}
                                  onClick={() => onSandboxAction(sbx, 'start')}
                                >
                                  <Play className="h-3.5 w-3.5 text-emerald-400" />
                                </Button>
                              )}

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.restartTooltip')}
                                onClick={() => onSandboxAction(sbx, 'restart')}
                              >
                                <RotateCw className="h-3.5 w-3.5" />
                              </Button>

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.logsTooltip')}
                                onClick={() => onLogs(sbx)}
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </Button>

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.editTooltip')}
                                onClick={() => onEdit(sbx)}
                              >
                                <Sliders className="h-3.5 w-3.5" />
                              </Button>

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.cloneTooltip')}
                                onClick={() => onClone(sbx)}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.backupTooltip')}
                                onClick={() => onBackup(sbx)}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>

                              <Button
                                variant="outline"
                                size="icon"
                                title={t('admin.sandboxes.destroyTooltip')}
                                className="hover:border-rose-500/50 hover:text-rose-400"
                                onClick={() => onDestroy(sbx)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

  )
}
