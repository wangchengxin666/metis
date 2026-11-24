import React, { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  Badge,
  Button,
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
  PlaybookInputField,
  PlaybookItem,
  PlaybookStageSpec,
  TemplateItem,
} from '../../types'

export interface PlaybookEditorFormData {
  key: string
  name: string
  category: 'engineering' | 'analytics' | 'legal' | 'operations' | 'custom'
  description: string
  enabled: boolean
  estimated_manual_hours: number
  input_fields: PlaybookInputField[]
  stages: PlaybookStageSpec[]
  deliverables_checklist: string[]
}

const DEFAULT_STAGE = (idx: number): PlaybookStageSpec => ({
  id: `stage_${idx + 1}`,
  name: '',
  role_hint: '',
  template_key_hint: '',
  parallel_group: null,
  approval_required: false,
  prompt_template: '',
  deliverable_hint: '',
})

const DEFAULT_FIELD = (idx: number): PlaybookInputField => ({
  key: `input_${idx + 1}`,
  label: '',
  type: 'text',
  required: idx === 0,
  placeholder: '',
  options: [],
})

function slugifyId(raw: string, fallback: string, sep: '-' | '_' = '_'): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '')
    .slice(0, 48)
  return cleaned.length >= 2 && /^[a-z0-9]/.test(cleaned) ? cleaned : fallback
}

function createEmptyForm(): PlaybookEditorFormData {
  return {
    key: '',
    name: '',
    category: 'custom',
    description: '',
    enabled: true,
    estimated_manual_hours: 4,
    input_fields: [
      {
        key: 'task_title',
        label: '任务主题',
        type: 'text',
        required: true,
        placeholder: '',
        options: [],
      },
      {
        key: 'details',
        label: '详细背景与要求',
        type: 'textarea',
        required: true,
        placeholder: '',
        options: [],
      },
    ],
    stages: [
      {
        id: 'plan',
        name: '方案起草与确认',
        role_hint: '项目负责人 / Tech Lead',
        template_key_hint: '',
        parallel_group: null,
        approval_required: true,
        prompt_template: '请围绕「{{task_title}}」输出清晰的执行方案与验收要点。\n背景要求：{{details}}',
        deliverable_hint: '方案文档（需人工审批）',
      },
      {
        id: 'deliver',
        name: '执行交付与汇总',
        role_hint: '执行专员 / 研发',
        template_key_hint: '',
        parallel_group: null,
        approval_required: false,
        prompt_template: '请按已确认方案完成「{{task_title}}」的交付产出并整理总结。\n前置阶段输出：{{previous_outputs}}',
        deliverable_hint: '最终交付物与总结报告',
      },
    ],
    deliverables_checklist: [],
  }
}

export function playbookItemToForm(
  pb: PlaybookItem,
  { asClone = false }: { asClone?: boolean } = {},
): PlaybookEditorFormData {
  return {
    key: asClone ? `${pb.key.slice(0, 50)}-custom` : pb.key,
    name: asClone ? `${pb.name} (自定义)` : pb.name,
    category: (pb.category as PlaybookEditorFormData['category']) || 'custom',
    description: pb.description || '',
    enabled: pb.enabled,
    estimated_manual_hours: pb.estimated_manual_hours || 4,
    input_fields: (pb.input_fields || []).map((f) => ({
      ...f,
      options: Array.isArray(f.options) ? [...f.options] : [],
    })),
    stages: (pb.stages || []).map((s) => ({
      ...s,
      parallel_group: s.parallel_group || null,
    })),
    deliverables_checklist: [...(pb.deliverables_checklist || [])],
  }
}

export function PlaybookEditorDialog({
  open,
  editing,
  initialForm,
  templates,
  onClose,
  onSaved,
  notify,
}: {
  open: boolean
  editing: PlaybookItem | null
  initialForm: PlaybookEditorFormData | null
  templates: TemplateItem[]
  onClose: () => void
  onSaved: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<PlaybookEditorFormData>(createEmptyForm)
  const [checklistText, setChecklistText] = useState('')
  const [aiGoal, setAiGoal] = useState('')
  const [generatingAi, setGeneratingAi] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const next = initialForm
      ? initialForm
      : editing
        ? playbookItemToForm(editing)
        : createEmptyForm()
    setForm(next)
    setChecklistText((next.deliverables_checklist || []).join('\n'))
    setAiGoal('')
  }, [open, editing, initialForm])

  const handleAiGenerate = async () => {
    if (aiGoal.trim().length < 4) {
      notify(t('playbooks.aiGoalTooShort'), 'error')
      return
    }
    setGeneratingAi(true)
    try {
      const res = await apiFetch<{
        draft: PlaybookEditorFormData
        model: string
        profile_name: string
      }>('/api/playbooks/ai-draft', {
        method: 'POST',
        body: JSON.stringify({
          goal: aiGoal.trim(),
          category: form.category !== 'custom' ? form.category : null,
        }),
      })
      const d = res.draft
      setForm({
        key: d.key || '',
        name: d.name || '',
        category: d.category || 'custom',
        description: d.description || '',
        enabled: true,
        estimated_manual_hours: Number(d.estimated_manual_hours) || 4,
        input_fields: Array.isArray(d.input_fields) ? d.input_fields : [],
        stages: Array.isArray(d.stages) && d.stages.length > 0 ? d.stages : [DEFAULT_STAGE(0)],
        deliverables_checklist: Array.isArray(d.deliverables_checklist)
          ? d.deliverables_checklist
          : [],
      })
      setChecklistText((d.deliverables_checklist || []).join('\n'))
      notify(t('playbooks.aiDraftReady', { model: res.model || res.profile_name }))
    } catch (err: any) {
      notify(err.message || t('admin.loadFailed'), 'error')
    } finally {
      setGeneratingAi(false)
    }
  }

  const updateField = (idx: number, patch: Partial<PlaybookInputField>) => {
    setForm((prev) => ({
      ...prev,
      input_fields: prev.input_fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    }))
  }

  const removeField = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      input_fields: prev.input_fields.filter((_, i) => i !== idx),
    }))
  }

  const updateStage = (idx: number, patch: Partial<PlaybookStageSpec>) => {
    setForm((prev) => ({
      ...prev,
      stages: prev.stages.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }))
  }

  const moveStage = (idx: number, delta: -1 | 1) => {
    setForm((prev) => {
      const target = idx + delta
      if (target < 0 || target >= prev.stages.length) return prev
      const next = [...prev.stages]
      const [item] = next.splice(idx, 1)
      next.splice(target, 0, item)
      return { ...prev, stages: next }
    })
  }

  const duplicateStage = (idx: number) => {
    setForm((prev) => {
      if (prev.stages.length >= 12) return prev
      const src = prev.stages[idx]
      const copy: PlaybookStageSpec = {
        ...src,
        id: `${src.id}_copy`,
        name: `${src.name} (2)`,
      }
      const next = [...prev.stages]
      next.splice(idx + 1, 0, copy)
      return { ...prev, stages: next }
    })
  }

  const removeStage = (idx: number) => {
    setForm((prev) => {
      if (prev.stages.length <= 1) return prev
      return { ...prev, stages: prev.stages.filter((_, i) => i !== idx) }
    })
  }

  const insertVariableIntoStage = (idx: number, varName: string) => {
    setForm((prev) => ({
      ...prev,
      stages: prev.stages.map((s, i) => {
        if (i !== idx) return s
        const token = `{{${varName}}}`
        const sep = s.prompt_template && !/\s$/.test(s.prompt_template) ? ' ' : ''
        return { ...s, prompt_template: `${s.prompt_template}${sep}${token}` }
      }),
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    if (form.stages.length === 0) {
      notify(t('playbooks.editorNeedStage'), 'error')
      return
    }
    setSaving(true)
    try {
      const seenFieldKeys = new Set<string>()
      const cleanFields: PlaybookInputField[] = form.input_fields
        .filter((f) => f.label.trim() || f.key.trim())
        .map((f, idx) => {
          let fk = slugifyId(f.key || f.label, `field_${idx + 1}`, '_')
          while (seenFieldKeys.has(fk)) fk = `${fk}_${idx + 1}`
          seenFieldKeys.add(fk)
          return {
            key: fk,
            label: (f.label || fk).trim(),
            type: f.type,
            required: Boolean(f.required),
            placeholder: (f.placeholder || '').trim(),
            options:
              f.type === 'select'
                ? (f.options || []).map((o) => o.trim()).filter(Boolean)
                : [],
          }
        })

      const seenStageIds = new Set<string>()
      const cleanStages: PlaybookStageSpec[] = form.stages.map((s, idx) => {
        let sid = slugifyId(s.id || s.name, `stage_${idx + 1}`, '_')
        while (seenStageIds.has(sid)) sid = `${sid}_${idx + 1}`
        seenStageIds.add(sid)
        const sname = (s.name || `阶段 ${idx + 1}`).trim()
        return {
          id: sid,
          name: sname,
          role_hint: (s.role_hint || '').trim(),
          template_key_hint: (s.template_key_hint || '').trim(),
          parallel_group: (s.parallel_group || '').trim() || null,
          approval_required: Boolean(s.approval_required),
          prompt_template: (s.prompt_template || sname).trim(),
          deliverable_hint: (s.deliverable_hint || '').trim(),
        }
      })

      const cleanChecklist = checklistText
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)

      if (editing) {
        await apiFetch(`/api/playbooks/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: form.name.trim(),
            category: form.category,
            description: form.description.trim() || null,
            enabled: form.enabled,
            estimated_manual_hours: Number(form.estimated_manual_hours) || 4,
            input_fields: cleanFields,
            stages: cleanStages,
            deliverables_checklist: cleanChecklist,
          }),
        })
        notify(t('playbooks.editorUpdated'))
      } else {
        const rawKey = form.key.trim().toLowerCase()
        await apiFetch('/api/playbooks', {
          method: 'POST',
          body: JSON.stringify({
            key: rawKey || null,
            name: form.name.trim(),
            category: form.category,
            description: form.description.trim() || null,
            enabled: form.enabled,
            estimated_manual_hours: Number(form.estimated_manual_hours) || 4,
            input_fields: cleanFields,
            stages: cleanStages,
            deliverables_checklist: cleanChecklist,
          }),
        })
        notify(t('playbooks.editorCreated'))
      }
      onClose()
      await onSaved()
    } catch (err: any) {
      notify(err.message || t('admin.loadFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const variableChips = [
    ...form.input_fields
      .filter((f) => f.type !== 'file' && (f.key.trim() || f.label.trim()))
      .map((f, idx) => ({
        key: slugifyId(f.key || f.label, `field_${idx + 1}`, '_'),
        label: f.label.trim() || f.key.trim(),
      })),
    { key: 'previous_outputs', label: t('playbooks.varPrevOutputs') },
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !saving && !generatingAi && onClose()}
      title={
        editing
          ? t('playbooks.editorEditTitle', { name: editing.name })
          : t('playbooks.editorCreateTitle')
      }
      maxWidth="max-w-4xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5 text-sm">
        {/* AI One-Sentence Draft Generator (Create / Clone mode) */}
        {!editing && (
          <div className="rounded-[var(--brand-radius-md)] border border-indigo-500/35 bg-indigo-950/20 p-3.5 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-300">
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              <span>{t('playbooks.aiDraftTitle')}</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                className="flex-1 h-9 text-xs"
                placeholder={t('playbooks.aiDraftPlaceholder')}
                value={aiGoal}
                onChange={(e) => setAiGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleAiGenerate()
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-indigo-500/50 text-indigo-200 hover:bg-indigo-500/20 whitespace-nowrap"
                disabled={generatingAi || aiGoal.trim().length < 4}
                onClick={() => void handleAiGenerate()}
              >
                {generatingAi ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generatingAi ? t('playbooks.aiDraftGenerating') : t('playbooks.aiDraftBtn')}
              </Button>
            </div>
          </div>
        )}

        {/* Section 1: Basic Info */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-5 space-y-1.5">
            <Label>{t('playbooks.editorNameLabel')} *</Label>
            <Input
              required
              placeholder={t('playbooks.editorNamePlaceholder')}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-3 space-y-1.5">
            <Label>{t('playbooks.editorCategoryLabel')}</Label>
            <Select
              value={form.category}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  category: e.target.value as PlaybookEditorFormData['category'],
                }))
              }
            >
              <option value="engineering">engineering</option>
              <option value="analytics">analytics</option>
              <option value="legal">legal</option>
              <option value="operations">operations</option>
              <option value="custom">custom</option>
            </Select>
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label>{t('playbooks.editorHoursLabel')}</Label>
            <Input
              type="number"
              min={0.5}
              max={500}
              step={0.5}
              value={form.estimated_manual_hours}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  estimated_manual_hours: Number(e.target.value) || 1,
                }))
              }
            />
          </div>
          <div className="sm:col-span-2 flex items-end pb-2">
            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
                className="rounded border-zinc-700 accent-indigo-500"
              />
              <span>{t('playbooks.editorEnabledLabel')}</span>
            </label>
          </div>

          <div className="sm:col-span-8 space-y-1.5">
            <Label>{t('playbooks.editorDescLabel')}</Label>
            <Input
              placeholder={t('playbooks.editorDescPlaceholder')}
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-4 space-y-1.5">
            <Label>{t('playbooks.editorKeyLabel')}</Label>
            <Input
              disabled={Boolean(editing)}
              className="font-mono text-xs"
              placeholder={t('playbooks.editorKeyPlaceholder')}
              value={form.key}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                }))
              }
            />
          </div>
        </div>

        {/* Section 2: Input Fields */}
        <div className="space-y-2.5 rounded-[var(--brand-radius-md)] border border-zinc-800/90 bg-zinc-950/50 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-zinc-200">
                {t('playbooks.editorInputsTitle')}
              </div>
              <div className="text-[11px] text-zinc-500">{t('playbooks.editorInputsHint')}</div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() =>
                setForm((p) => ({
                  ...p,
                  input_fields: [...p.input_fields, DEFAULT_FIELD(p.input_fields.length)],
                }))
              }
            >
              <Plus className="h-3.5 w-3.5" />
              {t('playbooks.editorAddInputBtn')}
            </Button>
          </div>

          {form.input_fields.length === 0 ? (
            <p className="text-xs text-zinc-500 py-2 text-center">
              {t('playbooks.editorInputsEmpty')}
            </p>
          ) : (
            <div className="space-y-2">
              {form.input_fields.map((field, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center rounded border border-zinc-800/70 bg-zinc-900/40 p-2"
                >
                  <Input
                    className="sm:col-span-3 h-8 text-xs"
                    placeholder={t('playbooks.editorFieldLabelPh')}
                    value={field.label}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                  />
                  <Input
                    className="sm:col-span-3 h-8 text-xs font-mono"
                    placeholder="field_key"
                    value={field.key}
                    onChange={(e) =>
                      updateField(idx, {
                        key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                      })
                    }
                  />
                  <Select
                    className="sm:col-span-2 h-8 text-xs"
                    value={field.type}
                    onChange={(e) =>
                      updateField(idx, {
                        type: e.target.value as PlaybookInputField['type'],
                      })
                    }
                  >
                    <option value="text">{t('playbooks.fieldTypeText')}</option>
                    <option value="textarea">{t('playbooks.fieldTypeTextarea')}</option>
                    <option value="select">{t('playbooks.fieldTypeSelect')}</option>
                    <option value="file">{t('playbooks.fieldTypeFile')}</option>
                  </Select>
                  {field.type === 'select' ? (
                    <Input
                      className="sm:col-span-2 h-8 text-xs"
                      placeholder={t('playbooks.editorFieldOptionsPh')}
                      value={(field.options || []).join(',')}
                      onChange={(e) =>
                        updateField(idx, {
                          options: e.target.value.split(/[,，]/).map((x) => x.trim()),
                        })
                      }
                    />
                  ) : (
                    <Input
                      className="sm:col-span-2 h-8 text-xs"
                      placeholder={t('playbooks.editorFieldPlaceholderPh')}
                      value={field.placeholder || ''}
                      onChange={(e) => updateField(idx, { placeholder: e.target.value })}
                    />
                  )}
                  <div className="sm:col-span-2 flex items-center justify-between gap-1">
                    <label className="flex items-center gap-1 text-[11px] text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(field.required)}
                        onChange={(e) => updateField(idx, { required: e.target.checked })}
                        className="rounded border-zinc-700 accent-indigo-500"
                      />
                      <span>{t('playbooks.editorFieldReq')}</span>
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-zinc-500 hover:text-rose-400"
                      onClick={() => removeField(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 3: Stage Pipeline */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-zinc-200">
                {t('playbooks.editorStagesTitle')} ({form.stages.length})
              </div>
              <div className="text-[11px] text-zinc-500">{t('playbooks.editorStagesHint')}</div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={form.stages.length >= 12}
              onClick={() =>
                setForm((p) => ({
                  ...p,
                  stages: [...p.stages, DEFAULT_STAGE(p.stages.length)],
                }))
              }
            >
              <Plus className="h-3.5 w-3.5" />
              {t('playbooks.editorAddStageBtn')}
            </Button>
          </div>

          <div className="space-y-3">
            {form.stages.map((st, idx) => (
              <div
                key={idx}
                className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[11px] font-mono flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-medium text-zinc-200">
                      {st.name.trim() || t('playbooks.editorStageUntitled', { n: idx + 1 })}
                    </span>
                    {st.approval_required && (
                      <Badge variant="warning" className="text-[10px]">
                        <ShieldCheck className="h-3 w-3 mr-0.5" />
                        {t('playbooks.approvalGate')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={idx === 0}
                      onClick={() => moveStage(idx, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={idx === form.stages.length - 1}
                      onClick={() => moveStage(idx, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={form.stages.length >= 12}
                      onClick={() => duplicateStage(idx)}
                      title={t('playbooks.cloneBtn')}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-zinc-500 hover:text-rose-400"
                      disabled={form.stages.length <= 1}
                      onClick={() => removeStage(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-4 space-y-1">
                    <Label className="text-[11px] text-zinc-400">
                      {t('playbooks.editorStageName')} *
                    </Label>
                    <Input
                      required
                      className="h-8 text-xs"
                      placeholder={t('playbooks.editorStageNamePh')}
                      value={st.name}
                      onChange={(e) => updateStage(idx, { name: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-3 space-y-1">
                    <Label className="text-[11px] text-zinc-400">
                      {t('playbooks.editorStageRole')}
                    </Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder={t('playbooks.editorStageRolePh')}
                      value={st.role_hint || ''}
                      onChange={(e) => updateStage(idx, { role_hint: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-3 space-y-1">
                    <Label className="text-[11px] text-zinc-400">
                      {t('playbooks.editorStageTemplate')}
                    </Label>
                    <Select
                      className="h-8 text-xs"
                      value={st.template_key_hint || ''}
                      onChange={(e) => {
                        const key = e.target.value
                        const matched = templates.find((tpl) => tpl.key === key)
                        updateStage(idx, {
                          template_key_hint: key,
                          ...(matched && !(st.role_hint || '').trim()
                            ? { role_hint: matched.role_title || matched.name }
                            : {}),
                        })
                      }}
                    >
                      <option value="">{t('playbooks.autoAssign')}</option>
                      {templates.map((tpl) => (
                        <option key={tpl.key} value={tpl.key}>
                          {tpl.role_title || tpl.name} ({tpl.key})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="sm:col-span-2 flex items-end pb-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateStage(idx, { approval_required: !st.approval_required })
                      }
                      className={cn(
                        'w-full h-8 inline-flex items-center justify-center gap-1 rounded-[var(--brand-radius-sm)] border text-xs transition-colors cursor-pointer whitespace-nowrap px-2',
                        st.approval_required
                          ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200',
                      )}
                    >
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                      <span>{t('playbooks.editorApprovalToggle')}</span>
                    </button>
                  </div>

                  <div className="sm:col-span-8 space-y-1">
                    <Label className="text-[11px] text-zinc-400">
                      {t('playbooks.editorStageDeliverable')}
                    </Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder={t('playbooks.editorStageDeliverablePh')}
                      value={st.deliverable_hint || ''}
                      onChange={(e) => updateStage(idx, { deliverable_hint: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-4 space-y-1">
                    <Label className="text-[11px] text-zinc-400">
                      {t('playbooks.editorStageParallel')}
                    </Label>
                    <Input
                      className="h-8 text-xs font-mono"
                      placeholder={t('playbooks.editorStageParallelPh')}
                      value={st.parallel_group || ''}
                      onChange={(e) =>
                        updateStage(idx, { parallel_group: e.target.value.trim() || null })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <Label className="text-[11px] text-zinc-400">
                      {t('playbooks.editorStagePrompt')} *
                    </Label>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-zinc-500">
                        {t('playbooks.editorInsertVar')}:
                      </span>
                      {variableChips.map((vc) => (
                        <button
                          key={vc.key}
                          type="button"
                          onClick={() => insertVariableIntoStage(idx, vc.key)}
                          className="rounded border border-zinc-700/80 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-500/50 cursor-pointer"
                          title={vc.label}
                        >
                          {`{{${vc.key}}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Textarea
                    required
                    rows={3}
                    className="text-xs leading-relaxed"
                    placeholder={t('playbooks.editorStagePromptPh')}
                    value={st.prompt_template}
                    onChange={(e) => updateStage(idx, { prompt_template: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4: Deliverables Checklist */}
        <div className="space-y-1.5">
          <Label>{t('playbooks.editorChecklistLabel')}</Label>
          <Textarea
            rows={2}
            className="text-xs"
            placeholder={t('playbooks.editorChecklistPh')}
            value={checklistText}
            onChange={(e) => setChecklistText(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={saving || generatingAi}>
            {saving ? t('common.saving') : t('playbooks.editorSaveBtn')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
