import {
  AgentIcon,
  CheckIcon,
  CopyIcon,
  FileDocIcon,
  ModeratorCrownIcon,
} from './icons.js'

const AVATAR_PALETTE = [
  { bg: 'rgba(14, 165, 233, 0.16)', fg: '#0284c7', border: 'rgba(14, 165, 233, 0.34)' },
  { bg: 'rgba(139, 92, 246, 0.16)', fg: '#7c3aed', border: 'rgba(139, 92, 246, 0.34)' },
  { bg: 'rgba(16, 185, 129, 0.16)', fg: '#059669', border: 'rgba(16, 185, 129, 0.34)' },
  { bg: 'rgba(245, 158, 11, 0.16)', fg: '#d97706', border: 'rgba(245, 158, 11, 0.34)' },
  { bg: 'rgba(236, 72, 153, 0.16)', fg: '#db2777', border: 'rgba(236, 72, 153, 0.34)' },
  { bg: 'rgba(99, 102, 241, 0.16)', fg: '#4f46e5', border: 'rgba(99, 102, 241, 0.34)' },
]

export function avatarToneForSlug(slug) {
  const s = String(slug || 'sandbox')
  let hash = 0
  for (let i = 0; i < s.length; i += 1) {
    hash = ((hash * 31) + s.charCodeAt(i)) >>> 0
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n >= 10 * 1024 ? 0 : 1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function formatRelativeTime(ms, t) {
  if (!ms || typeof ms !== 'number') return ''
  const diffSec = Math.floor((Date.now() - ms) / 1000)
  if (diffSec < 45) return typeof t === 'function' ? t('timeJustNow') : 'just now'
  if (diffSec < 3600) {
    const mins = Math.max(1, Math.floor(diffSec / 60))
    return `${mins}${typeof t === 'function' ? t('timeMinsAgo') : 'm ago'}`
  }
  const d = new Date(ms)
  const now = new Date()
  const pad = (v) => String(v).padStart(2, '0')
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

/**
 * Strip Markdown punctuation, fenced code blocks, and verbose inline commands
 * to produce crisp single-line previews for room lists and collapsed delegation cards.
 */
export function stripMarkdownForPreview(rawText, maxLen = 88) {
  const raw = String(rawText || '')
  if (!raw.trim()) return ''
  const cleaned = raw
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`\n]{1,60})`/g, '$1')
    .replace(/`[^`\n]+`/g, '[code]')
    .replace(/node\s+-e\s+['"][\s\S]{24,}?['"]/g, '[script]')
    .replace(/@\[([^\]\n]+)\]\(dsh-mesh(?:-[a-z]+)?:[^)\s]+\)/g, '@$1')
    .replace(/\[([^\]\n]+)\]\((?:https?:\/\/|mailto:)[^)\s]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\|[-:\s|]+\|/g, ' ')
    .replace(/[*~]+/g, '')
    .replace(/(^|[\s(（【\[])_+([^_\n]+?)_+(?=[\s.,;:!?)\]）】]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= maxLen) return cleaned
  return `${cleaned.slice(0, Math.max(12, maxLen - 1)).trimEnd()}…`
}

/**
 * Localize stored English host system events so both historical and newly created rooms
 * display clean localized event pills.
 */
export function localizeSystemMessage(rawText, t) {
  const text = String(rawText || '').trim()
  if (!text || typeof t !== 'function') return text

  let m = text.match(/^Paired with (.+) via Traefik mesh\.?$/i)
  if (m) return `${t('sysPairedWith')} ${m[1]}`

  m = text.match(/^(.+) paired with this sandbox\.?$/i)
  if (m) return `${m[1]} ${t('sysPairedSelf')}`

  m = text.match(/^(.+) unpaired from this sandbox\.?$/i)
  if (m) return `${m[1]} ${t('sysUnpairedBy')}`

  m = text.match(/^Created group "([^"]+)" \(Moderator: (@[^)]+)\) with (.+)\.?$/i)
  if (m) return `${t('sysGroupCreated')}「${m[1]}」· ${t('moderatorBadge')} ${m[2]}`

  m = text.match(/^(.+) invited (.+) to the group\.?$/i)
  if (m) return `${m[1]} ${t('sysGroupInvited')} ${m[2]}`

  m = text.match(/^Removed (@[a-z0-9_-]+) from group(?:\s+after unpairing)?(?:\s*\([^)]*\))?\.?$/i)
  if (m) return `${m[1]} ${t('sysGroupRemoved')}`

  m = text.match(/^(@[a-z0-9_-]+) unpaired and was removed from the group(?:\s*\([^)]*\))?\.?$/i)
  if (m) return `${m[1]} ${t('sysGroupRemoved')}`

  m = text.match(/^(@[a-z0-9_-]+) left the group(?:\s*\([^)]*\))?\.?$/i)
  if (m) return `${m[1]} ${t('sysGroupLeft')}`

  m = text.match(/^Group creator (@[a-z0-9_-]+) (?:dissolved\/left the group|unpaired); this group is disconnected\.?$/i)
  if (m) return `${m[1]} ${t('sysGroupDissolved')}`

  m = text.match(/^Renamed group to "([^"]+)"\.?$/i)
  if (m) return `${t('sysGroupRenamed')}「${m[1]}」`

  return text
}

function isSafeLinkHref(rawUrl) {
  const str = String(rawUrl || '').trim()
  return /^(https?:\/\/|mailto:)/i.test(str) ? str : ''
}

/**
 * Render inline Markdown + Sandbox Mesh `@mention` & `#file` chips into React nodes (XSS-safe).
 */
export function renderInlineRichText(H, rawText, keyPrefix = 'in', depth = 0) {
  const text = String(rawText ?? '')
  if (!text) return ''
  if (depth > 4) return text

  const fakeReact = { createElement: H }
  const tokenRe = /`([^`\n]+)`|@\[([^\]\n]+)\]\(dsh-mesh(?:-[a-z]+)?:[^)\s]+\)|\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)|\*\*([^*\n]+(?:\*(?!\*)[^*\n]*)*)\*\*|~~([^~\n]+)~~|\*([^*\s\n][^*\n]*?[^*\s\n]|[^*\s\n])\*|(?<![a-zA-Z0-9_.-])@([a-zA-Z0-9_-]{2,64})|(?<![a-zA-Z0-9_/.-])#([^\s#,:;!?()[\]{}]+(?:\.[^\s#,:;!?()[\]{}]+|\/[^\s#,:;!?()[\]{}]*))/g

  const parts = []
  let lastIdx = 0
  let match
  let idx = 0

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index))
    }
    const k = `${keyPrefix}-${idx++}`
    if (match[1] !== undefined) {
      parts.push(H('code', { key: k, className: 'sm-md-inline-code' }, match[1]))
    } else if (match[2] !== undefined) {
      const label = match[2].replace(/^@/, '')
      parts.push(
        H(
          'span',
          { key: k, className: 'sm-inline-mention' },
          label === 'moderator'
            ? ModeratorCrownIcon({ React: fakeReact, size: 12 })
            : AgentIcon({ React: fakeReact, size: 12 }),
          `@${label}`,
        ),
      )
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const safeHref = isSafeLinkHref(match[4])
      if (safeHref) {
        parts.push(
          H(
            'a',
            {
              key: k,
              className: 'sm-md-link',
              href: safeHref,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            renderInlineRichText(H, match[3], `${k}a`, depth + 1),
          ),
        )
      } else {
        parts.push(match[0])
      }
    } else if (match[5] !== undefined) {
      parts.push(H('strong', { key: k }, renderInlineRichText(H, match[5], `${k}b`, depth + 1)))
    } else if (match[6] !== undefined) {
      parts.push(H('del', { key: k }, renderInlineRichText(H, match[6], `${k}s`, depth + 1)))
    } else if (match[7] !== undefined) {
      parts.push(H('em', { key: k }, renderInlineRichText(H, match[7], `${k}i`, depth + 1)))
    } else if (match[8] !== undefined) {
      const label = match[8].replace(/^@/, '')
      parts.push(
        H(
          'span',
          { key: k, className: 'sm-inline-mention' },
          label === 'moderator'
            ? ModeratorCrownIcon({ React: fakeReact, size: 12 })
            : AgentIcon({ React: fakeReact, size: 12 }),
          `@${label}`,
        ),
      )
    } else if (match[9] !== undefined) {
      if (/^[0-9a-fA-F]{3,8}$/.test(match[9])) {
        parts.push(match[0])
      } else {
        parts.push(
          H(
            'span',
            { key: k, className: 'sm-inline-file' },
            FileDocIcon({ React: fakeReact, size: 12 }),
            `#${match[9]}`,
          ),
        )
      }
    }
    lastIdx = match.index + match[0].length
  }

  if (parts.length === 0) return text
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx))
  }
  return parts
}

function splitTableRow(line) {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  const cells = []
  let cur = ''
  let inCode = false
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]
    if (ch === '`') {
      inCode = !inCode
      cur += ch
    } else if (ch === '\\' && i + 1 < trimmed.length && trimmed[i + 1] === '|') {
      cur += '|'
      i += 1
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

function isTableSeparatorLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed.includes('|') && !trimmed.includes('-')) return false
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(trimmed)
}

function parseTableAlignments(sepLine) {
  return splitTableRow(sepLine).map((cell) => {
    const c = cell.trim()
    const left = c.startsWith(':')
    const right = c.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}

function isBlockBoundary(lines, i) {
  const line = lines[i]
  if (line === undefined) return true
  const t = line.trim()
  if (!t) return true
  if (/^```/.test(t)) return true
  if (/^#{1,4}\s+/.test(t)) return true
  if (/^(?:---+|\*\*\*+|___+)$/.test(t)) return true
  if (/^>\s?/.test(t)) return true
  if (/^(?:[-*•]\s+|\d+[.)]\s+)/.test(t)) return true
  if (line.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) return true
  return false
}

/**
 * Full block + inline Markdown renderer for Sandbox Mesh chat bubbles & previews.
 * Zero external dependencies, XSS-safe (never uses innerHTML), preserves `@` and `#` chips.
 */
export function renderMarkdownMessage(
  H,
  rawText,
  {
    keyPrefix = 'md',
    onCopyCode = null,
    copiedCodeKey = '',
    t = null,
  } = {},
) {
  const source = String(rawText ?? '').replace(/\r\n?/g, '\n')
  if (!source.trim()) return ''

  const fakeReact = { createElement: H }
  const lines = source.split('\n')
  const blocks = []
  let i = 0
  let blockIdx = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i += 1
      continue
    }

    const bk = `${keyPrefix}-b${blockIdx++}`

    // 1. Fenced code block ```lang
    const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_+#.-]*)\s*$/)
    if (fenceMatch) {
      const lang = fenceMatch[1] || 'text'
      const codeLines = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      const codeText = codeLines.join('\n')
      const isCopied = copiedCodeKey && copiedCodeKey === bk
      blocks.push(
        H(
          'div',
          { key: bk, className: 'sm-md-codeblock' },
          H(
            'div',
            { className: 'sm-md-code-head' },
            H('span', { className: 'sm-md-code-lang' }, lang),
            typeof onCopyCode === 'function'
              ? H(
                  'button',
                  {
                    type: 'button',
                    className: 'sm-md-copy-btn',
                    onClick: () => onCopyCode(codeText, bk),
                  },
                  isCopied
                    ? CheckIcon({ React: fakeReact, size: 11 })
                    : CopyIcon({ React: fakeReact, size: 11 }),
                  isCopied
                    ? (typeof t === 'function' ? t('copiedCodeBtn') : 'Copied')
                    : (typeof t === 'function' ? t('copyCodeBtn') : 'Copy'),
                )
              : null,
          ),
          H('pre', { className: 'sm-md-pre' }, H('code', null, codeText)),
        ),
      )
      continue
    }

    // 2. Headings (# .. ####)
    const headMatch = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (headMatch) {
      const level = headMatch[1].length
      const tag = `h${Math.min(6, level + 2)}`
      blocks.push(
        H(
          tag,
          { key: bk, className: `sm-md-h sm-md-h${level}` },
          renderInlineRichText(H, headMatch[2], `${bk}-h`),
        ),
      )
      i += 1
      continue
    }

    // 3. Horizontal rule
    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
      blocks.push(H('hr', { key: bk, className: 'sm-md-hr' }))
      i += 1
      continue
    }

    // 4. GFM Table
    if (line.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = splitTableRow(line)
      const aligns = parseTableAlignments(lines[i + 1])
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !isTableSeparatorLine(lines[i])) {
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      blocks.push(
        H(
          'div',
          { key: bk, className: 'sm-md-table-wrap' },
          H(
            'table',
            { className: 'sm-md-table' },
            H(
              'thead',
              null,
              H(
                'tr',
                null,
                ...headers.map((cell, ci) =>
                  H(
                    'th',
                    { key: `${bk}-th-${ci}`, style: aligns[ci] ? { textAlign: aligns[ci] } : undefined },
                    renderInlineRichText(H, cell, `${bk}-th-${ci}`),
                  ),
                ),
              ),
            ),
            rows.length > 0
              ? H(
                  'tbody',
                  null,
                  ...rows.map((row, ri) =>
                    H(
                      'tr',
                      { key: `${bk}-tr-${ri}` },
                      ...headers.map((_, ci) =>
                        H(
                          'td',
                          { key: `${bk}-td-${ri}-${ci}`, style: aligns[ci] ? { textAlign: aligns[ci] } : undefined },
                          renderInlineRichText(H, row[ci] ?? '', `${bk}-td-${ri}-${ci}`),
                        ),
                      ),
                    ),
                  ),
                )
              : null,
          ),
        ),
      )
      continue
    }

    // 5. Blockquote
    if (/^>\s?/.test(trimmed)) {
      const qLines = []
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        qLines.push(lines[i].trim().replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push(
        H(
          'blockquote',
          { key: bk, className: 'sm-md-quote' },
          renderMarkdownMessage(H, qLines.join('\n'), { keyPrefix: `${bk}-q`, onCopyCode, copiedCodeKey, t }),
        ),
      )
      continue
    }

    // 6. Unordered or Ordered List
    const ulMatch = trimmed.match(/^[-*•]\s+(.+)$/)
    const olMatch = !ulMatch ? trimmed.match(/^\d+[.)]\s+(.+)$/) : null
    if (ulMatch || olMatch) {
      const ordered = Boolean(olMatch)
      const itemRe = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*•]\s+(.+)$/
      const items = []
      while (i < lines.length) {
        const curTrim = lines[i].trim()
        const m = curTrim.match(itemRe)
        if (!m) break
        items.push(m[1])
        i += 1
      }
      blocks.push(
        H(
          ordered ? 'ol' : 'ul',
          { key: bk, className: `sm-md-list${ordered ? ' ordered' : ''}` },
          ...items.map((item, li) =>
            H('li', { key: `${bk}-li-${li}` }, renderInlineRichText(H, item, `${bk}-li-${li}`)),
          ),
        ),
      )
      continue
    }

    // 7. Paragraph (collect lines until blank or next block element)
    const paraLines = [line]
    i += 1
    while (i < lines.length && !isBlockBoundary(lines, i)) {
      paraLines.push(lines[i])
      i += 1
    }
    const paraChildren = []
    paraLines.forEach((pLine, pi) => {
      if (pi > 0) paraChildren.push(H('br', { key: `${bk}-br-${pi}` }))
      const rendered = renderInlineRichText(H, pLine, `${bk}-p-${pi}`)
      if (Array.isArray(rendered)) {
        paraChildren.push(...rendered)
      } else {
        paraChildren.push(rendered)
      }
    })
    blocks.push(H('p', { key: bk, className: 'sm-md-p' }, ...paraChildren))
  }

  return H('div', { className: 'sm-md' }, ...blocks)
}
