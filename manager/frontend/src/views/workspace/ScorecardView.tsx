import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Award,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  cn,
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type { ScorecardData, TeamItem } from '../../types'

function formatUsd(v: number | null | undefined): string {
  if (v == null) return 'N/A'
  if (v >= 1) return `$${v.toFixed(2)}`
  if (v > 0) return `$${v.toFixed(4)}`
  return '$0.00'
}

export function ScorecardView({
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
  const [hourlyRate, setHourlyRate] = useState('45')
  const [teams, setTeams] = useState<TeamItem[]>([])
  const [data, setData] = useState<ScorecardData | null>(null)
  const [loading, setLoading] = useState(true)

  const effectiveTeamId = fixedTeamId ?? teamId
  const rateNum = Math.max(1, Number.parseFloat(hourlyRate) || 45)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        days: String(days),
        hourly_rate_usd: String(rateNum),
      })
      if (effectiveTeamId) qs.set('team_id', effectiveTeamId)
      const [scRes, teamRes] = await Promise.all([
        apiFetch<ScorecardData>(`/api/scorecard?${qs.toString()}`),
        fixedTeamId
          ? Promise.resolve({ items: [] as TeamItem[] })
          : apiFetch<{ items: TeamItem[] }>('/api/teams').catch(() => ({ items: [] as TeamItem[] })),
      ])
      setData(scRes)
      setTeams(teamRes.items || [])
    } catch (err: any) {
      notify(err.message || tRef.current('admin.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [days, effectiveTeamId, fixedTeamId, rateNum, notify])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const exportUrl = (fmt: 'csv' | 'markdown') => {
    const qs = new URLSearchParams({
      format: fmt,
      days: String(days),
      hourly_rate_usd: String(rateNum),
    })
    if (effectiveTeamId) qs.set('team_id', effectiveTeamId)
    return `/api/scorecard/export?${qs.toString()}`
  }

  const k = data?.kpis

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className={cn(
          'flex flex-col lg:flex-row lg:items-center justify-between gap-4',
          !compact && 'border-b border-zinc-800 pb-5',
        )}
      >
        {!compact ? (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
              {t('scorecard.title')}
            </h1>
            <p className="text-sm text-zinc-400 mt-1">{t('scorecard.subtitle')}</p>
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
              className="h-9 text-xs w-40"
            >
              <option value="">{t('finops.allTeams')}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </Select>
          )}
          <div className="flex items-center gap-1.5 rounded-[var(--brand-radius-sm)] border border-zinc-800 bg-zinc-950/70 px-2.5 h-9 text-xs text-zinc-400">
            <span>{t('scorecard.hourlyRateLabel')}</span>
            <Input
              type="number"
              min={1}
              max={1000}
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              className="h-6 w-16 px-1.5 text-xs font-mono border-zinc-700"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => window.open(exportUrl('csv'), '_blank')}>
            <Download className="h-3.5 w-3.5" />
            {t('scorecard.exportCsv')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(exportUrl('markdown'), '_blank')}
          >
            <FileText className="h-3.5 w-3.5" />
            {t('scorecard.exportMd')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void loadData()}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Executive KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="border-zinc-800">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-zinc-400">{t('scorecard.kpiCompletion')}</div>
              <div className="text-2xl font-semibold text-zinc-100 mt-1 font-mono">
                {k?.completion_rate_pct != null ? `${k.completion_rate_pct}%` : 'N/A'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                {k?.done_tasks || 0} / {k?.total_tasks || 0} tasks
              </div>
            </div>
            <CheckCircle2 className="h-7 w-7 text-emerald-400/80" />
          </CardContent>
        </Card>

        <Card className="border-zinc-800">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-zinc-400">{t('scorecard.kpiFirstPass')}</div>
              <div className="text-2xl font-semibold text-indigo-300 mt-1 font-mono">
                {k?.first_pass_approval_rate_pct != null
                  ? `${k.first_pass_approval_rate_pct}%`
                  : 'N/A'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                {k?.approvals_approved || 0} ok · {k?.approvals_rejected || 0} rejected
              </div>
            </div>
            <ShieldCheck className="h-7 w-7 text-indigo-400/80" />
          </CardContent>
        </Card>

        <Card className="border-zinc-800">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-zinc-400">{t('scorecard.kpiSaved')}</div>
              <div className="text-2xl font-semibold text-sky-300 mt-1 font-mono">
                {k?.estimated_hours_saved ?? 0}h
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                ≈ {formatUsd(k?.estimated_value_usd)} value
              </div>
            </div>
            <Clock className="h-7 w-7 text-sky-400/80" />
          </CardContent>
        </Card>

        <Card className="border-zinc-800">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-zinc-400">{t('scorecard.kpiRoi')}</div>
              <div className="text-2xl font-semibold text-emerald-300 mt-1 font-mono">
                {k?.roi_multiple != null ? `${k.roi_multiple}x` : 'N/A'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                LLM Cost: {formatUsd(k?.total_cost_usd)}
              </div>
            </div>
            <TrendingUp className="h-7 w-7 text-emerald-400/80" />
          </CardContent>
        </Card>
      </div>

      {/* Operational Health Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-900/50 p-3.5">
          <div className="text-zinc-500">{t('scorecard.metaCycle')}</div>
          <div className="text-base font-semibold font-mono text-zinc-100 mt-1">
            {k?.avg_cycle_hours != null ? `${k.avg_cycle_hours}h` : 'N/A'}
          </div>
        </div>
        <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-900/50 p-3.5">
          <div className="text-zinc-500">{t('scorecard.metaBlocked')}</div>
          <div className="text-base font-semibold font-mono text-amber-300 mt-1">
            {k?.blocked_rate_pct != null ? `${k.blocked_rate_pct}%` : '0%'} ({k?.blocked_tasks || 0})
          </div>
        </div>
        <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-900/50 p-3.5">
          <div className="text-zinc-500">{t('scorecard.metaPlaybooks')}</div>
          <div className="text-base font-semibold font-mono text-indigo-300 mt-1">
            {k?.playbook_runs_completed || 0} / {k?.playbook_runs_total || 0}
          </div>
        </div>
        <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-900/50 p-3.5">
          <div className="text-zinc-500">{t('scorecard.metaCostPerTask')}</div>
          <div className="text-base font-semibold font-mono text-emerald-300 mt-1">
            {formatUsd(k?.cost_per_task_usd)}
          </div>
        </div>
      </div>

      {/* Employee Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Award className="h-4 w-4 text-indigo-400" />
            <span>{t('scorecard.empTableTitle')}</span>
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
                    <th className="pb-2.5 font-medium">{t('scorecard.colDoneTotal')}</th>
                    <th className="pb-2.5 font-medium">{t('scorecard.colBlocked')}</th>
                    <th className="pb-2.5 font-medium">{t('scorecard.colCost')}</th>
                    <th className="pb-2.5 font-medium">{t('scorecard.colCostPerTask')}</th>
                    <th className="pb-2.5 font-medium">{t('scorecard.colSaved')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {data.by_sandbox.map((row) => (
                    <tr key={row.sandbox_id} className="hover:bg-zinc-900/40">
                      <td className="py-3 pr-3">
                        <div className="font-mono font-medium text-zinc-100">
                          @{row.slug}{' '}
                          <span className="font-sans text-zinc-400 font-normal">
                            ({row.display_name})
                          </span>
                        </div>
                        {row.role_title && (
                          <div className="text-[11px] text-zinc-500">{row.role_title}</div>
                        )}
                      </td>
                      <td className="py-3 pr-3 font-mono text-zinc-200">
                        {row.done_tasks}/{row.total_tasks}
                        {row.completion_rate_pct != null ? ` (${row.completion_rate_pct}%)` : ''}
                      </td>
                      <td className="py-3 pr-3 font-mono text-amber-300">{row.blocked_tasks}</td>
                      <td className="py-3 pr-3 font-mono text-emerald-300">
                        {formatUsd(row.cost_usd)}
                      </td>
                      <td className="py-3 pr-3 font-mono text-zinc-300">
                        {formatUsd(row.cost_per_task_usd)}
                      </td>
                      <td className="py-3 font-mono text-sky-300">{row.estimated_hours_saved}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Team / Dept ROI */}
      {data && data.by_team.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('scorecard.teamTableTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-zinc-800/60 text-xs">
              {data.by_team.map((tm) => (
                <div key={tm.team_id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-100">{tm.team_name}</span>
                    {tm.department && <Badge variant="outline">{tm.department}</Badge>}
                    <Badge variant="secondary">{tm.employees_count} FTEs</Badge>
                  </div>
                  <div className="flex items-center gap-4 font-mono">
                    <span className="text-zinc-300">
                      {tm.done_tasks}/{tm.total_tasks} tasks
                    </span>
                    <span className="text-emerald-300">{formatUsd(tm.cost_usd)}</span>
                    <span className="text-sky-300">{tm.estimated_hours_saved}h saved</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
