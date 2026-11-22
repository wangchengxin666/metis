import { useCallback, useEffect, useState } from 'react'
import { Briefcase, Clock, ExternalLink, Layers, RefreshCw, Search, Settings2, Sparkles, Users } from 'lucide-react'
import { Badge, Button, Dialog, Input, cn } from './ui'
import { apiFetch } from '../lib/client.ts'
import { copyTextToClipboard } from '../lib/format'
import { localizeStatus } from '../lib/i18n.ts'
import { useI18n } from '../lib/i18nContext'
import type { SandboxItem, WorkforceRuntimeData } from '../types'
import {
  WorkforceAppsCard,
  WorkforceScheduleCard,
  WorkforceServicesCard,
} from './workforce/WorkforceDeliverySection'
import {
  WorkforceFinOpsCard,
  WorkforceMeshCard,
} from './workforce/WorkforceGovernanceSection'
import { WorkforceTaskObserverCard, WorkforceWebhookCard } from './workforce/WorkforceIntakeSection'

export function WorkforceInspectorDialog({
  sandbox,
  isAdmin,
  onClose,
  notify,
  onSandboxUpdated,
}: {
  sandbox: SandboxItem | null
  isAdmin: boolean
  onClose: () => void
  notify: (msg: string, type?: 'success' | 'error') => void
  onSandboxUpdated?: () => Promise<void> | void
}) {
  const { locale, t } = useI18n()
  const [data, setData] = useState<WorkforceRuntimeData | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'work' | 'schedule' | 'advanced'>('work')
  const [searchQuery, setSearchQuery] = useState('')
  const [taskFilter, setTaskFilter] = useState<'all' | 'active' | 'done' | 'approval'>('all')

  const apiBase = isAdmin ? '/api/sandboxes' : '/api/my/sandboxes'
  const sandboxId = sandbox?.id ?? null

  const loadWorkforce = useCallback(async () => {
    if (!sandboxId) return
    setLoading(true)
    try {
      const res = await apiFetch<WorkforceRuntimeData>(`${apiBase}/${sandboxId}/workforce`)
      setData(res)
    } catch (err: any) {
      notify(err.message || 'Load failed', 'error')
    } finally {
      setLoading(false)
    }
  }, [sandboxId, apiBase, notify])

  useEffect(() => {
    if (sandboxId) {
      setActiveTab('work')
      setSearchQuery('')
      setTaskFilter('all')
      void loadWorkforce()
    } else {
      setData(null)
    }
  }, [sandboxId, loadWorkforce])

  const meshSummary = data?.mesh_summary
  const isOnline = data ? (data.online ?? data.status === 'running') : false
  const effectiveRoleTitle = data?.role_title || sandbox?.role_title || meshSummary?.role
  const effectiveRoleDesc =
    data?.role_description || sandbox?.role_description || meshSummary?.description
  const effectiveSop = data?.role_sop || sandbox?.role_sop

  const pagesCount = data?.exposed_apps?.length ?? 0
  const tasksCount = meshSummary?.tasks?.length ?? 0
  const cronCount = data?.cron_jobs?.length ?? 0
  const servicesCount = (data?.user_services || data?.services || []).length
  const totalItems = pagesCount + tasksCount + cronCount + servicesCount

  const promptExamples = [
    t('dialog.workforce.promptPage'),
    t('dialog.workforce.promptCron'),
    t('dialog.workforce.promptTask'),
  ]

  return (
    <Dialog
      open={!!sandbox}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.workforce.title', { slug: sandbox?.slug ?? '' })}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-4 text-sm">
        {/* Compact Single Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {effectiveRoleTitle && (
              <Badge variant="secondary">
                <Briefcase className="h-3.5 w-3.5 mr-1" />
                {effectiveRoleTitle}
              </Badge>
            )}
            {sandbox?.project_team_name && (
              <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                <Users className="h-3.5 w-3.5 mr-1" />
                {sandbox.project_team_name}
              </Badge>
            )}
            <Badge variant={sandbox?.status === 'running' ? 'success' : 'secondary'}>
              {localizeStatus(locale, sandbox?.status || 'stopped')}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {sandbox && (
              <Button
                variant="default"
                size="sm"
                onClick={() => window.open(`/sandboxes/${sandbox.id}/open`, '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('portal.openBtn')}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void loadWorkforce()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              {t('common.refresh')}
            </Button>
          </div>
        </div>

        {/* Collapsible Role & SOP (hidden by default to keep focus on deliverables) */}
        {(effectiveRoleDesc || effectiveSop) && (
          <details className="rounded-[var(--brand-radius-md)] border border-zinc-800/80 bg-zinc-950/40 px-3.5 py-2">
            <summary className="cursor-pointer text-xs font-medium text-zinc-400 hover:text-zinc-200 select-none">
              {t('dialog.workforce.roleInfoToggle')}
            </summary>
            <div className="mt-2.5 space-y-2 pb-1">
              {effectiveRoleDesc && (
                <p className="text-sm text-zinc-200 leading-relaxed">{effectiveRoleDesc}</p>
              )}
              {effectiveSop && (
                <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-300 leading-relaxed rounded-lg bg-zinc-900/70 p-3">
                  {effectiveSop}
                </pre>
              )}
            </div>
          </details>
        )}

        {/* 3-Tab Switcher + Conditional Search (shown when items > 5 or searching) */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 p-1">
            {[
              {
                id: 'work' as const,
                label: t('dialog.workforce.tabWork'),
                icon: Layers,
                badge: tasksCount + pagesCount || undefined,
              },
              {
                id: 'schedule' as const,
                label: t('dialog.workforce.tabSchedule'),
                icon: Clock,
                badge: cronCount > 0 ? cronCount : undefined,
              },
              {
                id: 'advanced' as const,
                label: t('dialog.workforce.tabAdvanced'),
                icon: Settings2,
                badge: servicesCount > 0 ? servicesCount : undefined,
              },
            ].map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-4 py-2 text-sm font-medium transition-all cursor-pointer',
                    active
                      ? 'brand-tab-active shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                  {tab.badge != null && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        active ? 'bg-black/20' : 'bg-zinc-800 text-zinc-300',
                      )}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {(totalItems > 5 || searchQuery) && (
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                className="pl-9"
                placeholder={t('dialog.workforce.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* AI Chat Prompt Hints — shown ONLY when completely empty so active views stay spotless */}
        {isOnline && data && totalItems === 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--brand-radius-md)] border border-dashed border-zinc-800 bg-zinc-950/40 px-3.5 py-2.5 text-xs text-zinc-400">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
            <span>{t('dialog.workforce.chatFirstHint')}</span>
            {promptExamples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() =>
                  void copyTextToClipboard(ex).then((ok) =>
                    notify(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'success' : 'error'),
                  )
                }
                className="rounded-full border border-zinc-800 bg-zinc-900/70 px-2.5 py-1 text-xs text-zinc-200 hover:border-zinc-600 transition-colors cursor-pointer"
              >
                “{ex}”
              </button>
            ))}
          </div>
        )}

        {/* Tab Panels */}
        {activeTab === 'work' && (
          !isOnline || !data || !sandbox ? (
            <div className="rounded-[var(--brand-radius-md)] border border-amber-500/30 bg-amber-950/25 p-5 text-sm text-amber-200 leading-relaxed">
              {t('dialog.workforce.offlineHint')}
            </div>
          ) : (
            <div className="space-y-4">
              <WorkforceAppsCard
                sandbox={sandbox}
                isAdmin={isAdmin}
                apiBase={apiBase}
                data={data}
                searchQuery={searchQuery}
                notify={notify}
                onReload={loadWorkforce}
                onSandboxUpdated={onSandboxUpdated}
              />
              <WorkforceTaskObserverCard
                sandbox={sandbox}
                apiBase={apiBase}
                meshSummary={meshSummary}
                searchQuery={searchQuery}
                taskFilter={taskFilter}
                onTaskFilterChange={setTaskFilter}
                notify={notify}
                onReload={loadWorkforce}
              />
              <WorkforceFinOpsCard data={data} searchQuery={searchQuery} />
            </div>
          )
        )}

        {activeTab === 'schedule' && (
          !isOnline || !data || !sandbox ? (
            <div className="rounded-[var(--brand-radius-md)] border border-amber-500/30 bg-amber-950/25 p-5 text-sm text-amber-200 leading-relaxed">
              {t('dialog.workforce.offlineHint')}
            </div>
          ) : (
            <WorkforceScheduleCard
              sandbox={sandbox}
              apiBase={apiBase}
              data={data}
              searchQuery={searchQuery}
              notify={notify}
              onReload={loadWorkforce}
            />
          )
        )}

        {activeTab === 'advanced' && sandbox && (
          <div className="space-y-4">
            {isOnline && data ? (
              <>
                <WorkforceMeshCard data={data} />
                <WorkforceWebhookCard
                  sandbox={sandbox}
                  isAdmin={isAdmin}
                  notify={notify}
                  onSandboxUpdated={onSandboxUpdated}
                />
                <WorkforceServicesCard
                  sandbox={sandbox}
                  apiBase={apiBase}
                  data={data}
                  searchQuery={searchQuery}
                  notify={notify}
                  onReload={loadWorkforce}
                />
              </>
            ) : (
              <>
                <WorkforceWebhookCard
                  sandbox={sandbox}
                  isAdmin={isAdmin}
                  notify={notify}
                  onSandboxUpdated={onSandboxUpdated}
                />
                <div className="rounded-[var(--brand-radius-md)] border border-amber-500/30 bg-amber-950/25 p-5 text-sm text-amber-200 leading-relaxed">
                  {t('dialog.workforce.offlineHint')}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
