export const MEMORY_CATEGORIES = [
  'preference',
  'project',
  'environment',
  'workflow',
  'pitfall',
  'fact',
]

export const MEMORY_SOURCES = ['auto', 'agent', 'manual']

export const DEFAULT_ENV_SECTIONS = {
  urls: true,
  toolchains: true,
  projects: true,
  services: true,
  routes: true,
  cron: true,
}

export const DEFAULT_SETTINGS = {
  enabled: true,
  autoCapture: true,
  agentAutoWrite: true,
  includeEnvSnapshot: true,
  maxIndexItems: 30,
  maxIndexChars: 2800,
  envSections: { ...DEFAULT_ENV_SECTIONS },
}

export function normalizeCategory(value) {
  const clean = String(value || '').trim().toLowerCase()
  if (MEMORY_CATEGORIES.includes(clean)) return clean
  if (clean === 'pref' || clean === 'prefs' || clean === 'user' || clean === 'style') return 'preference'
  if (clean === 'env' || clean === 'infra' || clean === 'sandbox' || clean === 'service') return 'environment'
  if (clean === 'bug' || clean === 'fix' || clean === 'gotcha' || clean === 'lesson') return 'pitfall'
  if (clean === 'rule' || clean === 'process' || clean === 'sop') return 'workflow'
  if (clean === 'repo' || clean === 'app' || clean === 'codebase') return 'project'
  return 'fact'
}

export function normalizeSource(value) {
  const clean = String(value || '').trim().toLowerCase()
  return MEMORY_SOURCES.includes(clean) ? clean : 'manual'
}

export function normalizeTags(raw) {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,，\n]/)
      : []
  const seen = new Set()
  const out = []
  for (const item of arr) {
    const clean = String(item || '').trim().replace(/^#/, '').slice(0, 32)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= 10) break
  }
  return out
}

export function normalizeSettings(raw, fallback = DEFAULT_SETTINGS) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_SETTINGS
  const rawEnv = src.envSections && typeof src.envSections === 'object' ? src.envSections : {}
  const baseEnv = base.envSections && typeof base.envSections === 'object' ? base.envSections : DEFAULT_ENV_SECTIONS

  const clampInt = (v, def, min, max) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return def
    return Math.max(min, Math.min(max, Math.round(n)))
  }

  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : Boolean(base.enabled ?? true),
    autoCapture: typeof src.autoCapture === 'boolean' ? src.autoCapture : Boolean(base.autoCapture ?? true),
    agentAutoWrite: typeof src.agentAutoWrite === 'boolean' ? src.agentAutoWrite : Boolean(base.agentAutoWrite ?? true),
    includeEnvSnapshot: typeof src.includeEnvSnapshot === 'boolean'
      ? src.includeEnvSnapshot
      : Boolean(base.includeEnvSnapshot ?? true),
    maxIndexItems: clampInt(src.maxIndexItems, base.maxIndexItems ?? 30, 5, 100),
    maxIndexChars: clampInt(src.maxIndexChars, base.maxIndexChars ?? 2800, 600, 12000),
    envSections: {
      urls: typeof rawEnv.urls === 'boolean' ? rawEnv.urls : Boolean(baseEnv.urls ?? true),
      toolchains: typeof rawEnv.toolchains === 'boolean' ? rawEnv.toolchains : Boolean(baseEnv.toolchains ?? true),
      projects: typeof rawEnv.projects === 'boolean' ? rawEnv.projects : Boolean(baseEnv.projects ?? true),
      services: typeof rawEnv.services === 'boolean' ? rawEnv.services : Boolean(baseEnv.services ?? true),
      routes: typeof rawEnv.routes === 'boolean' ? rawEnv.routes : Boolean(baseEnv.routes ?? true),
      cron: typeof rawEnv.cron === 'boolean' ? rawEnv.cron : Boolean(baseEnv.cron ?? true),
    },
  }
}

/**
 * CJK-aware lightweight token estimator (~1.5 CJK chars/token, ~4 ASCII chars/token).
 */
export function estimateTokens(text) {
  const s = String(text || '')
  if (!s) return 0
  let cjkCount = 0
  let otherCount = 0
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i)
    if (
      (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0x3400 && code <= 0x4dbf)
      || (code >= 0x3000 && code <= 0x303f)
      || (code >= 0xff00 && code <= 0xffef)
    ) {
      cjkCount += 1
    } else {
      otherCount += 1
    }
  }
  return Math.ceil(cjkCount / 1.5 + otherCount / 4)
}

const SECRET_PATTERNS = [
  // PEM private key blocks
  { re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, repl: '[REDACTED_PRIVATE_KEY]' },
  // OpenAI / DeepSeek / Anthropic / Stripe style sk-* keys
  { re: /\bsk-(?:proj-|ant-api\d+-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g, repl: '[REDACTED_API_KEY]' },
  // GitHub tokens
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, repl: '[REDACTED_GH_TOKEN]' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, repl: '[REDACTED_GH_TOKEN]' },
  // AWS access key IDs
  { re: /\bAKIA[0-9A-Z]{16}\b/g, repl: '[REDACTED_AWS_KEY]' },
  // JWT tokens
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, repl: '[REDACTED_JWT]' },
  // Authorization Bearer tokens
  { re: /(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, repl: '$1[REDACTED_TOKEN]' },
  // Key/value secrets like API_KEY=..., PASSWORD: ...
  {
    re: /\b((?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|db[_-]?pass)\s*[:=]\s*['"]?)([^\s'",;]{8,})(['"]?)/gi,
    repl: '$1[REDACTED]$3',
  },
]

export function redactSecrets(text) {
  let out = String(text || '')
  let redacted = false
  for (const rule of SECRET_PATTERNS) {
    rule.re.lastIndex = 0
    if (rule.re.test(out)) {
      redacted = true
      rule.re.lastIndex = 0
      out = out.replace(rule.re, rule.repl)
    }
  }
  return { text: out, redacted }
}

export function buildSummary(content, explicitSummary = '') {
  const raw = String(explicitSummary || '').trim() || String(content || '').trim()
  const firstLine = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
    .find(Boolean) || ''
  const singleLine = firstLine.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= 160) return singleLine
  return `${singleLine.slice(0, 157).trimEnd()}...`
}

export function normalizeTitle(title, fallbackText = '') {
  const clean = String(title || '')
    .replace(/\r\n?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean) return clean.slice(0, 100)
  const derived = buildSummary(fallbackText, '')
  if (derived.length <= 60) return derived || 'Untitled Memory'
  return `${derived.slice(0, 57).trimEnd()}...`
}

/**
 * Tokenize text into lowercase ASCII words and CJK unigrams + bigrams for
 * zero-dependency bilingual search and deduplication.
 */
export function tokenizeForSearch(text) {
  const src = String(text || '').toLowerCase()
  if (!src) return []
  const tokens = []

  // Latin / numeric / identifier words (keep standalone digits so numbered items stay distinct)
  const asciiMatches = src.match(/[a-z0-9][a-z0-9_.:/-]{1,}|\d+/g) || []
  for (const w of asciiMatches) {
    tokens.push(w)
    if (/[_.:/-]/.test(w)) {
      for (const part of w.split(/[_.:/-]+/)) {
        if (part.length >= 2) tokens.push(part)
      }
    }
  }

  // CJK contiguous runs -> bigrams + individual chars
  const cjkRuns = src.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g) || []
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length; i += 1) {
      tokens.push(run[i])
      if (i + 1 < run.length) {
        tokens.push(run.slice(i, i + 2))
      }
    }
  }

  return tokens
}

export function computeTitleSimilarity(a, b) {
  const ta = new Set(tokenizeForSearch(a))
  const tb = new Set(tokenizeForSearch(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const tok of ta) {
    if (tb.has(tok)) inter += 1
  }
  return inter / (ta.size + tb.size - inter)
}

/**
 * Lightweight CJK-aware BM25-inspired ranking over memory entries.
 */
export function rankMemories(memories, query, {
  category = '',
  source = '',
  tag = '',
  includeDisabled = false,
  limit = 10,
} = {}) {
  const cleanCat = category ? normalizeCategory(category) : ''
  const cleanSrc = source ? normalizeSource(source) : ''
  const cleanTag = String(tag || '').trim().toLowerCase()
  const rawQuery = String(query || '').trim()
  const qLower = rawQuery.toLowerCase()
  const qTokens = Array.from(new Set(tokenizeForSearch(rawQuery)))

  const filtered = (Array.isArray(memories) ? memories : []).filter((m) => {
    if (!m || typeof m !== 'object') return false
    if (!includeDisabled && m.enabled === false) return false
    if (cleanCat && m.category !== cleanCat) return false
    if (cleanSrc && m.source !== cleanSrc) return false
    if (cleanTag && !(Array.isArray(m.tags) && m.tags.some((t) => String(t).toLowerCase() === cleanTag))) {
      return false
    }
    return true
  })

  if (!rawQuery) {
    return filtered
      .slice()
      .sort((a, b) => {
        if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1
        return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
      })
      .slice(0, Math.max(1, limit))
      .map((entry) => ({ entry, score: entry.pinned ? 2 : 1 }))
  }

  const N = Math.max(1, filtered.length)
  const docFreq = new Map()
  const prepared = filtered.map((entry) => {
    const titleTokens = tokenizeForSearch(entry.title || '')
    const tagTokens = tokenizeForSearch((entry.tags || []).join(' '))
    const summaryTokens = tokenizeForSearch(entry.summary || '')
    const contentTokens = tokenizeForSearch(entry.content || '')
    const allUnique = new Set([...titleTokens, ...tagTokens, ...summaryTokens, ...contentTokens])
    for (const tok of allUnique) {
      docFreq.set(tok, (docFreq.get(tok) || 0) + 1)
    }
    return {
      entry,
      titleSet: new Set(titleTokens),
      tagSet: new Set(tagTokens),
      summarySet: new Set(summaryTokens),
      contentFreq: contentTokens.reduce((map, tok) => {
        map.set(tok, (map.get(tok) || 0) + 1)
        return map
      }, new Map()),
      docLen: Math.max(1, contentTokens.length + summaryTokens.length),
      haystack: `${entry.title || ''}\n${entry.summary || ''}\n${(entry.tags || []).join(' ')}\n${entry.content || ''}`.toLowerCase(),
    }
  })

  const avgDocLen = prepared.reduce((acc, d) => acc + d.docLen, 0) / Math.max(1, prepared.length)
  const k1 = 1.2
  const b = 0.75

  const scored = []
  for (const doc of prepared) {
    let score = 0
    if (doc.haystack.includes(qLower)) {
      score += 6.0
      if (String(doc.entry.title || '').toLowerCase().includes(qLower)) {
        score += 4.5
      }
    }
    for (const tok of qTokens) {
      const df = docFreq.get(tok) || 0
      if (df === 0) continue
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
      const isBigramOrWord = tok.length >= 2
      const tokWeight = isBigramOrWord ? 1.0 : 0.35

      if (doc.titleSet.has(tok)) score += idf * 3.4 * tokWeight
      if (doc.tagSet.has(tok)) score += idf * 2.8 * tokWeight
      if (doc.summarySet.has(tok)) score += idf * 2.0 * tokWeight

      const tf = doc.contentFreq.get(tok) || 0
      if (tf > 0) {
        const bm25 = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.docLen / Math.max(1, avgDocLen))))
        score += idf * bm25 * 1.4 * tokWeight
      }
    }
    if (score > 0) {
      if (doc.entry.pinned) score *= 1.15
      scored.push({ entry: doc.entry, score: Number(score.toFixed(3)) })
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (Number(b.entry.updatedAt) || 0) - (Number(a.entry.updatedAt) || 0)
  })
  return scored.slice(0, Math.max(1, limit))
}
