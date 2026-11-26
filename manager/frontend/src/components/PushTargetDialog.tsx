import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Search, Send, Trash2, XCircle } from 'lucide-react'
import { Badge, Button, Dialog, Input, cn } from './ui'
import { useI18n } from '../lib/i18nContext'
import type { SandboxItem } from '../types'

export interface PushTargetSpec {
  sandbox_ids?: string[]
  action: 'push' | 'remove'
}

export interface PushExecutionResult {
  synced: number
  skipped?: number
  failed?: number
  total?: number
  results?: Array<{
    slug: string
    ok: boolean
    skipped?: boolean
    detail?: string
  }>
}

export function PushTargetDialog({
  open,
  onOpenChange,
  title,
  description,
  sandboxes,
  alreadyPushedIds = [],
  allowRemove = false,
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  sandboxes: SandboxItem[]
  alreadyPushedIds?: string[]
  allowRemove?: boolean
  confirmLabel?: string
  onConfirm: (spec: PushTargetSpec) => Promise<PushExecutionResult | void>
}) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'sandboxes' | 'all'>('sandboxes')
  const [action, setAction] = useState<'push' | 'remove'>('push')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<PushExecutionResult | null>(null)

  const runningSandboxes = useMemo(
    () => sandboxes.filter((s) => s.status === 'running'),
    [sandboxes],
  )
  const pushedSet = useMemo(() => new Set(alreadyPushedIds), [alreadyPushedIds])
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return
    wasOpenRef.current = true
    setMode('sandboxes')
    setAction('push')
    setSearch('')
    setErrorMsg(null)
    setLastResult(null)
    const preSelected = runningSandboxes
      .filter((s) => pushedSet.has(s.id))
      .map((s) => s.id)
    setSelectedIds(preSelected)
  }, [open, runningSandboxes, pushedSet])

  const filteredSandboxes = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sandboxes
    return sandboxes.filter((s) =>
      [s.slug, s.display_name, s.email, s.role_title, s.template]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [sandboxes, search])

  const handleConfirm = async () => {
    setErrorMsg(null)
    const spec: PushTargetSpec = { action }
    if (mode === 'sandboxes') {
      if (selectedIds.length === 0) {
        setErrorMsg(t('cap.push.selectRequired'))
        return
      }
      spec.sandbox_ids = selectedIds
    }

    setSubmitting(true)
    try {
      const res = await onConfirm(spec)
      if (res && Array.isArray(res.results) && res.results.length > 0) {
        setLastResult(res)
      } else {
        onOpenChange(false)
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Push failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next)
      }}
      title={title}
      description={description}
      maxWidth="max-w-xl"
    >
      <div className="space-y-4 text-sm">
        {allowRemove && (
          <div className="flex items-center gap-2 rounded-[var(--brand-radius-sm)] border border-zinc-800 bg-zinc-950/60 p-1 w-fit">
            <button
              type="button"
              onClick={() => setAction('push')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium cursor-pointer transition-colors',
                action === 'push'
                  ? 'brand-tab-active'
                  : 'text-zinc-400 hover:text-zinc-100',
              )}
            >
              <Send className="h-3 w-3" />
              {t('cap.push.actionPush')}
            </button>
            <button
              type="button"
              onClick={() => setAction('remove')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium cursor-pointer transition-colors',
                action === 'remove'
                  ? 'bg-rose-500/20 text-rose-200 border border-rose-500/40'
                  : 'text-zinc-400 hover:text-zinc-100',
              )}
            >
              <Trash2 className="h-3 w-3" />
              {t('cap.push.actionRemove')}
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'sandboxes', label: t('admin.vault.pushModeSandboxes') },
              { id: 'all', label: t('admin.vault.pushModeAll') },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id)
                setErrorMsg(null)
              }}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium border cursor-pointer transition-colors',
                mode === m.id
                  ? 'brand-tab-active border-transparent'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-100',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'sandboxes' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-44">
                <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('cap.push.searchPlaceholder')}
                  className="pl-8 h-8 text-xs"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedIds(runningSandboxes.map((s) => s.id))}
              >
                {t('cap.push.selectAllRunning', { count: runningSandboxes.length })}
              </Button>
              {alreadyPushedIds.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelectedIds(
                      runningSandboxes.filter((s) => pushedSet.has(s.id)).map((s) => s.id),
                    )
                  }
                >
                  {t('cap.push.selectBound')}
                </Button>
              )}
              {selectedIds.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds([])}
                >
                  {t('cap.push.clearSelection')}
                </Button>
              )}
            </div>

            <div className="max-h-60 overflow-y-auto divide-y divide-zinc-800/70 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60">
              {filteredSandboxes.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-xs text-zinc-500">
                  {t('cap.push.noMatchingEmployees')}
                </p>
              ) : (
                filteredSandboxes.map((sbx) => {
                  const isRunning = sbx.status === 'running'
                  const checked = selectedIds.includes(sbx.id)
                  const isBound = pushedSet.has(sbx.id)
                  return (
                    <label
                      key={sbx.id}
                      className={cn(
                        'flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs',
                        isRunning
                          ? 'cursor-pointer hover:bg-zinc-900/60'
                          : 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          disabled={!isRunning}
                          checked={checked}
                          onChange={(e) =>
                            setSelectedIds((prev) =>
                              e.target.checked
                                ? [...prev, sbx.id]
                                : prev.filter((id) => id !== sbx.id),
                            )
                          }
                          className="rounded border-zinc-600 accent-indigo-500 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-medium text-zinc-100">
                              @{sbx.slug}
                            </span>
                            {sbx.display_name && (
                              <span className="text-zinc-200 truncate">{sbx.display_name}</span>
                            )}
                            {isBound && (
                              <Badge
                                variant="outline"
                                className="border-indigo-500/40 text-indigo-300 text-[10px]"
                              >
                                {t('cap.push.alreadyPushedBadge')}
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate">
                            {[sbx.role_title, sbx.email].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                      <Badge variant={isRunning ? 'success' : 'secondary'}>{sbx.status}</Badge>
                    </label>
                  )
                })
              )}
            </div>
            <div className="text-xs text-zinc-400">
              {t('cap.push.selectedCount', { count: selectedIds.length })}
            </div>
          </div>
        )}

        {mode === 'all' && (
          <div className="rounded-[var(--brand-radius-md)] border border-amber-500/35 bg-amber-950/20 p-3.5 text-xs text-amber-200 leading-relaxed">
            {t('cap.push.allWarning', { count: runningSandboxes.length })}
          </div>
        )}

        {errorMsg && (
          <div className="rounded-md border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            {errorMsg}
          </div>
        )}

        {lastResult && lastResult.results && (
          <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/80 p-3 space-y-1.5 text-xs max-h-40 overflow-y-auto">
            <div className="font-medium text-zinc-200">
              {t('cap.push.resultSummary', {
                synced: lastResult.synced,
                total: lastResult.total ?? lastResult.results.length,
              })}
            </div>
            {lastResult.results.map((r) => (
              <div key={r.slug} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5 font-mono text-zinc-300">
                  {r.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                  )}
                  @{r.slug}
                </span>
                <span className="text-zinc-500 truncate max-w-64">{r.detail || (r.ok ? 'OK' : 'failed')}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {lastResult ? t('common.close') : t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant={action === 'remove' ? 'destructive' : 'default'}
            disabled={submitting}
            onClick={() => void handleConfirm()}
          >
            {action === 'remove' ? (
              <Trash2 className="h-3.5 w-3.5" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {submitting
              ? t('common.saving')
              : action === 'remove'
                ? t('cap.push.confirmRemoveBtn')
                : confirmLabel || t('admin.vault.pushConfirmBtn')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
