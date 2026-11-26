import { useMemo, useState } from 'react'
import {
  BookOpen,
  Download,
  Edit3,
  FileArchive,
  FileText,
  FolderOpen,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { PushTargetDialog, type PushTargetSpec } from '../../components/PushTargetDialog'
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
import type { SandboxItem, SkillItem, TemplateItem } from '../../types'

interface ResourceDraftRow {
  path: string
  content: string
}

interface SkillFormState {
  slug: string
  name: string
  category: string
  description: string
  when_to_use: string
  content: string
  extra_files: ResourceDraftRow[]
  disable_model_invocation: boolean
  user_invocable: boolean
}

const EMPTY_SKILL_FORM: SkillFormState = {
  slug: '',
  name: '',
  category: 'custom',
  description: '',
  when_to_use: '',
  content: '# Skill Instructions\n\n',
  extra_files: [],
  disable_model_invocation: false,
  user_invocable: true,
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function encodeUploadedResource(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const hasNull = bytes.includes(0)
  if (!hasNull) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      // Binary content falls through to base64 encoding
    }
  }
  return `base64:${arrayBufferToBase64(buf)}`
}

export function SkillsCenterTab({
  skills,
  sandboxes,
  templates = [],
  onRefresh,
  notify,
}: {
  skills: SkillItem[]
  sandboxes: SandboxItem[]
  templates?: TemplateItem[]
  onRefresh: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [seeding, setSeeding] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<SkillItem | null>(null)
  const [form, setForm] = useState<SkillFormState>(EMPTY_SKILL_FORM)
  const [expandedResourceIdx, setExpandedResourceIdx] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const [importOpen, setImportOpen] = useState(false)
  const [importMode, setImportMode] = useState<'zip' | 'md'>('zip')
  const [importZipFile, setImportZipFile] = useState<File | null>(null)
  const [importMarkdown, setImportMarkdown] = useState('')
  const [importName, setImportName] = useState('')
  const [importCategory, setImportCategory] = useState('custom')
  const [importOverwrite, setImportOverwrite] = useState(false)
  const [importing, setImporting] = useState(false)

  const [pushItems, setPushItems] = useState<SkillItem[] | null>(null)

  const categories = useMemo(() => {
    const cats = new Set(skills.map((s) => s.category || 'custom'))
    return ['all', ...Array.from(cats).sort()]
  }, [skills])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return skills.filter((sk) => {
      if (catFilter !== 'all' && (sk.category || 'custom') !== catFilter) return false
      if (!q) return true
      return [sk.slug, sk.name, sk.description, sk.when_to_use]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [skills, search, catFilter])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_SKILL_FORM)
    setExpandedResourceIdx(null)
    setModalOpen(true)
  }

  const openEdit = (sk: SkillItem) => {
    setEditing(sk)
    const resourceRows: ResourceDraftRow[] = Object.entries(sk.extra_files || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => ({ path, content }))
    setForm({
      slug: sk.slug,
      name: sk.name,
      category: sk.category || 'custom',
      description: sk.description,
      when_to_use: sk.when_to_use || '',
      content: sk.content,
      extra_files: resourceRows,
      disable_model_invocation: sk.disable_model_invocation,
      user_invocable: sk.user_invocable,
    })
    setExpandedResourceIdx(resourceRows.length > 0 ? 0 : null)
    setModalOpen(true)
  }

  const handleSeedBuiltins = async () => {
    setSeeding(true)
    try {
      await apiFetch('/api/skills/seed-builtins', { method: 'POST' })
      notify(t('admin.skills.seeded'))
      await onRefresh()
    } catch (err: any) {
      notify(err.message || 'Seed failed', 'error')
    } finally {
      setSeeding(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const extraMap: Record<string, string> = {}
      for (const row of form.extra_files) {
        const cleanPath = row.path.trim()
        if (cleanPath) extraMap[cleanPath] = row.content
      }
      const body = {
        name: form.name.trim(),
        category: form.category || 'custom',
        description: form.description.trim(),
        when_to_use: form.when_to_use.trim() || null,
        content: form.content,
        extra_files: extraMap,
        disable_model_invocation: form.disable_model_invocation,
        user_invocable: form.user_invocable,
      }
      if (editing) {
        await apiFetch(`/api/skills/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      } else {
        await apiFetch('/api/skills', {
          method: 'POST',
          body: JSON.stringify({ slug: form.slug.trim(), ...body }),
        })
      }
      notify(t('admin.skills.saved'))
      setModalOpen(false)
      await onRefresh()
    } catch (err: any) {
      notify(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (importMode === 'zip') {
      if (!importZipFile) {
        notify(t('admin.skills.zipSelectRequired'), 'error')
        return
      }
      setImporting(true)
      try {
        const fd = new FormData()
        fd.append('file', importZipFile)
        if (importName.trim()) fd.append('name', importName.trim())
        fd.append('category', importCategory || 'custom')
        fd.append('overwrite', String(importOverwrite))
        await apiFetch('/api/skills/import-zip', {
          method: 'POST',
          body: fd,
        })
        notify(t('admin.skills.imported'))
        setImportOpen(false)
        setImportZipFile(null)
        setImportName('')
        await onRefresh()
      } catch (err: any) {
        notify(err.message || 'ZIP import failed', 'error')
      } finally {
        setImporting(false)
      }
      return
    }

    if (!importMarkdown.trim()) return
    setImporting(true)
    try {
      await apiFetch('/api/skills/import', {
        method: 'POST',
        body: JSON.stringify({
          markdown: importMarkdown,
          name: importName.trim() || null,
          category: importCategory || 'custom',
          overwrite: importOverwrite,
        }),
      })
      notify(t('admin.skills.imported'))
      setImportOpen(false)
      setImportMarkdown('')
      setImportName('')
      await onRefresh()
    } catch (err: any) {
      notify(err.message || 'Import failed', 'error')
    } finally {
      setImporting(false)
    }
  }

  const handlePushConfirm = async (spec: PushTargetSpec) => {
    if (!pushItems || pushItems.length === 0) return
    const endpoint =
      pushItems.length === 1
        ? `/api/skills/${pushItems[0].id}/push`
        : '/api/skills/batch-push'
    const body: Record<string, unknown> = {
      action: spec.action,
    }
    if (pushItems.length > 1) {
      body.item_ids = pushItems.map((i) => i.id)
    }
    if (spec.sandbox_ids) body.sandbox_ids = spec.sandbox_ids
    if (spec.template_keys) body.template_keys = spec.template_keys
    const res = await apiFetch<{
      synced: number
      total: number
      results?: Array<{ slug: string; ok: boolean; skipped?: boolean; detail?: string }>
    }>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    notify(
      spec.action === 'remove'
        ? t('admin.skills.removed', { synced: res.synced, total: res.total })
        : t('admin.skills.pushed', { synced: res.synced, total: res.total }),
    )
    setSelectedIds([])
    await onRefresh()
    return res
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--brand-radius-md)] border border-zinc-800/90 bg-zinc-900/65 px-5 py-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-indigo-400 shrink-0" />
            <h3 className="text-base font-semibold text-zinc-100">{t('admin.skills.title')}</h3>
            <Badge variant="outline">{skills.length}</Badge>
          </div>
          <p className="text-xs text-zinc-400">{t('admin.skills.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.length > 0 && (
            <Button
              type="button"
              size="sm"
              disabled={sandboxes.length === 0}
              onClick={() =>
                setPushItems(skills.filter((sk) => selectedIds.includes(sk.id)))
              }
            >
              <Send className="h-4 w-4" />
              {t('cap.batchPushBtn', { count: selectedIds.length })}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={seeding}
            onClick={() => void handleSeedBuiltins()}
          >
            <Sparkles className="h-4 w-4 text-indigo-400" />
            {t('admin.skills.seedBtn')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-4 w-4" />
            {t('admin.skills.importBtn')}
          </Button>
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('admin.skills.addBtn')}
          </Button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCatFilter(cat)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium border cursor-pointer transition-colors',
                catFilter === cat
                  ? 'brand-tab-active border-transparent'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-100',
              )}
            >
              {cat === 'all' ? t('cap.filterAll') : cat}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.skills.searchPlaceholder')}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Skill Cards Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((sk) => {
          const checked = selectedIds.includes(sk.id)
          const resourceKeys = Object.keys(sk.extra_files || {})
          return (
            <Card
              key={sk.id}
              className={cn(
                'flex flex-col justify-between transition-colors',
                checked && 'border-indigo-500/60',
              )}
            >
              <CardHeader className="pb-2.5">
                <div className="flex items-start gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setSelectedIds((prev) =>
                        e.target.checked
                          ? [...prev, sk.id]
                          : prev.filter((id) => id !== sk.id),
                      )
                    }
                    className="mt-1 rounded border-zinc-600 accent-indigo-500 shrink-0 cursor-pointer"
                  />
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
                    <BookOpen className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{sk.name}</CardTitle>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <code className="font-mono text-[11px] text-zinc-400">{sk.slug}</code>
                      <Badge variant="outline" className="text-[10px]">
                        {sk.category}
                      </Badge>
                      {sk.is_builtin && (
                        <Badge variant="secondary" className="text-[10px]">
                          {t('cap.builtinBadge')}
                        </Badge>
                      )}
                      {resourceKeys.length > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-cyan-500/40 text-cyan-300"
                        >
                          <FolderOpen className="h-2.5 w-2.5 mr-1" />
                          {t('admin.skills.resourcesCountBadge', { count: resourceKeys.length })}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs flex-1 flex flex-col justify-between">
                <div className="space-y-2">
                  <p className="text-zinc-300 leading-relaxed">{sk.description}</p>
                  {sk.when_to_use && (
                    <div className="rounded-md border border-zinc-800/80 bg-zinc-950/60 px-2.5 py-1.5 text-[11px] text-zinc-400 line-clamp-2">
                      {sk.when_to_use}
                    </div>
                  )}
                  {resourceKeys.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {resourceKeys.slice(0, 4).map((rp) => (
                        <code
                          key={rp}
                          className="rounded border border-zinc-800 bg-zinc-950/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 truncate max-w-[180px]"
                        >
                          {rp}
                        </code>
                      ))}
                      {resourceKeys.length > 4 && (
                        <span className="text-[10px] text-zinc-500">+{resourceKeys.length - 4}</span>
                      )}
                    </div>
                  )}
                  {sk.pushed_sandbox_ids.length > 0 && (
                    <div>
                      <Badge variant="success" className="text-[10px]">
                        {t('cap.pushedCountBadge', { count: sk.pushed_sandbox_ids.length })}
                      </Badge>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/70">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sandboxes.length === 0}
                    onClick={() => setPushItems([sk])}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {t('cap.push.pushToEmployeesBtn')}
                  </Button>
                  <div className="flex items-center gap-1">
                    <a
                      href={`/api/skills/${encodeURIComponent(sk.id)}/export`}
                      download={`${sk.slug}.zip`}
                      title={t('admin.skills.exportZipBtn')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(sk)}>
                      <Edit3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-rose-400 hover:text-rose-300"
                      onClick={async () => {
                        try {
                          await apiFetch(`/api/skills/${sk.id}`, { method: 'DELETE' })
                          notify(t('admin.skills.deleted'))
                          await onRefresh()
                        } catch (err: any) {
                          notify(err.message, 'error')
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Create / Edit Skill Modal */}
      <Dialog
        open={modalOpen}
        onOpenChange={(o) => !o && !saving && setModalOpen(false)}
        title={editing ? t('admin.skills.editTitle') : t('admin.skills.addBtn')}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSave} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>{t('admin.skills.slugLabel')}</Label>
              <Input
                required
                disabled={!!editing}
                placeholder="code-review-checklist"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.skills.nameLabel')}</Label>
              <Input
                required
                placeholder="代码审查与 PR 质检"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('cap.categoryLabel')}</Label>
              <Select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option value="engineering">engineering</option>
                <option value="qa">qa</option>
                <option value="devops">devops</option>
                <option value="product">product</option>
                <option value="data">data</option>
                <option value="security">security</option>
                <option value="office">office</option>
                <option value="custom">custom</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('admin.skills.descLabel')}</Label>
            <Input
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('admin.skills.whenToUseLabel')}</Label>
            <Input
              placeholder={t('admin.skills.whenToUsePlaceholder')}
              value={form.when_to_use}
              onChange={(e) => setForm({ ...form, when_to_use: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('admin.skills.contentLabel')}</Label>
            <Textarea
              required
              rows={8}
              className="font-mono text-xs"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </div>

          {/* Bundled Resource Files Manager */}
          <div className="space-y-2 rounded-lg border border-zinc-800/90 bg-zinc-950/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <FolderOpen className="h-3.5 w-3.5 text-cyan-400" />
                <Label>{t('admin.skills.resourcesLabel')}</Label>
                <Badge variant="outline" className="text-[10px]">
                  {form.extra_files.length}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const nextIdx = form.extra_files.length
                    setForm((prev) => ({
                      ...prev,
                      extra_files: [
                        ...prev.extra_files,
                        { path: `references/note-${nextIdx + 1}.md`, content: '' },
                      ],
                    }))
                    setExpandedResourceIdx(nextIdx)
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('admin.skills.addTextResourceBtn')}
                </Button>
                <label className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 cursor-pointer whitespace-nowrap">
                  <Upload className="h-3.5 w-3.5" />
                  {t('admin.skills.uploadResourceBtn')}
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || [])
                      if (files.length === 0) return
                      const added: ResourceDraftRow[] = []
                      for (const f of files) {
                        const encoded = await encodeUploadedResource(f)
                        const lower = f.name.toLowerCase()
                        const prefix = /\.(sh|bash|zsh|py|js|ts|mjs|cjs)$/.test(lower)
                          ? 'scripts'
                          : /\.(md|txt|yaml|yml|json)$/.test(lower)
                            ? 'references'
                            : 'assets'
                        added.push({ path: `${prefix}/${f.name}`, content: encoded })
                      }
                      setForm((prev) => ({
                        ...prev,
                        extra_files: [...prev.extra_files, ...added],
                      }))
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
            </div>

            {form.extra_files.length === 0 ? (
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                {t('admin.skills.noResourcesHint')}
              </p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {form.extra_files.map((row, idx) => {
                  const isBinary = row.content.startsWith('base64:')
                  const expanded = expandedResourceIdx === idx
                  return (
                    <div
                      key={idx}
                      className="rounded border border-zinc-800 bg-zinc-900/70 p-2 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          className="font-mono text-xs h-7 flex-1"
                          placeholder={t('admin.skills.resourcePathPlaceholder')}
                          value={row.path}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              extra_files: prev.extra_files.map((r, i) =>
                                i === idx ? { ...r, path: e.target.value } : r,
                              ),
                            }))
                          }
                        />
                        {!isBinary && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => setExpandedResourceIdx(expanded ? null : idx)}
                          >
                            {expanded ? 'Collapse' : 'Edit'}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-rose-400 hover:text-rose-300"
                          onClick={() => {
                            setForm((prev) => ({
                              ...prev,
                              extra_files: prev.extra_files.filter((_, i) => i !== idx),
                            }))
                            if (expandedResourceIdx === idx) setExpandedResourceIdx(null)
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {isBinary ? (
                        <div className="text-[11px] text-amber-300/90 font-mono">
                          {t('admin.skills.resourceBinaryTag')} ({Math.round((row.content.length - 7) * 0.75)} B)
                        </div>
                      ) : (
                        expanded && (
                          <Textarea
                            rows={5}
                            className="font-mono text-xs"
                            value={row.content}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                extra_files: prev.extra_files.map((r, i) =>
                                  i === idx ? { ...r, content: e.target.value } : r,
                                ),
                              }))
                            }
                          />
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-zinc-300">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.user_invocable}
                onChange={(e) => setForm({ ...form, user_invocable: e.target.checked })}
                className="rounded border-zinc-700 accent-indigo-500"
              />
              {t('admin.skills.userInvocableLabel')}
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.disable_model_invocation}
                onChange={(e) =>
                  setForm({ ...form, disable_model_invocation: e.target.checked })
                }
                className="rounded border-zinc-700 accent-indigo-500"
              />
              {t('admin.skills.disableModelLabel')}
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Import ZIP / SKILL.md Modal */}
      <Dialog
        open={importOpen}
        onOpenChange={(o) => !o && !importing && setImportOpen(false)}
        title={t('admin.skills.importTitle')}
        description={t('admin.skills.importDesc')}
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleImport} className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
            <button
              type="button"
              onClick={() => setImportMode('zip')}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors',
                importMode === 'zip' ? 'brand-tab-active' : 'text-zinc-400 hover:text-zinc-100',
              )}
            >
              <FileArchive className="h-3.5 w-3.5" />
              {t('admin.skills.importModeZip')}
            </button>
            <button
              type="button"
              onClick={() => setImportMode('md')}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors',
                importMode === 'md' ? 'brand-tab-active' : 'text-zinc-400 hover:text-zinc-100',
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              {t('admin.skills.importModeMd')}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('admin.skills.importNameLabel')}</Label>
              <Input
                placeholder={t('admin.skills.importNamePlaceholder')}
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.skills.categoryLabel')}</Label>
              <Select
                value={importCategory}
                onChange={(e) => setImportCategory(e.target.value)}
              >
                <option value="engineering">engineering</option>
                <option value="qa">qa</option>
                <option value="devops">devops</option>
                <option value="product">product</option>
                <option value="data">data</option>
                <option value="security">security</option>
                <option value="office">office</option>
                <option value="custom">custom</option>
              </Select>
            </div>
          </div>

          {importMode === 'zip' ? (
            <div className="space-y-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/60 p-4 text-center">
              <Label className="block text-xs text-zinc-300">{t('admin.skills.zipFileLabel')}</Label>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setImportZipFile(e.target.files?.[0] || null)}
                className="mx-auto block text-xs text-zinc-300 file:mr-3 file:rounded-md file:border file:border-zinc-700 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-100 hover:file:bg-zinc-800 cursor-pointer"
              />
              {importZipFile && (
                <div className="text-xs font-mono text-emerald-300">
                  {importZipFile.name} ({Math.max(1, Math.round(importZipFile.size / 1024))} KB)
                </div>
              )}
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                {t('admin.skills.zipHint')}
              </p>
            </div>
          ) : (
            <Textarea
              required
              rows={9}
              className="font-mono text-xs"
              placeholder={'---\nname: my-skill\ndescription: What this skill does\n---\n\n# Instructions...'}
              value={importMarkdown}
              onChange={(e) => setImportMarkdown(e.target.value)}
            />
          )}

          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={importOverwrite}
              onChange={(e) => setImportOverwrite(e.target.checked)}
              className="rounded border-zinc-700 accent-indigo-500"
            />
            {t('cap.importOverwrite')}
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setImportOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={importing}>
              {importing ? t('common.saving') : t('admin.skills.importSubmitBtn')}
            </Button>
          </div>
        </form>
      </Dialog>

      <PushTargetDialog
        open={!!pushItems}
        onOpenChange={(o) => !o && setPushItems(null)}
        title={
          pushItems && pushItems.length === 1
            ? t('cap.push.dialogTitle', { name: pushItems[0].name })
            : t('cap.push.batchDialogTitle', { count: pushItems?.length ?? 0 })
        }
        description={t('admin.skills.pushDialogDesc')}
        sandboxes={sandboxes}
        templates={templates}
        alreadyPushedIds={
          pushItems && pushItems.length === 1 ? pushItems[0].pushed_sandbox_ids || [] : []
        }
        allowRemove={true}
        onConfirm={handlePushConfirm}
      />
    </div>
  )
}
