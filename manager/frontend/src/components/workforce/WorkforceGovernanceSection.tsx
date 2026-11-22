import { Activity } from 'lucide-react'
import { Badge, Progress } from '../ui'
import { useI18n } from '../../lib/i18nContext'
import type { WorkforceRuntimeData } from '../../types'

export function WorkforceGovernanceSection({ data }: { data: WorkforceRuntimeData }) {
  const { t } = useI18n()
  const meshSummary = data.mesh_summary
  const tokenUsage = data.token_usage
  const sharedFiles = data.shared_files || []

  return (
    <>
            {/* 4. Collaboration Mesh & Task Status (sandbox-mesh) */}
            {meshSummary && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2.5">
                <div className="font-medium text-zinc-200 flex flex-wrap items-center justify-between gap-2">
                  <span>{t('dialog.workforce.meshTitle')}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">
                      {t('dialog.workforce.peersCount', { count: meshSummary.peers.length })}
                    </Badge>
                    <Badge variant="outline">
                      {t('dialog.workforce.groupsCount', { count: meshSummary.groups.length })}
                    </Badge>
                    <Badge variant="outline">
                      {t('dialog.workforce.activeTasks', { count: meshSummary.active_tasks_count })}
                    </Badge>
                    <Badge variant="outline">
                      {t('dialog.workforce.doneTasks', { count: meshSummary.done_tasks_count })}
                    </Badge>
                  </div>
                </div>

                {meshSummary.peers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {meshSummary.peers.map((peer) => (
                      <Badge key={peer.slug} variant="secondary" className="font-mono text-[10px]">
                        @{peer.slug}
                        {peer.role ? ` · ${peer.role}` : ''}
                      </Badge>
                    ))}
                  </div>
                )}

                {meshSummary.groups.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {meshSummary.groups.map((rm) => (
                      <Badge
                        key={rm.id}
                        variant="outline"
                        className="border-indigo-500/40 text-indigo-300 text-[10px]"
                      >
                        #{rm.name} ({rm.member_count})
                        {rm.moderator_slug ? ` · Lead: @${rm.moderator_slug}` : ''}
                      </Badge>
                    ))}
                  </div>
                )}

                {meshSummary.tasks && meshSummary.tasks.length > 0 && (
                  <div className="max-h-36 overflow-y-auto divide-y divide-zinc-800/60 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2.5">
                    {meshSummary.tasks.slice(0, 12).map((tk) => (
                      <div key={tk.id} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="text-zinc-200 truncate">{tk.title}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {tk.priority && (
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {tk.priority}
                            </Badge>
                          )}
                          <Badge
                            variant={tk.status === 'done' ? 'success' : 'secondary'}
                            className="text-[10px]"
                          >
                            {tk.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 5. LLM Token FinOps & Shared Project Space (/home/workspace/shared) */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2.5">
              <div className="font-medium text-zinc-200 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-emerald-400" />
                  {t('dialog.workforce.finopsTitle')}
                </span>
                {tokenUsage?.daily_limit ? (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 font-mono text-[10px]">
                    {t('dialog.workforce.dailyLimitLabel', {
                      limit: tokenUsage.daily_limit.toLocaleString(),
                    })}
                  </Badge>
                ) : null}
              </div>

              {tokenUsage && (
                <div className="space-y-1.5">
                  <div className="text-zinc-300 font-mono text-[11px]">
                    {t('dialog.workforce.estimatedTokens', {
                      tokens: tokenUsage.estimated_tokens.toLocaleString(),
                      sessions: tokenUsage.sessions_count,
                      messages: tokenUsage.messages_count,
                    })}
                  </div>
                  {tokenUsage.daily_limit && tokenUsage.daily_limit > 0 && (
                    <Progress
                      value={Math.min(
                        100,
                        Math.round((tokenUsage.estimated_tokens / tokenUsage.daily_limit) * 100),
                      )}
                    />
                  )}
                </div>
              )}

              <div className="pt-1 border-t border-zinc-800/70 space-y-1.5">
                <div className="text-zinc-400">{t('dialog.workforce.sharedFilesTitle')}</div>
                {sharedFiles.length === 0 ? (
                  <p className="text-zinc-500">{t('dialog.workforce.sharedFilesEmpty')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {sharedFiles.map((f) => (
                      <Badge key={f.name} variant="secondary" className="font-mono text-[10px]">
                        {f.name} ({f.size_bytes} B)
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

    </>
  )
}
