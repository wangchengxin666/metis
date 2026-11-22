import { buildSummary, normalizeTitle, redactSecrets } from '../shared/model.js'

const REMEMBER_PATTERNS = [
  // Chinese explicit remember / preference / rule cues
  {
    re: /(?:^|[\n。！？!?.]\s*)(?:请|帮我|麻烦)?(?:记住|记一下|记下来|牢记)(?:一点)?[：:，,\s]*([^\n。！？!?]{4,220})/i,
    category: 'preference',
    tag: 'explicit',
  },
  {
    re: /(?:^|[\n。！？!?.]\s*)(?:以后|之后|往后|默认情况下?|凡是|统一|一律)(?:都|请|尽量|不要)?([^\n。！？!?]{5,200})/i,
    category: 'preference',
    tag: 'preference',
  },
  {
    re: /(?:^|[\n。！？!?.]\s*)(?:不要再|别再|禁止|切勿)([^\n。！？!?]{5,180})/i,
    category: 'workflow',
    tag: 'constraint',
  },
  // English explicit remember / preference / rule cues
  {
    re: /(?:^|[\n.!?]\s*)(?:please\s+)?(?:remember|note)\s+(?:that\s+)?([^\n.!?]{8,220})/i,
    category: 'preference',
    tag: 'explicit',
  },
  {
    re: /(?:^|[\n.!?]\s*)(?:from now on|going forward|by default|always\s+(?:use|prefer|run|format|reply|respond))[,:\s]+([^\n.!?]{6,200})/i,
    category: 'preference',
    tag: 'preference',
  },
  {
    re: /(?:^|[\n.!?]\s*)(?:never\s+(?:use|run|modify|commit|push))[,:\s]+([^\n.!?]{6,180})/i,
    category: 'workflow',
    tag: 'constraint',
  },
]

const ENV_MUTATION_RE = /\b(sandbox-service\s+(?:add|remove|stop|restart)|sandbox-expose\s+(?!-(?:-info|-list))|sandbox-cron\s+(?:add|set|clear)|git\s+clone|npm\s+install\s+-g|pnpm\s+add\s+-g|pip3?\s+install|uv\s+(?:tool\s+install|pip\s+install)|apt(?:-get)?\s+install)\b/i

const NOISE_PREFIX_RE = /^\[(SANDBOX MESH|SYSTEM|MEMORY)/i

export function extractUserMessageText(event) {
  const msg = event?.data?.message ?? event?.data ?? event?.message ?? null
  if (!msg || typeof msg !== 'object') return ''
  // Ignore synthetic injected user-role context messages (e.g., skills, AGENTS.md, systemPrompt.context)
  if (msg.source && typeof msg.source === 'object' && msg.source.kind && msg.source.kind !== 'user') {
    return ''
  }
  if (typeof msg.content === 'string') return msg.content.trim()
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return ''
}

export function extractToolCallInfo(event) {
  const call = event?.data?.call ?? event?.data ?? {}
  const name = String(call.name || event?.data?.toolName || '').trim()
  let argsText = ''
  if (typeof call.argsRaw === 'string') argsText = call.argsRaw
  else if (typeof call.arguments === 'string') argsText = call.arguments
  else if (call.args && typeof call.args === 'object') {
    try { argsText = JSON.stringify(call.args) } catch {}
  } else if (event?.data?.args && typeof event.data.args === 'object') {
    try { argsText = JSON.stringify(event.data.args) } catch {}
  }
  return { name, argsText }
}

/**
 * Extract durable preference/workflow memory candidates from a user prompt using
 * zero-token bilingual heuristics, rejecting ephemeral questions or raw secrets.
 */
export function extractHeuristicMemoriesFromUserText(rawText) {
  const text = String(rawText || '').trim()
  if (!text || text.length < 6 || text.length > 4000) return []
  if (NOISE_PREFIX_RE.test(text)) return []

  const candidates = []
  const seenKeys = new Set()

  for (const rule of REMEMBER_PATTERNS) {
    const match = rule.re.exec(text)
    if (!match) continue
    const fullSnippet = String(match[0] || '').replace(/^[\n。！？!?.]+/, '').trim()
    const captured = String(match[1] || '').trim()
    if (!captured || captured.length < 4) continue
    // Skip pure questions like "记住我刚才说的吗？"
    if (/[？?]$/.test(fullSnippet) && !/[：:]/.test(fullSnippet)) continue

    const { text: safeSnippet, redacted } = redactSecrets(fullSnippet)
    // If the entire snippet is basically a redacted secret, do not store it at all
    if (redacted && /^\[REDACTED/.test(safeSnippet.trim())) continue

    const summary = buildSummary(safeSnippet, '')
    if (!summary || summary.length < 5) continue

    const title = normalizeTitle(summary.length <= 44 ? summary : `${summary.slice(0, 42).trimEnd()}...`)
    const dedupeKey = `auto:${rule.category}:${summary.toLowerCase().slice(0, 48)}`
    if (seenKeys.has(dedupeKey)) continue
    seenKeys.add(dedupeKey)

    candidates.push({
      title,
      summary,
      content: safeSnippet,
      category: rule.category,
      tags: ['auto-captured', rule.tag],
      source: 'auto',
      dedupeKey,
    })
    if (candidates.length >= 2) break
  }

  return candidates
}

export function detectEnvMutationFromToolCall({ name, argsText }) {
  const cleanName = String(name || '').toLowerCase()
  if (!argsText) return false
  if (cleanName.includes('memory')) return false
  return ENV_MUTATION_RE.test(argsText)
}

/**
 * Stateful per-session observer that listens to DSH `session/event` streams,
 * runs zero-token auto-capture on completed turns, and triggers environment
 * snapshot refreshes when sandbox services/routes/toolchains change.
 */
export function createTurnAutoCaptureObserver({
  store,
  envScanner,
  logger = null,
} = {}) {
  const turnBuffers = new Map()

  function getOrCreateBuffer(sessionId) {
    let buf = turnBuffers.get(sessionId)
    if (!buf) {
      buf = {
        lastUserText: '',
        memoryToolCalled: false,
        envMutated: false,
      }
      turnBuffers.set(sessionId, buf)
      // Cap tracked sessions to avoid unbounded growth
      if (turnBuffers.size > 120) {
        const oldest = turnBuffers.keys().next().value
        if (oldest !== undefined) turnBuffers.delete(oldest)
      }
    }
    return buf
  }

  function handleSessionEvent(sessionOrEvent, maybeEvent) {
    const event = maybeEvent && typeof maybeEvent === 'object' ? maybeEvent : sessionOrEvent
    const session = maybeEvent && typeof maybeEvent === 'object' ? sessionOrEvent : null
    if (!event || typeof event !== 'object') return

    const sessionId = String(session?.id || event.sessionId || 'default')
    // Never auto-capture internal sandbox-mesh collab sessions
    if (sessionId.startsWith('session-mesh-')) return

    const evType = String(event.type || '')
    if (!evType) return

    if (evType === 'turn/start') {
      turnBuffers.set(sessionId, {
        lastUserText: '',
        memoryToolCalled: false,
        envMutated: false,
      })
      return
    }

    if (evType === 'user/message') {
      const text = extractUserMessageText(event)
      if (text) {
        const buf = getOrCreateBuffer(sessionId)
        buf.lastUserText = text
      }
      return
    }

    if (evType === 'tool/call' || evType === 'tool/start' || evType === 'tool/result') {
      const info = extractToolCallInfo(event)
      const buf = getOrCreateBuffer(sessionId)
      if (/^memory_(?:save|update)$/.test(info.name)) {
        buf.memoryToolCalled = true
      } else if (detectEnvMutationFromToolCall(info)) {
        buf.envMutated = true
      }
      return
    }

    if (evType === 'turn/end') {
      const buf = turnBuffers.get(sessionId)
      turnBuffers.delete(sessionId)
      if (!buf) return

      if (buf.envMutated) {
        envScanner?.scheduleRefresh?.(800)
      }

      const reasonKind = event?.data?.reason?.kind
      if (reasonKind && reasonKind !== 'completed') return

      const settings = store.getSettings()
      if (!settings.enabled || !settings.autoCapture) return
      if (buf.memoryToolCalled || !buf.lastUserText) return

      const candidates = extractHeuristicMemoriesFromUserText(buf.lastUserText)
      for (const candidate of candidates) {
        try {
          store.upsert({ ...candidate, sessionId })
        } catch (err) {
          logger?.warn?.(`Auto-capture save failed: ${err?.message || err}`)
        }
      }
    }
  }

  return {
    handleSessionEvent,
    reset: () => turnBuffers.clear(),
  }
}
