import { estimateTokens } from '../shared/model.js'

const STATIC_GUIDE_WITH_AUTOWRITE = [
  '# Sandbox Memory & Environment Guide',
  'A compact Sandbox Environment Snapshot and a bounded Memory Index are provided in session context.',
  '- Pull details lazily: call `memory_get(ids)` to read full content of an indexed memory, `memory_search(query)` to look up older/omitted memories, or `env_snapshot()` for fresh service/route/project details.',
  '- Auto-record durable knowledge: proactively call `memory_save` (or `memory_update` when outdated) whenever the user states a lasting preference/rule, you discover important project structure/ports/commands, configure a sandbox service/route/cron, or solve a non-obvious pitfall.',
  '- Never store secrets, API keys, tokens, or passwords in memory. Keep `summary` to one concise line so the index stays token-frugal.',
].join('\n')

const STATIC_GUIDE_READONLY = [
  '# Sandbox Memory & Environment Guide',
  'A compact Sandbox Environment Snapshot and a bounded Memory Index are provided in session context.',
  '- Call `memory_get(ids)` or `memory_search(query)` when you need full details of any stored memory, or `env_snapshot()` to refresh live sandbox state.',
  '- Only write memories via `memory_save` / `memory_update` when the user explicitly asks you to remember or update something.',
].join('\n')

export function buildStandingGuide(settings) {
  if (!settings?.enabled) return ''
  return settings.agentAutoWrite !== false
    ? STATIC_GUIDE_WITH_AUTOWRITE
    : STATIC_GUIDE_READONLY
}

export function buildMemoryIndexBlock(memories, settings) {
  if (!settings?.enabled) {
    return { text: '', includedCount: 0, omittedCount: 0, totalEnabledCount: 0 }
  }
  const active = (Array.isArray(memories) ? memories : [])
    .filter((m) => m && m.enabled !== false)
    .sort((a, b) => {
      if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
    })

  const totalEnabledCount = active.length
  if (totalEnabledCount === 0) {
    return { text: '', includedCount: 0, omittedCount: 0, totalEnabledCount: 0 }
  }

  const maxItems = Math.max(5, Number(settings.maxIndexItems) || 30)
  const maxChars = Math.max(400, Number(settings.maxIndexChars) || 2800)

  const header = `[Persistent Memory Index (${totalEnabledCount} active — use memory_get/memory_search for full details)]`
  const lines = [header]
  let charCount = header.length
  let includedCount = 0

  for (const m of active) {
    if (includedCount >= maxItems) break
    const pinPrefix = m.pinned ? '*' : ''
    const summaryPart = m.summary && m.summary !== m.title ? ` — ${m.summary}` : ''
    const line = `- ${pinPrefix}[${m.id}|${m.category}] ${m.title}${summaryPart}`
    if (includedCount > 0 && charCount + line.length + 1 > maxChars) {
      break
    }
    lines.push(line)
    charCount += line.length + 1
    includedCount += 1
  }

  const omittedCount = Math.max(0, totalEnabledCount - includedCount)
  if (omittedCount > 0) {
    lines.push(`(${omittedCount} more memories available via memory_search)`)
  }

  return {
    text: lines.join('\n'),
    includedCount,
    omittedCount,
    totalEnabledCount,
  }
}

export function buildEnvSnapshotBlock(snapshot, settings) {
  if (!settings?.enabled || !settings?.includeEnvSnapshot || !snapshot) {
    return ''
  }
  const sec = settings.envSections || {}
  const lines = ['[Sandbox Environment Snapshot (cached — call env_snapshot for live refresh)]']
  let hasContent = false

  if (sec.urls !== false && snapshot.info) {
    const info = snapshot.info
    const parts = []
    if (info.slug) parts.push(`slug=${info.slug}`)
    if (info.homeDir) parts.push(`home=${info.homeDir}`)
    if (info.appsBaseUrl) parts.push(`apps=${info.appsBaseUrl}<name>/`)
    if (info.portProxyBaseUrl) parts.push(`ports=${info.portProxyBaseUrl}<port>/`)
    if (parts.length > 0) {
      lines.push(`- Sandbox: ${parts.join(' | ')} (no systemd; use sandbox-service / sandbox-expose / sandbox-cron)`)
      hasContent = true
    }
  }

  if (sec.toolchains !== false && Array.isArray(snapshot.toolchains) && snapshot.toolchains.length > 0) {
    const tcStr = snapshot.toolchains
      .slice(0, 12)
      .map((t) => (t.version && t.version !== 'installed' ? `${t.name}@${t.version}` : t.name))
      .join(', ')
    lines.push(`- Toolchains: ${tcStr}`)
    hasContent = true
  }

  if (sec.projects !== false && Array.isArray(snapshot.projects) && snapshot.projects.length > 0) {
    const projStr = snapshot.projects
      .slice(0, 15)
      .map((p) => (p.stacks?.length ? `${p.name}(${p.stacks.join('/')})` : p.name))
      .join(', ')
    lines.push(`- Projects: ${projStr}`)
    hasContent = true
  }

  if (sec.services !== false && Array.isArray(snapshot.services) && snapshot.services.length > 0) {
    const svcStr = snapshot.services
      .slice(0, 12)
      .map((s) => `${s.name}(${s.status || 'configured'})`)
      .join(', ')
    lines.push(`- Services: ${svcStr}`)
    hasContent = true
  }

  if (sec.routes !== false && Array.isArray(snapshot.routes) && snapshot.routes.length > 0) {
    const routeStr = snapshot.routes
      .slice(0, 12)
      .map((r) => `${r.name}:${r.mountPath}->${r.target}`)
      .join(', ')
    lines.push(`- Exposed Routes: ${routeStr}`)
    hasContent = true
  }

  if (sec.cron !== false && Array.isArray(snapshot.cron) && snapshot.cron.length > 0) {
    const cronPreview = snapshot.cron.slice(0, 4).join(' ; ')
    const extra = snapshot.cron.length > 4 ? ` (+${snapshot.cron.length - 4} more)` : ''
    lines.push(`- Cron (${snapshot.cron.length}): ${cronPreview}${extra}`)
    hasContent = true
  }

  return hasContent ? lines.join('\n') : ''
}

export function buildContextBundle(memories, envSnapshot, settings) {
  const guideText = buildStandingGuide(settings)
  const indexRes = buildMemoryIndexBlock(memories, settings)
  const envText = buildEnvSnapshotBlock(envSnapshot, settings)

  const contextParts = [envText, indexRes.text].filter(Boolean)
  const contextText = contextParts.join('\n\n')

  const guideTokens = estimateTokens(guideText)
  const envTokens = estimateTokens(envText)
  const indexTokens = estimateTokens(indexRes.text)
  const totalTokens = guideTokens + envTokens + indexTokens

  return {
    guideText,
    envText,
    indexText: indexRes.text,
    contextText,
    budget: {
      guideTokens,
      envTokens,
      indexTokens,
      totalTokens,
      indexChars: indexRes.text.length,
      maxIndexChars: Number(settings?.maxIndexChars) || 2800,
      includedCount: indexRes.includedCount,
      omittedCount: indexRes.omittedCount,
      totalEnabledCount: indexRes.totalEnabledCount,
    },
  }
}
