import { createTranslator } from './locale.js'
import {
  AgentIcon,
  CheckIcon,
  ChevronIcon,
  ClipIcon,
  FileDocIcon,
  MeshNavIcon,
  ModeratorCrownIcon,
  RoundtableIcon,
  ShieldCheckIcon,
  TasksBoardIcon,
} from './icons.js'
import {
  renderMarkdownMessage,
  stripMarkdownForPreview,
} from './markdown.js'

function tvIsPartialArguments(obj) {
  return Boolean(
    obj
    && typeof obj === 'object'
    && !Array.isArray(obj)
    && typeof obj.text === 'function'
    && typeof obj.value === 'function'
    && typeof obj.keys === 'function',
  )
}

function tvReadPartialArguments(pa) {
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
      if (val !== undefined) {
        out[key] = val
      }
    } catch {}
  }
  return out
}

function tvAsString(val) {
  return typeof val === 'string' ? val : ''
}

function tvAsStringArray(val) {
  if (!Array.isArray(val)) return []
  return val.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
}

/**
 * Extract tool call arguments safely across all DSH 0.2.3 phases:
 * - settled/started JSON in `argsRaw`
 * - DSH 0.2.3 `PartialArguments` streaming accessor (never leaking `.text` prototype method!)
 * - plain JS object mocks used in unit tests
 */
export function parseToolArgsSafe(block) {
  if (!block || typeof block !== 'object') return {}

  const raw = block.call?.argsRaw ?? block.argsRaw ?? ''
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    } catch {}
  }

  const direct = block.call?.args ?? block.args
  if (tvIsPartialArguments(direct)) {
    return tvReadPartialArguments(direct)
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

function extractToolOutputText(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.content)) return ''
  const parts = []
  for (const item of block.content) {
    if (item && item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      parts.push(item.text.trim())
    }
  }
  return parts.join('\n')
}

function parsePeerReplyOutput(rawOutput) {
  const text = String(rawOutput || '').trim()
  if (!text) return { repliedBy: '', body: '', files: [], isFailed: false }
  const m = text.match(/^\[Remote (?:Agent|Group Moderator)\s+@([a-z0-9_-]+)[^\]]*\]:\s*\n?([\s\S]*)$/i)
  let body = m ? m[2].trim() : text
  const files = []
  const fileMatch = body.match(/\nShared files saved at:\s*(.+)$/i)
  if (fileMatch) {
    body = body.slice(0, fileMatch.index).trim()
    for (const f of fileMatch[1].split(',')) {
      const clean = f.trim()
      if (clean) files.push(clean)
    }
  }
  return {
    repliedBy: m ? m[1] : '',
    body,
    files,
    isFailed: /^Mesh peer request failed|^Group discussion failed|^Task dispatch failed|^Task update failed|^Failed to read task board|^Approval request failed|^File share failed|^Failed to send mesh message/i.test(text),
  }
}

function parsePeersListOutput(rawOutput) {
  const text = String(rawOutput || '').trim()
  if (!text) return null
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') {
        return {
          self: parsed.self || null,
          peers: Array.isArray(parsed.peers) ? parsed.peers : [],
          groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        }
      }
    } catch {}
  }

  // Parse text output produced by `mesh_list_peers` render()
  const peers = []
  const groups = []
  let section = ''
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^Connected Sandboxes/i.test(line)) {
      section = 'peers'
      continue
    }
    if (/^Groups\s*\(/i.test(line)) {
      section = 'groups'
      continue
    }
    if (section === 'peers' && line.startsWith('- @')) {
      const pm = line.match(/^-\s+@([a-z0-9_-]+)\s*(?:\(([^)]+)\))?(?:\s*·\s*([^\[|]+?))?(?:\s*\[([^\]]+)\])?(?:\s*\|\s*roomId:\s*([^\s—]+))?(?:\s*—\s*(.+))?$/i)
      if (pm) {
        peers.push({
          slug: pm[1],
          ownerName: (pm[2] || '').trim(),
          role: (pm[3] || '').trim(),
          status: (pm[4] || 'online').trim(),
          roomId: (pm[5] || '').trim(),
          description: (pm[6] || '').trim(),
        })
      }
    } else if (section === 'groups' && line.startsWith('- "')) {
      const gm = line.match(/^-\s+"([^"]+)"\s*\(roomId:\s*([^,]+),\s*moderator:\s*@([a-z0-9_-]+)(?:,\s*members:\s*(.*))?\)$/i)
      if (gm) {
        const members = (gm[4] || '')
          .split(',')
          .map((s) => s.trim().replace(/^@/, ''))
          .filter(Boolean)
        groups.push({
          name: gm[1],
          roomId: gm[2].trim(),
          moderatorSlug: gm[3],
          members,
        })
      }
    }
  }
  if (peers.length > 0 || groups.length > 0 || /^Self:\s*@/i.test(text)) {
    return { self: null, peers, groups }
  }
  return null
}

function parseDiscussGroupOutput(rawOutput) {
  const text = String(rawOutput || '').trim()
  if (!text) return null
  const headMatch = text.match(/^(Created task group|Reused group|Group)\s+"([^"]+)"\s+ready\s+\(roomId="([^"]+)",\s*threadId="([^"]*)"\)\.\s*You are the LLM Moderator\s+\(@([a-z0-9_-]+)\)/i)
  if (!headMatch) return null
  const kind = headMatch[1].toLowerCase().startsWith('created')
    ? 'created'
    : headMatch[1].toLowerCase().startsWith('reused')
      ? 'reused'
      : 'existing'
  const members = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const mm = line.match(/^-\s+@([a-z0-9_-]+)(?:\s*\(([^)]+)\))?(?::\s*(.+))?$/i)
    if (mm) {
      const desc = (mm[3] || '').trim()
      members.push({
        slug: mm[1],
        role: (mm[2] || '').trim(),
        description: desc === 'general' ? '' : desc,
      })
    }
  }
  return {
    kind,
    groupName: headMatch[2],
    roomId: headMatch[3],
    threadId: headMatch[4],
    moderatorSlug: headMatch[5],
    members,
  }
}

function parseDispatchTasksOutput(rawOutput) {
  const text = String(rawOutput || '').trim()
  if (!text) return null
  const headMatch = text.match(/^Dispatched\s+(\d+)\s+task\(s\)\s+in\s+(\S+)\s+\(mode:\s*([a-z]+)\):/i)
  if (!headMatch) return null
  const tasks = []
  const results = []
  let inResults = false
  for (const rawLine of text.split('\n').slice(1)) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^NEXT STEP:/i.test(line)) break
    if (/^Parallel Results:/i.test(line)) {
      inResults = true
      continue
    }
    if (!inResults && line.startsWith('- [')) {
      const tm = line.match(/^-\s+\[([^\]]+)\]\s+(.+?)\s+\(([^)]+)\)$/)
      if (tm) {
        const flags = tm[3].split('·').map((s) => s.trim()).filter(Boolean)
        const status = flags[0] || 'todo'
        let assigneeSlug = ''
        let awaitingApproval = false
        let deps = []
        for (const f of flags.slice(1)) {
          if (f.startsWith('@')) assigneeSlug = f.slice(1)
          else if (/awaiting human approval/i.test(f)) awaitingApproval = true
          else if (/^deps:/i.test(f)) deps = f.replace(/^deps:\s*/i, '').split(',').map((s) => s.trim()).filter(Boolean)
        }
        tasks.push({
          id: tm[1],
          title: tm[2],
          status,
          assigneeSlug,
          awaitingApproval,
          deps,
        })
      }
    } else if (inResults && line.startsWith('- @')) {
      const rm = line.match(/^-\s+@([a-z0-9_-]+)\s+\[([^\s·]+)\s*·\s*([^\]]+)\]:\s*([\s\S]*)$/i)
      if (rm) {
        results.push({
          assigneeSlug: rm[1],
          taskId: rm[2],
          status: rm[3].trim(),
          reply: rm[4].trim(),
        })
      }
    }
  }
  return {
    count: Number(headMatch[1]) || tasks.length,
    roomId: headMatch[2],
    mode: headMatch[3].toLowerCase(),
    tasks,
    results,
  }
}

function parseTaskUpdateOutput(rawOutput) {
  const text = String(rawOutput || '').trim()
  if (!text) return null
  // Remove trailing internal handoff coaching tag before parsing
  const withoutDeferred = text.replace(/\s*\[handoff queued[^\]]*\]\s*$/i, '').trim()
  const m = withoutDeferred.match(/^Updated task\s+\[([^\]]+)\]\s+"([^"]+)"\s*->\s*([a-z_]+)(?:\s*\(shared\s+(\d+)\s+file\(s\)\s+first\))?(?::\s*([\s\S]*))?$/i)
  if (!m) return null
  let summary = (m[5] || '').trim()
  let unblockedCount = 0
  const unbMatch = summary.match(/\s*\((\d+)\s+downstream task\(s\)\s+unblocked\)\s*$/i)
  if (unbMatch) {
    unblockedCount = Number(unbMatch[1]) || 0
    summary = summary.slice(0, unbMatch.index).trim()
  }
  return {
    taskId: m[1],
    title: m[2],
    status: m[3].toLowerCase(),
    sharedCount: Number(m[4]) || 0,
    unblockedCount,
    summary,
  }
}

function parseTaskBoardOutput(rawOutput) {
  const text = String(rawOutput || '').trim()
  if (!text) return null
  const emptyMatch = text.match(/^Task Board\s+\(([^)]+)\):\s*no tasks yet\.?$/i)
  if (emptyMatch) {
    return {
      roomId: emptyMatch[1],
      counts: { done: 0, total: 0, inProgress: 0, inReview: 0, blocked: 0, pendingApproval: 0 },
      tasks: [],
    }
  }
  const headMatch = text.match(/^Task Board\s+\(([^)]+)\)\s+—\s+(\d+)\/(\d+)\s+done,\s*(\d+)\s+in progress,\s*(\d+)\s+in review,\s*(\d+)\s+blocked(?:,\s*(\d+)\s+pending human approval)?:/i)
  if (!headMatch) return null
  const tasks = []
  for (const rawLine of text.split('\n').slice(1)) {
    const line = rawLine.trim()
    if (!line.startsWith('- [')) continue
    const tm = line.match(/^-\s+\[([a-z_]+)\]\s+(\S+)\s+·\s+(.+?)\s+\(([^)]+)\)(?:\s+—\s+([\s\S]*))?$/i)
    if (!tm) continue
    const metaParts = tm[4].split('|').map((s) => s.trim()).filter(Boolean)
    const rawOwner = (metaParts[0] || '').replace(/^@/, '')
    const assigneeSlug = rawOwner && rawOwner !== 'unassigned' ? rawOwner : ''
    let deps = []
    let approval = ''
    let artifacts = []
    for (const part of metaParts.slice(1)) {
      if (/^deps:/i.test(part)) deps = part.replace(/^deps:\s*/i, '').split(',').map((s) => s.trim()).filter(Boolean)
      else if (/^approval:/i.test(part)) approval = part.replace(/^approval:\s*/i, '').trim()
      else if (/^artifacts:/i.test(part)) artifacts = part.replace(/^artifacts:\s*/i, '').split(',').map((s) => s.trim()).filter(Boolean)
    }
    tasks.push({
      status: tm[1].toLowerCase(),
      id: tm[2],
      title: tm[3],
      assigneeSlug,
      deps,
      approval,
      artifacts,
      summary: (tm[5] || '').trim(),
    })
  }
  return {
    roomId: headMatch[1],
    counts: {
      done: Number(headMatch[2]) || 0,
      total: Number(headMatch[3]) || tasks.length,
      inProgress: Number(headMatch[4]) || 0,
      inReview: Number(headMatch[5]) || 0,
      blocked: Number(headMatch[6]) || 0,
      pendingApproval: Number(headMatch[7]) || 0,
    },
    tasks,
  }
}

function parseApprovalOutput(rawOutput) {
  const text = String(rawOutput || '').trim()
  if (!text) return null
  const m = text.match(/^Human approval gate posted for task\s+\[([^\]]+)\]\s+"([^"]+)"/i)
  if (!m) return null
  return {
    taskId: m[1],
    title: m[2],
  }
}

function localizeTaskStatus(status, t) {
  const s = String(status || '').toLowerCase()
  if (s === 'todo') return { label: t('taskStatusTodo'), tone: 'todo', pill: '' }
  if (s === 'in_progress') return { label: t('taskStatusInProgress'), tone: 'in_progress', pill: 'info' }
  if (s === 'in_review') return { label: t('taskStatusInReview'), tone: 'in_review', pill: 'review' }
  if (s === 'blocked') return { label: t('taskStatusBlocked'), tone: 'blocked', pill: 'err' }
  if (s === 'done') return { label: t('taskStatusDone'), tone: 'done', pill: 'ok' }
  if (s === 'cancelled') return { label: t('taskStatusCancelled'), tone: 'cancelled', pill: '' }
  return { label: status || '', tone: 'todo', pill: '' }
}

function localizePriority(priority, t) {
  const p = String(priority || '').toLowerCase()
  if (p === 'urgent') return { label: t('taskPriorityUrgent'), pill: 'err' }
  if (p === 'high') return { label: t('taskPriorityHigh'), pill: 'warn' }
  if (p === 'low') return { label: t('taskPriorityLow'), pill: '' }
  return null
}

function parseRoomDisplayName(roomId, controller) {
  const clean = String(roomId || '').trim()
  if (!clean) return ''
  const snap = controller?.getSnapshot?.()
  const room = (snap?.state?.rooms || []).find((r) => r.id === clean)
  if (room?.name) return room.name
  if (clean.startsWith('pair:')) {
    const selfSlug = snap?.state?.self?.slug || ''
    const slugs = clean.split(':').slice(1)
    const other = slugs.find((s) => s !== selfSlug) || slugs[0] || clean
    return `@${other}`
  }
  return clean
}

function baseFileName(rawPath) {
  const s = String(rawPath || '').trim()
  if (!s) return ''
  const parts = s.split(/[\\/]/)
  return parts[parts.length - 1] || s
}

function renderArtifactOrFileChip(H, React, rawItem, { key, openFile, t }) {
  const val = String(rawItem || '').trim()
  if (!val) return null
  if (/^https?:\/\//i.test(val)) {
    return H(
      'a',
      {
        key,
        className: 'sm-tool-file-btn',
        href: val,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: val,
      },
      val,
    )
  }
  const isLocalPath = val.startsWith('/') || /^[A-Za-z]:[\\/]/.test(val)
  if (isLocalPath && typeof openFile === 'function') {
    return H(
      'button',
      {
        key,
        type: 'button',
        className: 'sm-tool-file-btn',
        title: `${val} · ${t('toolOpenFileHint')}`,
        onClick: (e) => {
          e.stopPropagation()
          try { openFile(val) } catch {}
        },
      },
      FileDocIcon({ React, size: 11 }),
      baseFileName(val),
    )
  }
  return H(
    'span',
    { key, className: 'sm-inline-file', title: val },
    FileDocIcon({ React, size: 11 }),
    isLocalPath ? baseFileName(val) : val,
  )
}

export function parseIncomingWakePrompt(rawText) {
  const text = String(rawText || '')
  if (!text.startsWith('[SANDBOX MESH INCOMING ')) return null

  const roomMatch = text.match(/Room:\s*"([^"]+)"\s*\(roomId:\s*"([^"]+)",\s*type:\s*(pair|group)\)/i)
  const senderMatch = text.match(/Sender:\s*([^\n(]+?)\s*\(@([a-z0-9_-]+)/i)
  const msgTagMatch = text.match(/<remote-mesh-message>\s*\n?([\s\S]*?)\n?\s*<\/remote-mesh-message>/i)
  const legacyMsgMatch = !msgTagMatch ? text.match(/Message:\s*\n([\s\S]*?)(?:\n\nInstructions:|\nInstructions:|$)/i) : null

  const body = (msgTagMatch?.[1] || legacyMsgMatch?.[1] || '').trim()
  return {
    roomName: roomMatch?.[1] || '',
    roomId: roomMatch?.[2] || '',
    roomType: roomMatch?.[3] || 'pair',
    senderName: (senderMatch?.[1] || '').trim(),
    senderSlug: senderMatch?.[2] || '',
    body,
    raw: text,
  }
}

/**
 * Native DSH `tool.call.toolview` renderer for all 9 `mesh_*` Harness tools.
 * Replaces raw JSON / LLM protocol text with clean, human-readable Sandbox Mesh cards.
 */
export function createMeshToolView({ React, getLocale, subscribeLocale, controller }) {
  const H = React.createElement
  const { useState, useEffect } = React

  return function MeshToolCallCard(props) {
    const [, setTick] = useState(0)
    const [localOpen, setLocalOpen] = useState(false)
    const disclosure = typeof props.useDisclosure === 'function' ? props.useDisclosure() : null
    const expanded = disclosure ? Boolean(disclosure.expanded) : localOpen
    const toggleExpand = disclosure ? disclosure.toggle : () => setLocalOpen((v) => !v)

    useEffect(() => {
      if (typeof subscribeLocale !== 'function') return undefined
      return subscribeLocale(() => setTick((n) => n + 1))
    }, [])

    const t = createTranslator(typeof getLocale === 'function' ? getLocale() : 'en')
    const toolName = String(props.toolName || '')
    const block = props.block || {}
    const isDone = props.phase === 'result' || ('kind' in block)
    const isRunning = !isDone
    const args = parseToolArgsSafe(block)
    const rawOutput = isDone ? extractToolOutputText(block) : ''
    const parsedReply = parsePeerReplyOutput(rawOutput)
    const isError = Boolean(isDone && (block.isError || block.error || parsedReply.isFailed))

    const parsedPeers = toolName === 'mesh_list_peers' ? parsePeersListOutput(rawOutput) : null
    const parsedDiscuss = toolName === 'mesh_discuss_group' ? parseDiscussGroupOutput(rawOutput) : null
    const parsedDispatch = toolName === 'mesh_dispatch_tasks' ? parseDispatchTasksOutput(rawOutput) : null
    const parsedUpdate = toolName === 'mesh_task_update' ? parseTaskUpdateOutput(rawOutput) : null
    const parsedBoard = toolName === 'mesh_task_board' ? parseTaskBoardOutput(rawOutput) : null
    const parsedApproval = toolName === 'mesh_request_approval' ? parseApprovalOutput(rawOutput) : null

    const argTargetSlug = asCleanSlug(args.targetSlug)
    const argQuestion = tvAsString(args.question).trim()
    const argTopic = tvAsString(args.topic).trim()
    const argText = tvAsString(args.text).trim()
    const argFilePath = tvAsString(args.filePath).trim()
    const argCaption = tvAsString(args.caption).trim()
    const argRoomId = tvAsString(args.roomId).trim()
    const argGroupName = tvAsString(args.groupName).trim()
    const argTaskId = tvAsString(args.taskId).trim()
    const argStatus = tvAsString(args.status).trim().toLowerCase()
    const argSummary = tvAsString(args.summary).trim()
    const argTitle = tvAsString(args.title).trim()
    const argPrompt = tvAsString(args.prompt).trim()
    const argAssignee = asCleanSlug(args.assigneeSlug)
    const argFiles = tvAsStringArray(args.files)
    const argArtifacts = tvAsStringArray(args.artifacts)
    const argShareFiles = tvAsStringArray(args.shareFiles)
    const argTasks = Array.isArray(args.tasks) ? args.tasks.filter((x) => x && typeof x === 'object') : []

    let iconEl = MeshNavIcon({ React, size: 14 })
    let titleText = t('toolAskPeerTitle')
    let targetPill = ''
    let targetPillExtraClass = ''
    let summaryPreview = ''
    let statusLabel = isRunning ? t('toolStateRunning') : isError ? t('toolStateError') : t('toolStateDone')

    if (toolName === 'mesh_ask_peer') {
      iconEl = AgentIcon({ React, size: 14 })
      titleText = t('toolAskPeerTitle')
      targetPill = argTargetSlug ? `@${argTargetSlug}` : (parsedReply.repliedBy ? `@${parsedReply.repliedBy}` : '')
      summaryPreview = stripMarkdownForPreview(argQuestion || parsedReply.body || '', 84)
      if (isDone && !isError) statusLabel = t('toolStateReplied')
    } else if (toolName === 'mesh_discuss_group') {
      iconEl = RoundtableIcon({ React, size: 14 })
      titleText = t('toolDiscussGroupTitle')
      targetPill = argGroupName || parsedDiscuss?.groupName || parseRoomDisplayName(argRoomId, controller) || ''
      summaryPreview = stripMarkdownForPreview(argTopic || parsedReply.body || '', 84)
    } else if (toolName === 'mesh_list_peers') {
      iconEl = MeshNavIcon({ React, size: 14 })
      titleText = t('toolListPeersTitle')
      if (parsedPeers) {
        const peerText = parsedPeers.peers.length > 0
          ? `${parsedPeers.peers.length} ${t('toolConnectedNodes')}`
          : t('toolNoNodes')
        summaryPreview = parsedPeers.groups.length > 0
          ? `${peerText} · ${parsedPeers.groups.length} ${t('toolGroupsCount')}`
          : peerText
      } else if (rawOutput) {
        summaryPreview = stripMarkdownForPreview(rawOutput, 72)
      }
    } else if (toolName === 'mesh_send_message') {
      iconEl = AgentIcon({ React, size: 14 })
      titleText = t('toolSendMsgTitle')
      targetPill = parseRoomDisplayName(argRoomId, controller)
      summaryPreview = stripMarkdownForPreview(argText, 84)
    } else if (toolName === 'mesh_share_file') {
      iconEl = ClipIcon({ React, size: 14 })
      titleText = t('toolShareFileTitle')
      const fname = baseFileName(argFilePath)
      const dest = parseRoomDisplayName(argRoomId, controller)
      targetPill = fname && dest ? `${fname} → ${dest}` : (fname || dest)
      summaryPreview = stripMarkdownForPreview(argCaption || (argFilePath && fname !== argFilePath ? argFilePath : ''), 72)
    } else if (toolName === 'mesh_dispatch_tasks') {
      iconEl = TasksBoardIcon({ React, size: 14 })
      titleText = t('toolDispatchTasksTitle')
      const count = argTasks.length || parsedDispatch?.tasks?.length || parsedDispatch?.count || 0
      const dest = parseRoomDisplayName(argRoomId || parsedDispatch?.roomId, controller)
      targetPill = dest
        ? `${dest}${count ? ` · ${count} ${t('toolTasksCountUnit')}` : ''}`
        : (count ? `${count} ${t('toolTasksCountUnit')}` : '')
      const previewTitles = (argTasks.length > 0 ? argTasks : (parsedDispatch?.tasks || []))
        .map((tk) => tvAsString(tk?.title).trim())
        .filter(Boolean)
        .join(' · ')
      summaryPreview = stripMarkdownForPreview(previewTitles, 84)
    } else if (toolName === 'mesh_task_board') {
      iconEl = TasksBoardIcon({ React, size: 14 })
      titleText = t('toolTaskBoardTitle')
      targetPill = parseRoomDisplayName(argRoomId || parsedBoard?.roomId, controller)
      if (parsedBoard) {
        const c = parsedBoard.counts
        if (c.total === 0) {
          summaryPreview = t('toolBoardEmpty')
        } else {
          const bits = [t('toolBoardSummaryDone', { done: c.done, total: c.total })]
          if (c.inProgress > 0) bits.push(t('toolBoardSummaryProgress', { count: c.inProgress }))
          if (c.inReview > 0) bits.push(t('toolBoardSummaryReview', { count: c.inReview }))
          if (c.blocked > 0) bits.push(t('toolBoardSummaryBlocked', { count: c.blocked }))
          if (c.pendingApproval > 0) bits.push(t('toolBoardSummaryApproval', { count: c.pendingApproval }))
          summaryPreview = bits.join(' · ')
        }
      } else if (rawOutput) {
        summaryPreview = stripMarkdownForPreview(rawOutput, 84)
      }
    } else if (toolName === 'mesh_task_update') {
      iconEl = TasksBoardIcon({ React, size: 14 })
      titleText = t('toolTaskUpdateTitle')
      const effStatus = parsedUpdate?.status || argStatus
      if (effStatus) {
        const stInfo = localizeTaskStatus(effStatus, t)
        targetPill = stInfo.label
        targetPillExtraClass = ` status-${stInfo.tone}`
      }
      const taskTitle = parsedUpdate?.title || ''
      const cleanSummary = argSummary || parsedUpdate?.summary || ''
      summaryPreview = stripMarkdownForPreview(
        taskTitle && cleanSummary ? `${taskTitle} — ${cleanSummary}` : (taskTitle || cleanSummary || argTaskId),
        84,
      )
    } else if (toolName === 'mesh_request_approval') {
      iconEl = ShieldCheckIcon({ React, size: 14 })
      titleText = t('toolRequestApprovalTitle')
      targetPill = parseRoomDisplayName(argRoomId, controller) || argTitle || parsedApproval?.title || ''
      summaryPreview = stripMarkdownForPreview(argTitle || parsedApproval?.title || argPrompt, 84)
    }

    const hasDetails = Boolean(
      argQuestion
      || argTopic
      || argText
      || argFilePath
      || argPrompt
      || argSummary
      || argTasks.length > 0
      || argArtifacts.length > 0
      || argShareFiles.length > 0
      || rawOutput,
    )

    const statusClass = isRunning ? 'running' : isError ? 'error' : 'ok'
    const keyBase = `t-${props.callId || toolName}`

    const renderBody = () => {
      if (isError && rawOutput && !parsedReply.repliedBy) {
        return H('div', { className: 'sm-tool-error-box' }, rawOutput)
      }

      // 1. mesh_ask_peer
      if (toolName === 'mesh_ask_peer') {
        return H(
          React.Fragment || 'div',
          null,
          argQuestion
            ? H(
                'div',
                { className: 'sm-tool-section' },
                H('div', { className: 'sm-tool-section-label' }, t('toolRequestLabel')),
                renderMarkdownMessage(H, argQuestion, { keyPrefix: `${keyBase}-req`, t }),
                argFiles.length > 0
                  ? H(
                      'div',
                      { className: 'sm-tool-files' },
                      ...argFiles.map((fp, i) =>
                        renderArtifactOrFileChip(H, React, fp, { key: `in-${i}-${fp}`, openFile: props.openFile, t }),
                      ),
                    )
                  : null,
              )
            : null,
          isDone && rawOutput
            ? H(
                'div',
                { className: 'sm-tool-section' },
                H(
                  'div',
                  { className: 'sm-tool-section-label' },
                  `${t('toolReplyLabel')}${parsedReply.repliedBy ? ` · @${parsedReply.repliedBy}` : ''}`,
                ),
                isError
                  ? H('div', { className: 'sm-tool-error-box' }, parsedReply.body || rawOutput)
                  : renderMarkdownMessage(H, parsedReply.body || rawOutput, { keyPrefix: `${keyBase}-rep`, t }),
                parsedReply.files.length > 0
                  ? H(
                      'div',
                      { className: 'sm-tool-files' },
                      H('span', { className: 'sm-tool-section-label' }, t('toolSharedFilesLabel')),
                      ...parsedReply.files.map((fp, i) =>
                        renderArtifactOrFileChip(H, React, fp, { key: `out-${i}-${fp}`, openFile: props.openFile, t }),
                      ),
                    )
                  : null,
              )
            : null,
        )
      }

      // 2. mesh_list_peers
      if (toolName === 'mesh_list_peers' && parsedPeers) {
        return H(
          'div',
          { className: 'sm-tool-roster' },
          parsedPeers.peers.length === 0
            ? H('div', { className: 'sm-tool-note' }, t('toolNoNodes'))
            : H(
                'div',
                { className: 'sm-peer-checks' },
                ...parsedPeers.peers.map((p) =>
                  H(
                    'span',
                    {
                      key: p.slug,
                      className: 'sm-member-tag',
                      style: { cursor: 'default' },
                      title: p.description || p.role || `@${p.slug}`,
                    },
                    AgentIcon({ React, size: 11 }),
                    `@${p.slug}${p.role ? ` · ${p.role}` : ''}`,
                  ),
                ),
              ),
          parsedPeers.groups.length > 0
            ? H(
                'div',
                { className: 'sm-peer-checks' },
                ...parsedPeers.groups.map((g) =>
                  H(
                    'span',
                    { key: g.roomId || g.name, className: 'sm-member-tag moderator', style: { cursor: 'default' } },
                    ModeratorCrownIcon({ React, size: 11 }),
                    `${g.name} (${t('toolModeratorLabel')}: @${g.moderatorSlug})`,
                  ),
                ),
              )
            : null,
        )
      }

      // 3. mesh_share_file
      if (toolName === 'mesh_share_file') {
        const destName = parseRoomDisplayName(argRoomId, controller)
        return H(
          'div',
          { className: 'sm-tool-section' },
          H(
            'div',
            { className: 'sm-tool-meta-row' },
            argFilePath
              ? renderArtifactOrFileChip(H, React, argFilePath, { key: 'shared-file', openFile: props.openFile, t })
              : null,
            destName ? H('span', { className: 'sm-tool-pill info' }, `${t('toolSentToLabel')} ${destName}`) : null,
            isDone && !isError ? H('span', { className: 'sm-tool-note' }, t('toolFileSharedOk')) : null,
          ),
          argFilePath && baseFileName(argFilePath) !== argFilePath
            ? H('div', { className: 'sm-tool-file-path' }, argFilePath)
            : null,
          argCaption ? renderMarkdownMessage(H, argCaption, { keyPrefix: `${keyBase}-file`, t }) : null,
          isError && rawOutput ? H('div', { className: 'sm-tool-error-box' }, rawOutput) : null,
        )
      }

      // 4. mesh_dispatch_tasks
      if (toolName === 'mesh_dispatch_tasks') {
        const modeVal = (parsedDispatch?.mode || tvAsString(args.mode) || 'async').toLowerCase()
        const outByIdx = parsedDispatch?.tasks || []
        const mergedTasks = argTasks.length > 0
          ? argTasks.map((tk, idx) => {
              const matched = outByIdx[idx] || outByIdx.find((o) => o.title === tk.title) || null
              return {
                id: matched?.id || '',
                title: tvAsString(tk.title).trim() || matched?.title || `#${idx + 1}`,
                description: tvAsString(tk.description).trim(),
                assigneeSlug: asCleanSlug(tk.assigneeSlug) || matched?.assigneeSlug || '',
                status: matched?.status || 'todo',
                priority: tvAsString(tk.priority).trim(),
                awaitingApproval: Boolean(tk.approvalRequired || matched?.awaitingApproval),
                deps: [
                  ...tvAsStringArray(tk.dependsOn),
                  ...(Array.isArray(tk.dependsOnIndices)
                    ? tk.dependsOnIndices
                        .map((di) => argTasks[Number(di)]?.title)
                        .filter((s) => typeof s === 'string' && s.trim())
                    : []),
                ],
              }
            })
          : outByIdx.map((o) => ({
              id: o.id,
              title: o.title,
              description: '',
              assigneeSlug: o.assigneeSlug,
              status: o.status,
              priority: '',
              awaitingApproval: o.awaitingApproval,
              deps: o.deps || [],
            }))

        const destName = parseRoomDisplayName(argRoomId || parsedDispatch?.roomId, controller)
        return H(
          'div',
          { className: 'sm-tool-section' },
          H(
            'div',
            { className: 'sm-tool-meta-row' },
            destName ? H('span', { className: 'sm-tool-pill' }, `${t('toolRoomLabel')}: ${destName}`) : null,
            H('span', { className: 'sm-tool-pill info' }, modeVal === 'wait' ? t('toolModeWait') : t('toolModeAsync')),
          ),
          mergedTasks.length > 0
            ? H(
                'div',
                { className: 'sm-tool-task-list' },
                ...mergedTasks.map((tk, idx) => {
                  const st = localizeTaskStatus(tk.status, t)
                  const prio = localizePriority(tk.priority, t)
                  return H(
                    'div',
                    {
                      key: tk.id || `${tk.title}-${idx}`,
                      className: `sm-tool-task-item${tk.status === 'done' ? ' is-done' : ''}${tk.status === 'blocked' ? ' is-blocked' : ''}${tk.awaitingApproval ? ' is-approval' : ''}`,
                    },
                    H(
                      'div',
                      { className: 'sm-tool-task-top' },
                      H(
                        'div',
                        { className: 'sm-tool-task-left' },
                        H('span', { className: `sm-tool-task-dot ${st.tone}` }),
                        H('span', { className: 'sm-tool-task-title' }, tk.title),
                        tk.assigneeSlug
                          ? H('span', { className: 'sm-inline-mention' }, AgentIcon({ React, size: 11 }), `@${tk.assigneeSlug}`)
                          : H('span', { className: 'sm-tool-pill' }, t('toolUnassigned')),
                      ),
                      H(
                        'div',
                        { className: 'sm-tool-meta-row', style: { gap: '4px' } },
                        prio ? H('span', { className: `sm-tool-pill ${prio.pill}` }, prio.label) : null,
                        tk.awaitingApproval ? H('span', { className: 'sm-tool-pill warn' }, t('taskApprovalPending')) : null,
                        st.label ? H('span', { className: `sm-tool-pill ${st.pill}` }, st.label) : null,
                      ),
                    ),
                    tk.deps.length > 0
                      ? H(
                          'div',
                          { className: 'sm-tool-note', style: { paddingLeft: '13px' } },
                          `${t('taskDepsLabel')}: ${tk.deps.join('、')}`,
                        )
                      : null,
                    tk.description
                      ? H(
                          'div',
                          { className: 'sm-tool-task-desc' },
                          renderMarkdownMessage(H, tk.description, { keyPrefix: `${keyBase}-td-${idx}`, t }),
                        )
                      : null,
                  )
                }),
              )
            : (isDone && rawOutput ? renderMarkdownMessage(H, rawOutput, { keyPrefix: `${keyBase}-disp`, t }) : null),
          parsedDispatch?.results?.length > 0
            ? H(
                'div',
                { className: 'sm-tool-section', style: { marginTop: '4px' } },
                H('div', { className: 'sm-tool-section-label' }, t('toolParallelResultsLabel')),
                ...parsedDispatch.results.map((r, ri) => {
                  const st = localizeTaskStatus(r.status, t)
                  return H(
                    'div',
                    { key: `${r.taskId}-${ri}`, className: 'sm-tool-task-item' },
                    H(
                      'div',
                      { className: 'sm-tool-task-top' },
                      H('span', { className: 'sm-inline-mention' }, AgentIcon({ React, size: 11 }), `@${r.assigneeSlug}`),
                      H('span', { className: `sm-tool-pill ${st.pill}` }, st.label || r.status),
                    ),
                    r.reply ? renderMarkdownMessage(H, r.reply, { keyPrefix: `${keyBase}-pr-${ri}`, t }) : null,
                  )
                }),
              )
            : null,
        )
      }

      // 5. mesh_task_update
      if (toolName === 'mesh_task_update') {
        const effStatus = parsedUpdate?.status || argStatus
        const st = effStatus ? localizeTaskStatus(effStatus, t) : null
        const taskTitle = parsedUpdate?.title || ''
        const taskIdDisplay = parsedUpdate?.taskId || argTaskId
        const summaryText = argSummary || parsedUpdate?.summary || ''
        const allArtifacts = [...new Set([...argArtifacts, ...argShareFiles])]
        const prio = localizePriority(args.priority, t)

        return H(
          'div',
          { className: 'sm-tool-section' },
          H(
            'div',
            { className: 'sm-tool-meta-row' },
            taskTitle ? H('span', { className: 'sm-tool-meta-title' }, taskTitle) : null,
            st?.label ? H('span', { className: `sm-tool-pill ${st.pill}` }, st.label) : null,
            prio ? H('span', { className: `sm-tool-pill ${prio.pill}` }, prio.label) : null,
            argAssignee ? H('span', { className: 'sm-inline-mention' }, AgentIcon({ React, size: 11 }), `@${argAssignee}`) : null,
            taskIdDisplay ? H('span', { className: 'sm-tool-pill sm-tool-pill-mono' }, taskIdDisplay) : null,
          ),
          summaryText
            ? renderMarkdownMessage(H, summaryText, { keyPrefix: `${keyBase}-upd`, t })
            : (!parsedUpdate && isDone && rawOutput ? renderMarkdownMessage(H, rawOutput, { keyPrefix: `${keyBase}-upd-raw`, t }) : null),
          allArtifacts.length > 0
            ? H(
                'div',
                { className: 'sm-tool-files' },
                H('span', { className: 'sm-tool-section-label' }, t('taskArtifactsLabel')),
                ...allArtifacts.map((art, ai) =>
                  renderArtifactOrFileChip(H, React, art, { key: `art-${ai}-${art}`, openFile: props.openFile, t }),
                ),
              )
            : null,
          (parsedUpdate?.sharedCount > 0 || parsedUpdate?.unblockedCount > 0)
            ? H(
                'div',
                { className: 'sm-tool-meta-row' },
                parsedUpdate.sharedCount > 0
                  ? H('span', { className: 'sm-tool-note' }, t('toolSharedFilesNote', { count: parsedUpdate.sharedCount }))
                  : null,
                parsedUpdate.unblockedCount > 0
                  ? H('span', { className: 'sm-tool-pill ok' }, t('toolUnblockedNote', { count: parsedUpdate.unblockedCount }))
                  : null,
              )
            : null,
        )
      }

      // 6. mesh_task_board
      if (toolName === 'mesh_task_board' && parsedBoard) {
        const c = parsedBoard.counts
        const pct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0
        return H(
          'div',
          { className: 'sm-tool-section' },
          c.total === 0
            ? H('div', { className: 'sm-tool-note' }, t('toolBoardEmpty'))
            : H(
                React.Fragment || 'div',
                null,
                H(
                  'div',
                  { className: 'sm-tool-meta-row' },
                  H('span', { className: 'sm-tool-pill ok' }, t('toolBoardSummaryDone', { done: c.done, total: c.total })),
                  c.inProgress > 0 ? H('span', { className: 'sm-tool-pill info' }, t('toolBoardSummaryProgress', { count: c.inProgress })) : null,
                  c.inReview > 0 ? H('span', { className: 'sm-tool-pill review' }, t('toolBoardSummaryReview', { count: c.inReview })) : null,
                  c.blocked > 0 ? H('span', { className: 'sm-tool-pill err' }, t('toolBoardSummaryBlocked', { count: c.blocked })) : null,
                  c.pendingApproval > 0 ? H('span', { className: 'sm-tool-pill warn' }, t('toolBoardSummaryApproval', { count: c.pendingApproval })) : null,
                ),
                H(
                  'div',
                  { className: 'sm-tool-progress-bar' },
                  H('div', { className: `sm-tool-progress-fill${c.done === c.total ? ' is-complete' : ''}`, style: { width: `${pct}%` } }),
                ),
                H(
                  'div',
                  { className: 'sm-tool-task-list', style: { marginTop: '4px' } },
                  ...parsedBoard.tasks.map((tk, idx) => {
                    const st = localizeTaskStatus(tk.status, t)
                    return H(
                      'div',
                      {
                        key: tk.id || idx,
                        className: `sm-tool-task-item${tk.status === 'done' ? ' is-done' : ''}${tk.status === 'blocked' ? ' is-blocked' : ''}`,
                      },
                      H(
                        'div',
                        { className: 'sm-tool-task-top' },
                        H(
                          'div',
                          { className: 'sm-tool-task-left' },
                          H('span', { className: `sm-tool-task-dot ${st.tone}` }),
                          H('span', { className: 'sm-tool-task-title' }, tk.title),
                          tk.assigneeSlug
                            ? H('span', { className: 'sm-inline-mention' }, AgentIcon({ React, size: 11 }), `@${tk.assigneeSlug}`)
                            : null,
                        ),
                        H(
                          'div',
                          { className: 'sm-tool-meta-row', style: { gap: '4px' } },
                          tk.approval === 'pending' ? H('span', { className: 'sm-tool-pill warn' }, t('taskApprovalPending')) : null,
                          H('span', { className: `sm-tool-pill ${st.pill}` }, st.label),
                        ),
                      ),
                      tk.summary ? H('div', { className: 'sm-tool-task-desc' }, tk.summary) : null,
                      tk.artifacts.length > 0
                        ? H(
                            'div',
                            { className: 'sm-tool-files', style: { paddingLeft: '13px', marginTop: '2px' } },
                            ...tk.artifacts.map((art, ai) =>
                              renderArtifactOrFileChip(H, React, art, { key: `ba-${idx}-${ai}-${art}`, openFile: props.openFile, t }),
                            ),
                          )
                        : null,
                    )
                  }),
                ),
              ),
        )
      }

      // 7. mesh_discuss_group
      if (toolName === 'mesh_discuss_group') {
        const groupTitle = parsedDiscuss?.groupName || argGroupName || parseRoomDisplayName(argRoomId, controller)
        return H(
          'div',
          { className: 'sm-tool-section' },
          (parsedDiscuss || groupTitle)
            ? H(
                'div',
                { className: 'sm-tool-meta-row' },
                groupTitle ? H('span', { className: 'sm-tool-meta-title' }, groupTitle) : null,
                parsedDiscuss?.kind === 'created'
                  ? H('span', { className: 'sm-tool-pill ok' }, t('toolGroupCreatedBadge'))
                  : parsedDiscuss?.kind === 'reused'
                    ? H('span', { className: 'sm-tool-pill info' }, t('toolGroupReusedBadge'))
                    : null,
                parsedDiscuss?.moderatorSlug
                  ? H(
                      'span',
                      { className: 'sm-member-tag moderator', style: { cursor: 'default' } },
                      ModeratorCrownIcon({ React, size: 11 }),
                      `${t('toolModeratorLabel')}: @${parsedDiscuss.moderatorSlug}`,
                    )
                  : null,
              )
            : null,
          parsedDiscuss?.members?.length > 0
            ? H(
                'div',
                { className: 'sm-peer-checks' },
                ...parsedDiscuss.members.map((m) =>
                  H(
                    'span',
                    { key: m.slug, className: 'sm-member-tag', style: { cursor: 'default' }, title: m.description || m.role || '' },
                    AgentIcon({ React, size: 11 }),
                    `@${m.slug}${m.role ? ` · ${m.role}` : ''}`,
                  ),
                ),
              )
            : null,
          argTopic
            ? H(
                'div',
                { className: 'sm-tool-section', style: { marginTop: '2px' } },
                H('div', { className: 'sm-tool-section-label' }, t('toolTopicLabel')),
                renderMarkdownMessage(H, argTopic, { keyPrefix: `${keyBase}-topic`, t }),
              )
            : null,
          isDone && !parsedDiscuss && parsedReply.body
            ? H(
                'div',
                { className: 'sm-tool-section', style: { marginTop: '2px' } },
                H(
                  'div',
                  { className: 'sm-tool-section-label' },
                  `${t('toolModeratorReplyLabel')}${parsedReply.repliedBy ? ` · @${parsedReply.repliedBy}` : ''}`,
                ),
                renderMarkdownMessage(H, parsedReply.body, { keyPrefix: `${keyBase}-modrep`, t }),
              )
            : null,
        )
      }

      // 8. mesh_send_message
      if (toolName === 'mesh_send_message') {
        const destName = parseRoomDisplayName(argRoomId, controller)
        return H(
          'div',
          { className: 'sm-tool-section' },
          destName
            ? H(
                'div',
                { className: 'sm-tool-meta-row' },
                H('span', { className: 'sm-tool-pill info' }, `${t('toolSentToLabel')} ${destName}`),
              )
            : null,
          argText ? renderMarkdownMessage(H, argText, { keyPrefix: `${keyBase}-msg`, t }) : null,
          isError && rawOutput ? H('div', { className: 'sm-tool-error-box' }, rawOutput) : null,
        )
      }

      // 9. mesh_request_approval
      if (toolName === 'mesh_request_approval') {
        const apprTitle = argTitle || parsedApproval?.title || ''
        const destName = parseRoomDisplayName(argRoomId, controller)
        return H(
          'div',
          { className: 'sm-tool-approval-box' },
          H(
            'div',
            { className: 'sm-tool-meta-row' },
            ShieldCheckIcon({ React, size: 13 }),
            apprTitle ? H('span', { className: 'sm-tool-meta-title' }, apprTitle) : null,
            H('span', { className: 'sm-tool-pill warn' }, t('taskApprovalPending')),
            destName ? H('span', { className: 'sm-tool-pill' }, destName) : null,
            argAssignee ? H('span', { className: 'sm-inline-mention' }, AgentIcon({ React, size: 11 }), `@${argAssignee}`) : null,
          ),
          argPrompt ? renderMarkdownMessage(H, argPrompt, { keyPrefix: `${keyBase}-appr`, t }) : null,
          isDone && !isError
            ? H('div', { className: 'sm-tool-note' }, t('toolApprovalWaitingNote'))
            : null,
        )
      }

      // Fallback for any unexpected tool name
      const fallbackArgText = argTopic || argText || argPrompt || argSummary
      return H(
        'div',
        { className: 'sm-tool-section' },
        fallbackArgText ? renderMarkdownMessage(H, fallbackArgText, { keyPrefix: `${keyBase}-arg`, t }) : null,
        isDone && rawOutput ? renderMarkdownMessage(H, parsedReply.body || rawOutput, { keyPrefix: `${keyBase}-out`, t }) : null,
      )
    }

    return H(
      'div',
      { className: `sm-tool-card ${statusClass}` },
      H(
        'button',
        {
          type: 'button',
          className: 'sm-tool-head',
          disabled: !hasDetails,
          onClick: () => { if (hasDetails) toggleExpand() },
        },
        H(
          'span',
          { className: 'sm-tool-head-left' },
          hasDetails ? ChevronIcon({ React, size: 11, rotated: expanded }) : null,
          H('span', { className: 'sm-tool-icon' }, iconEl),
          H('span', { className: 'sm-tool-title' }, titleText),
          targetPill ? H('span', { className: `sm-tool-target${targetPillExtraClass}` }, targetPill) : null,
          summaryPreview ? H('span', { className: 'sm-tool-preview' }, summaryPreview) : null,
        ),
        H(
          'span',
          { className: `sm-tool-status ${statusClass}` },
          isRunning
            ? H('span', { className: 'sm-dot-live' })
            : !isError
              ? CheckIcon({ React, size: 11 })
              : null,
          statusLabel,
        ),
      ),
      expanded && hasDetails
        ? H('div', { className: 'sm-tool-body' }, renderBody())
        : null,
    )
  }
}

function asCleanSlug(val) {
  return typeof val === 'string' ? val.trim().replace(/^@/, '') : ''
}

/**
 * Clean collapsible card for `[SANDBOX MESH INCOMING REQUEST]` messages when a user opens
 * a Mesh Agent session inside the DSH sidebar, hiding XML wrapper tags & prompt boilerplate.
 */
export function createMeshWakePromptView({ React, getLocale }) {
  const H = React.createElement
  const { useState } = React

  return function MeshWakePromptCard({ node, raw }) {
    const [showRaw, setShowRaw] = useState(false)
    const t = createTranslator(typeof getLocale === 'function' ? getLocale() : 'en')
    const meta = node?.data || parseIncomingWakePrompt(raw) || {}
    const senderText = meta.senderSlug
      ? (meta.senderName && meta.senderName !== meta.senderSlug ? `${meta.senderName} (@${meta.senderSlug})` : `@${meta.senderSlug}`)
      : ''

    return H(
      'div',
      { className: 'sm-wake-card' },
      H(
        'div',
        { className: 'sm-wake-head' },
        H(
          'span',
          { className: 'sm-row', style: { gap: '6px', flexWrap: 'wrap' } },
          MeshNavIcon({ React, size: 13 }),
          H('strong', null, t('wakeCardTitle')),
          senderText ? H('span', { className: 'sm-badge' }, `${t('wakeCardFrom')}: ${senderText}`) : null,
          meta.roomName ? H('span', { className: 'sm-badge sm-badge-moderator' }, `${t('wakeCardRoom')}: ${meta.roomName}`) : null,
        ),
        H(
          'button',
          {
            type: 'button',
            className: 'sm-btn-ghost',
            style: { fontSize: '11px' },
            onClick: () => setShowRaw((v) => !v),
          },
          showRaw ? t('wakeCardHideRaw') : t('wakeCardShowRaw'),
        ),
      ),
      showRaw
        ? H('pre', { className: 'sm-wake-raw' }, raw || meta.raw || '')
        : H(
            'div',
            { className: 'sm-wake-body' },
            renderMarkdownMessage(H, meta.body || raw || '', { keyPrefix: 'wake', t }),
          ),
    )
  }
}
