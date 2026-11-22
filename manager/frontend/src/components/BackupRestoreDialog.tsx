import React, { useCallback, useEffect, useState } from 'react'
import { Download, Plus, RotateCw, Sparkles, Trash2, Upload } from 'lucide-react'
import { Badge, Button, Dialog, Input, Label, Select, cn } from './ui'
import { apiFetch, parseApiErrorDetail } from '../lib/client.ts'
import { formatDiskSize } from '../lib/format'
import { useI18n } from '../lib/i18nContext'
import type { SandboxItem, SnapshotItem } from '../types'

export function BackupRestoreDialog({
  sandbox,
  isAdmin,
  onClose,
  notify,
  onRestored,
}: {
  sandbox: SandboxItem | null
  isAdmin: boolean
  onClose: () => void
  notify: (msg: string, type?: 'success' | 'error') => void
  onRestored: () => Promise<void> | void
}) {
  const { t } = useI18n()
  const [excludeCaches, setExcludeCaches] = useState(true)
  const [restoreMode, setRestoreMode] = useState<'merge' | 'clean'>('merge')
  const [file, setFile] = useState<File | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([])
  const [loadingSnapshots, setLoadingSnapshots] = useState(false)
  const [snapName, setSnapName] = useState('')
  const [creatingSnap, setCreatingSnap] = useState(false)
  const [actingSnapId, setActingSnapId] = useState<string | null>(null)

  const apiBase = isAdmin ? '/api/sandboxes' : '/api/my/sandboxes'

  const loadSnapshots = useCallback(async () => {
    if (!sandbox) return
    setLoadingSnapshots(true)
    try {
      const items = await apiFetch<SnapshotItem[]>(`${apiBase}/${sandbox.id}/snapshots`)
      setSnapshots(items)
    } catch {
      setSnapshots([])
    } finally {
      setLoadingSnapshots(false)
    }
  }, [sandbox, apiBase])

  useEffect(() => {
    setFile(null)
    setRestoreMode('merge')
    setRestoring(false)
    setSnapName('')
    if (sandbox) {
      void loadSnapshots()
    } else {
      setSnapshots([])
    }
  }, [sandbox, loadSnapshots])

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sandbox || !snapName.trim()) return
    setCreatingSnap(true)
    try {
      const created = await apiFetch<SnapshotItem>(`${apiBase}/${sandbox.id}/snapshots`, {
        method: 'POST',
        body: JSON.stringify({
          name: snapName.trim(),
          exclude_caches: excludeCaches,
        }),
      })
      notify(t('dialog.backup.snapCreated', { name: created.name }))
      setSnapName('')
      await loadSnapshots()
    } catch (err: any) {
      notify(err.message || 'Snapshot failed', 'error')
    } finally {
      setCreatingSnap(false)
    }
  }

  const handleRestoreSnapshot = async (snap: SnapshotItem) => {
    if (!sandbox) return
    setActingSnapId(snap.id)
    try {
      await apiFetch(
        `${apiBase}/${sandbox.id}/snapshots/${snap.id}/restore?mode=${restoreMode}`,
        { method: 'POST' },
      )
      notify(t('dialog.backup.snapRestored', { name: snap.name }))
      await onRestored()
    } catch (err: any) {
      notify(err.message || 'Rollback failed', 'error')
    } finally {
      setActingSnapId(null)
    }
  }

  const handleDeleteSnapshot = async (snap: SnapshotItem) => {
    if (!sandbox) return
    setActingSnapId(snap.id)
    try {
      await apiFetch(`${apiBase}/${sandbox.id}/snapshots/${snap.id}`, {
        method: 'DELETE',
      })
      notify(t('dialog.backup.snapDeleted'))
      await loadSnapshots()
    } catch (err: any) {
      notify(err.message || 'Delete failed', 'error')
    } finally {
      setActingSnapId(null)
    }
  }

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sandbox || !file) {
      notify(t('dialog.backup.noFile'), 'error')
      return
    }
    setRestoring(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('mode', restoreMode)
      const endpoint = isAdmin
        ? `/api/sandboxes/${sandbox.id}/restore`
        : `/api/my/sandboxes/${sandbox.id}/restore`
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload, res.status))
      }
      notify(
        t('dialog.backup.restoreSuccess', {
          count: payload?.restored_entries ?? 0,
        }),
      )
      await onRestored()
      onClose()
    } catch (err: any) {
      notify(err.message || 'Restore failed', 'error')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Dialog
      open={!!sandbox}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.backup.title', { slug: sandbox?.slug ?? '' })}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4 text-xs">
        {/* Server-Side Snapshots Center */}
        <div className="rounded-xl border border-indigo-500/30 bg-zinc-950/70 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium text-zinc-100 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              <span>{t('dialog.backup.snapshotsTitle')}</span>
            </div>
            <Badge variant="outline">{snapshots.length}</Badge>
          </div>
          <form onSubmit={handleCreateSnapshot} className="flex flex-col sm:flex-row gap-2">
            <Input
              required
              placeholder={t('dialog.backup.snapNamePlaceholder')}
              value={snapName}
              onChange={(e) => setSnapName(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={creatingSnap || !snapName.trim()} className="shrink-0">
              <Plus className="h-3.5 w-3.5" />
              {creatingSnap ? t('common.saving') : t('dialog.backup.createSnapBtn')}
            </Button>
          </form>
          {loadingSnapshots ? (
            <div className="text-zinc-500 py-2">{t('dialog.logs.loading')}</div>
          ) : snapshots.length === 0 ? (
            <p className="text-zinc-500 leading-relaxed">{t('dialog.backup.snapshotsEmpty')}</p>
          ) : (
            <div className="max-h-44 overflow-y-auto divide-y divide-zinc-800/70 rounded-lg border border-zinc-800/80 bg-zinc-900/40">
              {snapshots.map((snap) => (
                <div
                  key={snap.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-100 truncate">{snap.name}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {formatDiskSize(snap.size_mb)}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {new Date(snap.created_at).toLocaleString()}
                      {snap.created_by ? ` · ${snap.created_by}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={actingSnapId === snap.id}
                      onClick={() => handleRestoreSnapshot(snap)}
                    >
                      <RotateCw className={cn('h-3 w-3', actingSnapId === snap.id && 'animate-spin')} />
                      {t('dialog.backup.restoreSnapBtn')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-rose-400 hover:text-rose-300"
                      disabled={actingSnapId === snap.id}
                      onClick={() => handleDeleteSnapshot(snap)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
          <div className="font-medium text-zinc-200">{t('dialog.backup.exportTitle')}</div>
          <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeCaches}
              onChange={(e) => setExcludeCaches(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
            />
            <span>{t('dialog.backup.excludeCachesLabel')}</span>
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (!sandbox) return
              window.open(
                `/api/sandboxes/${sandbox.id}/backup?exclude_caches=${excludeCaches ? 'true' : 'false'}`,
                '_blank',
              )
            }}
          >
            <Download className="h-3.5 w-3.5" />
            {t('dialog.backup.downloadBtn')}
          </Button>
        </div>

        <form
          onSubmit={handleRestore}
          className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3"
        >
          <div className="font-medium text-zinc-200">{t('dialog.backup.restoreTitle')}</div>
          <div className="space-y-1.5">
            <Label>{t('dialog.backup.fileLabel')}</Label>
            <Input
              type="file"
              accept=".tar,.tar.gz,.tgz,.tar.bz2,.tar.xz"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('dialog.backup.modeLabel')}</Label>
            <Select
              value={restoreMode}
              onChange={(e) => setRestoreMode(e.target.value as 'merge' | 'clean')}
            >
              <option value="merge">{t('dialog.backup.modeMerge')}</option>
              <option value="clean">{t('dialog.backup.modeClean')}</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={restoring || !file}>
              <Upload className="h-3.5 w-3.5" />
              {restoring ? t('dialog.backup.restoring') : t('dialog.backup.restoreBtn')}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  )
}
