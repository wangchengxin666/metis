import React, { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Brain, CheckCircle2, Pin, RefreshCw, Sparkles } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  Input,
  Label,
  Select,
  Textarea,
  cn,
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type {
  AuthMe,
  MemoryPromotionItem,
  SandboxItem,
  SandboxMemoryItem,
  TeamItem,
  TemplateItem,
} from '../../types'

export function MemoryHubSection({
  auth,
  sandboxes,
  teams,
  templates,
  notify,
}: {
  auth: AuthMe
  sandboxes: SandboxItem[]
  teams: TeamItem[]
  templates: TemplateItem[]
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useI18n()
  const inspectable = sandboxes.filter((s) => s.can_open_ide !== false)
  const [selectedSbxId, setSelectedSbxId] = useState(inspectable[0]?.id || '')
  const [memories, setMemories] = useState<SandboxMemoryItem[]>([])
  const [online, setOnline] = useState(true)
  const [loadingMem, setLoadingMem] = useState(false)
  const [promotions, setPromotions] = useState<MemoryPromotionItem[]>([])

  // Promote Dialog
  const [promoteMem, setPromoteMem] = useState<SandboxMemoryItem | null>(null)
  const [promoteForm, setPromoteForm] = useState({
    title: '',
    content: '',
    target_type: (auth.admin ? 'template_sop' : 'team_shared_doc') as
      | 'template_sop'
      | 'team_shared_doc',
    target_template_id: templates[0]?.id || '',
    target_team_id: teams.find((tm) => tm.can_manage)?.id || teams[0]?.id || '',
    target_file_name: 'TEAM_PLAYBOOK_SOP.md',
    rollout_sandbox_ids: [] as string[],
  })
  const [promoting, setPromoting] = useState(false)

  const loadPromotions = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: MemoryPromotionItem[] }>('/api/memory-hub/promotions')
      setPromotions(res.items || [])
    } catch {
      // ignore
    }
  }, [])

  const loadMemories = useCallback(
    async (sbxId: string) => {
      if (!sbxId) return
      setLoadingMem(true)
      try {
        const res = await apiFetch<{
          ok: boolean
          online: boolean
          memories: SandboxMemoryItem[]
        }>(`/api/memory-hub/sandboxes/${sbxId}/memories`)
        setOnline(Boolean(res.online))
        setMemories(res.memories || [])
      } catch (err: any) {
        notify(err.message, 'error')
      } finally {
        setLoadingMem(false)
      }
    },
    [notify],
  )

  useEffect(() => {
    void loadPromotions()
  }, [loadPromotions])

  useEffect(() => {
    if (!selectedSbxId && inspectable.length > 0) {
      setSelectedSbxId(inspectable[0].id)
    }
  }, [inspectable, selectedSbxId])

  useEffect(() => {
    if (selectedSbxId) {
      void loadMemories(selectedSbxId)
    }
  }, [selectedSbxId, loadMemories])

  const openPromote = (mem: SandboxMemoryItem) => {
    setPromoteMem(mem)
    const managedTeams = teams.filter((tm) => tm.can_manage)
    setPromoteForm({
      title: mem.title,
      content: mem.content || mem.summary,
      target_type: auth.admin ? 'template_sop' : 'team_shared_doc',
      target_template_id: templates[0]?.id || '',
      target_team_id: managedTeams[0]?.id || teams[0]?.id || '',
      target_file_name: 'TEAM_PLAYBOOK_SOP.md',
      rollout_sandbox_ids: sandboxes
        .filter((s) => s.status === 'running' && s.id !== selectedSbxId)
        .slice(0, 2)
        .map((s) => s.id),
    })
  }

  const handlePromote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!promoteMem || !selectedSbxId) return
    setPromoting(true)
    try {
      const res = await apiFetch<{
        promotion: MemoryPromotionItem
        rollout: { synced: number; total: number }
      }>('/api/memory-hub/promote', {
        method: 'POST',
        body: JSON.stringify({
          source_sandbox_id: selectedSbxId,
          memory_id: promoteMem.id,
          memory_title: promoteForm.title.trim(),
          memory_category: promoteMem.category || 'workflow',
          promoted_content: promoteForm.content.trim(),
          target_type: promoteForm.target_type,
          target_template_id:
            promoteForm.target_type === 'template_sop' ? promoteForm.target_template_id : null,
          target_team_id:
            promoteForm.target_type === 'team_shared_doc' ? promoteForm.target_team_id : null,
          target_file_name: promoteForm.target_file_name.trim() || 'TEAM_PLAYBOOK_SOP.md',
          rollout_sandbox_ids: promoteForm.rollout_sandbox_ids,
        }),
      })
      notify(
        t('memoryHub.promotedOk', {
          synced: res.rollout.synced,
          total: res.rollout.total,
        }),
      )
      setPromoteMem(null)
      await loadPromotions()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setPromoting(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-indigo-400" />
                <span>{t('memoryHub.title')}</span>
              </CardTitle>
              <p className="text-xs text-zinc-400 mt-1">{t('memoryHub.subtitle')}</p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={selectedSbxId}
                onChange={(e) => setSelectedSbxId(e.target.value)}
                className="h-9 text-xs w-auto min-w-[210px] max-w-full sm:max-w-[340px]"
              >
                <option value="">{t('memoryHub.selectEmployee')}</option>
                {inspectable.map((s) => (
                  <option key={s.id} value={s.id}>
                    @{s.slug} {s.role_title ? `· ${s.role_title}` : ''}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={!selectedSbxId || loadingMem}
                onClick={() => void loadMemories(selectedSbxId)}
              >
                <RefreshCw className={cn('h-4 w-4', loadingMem && 'animate-spin')} />
                {t('memoryHub.inspectBtn')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!online ? (
            <p className="text-sm text-amber-300/90 py-8 text-center">{t('memoryHub.offlineHint')}</p>
          ) : memories.length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center">{t('memoryHub.empty')}</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {memories.map((mem) => (
                <div
                  key={mem.id}
                  className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-medium text-zinc-100 text-sm">
                        {mem.pinned && <Pin className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                        <span>{mem.title}</span>
                      </div>
                      <Badge variant="outline" className="text-[11px] shrink-0">
                        {mem.category}
                      </Badge>
                    </div>
                    <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap line-clamp-4">
                      {mem.content || mem.summary}
                    </p>
                    {mem.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {mem.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px]">
                            #{tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end pt-2 border-t border-zinc-800/70">
                    <Button size="sm" variant="outline" onClick={() => openPromote(mem)}>
                      <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                      {t('memoryHub.promoteBtn')}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Promotion History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span>{t('memoryHub.historyTitle')}</span>
            <Badge variant="outline">{promotions.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {promotions.length === 0 ? (
            <p className="text-sm text-zinc-500 py-6 text-center">{t('memoryHub.historyEmpty')}</p>
          ) : (
            <div className="divide-y divide-zinc-800/60 text-xs">
              {promotions.map((p) => (
                <div
                  key={p.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-100">{p.memory_title}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        from @{p.source_sandbox_slug}
                      </Badge>
                      {p.target_type === 'template_sop' ? (
                        <Badge variant="default" className="text-[10px]">
                          {p.target_template_name} · SOP v{p.sop_version}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          {p.target_team_name} / {p.target_file_name}
                        </Badge>
                      )}
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 text-[10px]">
                        synced {p.rollout_synced_count}/{p.rollout_sandbox_ids.length}
                      </Badge>
                    </div>
                    <div className="text-zinc-500 font-mono">
                      by {p.promoted_by}
                      {p.created_at ? ` · ${new Date(p.created_at).toLocaleString()}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Promote Dialog */}
      <Dialog
        open={!!promoteMem}
        onOpenChange={(o) => !o && !promoting && setPromoteMem(null)}
        title={t('memoryHub.dialogTitle')}
        maxWidth="max-w-xl"
      >
        <form onSubmit={handlePromote} className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label>{t('memoryHub.memTitleLabel')}</Label>
            <Input
              required
              value={promoteForm.title}
              onChange={(e) => setPromoteForm({ ...promoteForm, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('memoryHub.memContentLabel')}</Label>
            <Textarea
              rows={5}
              required
              value={promoteForm.content}
              onChange={(e) => setPromoteForm({ ...promoteForm, content: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('memoryHub.targetTypeLabel')}</Label>
            <Select
              value={promoteForm.target_type}
              onChange={(e) =>
                setPromoteForm({
                  ...promoteForm,
                  target_type: e.target.value as 'template_sop' | 'team_shared_doc',
                })
              }
            >
              {auth.admin && (
                <option value="template_sop">{t('memoryHub.targetTemplateSop')}</option>
              )}
              <option value="team_shared_doc">{t('memoryHub.targetTeamDoc')}</option>
            </Select>
          </div>

          {promoteForm.target_type === 'template_sop' ? (
            <div className="space-y-1.5">
              <Label>{t('memoryHub.selectTemplate')}</Label>
              <Select
                required
                value={promoteForm.target_template_id}
                onChange={(e) =>
                  setPromoteForm({ ...promoteForm, target_template_id: e.target.value })
                }
              >
                <option value="">--</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} (v{tpl.sop_version || 1})
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('memoryHub.selectTeam')}</Label>
                <Select
                  required
                  value={promoteForm.target_team_id}
                  onChange={(e) =>
                    setPromoteForm({ ...promoteForm, target_team_id: e.target.value })
                  }
                >
                  <option value="">--</option>
                  {teams
                    .filter((tm) => tm.can_manage)
                    .map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name}
                      </option>
                    ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('memoryHub.fileNameLabel')}</Label>
                <Input
                  value={promoteForm.target_file_name}
                  onChange={(e) =>
                    setPromoteForm({ ...promoteForm, target_file_name: e.target.value })
                  }
                />
              </div>
            </div>
          )}

          {/* Canary / Batch Rollout */}
          {sandboxes.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t('memoryHub.canaryLabel')}</Label>
              <div className="max-h-32 overflow-y-auto rounded-[var(--brand-radius-sm)] border border-zinc-800 bg-zinc-950/60 p-2 grid grid-cols-2 gap-1.5 text-xs">
                {sandboxes.map((s) => {
                  const checked = promoteForm.rollout_sandbox_ids.includes(s.id)
                  return (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 text-zinc-300 cursor-pointer truncate"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setPromoteForm((prev) => ({
                            ...prev,
                            rollout_sandbox_ids: e.target.checked
                              ? [...prev.rollout_sandbox_ids, s.id]
                              : prev.rollout_sandbox_ids.filter((id) => id !== s.id),
                          }))
                        }
                        className="rounded border-zinc-700 accent-indigo-500 shrink-0"
                      />
                      <span className="font-mono truncate">@{s.slug}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setPromoteMem(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={promoting}>
              <Sparkles className="h-4 w-4" />
              {promoting ? t('common.saving') : t('memoryHub.submitPromote')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
