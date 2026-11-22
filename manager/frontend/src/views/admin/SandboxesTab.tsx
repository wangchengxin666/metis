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
import { ActionMenu, Badge, Button, Card, cn } from '../../components/ui'
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

  return (
    <Card className="overflow-visible">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800/80 bg-zinc-950/50 text-zinc-400">
              <th className="py-3.5 px-5 font-medium">{t('admin.sandboxes.colWorkspace')}</th>
              <th className="py-3.5 px-5 font-medium">{t('admin.sandboxes.colStatus')}</th>
              <th className="py-3.5 px-5 font-medium">{t('admin.sandboxes.colResources')}</th>
              <th className="py-3.5 px-5 font-medium text-right">{t('admin.sandboxes.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {sandboxes.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-16 text-center text-zinc-500">
                  {t('admin.sandboxes.empty')}
                </td>
              </tr>
            ) : (
              sandboxes.map((sbx) => {
                const st = statsMap[sbx.id]
                const isRunning = sbx.status === 'running'
                return (
                  <tr key={sbx.id} className="hover:bg-zinc-800/20 transition-colors">
                    <td className="py-4 px-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-base text-zinc-100">
                          {sbx.display_name || sbx.slug}
                        </span>
                        {sbx.role_title && (
                          <Badge variant="secondary">
                            <Briefcase className="h-3 w-3 mr-0.5" />
                            {sbx.role_title}
                          </Badge>
                        )}
                        {sbx.project_team_name && (
                          <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                            <Users className="h-3 w-3 mr-0.5" />
                            {sbx.project_team_name}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-zinc-400">
                        <span className="font-mono">@{sbx.slug}</span> · {sbx.email}
                        {sbx.llm_profile_name ? ` · ${sbx.llm_profile_name}` : ''}
                      </div>
                    </td>

                    <td className="py-4 px-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            isRunning
                              ? 'success'
                              : sbx.status === 'starting' || sbx.status === 'creating'
                                ? 'warning'
                                : 'destructive'
                          }
                        >
                          <span
                            className={cn(
                              'h-2 w-2 rounded-full',
                              isRunning ? 'bg-emerald-400' : 'bg-rose-400',
                            )}
                          />
                          {formatStatus(sbx.status)}
                        </Badge>
                        {sbx.auto_sleep_exempt && (
                          <Badge variant="outline">
                            <Moon className="h-3 w-3 mr-0.5" />
                            {t('admin.sandboxes.keepAliveBadge')}
                          </Badge>
                        )}
                      </div>
                    </td>

                    <td className="py-4 px-5">
                      {isRunning && st ? (
                        <div className="font-mono text-xs text-zinc-300 space-y-0.5">
                          <div>
                            CPU {st.cpu_percent}% · MEM {st.memory_usage_mb}/{st.memory_limit_mb} MB
                          </div>
                          {(st.disk_usage_mb ?? sbx.disk_usage_mb) != null && (
                            <div className="text-zinc-500">
                              {t('admin.sandboxes.diskCachedLabel', {
                                size: formatDiskSize(st.disk_usage_mb ?? sbx.disk_usage_mb),
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-zinc-500 font-mono">
                          {sbx.cpu_limit} vCPU · {sbx.memory_limit}
                          {sbx.disk_usage_mb != null
                            ? ` · ${formatDiskSize(sbx.disk_usage_mb)}`
                            : ''}
                        </div>
                      )}
                    </td>

                    <td className="py-4 px-5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => window.open(`/sandboxes/${sbx.id}/open`, '_blank')}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {t('admin.sandboxes.openWorkspace')}
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          title={t('admin.sandboxes.workforceTooltip')}
                          onClick={() => onWorkforce(sbx)}
                        >
                          <Activity className="h-3.5 w-3.5 text-indigo-400" />
                          {t('portal.workforceBtn')}
                        </Button>

                        <ActionMenu
                          label={t('common.moreActions')}
                          header={
                            <span className="font-mono">
                              {sbx.template} · {sbx.image_repo}:{sbx.image_tag}
                            </span>
                          }
                          items={[
                            isRunning
                              ? {
                                  label: t('admin.sandboxes.stopTooltip'),
                                  icon: <Square className="h-4 w-4 text-amber-400" />,
                                  onClick: () => onSandboxAction(sbx, 'stop'),
                                }
                              : {
                                  label: t('admin.sandboxes.startTooltip'),
                                  icon: <Play className="h-4 w-4 text-emerald-400" />,
                                  onClick: () => onSandboxAction(sbx, 'start'),
                                },
                            {
                              label: t('admin.sandboxes.restartTooltip'),
                              icon: <RotateCw className="h-4 w-4" />,
                              onClick: () => onSandboxAction(sbx, 'restart'),
                            },
                            {
                              label: t('admin.sandboxes.editTooltip'),
                              icon: <Sliders className="h-4 w-4" />,
                              onClick: () => onEdit(sbx),
                              dividerBefore: true,
                            },
                            {
                              label: t('admin.sandboxes.cloneTooltip'),
                              icon: <Copy className="h-4 w-4" />,
                              onClick: () => onClone(sbx),
                            },
                            {
                              label: t('admin.sandboxes.backupTooltip'),
                              icon: <Download className="h-4 w-4" />,
                              onClick: () => onBackup(sbx),
                            },
                            {
                              label: t('admin.sandboxes.logsTooltip'),
                              icon: <FileText className="h-4 w-4" />,
                              onClick: () => onLogs(sbx),
                            },
                            {
                              label: t('admin.sandboxes.destroyTooltip'),
                              icon: <Trash2 className="h-4 w-4" />,
                              onClick: () => onDestroy(sbx),
                              danger: true,
                              dividerBefore: true,
                            },
                          ]}
                        />
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
  )
}
