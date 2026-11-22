import { useState } from 'react'
import { Check, Copy, Download, Package, RefreshCw } from 'lucide-react'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { pickLocalizedText } from '../../lib/i18n.ts'
import { useI18n } from '../../lib/i18nContext'
import type { PluginItem } from '../../types'

export interface PluginsRegistryData {
  index_url: string
  npm_registry_url: string
  source_type: string
  auto_install_default: string
  items: PluginItem[]
}

export interface PluginsTabProps {
  pluginsData: PluginsRegistryData
  copiedKey: string | null
  onCopy: (key: string, text: string) => void
  onRefresh: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}

export function PluginsTab({
  pluginsData,
  copiedKey,
  onCopy,
  onRefresh,
  notify,
}: PluginsTabProps) {
  const { locale, t } = useI18n()
  const [syncingPlugins, setSyncingPlugins] = useState(false)

  const handleSyncPlugins = async (
    mode: 'market_only' | 'reinstall_builtin' | 'reinstall_selected',
    plugins: string[] = [],
  ) => {
    setSyncingPlugins(true)
    try {
      notify(
        mode === 'market_only'
          ? t('admin.pluginsSyncing')
          : t('admin.pluginsReinstalling'),
      )
      const res = await apiFetch<{ synced: number }>('/api/plugins/sync-sandboxes', {
        method: 'POST',
        body: JSON.stringify({ mode, plugins }),
      })
      notify(
        mode === 'market_only'
          ? t('admin.pluginsSynced', { count: res.synced })
          : t('admin.pluginsReinstalled', { count: res.synced }),
      )
      await onRefresh()
    } catch (err: any) {
      notify(err.message || t('admin.pluginsSyncFailed'), 'error')
    } finally {
      setSyncingPlugins(false)
    }
  }

  return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/65 px-5 py-4">
            <h3 className="text-sm font-semibold text-zinc-100">{t('admin.plugins.title')}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={syncingPlugins}
                onClick={() => handleSyncPlugins('market_only')}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', syncingPlugins && 'animate-spin')} />
                {t('admin.plugins.syncBtn')}
              </Button>
              <Button
                variant="emerald"
                size="sm"
                disabled={syncingPlugins}
                onClick={() => handleSyncPlugins('reinstall_builtin')}
              >
                <Package className="h-3.5 w-3.5" />
                {t('admin.plugins.reinstallAllBtn')}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                      disabled={syncingPlugins}
                      onClick={() => handleSyncPlugins('reinstall_selected', [plg.slug])}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', syncingPlugins && 'animate-spin')} />
                      {t('admin.plugins.reinstallOneBtn')}
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
        </div>

  )
}
