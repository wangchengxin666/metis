import React from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { Button, Dialog, Input, Label, cn } from '../../components/ui'
import { useI18n } from '../../lib/i18nContext'
import type { SandboxItem } from '../../types'

export interface CloneFormState {
  email: string
  display_name: string
  slug: string
  copy_workspace: boolean
}

export function CloneEmployeeDialog({
  target: cloneTarget,
  onClose,
  form: cloneForm,
  setForm: setCloneForm,
  submitting: cloningSbx,
  onSubmit: handleCloneSandbox,
}: {
  target: SandboxItem | null
  onClose: () => void
  form: CloneFormState
  setForm: React.Dispatch<React.SetStateAction<CloneFormState>>
  submitting: boolean
  onSubmit: (e: React.FormEvent) => void
}) {
  const { t } = useI18n()
  const setCloneTarget = (_v: null) => onClose()
  return (
      <Dialog
        open={!!cloneTarget}
        onOpenChange={(o) => !o && !cloningSbx && setCloneTarget(null)}
        title={t('dialog.clone.title', { slug: cloneTarget?.slug ?? '' })}
        description={t('dialog.clone.desc')}
      >
        <form onSubmit={handleCloneSandbox} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <Label>{t('dialog.clone.emailLabel')}</Label>
            <Input
              type="email"
              list="existing-users-list"
              value={cloneForm.email}
              onChange={(e) => setCloneForm({ ...cloneForm, email: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('dialog.clone.slugLabel')}</Label>
            <Input
              placeholder={t('dialog.clone.slugPlaceholder')}
              value={cloneForm.slug}
              onChange={(e) => setCloneForm({ ...cloneForm, slug: e.target.value })}
            />
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-zinc-200 cursor-pointer">
            <input
              type="checkbox"
              checked={cloneForm.copy_workspace}
              onChange={(e) => setCloneForm({ ...cloneForm, copy_workspace: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-zinc-600 accent-indigo-500"
            />
            <span>{t('dialog.clone.copyWorkspaceLabel')}</span>
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
            <Button
              type="button"
              variant="ghost"
              disabled={cloningSbx}
              onClick={() => setCloneTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={cloningSbx}>
              <Copy className="h-3.5 w-3.5" />
              {cloningSbx ? t('dialog.clone.submitting') : t('dialog.clone.submit')}
            </Button>
          </div>
        </form>
      </Dialog>

  )
}

export function ContainerLogsDialog({
  target: logsTarget,
  onClose,
  logsText,
  loading: loadingLogs,
  onRefresh: openLogsModal,
  onCopy: copyText,
}: {
  target: SandboxItem | null
  onClose: () => void
  logsText: string
  loading: boolean
  onRefresh: (sbx: SandboxItem) => void
  onCopy: (key: string, text: string) => void
}) {
  const { t } = useI18n()
  const setLogsTarget = (_v: null) => onClose()
  return (
      <Dialog
        open={!!logsTarget}
        onOpenChange={(o) => !o && setLogsTarget(null)}
        title={t('dialog.logs.title', { slug: logsTarget?.slug ?? '' })}
        maxWidth="max-w-4xl"
      >
        <div className="space-y-3">
          <div className="flex justify-end items-center">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => logsTarget && openLogsModal(logsTarget)}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loadingLogs && 'animate-spin')} />
                {t('dialog.logs.refresh')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyText('logs', logsText)}
              >
                <Copy className="h-3.5 w-3.5" />
                {t('dialog.logs.copy')}
              </Button>
            </div>
          </div>
          <pre className="h-96 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-[11px] text-zinc-300 leading-relaxed">
            {loadingLogs ? t('dialog.logs.loading') : logsText}
          </pre>
        </div>
      </Dialog>

  )
}

export function DestroySandboxDialog({
  target: deleteSbxTarget,
  onClose,
  purgeVolume,
  setPurgeVolume,
  onConfirm: handleConfirmDeleteSandbox,
}: {
  target: SandboxItem | null
  onClose: () => void
  purgeVolume: boolean
  setPurgeVolume: (v: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const setDeleteSbxTarget = (_v: null) => onClose()
  return (
      <Dialog
        open={!!deleteSbxTarget}
        onOpenChange={(o) => !o && setDeleteSbxTarget(null)}
        title={t('dialog.destroy.title', { slug: deleteSbxTarget?.slug ?? '' })}
        description={t('dialog.destroy.owner', { email: deleteSbxTarget?.email ?? '' })}
      >
        <div className="space-y-4 text-xs">
          <label className="flex items-center gap-2.5 rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 text-rose-200 cursor-pointer">
            <input
              type="checkbox"
              checked={purgeVolume}
              onChange={(e) => setPurgeVolume(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700"
            />
            <span>
              {t('dialog.destroy.purgeBefore')}
              <code>{deleteSbxTarget?.volume_name}</code>
              {t('dialog.destroy.purgeAfter')}
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDeleteSbxTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteSandbox}>
              {t('dialog.destroy.confirm')}
            </Button>
          </div>
        </div>
      </Dialog>

  )
}
