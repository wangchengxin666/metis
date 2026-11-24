import { useState } from 'react'
import { Edit3, KeyRound, Plus, Send, Trash2 } from 'lucide-react'
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
import type {
  CredentialProfileItem,
  LlmProfileItem,
  SandboxItem,
  TemplateItem,
} from '../../types'
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
  gateway_enabled: true,
  input_price_per_1m: '',
  output_price_per_1m: '',
  fallback_llm_profile_id: '',
}

export interface LlmAndVaultTabProps {
  llmProfiles: LlmProfileItem[]
  credentialProfiles: CredentialProfileItem[]
  sandboxes: SandboxItem[]
  templates?: TemplateItem[]
  onRefresh: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}

export function LlmAndVaultTab({
  llmProfiles,
  credentialProfiles,
  sandboxes,
  templates = [],
  onRefresh,
  notify,
}: LlmAndVaultTabProps) {
  const { locale, t } = useI18n()
  const [llmModalOpen, setLlmModalOpen] = useState(false)
  const [editingLlmId, setEditingLlmId] = useState<string | null>(null)
  const [llmForm, setLlmForm] = useState(EMPTY_LLM_FORM)
  const [savingLlm, setSavingLlm] = useState(false)
  const [pushLlmTarget, setPushLlmTarget] = useState<LlmProfileItem | null>(null)
  const [pushLlmSelectedIds, setPushLlmSelectedIds] = useState<string[]>([])
  const [pushLlmSetDefault, setPushLlmSetDefault] = useState(true)
  const [pushLlmReplaceManaged, setPushLlmReplaceManaged] = useState(false)
  const [pushingLlm, setPushingLlm] = useState(false)
  const [pushLlmResults, setPushLlmResults] = useState<
    Array<{ slug: string; ok: boolean; skipped?: boolean; detail?: string }> | null
  >(null)

  const openAddLlmModal = () => {
    setEditingLlmId(null)
    setLlmForm(EMPTY_LLM_FORM)
    setLlmModalOpen(true)
  }

  const openEditLlmModal = (p: LlmProfileItem) => {
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
      gateway_enabled: Boolean(p.gateway_enabled),
      input_price_per_1m: p.input_price_per_1m != null ? String(p.input_price_per_1m) : '',
      output_price_per_1m: p.output_price_per_1m != null ? String(p.output_price_per_1m) : '',
      fallback_llm_profile_id: p.fallback_llm_profile_id || '',
    })
    setLlmModalOpen(true)
  }

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
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-indigo-400 shrink-0" />
              <span>{t('admin.llm.listTitle')}</span>
              <Badge variant="outline">{llmProfiles.length}</Badge>
            </CardTitle>
            <Button type="button" size="sm" onClick={openAddLlmModal}>
              <Plus className="h-4 w-4" />
              {t('admin.llm.addTitle')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {llmProfiles.length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center">{t('admin.llm.empty')}</p>
          ) : (
            <div className="divide-y divide-zinc-800/70">
              {llmProfiles.map((p) => {
                const boundCount = sandboxes.filter((s) => s.llm_profile_id === p.id).length
                return (
                  <div
                    key={p.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 text-sm"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-zinc-100">{p.name}</span>
                        {boundCount > 0 && (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                            {t('admin.llm.boundCount', { count: boundCount })}
                          </Badge>
                        )}
                        <Badge variant="outline">
                          {p.api_protocol || 'openai-completions'}
                        </Badge>
                        {p.context_window ? (
                          <Badge variant="outline">
                            {p.context_window >= 1000000
                              ? `${(p.context_window / 1000000).toFixed(p.context_window % 1000000 === 0 ? 0 : 1)}M ctx`
                              : `${Math.round(p.context_window / 1000)}K ctx`}
                          </Badge>
                        ) : null}
                        {p.supports_image && (
                          <Badge variant="outline" className="border-sky-500/40 text-sky-300">
                            {t('admin.llm.badgeVision')}
                          </Badge>
                        )}
                        {p.reasoning_effort && (
                          <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                            {`${t('admin.llm.badgeThinking')}: ${p.reasoning_effort}`}
                          </Badge>
                        )}
                        <Badge variant="secondary">
                          {p.has_api_key ? t('admin.llm.badgeKeySet') : t('admin.llm.badgeNoKey')}
                        </Badge>
                        {p.gateway_enabled && (
                          <Badge variant="outline" className="border-indigo-500/40 text-indigo-300">
                            {t('admin.llm.badgeGateway')}
                          </Badge>
                        )}
                        {(p.input_price_per_1m != null || p.output_price_per_1m != null) && (
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {t('admin.llm.badgePrice', {
                              in: p.input_price_per_1m ?? 0,
                              out: p.output_price_per_1m ?? 0,
                            })}
                          </Badge>
                        )}
                      </div>
                      <div className="font-mono text-xs text-zinc-400 truncate">
                        {p.model} · {p.base_url}
                      </div>
                      {p.gateway_enabled && (
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-indigo-300/90">
                          <span className="truncate">
                            Gateway: {`${window.location.origin}/api/llm-gateway/p/${p.id}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const url = `${window.location.origin}/api/llm-gateway/p/${p.id}`
                              void navigator.clipboard?.writeText(url).then(() => notify(t('common.copied')))
                            }}
                            className="shrink-0 rounded border border-indigo-500/35 px-1.5 py-0.5 text-[10px] hover:bg-indigo-500/15 cursor-pointer"
                          >
                            {t('common.copy')}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={sandboxes.length === 0}
                        onClick={() => openPushLlmDialog(p)}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {t('admin.llm.pushBtn')}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEditLlmModal(p)}>
                        <Edit3 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-rose-400 hover:text-rose-300"
                        onClick={async () => {
                          await apiFetch(`/api/llm-profiles/${p.id}`, { method: 'DELETE' })
                          notify(t('admin.llmDeleted'))
                          await onRefresh()
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <CredentialVaultSection
        credentialProfiles={credentialProfiles}
        sandboxes={sandboxes}
        templates={templates}
        onRefresh={onRefresh}
        notify={notify}
      />

      {/* Create / Edit LLM Profile Modal */}
      <Dialog
        open={llmModalOpen}
        onOpenChange={(o) => !o && !savingLlm && setLlmModalOpen(false)}
        title={editingLlmId ? t('admin.llm.editTitle') : t('admin.llm.addTitle')}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setSavingLlm(true)
            try {
              const ctxNum = llmForm.context_window.trim()
                ? Number.parseInt(llmForm.context_window.trim(), 10)
                : null
              const maxNum = llmForm.max_tokens.trim()
                ? Number.parseInt(llmForm.max_tokens.trim(), 10)
                : null
              const inPrice = llmForm.input_price_per_1m.trim()
                ? Number.parseFloat(llmForm.input_price_per_1m.trim())
                : null
              const outPrice = llmForm.output_price_per_1m.trim()
                ? Number.parseFloat(llmForm.output_price_per_1m.trim())
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
                gateway_enabled: Boolean(llmForm.gateway_enabled),
                input_price_per_1m: Number.isFinite(inPrice as number) ? inPrice : null,
                output_price_per_1m: Number.isFinite(outPrice as number) ? outPrice : null,
                fallback_llm_profile_id: llmForm.fallback_llm_profile_id || null,
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
              setLlmModalOpen(false)
              await onRefresh()
            } catch (err: any) {
              notify(err.message, 'error')
            } finally {
              setSavingLlm(false)
            }
          }}
          className="space-y-4 text-sm"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('admin.llm.nameLabel')}</Label>
              <Input
                required
                placeholder={t('admin.llm.namePlaceholder')}
                value={llmForm.name}
                onChange={(e) => setLlmForm({ ...llmForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
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
                <option value="openai-completions">OpenAI Completions</option>
                <option value="openai-responses">OpenAI Responses</option>
                <option value="anthropic-messages">Anthropic Messages</option>
                <option value="google-generative-ai">Google Gemini</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('admin.llm.baseUrlLabel')}</Label>
            <Input
              required
              value={llmForm.base_url}
              onChange={(e) => setLlmForm({ ...llmForm, base_url: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('admin.llm.modelLabel')}</Label>
              <Input
                required
                value={llmForm.model}
                onChange={(e) => setLlmForm({ ...llmForm, model: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.llm.apiKeyLabel')}</Label>
              <Input
                type="password"
                placeholder={editingLlmId ? t('admin.llm.apiKeyEditHint') : 'sk-...'}
                value={llmForm.api_key}
                onChange={(e) => setLlmForm({ ...llmForm, api_key: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('admin.llm.contextWindowLabel')}</Label>
              <Input
                type="number"
                min={1024}
                max={10000000}
                placeholder="128000"
                value={llmForm.context_window}
                onChange={(e) => setLlmForm({ ...llmForm, context_window: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.llm.maxTokensLabel')}</Label>
              <Input
                type="number"
                min={128}
                max={1000000}
                placeholder="8192"
                value={llmForm.max_tokens}
                onChange={(e) => setLlmForm({ ...llmForm, max_tokens: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
              <Label>{t('admin.llm.thinkingFormatLabel')}</Label>
              <Select
                disabled={llmForm.api_protocol !== 'openai-completions'}
                value={
                  llmForm.api_protocol === 'openai-completions' ? llmForm.thinking_format : ''
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
          <label className="flex items-center gap-2 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5 text-zinc-200 cursor-pointer">
            <input
              type="checkbox"
              checked={llmForm.supports_image}
              onChange={(e) => setLlmForm({ ...llmForm, supports_image: e.target.checked })}
              className="h-4 w-4 rounded border-zinc-600"
            />
            <span>{t('admin.llm.supportsImageLabel')}</span>
          </label>
          <div className="rounded-[var(--brand-radius-md)] border border-indigo-500/30 bg-indigo-950/20 p-3.5 space-y-3">
            <label className="flex items-start gap-2.5 text-zinc-100 cursor-pointer">
              <input
                type="checkbox"
                checked={llmForm.gateway_enabled}
                onChange={(e) => setLlmForm({ ...llmForm, gateway_enabled: e.target.checked })}
                className="h-4 w-4 mt-0.5 rounded border-zinc-600 accent-indigo-500"
              />
              <div>
                <div className="font-medium text-sm">{t('admin.llm.gatewayEnabledLabel')}</div>
                <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                  {t('admin.llm.gatewayEnabledHint')}
                </p>
              </div>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('admin.llm.inputPriceLabel')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="0.50"
                  value={llmForm.input_price_per_1m}
                  onChange={(e) => setLlmForm({ ...llmForm, input_price_per_1m: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('admin.llm.outputPriceLabel')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="1.50"
                  value={llmForm.output_price_per_1m}
                  onChange={(e) => setLlmForm({ ...llmForm, output_price_per_1m: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('admin.llm.fallbackLabel')}</Label>
              <Select
                value={llmForm.fallback_llm_profile_id}
                onChange={(e) =>
                  setLlmForm({ ...llmForm, fallback_llm_profile_id: e.target.value })
                }
              >
                <option value="">{t('admin.llm.fallbackNone')}</option>
                {llmProfiles
                  .filter((p) => p.id !== editingLlmId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.model})
                    </option>
                  ))}
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setLlmModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingLlm}>
              {savingLlm
                ? t('common.saving')
                : editingLlmId
                  ? t('admin.llm.updateBtn')
                  : t('admin.llm.saveBtn')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={!!pushLlmTarget}
        onOpenChange={(o) => !o && !pushingLlm && setPushLlmTarget(null)}
        title={t('dialog.pushLlm.title', { name: pushLlmTarget?.name ?? '' })}
        description={t('dialog.pushLlm.desc')}
      >
        {pushLlmTarget && (
          <div className="space-y-4 text-sm">
            <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-zinc-100">{pushLlmTarget.name}</span>
                <Badge variant="outline">{pushLlmTarget.api_protocol || 'openai-completions'}</Badge>
                <Badge variant="secondary">
                  {pushLlmTarget.has_api_key ? t('admin.llm.badgeKeySet') : t('admin.llm.badgeNoKey')}
                </Badge>
              </div>
              <div className="font-mono text-xs text-zinc-400 truncate">
                {pushLlmTarget.model} · {pushLlmTarget.base_url}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{t('dialog.pushLlm.targetsLabel')}</Label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="rounded border border-zinc-700/80 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 cursor-pointer"
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
                    className="rounded border border-zinc-700/80 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 cursor-pointer"
                    onClick={() => setPushLlmSelectedIds([])}
                  >
                    {t('dialog.pushLlm.clearAll')}
                  </button>
                </div>
              </div>

              {sandboxes.length === 0 ? (
                <p className="text-zinc-500 py-4 text-center">{t('dialog.pushLlm.noSandboxes')}</p>
              ) : (
                <div className="max-h-56 overflow-y-auto divide-y divide-zinc-800/70 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60">
                  {sandboxes.map((sbx) => {
                    const isRunning = sbx.status === 'running'
                    const checked = pushLlmSelectedIds.includes(sbx.id)
                    return (
                      <label
                        key={sbx.id}
                        className={cn(
                          'flex items-center justify-between gap-3 px-3.5 py-2.5',
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
                            className="h-4 w-4 rounded border-zinc-600 accent-indigo-500"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-medium text-zinc-100">{sbx.slug}</span>
                              {sbx.display_name && (
                                <span className="text-zinc-400 truncate">({sbx.display_name})</span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-500 truncate">
                              {isRunning
                                ? sbx.llm_profile_name
                                  ? t('dialog.pushLlm.currentModel', { name: sbx.llm_profile_name })
                                  : sbx.email
                                : t('dialog.pushLlm.stoppedSkip')}
                            </div>
                          </div>
                        </div>
                        <Badge variant={isRunning ? 'success' : 'secondary'}>
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
                  className="h-4 w-4 rounded border-zinc-600 accent-indigo-500"
                />
                <span>{t('dialog.pushLlm.setDefaultLabel')}</span>
              </label>
              <label className="flex items-center gap-2 text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={pushingLlm}
                  checked={pushLlmReplaceManaged}
                  onChange={(e) => setPushLlmReplaceManaged(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-600 accent-indigo-500"
                />
                <span>{t('dialog.pushLlm.replaceManagedLabel')}</span>
              </label>
            </div>

            {pushLlmResults && pushLlmResults.length > 0 && (
              <div className="space-y-1.5 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="text-xs font-medium text-zinc-300">
                  {t('dialog.pushLlm.resultTitle')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pushLlmResults.map((r) => (
                    <Badge
                      key={r.slug}
                      variant={r.ok ? 'success' : r.skipped ? 'warning' : 'destructive'}
                      className="font-mono"
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
                <Send className="h-4 w-4" />
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
