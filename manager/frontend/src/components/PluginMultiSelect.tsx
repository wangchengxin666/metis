import { useState } from 'react'
import { Check, Package, Plus, X } from 'lucide-react'
import { Input, cn } from './ui'
import { pickLocalizedText } from '../lib/i18n.ts'
import { useI18n } from '../lib/i18nContext'
import {
  matchesPlugin,
  mergeCustomPluginTokens,
  parsePluginSpec,
  togglePluginToken,
} from '../lib/plugins.ts'
import type { PluginItem } from '../types'

export { parsePluginSpec }

/**
 * Multi-select picker for pre-installed plugins. The value stays a comma-separated
 * string (the format the backend stores), so registry plugins are toggled by slug while
 * custom specs (URLs / npm package names) are preserved as removable chips.
 */
export function PluginMultiSelect({
  value,
  onChange,
  plugins,
}: {
  value: string
  onChange: (next: string) => void
  plugins: PluginItem[]
}) {
  const { locale, t } = useI18n()
  const [customInput, setCustomInput] = useState('')
  const [brokenIcons, setBrokenIcons] = useState<Record<string, boolean>>({})
  const tokens = parsePluginSpec(value)

  const isSelected = (plugin: PluginItem) => tokens.some((tok) => matchesPlugin(tok, plugin))
  const customTokens = tokens.filter((tok) => !plugins.some((p) => matchesPlugin(tok, p)))

  const emit = (next: string[]) => onChange(next.join(','))

  const toggle = (plugin: PluginItem) => {
    onChange(togglePluginToken(value, plugin))
  }

  const addCustom = () => {
    if (!customInput.trim()) return
    const merged = mergeCustomPluginTokens(value, customInput, plugins)
    if (merged !== value) {
      onChange(merged)
    }
    setCustomInput('')
  }

  return (
    <div className="space-y-2">
      {plugins.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-800 px-3 py-2 text-[11px] text-zinc-500">
          {t('plugins.picker.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {plugins.map((plugin) => {
            const selected = isSelected(plugin)
            const name = pickLocalizedText(
              locale,
              plugin.display_name_zh,
              plugin.display_name_en,
              plugin.slug,
            )
            const desc = pickLocalizedText(locale, plugin.description_zh, plugin.description_en)
            const iconUrl = !brokenIcons[plugin.slug] ? plugin.icon_url || null : null
            return (
              <button
                key={plugin.slug}
                type="button"
                role="checkbox"
                aria-checked={selected}
                title={desc || plugin.package_name}
                onClick={() => toggle(plugin)}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors cursor-pointer',
                  selected
                    ? 'border-indigo-500/70 bg-indigo-500/10 text-zinc-100'
                    : 'border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-600',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    selected ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-zinc-600',
                  )}
                >
                  {selected && <Check className="h-3 w-3" />}
                </span>
                {iconUrl ? (
                  <img
                    src={iconUrl}
                    alt=""
                    className="h-4 w-4 shrink-0"
                    onError={() =>
                      setBrokenIcons((prev) =>
                        prev[plugin.slug] ? prev : { ...prev, [plugin.slug]: true },
                      )
                    }
                  />
                ) : (
                  <Package className="h-4 w-4 shrink-0 text-zinc-500" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">{name}</span>
                  <span className="block truncate font-mono text-[10px] text-zinc-500">
                    {plugin.slug}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {customTokens.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {customTokens.map((tok) => (
            <span
              key={tok}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-300"
            >
              <span className="truncate">{tok}</span>
              <button
                type="button"
                aria-label={t('plugins.picker.remove')}
                onClick={() => emit(tokens.filter((x) => x !== tok))}
                className="text-zinc-500 hover:text-red-400 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={customInput}
          placeholder={t('plugins.picker.customPlaceholder')}
          onChange={(e) => setCustomInput(e.target.value)}
          onBlur={addCustom}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCustom()
            }
          }}
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!customInput.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:border-indigo-500/60 hover:text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Plus className="h-3 w-3" />
          {t('plugins.picker.add')}
        </button>
      </div>
    </div>
  )
}
