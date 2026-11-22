import React from 'react'
import { Copy, RefreshCw, Users } from 'lucide-react'
import { Badge, Button, Dialog, Input, Label, Select, cn } from '../../components/ui'
import { localizeStatus } from '../../lib/i18n.ts'
import { useI18n } from '../../lib/i18nContext'
import type { SandboxItem } from '../../types'

export interface TeamFormState {
  name: string
  description: string
  member_ids: string[]
  moderator_id: string
}

export interface CloneFormState {
  email: string
  display_name: string
  slug: string
  copy_workspace: boolean
}

export function AssembleTeamDialog({
  open: teamModalOpen,
  onOpenChange: setTeamModalOpen,
  form: teamForm,
  setForm: setTeamForm,
  submitting: assemblingTeam,
  onSubmit: handleAssembleTeam,
  sandboxes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: TeamFormState
  setForm: React.Dispatch<React.SetStateAction<TeamFormState>>
  submitting: boolean
  onSubmit: (e: React.FormEvent) => void
  sandboxes: SandboxItem[]
}) {
  const { locale, t } = useI18n()
  return (
      <Dialog
        open={teamModalOpen}
        onOpenChange={(o) => !o && !assemblingTeam && setTeamModalOpen(false)}
        title={t('dialog.team.title')}
        description={t('dialog.team.desc')}
      >
        <form onSubmit={handleAssembleTeam} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <Label>{t('dialog.team.nameLabel')}</Label>
            <Input
              required
              placeholder={t('dialog.team.namePlaceholder')}
              value={teamForm.name}
              onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('dialog.team.descLabel')}</Label>
            <Input
              placeholder={t('dialog.team.descPlaceholder')}
              value={teamForm.description}
              onChange={(e) => setTeamForm({ ...teamForm, description: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('dialog.team.membersLabel')}</Label>
            <div className="max-h-52 overflow-y-auto divide-y divide-zinc-800/70 rounded-lg border border-zinc-800 bg-zinc-950/60">
              {sandboxes.map((sbx) => {
                const isRunning = sbx.status === 'running'
                const checked = teamForm.member_ids.includes(sbx.id)
                return (
                  <label
                    key={sbx.id}
                    className={cn(
                      'flex items-center justify-between gap-3 px-3 py-2',
                      isRunning ? 'cursor-pointer hover:bg-zinc-900/70' : 'opacity-55 cursor-not-allowed',
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        disabled={!isRunning || assemblingTeam}
                        checked={checked}
                        onChange={(e) => {
                          const nextIds = e.target.checked
                            ? [...teamForm.member_ids, sbx.id]
                            : teamForm.member_ids.filter((id) => id !== sbx.id)
                          setTeamForm({
                            ...teamForm,
                            member_ids: nextIds,
                            moderator_id: nextIds.includes(teamForm.moderator_id)
                              ? teamForm.moderator_id
                              : nextIds[0] || '',
                          })
                        }}
                        className="h-3.5 w-3.5 rounded border-zinc-600 accent-indigo-500"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-medium text-zinc-100">{sbx.slug}</span>
                          {sbx.role_title && (
                            <Badge variant="outline" className="text-[10px]">
                              {sbx.role_title}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate">{sbx.email}</div>
                      </div>
                    </div>
                    <Badge variant={isRunning ? 'success' : 'secondary'}>
                      {localizeStatus(locale, sbx.status)}
                    </Badge>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('dialog.team.moderatorLabel')}</Label>
            <Select
              value={teamForm.moderator_id}
              onChange={(e) => setTeamForm({ ...teamForm, moderator_id: e.target.value })}
            >
              <option value="">{t('dialog.team.moderatorNone')}</option>
              {sandboxes
                .filter((s) => teamForm.member_ids.includes(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.slug} {s.role_title ? `(${s.role_title})` : ''}
                  </option>
                ))}
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
            <Button
              type="button"
              variant="ghost"
              disabled={assemblingTeam}
              onClick={() => setTeamModalOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={assemblingTeam || teamForm.member_ids.length < 2 || !teamForm.name.trim()}
            >
              <Users className="h-3.5 w-3.5" />
              {assemblingTeam
                ? t('dialog.team.submitting')
                : t('dialog.team.submit', { count: teamForm.member_ids.length })}
            </Button>
          </div>
        </form>
      </Dialog>

  )
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
