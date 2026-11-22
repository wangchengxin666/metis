import { useState } from 'react'
import { Activity, Users } from 'lucide-react'
import { Badge, Button, Progress } from '../ui'
import { useI18n } from '../../lib/i18nContext'
import type { WorkforceRuntimeData } from '../../types'

const FILE_PAGE_SIZE = 12

export function WorkforceMeshCard({ data }: { data: WorkforceRuntimeData }) {
  const { t } = useI18n()
  const meshSummary = data.mesh_summary
  if (!meshSummary) return null

  return (
    <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
      <div className="font-medium text-zinc-100 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-indigo-400" />
          {t('dialog.workforce.meshTitle')}
        </span>
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
        <div className="flex flex-wrap gap-2">
          {meshSummary.peers.map((peer) => (
            <Badge key={peer.slug} variant="secondary" className="font-mono">
              @{peer.slug}
              {peer.role ? ` · ${peer.role}` : ''}
            </Badge>
          ))}
        </div>
      )}

      {meshSummary.groups.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {meshSummary.groups.map((rm) => (
            <Badge
              key={rm.id}
              variant="outline"
              className="border-indigo-500/40 text-indigo-300"
            >
              #{rm.name} ({rm.member_count})
              {rm.moderator_slug ? ` · Lead: @${rm.moderator_slug}` : ''}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

export function WorkforceFinOpsCard({
  data,
  searchQuery,
}: {
  data: WorkforceRuntimeData
  searchQuery: string
}) {
  const { t } = useI18n()
  const [fileLimit, setFileLimit] = useState(FILE_PAGE_SIZE)
  const tokenUsage = data.token_usage
  const q = searchQuery.trim().toLowerCase()
  const sharedFiles = (data.shared_files || []).filter(
    (f) => !q || f.name.toLowerCase().includes(q),
  )
  const remaining = sharedFiles.length - fileLimit

  return (
    <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
      <div className="font-medium text-zinc-100 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-emerald-400" />
          {t('dialog.workforce.finopsTitle')}
        </span>
        {tokenUsage?.daily_limit ? (
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 font-mono">
            {t('dialog.workforce.dailyLimitLabel', {
              limit: tokenUsage.daily_limit.toLocaleString(),
            })}
          </Badge>
        ) : null}
      </div>

      {tokenUsage && (
        <div className="space-y-2">
          <div className="text-sm text-zinc-300">
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

      <div className="pt-2.5 border-t border-zinc-800/70 space-y-2">
        <div className="text-sm font-medium text-zinc-300">
          {t('dialog.workforce.sharedFilesTitle')} ({sharedFiles.length})
        </div>
        {sharedFiles.length === 0 ? (
          <p className="text-sm text-zinc-400 leading-relaxed">
            {q
              ? t('dialog.workforce.noMatch', { query: searchQuery })
              : t('dialog.workforce.sharedFilesEmpty')}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {sharedFiles.slice(0, fileLimit).map((f) => (
                <Badge key={f.name} variant="secondary" className="font-mono">
                  {f.name} ({f.size_bytes} B)
                </Badge>
              ))}
            </div>
            {sharedFiles.length > FILE_PAGE_SIZE && (
              <div className="flex items-center gap-2 pt-1">
                {remaining > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFileLimit((n) => n + FILE_PAGE_SIZE)}
                  >
                    {t('dialog.workforce.loadMoreBtn', { remaining })}
                  </Button>
                )}
                {fileLimit > FILE_PAGE_SIZE && (
                  <Button variant="ghost" size="sm" onClick={() => setFileLimit(FILE_PAGE_SIZE)}>
                    {t('dialog.workforce.collapseBtn')}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
