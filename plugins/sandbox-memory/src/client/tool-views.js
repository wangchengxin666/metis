import { createTranslator } from './locale.js'
import { ChevronIcon, MemoryNavIcon, SearchIcon, ServerIcon, SparkleIcon, TrashIcon } from './icons.js'

function smemTvIsPartialArguments(obj) {
  return Boolean(
    obj
    && typeof obj === 'object'
    && !Array.isArray(obj)
    && typeof obj.text === 'function'
    && typeof obj.value === 'function'
    && typeof obj.keys === 'function',
  )
}

function smemTvReadPartialArguments(pa) {
  const out = {}
  let keys = []
  try {
    keys = Array.from(pa.keys() || [])
  } catch {
    return out
  }
  for (const key of keys) {
    if (typeof key !== 'string' || !key) continue
    try {
      const str = pa.text(key)
      if (typeof str === 'string') {
        out[key] = str
        continue
      }
    } catch {}
    try {
      const val = pa.value(key)
      if (val !== undefined) out[key] = val
    } catch {}
  }
  return out
}

function smemTvAsString(val) {
  return typeof val === 'string' ? val : ''
}

function smemTvAsStringArray(val) {
  if (!Array.isArray(val)) return []
  return val.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
}

export function parseMemoryToolArgsSafe(block) {
  if (!block || typeof block !== 'object') return {}

  const raw = block.call?.argsRaw ?? block.argsRaw ?? ''
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {}
  }

  const direct = block.call?.args ?? block.args
  if (smemTvIsPartialArguments(direct)) {
    return smemTvReadPartialArguments(direct)
  }

  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    const clean = {}
    for (const [k, v] of Object.entries(direct)) {
      if (typeof v !== 'function') clean[k] = v
    }
    return clean
  }
  return {}
}

function smemTvExtractOutputText(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.content)) return ''
  return block.content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string' && item.text.trim())
    .map((item) => item.text.trim())
    .join('\n')
}

function smemTvCategoryLabel(cat, t) {
  const c = String(cat || '').toLowerCase()
  const map = {
    preference: 'catPreference',
    project: 'catProject',
    environment: 'catEnvironment',
    workflow: 'catWorkflow',
    pitfall: 'catPitfall',
    fact: 'catFact',
  }
  return map[c] ? t(map[c]) : (cat || '')
}

function smemTvSourceLabel(src, t) {
  const s = String(src || '').toLowerCase()
  if (s === 'auto') return t('srcAuto')
  if (s === 'agent') return t('srcAgent')
  if (s === 'manual') return t('srcManual')
  return src || ''
}

function smemTvRenderInline(h, rawText, keyPrefix) {
  const text = String(rawText ?? '')
  if (!text) return ''
  const re = /`([^`\n]+)`|\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\s\n][^*\n]*?[^*\s\n]|[^*\s\n])\*/g
  const parts = []
  let last = 0
  let m
  let idx = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const k = `${keyPrefix}-${idx++}`
    if (m[1] !== undefined) {
      parts.push(h('code', { key: k }, m[1]))
    } else if (m[2] !== undefined && m[3] !== undefined) {
      parts.push(h('a', { key: k, href: m[3], target: '_blank', rel: 'noopener noreferrer' }, m[2]))
    } else if (m[4] !== undefined) {
      parts.push(h('strong', { key: k }, m[4]))
    } else if (m[5] !== undefined) {
      parts.push(h('em', { key: k }, m[5]))
    }
    last = m.index + m[0].length
  }
  if (parts.length === 0) return text
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function smemTvRenderMarkdown(h, rawText, keyPrefix = 'smd') {
  const source = String(rawText ?? '').replace(/\r\n?/g, '\n').trim()
  if (!source) return null
  const lines = source.split('\n')
  const blocks = []
  let i = 0
  let bi = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) {
      i += 1
      continue
    }
    const bk = `${keyPrefix}-${bi++}`
    if (trimmed.startsWith('```')) {
      const codeLines = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push(h('pre', { key: bk }, h('code', null, codeLines.join('\n'))))
      continue
    }
    const hm = trimmed.match(/^#{1,4}\s+(.+)$/)
    if (hm) {
      blocks.push(h('h4', { key: bk }, smemTvRenderInline(h, hm[1], `${bk}-h`)))
      i += 1
      continue
    }
    if (/^(?:[-*•]\s+|\d+[.)]\s+)/.test(trimmed)) {
      const ordered = /^\d+[.)]\s+/.test(trimmed)
      const re = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*•]\s+(.+)$/
      const items = []
      while (i < lines.length) {
        const lm = lines[i].trim().match(re)
        if (!lm) break
        items.push(lm[1])
        i += 1
      }
      blocks.push(
        h(
          ordered ? 'ol' : 'ul',
          { key: bk },
          ...items.map((item, li) => h('li', { key: `${bk}-li-${li}` }, smemTvRenderInline(h, item, `${bk}-li-${li}`))),
        ),
      )
      continue
    }
    const pLines = [line]
    i += 1
    while (
      i < lines.length
      && lines[i].trim()
      && !lines[i].trim().startsWith('```')
      && !/^#{1,4}\s+/.test(lines[i].trim())
      && !/^(?:[-*•]\s+|\d+[.)]\s+)/.test(lines[i].trim())
    ) {
      pLines.push(lines[i])
      i += 1
    }
    const children = []
    pLines.forEach((pl, pi) => {
      if (pi > 0) children.push(h('br', { key: `${bk}-br-${pi}` }))
      const inl = smemTvRenderInline(h, pl, `${bk}-p-${pi}`)
      if (Array.isArray(inl)) children.push(...inl)
      else children.push(inl)
    })
    blocks.push(h('p', { key: bk }, ...children))
  }
  return h('div', { className: 'smem-tool-md' }, ...blocks)
}

function smemTvParseSaveOutput(outputText) {
  const text = String(outputText || '').trim()
  if (!text) return null
  const m = text.match(/^(Saved|Updated)\s+memory\s+\[([^\]]+)\]\s+\(([^)]+)\):\s+"([^"]+)"(?:\s+—\s+([\s\S]*))?$/i)
  if (!m) return null
  let summary = (m[5] || '').trim()
  const redacted = /\(sensitive tokens redacted\)\s*$/i.test(summary)
  if (redacted) {
    summary = summary.replace(/\s*\(sensitive tokens redacted\)\s*$/i, '').trim()
  }
  return {
    action: m[1].toLowerCase(),
    id: m[2],
    category: m[3].toLowerCase(),
    title: m[4],
    summary,
    redacted,
  }
}

function smemTvParseSearchOutput(outputText) {
  const text = String(outputText || '').trim()
  if (!text) return null
  if (/^No matching memories found/i.test(text)) {
    return { count: 0, matches: [] }
  }
  const head = text.match(/^Found\s+(\d+)\s+memory match\(es\):/i)
  if (!head) return null
  const matches = []
  for (const rawLine of text.split('\n').slice(1)) {
    const line = rawLine.trim()
    if (!line.startsWith('- [')) continue
    const mm = line.match(/^-\s+\[([^\]]+)\]\s+(.+?)(?:\s+—\s+([\s\S]+))?$/)
    if (!mm) continue
    const meta = mm[1].split('|').map((s) => s.trim())
    const id = meta[0] || ''
    const category = (meta[1] || 'fact').toLowerCase()
    const pinned = meta.includes('pinned')
    let title = mm[2].trim()
    let summary = (mm[3] || '').trim()
    let tags = []
    const tagMatch = (summary || title).match(/\s+\(([^()]+)\)$/)
    if (tagMatch) {
      tags = tagMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
      if (summary) summary = summary.slice(0, tagMatch.index).trim()
      else title = title.slice(0, tagMatch.index).trim()
    }
    matches.push({ id, category, pinned, title, summary, tags })
  }
  return { count: Number(head[1]) || matches.length, matches }
}

function smemTvParseGetOutput(outputText) {
  const text = String(outputText || '').trim()
  if (!text) return null
  if (/^No memories found/i.test(text)) return []
  if (!text.startsWith('### [')) return null
  const chunks = text.split(/\n\n---\n\n/)
  const entries = []
  for (const chunk of chunks) {
    const lines = chunk.trim().split('\n')
    const hm = (lines[0] || '').match(/^###\s+\[([^\]]+)\]\s+(.+?)\s+\(([^,)]+)(?:,\s*source:\s*([^)]+))?\)$/i)
    if (!hm) continue
    let bodyStart = 1
    let tags = []
    if ((lines[1] || '').startsWith('Tags:')) {
      tags = lines[1].replace(/^Tags:\s*/i, '').split(',').map((s) => s.trim()).filter(Boolean)
      bodyStart = 2
    }
    entries.push({
      id: hm[1],
      title: hm[2].trim(),
      category: hm[3].trim().toLowerCase(),
      source: (hm[4] || '').trim().toLowerCase(),
      tags,
      content: lines.slice(bodyStart).join('\n').trim(),
    })
  }
  return entries.length > 0 ? entries : null
}

function smemTvParseDeleteOutput(outputText) {
  const text = String(outputText || '').trim()
  const m = text.match(/^Deleted memory\s+\[([^\]]+)\]\s+\("([^"]*)"\)\.?$/i)
  if (!m) return null
  return { id: m[1], title: m[2] }
}

function smemTvParseEnvSnapshotOutput(outputText) {
  const text = String(outputText || '').trim()
  if (!text || !text.includes('Sandbox:')) return null
  const data = {
    slug: '',
    home: '',
    publicUrl: '',
    appsBase: '',
    portProxyBase: '',
    toolchains: [],
    projects: [],
    services: [],
    routes: [],
    cron: [],
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    let m
    if ((m = line.match(/^Sandbox:\s*slug=([^,]+),\s*home=(.+)$/i))) {
      data.slug = m[1].trim()
      data.home = m[2].trim()
    } else if ((m = line.match(/^Public URL:\s*(.+)$/i))) {
      data.publicUrl = m[1].trim()
    } else if ((m = line.match(/^Apps Base:\s*([^|]+)(?:\|\s*Port Proxy:\s*(.+))?$/i))) {
      data.appsBase = m[1].trim()
      data.portProxyBase = (m[2] || '').trim()
    } else if ((m = line.match(/^Toolchains\s*\(\d+\):\s*(.+)$/i))) {
      if (m[1].trim() !== '(none)') {
        data.toolchains = m[1].split(',').map((s) => s.trim()).filter(Boolean)
      }
    } else if ((m = line.match(/^Projects\s*\(\d+\):\s*(.+)$/i))) {
      if (m[1].trim() !== '(none)') {
        data.projects = m[1].split(/,\s*(?![^\[]*\])/).map((raw) => {
          const pm = raw.trim().match(/^([^\[]+?)(?:\s*\[([^\]]+)\])?$/)
          return {
            name: (pm?.[1] || raw).trim(),
            stacks: pm?.[2] ? pm[2].split(',').map((x) => x.trim()).filter(Boolean) : [],
          }
        }).filter((p) => p.name)
      }
    } else if ((m = line.match(/^Services\s*\(\d+\):\s*(.+)$/i))) {
      if (m[1].trim() !== '(none)') {
        data.services = m[1].split('|').map((raw) => {
          const sm = raw.trim().match(/^([^\s(]+)\s*\(([^)]+)\)(?:\s*->\s*(.+))?$/)
          return sm
            ? { name: sm[1], status: sm[2].toLowerCase(), command: (sm[3] || '').trim() }
            : { name: raw.trim(), status: 'unknown', command: '' }
        }).filter((s) => s.name)
      }
    } else if ((m = line.match(/^Exposed Routes\s*\(\d+\):\s*(.+)$/i))) {
      if (m[1].trim() !== '(none)') {
        data.routes = m[1].split('|').map((raw) => {
          const rm = raw.trim().match(/^([^\s]+)\s*->\s*([^\s(]+)(?:\s*\(([^)]+)\))?$/)
          return rm
            ? { name: rm[1], target: rm[2], publicUrl: (rm[3] || '').trim() }
            : { name: raw.trim(), target: '', publicUrl: '' }
        }).filter((r) => r.name)
      }
    } else if ((m = line.match(/^Cron Jobs\s*\(\d+\):\s*(.+)$/i))) {
      if (m[1].trim() !== '(none)') {
        data.cron = m[1].split(';').map((s) => s.trim()).filter(Boolean)
      }
    }
  }
  return data
}

export function createMemoryToolView({ React, getLocale, subscribeLocale }) {
  const h = React.createElement

  return function MemoryToolView(props) {
    const [langTick, setLangTick] = React.useState(0)
    const [localOpen, setLocalOpen] = React.useState(false)
    const disclosure = typeof props.useDisclosure === 'function' ? props.useDisclosure() : null
    const expanded = disclosure ? Boolean(disclosure.expanded) : localOpen
    const toggleExpand = disclosure ? disclosure.toggle : () => setLocalOpen((v) => !v)

    React.useEffect(() => {
      if (typeof subscribeLocale !== 'function') return undefined
      return subscribeLocale(() => setLangTick((n) => n + 1))
    }, [])
    void langTick

    const t = createTranslator(typeof getLocale === 'function' ? getLocale() : 'en')
    const block = props.block || {}
    const name = String(props.toolName || block?.call?.name || block?.name || '').trim()
    const isDone = props.phase === 'result' || props.phase === 'done' || ('kind' in block)
    const isRunning = !isDone
    const args = parseMemoryToolArgsSafe(block)
    const outputText = isDone ? smemTvExtractOutputText(block) : ''
    const isFailedText = /^(?:memory_save|memory_update|memory_delete) failed:/i.test(outputText)
    const isError = Boolean(isDone && (block?.isError || block?.error || isFailedText))

    const parsedSave = (name === 'memory_save' || name === 'memory_update') ? smemTvParseSaveOutput(outputText) : null
    const parsedSearch = name === 'memory_search' ? smemTvParseSearchOutput(outputText) : null
    const parsedGet = name === 'memory_get' ? smemTvParseGetOutput(outputText) : null
    const parsedDelete = name === 'memory_delete' ? smemTvParseDeleteOutput(outputText) : null
    const parsedEnv = name === 'env_snapshot' ? smemTvParseEnvSnapshotOutput(outputText) : null

    const argTitle = smemTvAsString(args.title).trim()
    const argSummary = smemTvAsString(args.summary).trim()
    const argContent = smemTvAsString(args.content).trim()
    const argCategory = smemTvAsString(args.category).trim().toLowerCase()
    const argQuery = smemTvAsString(args.query).trim()
    const argId = smemTvAsString(args.id).trim()
    const argIds = smemTvAsStringArray(args.ids)
    const argTags = smemTvAsStringArray(args.tags)
    const argPinned = Boolean(args.pinned)

    let titleKey = 'toolSaveTitle'
    let iconEl = h(MemoryNavIcon, { React, size: 14 })
    let preview = ''
    let headBadge = null

    const effCategory = argCategory || parsedSave?.category || ''

    if (name === 'memory_save') {
      titleKey = parsedSave?.action === 'updated' ? 'toolUpdateTitle' : 'toolSaveTitle'
      iconEl = h(SparkleIcon, { React, size: 14 })
      preview = argTitle || parsedSave?.title || argSummary || parsedSave?.summary || ''
      if (effCategory) {
        headBadge = h('span', { className: `smem-badge cat-${effCategory}` }, smemTvCategoryLabel(effCategory, t))
      }
    } else if (name === 'memory_update') {
      titleKey = 'toolUpdateTitle'
      iconEl = h(SparkleIcon, { React, size: 14 })
      preview = argTitle || parsedSave?.title || argSummary || argId || ''
      if (effCategory) {
        headBadge = h('span', { className: `smem-badge cat-${effCategory}` }, smemTvCategoryLabel(effCategory, t))
      }
    } else if (name === 'memory_delete') {
      titleKey = 'toolDeleteTitle'
      iconEl = h(TrashIcon, { React, size: 14 })
      preview = parsedDelete?.title || argId || parsedDelete?.id || ''
    } else if (name === 'memory_search') {
      titleKey = 'toolSearchTitle'
      iconEl = h(SearchIcon, { React, size: 14 })
      preview = argQuery ? `「${argQuery}」` : (effCategory ? smemTvCategoryLabel(effCategory, t) : '')
      if (parsedSearch) {
        headBadge = h('span', { className: 'smem-badge' }, t('toolMatchesCount', { count: parsedSearch.count }))
      }
    } else if (name === 'memory_get') {
      titleKey = 'toolGetTitle'
      iconEl = h(MemoryNavIcon, { React, size: 14 })
      if (parsedGet && parsedGet.length > 0) {
        headBadge = h('span', { className: 'smem-badge' }, t('toolEntriesCount', { count: parsedGet.length }))
        preview = parsedGet.map((e) => e.title).filter(Boolean).join(' · ')
      } else {
        preview = argIds.length > 0 ? argIds.join(', ') : argId
      }
    } else if (name === 'env_snapshot') {
      titleKey = 'toolEnvTitle'
      iconEl = h(ServerIcon, { React, size: 14 })
      if (parsedEnv) {
        preview = t('toolEnvSummary', {
          projects: parsedEnv.projects.length,
          toolchains: parsedEnv.toolchains.length,
          services: parsedEnv.services.length,
        })
      }
    }

    const statusText = isRunning ? t('toolRunning') : (isError ? t('toolFailed') : t('toolDone'))
    const statusClass = isRunning ? 'running' : (isError ? 'error' : 'ok')
    const hasDetails = Boolean(
      argTitle || argSummary || argContent || argQuery || argId || argIds.length > 0 || outputText,
    )
    const keyBase = `smem-${props.callId || name}`

    const renderBody = () => {
      if (isError) {
        return h('div', { className: 'smem-tool-error' }, outputText || t('toolFailed'))
      }

      // 1. memory_save / memory_update
      if (name === 'memory_save' || name === 'memory_update') {
        const displayTitle = argTitle || parsedSave?.title || ''
        const displaySummary = argSummary || parsedSave?.summary || ''
        const displayId = parsedSave?.id || argId
        return h(
          'div',
          { className: 'smem-tool-entry' },
          h(
            'div',
            { className: 'smem-tool-meta' },
            displayTitle ? h('span', { className: 'smem-tool-entry-title' }, displayTitle) : null,
            effCategory
              ? h('span', { className: `smem-badge cat-${effCategory}` }, smemTvCategoryLabel(effCategory, t))
              : null,
            argPinned ? h('span', { className: 'smem-badge pin' }, t('badgePinned')) : null,
            parsedSave?.redacted ? h('span', { className: 'smem-badge' }, t('toolRedactedHint')) : null,
            displayId ? h('span', { className: 'smem-tool-id' }, displayId) : null,
          ),
          displaySummary ? h('div', { className: 'smem-tool-entry-summary' }, displaySummary) : null,
          argContent ? smemTvRenderMarkdown(h, argContent, `${keyBase}-cnt`) : null,
          argTags.length > 0
            ? h('div', { className: 'smem-tags' }, ...argTags.map((tg) => h('span', { key: tg, className: 'smem-tag' }, `#${tg}`)))
            : null,
        )
      }

      // 2. memory_search
      if (name === 'memory_search') {
        const items = parsedSearch?.matches || []
        return h(
          React.Fragment || 'div',
          null,
          (argQuery || effCategory)
            ? h(
                'div',
                { className: 'smem-tool-meta' },
                argQuery ? h('span', { className: 'smem-badge' }, `${t('toolQueryLabel')}: ${argQuery}`) : null,
                effCategory ? h('span', { className: `smem-badge cat-${effCategory}` }, smemTvCategoryLabel(effCategory, t)) : null,
              )
            : null,
          items.length === 0
            ? h('div', { className: 'smem-tool-muted' }, t('toolNoMatches'))
            : items.map((m, idx) =>
                h(
                  'div',
                  { key: m.id || idx, className: 'smem-tool-entry' },
                  h(
                    'div',
                    { className: 'smem-tool-meta' },
                    h('span', { className: `smem-badge cat-${m.category}` }, smemTvCategoryLabel(m.category, t)),
                    m.pinned ? h('span', { className: 'smem-badge pin' }, t('badgePinned')) : null,
                    h('span', { className: 'smem-tool-entry-title' }, m.title),
                    m.id ? h('span', { className: 'smem-tool-id' }, m.id) : null,
                  ),
                  m.summary ? h('div', { className: 'smem-tool-entry-summary' }, m.summary) : null,
                  m.tags.length > 0
                    ? h('div', { className: 'smem-tags' }, ...m.tags.map((tg) => h('span', { key: tg, className: 'smem-tag' }, `#${tg}`)))
                    : null,
                ),
              ),
        )
      }

      // 3. memory_get
      if (name === 'memory_get' && parsedGet) {
        if (parsedGet.length === 0) {
          return h('div', { className: 'smem-tool-muted' }, t('toolNoMatches'))
        }
        return parsedGet.map((entry, idx) =>
          h(
            'div',
            { key: entry.id || idx, className: 'smem-tool-entry' },
            h(
              'div',
              { className: 'smem-tool-meta' },
              h('span', { className: 'smem-tool-entry-title' }, entry.title),
              entry.category
                ? h('span', { className: `smem-badge cat-${entry.category}` }, smemTvCategoryLabel(entry.category, t))
                : null,
              entry.source
                ? h('span', { className: `smem-badge src-${entry.source}` }, smemTvSourceLabel(entry.source, t))
                : null,
              entry.id ? h('span', { className: 'smem-tool-id' }, entry.id) : null,
            ),
            entry.tags.length > 0
              ? h('div', { className: 'smem-tags' }, ...entry.tags.map((tg) => h('span', { key: tg, className: 'smem-tag' }, `#${tg}`)))
              : null,
            entry.content ? smemTvRenderMarkdown(h, entry.content, `${keyBase}-get-${idx}`) : null,
          ),
        )
      }

      // 4. memory_delete
      if (name === 'memory_delete') {
        const delTitle = parsedDelete?.title || ''
        const delId = parsedDelete?.id || argId
        return h(
          'div',
          { className: 'smem-tool-entry' },
          h(
            'div',
            { className: 'smem-tool-meta' },
            delTitle ? h('span', { className: 'smem-tool-entry-title' }, delTitle) : null,
            delId ? h('span', { className: 'smem-tool-id' }, delId) : null,
            h('span', { className: 'smem-tool-muted' }, t('toolDeletedConfirm')),
          ),
        )
      }

      // 5. env_snapshot
      if (name === 'env_snapshot' && parsedEnv) {
        return h(
          React.Fragment || 'div',
          null,
          h(
            'div',
            { className: 'smem-tool-env-section' },
            h('div', { className: 'smem-tool-section-label' }, t('toolEnvSectionUrls')),
            h(
              'div',
              { className: 'smem-kv-list' },
              parsedEnv.slug
                ? h('div', { className: 'smem-kv-row' }, h('span', { className: 'smem-kv-key' }, t('envLabelSlug')), h('span', { className: 'smem-kv-val' }, parsedEnv.slug))
                : null,
              parsedEnv.home
                ? h('div', { className: 'smem-kv-row' }, h('span', { className: 'smem-kv-key' }, t('envLabelHome')), h('span', { className: 'smem-kv-val' }, parsedEnv.home))
                : null,
              parsedEnv.publicUrl
                ? h(
                    'div',
                    { className: 'smem-kv-row' },
                    h('span', { className: 'smem-kv-key' }, t('envLabelPublicUrl')),
                    h('a', { className: 'smem-tool-link', href: parsedEnv.publicUrl, target: '_blank', rel: 'noopener noreferrer' }, parsedEnv.publicUrl),
                  )
                : null,
            ),
          ),
          parsedEnv.toolchains.length > 0
            ? h(
                'div',
                { className: 'smem-tool-env-section' },
                h('div', { className: 'smem-tool-section-label' }, `${t('toolEnvSectionToolchains')} (${parsedEnv.toolchains.length})`),
                h('div', { className: 'smem-chip-wrap' }, ...parsedEnv.toolchains.map((tc) => h('span', { key: tc, className: 'smem-chip' }, tc))),
              )
            : null,
          parsedEnv.projects.length > 0
            ? h(
                'div',
                { className: 'smem-tool-env-section' },
                h('div', { className: 'smem-tool-section-label' }, `${t('toolEnvSectionProjects')} (${parsedEnv.projects.length})`),
                h(
                  'div',
                  { className: 'smem-chip-wrap' },
                  ...parsedEnv.projects.map((p) =>
                    h('span', { key: p.name, className: 'smem-chip' }, p.stacks.length > 0 ? `${p.name} · ${p.stacks.join(', ')}` : p.name),
                  ),
                ),
              )
            : null,
          parsedEnv.services.length > 0
            ? h(
                'div',
                { className: 'smem-tool-env-section' },
                h('div', { className: 'smem-tool-section-label' }, `${t('toolEnvSectionServices')} (${parsedEnv.services.length})`),
                h(
                  'div',
                  { className: 'smem-kv-list' },
                  ...parsedEnv.services.map((sv) =>
                    h(
                      'div',
                      { key: sv.name, className: 'smem-kv-row' },
                      h(
                        'span',
                        { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 550 } },
                        h('span', { className: `smem-dot ${sv.status}` }),
                        sv.name,
                        h('span', { className: 'smem-badge' }, sv.status),
                      ),
                      sv.command ? h('span', { className: 'smem-kv-val' }, sv.command) : null,
                    ),
                  ),
                ),
              )
            : null,
          parsedEnv.routes.length > 0
            ? h(
                'div',
                { className: 'smem-tool-env-section' },
                h('div', { className: 'smem-tool-section-label' }, `${t('toolEnvSectionRoutes')} (${parsedEnv.routes.length})`),
                h(
                  'div',
                  { className: 'smem-kv-list' },
                  ...parsedEnv.routes.map((rt) =>
                    h(
                      'div',
                      { key: rt.name, className: 'smem-kv-row' },
                      h('span', { style: { fontWeight: 550 } }, rt.name),
                      rt.publicUrl
                        ? h('a', { className: 'smem-tool-link', href: rt.publicUrl, target: '_blank', rel: 'noopener noreferrer' }, rt.publicUrl)
                        : h('span', { className: 'smem-kv-val' }, rt.target),
                    ),
                  ),
                ),
              )
            : null,
          parsedEnv.cron.length > 0
            ? h(
                'div',
                { className: 'smem-tool-env-section' },
                h('div', { className: 'smem-tool-section-label' }, `${t('toolEnvSectionCron')} (${parsedEnv.cron.length})`),
                h('div', { className: 'smem-chip-wrap' }, ...parsedEnv.cron.map((cj, ci) => h('span', { key: ci, className: 'smem-chip' }, cj))),
              )
            : null,
        )
      }

      return outputText ? smemTvRenderMarkdown(h, outputText, `${keyBase}-raw`) : null
    }

    return h(
      'div',
      { className: `smem-tool-card ${statusClass}` },
      h(
        'div',
        {
          className: 'smem-tool-head',
          role: 'button',
          tabIndex: 0,
          onClick: () => { if (hasDetails) toggleExpand() },
          onKeyDown: (e) => {
            if (hasDetails && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              toggleExpand()
            }
          },
        },
        h(
          'div',
          { className: 'smem-tool-head-left' },
          hasDetails ? h(ChevronIcon, { React, size: 12, expanded }) : null,
          h('span', { className: 'smem-tool-icon' }, iconEl),
          h('span', { className: 'smem-tool-title' }, t(titleKey)),
          headBadge,
          preview ? h('span', { className: 'smem-tool-preview' }, preview) : null,
        ),
        h(
          'span',
          { className: `smem-tool-status ${statusClass}` },
          statusText,
        ),
      ),
      expanded && hasDetails
        ? h('div', { className: 'smem-tool-body' }, renderBody())
        : null,
    )
  }
}
