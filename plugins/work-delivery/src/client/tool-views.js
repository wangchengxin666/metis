import { createTranslator } from './locale.js'
import { ChevronIcon, WorkDeliveryNavIcon } from './icons.js'

function wdTvIsPartialArguments(obj) {
  return Boolean(
    obj
    && typeof obj === 'object'
    && !Array.isArray(obj)
    && typeof obj.text === 'function'
    && typeof obj.value === 'function'
    && typeof obj.keys === 'function',
  )
}

function wdTvReadPartialArguments(pa) {
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

function wdTvAsString(val) {
  return typeof val === 'string' ? val : ''
}

export function parseWorkDeliveryToolArgsSafe(block) {
  if (!block || typeof block !== 'object') return {}

  const raw = block.call?.argsRaw ?? block.argsRaw ?? ''
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {}
  }

  const direct = block.call?.args ?? block.args
  if (wdTvIsPartialArguments(direct)) {
    return wdTvReadPartialArguments(direct)
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

function wdTvExtractOutputText(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.content)) return ''
  return block.content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string' && item.text.trim())
    .map((item) => item.text.trim())
    .join('\n')
}

function wdTvParseOverviewOutput(outputText) {
  const text = String(outputText || '').trim()
  if (!text || !text.startsWith('Work & Delivery Overview')) return null
  const out = {
    header: '',
    activeTasks: 0,
    doneTasks: 0,
    pendingApproval: 0,
    pages: [],
    services: [],
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    let m
    if ((m = line.match(/^Work & Delivery Overview\s*\(([^)]+)\)/i))) {
      out.header = m[1].trim()
    } else if ((m = line.match(/^-\s*Tasks:\s*(\d+)\s+active,\s*(\d+)\s+done,\s*(\d+)\s+pending approval/i))) {
      out.activeTasks = Number(m[1]) || 0
      out.doneTasks = Number(m[2]) || 0
      out.pendingApproval = Number(m[3]) || 0
    } else if ((m = line.match(/^-\s*Published Pages\s*\(\d+\):\s*(.+)$/i))) {
      if (m[1].trim().toLowerCase() !== 'none') {
        out.pages = m[1].split(';').map((raw) => {
          const pm = raw.trim().match(/^([^\s]+)\s*->\s*(.+)$/)
          return pm ? { name: pm[1].trim(), url: pm[2].trim() } : { name: raw.trim(), url: '' }
        }).filter((p) => p.name)
      }
    } else if ((m = line.match(/^-\s*Background Services\s*\(\d+\):\s*(.+)$/i))) {
      if (m[1].trim().toLowerCase() !== 'none') {
        out.services = m[1].split(';').map((raw) => {
          const sm = raw.trim().match(/^([^\s(]+)\s*\(([^)]+)\)$/)
          return sm ? { name: sm[1].trim(), status: sm[2].trim().toLowerCase() } : { name: raw.trim(), status: 'unknown' }
        }).filter((s) => s.name)
      }
    }
  }
  return out
}

function wdTvParseTaskCreateOutput(outputText) {
  const text = String(outputText || '').trim()
  const m = text.match(/^Created task\s+#([^:]+):\s*"([^"]*)"(\s*\(pending human approval\))?$/i)
  if (!m) return null
  return {
    taskId: m[1].trim(),
    title: m[2],
    approvalRequired: Boolean(m[3]),
  }
}

function wdTvPriorityLabel(priority, t) {
  const p = String(priority || '').toLowerCase()
  if (p === 'urgent') return { label: t('toolPriorityUrgent'), cls: 'wd-badge-warn' }
  if (p === 'high') return { label: t('toolPriorityHigh'), cls: 'wd-badge-warn' }
  if (p === 'low') return { label: t('toolPriorityLow'), cls: '' }
  if (p === 'normal') return { label: t('toolPriorityNormal'), cls: '' }
  return null
}

export function createWorkDeliveryToolView({ React, getLocale, subscribeLocale }) {
  const h = React.createElement

  return function WorkDeliveryToolView(props) {
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

    const rawLocale = typeof getLocale === 'function' ? getLocale() : 'en'
    const t = createTranslator(rawLocale)
    const block = props.block || {}
    const name = String(props.toolName || block?.call?.name || block?.name || '').trim()
    const isDone = props.phase === 'result' || props.phase === 'done' || ('kind' in block)
    const isRunning = !isDone
    const args = parseWorkDeliveryToolArgsSafe(block)
    const outputText = isDone ? wdTvExtractOutputText(block) : ''
    const isFailedText = /^Failed to create task:/i.test(outputText)
    const isError = Boolean(isDone && (block?.isError || block?.error || isFailedText))

    const parsedOverview = name === 'delivery_overview' ? wdTvParseOverviewOutput(outputText) : null
    const parsedCreate = name === 'delivery_task_create' ? wdTvParseTaskCreateOutput(outputText) : null

    const argTitle = wdTvAsString(args.title).trim()
    const argDesc = wdTvAsString(args.description).trim()
    const argPriority = wdTvAsString(args.priority).trim()
    const argApproval = Boolean(args.approvalRequired || parsedCreate?.approvalRequired)

    const titleKey = name === 'delivery_task_create' ? 'toolTaskCreateTitle' : 'toolOverviewTitle'
    let preview = ''
    if (name === 'delivery_task_create') {
      preview = argTitle || parsedCreate?.title || ''
    } else if (parsedOverview) {
      preview = t('toolSummaryCounts', {
        active: parsedOverview.activeTasks,
        done: parsedOverview.doneTasks,
        pages: parsedOverview.pages.length,
      })
    } else if (outputText) {
      preview = outputText.split('\n')[0] || ''
    }

    const statusText = isRunning ? t('toolRunning') : (isError ? t('toolFailed') : t('toolDone'))
    const statusClass = isRunning ? 'running' : (isError ? 'error' : 'ok')
    const hasDetails = Boolean(argTitle || argDesc || outputText)

    const renderBody = () => {
      if (isError) {
        return h('div', { className: 'wd-tool-error' }, outputText || t('toolFailed'))
      }

      if (name === 'delivery_overview' && parsedOverview) {
        return h(
          React.Fragment || 'div',
          null,
          h(
            'div',
            { className: 'wd-tool-metrics' },
            h('div', { className: 'wd-tool-metric' }, h('span', null, t('toolMetricActive')), h('strong', null, String(parsedOverview.activeTasks))),
            h('div', { className: 'wd-tool-metric' }, h('span', null, t('toolMetricDone')), h('strong', null, String(parsedOverview.doneTasks))),
            parsedOverview.pendingApproval > 0
              ? h('div', { className: 'wd-tool-metric' }, h('span', null, t('toolMetricApproval')), h('strong', null, String(parsedOverview.pendingApproval)))
              : null,
            h('div', { className: 'wd-tool-metric' }, h('span', null, t('toolMetricPages')), h('strong', null, String(parsedOverview.pages.length))),
            h('div', { className: 'wd-tool-metric' }, h('span', null, t('toolMetricServices')), h('strong', null, String(parsedOverview.services.length))),
          ),
          parsedOverview.pages.length > 0
            ? h(
                'div',
                { className: 'wd-tool-box' },
                h('div', { className: 'wd-tool-section-label' }, t('toolMetricPages')),
                ...parsedOverview.pages.map((p) =>
                  h(
                    'div',
                    { key: p.name, className: 'wd-tool-row' },
                    h('strong', null, p.name),
                    /^https?:\/\//i.test(p.url)
                      ? h('a', { className: 'wd-tool-link', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.url)
                      : h('span', { className: 'wd-mono' }, p.url),
                  ),
                ),
              )
            : null,
          parsedOverview.services.length > 0
            ? h(
                'div',
                { className: 'wd-tool-box' },
                h('div', { className: 'wd-tool-section-label' }, t('toolMetricServices')),
                ...parsedOverview.services.map((sv) =>
                  h(
                    'div',
                    { key: sv.name, className: 'wd-tool-row' },
                    h(
                      'span',
                      { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 550 } },
                      h('span', { className: `wd-tool-dot ${sv.status}` }),
                      sv.name,
                    ),
                    h('span', { className: `wd-badge${sv.status === 'running' ? ' wd-badge-ok' : ''}` }, sv.status),
                  ),
                ),
              )
            : null,
        )
      }

      if (name === 'delivery_task_create') {
        const displayTitle = argTitle || parsedCreate?.title || ''
        const prio = wdTvPriorityLabel(argPriority, t)
        return h(
          'div',
          { className: 'wd-tool-box' },
          h(
            'div',
            { className: 'wd-tool-row' },
            h(
              'span',
              { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
              displayTitle ? h('strong', null, displayTitle) : null,
              prio ? h('span', { className: `wd-badge ${prio.cls}` }, prio.label) : null,
              argApproval ? h('span', { className: 'wd-badge wd-badge-warn' }, t('toolApprovalRequiredBadge')) : null,
            ),
            parsedCreate?.taskId ? h('span', { className: 'wd-mono' }, `#${parsedCreate.taskId}`) : null,
          ),
          argDesc ? h('div', { style: { color: 'var(--dsw-alias-label-secondary, #6b7280)', whiteSpace: 'pre-wrap' } }, argDesc) : null,
        )
      }

      return outputText ? h('div', { style: { whiteSpace: 'pre-wrap' } }, outputText) : null
    }

    return h(
      'div',
      { className: `wd-tool-card ${statusClass}` },
      h(
        'div',
        {
          className: 'wd-tool-head',
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
          { className: 'wd-tool-head-left' },
          hasDetails ? h(ChevronIcon, { React, size: 12, expanded }) : null,
          h('span', { className: 'wd-tool-icon' }, h(WorkDeliveryNavIcon, { React, size: 14 })),
          h('span', { className: 'wd-tool-title' }, t(titleKey)),
          argApproval && name === 'delivery_task_create'
            ? h('span', { className: 'wd-badge wd-badge-warn' }, t('toolApprovalRequiredBadge'))
            : null,
          preview ? h('span', { className: 'wd-tool-preview' }, preview) : null,
        ),
        h(
          'span',
          { className: `wd-tool-status ${statusClass}` },
          statusText,
        ),
      ),
      expanded && hasDetails
        ? h('div', { className: 'wd-tool-body' }, renderBody())
        : null,
    )
  }
}
