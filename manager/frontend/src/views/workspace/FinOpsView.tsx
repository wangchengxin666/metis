import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  Coins,
  DollarSign,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  cn,
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type { FinOpsSummaryData, TeamItem } from '../../types'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatUsd(amount: number): string {
  if (amount >= 1) return `$${amount.toFixed(2)}`
  if (amount > 0) return `$${amount.toFixed(4)}`
  return '$0.00'
}

export function FinOpsView({
  notify,
  fixedTeamId,
  compact = false,
}: {
  notify: (msg: string, type?: 'success' | 'error') => void
  fixedTeamId?: string
  compact?: boolean
}) {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  const [days, setDays] = useState(30)
  const [teamId, setTeamId] = useState(fixedTeamId || '')
  const [teams, setTeams] = useState<TeamItem[]>([])
  const [data, setData] = useState<FinOpsSummaryData | null>(null)
  const [loading, setLoading] = useState(true)

  const effectiveTeamId = fixedTeamId ?? teamId

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ days: String(days) })
      if (effectiveTeamId) qs.set('team_id', effectiveTeamId)
      const [finRes, teamRes] = await Promise.all([
        apiFetch<FinOpsSummaryData>(`/api/finops/summary?${qs.toString()}`),
        fixedTeamId
          ? Promise.resolve({ items: [] as TeamItem[] })
          : apiFetch<{ items: TeamItem[] }>('/api/teams').catch(() => ({ items: [] as TeamItem[] })),
      ])
      setData(finRes)
      setTeams(teamRes.items || [])
    } catch (err: any) {
      notify(err.message || tRef.current('admin.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [days, effectiveTeamId, fixedTeamId, notify])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const maxDailyTokens = Math.max(
    1,
    ...(data?.daily_series || []).map((d) => d.tokens),
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className={cn(
          'flex flex-col sm:flex-row sm:items-center justify-between gap-4',
          !compact && 'border-b border-zinc-800 pb-5',
        )}
      >
        {!compact ? (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">{t('finops.title')}</h1>
            <p className="text-sm text-zinc-400 mt-1">{t('finops.subtitle')}</p>
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-9 text-xs w-28"
          >
            <option value="7">{t('finops.days7')}</option>
            <option value="30">{t('finops.days30')}</option>
            <option value="90">{t('finops.days90')}</option>
          </Select>
          {!fixedTeamId && teams.length > 0 && (
            <Select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="h-9 text-xs w-44"
            >
              <option value="">{t('finops.allTeams')}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => void loadData()}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="border-zinc-800">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-zinc-400">{t('finops.kpiTodayTokens')}</div>
              <div className="text-2xl font-semibold text-zinc-100 mt-1 font-mono">
                {formatTokens(data?.today.tokens || 0)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {data?.today.requests || 0} reqs
              </div>
            </div>
            <Coins className="h-7 w-7 text-indigo-400/80" />
          </CardContent>
        </Card>
        <Card className="border-zinc-800">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-zinc-400">{t('finops.kpiTodayCost')}</div>
              <div className="text-2xl font-semibold text-emerald-300 mt-1 font-mono">
                {formatUsd(data?.today.cost || 0)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">USD (UTC day)</div>
            </div>
            <DollarSign className="h-7 w-7 text-emerald-400/80" />
          </CardContent>
        </Card>
        <Card className="border-zinc-800">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-zinc-400">{t('finops.kpiPeriodCost')}</div>
              <div className="text-2xl font-semibold text-zinc-100 mt-1 font-mono">
                {formatUsd(data?.period.cost || 0)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                {formatTokens(data?.period.tokens || 0)} tokens · {data?.period.requests || 0} reqs
              </div>
            </div>
            <Activity className="h-7 w-7 text-sky-400/80" />
          </CardContent>
        </Card>
        <Card className="border-zinc-800">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-zinc-400">{t('finops.kpiFallback')}</div>
              <div className="text-2xl font-semibold text-amber-300 mt-1 font-mono">
                {data?.period.fallback_requests || 0}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">auto-downgrade routes</div>
            </div>
            <TrendingDown className="h-7 w-7 text-amber-400/80" />
          </CardContent>
        </Card>
      </div>

      {/* Daily Trend Bar Strip */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-indigo-400" />
            <span>{t('finops.trendTitle')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.daily_series.length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center">{t('finops.trendEmpty')}</p>
          ) : (
            <div className="flex items-end gap-1.5 h-36 pt-4 overflow-x-auto">
              {data.daily_series.map((pt) => {
                const hPct = Math.max(8, Math.round((pt.tokens / maxDailyTokens) * 100))
                return (
                  <div
                    key={pt.date}
                    className="flex-1 min-w-[26px] max-w-[52px] flex flex-col items-center gap-1.5 group"
                    title={`${pt.date}: ${pt.tokens.toLocaleString()} tokens · ${formatUsd(pt.cost)} (${pt.requests} reqs)`}
                  >
                    <div className="w-full h-24 flex items-end">
                      <div
                        className="w-full rounded-t bg-indigo-500/75 group-hover:bg-indigo-400 transition-all"
                        style={{ height: `${hPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500 truncate">
                      {pt.date.slice(5)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* By Sandbox Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-indigo-400" />
            <span>{t('finops.bySandboxTitle')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.by_sandbox.length === 0 ? (
            <p className="text-sm text-zinc-500 py-6 text-center">{t('finops.noData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="pb-2.5 font-medium">{t('finops.colEmployee')}</th>
                    <th className="pb-2.5 font-medium">{t('finops.colToday')}</th>
                    <th className="pb-2.5 font-medium">{t('finops.colPeriod')}</th>
                    <th className="pb-2.5 font-medium">{t('finops.colCost')}</th>
                    <th className="pb-2.5 font-medium">{t('finops.colPolicy')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {data.by_sandbox.map((row) => {
                    const pct = row.budget_percent ?? 0
                    const barColor =
                      pct >= 100
                        ? 'bg-rose-500'
                        : pct >= 80
                          ? 'bg-amber-400'
                          : 'bg-emerald-500'
                    return (
                      <tr key={row.sandbox_id} className="hover:bg-zinc-900/40">
                        <td className="py-3 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium text-zinc-100">@{row.slug}</span>
                            <Badge
                              variant="outline"
                              className={
                                row.ownership_mode === 'shared'
                                  ? 'border-sky-500/40 text-sky-300 text-[10px]'
                                  : 'text-[10px]'
                              }
                            >
                              {row.ownership_mode === 'shared'
                                ? t('sandbox.badgeShared')
                                : t('sandbox.badgePersonal')}
                            </Badge>
                          </div>
                          {row.role_title && (
                            <div className="text-[11px] text-zinc-500 mt-0.5">{row.role_title}</div>
                          )}
                        </td>
                        <td className="py-3 pr-3 min-w-[180px]">
                          <div className="font-mono text-zinc-200">
                            {formatTokens(row.today_tokens)}
                            {row.daily_limit ? ` / ${formatTokens(row.daily_limit)}` : ''}
                            {row.budget_percent != null ? ` (${row.budget_percent}%)` : ''}
                          </div>
                          {row.daily_limit ? (
                            <div className="mt-1.5 h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                              <div
                                className={cn('h-full rounded-full', barColor)}
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                          ) : null}
                        </td>
                        <td className="py-3 pr-3 font-mono text-zinc-300">
                          {formatTokens(row.period_tokens)} ({row.requests})
                        </td>
                        <td className="py-3 pr-3 font-mono text-emerald-300">
                          {formatUsd(row.period_cost)}
                        </td>
                        <td className="py-3">
                          <Badge
                            variant={
                              row.budget_action === 'block'
                                ? 'destructive'
                                : row.budget_action === 'downgrade'
                                  ? 'warning'
                                  : 'secondary'
                            }
                          >
                            {row.budget_action}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom Breakdown: By Team & By Model */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('finops.byTeamTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!data || data.by_team.length === 0 ? (
              <p className="text-sm text-zinc-500 py-5 text-center">{t('finops.noData')}</p>
            ) : (
              <div className="divide-y divide-zinc-800/60 text-xs">
                {data.by_team.map((tm) => (
                  <div key={tm.team_id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-zinc-100">{tm.team_name}</div>
                      {tm.department && <div className="text-zinc-500">{tm.department}</div>}
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-emerald-300">{formatUsd(tm.period_cost)}</div>
                      <div className="text-zinc-400">
                        {formatTokens(tm.period_tokens)} tokens
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('finops.byModelTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!data || data.by_model.length === 0 ? (
              <p className="text-sm text-zinc-500 py-5 text-center">{t('finops.noData')}</p>
            ) : (
              <div className="divide-y divide-zinc-800/60 text-xs">
                {data.by_model.map((m) => (
                  <div
                    key={`${m.model}-${m.api_protocol}`}
                    className="py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-medium text-zinc-100 truncate">{m.model}</div>
                      <div className="text-zinc-500">{m.api_protocol}</div>
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <div className="text-emerald-300">{formatUsd(m.cost)}</div>
                      <div className="text-zinc-400">
                        {formatTokens(m.tokens)} · {m.requests} reqs
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
