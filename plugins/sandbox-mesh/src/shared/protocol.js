export const DEFAULT_MESH_PORT = 4090
export const DEFAULT_PAIR_TTL_MS = 5 * 60 * 1000
export const DEFAULT_MAX_AGENT_HOPS = 8
export const DEFAULT_MAX_MESSAGES_PER_ROOM = 300
export const DEFAULT_MAX_TASKS_PER_ROOM = 200
export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024

export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled']
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent']
export const APPROVAL_STATUSES = ['', 'pending', 'approved', 'rejected']

export function normalizeTaskStatus(raw, fallback = 'todo') {
  const s = String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (TASK_STATUSES.includes(s)) return s
  if (s === 'open' || s === 'pending' || s === 'reopen' || s === 'reopened') return 'todo'
  if (s === 'doing' || s === 'working' || s === 'running' || s === 'active') return 'in_progress'
  if (s === 'review' || s === 'reviewing' || s === 'qa') return 'in_review'
  if (s === 'completed' || s === 'finished' || s === 'resolved') return 'done'
  if (s === 'canceled') return 'cancelled'
  return TASK_STATUSES.includes(fallback) ? fallback : 'todo'
}

export function normalizeTaskPriority(raw, fallback = 'medium') {
  const p = String(raw || '').trim().toLowerCase()
  if (TASK_PRIORITIES.includes(p)) return p
  if (p === 'p0' || p === 'critical') return 'urgent'
  if (p === 'p1') return 'high'
  if (p === 'p2' || p === 'normal') return 'medium'
  if (p === 'p3') return 'low'
  return TASK_PRIORITIES.includes(fallback) ? fallback : 'medium'
}

export function normalizeApprovalStatus(raw) {
  const s = String(raw || '').trim().toLowerCase()
  return APPROVAL_STATUSES.includes(s) ? s : ''
}

export function areTaskDependenciesMet(task, allTasks = []) {
  const deps = Array.isArray(task?.dependsOn) ? task.dependsOn.filter(Boolean) : []
  if (deps.length === 0) return true
  const byId = new Map((Array.isArray(allTasks) ? allTasks : []).map((t) => [t.id, t]))
  return deps.every((depId) => {
    const dep = byId.get(depId)
    return dep && dep.status === 'done'
  })
}

export function summarizeRoomTasks(tasks = [], threadId = '') {
  const list = Array.isArray(tasks)
    ? (threadId ? tasks.filter((t) => !t.threadId || t.threadId === threadId) : tasks)
    : []
  const counts = {
    total: 0,
    todo: 0,
    in_progress: 0,
    in_review: 0,
    blocked: 0,
    done: 0,
    cancelled: 0,
    pendingApprovals: 0,
  }
  for (const t of list) {
    if (!t || typeof t !== 'object') continue
    if (t.status === 'cancelled') {
      counts.cancelled += 1
      continue
    }
    counts.total += 1
    if (counts[t.status] !== undefined) counts[t.status] += 1
    if (t.approvalRequired && t.approvalStatus === 'pending') {
      counts.pendingApprovals += 1
    }
  }
  return counts
}

const REWORK_QUALIFIER_RE = /(?:最终|二次|再次|重新|复测|复检|复核|重测|重试|返工|修复后|补充|更新版|第[一二三四五六七八九十0-9]+[轮次])|\b(?:final|re-?run|re-?check|re-?verify|re-?review|re-?test|retry|rework|revised|round\s*\d+|attempt\s*\d+|pass\s*\d+|v\d+)\b/gi
const TITLE_NOISE_RE = /[\s\-–—_:：,，.。/·()（）【】[\]「」《》"'`!！?？]+/g

export function normalizeTaskTitleForMatch(rawTitle) {
  return String(rawTitle || '')
    .trim()
    .toLowerCase()
    .replace(REWORK_QUALIFIER_RE, ' ')
    .replace(TITLE_NOISE_RE, '')
}

export function areTaskTitlesEquivalent(titleA, titleB) {
  const a = normalizeTaskTitleForMatch(titleA)
  const b = normalizeTaskTitleForMatch(titleB)
  if (!a || !b) return false
  if (a === b && a.length >= 2) return true
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  return shorter.length >= 4 && longer.includes(shorter) && (shorter.length / longer.length) >= 0.6
}

/**
 * Find older blocked (or explicitly replaced) tasks in the same room/thread that are superseded
 * by `targetTask`. Never auto-closes tasks awaiting human approval so agents cannot bypass gates.
 */
export function findSupersededBlockedTasks(roomTasks = [], targetTask, { explicitIds = [] } = {}) {
  if (!Array.isArray(roomTasks) || !targetTask || typeof targetTask !== 'object') return []
  const targetId = String(targetTask.id || '').trim()
  const targetAssignee = sanitizeSlug(targetTask.assigneeSlug || '')
  const targetThread = String(targetTask.threadId || '').trim()
  const targetCreatedAt = Number(targetTask.createdAt) || 0
  const explicitSet = new Set(
    (Array.isArray(explicitIds) ? explicitIds : [])
      .map((x) => String(x || '').trim())
      .filter((x) => x && x !== targetId),
  )

  const matches = []
  for (const t of roomTasks) {
    if (!t || typeof t !== 'object' || !t.id || t.id === targetId) continue
    if (t.status === 'done' || t.status === 'cancelled') continue
    if (t.approvalRequired && t.approvalStatus === 'pending') continue

    if (explicitSet.has(t.id)) {
      matches.push(t)
      continue
    }

    if (t.status !== 'blocked') continue
    if (targetThread && t.threadId && t.threadId !== targetThread) continue
    const tAssignee = sanitizeSlug(t.assigneeSlug || '')
    if ((targetAssignee || tAssignee) && tAssignee !== targetAssignee) continue
    if (targetCreatedAt > 0 && Number(t.createdAt) > targetCreatedAt) continue
    if (areTaskTitlesEquivalent(t.title, targetTask.title)) {
      matches.push(t)
    }
  }
  return matches
}

export function sanitizeSlug(raw) {
  if (typeof raw !== 'string') return ''
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return cleaned.slice(0, 64)
}

export function pairRoomId(slugA, slugB) {
  const a = sanitizeSlug(slugA)
  const b = sanitizeSlug(slugB)
  if (!a || !b) return ''
  return `pair:${[a, b].sort().join(':')}`
}

export function normalizeEndpointUrl(rawUrl, fallbackSlug = '', fallbackOrigin = '', meshPort = DEFAULT_MESH_PORT) {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim().replace(/#.*$/, '').replace(/\/+$/, '') : ''
  if (trimmed && /^https?:\/\//i.test(trimmed)) {
    if (/\/p\/\d+$/i.test(trimmed)) return trimmed
    const sMatch = trimmed.match(/^(https?:\/\/[^/]+\/s\/[a-z0-9_-]+)(?:\/.*)?$/i)
    if (sMatch) {
      return `${sMatch[1]}/p/${meshPort}`
    }
    return trimmed
  }
  const slug = sanitizeSlug(fallbackSlug)
  const origin = typeof fallbackOrigin === 'string' ? fallbackOrigin.trim().replace(/\/+$/, '') : ''
  if (origin && slug) {
    return `${origin}/s/${slug}/p/${meshPort}`
  }
  return ''
}

export function formatPairInvite({ slug, token, endpointUrl }) {
  const cleanSlug = sanitizeSlug(slug)
  const cleanToken = typeof token === 'string' ? token.trim() : ''
  const shortCode = `${cleanSlug}.${cleanToken}`
  const cleanEndpoint = typeof endpointUrl === 'string' ? endpointUrl.trim().replace(/\/+$/, '') : ''
  const inviteUri = cleanEndpoint ? `${cleanEndpoint}#pair=${shortCode}` : shortCode
  return {
    slug: cleanSlug,
    token: cleanToken,
    shortCode,
    inviteUri,
  }
}

export function resolveBrowserOriginUrl(rawUrl, browserOrigin = '') {
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : ''
  const origin = typeof browserOrigin === 'string' ? browserOrigin.trim().replace(/\/+$/, '') : ''
  if (!url || !origin || !/^https?:\/\//i.test(origin)) return url
  try {
    const parsed = new URL(url)
    const browserParsed = new URL(origin)
    const isUrlLoopback = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname)
    const isBrowserLoopback = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(browserParsed.hostname)
    if (isUrlLoopback && !isBrowserLoopback) {
      return `${browserParsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`
    }
  } catch {}
  return url
}

export function parsePairInvite(rawInput, defaultOrigin = '', meshPort = DEFAULT_MESH_PORT) {
  if (typeof rawInput !== 'string') return null
  const trimmed = rawInput.trim().replace(/^[`"'<\s]+|[`"'>\s]+$/g, '')
  if (!trimmed) return null

  let endpointPart = ''
  let codePart = trimmed

  if (/^https?:\/\//i.test(trimmed)) {
    const hashIdx = trimmed.indexOf('#')
    if (hashIdx >= 0) {
      endpointPart = trimmed.slice(0, hashIdx).trim()
      const hash = trimmed.slice(hashIdx + 1).trim()
      codePart = /^pair=/i.test(hash) ? hash.slice(5).trim() : hash
    } else {
      try {
        const parsed = new URL(trimmed)
        const pairParam = parsed.searchParams.get('pair')
        if (pairParam) {
          parsed.search = ''
          endpointPart = parsed.toString()
          codePart = pairParam.trim()
        }
      } catch {
        return null
      }
    }
  } else {
    codePart = codePart.replace(/^#?pair=/i, '').trim()
  }

  const sepMatch = codePart.match(/^([a-zA-Z0-9_-]{1,64})[.:]([A-Za-z0-9_-]{12,128})$/)
  if (!sepMatch) return null

  const slug = sanitizeSlug(sepMatch[1])
  const token = sepMatch[2]
  if (!slug || !token) return null

  if (!endpointPart && /^https?:\/\//i.test(trimmed)) {
    const slugMatch = trimmed.match(/\/s\/([a-z0-9_-]+)/i)
    if (slugMatch) {
      endpointPart = trimmed.split('#')[0]
    }
  }

  const endpointUrl = normalizeEndpointUrl(endpointPart, slug, defaultOrigin, meshPort)
  return {
    slug,
    token,
    endpointUrl,
    shortCode: `${slug}.${token}`,
  }
}

export function extractMentions(text) {
  if (typeof text !== 'string' || !text) return []
  const set = new Set()
  for (const m of text.matchAll(/@\[([^\]\n]+)\]\(dsh-mesh(?:-[a-z]+)?:([^)\s]+)\)/g)) {
    if (m[2]) set.add(m[2].toLowerCase())
    if (m[1]) set.add(m[1].toLowerCase())
  }
  for (const m of text.matchAll(/(?:^|[\s,;:!()[\]{}])@([a-zA-Z0-9_-]{2,64})/g)) {
    if (m[1]) set.add(m[1].toLowerCase())
  }
  return [...set]
}

/**
 * Extract `#filepath` references from unified composer text (e.g. `#README.md` or `#/home/workspace/a.json`).
 */
export function extractFileReferences(text) {
  if (typeof text !== 'string' || !text) return []
  const matches = text.matchAll(/(?:^|[\s,;:!()[\]{}])#([^\s#,:;!?()[\]{}]+)/g)
  const refs = []
  for (const m of matches) {
    const raw = (m[1] || '').trim()
    if (!raw) continue
    if ((raw.includes('.') || raw.includes('/')) && !/^#[0-9a-fA-F]{3,8}$/.test(`#${raw}`)) {
      if (!refs.includes(raw)) refs.push(raw)
    }
  }
  return refs
}

export function evaluateAgentWake(message, selfSlug, maxHops = DEFAULT_MAX_AGENT_HOPS, roomType = 'pair', roomMeta = null) {
  if (!message || typeof message !== 'object') {
    return { wake: false, reason: 'invalid-message' }
  }
  const cleanSelf = sanitizeSlug(selfSlug)
  const senderSlug = sanitizeSlug(message.sender?.slug || '')
  const senderActor = message.sender?.actor || 'human'
  const hop = typeof message.hop === 'number' && Number.isFinite(message.hop) ? Math.max(0, Math.trunc(message.hop)) : 0

  if (senderActor === 'system' || (senderSlug === cleanSelf && senderActor === 'agent')) {
    return { wake: false, reason: 'self-agent-origin' }
  }
  if (message.kind === 'approval') {
    return { wake: false, reason: 'awaiting-human-approval' }
  }
  if (hop >= maxHops) {
    return { wake: false, reason: 'max-hops-reached' }
  }

  const mentions = Array.isArray(message.mentions) ? message.mentions : extractMentions(message.text || '')
  const moderatorSlug = sanitizeSlug(roomMeta?.moderatorSlug || roomMeta?.createdBy || '')

  // In group rooms, "@moderator" wakes the designated Moderator LLM to coordinate
  if (
    roomType === 'group'
    && moderatorSlug
    && cleanSelf === moderatorSlug
    && mentions.includes('moderator')
  ) {
    return {
      wake: true,
      nextHop: senderActor === 'agent' ? hop + 1 : 1,
      reason: 'group-moderator-duty',
    }
  }

  // Explicitly @mentioning this sandbox (@<selfSlug> or @<selfSlug>-agent) or @all wakes this sandbox's Agent
  const explicitlyNamedSelf = Boolean(
    cleanSelf && (mentions.includes(cleanSelf) || mentions.includes(`${cleanSelf}-agent`)),
  )
  if (explicitlyNamedSelf || mentions.includes('all')) {
    return {
      wake: true,
      nextHop: senderActor === 'agent' ? hop + 1 : 1,
      reason: 'mentioned',
    }
  }

  const genericAgentTarget = mentions.includes('agent')
  const hasOtherSpecificMention = mentions.length > 0 && !genericAgentTarget

  // In group rooms, untargeted human messages wake ONLY the designated Moderator LLM (other members wait calmly unless called)
  if (roomType === 'group' && !hasOtherSpecificMention) {
    if (moderatorSlug && cleanSelf === moderatorSlug && senderActor === 'human') {
      return {
        wake: true,
        nextHop: 1,
        reason: 'group-moderator-duty',
      }
    }
    return { wake: false, reason: 'awaiting-moderator-turn' }
  }

  // In 1-on-1 pair rooms, incoming peer messages automatically wake the local Agent unless directed elsewhere
  if (roomType === 'pair' && senderSlug !== cleanSelf && !hasOtherSpecificMention) {
    return {
      wake: true,
      nextHop: senderActor === 'agent' ? hop + 1 : 1,
      reason: 'direct-peer-message',
    }
  }

  return { wake: false, reason: 'not-targeted' }
}

/**
 * Returns true only when the active topic thread already has real (non-system) conversation messages
 * worth isolating; returns false when the room was just created or already switched to a fresh topic.
 */
export function canStartNewTopic(room, messages = []) {
  if (!room) return false
  const nonSystem = Array.isArray(messages) ? messages.filter((m) => m && m.kind !== 'system') : []
  if (nonSystem.length === 0) return false
  const activeTid = String(room.activeThreadId || '').trim()
  if (!activeTid) return true
  return nonSystem.some((m) => m.threadId === activeTid)
}
