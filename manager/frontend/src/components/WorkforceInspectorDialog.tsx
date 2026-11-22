import { useCallback, useEffect, useState } from 'react'
import { Briefcase, RefreshCw, Users } from 'lucide-react'
import { Badge, Button, Dialog, cn } from './ui'
import { apiFetch } from '../lib/client.ts'
import { localizeStatus } from '../lib/i18n.ts'
import { useI18n } from '../lib/i18nContext'
import type { SandboxItem, WorkforceRuntimeData } from '../types'
import { WorkforceDeliverySection } from './workforce/WorkforceDeliverySection'
import { WorkforceGovernanceSection } from './workforce/WorkforceGovernanceSection'
import { WorkforceTaskDispatchCard, WorkforceWebhookCard } from './workforce/WorkforceIntakeSection'

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

  const apiBase = isAdmin ? '/api/sandboxes' : '/api/my/sandboxes'

  const loadWorkforce = useCallback(async () => {
    if (!sandbox) return
    setLoading(true)
    try {
      const res = await apiFetch<WorkforceRuntimeData>(`${apiBase}/${sandbox.id}/workforce`)
      setData(res)
    } catch (err: any) {
      notify(err.message || 'Load failed', 'error')
    } finally {
      setLoading(false)
    }
  }, [sandbox, apiBase, notify])

  useEffect(() => {
    if (sandbox) {
      void loadWorkforce()
    } else {
      setData(null)
    }
  }, [sandbox, loadWorkforce])

  const meshSummary = data?.mesh_summary
  const isOnline = data ? (data.online ?? data.status === 'running') : false
  const effectiveRoleTitle = data?.role_title || sandbox?.role_title || meshSummary?.role
  const effectiveRoleDesc =
    data?.role_description || sandbox?.role_description || meshSummary?.description
  const effectiveSop = data?.role_sop || sandbox?.role_sop

  return (
    <Dialog
      open={!!sandbox}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.workforce.title', { slug: sandbox?.slug ?? '' })}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-4 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {effectiveRoleTitle && (
              <Badge variant="default" className="bg-indigo-600/90 text-white">
                <Briefcase className="h-3 w-3 mr-1" />
                {effectiveRoleTitle}
              </Badge>
            )}
            {sandbox?.project_team_name && (
              <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                <Users className="h-3 w-3 mr-1" />
                {sandbox.project_team_name}
              </Badge>
            )}
            <Badge variant={sandbox?.status === 'running' ? 'success' : 'secondary'}>
              {localizeStatus(locale, sandbox?.status || 'stopped')}
            </Badge>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadWorkforce()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
        </div>

        {(effectiveRoleTitle || effectiveRoleDesc || effectiveSop) && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2">
            <div className="font-medium text-zinc-200 flex items-center gap-2">
              <Briefcase className="h-3.5 w-3.5 text-indigo-400" />
              <span>{t('dialog.workforce.roleSection')}</span>
            </div>
            {effectiveRoleDesc && (
              <p className="text-zinc-300 leading-relaxed">{effectiveRoleDesc}</p>
            )}
            {effectiveSop && (
              <details className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2.5">
                <summary className="cursor-pointer font-medium text-indigo-300 select-none">
                  {t('dialog.workforce.sopToggle')}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-zinc-300 leading-relaxed">
                  {effectiveSop}
                </pre>
              </details>
            )}
          </div>
        )}

        {sandbox && (
          <WorkforceWebhookCard
            sandbox={sandbox}
            isAdmin={isAdmin}
            notify={notify}
            onSandboxUpdated={onSandboxUpdated}
          />
        )}

        {!isOnline || !data || !sandbox ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-amber-200">
            {t('dialog.workforce.offlineHint')}
          </div>
        ) : (
          <>
            <WorkforceTaskDispatchCard
              sandbox={sandbox}
              apiBase={apiBase}
              meshSummary={meshSummary}
              notify={notify}
              onReload={loadWorkforce}
            />
            <WorkforceDeliverySection
              sandbox={sandbox}
              isAdmin={isAdmin}
              apiBase={apiBase}
              data={data}
              notify={notify}
              onReload={loadWorkforce}
              onSandboxUpdated={onSandboxUpdated}
            />
            <WorkforceGovernanceSection data={data} />
          </>
        )}
      </div>
    </Dialog>
  )
}
