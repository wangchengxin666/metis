export interface PluginMatcherItem {
  slug: string
  package_name: string
}

export const DEFAULT_CORE_AUTO_INSTALL_PLUGINS =
  'file-manager,workspace-user,custom-theme,sandbox-mesh,sandbox-memory,work-delivery'

/** Split the backend's comma-separated plugin spec into trimmed, de-duplicated tokens. */
export function parsePluginSpec(value: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of (value || '').split(',')) {
    const token = raw.trim()
    if (token && !seen.has(token)) {
      seen.add(token)
      out.push(token)
    }
  }
  return out
}

export function matchesPlugin(token: string, plugin: PluginMatcherItem): boolean {
  return (
    token === plugin.slug ||
    token === `${plugin.slug}.tgz` ||
    token === plugin.package_name
  )
}

/** Toggle a registry plugin in a comma-separated spec, normalizing matched entries by slug. */
export function togglePluginToken(
  currentValue: string,
  plugin: PluginMatcherItem,
): string {
  const tokens = parsePluginSpec(currentValue)
  const selected = tokens.some((tok) => matchesPlugin(tok, plugin))
  const next = selected
    ? tokens.filter((tok) => !matchesPlugin(tok, plugin))
    : [...tokens, plugin.slug]
  return next.join(',')
}

/**
 * Merge custom comma-separated input into an existing plugin spec.
 * Any input matching a known registry plugin (by slug, .tgz, or package_name)
 * is normalized to its canonical slug and deduplicated against existing selections.
 */
export function mergeCustomPluginTokens(
  currentValue: string,
  customInput: string,
  plugins: PluginMatcherItem[],
): string {
  const existing = parsePluginSpec(currentValue)
  const extras = parsePluginSpec(customInput)
  if (extras.length === 0) return existing.join(',')

  const out = [...existing]
  for (const rawTok of extras) {
    const matched = plugins.find((p) => matchesPlugin(rawTok, p))
    if (matched) {
      if (!out.some((tok) => matchesPlugin(tok, matched))) {
        out.push(matched.slug)
      }
    } else if (!out.includes(rawTok)) {
      out.push(rawTok)
    }
  }
  return out.join(',')
}
