import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardList, Download, RefreshCw, Search } from 'lucide-react'
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
import type { AuditLogPageData } from '../../types'

const PAGE_SIZE = 30

export function AuditCenterTab({
  notify,
}: {
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  const [page, setPage] = useState<AuditLogPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('all')
  const [action, setAction] = useState('all')
  const [offset, setOffset] = useState(0)

  const buildParams = useCallback(
    (includePaging = true) => {
      const p = new URLSearchParams()
      if (q.trim()) p.set('q', q.trim())
      if (category !== 'all') p.set('category', category)
      if (action !== 'all') p.set('action', action)
      if (includePaging) {
        p.set('limit', String(PAGE_SIZE))
        p.set('offset', String(offset))
      }
      return p
    },
    [q, category, action, offset],
  )

  const loadAudit = useCallback(async () => {
    setLoading(true)
    try {
      const params = buildParams(true)
      const res = await apiFetch<AuditLogPageData>(`/api/audit-logs?${params.toString()}`)
      setPage(res)
    } catch (err: any) {
      notify(err.message || tRef.current('admin.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [buildParams, notify])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAudit()
    }, 150)
    return () => window.clearTimeout(timer)
  }, [loadAudit])

  const triggerExport = (format: 'csv' | 'json') => {
    const params = buildParams(false)
    params.set('format', format)
    window.open(`/api/audit-logs/export?${params.toString()}`, '_blank')
  }

  const categoryLabel = (cat: string | null | undefined) => {
    switch (cat) {
      case 'approval':
        return t('audit.catApproval')
      case 'workforce':
        return t('audit.catWorkforce')
      case 'security':
        return t('audit.catSecurity')
      case 'notification':
        return t('audit.catNotification')
      case 'sandbox':
        return t('audit.catSandbox')
      default:
        return t('audit.catSystem')
    }
  }

  const categoryBadgeVariant = (cat: string | null | undefined) => {
    if (cat === 'approval') return 'warning' as const
    if (cat === 'security') return 'destructive' as const
    if (cat === 'workforce') return 'success' as const
    return 'outline' as const
  }

  const items = page?.items || []
  const total = page?.total ?? 0
  const hasPrev = offset > 0
  const hasNext = offset + PAGE_SIZE < total

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-indigo-400" />
              <span>{t('audit.title')}</span>
              <Badge variant="outline">{t('audit.totalCount', { total })}</Badge>
            </CardTitle>
            <p className="text-xs text-zinc-400 mt-1">{t('audit.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadAudit()}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              {t('common.refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => triggerExport('csv')}>
              <Download className="h-3.5 w-3.5" />
              {t('audit.exportCsvBtn')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => triggerExport('json')}>
              <Download className="h-3.5 w-3.5" />
              {t('audit.exportJsonBtn')}
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              className="pl-9 h-9 text-xs"
              placeholder={t('audit.searchPlaceholder')}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setOffset(0)
              }}
            />
          </div>
          <Select
            className="h-9 text-xs w-auto min-w-[140px] max-w-full sm:max-w-[280px]"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              setOffset(0)
            }}
          >
            <option value="all">{t('audit.catAll')}</option>
            <option value="approval">{t('audit.catApproval')}</option>
            <option value="workforce">{t('audit.catWorkforce')}</option>
            <option value="security">{t('audit.catSecurity')}</option>
            <option value="notification">{t('audit.catNotification')}</option>
            <option value="sandbox">{t('audit.catSandbox')}</option>
            <option value="system">{t('audit.catSystem')}</option>
          </Select>
          <Select
            className="h-9 text-xs w-auto min-w-[180px] max-w-full sm:max-w-[340px] font-mono"
            value={action}
            onChange={(e) => {
              setAction(e.target.value)
              setOffset(0)
            }}
          >
            <option value="all">{t('audit.colAction')}: *</option>
            {(page?.actions || []).map((act) => (
              <option key={act} value={act}>
                {act}
              </option>
            ))}
          </Select>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-y border-zinc-800/80 bg-zinc-950/50 text-zinc-400">
                <th className="py-3 px-4 font-medium whitespace-nowrap">{t('audit.colTime')}</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">{t('audit.colCategory')}</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">{t('audit.colAction')}</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">{t('audit.colActor')}</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">{t('audit.colTarget')}</th>
                <th className="py-3 px-4 font-medium">{t('audit.colDetail')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-14 text-center text-sm text-zinc-500">
                    {loading ? t('portal.loadingList') : t('audit.empty')}
                  </td>
                </tr>
              ) : (
                items.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-800/20">
                    <td className="py-3 px-4 font-mono text-zinc-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <Badge variant={categoryBadgeVariant(log.category)}>
                        {categoryLabel(log.category)}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 font-mono text-zinc-200 whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="py-3 px-4 text-zinc-300 whitespace-nowrap">
                      {log.actor || 'system'}
                    </td>
                    <td className="py-3 px-4 font-mono text-zinc-300 whitespace-nowrap">
                      {log.sandbox_slug ? `@${log.sandbox_slug}` : log.target || '—'}
                    </td>
                    <td className="py-3 px-4 text-zinc-400 max-w-md truncate" title={log.detail || ''}>
                      {log.detail || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800/70 text-xs text-zinc-400">
            <span>
              {offset + 1} - {Math.min(offset + PAGE_SIZE, total)} / {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrev}
                onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
              >
                {t('audit.prevPage')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setOffset((v) => v + PAGE_SIZE)}
              >
                {t('audit.nextPage')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
