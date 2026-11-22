import { createTranslator } from './locale.js'
import { ChevronIcon, MemoryNavIcon, SearchIcon, ServerIcon, SparkleIcon, TrashIcon } from './icons.js'

function parseToolArgsSafe(block) {
  if (!block || typeof block !== 'object') return {}
  const direct = block.call?.args ?? block.args
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct
  const raw = block.call?.argsRaw ?? block.argsRaw ?? ''
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {}
  }
  return {}
}

function extractOutputText(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.content)) return ''
  return block.content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string' && item.text.trim())
    .map((item) => item.text.trim())
    .join('\n')
}

export function createMemoryToolView({ React, getLocale, subscribeLocale }) {
  const h = React.createElement

  return function MemoryToolView({ toolName, phase, block }) {
    const [langTick, setLangTick] = React.useState(0)
    const [expanded, setExpanded] = React.useState(false)

    React.useEffect(() => {
      if (typeof subscribeLocale !== 'function') return undefined
      return subscribeLocale(() => setLangTick((n) => n + 1))
    }, [])
    void langTick

    const t = createTranslator(typeof getLocale === 'function' ? getLocale() : 'en')
    const name = String(toolName || block?.call?.name || '').trim()
    const args = parseToolArgsSafe(block)
    const outputText = extractOutputText(block)
    const isError = Boolean(block?.isError)
    const isRunning = phase === 'call' || phase === 'running' || phase === 'pending'

    let titleKey = 'toolSaveTitle'
    let iconEl = h(MemoryNavIcon, { React, size: 14 })
    let preview = ''

    if (name === 'memory_save') {
      titleKey = 'toolSaveTitle'
      iconEl = h(SparkleIcon, { React, size: 14 })
      preview = args.title || args.summary || ''
    } else if (name === 'memory_update') {
      titleKey = 'toolUpdateTitle'
      iconEl = h(SparkleIcon, { React, size: 14 })
      preview = args.title || args.id || ''
    } else if (name === 'memory_delete') {
      titleKey = 'toolDeleteTitle'
      iconEl = h(TrashIcon, { React, size: 14 })
      preview = args.id || ''
    } else if (name === 'memory_search') {
      titleKey = 'toolSearchTitle'
      iconEl = h(SearchIcon, { React, size: 14 })
      preview = args.query ? `"${args.query}"` : (args.category || '')
    } else if (name === 'memory_get') {
      titleKey = 'toolGetTitle'
      iconEl = h(MemoryNavIcon, { React, size: 14 })
      preview = Array.isArray(args.ids) ? args.ids.join(', ') : (args.id || '')
    } else if (name === 'env_snapshot') {
      titleKey = 'toolEnvTitle'
      iconEl = h(ServerIcon, { React, size: 14 })
      preview = outputText.split('\n')[0] || ''
    }

    const statusText = isRunning ? t('toolRunning') : (isError ? t('toolFailed') : t('toolDone'))
    const categoryBadge = args.category
      ? h('span', { className: `smem-badge cat-${String(args.category).toLowerCase()}` }, String(args.category))
      : null

    return h(
      'div',
      { className: 'smem-tool-card' },
      h(
        'div',
        {
          className: 'smem-tool-head',
          role: 'button',
          tabIndex: 0,
          onClick: () => setExpanded((v) => !v),
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setExpanded((v) => !v)
            }
          },
        },
        h(
          'div',
          { className: 'smem-tool-head-left' },
          iconEl,
          h('span', { className: 'smem-tool-title' }, t(titleKey)),
          categoryBadge,
          preview ? h('span', { className: 'smem-tool-preview' }, preview) : null,
        ),
        h(
          'div',
          { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0 } },
          h('span', { className: `smem-badge${isError ? '' : ' src-agent'}` }, statusText),
          outputText ? h(ChevronIcon, { React, size: 13, expanded }) : null,
        ),
      ),
      expanded && outputText
        ? h('div', { className: 'smem-tool-body' }, outputText)
        : null,
    )
  }
}
