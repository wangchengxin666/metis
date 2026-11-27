import { useState } from 'react'
import { Coins, TrendingUp } from 'lucide-react'
import { cn } from '../../components/ui'
import { useI18n } from '../../lib/i18nContext'
import { FinOpsView } from './FinOpsView'
import { ScorecardView } from './ScorecardView'

/** Unified Executive Analytics hub combining FinOps LLM Billing & Workforce ROI Scorecard. */
export function AnalyticsView({
  notify,
}: {
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'finops' | 'scorecard'>('finops')

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
          {t('analytics.title')}
        </h1>
        <div className="inline-flex items-center gap-1 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 p-1 self-start">
          <button
            type="button"
            onClick={() => setTab('finops')}
            className={cn(
              'inline-flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer',
              tab === 'finops'
                ? 'brand-tab-active'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
            )}
          >
            <Coins className="h-4 w-4" />
            <span>{t('analytics.tabFinops')}</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('scorecard')}
            className={cn(
              'inline-flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer',
              tab === 'scorecard'
                ? 'brand-tab-active'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
            )}
          >
            <TrendingUp className="h-4 w-4" />
            <span>{t('analytics.tabScorecard')}</span>
          </button>
        </div>
      </div>

      {tab === 'finops' ? (
        <FinOpsView notify={notify} compact />
      ) : (
        <ScorecardView notify={notify} compact />
      )}
    </div>
  )
}
