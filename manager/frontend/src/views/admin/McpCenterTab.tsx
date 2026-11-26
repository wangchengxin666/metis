import { useMemo, useState } from 'react'
import {
  Cpu,
  Edit3,
  Globe,
  KeyRound,
  Plus,
  Search,
  Send,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
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
import type { McpServerItem, SandboxItem, TemplateItem } from '../../types'

interface McpFormState {
  slug: string
  name: string
  description: string
  category: string
  transport: 'stdio' | 'streamable-http'
  command: string
  argsText: string
  envJson: string
  cwd: string
  url: string
  headersJson: string
  tool_loading: 'eager' | 'on-demand'
  enabled: boolean
}

const EMPTY_MCP_FORM: McpFormState = {
  slug: '',
  name: '',
  description: '',
  category: 'custom',
  transport: 'stdio',
  command: 'npx',
  argsText: '',
  envJson: '{}',
  cwd: '',
  url: '',
  headersJson: '{}',
  tool_loading: 'eager',
  enabled: true,
}

export function McpCenterTab({
  mcpServers,
  sandboxes,
  templates = [],
  onRefresh,
  notify,
}: {
  mcpServers: McpServerItem[]
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
  const [editing, setEditing] = useState<McpServerItem | null>(null)
  const [form, setForm] = useState<McpFormState>(EMPTY_MCP_FORM)
  const [saving, setSaving] = useState(false)

  const [importOpen, setImportOpen] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importOverwrite, setImportOverwrite] = useState(false)
  const [importing, setImporting] = useState(false)

  const [pushItems, setPushItems] = useState<McpServerItem[] | null>(null)

  const categories = useMemo(() => {
    const cats = new Set(mcpServers.map((s) => s.category || 'custom'))
    return ['all', ...Array.from(cats).sort()]
  }, [mcpServers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return mcpServers.filter((srv) => {
      if (catFilter !== 'all' && (srv.category || 'custom') !== catFilter) return false
      if (!q) return true
      return [srv.slug, srv.name, srv.description, srv.command, srv.url]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [mcpServers, search, catFilter])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_MCP_FORM)
    setModalOpen(true)
  }

  const openEdit = (srv: McpServerItem) => {
    setEditing(srv)
    setForm({
      slug: srv.slug,
      name: srv.name,
      description: srv.description || '',
      category: srv.category || 'custom',
      transport: srv.transport,
      command: srv.command || 'npx',
      argsText: (srv.args || []).join(' '),
      envJson: JSON.stringify(srv.env || {}, null, 2),
      cwd: srv.cwd || '',
      url: srv.url || '',
      headersJson: JSON.stringify(srv.headers || {}, null, 2),
      tool_loading: srv.tool_loading || 'eager',
      enabled: srv.enabled,
    })
    setModalOpen(true)
  }

  const handleSeedBuiltins = async () => {
    setSeeding(true)
    try {
      await apiFetch('/api/mcp-servers/seed-builtins', { method: 'POST' })
      notify(t('admin.mcp.seeded'))
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
      const envObj = JSON.parse(form.envJson.trim() || '{}')
      const headersObj = JSON.parse(form.headersJson.trim() || '{}')
      const argsList = form.argsText
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean)
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category || 'custom',
        transport: form.transport,
        tool_loading: form.tool_loading,
        enabled: form.enabled,
      }
      if (form.transport === 'stdio') {
        body.command = form.command.trim()
        body.args = argsList
        body.env = envObj
        body.cwd = form.cwd.trim() || null
      } else {
        body.url = form.url.trim()
        body.headers = headersObj
      }
      if (editing) {
        await apiFetch(`/api/mcp-servers/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      } else {
        await apiFetch('/api/mcp-servers', {
          method: 'POST',
          body: JSON.stringify({ slug: form.slug.trim(), ...body }),
        })
      }
      notify(t('admin.mcp.saved'))
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
    if (!importJson.trim()) return
    setImporting(true)
    try {
      const imported = await apiFetch<McpServerItem[]>('/api/mcp-servers/import', {
        method: 'POST',
        body: JSON.stringify({ content: importJson, overwrite: importOverwrite }),
      })
      notify(t('admin.mcp.imported', { count: imported.length }))
      setImportOpen(false)
      setImportJson('')
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
        ? `/api/mcp-servers/${pushItems[0].id}/push`
        : '/api/mcp-servers/batch-push'
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
        ? t('admin.mcp.removed', { synced: res.synced, total: res.total })
        : t('admin.mcp.pushed', { synced: res.synced, total: res.total }),
    )
    setSelectedIds([])
    await onRefresh()
    return res
  }

  const alreadyPushedUnion = useMemo(() => {
    if (!pushItems || pushItems.length !== 1) return []
    return pushItems[0].pushed_sandbox_ids || []
  }, [pushItems])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--brand-radius-md)] border border-zinc-800/90 bg-zinc-900/65 px-5 py-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-indigo-400 shrink-0" />
            <h3 className="text-base font-semibold text-zinc-100">{t('admin.mcp.title')}</h3>
            <Badge variant="outline">{mcpServers.length}</Badge>
          </div>
          <p className="text-xs text-zinc-400">{t('admin.mcp.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.length > 0 && (
            <Button
              type="button"
              size="sm"
              disabled={sandboxes.length === 0}
              onClick={() =>
                setPushItems(mcpServers.filter((m) => selectedIds.includes(m.id)))
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
            {t('admin.mcp.seedBtn')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-4 w-4" />
            {t('admin.mcp.importBtn')}
          </Button>
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('admin.mcp.addBtn')}
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
            placeholder={t('admin.mcp.searchPlaceholder')}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* MCP Cards Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((srv) => {
          const checked = selectedIds.includes(srv.id)
          const previewCmd =
            srv.transport === 'streamable-http'
              ? srv.url || ''
              : [srv.command, ...(srv.args || [])].filter(Boolean).join(' ')
          return (
            <Card
              key={srv.id}
              className={cn(
                'flex flex-col justify-between transition-colors',
                checked && 'border-indigo-500/60',
              )}
            >
              <CardHeader className="pb-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedIds((prev) =>
                          e.target.checked
                            ? [...prev, srv.id]
                            : prev.filter((id) => id !== srv.id),
                        )
                      }
                      className="mt-1 rounded border-zinc-600 accent-indigo-500 shrink-0 cursor-pointer"
                    />
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
                      {srv.transport === 'streamable-http' ? (
                        <Globe className="h-4 w-4 text-cyan-400" />
                      ) : (
                        <Terminal className="h-4 w-4 text-indigo-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="truncate">{srv.name}</CardTitle>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <code className="font-mono text-[11px] text-zinc-400">{srv.slug}</code>
                        <Badge variant={srv.transport === 'streamable-http' ? 'default' : 'outline'}>
                          {srv.transport}
                        </Badge>
                        {srv.is_builtin && (
                          <Badge variant="secondary" className="text-[10px]">
                            {t('cap.builtinBadge')}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs flex-1 flex flex-col justify-between">
                <div className="space-y-2">
                  {srv.description && (
                    <p className="text-zinc-300 leading-relaxed">{srv.description}</p>
                  )}
                  <div className="rounded-md border border-zinc-800/80 bg-zinc-950/70 px-2.5 py-1.5 font-mono text-[11px] text-zinc-400 truncate">
                    {previewCmd}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {srv.category}
                    </Badge>
                    {!srv.enabled && (
                      <Badge variant="warning" className="text-[10px]">
                        disabled
                      </Badge>
                    )}
                    {(srv.required_credentials || []).map((cred) => (
                      <Badge
                        key={cred}
                        variant="outline"
                        className="border-amber-500/40 text-amber-300 font-mono text-[10px]"
                      >
                        <KeyRound className="h-2.5 w-2.5 mr-1" />
                        {cred}
                      </Badge>
                    ))}
                    {srv.pushed_sandbox_ids.length > 0 && (
                      <Badge variant="success" className="text-[10px]">
                        {t('cap.pushedCountBadge', { count: srv.pushed_sandbox_ids.length })}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/70">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sandboxes.length === 0}
                    onClick={() => setPushItems([srv])}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {t('cap.push.pushToEmployeesBtn')}
                  </Button>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(srv)}>
                      <Edit3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-rose-400 hover:text-rose-300"
                      onClick={async () => {
                        try {
                          await apiFetch(`/api/mcp-servers/${srv.id}`, { method: 'DELETE' })
                          notify(t('admin.mcp.deleted'))
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

      {/* Create / Edit MCP Modal */}
      <Dialog
        open={modalOpen}
        onOpenChange={(o) => !o && !saving && setModalOpen(false)}
        title={editing ? t('admin.mcp.editTitle') : t('admin.mcp.addBtn')}
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleSave} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('admin.mcp.slugLabel')}</Label>
              <Input
                required
                disabled={!!editing}
                placeholder="e.g. github or custom-api"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.mcp.nameLabel')}</Label>
              <Input
                required
                placeholder="e.g. GitHub 协作 MCP"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>{t('admin.mcp.transportLabel')}</Label>
              <Select
                value={form.transport}
                onChange={(e) =>
                  setForm({
                    ...form,
                    transport: e.target.value as 'stdio' | 'streamable-http',
                  })
                }
              >
                <option value="stdio">stdio</option>
                <option value="streamable-http">streamable-http</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('cap.categoryLabel')}</Label>
              <Select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option value="dev">dev</option>
                <option value="web">web</option>
                <option value="knowledge">knowledge</option>
                <option value="reasoning">reasoning</option>
                <option value="data">data</option>
                <option value="utility">utility</option>
                <option value="custom">custom</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.mcp.toolLoadingLabel')}</Label>
              <Select
                value={form.tool_loading}
                onChange={(e) =>
                  setForm({
                    ...form,
                    tool_loading: e.target.value as 'eager' | 'on-demand',
                  })
                }
              >
                <option value="eager">eager</option>
                <option value="on-demand">on-demand</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('admin.mcp.descLabel')}</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          {form.transport === 'stdio' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Command *</Label>
                  <Input
                    required
                    placeholder="npx / uvx / node"
                    value={form.command}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t('admin.mcp.argsLabel')}</Label>
                  <Input
                    placeholder="-y @modelcontextprotocol/server-memory"
                    value={form.argsText}
                    onChange={(e) => setForm({ ...form, argsText: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('admin.mcp.envLabel')}</Label>
                <Textarea
                  rows={3}
                  className="font-mono text-xs"
                  placeholder='{"GITHUB_PERSONAL_ACCESS_TOKEN":"${credential:GITHUB_TOKEN}"}'
                  value={form.envJson}
                  onChange={(e) => setForm({ ...form, envJson: e.target.value })}
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Endpoint URL *</Label>
                <Input
                  required
                  placeholder="https://mcp.example.com/mcp"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('admin.mcp.headersLabel')}</Label>
                <Textarea
                  rows={3}
                  className="font-mono text-xs"
                  placeholder='{"Authorization":"Bearer ${credential:API_KEY}"}'
                  value={form.headersJson}
                  onChange={(e) => setForm({ ...form, headersJson: e.target.value })}
                />
              </div>
            </>
          )}

          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="rounded border-zinc-700 accent-indigo-500"
            />
            {t('admin.mcp.enabledLabel')}
          </label>

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

      {/* JSON Import Modal */}
      <Dialog
        open={importOpen}
        onOpenChange={(o) => !o && !importing && setImportOpen(false)}
        title={t('admin.mcp.importTitle')}
        description={t('admin.mcp.importDesc')}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleImport} className="space-y-4 text-sm">
          <Textarea
            required
            rows={8}
            className="font-mono text-xs"
            placeholder='{"mcpServers":{"my-tool":{"command":"npx","args":["-y","my-mcp-server"]}}}'
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
          />
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
              {importing ? t('common.saving') : t('admin.mcp.importSubmitBtn')}
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
        description={t('admin.mcp.pushDialogDesc')}
        sandboxes={sandboxes}
        templates={templates}
        alreadyPushedIds={alreadyPushedUnion}
        allowRemove={true}
        onConfirm={handlePushConfirm}
      />
    </div>
  )
}
