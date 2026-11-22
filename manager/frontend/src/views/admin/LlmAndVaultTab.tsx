import { useState } from 'react'
import { Edit3, Plus, Send, Trash2 } from 'lucide-react'
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
  cn,
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { localizeStatus } from '../../lib/i18n.ts'
import { useI18n } from '../../lib/i18nContext'
import type { CredentialProfileItem, LlmProfileItem, SandboxItem } from '../../types'
import { CredentialVaultSection } from './CredentialVaultSection'

const EMPTY_LLM_FORM = {
  name: '',
  api_protocol: 'openai-completions',
  base_url: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  api_key: '',
  context_window: '128000',
  max_tokens: '8192',
  supports_image: false,
  reasoning_effort: '',
  thinking_format: '',
}

export interface LlmAndVaultTabProps {
  llmProfiles: LlmProfileItem[]
  credentialProfiles: CredentialProfileItem[]
  sandboxes: SandboxItem[]
  onRefresh: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}

export function LlmAndVaultTab({
  llmProfiles,
  credentialProfiles,
  sandboxes,
  onRefresh,
  notify,
}: LlmAndVaultTabProps) {
  const { locale, t } = useI18n()
  const [editingLlmId, setEditingLlmId] = useState<string | null>(null)
  const [llmForm, setLlmForm] = useState(EMPTY_LLM_FORM)
  const [pushLlmTarget, setPushLlmTarget] = useState<LlmProfileItem | null>(null)
  const [pushLlmSelectedIds, setPushLlmSelectedIds] = useState<string[]>([])
  const [pushLlmSetDefault, setPushLlmSetDefault] = useState(true)
  const [pushLlmReplaceManaged, setPushLlmReplaceManaged] = useState(false)
  const [pushingLlm, setPushingLlm] = useState(false)
  const [pushLlmResults, setPushLlmResults] = useState<
    Array<{ slug: string; ok: boolean; skipped?: boolean; detail?: string }> | null
  >(null)

  const openPushLlmDialog = (profile: LlmProfileItem) => {
    setPushLlmTarget(profile)
    setPushLlmSelectedIds(sandboxes.filter((s) => s.status === 'running').map((s) => s.id))
    setPushLlmSetDefault(true)
    setPushLlmReplaceManaged(false)
    setPushLlmResults(null)
  }

  const handlePushLlm = async () => {
    if (!pushLlmTarget || pushLlmSelectedIds.length === 0) return
    setPushingLlm(true)
    setPushLlmResults(null)
    try {
      notify(
        t('admin.llmPushing', {
          name: pushLlmTarget.name,
          count: pushLlmSelectedIds.length,
        }),
      )
      const res = await apiFetch<{
        synced: number
        skipped: number
        failed: number
        total: number
        results: Array<{ slug: string; ok: boolean; skipped?: boolean; detail?: string }>
      }>(`/api/llm-profiles/${pushLlmTarget.id}/push`, {
        method: 'POST',
        body: JSON.stringify({
          sandbox_ids: pushLlmSelectedIds,
          set_as_default: pushLlmSetDefault,
          replace_managed: pushLlmReplaceManaged,
        }),
      })
      setPushLlmResults(res.results || [])
      notify(
        t('admin.llmPushed', {
          name: pushLlmTarget.name,
          synced: res.synced,
          total: res.total,
        }),
        res.failed > 0 ? 'error' : 'success',
      )
      await onRefresh()
    } catch (err: any) {
      notify(err.message || t('admin.llmPushFailed'), 'error')
    } finally {
      setPushingLlm(false)
    }
  }

  return (
    <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>
                  {editingLlmId ? t('admin.llm.editTitle') : t('admin.llm.addTitle')}
                </CardTitle>
                {editingLlmId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingLlmId(null)
                      setLlmForm(EMPTY_LLM_FORM)
                    }}
                  >
                    {t('admin.llm.cancelEditBtn')}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    const ctxNum = llmForm.context_window.trim()
                      ? Number.parseInt(llmForm.context_window.trim(), 10)
                      : null
                    const maxNum = llmForm.max_tokens.trim()
                      ? Number.parseInt(llmForm.max_tokens.trim(), 10)
                      : null
                    const body: Record<string, unknown> = {
                      name: llmForm.name.trim(),
                      api_protocol: llmForm.api_protocol || 'openai-completions',
                      base_url: llmForm.base_url.trim(),
                      model: llmForm.model.trim(),
                      context_window: Number.isFinite(ctxNum as number) ? ctxNum : null,
                      max_tokens: Number.isFinite(maxNum as number) ? maxNum : null,
                      supports_image: Boolean(llmForm.supports_image),
                      reasoning_effort: llmForm.reasoning_effort || null,
                      thinking_format:
                        (llmForm.api_protocol || 'openai-completions') === 'openai-completions'
                          ? llmForm.thinking_format || null
                          : null,
                    }
                    if (!editingLlmId || llmForm.api_key.trim()) {
                      body.api_key = llmForm.api_key.trim()
                    }
                    if (editingLlmId) {
                      await apiFetch(`/api/llm-profiles/${editingLlmId}`, {
                        method: 'PATCH',
                        body: JSON.stringify(body),
                      })
                    } else {
                      await apiFetch('/api/llm-profiles', {
                        method: 'POST',
                        body: JSON.stringify(body),
                      })
                    }
                    notify(t('admin.llmSaved'))
                    setEditingLlmId(null)
                    setLlmForm(EMPTY_LLM_FORM)
                    await onRefresh()
                  } catch (err: any) {
                    notify(err.message, 'error')
                  }
                }}
                className="space-y-3"
              >
                <div className="space-y-1">
                  <Label>{t('admin.llm.nameLabel')}</Label>
                  <Input
                    required
                    placeholder={t('admin.llm.namePlaceholder')}
                    value={llmForm.name}
                    onChange={(e) => setLlmForm({ ...llmForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('admin.llm.apiProtocolLabel')}</Label>
                  <Select
                    value={llmForm.api_protocol}
                    onChange={(e) => {
                      const nextProto = e.target.value
                      setLlmForm({
                        ...llmForm,
                        api_protocol: nextProto,
                        thinking_format:
                          nextProto === 'openai-completions' ? llmForm.thinking_format : '',
                      })
                    }}
                  >
                    <option value="openai-completions">OpenAI Completions (v1/chat/completions)</option>
                    <option value="openai-responses">OpenAI Responses (v1/responses)</option>
                    <option value="anthropic-messages">Anthropic Messages (v1/messages)</option>
                    <option value="google-generative-ai">Google Generative AI (Gemini)</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{t('admin.llm.baseUrlLabel')}</Label>
                  <Input
                    required
                    value={llmForm.base_url}
                    onChange={(e) => setLlmForm({ ...llmForm, base_url: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('admin.llm.modelLabel')}</Label>
                  <Input
                    required
                    value={llmForm.model}
                    onChange={(e) => setLlmForm({ ...llmForm, model: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('admin.llm.apiKeyLabel')}</Label>
                  <Input
                    type="password"
                    placeholder={editingLlmId ? t('admin.llm.apiKeyEditHint') : 'sk-...'}
                    value={llmForm.api_key}
                    onChange={(e) => setLlmForm({ ...llmForm, api_key: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>{t('admin.llm.contextWindowLabel')}</Label>
                    <Input
                      type="number"
                      min={1024}
                      max={10000000}
                      step={1}
                      placeholder="128000"
                      value={llmForm.context_window}
                      onChange={(e) => setLlmForm({ ...llmForm, context_window: e.target.value })}
                    />
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {['128000', '256000', '1000000'].map((v) => (
                        <button
                          key={v}
                          type="button"
                          className="rounded border border-zinc-700/80 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                          onClick={() => setLlmForm({ ...llmForm, context_window: v })}
                        >
                          {v === '1000000' ? '1M' : `${Number(v) / 1000}K`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>{t('admin.llm.maxTokensLabel')}</Label>
                    <Input
                      type="number"
                      min={128}
                      max={1000000}
                      step={1}
                      placeholder="8192"
                      value={llmForm.max_tokens}
                      onChange={(e) => setLlmForm({ ...llmForm, max_tokens: e.target.value })}
                    />
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {['8192', '16384', '32000', '64000'].map((v) => (
                        <button
                          key={v}
                          type="button"
                          className="rounded border border-zinc-700/80 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                          onClick={() => setLlmForm({ ...llmForm, max_tokens: v })}
                        >
                          {`${Math.round(Number(v) / 1000)}K`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>{t('admin.llm.reasoningEffortLabel')}</Label>
                    <Select
                      value={llmForm.reasoning_effort}
                      onChange={(e) => setLlmForm({ ...llmForm, reasoning_effort: e.target.value })}
                    >
                      <option value="">{t('admin.llm.reasoningAuto')}</option>
                      <option value="off">{t('admin.llm.reasoningOff')}</option>
                      <option value="minimal">{t('admin.llm.reasoningMinimal')}</option>
                      <option value="low">{t('admin.llm.reasoningLow')}</option>
                      <option value="medium">{t('admin.llm.reasoningMedium')}</option>
                      <option value="high">{t('admin.llm.reasoningHigh')}</option>
                      <option value="xhigh">{t('admin.llm.reasoningXhigh')}</option>
                      <option value="max">{t('admin.llm.reasoningMax')}</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{t('admin.llm.thinkingFormatLabel')}</Label>
                    <Select
                      disabled={llmForm.api_protocol !== 'openai-completions'}
                      value={
                        llmForm.api_protocol === 'openai-completions'
                          ? llmForm.thinking_format
                          : ''
                      }
                      onChange={(e) => setLlmForm({ ...llmForm, thinking_format: e.target.value })}
                    >
                      <option value="">
                        {llmForm.api_protocol === 'openai-completions'
                          ? t('admin.llm.thinkingFormatAuto')
                          : t('admin.llm.thinkingFormatCompletionsOnly')}
                      </option>
                      <option value="openai">openai (reasoning_effort)</option>
                      <option value="deepseek">deepseek (thinking)</option>
                      <option value="qwen">qwen (enable_thinking)</option>
                      <option value="openrouter">openrouter</option>
                      <option value="zai">zai</option>
                      <option value="together">together</option>
                      <option value="chat-template">chat-template</option>
                      <option value="qwen-chat-template">qwen-chat-template</option>
                    </Select>
                  </div>
                </div>
                <label className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={llmForm.supports_image}
                    onChange={(e) => setLlmForm({ ...llmForm, supports_image: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-zinc-600"
                  />
                  <span>{t('admin.llm.supportsImageLabel')}</span>
                </label>
                <Button type="submit" className="w-full">
                  <Plus className="h-3.5 w-3.5" />
                  {editingLlmId ? t('admin.llm.updateBtn') : t('admin.llm.saveBtn')}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t('admin.llm.listTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {llmProfiles.length === 0 ? (
                <p className="text-xs text-zinc-500 py-8 text-center">{t('admin.llm.empty')}</p>
              ) : (
                <div className="divide-y divide-zinc-800/70">
                  {llmProfiles.map((p) => {
                    const boundCount = sandboxes.filter((s) => s.llm_profile_id === p.id).length
                    return (
                    <div key={p.id} className="flex items-start justify-between gap-3 py-3 text-xs">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-zinc-100">{p.name}</span>
                          {boundCount > 0 ? (
                            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
                              {t('admin.llm.boundCount', { count: boundCount })}
                            </Badge>
                          ) : null}
                          <Badge variant="outline" className="text-[10px]">
                            {p.api_protocol || 'openai-completions'}
                          </Badge>
                          {p.context_window ? (
                            <Badge variant="outline" className="text-[10px]">
                              {p.context_window >= 1000000
                                ? `${(p.context_window / 1000000).toFixed(p.context_window % 1000000 === 0 ? 0 : 1)}M ctx`
                                : `${Math.round(p.context_window / 1000)}K ctx`}
                            </Badge>
                          ) : null}
                          {p.max_tokens ? (
                            <Badge variant="outline" className="text-[10px]">
                              {`${Math.round(p.max_tokens / 1000)}K out`}
                            </Badge>
                          ) : null}
                          {p.supports_image ? (
                            <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-300">
                              {t('admin.llm.badgeVision')}
                            </Badge>
                          ) : null}
                          {p.reasoning_effort ? (
                            <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-300">
                              {`${t('admin.llm.badgeThinking')}: ${p.reasoning_effort}`}
                            </Badge>
                          ) : null}
                          <Badge variant="outline" className="text-[10px] text-zinc-400">
                            {p.has_api_key ? t('admin.llm.badgeKeySet') : t('admin.llm.badgeNoKey')}
                          </Badge>
                        </div>
                        <div className="font-mono text-zinc-400 truncate">
                          {p.model} · {p.base_url}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={sandboxes.length === 0}
                          onClick={() => openPushLlmDialog(p)}
                        >
                          <Send className="h-3 w-3" />
                          {t('admin.llm.pushBtn')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingLlmId(p.id)
                            setLlmForm({
                              name: p.name,
                              api_protocol: p.api_protocol || 'openai-completions',
                              base_url: p.base_url,
                              model: p.model,
                              api_key: '',
                              context_window: p.context_window ? String(p.context_window) : '',
                              max_tokens: p.max_tokens ? String(p.max_tokens) : '',
                              supports_image: Boolean(p.supports_image),
                              reasoning_effort: p.reasoning_effort || '',
                              thinking_format: p.thinking_format || '',
                            })
                          }}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-400 hover:text-rose-300"
                          onClick={async () => {
                            await apiFetch(`/api/llm-profiles/${p.id}`, { method: 'DELETE' })
                            if (editingLlmId === p.id) {
                              setEditingLlmId(null)
                              setLlmForm(EMPTY_LLM_FORM)
                            }
                            notify(t('admin.llmDeleted'))
                            await onRefresh()
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>


      <CredentialVaultSection
        credentialProfiles={credentialProfiles}
        sandboxes={sandboxes}
        onRefresh={onRefresh}
        notify={notify}
      />

      <Dialog
        open={!!pushLlmTarget}
        onOpenChange={(o) => !o && !pushingLlm && setPushLlmTarget(null)}
        title={t('dialog.pushLlm.title', { name: pushLlmTarget?.name ?? '' })}
        description={t('dialog.pushLlm.desc')}
      >
        {pushLlmTarget && (
          <div className="space-y-4 text-xs">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-zinc-100">{pushLlmTarget.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {pushLlmTarget.api_protocol || 'openai-completions'}
                </Badge>
                <Badge variant="outline" className="text-[10px] text-zinc-400">
                  {pushLlmTarget.has_api_key ? t('admin.llm.badgeKeySet') : t('admin.llm.badgeNoKey')}
                </Badge>
              </div>
              <div className="font-mono text-[11px] text-zinc-400 truncate">
                {pushLlmTarget.model} · {pushLlmTarget.base_url}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{t('dialog.pushLlm.targetsLabel')}</Label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="rounded border border-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                    onClick={() =>
                      setPushLlmSelectedIds(
                        sandboxes.filter((s) => s.status === 'running').map((s) => s.id),
                      )
                    }
                  >
                    {t('dialog.pushLlm.selectRunning', {
                      count: sandboxes.filter((s) => s.status === 'running').length,
                    })}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                    onClick={() => setPushLlmSelectedIds([])}
                  >
                    {t('dialog.pushLlm.clearAll')}
                  </button>
                </div>
              </div>

              {sandboxes.length === 0 ? (
                <p className="text-zinc-500 py-4 text-center">{t('dialog.pushLlm.noSandboxes')}</p>
              ) : (
                <div className="max-h-56 overflow-y-auto divide-y divide-zinc-800/70 rounded-md border border-zinc-800 bg-zinc-950/60">
                  {sandboxes.map((sbx) => {
                    const isRunning = sbx.status === 'running'
                    const checked = pushLlmSelectedIds.includes(sbx.id)
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
                            disabled={!isRunning || pushingLlm}
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPushLlmSelectedIds((prev) =>
                                  prev.includes(sbx.id) ? prev : [...prev, sbx.id],
                                )
                              } else {
                                setPushLlmSelectedIds((prev) => prev.filter((id) => id !== sbx.id))
                              }
                            }}
                            className="h-3.5 w-3.5 rounded border-zinc-600 accent-indigo-500"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 rounded-full shrink-0',
                                  isRunning ? 'bg-emerald-400' : 'bg-zinc-500',
                                )}
                              />
                              <span className="font-mono font-medium text-zinc-100">{sbx.slug}</span>
                              {sbx.display_name ? (
                                <span className="text-zinc-400 truncate">({sbx.display_name})</span>
                              ) : null}
                            </div>
                            <div className="text-[11px] text-zinc-500 truncate">
                              {isRunning
                                ? sbx.llm_profile_name
                                  ? t('dialog.pushLlm.currentModel', { name: sbx.llm_profile_name })
                                  : sbx.email
                                : t('dialog.pushLlm.stoppedSkip')}
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] shrink-0',
                            isRunning
                              ? 'border-emerald-500/40 text-emerald-300'
                              : 'border-zinc-700 text-zinc-500',
                          )}
                        >
                          {localizeStatus(locale, sbx.status)}
                        </Badge>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={pushingLlm}
                  checked={pushLlmSetDefault}
                  onChange={(e) => setPushLlmSetDefault(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-600 accent-indigo-500"
                />
                <span>{t('dialog.pushLlm.setDefaultLabel')}</span>
              </label>
              <label className="flex items-center gap-2 text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={pushingLlm}
                  checked={pushLlmReplaceManaged}
                  onChange={(e) => setPushLlmReplaceManaged(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-600 accent-indigo-500"
                />
                <span>{t('dialog.pushLlm.replaceManagedLabel')}</span>
              </label>
            </div>

            {pushLlmResults && pushLlmResults.length > 0 && (
              <div className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-900/50 p-2.5">
                <div className="text-[11px] font-medium text-zinc-300">
                  {t('dialog.pushLlm.resultTitle')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pushLlmResults.map((r) => (
                    <Badge
                      key={r.slug}
                      variant="outline"
                      className={cn(
                        'text-[10px] font-mono',
                        r.ok
                          ? 'border-emerald-500/40 text-emerald-300'
                          : r.skipped
                            ? 'border-amber-500/40 text-amber-300'
                            : 'border-rose-500/40 text-rose-300',
                      )}
                      title={r.detail || ''}
                    >
                      {r.slug} {r.ok ? '✓' : r.skipped ? '—' : '✕'}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <Button
                type="button"
                variant="ghost"
                disabled={pushingLlm}
                onClick={() => setPushLlmTarget(null)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                disabled={pushingLlm || pushLlmSelectedIds.length === 0}
                onClick={handlePushLlm}
              >
                <Send className="h-3.5 w-3.5" />
                {pushingLlm
                  ? t('dialog.pushLlm.submitting')
                  : t('dialog.pushLlm.submit', { count: pushLlmSelectedIds.length })}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

    </div>
  )
}
