import { useState } from 'react'
import { Check, Copy, Download, GitBranch, Globe, Package, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
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
  cn,
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { pickLocalizedText } from '../../lib/i18n.ts'
import { useI18n } from '../../lib/i18nContext'
import type { PluginIndexSource, PluginItem, SandboxItem, TemplateItem } from '../../types'

export interface PluginsRegistryData {
  index_url: string
  npm_registry_url: string
  source_type: string
  auto_install_default: string
  extra_indexes?: PluginIndexSource[]
  items: PluginItem[]
}

export interface PluginsTabProps {
  pluginsData: PluginsRegistryData
  sandboxes: SandboxItem[]
  templates?: TemplateItem[]
  copiedKey: string | null
  onCopy: (key: string, text: string) => void
  onRefresh: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}

export function PluginsTab({
  pluginsData,
  sandboxes,
  templates = [],
  copiedKey,
  onCopy,
  onRefresh,
  notify,
}: PluginsTabProps) {
  const { locale, t } = useI18n()
  const [syncingPlugins, setSyncingPlugins] = useState(false)
  const [addSourceOpen, setAddSourceOpen] = useState(false)
  const [savingSources, setSavingSources] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [syncOnSave, setSyncOnSave] = useState(true)
  const [pushRequest, setPushRequest] = useState<{
    mode: 'market_only' | 'reinstall_builtin' | 'reinstall_selected'
    plugins: string[]
    title: string
  } | null>(null)

  const extraIndexes = pluginsData.extra_indexes ?? []

  const handleSyncPlugins = async (
    mode: 'market_only' | 'reinstall_builtin' | 'reinstall_selected',
    plugins: string[] = [],
    targetSpec?: PushTargetSpec,
  ) => {
    setSyncingPlugins(true)
    try {
      notify(
        mode === 'market_only'
          ? t('admin.pluginsSyncing')
          : t('admin.pluginsReinstalling'),
      )
      const body: Record<string, unknown> = { mode, plugins }
      if (targetSpec?.sandbox_ids) body.sandbox_ids = targetSpec.sandbox_ids
      if (targetSpec?.template_keys) body.template_keys = targetSpec.template_keys
      const res = await apiFetch<{
        synced: number
        results?: Array<{ slug: string; ok: boolean; skipped?: boolean; detail?: string }>
      }>('/api/plugins/sync-sandboxes', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      notify(
        mode === 'market_only'
          ? t('admin.pluginsSynced', { count: res.synced })
          : t('admin.pluginsReinstalled', { count: res.synced }),
      )
      await onRefresh()
      return res
    } catch (err: any) {
      notify(err.message || t('admin.pluginsSyncFailed'), 'error')
      throw err
    } finally {
      setSyncingPlugins(false)
    }
  }

  const persistExtraIndexes = async (
    nextList: Array<{ url: string; label: string; enabled: boolean }>,
    syncNow: boolean,
  ) => {
    setSavingSources(true)
    try {
      const res = await apiFetch<{ synced: number }>('/api/plugins/indexes', {
        method: 'PUT',
        body: JSON.stringify({
          indexes: nextList,
          sync_sandboxes: syncNow,
        }),
      })
      notify(
        syncNow
          ? t('admin.plugins.sourceSavedSynced', { count: res.synced })
          : t('admin.plugins.sourceSaved'),
      )
      await onRefresh()
      return true
    } catch (err: any) {
      notify(err.message || t('admin.plugins.sourceSaveFailed'), 'error')
      return false
    } finally {
      setSavingSources(false)
    }
  }

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newUrl.trim()
    if (!trimmed) return
    const next = [
      ...extraIndexes.map((x) => ({ url: x.url, label: x.label, enabled: x.enabled })),
      { url: trimmed, label: newLabel.trim(), enabled: true },
    ]
    const ok = await persistExtraIndexes(next, syncOnSave)
    if (ok) {
      setNewUrl('')
      setNewLabel('')
      setAddSourceOpen(false)
    }
  }

  const handleRemoveSource = async (urlToRemove: string) => {
    const next = extraIndexes
      .filter((x) => x.url !== urlToRemove)
      .map((x) => ({ url: x.url, label: x.label, enabled: x.enabled }))
    await persistExtraIndexes(next, true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--brand-radius-md)] border border-zinc-800/90 bg-zinc-900/65 px-5 py-4">
        <h3 className="text-base font-semibold text-zinc-100">{t('admin.plugins.title')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddSourceOpen(true)}
          >
            <Plus className="h-4 w-4" />
            {t('admin.plugins.addSourceBtn')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={syncingPlugins}
            onClick={() => handleSyncPlugins('market_only')}
          >
            <RefreshCw className={cn('h-4 w-4', syncingPlugins && 'animate-spin')} />
            {t('admin.plugins.syncBtn')}
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={syncingPlugins || sandboxes.length === 0}
            onClick={() =>
              setPushRequest({
                mode: 'reinstall_builtin',
                plugins: [],
                title: t('admin.plugins.reinstallAllBtn'),
              })
            }
          >
            <Send className="h-4 w-4" />
            {t('admin.plugins.pushToEmployeesBtn')}
          </Button>
        </div>
      </div>

      {/* Compact Plugin Market Index Sources list (built-in + extra Git/HTTP sources) */}
      <Card>
        <CardContent className="p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">
              {t('admin.plugins.sourcesTitle')}
            </span>
            <span className="text-xs text-zinc-500">
              {1 + extraIndexes.length}
            </span>
          </div>
          <div className="divide-y divide-zinc-800/70 rounded-[var(--brand-radius-sm)] border border-zinc-800/80 bg-zinc-950/60">
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <Globe className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                <Badge variant="secondary">{t('admin.plugins.builtinSourceBadge')}</Badge>
                <code className="font-mono text-zinc-300 truncate">{pluginsData.index_url}</code>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCopy('idx-main', pluginsData.index_url)}
              >
                {copiedKey === 'idx-main' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            {extraIndexes.map((src) => (
              <div
                key={src.url}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {src.kind === 'git' ? (
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <Globe className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                  )}
                  <Badge variant={src.kind === 'git' ? 'success' : 'default'}>
                    {src.kind === 'git'
                      ? t('admin.plugins.sourceGitBadge')
                      : t('admin.plugins.sourceHttpBadge')}
                  </Badge>
                  <span className="font-medium text-zinc-200 shrink-0">{src.label}</span>
                  <code className="font-mono text-zinc-400 truncate">{src.url}</code>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={savingSources}
                  title={t('admin.plugins.removeSource')}
                  onClick={() => handleRemoveSource(src.url)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                </Button>
              </div>
            ))}
          </div>
          {extraIndexes.length === 0 && (
            <p className="text-xs text-zinc-500">{t('admin.plugins.noExtraSources')}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pluginsData.items.map((plg) => (
          <Card key={plg.slug}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {plg.icon_url ? (
                    <img
                      src={plg.icon_url}
                      alt={plg.slug}
                      className="h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 p-1.5"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
                      <Package className="h-5 w-5 text-indigo-400" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle>
                        {pickLocalizedText(
                          locale,
                          plg.display_name_zh,
                          plg.display_name_en,
                          plg.slug,
                        )}
                      </CardTitle>
                      <Badge variant="success">v{plg.version}</Badge>
                    </div>
                    <p className="font-mono text-xs text-zinc-400 mt-0.5">{plg.package_name}</p>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <p className="text-zinc-300 leading-relaxed">
                {pickLocalizedText(locale, plg.description_zh, plg.description_en)}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={syncingPlugins || sandboxes.length === 0}
                  onClick={() =>
                    setPushRequest({
                      mode: 'reinstall_selected',
                      plugins: [plg.slug],
                      title: `${pickLocalizedText(locale, plg.display_name_zh, plg.display_name_en, plg.slug)}`,
                    })
                  }
                >
                  <Send className="h-3.5 w-3.5" />
                  {t('cap.push.pushToEmployeesBtn')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={syncingPlugins}
                  onClick={() => handleSyncPlugins('reinstall_selected', [plg.slug])}
                  title={t('admin.plugins.reinstallOneBtn')}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', syncingPlugins && 'animate-spin')} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCopy(plg.slug, plg.install_command)}
                >
                  {copiedKey === plg.slug ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(plg.tarball_url, '_blank')}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('admin.plugins.downloadTgz')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <details className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-4 text-xs">
        <summary className="cursor-pointer font-medium text-zinc-300 select-none">
          {t('admin.plugins.devDetailsToggle')}
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-zinc-500 block">{t('admin.plugins.indexUrlLabel')}</span>
              <code className="text-indigo-400 font-mono mt-0.5 block truncate">
                {pluginsData.index_url}
              </code>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCopy('idx', pluginsData.index_url)}
            >
              {copiedKey === 'idx' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-zinc-500 block">{t('admin.plugins.npmUrlLabel')}</span>
              <code className="text-emerald-400 font-mono mt-0.5 block truncate">
                {pluginsData.npm_registry_url}
              </code>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCopy('npm', pluginsData.npm_registry_url)}
            >
              {copiedKey === 'npm' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </details>

      <Dialog
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        title={t('admin.plugins.addSourceTitle')}
        description={t('admin.plugins.addSourceDesc')}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleAddSource} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="plugin-source-url">{t('admin.plugins.sourceUrlLabel')}</Label>
            <Input
              id="plugin-source-url"
              required
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder={t('admin.plugins.sourceUrlPlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plugin-source-label">{t('admin.plugins.sourceLabelLabel')}</Label>
            <Input
              id="plugin-source-label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t('admin.plugins.sourceLabelPlaceholder')}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={syncOnSave}
              onChange={(e) => setSyncOnSave(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-950 text-indigo-500"
            />
            {t('admin.plugins.sourceSyncNow')}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAddSourceOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingSources || !newUrl.trim()}>
              {savingSources ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>

      <PushTargetDialog
        open={!!pushRequest}
        onOpenChange={(o) => !o && setPushRequest(null)}
        title={t('cap.push.dialogTitle', { name: pushRequest?.title ?? '' })}
        description={t('admin.plugins.pushDialogDesc')}
        sandboxes={sandboxes}
        templates={templates}
        onConfirm={async (spec) => {
          if (!pushRequest) return
          return await handleSyncPlugins(pushRequest.mode, pushRequest.plugins, spec)
        }}
      />
    </div>
  )
}
