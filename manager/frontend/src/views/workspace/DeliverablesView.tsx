import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Briefcase,
  Copy,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitPullRequest,
  Globe,
  Link2,
  Lock,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react'
import { Badge, Button, Card, CardContent, Input, Select, cn } from '../../components/ui'
import { WorkforceInspectorDialog } from '../../components/WorkforceInspectorDialog'
import { apiFetch } from '../../lib/client.ts'
import { copyTextToClipboard } from '../../lib/format'
import { useI18n } from '../../lib/i18nContext'
import type { AuthMe, SandboxItem, WorkspaceDeliverablesData } from '../../types'

export function DeliverablesView({
  auth,
  notify,
  projectId,
  compact = false,
}: {
  auth: AuthMe
  notify: (msg: string, type?: 'success' | 'error') => void
  projectId?: string
  compact?: boolean
}) {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  const [data, setData] = useState<WorkspaceDeliverablesData | null>(null)
  const [sandboxes, setSandboxes] = useState<SandboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [activeTab, setActiveTab] = useState<'apps' | 'artifacts'>('apps')
  const [searchQuery, setSearchQuery] = useState('')
  const [teamFilter, setTeamFilter] = useState('all')
  const [visFilter, setVisFilter] = useState('all')
  const [inspectTarget, setInspectTarget] = useState<SandboxItem | null>(null)

  const apiBase = auth.admin ? '/api/sandboxes' : '/api/my/sandboxes'

  const loadDeliverables = useCallback(
    async (opts?: { refresh?: boolean }) => {
      const refresh = Boolean(opts?.refresh)
      if (refresh) setSyncing(true)
      else setLoading(true)
      try {
        const qs = new URLSearchParams()
        if (refresh) qs.set('refresh', 'true')
        if (projectId) qs.set('team_id', projectId)
        const querySuffix = qs.toString() ? `?${qs.toString()}` : ''
        const [delivRes, sbxRes] = await Promise.all([
          apiFetch<WorkspaceDeliverablesData>(`/api/workspace/deliverables${querySuffix}`),
          apiFetch<{ items: SandboxItem[] }>(apiBase),
        ])
        setData(delivRes)
        setSandboxes(sbxRes.items || [])
      } catch (err: any) {
        notify(err.message || tRef.current('admin.loadFailed'), 'error')
      } finally {
        setSyncing(false)
        setLoading(false)
      }
    },
    [apiBase, notify, projectId],
  )

  useEffect(() => {
    void loadDeliverables()
  }, [loadDeliverables])

  const allTeams = useMemo(() => {
    const set = new Set<string>()
    for (const a of data?.apps || []) {
      if (a.project_team_name) set.add(a.project_team_name)
    }
    for (const art of data?.artifacts || []) {
      if (art.project_team_name) set.add(art.project_team_name)
    }
    return Array.from(set).sort()
  }, [data])

  const q = searchQuery.trim().toLowerCase()

  const filteredApps = (data?.apps || []).filter((app) => {
    if (teamFilter !== 'all' && (app.project_team_name || '') !== teamFilter) return false
    if (visFilter !== 'all' && app.preview_auth_mode !== visFilter) return false
    if (
      q &&
      !`${app.name} ${app.url} ${app.sandbox_slug} ${app.role_title || ''} ${app.project_team_name || ''}`
        .toLowerCase()
        .includes(q)
    ) {
      return false
    }
    return true
  })

  const filteredArtifacts = (data?.artifacts || []).filter((art) => {
    if (teamFilter !== 'all' && (art.project_team_name || '') !== teamFilter) return false
    if (
      q &&
      !`${art.value} ${art.task_title} ${art.sandbox_slug} ${art.role_title || ''} ${art.project_team_name || ''}`
        .toLowerCase()
        .includes(q)
    ) {
      return false
    }
    return true
  })

  const renderVisibilityBadge = (mode: string) => {
    if (mode === 'team') {
      return (
        <Badge variant="outline" className="border-violet-500/40 text-violet-300">
          <Users className="h-3 w-3 mr-0.5" />
          {t('deliverables.visTeam')}
        </Badge>
      )
    }
    if (mode === 'authenticated') {
      return (
        <Badge variant="outline" className="border-amber-500/40 text-amber-300">
          <Lock className="h-3 w-3 mr-0.5" />
          {t('deliverables.visOrg')}
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
        <Globe className="h-3 w-3 mr-0.5" />
        {t('deliverables.visPublic')}
      </Badge>
    )
  }

  const renderArtifactKind = (kind: string) => {
    if (kind === 'pr') {
      return (
        <Badge variant="outline" className="border-violet-500/40 text-violet-300">
          <GitPullRequest className="h-3 w-3 mr-0.5" />
          {t('deliverables.kindPr')}
        </Badge>
      )
    }
    if (kind === 'url') {
      return (
        <Badge variant="outline" className="border-sky-500/40 text-sky-300">
          <Link2 className="h-3 w-3 mr-0.5" />
          {t('deliverables.kindUrl')}
        </Badge>
      )
    }
    if (kind === 'branch') {
      return (
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
          <GitBranch className="h-3 w-3 mr-0.5" />
          {t('deliverables.kindBranch')}
        </Badge>
      )
    }
    return (
      <Badge variant="secondary">
        <FileCode2 className="h-3 w-3 mr-0.5" />
        {t('deliverables.kindFile')}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      {!compact ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
              {t('deliverables.title')}
            </h1>
            <p className="text-sm text-zinc-400 mt-1">{t('deliverables.subtitle')}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={syncing}
            onClick={() => void loadDeliverables({ refresh: true })}
          >
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
            {syncing ? t('inbox.syncing') : t('inbox.syncBtn')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={syncing}
            onClick={() => void loadDeliverables({ refresh: true })}
          >
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
            {syncing ? t('inbox.syncing') : t('inbox.syncBtn')}
          </Button>
        </div>
      )}

      {/* Tabs + Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 p-1 self-start">
          <button
            type="button"
            onClick={() => setActiveTab('apps')}
            className={cn(
              'flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer',
              activeTab === 'apps'
                ? 'brand-tab-active'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
            )}
          >
            <Globe className="h-4 w-4" />
            <span>{t('deliverables.tabApps')}</span>
            <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs">
              {filteredApps.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('artifacts')}
            className={cn(
              'flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer',
              activeTab === 'artifacts'
                ? 'brand-tab-active'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
            )}
          >
            <FileCode2 className="h-4 w-4" />
            <span>{t('deliverables.tabArtifacts')}</span>
            <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs">
              {filteredArtifacts.length}
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[210px] flex-1 sm:flex-initial">
            <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              className="pl-9 h-9 text-xs"
              placeholder={t('deliverables.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {allTeams.length > 0 && (
            <Select
              className="h-9 text-xs w-auto min-w-[140px]"
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
            >
              <option value="all">{t('deliverables.filterAllTeams')}</option>
              {allTeams.map((tm) => (
                <option key={tm} value={tm}>
                  {tm}
                </option>
              ))}
            </Select>
          )}
          {activeTab === 'apps' && (
            <Select
              className="h-9 text-xs w-auto min-w-[140px]"
              value={visFilter}
              onChange={(e) => setVisFilter(e.target.value)}
            >
              <option value="all">{t('deliverables.filterAllVis')}</option>
              <option value="public">{t('deliverables.visPublic')}</option>
              <option value="authenticated">{t('deliverables.visOrg')}</option>
              <option value="team">{t('deliverables.visTeam')}</option>
            </Select>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">{t('portal.loadingList')}</div>
      ) : activeTab === 'apps' ? (
        filteredApps.length === 0 ? (
          <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
            <CardContent className="py-16 text-center text-sm text-zinc-400 max-w-lg mx-auto leading-relaxed">
              {t('deliverables.emptyApps')}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-5">
            {filteredApps.map((app) => {
              const sbx = sandboxes.find((s) => s.id === app.sandbox_id) || null
              return (
                <Card
                  key={`${app.sandbox_id}:${app.name}`}
                  className="border-zinc-800 flex flex-col justify-between"
                >
                  <CardContent className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'h-2.5 w-2.5 rounded-full shrink-0',
                                app.online ? 'bg-emerald-400' : 'bg-amber-400',
                              )}
                            />
                            <h3 className="font-semibold text-base text-zinc-100 truncate">
                              {app.name}
                            </h3>
                          </div>
                          <div className="mt-1 font-mono text-xs text-zinc-500 truncate">
                            {app.mount_path || app.url}
                          </div>
                        </div>
                        {renderVisibilityBadge(app.preview_auth_mode)}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <Badge variant="outline" className="font-mono">
                          @{app.sandbox_slug}
                        </Badge>
                        {app.role_title && (
                          <Badge variant="secondary">
                            <Briefcase className="h-3 w-3 mr-0.5" />
                            {app.role_title}
                          </Badge>
                        )}
                        {app.project_team_name && (
                          <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                            {app.project_team_name}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="pt-3.5 border-t border-zinc-800/70 flex items-center gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => window.open(app.url, '_blank')}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t('deliverables.openAppBtn')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void copyTextToClipboard(app.url).then((ok) =>
                            notify(
                              ok ? t('common.copied') : t('common.copyFailed'),
                              ok ? 'success' : 'error',
                            ),
                          )
                        }
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      {sbx && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setInspectTarget(sbx)}
                        >
                          <Activity className="h-3.5 w-3.5 text-indigo-400" />
                          {t('deliverables.inspectBtn')}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )
      ) : filteredArtifacts.length === 0 ? (
        <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
          <CardContent className="py-16 text-center text-sm text-zinc-400 max-w-lg mx-auto leading-relaxed">
            {t('deliverables.emptyArtifacts')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-zinc-800/70">
            {filteredArtifacts.map((art) => {
              const isLink = art.kind === 'url' || art.kind === 'pr'
              return (
                <div
                  key={art.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0 space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {renderArtifactKind(art.kind)}
                      {isLink ? (
                        <a
                          href={art.value}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-sky-300 hover:underline truncate"
                        >
                          {art.value}
                        </a>
                      ) : (
                        <code className="font-mono text-xs text-zinc-200 break-all">
                          {art.value}
                        </code>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      <span className="text-zinc-200 font-medium">{art.task_title}</span>
                      <span className="font-mono">· @{art.sandbox_slug}</span>
                      {art.role_title && <span>· {art.role_title}</span>}
                      {art.project_team_name && (
                        <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                          {art.project_team_name}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isLink && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(art.value, '_blank')}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t('deliverables.openAppBtn')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void copyTextToClipboard(art.value).then((ok) =>
                          notify(
                            ok ? t('common.copied') : t('common.copyFailed'),
                            ok ? 'success' : 'error',
                          ),
                        )
                      }
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t('deliverables.copyLinkBtn')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <WorkforceInspectorDialog
        sandbox={inspectTarget}
        isAdmin={auth.admin}
        onClose={() => setInspectTarget(null)}
        notify={notify}
        onSandboxUpdated={() => loadDeliverables({ refresh: true })}
      />
    </div>
  )
}
