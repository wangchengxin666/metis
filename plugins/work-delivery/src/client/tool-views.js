import { createTranslator } from './locale.js'
import { ChevronIcon, WorkDeliveryNavIcon } from './icons.js'

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

export function createWorkDeliveryToolView({ React, getLocale, subscribeLocale }) {
  const h = React.createElement

  return function WorkDeliveryToolView({ toolName, phase, block }) {
    const [langTick, setLangTick] = React.useState(0)
    const [expanded, setExpanded] = React.useState(false)

    React.useEffect(() => {
      if (typeof subscribeLocale !== 'function') return undefined
      return subscribeLocale(() => setLangTick((n) => n + 1))
    }, [])
    void langTick

    const rawLocale = typeof getLocale === 'function' ? getLocale() : 'en'
    const t = createTranslator(rawLocale)
    const name = String(toolName || block?.call?.name || '').trim()
    const args = parseToolArgsSafe(block)
    const outputText = extractOutputText(block)
    const isError = Boolean(block?.isError)
    const isRunning = phase === 'call' || phase === 'running' || phase === 'pending'

    const titleKey = name === 'delivery_task_create' ? 'toolTaskCreateTitle' : 'toolOverviewTitle'
    const preview = name === 'delivery_task_create'
      ? (args.title || '')
      : (outputText.split('\n')[0] || '')

    const statusText = isRunning ? t('toolRunning') : (isError ? t('toolFailed') : t('toolDone'))

    return h(
      'div',
      { className: 'wd-tool-card' },
      h(
        'div',
        {
          className: 'wd-tool-head',
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
          { className: 'wd-tool-head-left' },
          h(WorkDeliveryNavIcon, { React, size: 15 }),
          h('span', { className: 'wd-tool-title' }, t(titleKey)),
          preview ? h('span', { className: 'wd-tool-preview' }, preview) : null,
        ),
        h(
          'div',
          { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', flexShrink: 0 } },
          h('span', { className: `wd-badge${isError ? '' : ' wd-badge-ok'}` }, statusText),
          outputText ? h(ChevronIcon, { React, size: 13, expanded }) : null,
        ),
      ),
      expanded && outputText
        ? h('div', { className: 'wd-tool-body' }, outputText)
        : null,
    )
  }
}
