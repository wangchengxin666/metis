import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  areTaskDependenciesMet,
  canStartNewTopic,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MESH_PORT,
  extractFileReferences,
  extractMentions,
  findSupersededBlockedTasks,
  pairRoomId,
  parsePairInvite,
  sanitizeSlug,
} from './src/shared/protocol.js'
import {
  buildSignedHeaders,
  createRateLimiter,
  createReplayGuard,
  deriveEcdhSharedSecret,
  generateEcdhKeyPair,
  generateRandomHex,
  sha256Hex,
} from './src/host/crypto.js'
import {
  classifyAttachmentFile,
  createFileShareGuard,
  maxMeshBodyBytes,
  safeFileName,
  searchWorkspaceFiles,
  uniqueFilePath,
} from './src/host/files.js'
import { createMeshStore, resolveStoragePath } from './src/host/store.js'
import { installAgentBridge, syncSkillFile } from './src/host/agent-bridge.js'
import { wireHarnessRuntime } from './src/host/harness-bridge.js'
import {
  APPROVAL_DECIDE_ENDPOINT,
  createIncomingMeshHandler,
  FILE_DOWNLOAD_ENDPOINT,
  FILE_UPLOAD_ENDPOINT,
  FILES_ENDPOINT,
  GROUP_CREATE_ENDPOINT,
  GROUP_INVITE_ENDPOINT,
  GROUP_LEAVE_ENDPOINT,
  GROUP_MODERATE_ENDPOINT,
  GROUP_REMOVE_ENDPOINT,
  GROUP_RENAME_ENDPOINT,
  MARK_READ_ENDPOINT,
  NEW_TOPIC_ENDPOINT,
  PAIR_CLAIM_ENDPOINT,
  PAIR_CODE_ENDPOINT,
  PEER_PING_ENDPOINT,
  PEER_REMOVE_ENDPOINT,
  PROFILE_ENDPOINT,
  registerBrowserRoutes,
  ROOM_REMOVE_ENDPOINT,
  SEND_ENDPOINT,
  SEND_FILE_ENDPOINT,
  STATE_ENDPOINT,
  TASK_CREATE_ENDPOINT,
  TASK_UPDATE_ENDPOINT,
} from './src/host/routes.js'

export const name = 'sandbox-mesh'

export {
  STATE_ENDPOINT,
  PROFILE_ENDPOINT,
  FILES_ENDPOINT,
  FILE_DOWNLOAD_ENDPOINT,
  FILE_UPLOAD_ENDPOINT,
  PAIR_CODE_ENDPOINT,
  PAIR_CLAIM_ENDPOINT,
  GROUP_CREATE_ENDPOINT,
  GROUP_INVITE_ENDPOINT,
  GROUP_MODERATE_ENDPOINT,
  GROUP_REMOVE_ENDPOINT,
  GROUP_LEAVE_ENDPOINT,
  GROUP_RENAME_ENDPOINT,
  NEW_TOPIC_ENDPOINT,
  SEND_ENDPOINT,
  SEND_FILE_ENDPOINT,
  MARK_READ_ENDPOINT,
  PEER_REMOVE_ENDPOINT,
  PEER_PING_ENDPOINT,
  ROOM_REMOVE_ENDPOINT,
  TASK_CREATE_ENDPOINT,
  TASK_UPDATE_ENDPOINT,
  APPROVAL_DECIDE_ENDPOINT,
  searchWorkspaceFiles,
  maxMeshBodyBytes,
}

export function buildCandidateBaseUrls(endpointUrl, targetSlug = '', env = process.env, preferredBaseUrl = '') {
  const candidates = []
  const add = (url) => {
    const clean = typeof url === 'string' ? url.trim().replace(/\/+$/, '') : ''
    if (clean && !candidates.includes(clean)) candidates.push(clean)
  }

  add(preferredBaseUrl)
  add(endpointUrl)

  const slug = sanitizeSlug(targetSlug)
  const portMatch = String(endpointUrl || '').match(/\/p\/(\d+)$/)
  const meshPort = portMatch ? portMatch[1] : String(env.DSH_MESH_PORT || DEFAULT_MESH_PORT)

  if (slug) {
    const internalGw = String(env.DSH_GATEWAY_INTERNAL_URL || 'http://dsh-gateway:9000').trim().replace(/\/+$/, '')
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/s\//i.test(String(endpointUrl || ''))) {
      add(`${internalGw}/s/${slug}/p/${meshPort}`)
      add(`http://dsh-sbx-${slug}:8080/p/${meshPort}`)
    } else {
      add(`http://dsh-sbx-${slug}:8080/p/${meshPort}`)
    }
  }

  return candidates
}

function buildGroupRoomMeta(room, { syncRemovals = false } = {}) {
  if (!room || room.type !== 'group') return null
  const meta = {
    id: room.id,
    type: 'group',
    name: room.name,
    groupSecret: room.groupSecret,
    createdBy: room.createdBy,
    moderatorSlug: room.moderatorSlug || room.createdBy || '',
    activeThreadId: room.activeThreadId || '',
    createdAt: room.createdAt,
    members: room.members,
  }
  if (syncRemovals) {
    meta.syncRemovals = true
  }
  return meta
}

export function createMeshService({
  config = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = null,
} = {}) {
  const storagePath = resolveStoragePath(config, env)
  const store = createMeshStore({ filePath: storagePath, config, env })
  const replayGuard = createReplayGuard()
  const pairLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxAttempts: Number(config.pairRateLimit) > 0 ? Number(config.pairRateLimit) : 5,
  })
  const wakeLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxAttempts: Number(config.wakeRateLimit) > 0 ? Number(config.wakeRateLimit) : 20,
  })
  const localToken = String(config.localToken || generateRandomHex(24))
  const homeDir = String(config.homeDir || env.HOME || '').trim() || homedir()
  const inboxDir = String(config.inboxDir || join(homeDir, 'mesh-inbox'))
  const maxFileBytes = Number(config.maxFileBytes) > 0 ? Number(config.maxFileBytes) : DEFAULT_MAX_FILE_BYTES
  const requestTimeoutMs = Number(config.requestTimeoutMs) > 0 ? Number(config.requestTimeoutMs) : 15 * 1000
  const fileTimeoutMs = Number(config.fileTimeoutMs) > 0 ? Number(config.fileTimeoutMs) : 120 * 1000
  const wakeTimeoutMs = Number(config.wakeTimeoutMs) > 0 ? Number(config.wakeTimeoutMs) : 90 * 1000
  const agentWakeEnabled = config.agentWakeEnabled !== false
  const agentTurnTimeoutMs = Number(config.agentTurnTimeoutMs) > 0 ? Number(config.agentTurnTimeoutMs) : 15 * 60 * 1000

  const managerUrl = String(config.managerUrl || env.METIS_MANAGER_URL || '').trim().replace(/\/+$/, '')
  const gatewayAuthSecret = String(
    config.gatewayAuthSecret || env.METIS_GATEWAY_AUTH_SECRET || env.DSH_DEFAULT_LLM_API_KEY || '',
  ).trim()
  const controlWakeEnabled = config.wakeOnMesh !== false && Boolean(managerUrl && gatewayAuthSecret)
  const inflightWakeMap = new Map()

  const resolveShareableFile = createFileShareGuard({
    homeDir,
    shareRoots: config.shareRoots || [homeDir, inboxDir],
    protectedFiles: [storagePath, String(config.localTokenPath || '')],
  })

  const AGENT_STATUS_TTL_MS = 150 * 1000
  const activityMap = new Map()
  const peerStatusSeqMap = new Map()
  const reachableBaseUrlMap = new Map()
  let localStatusSeq = 0
  let activityVersion = 0
  let agentWakeHandler = typeof config.onAgentWake === 'function' ? config.onAgentWake : null
  let catalogChangeHandler = null
  let hasRuntimeSkillProvider = false
  let outboxFlushPromise = null

  // Tracks active mesh-woken Agent turns so tools/CLI cannot lower `hop` below the turn's hop,
  // and so terminal task handoffs (Moderator notification + downstream DAG wakes) commit atomically
  // at turn end AFTER all files and replies in the turn have finished delivering.
  const activeAgentTurns = new Map()
  let agentTurnSeq = 0

  function findActiveAgentTurn(roomId = '') {
    const cleanRoom = String(roomId || '').trim()
    if (!cleanRoom) return null
    let latest = null
    for (const entry of activeAgentTurns.values()) {
      if (entry.roomId === cleanRoom) latest = entry
    }
    return latest
  }

  function hasPendingTurnNotification(roomId = '') {
    const turn = findActiveAgentTurn(roomId)
    if (!turn || turn.deferredTaskHandoffs.size === 0) return false
    const self = store.getSelf()
    const room = store.getRoom(turn.roomId)
    if (!room || room.type !== 'group') return false
    const modSlug = sanitizeSlug(room.moderatorSlug || room.createdBy || '')
    if (!modSlug || modSlug === self.slug) return false
    for (const item of turn.deferredTaskHandoffs.values()) {
      if (item.notifyModerator === false) continue
      const latest = store.getTask(item.roomId, item.taskId)
      if (!latest) continue
      if (
        latest.status !== item.initialPrevStatus
        && ['done', 'in_review', 'blocked'].includes(latest.status)
      ) {
        return true
      }
    }
    return false
  }

  function beginAgentTurn({ roomId = '', sessionId = '', hop = 1 } = {}) {
    const id = ++agentTurnSeq
    const turnEntry = {
      id,
      roomId: String(roomId || '').trim(),
      sessionId: String(sessionId || '').trim(),
      hop: Math.max(1, Math.trunc(Number(hop) || 1)),
      deferredTaskHandoffs: new Map(),
      ended: false,
    }
    activeAgentTurns.set(id, turnEntry)
    return async () => {
      if (turnEntry.ended) return []
      turnEntry.ended = true
      activeAgentTurns.delete(id)
      if (turnEntry.deferredTaskHandoffs.size === 0) return []
      const queued = Array.from(turnEntry.deferredTaskHandoffs.values())
      turnEntry.deferredTaskHandoffs.clear()
      const flushed = []
      for (const item of queued) {
        try {
          const res = await dispatchTaskHandoff(item)
          flushed.push({ taskId: item.taskId, ...res })
        } catch (err) {
          logger?.warn?.(`Deferred task handoff failed for ${item.taskId}: ${err?.message || err}`)
        }
      }
      return flushed
    }
  }

  function getActiveAgentHop(roomId = '', sessionId = '') {
    const cleanRoom = String(roomId || '').trim()
    const cleanSid = String(sessionId || '').trim()
    let max = 0
    for (const entry of activeAgentTurns.values()) {
      if (cleanSid && entry.sessionId === cleanSid && entry.hop > max) {
        max = entry.hop
      } else if (cleanRoom && entry.roomId === cleanRoom && entry.hop > max) {
        max = entry.hop
      }
    }
    return max
  }

  function getRevision() {
    return store.getRevision() + activityVersion
  }

  function pruneActivity(nowMs = Date.now()) {
    for (const [key, entry] of activityMap.entries()) {
      if (!entry || entry.expiresAt <= nowMs) {
        activityMap.delete(key)
      }
    }
  }

  function getActiveStatuses(nowMs = Date.now()) {
    pruneActivity(nowMs)
    const grouped = {}
    for (const entry of activityMap.values()) {
      if (!grouped[entry.roomId]) grouped[entry.roomId] = []
      grouped[entry.roomId].push({
        roomId: entry.roomId,
        slug: entry.slug,
        ownerName: entry.ownerName,
        stage: entry.stage,
        detail: entry.detail,
        isModerator: entry.isModerator,
        updatedAt: entry.updatedAt,
      })
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => a.updatedAt - b.updatedAt)
    }
    return grouped
  }

  function getStateSnapshot() {
    return {
      ...store.getSnapshot(),
      activeStatuses: getActiveStatuses(),
    }
  }

  function resolveMemberTransport(room, member) {
    const peer = store.getPeer(member.slug)
    // Prefer pairwise secret whenever paired so all direct-peer communication carries `pair` scope.
    const secret = peer?.sharedSecret || (room?.type === 'group' ? room.groupSecret : '')
    const endpointUrl = peer?.endpointUrl || member.endpointUrl
    return { secret, endpointUrl }
  }

  async function wakeSleepingPeer(targetSlug) {
    const cleanTarget = sanitizeSlug(targetSlug)
    if (!cleanTarget || !controlWakeEnabled) return { ok: false, skipped: true }
    if (inflightWakeMap.has(cleanTarget)) {
      return inflightWakeMap.get(cleanTarget)
    }
    const self = store.getSelf()
    const promise = (async () => {
      const ac = typeof AbortController === 'function' ? new AbortController() : null
      const timer = ac ? setTimeout(() => ac.abort(new Error(`Wake peer timed out after ${wakeTimeoutMs}ms`)), wakeTimeoutMs) : null
      try {
        const res = await fetchImpl(
          `${managerUrl}/api/internal/mesh/wake/${encodeURIComponent(cleanTarget)}`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'x-metis-sandbox-slug': sanitizeSlug(env.METIS_SANDBOX_SLUG || self.slug),
              'x-metis-gateway-auth': gatewayAuthSecret,
            },
            body: JSON.stringify({ requester: self.slug }),
            signal: ac?.signal,
          },
        )
        const data = await res.json().catch(() => ({}))
        return { ok: res.ok && data.ok !== false, status: res.status, data }
      } catch (err) {
        return { ok: false, status: 502, error: err?.message || String(err) }
      } finally {
        if (timer) clearTimeout(timer)
        inflightWakeMap.delete(cleanTarget)
      }
    })()
    inflightWakeMap.set(cleanTarget, promise)
    return promise
  }

  async function emitControlPlaneEvent(eventType, details = {}) {
    if (!controlWakeEnabled) return
    const self = store.getSelf()
    const ac = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ac ? setTimeout(() => ac.abort(new Error('Control-plane event timeout')), 5000) : null
    try {
      await fetchImpl(`${managerUrl}/api/internal/mesh/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-metis-sandbox-slug': sanitizeSlug(env.METIS_SANDBOX_SLUG || self.slug),
          'x-metis-gateway-auth': gatewayAuthSecret,
        },
        body: JSON.stringify({
          event: eventType,
          sandboxSlug: self.slug,
          ...details,
        }),
        signal: ac?.signal,
      })
    } catch {
      // Best-effort event callback; manager BackgroundWorker reconciles periodically as fallback
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function checkControlPlaneToolPolicy(toolName, argsSummary = '', context = {}) {
    if (!controlWakeEnabled) {
      return { ok: true, allowed: true, action: 'allow', rule_name: null, approval_id: null }
    }
    const self = store.getSelf()
    const ac = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ac ? setTimeout(() => ac.abort(new Error('Tool policy check timeout')), 6000) : null
    try {
      const res = await fetchImpl(`${managerUrl}/api/internal/mesh/tool-check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-metis-sandbox-slug': sanitizeSlug(env.METIS_SANDBOX_SLUG || self.slug),
          'x-metis-gateway-auth': gatewayAuthSecret,
        },
        body: JSON.stringify({
          tool_name: String(toolName || '').trim(),
          args_summary: String(argsSummary || '').slice(0, 2000),
          playbook_run_id: context.playbookRunId || '',
          playbook_step_id: context.playbookStepId || '',
        }),
        signal: ac?.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false, allowed: true, action: 'allow', error: data.detail || `HTTP ${res.status}` }
      }
      return { ok: true, ...data }
    } catch (err) {
      return { ok: false, allowed: true, action: 'allow', error: err?.message || String(err) }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function checkControlPlaneToolApprovalStatus(approvalId) {
    if (!controlWakeEnabled || !approvalId) {
      return { ok: false, error: 'Control plane unavailable or missing approvalId' }
    }
    const self = store.getSelf()
    const ac = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ac ? setTimeout(() => ac.abort(new Error('Tool approval status timeout')), 6000) : null
    try {
      const res = await fetchImpl(
        `${managerUrl}/api/internal/mesh/tool-check/${encodeURIComponent(String(approvalId))}`,
        {
          method: 'GET',
          headers: {
            'x-metis-sandbox-slug': sanitizeSlug(env.METIS_SANDBOX_SLUG || self.slug),
            'x-metis-gateway-auth': gatewayAuthSecret,
          },
          signal: ac?.signal,
        },
      )
      const data = await res.json().catch(() => ({}))
      return { ok: res.ok, ...data }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function postToPeer({
    targetSlug,
    endpointUrl,
    path,
    payload,
    secret,
    groupId = '',
    signed = true,
    timeoutMs = requestTimeoutMs,
  }) {
    const body = JSON.stringify(payload)
    const self = store.getSelf()
    const headers = signed
      ? buildSignedHeaders({
          method: 'POST',
          path,
          body,
          secret,
          fromSlug: self.slug,
          groupId,
        })
      : { 'content-type': 'application/json; charset=utf-8' }

    const preferredUrl = reachableBaseUrlMap.get(sanitizeSlug(targetSlug)) || ''
    const candidates = buildCandidateBaseUrls(endpointUrl, targetSlug, env, preferredUrl)
    let lastError = 'No reachable endpoint'

    for (let pass = 0; pass < 2; pass++) {
      let sawWakeableFailure = false
      for (const baseUrl of candidates) {
        const fullUrl = `${baseUrl}${path}`
        const ac = typeof AbortController === 'function' ? new AbortController() : null
        const timer = ac ? setTimeout(() => ac.abort(new Error(`Mesh request timed out after ${timeoutMs}ms`)), timeoutMs) : null
        try {
          const res = await fetchImpl(fullUrl, {
            method: 'POST',
            headers,
            body,
            signal: ac?.signal,
          })
          const data = await res.json().catch(() => ({}))
          if (res.ok && data.ok !== false) {
            if (targetSlug) reachableBaseUrlMap.set(sanitizeSlug(targetSlug), baseUrl)
            return { ok: true, data, usedBaseUrl: baseUrl, wokePeer: pass > 0 }
          }
          lastError = data.error || `HTTP ${res.status}`
          if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 413 || res.status === 429) {
            return { ok: false, status: res.status, error: lastError }
          }
          if (res.status === 502 || res.status === 503 || res.status === 504 || data?.sleeping) {
            sawWakeableFailure = true
          }
        } catch (err) {
          lastError = err?.message || String(err)
          sawWakeableFailure = true
        } finally {
          if (timer) clearTimeout(timer)
        }
      }

      if (pass === 0 && targetSlug && controlWakeEnabled && sawWakeableFailure) {
        const wakeRes = await wakeSleepingPeer(targetSlug)
        if (wakeRes?.ok) {
          continue
        }
      }
      break
    }

    return { ok: false, status: 502, error: lastError }
  }

  async function deliverToRoomMembers(
    room,
    { path, payload, enqueueOnFailure = false, timeoutMs = requestTimeoutMs, targetSlugs = null },
  ) {
    const self = store.getSelf()
    const recipients = (room?.members || []).filter((m) => {
      if (m.slug === self.slug) return false
      if (Array.isArray(targetSlugs) && targetSlugs.length > 0) {
        return targetSlugs.includes(m.slug)
      }
      return true
    })
    const groupId = room?.type === 'group' ? room.id : ''
    const outboxEntries = []

    const results = await Promise.all(
      recipients.map(async (member) => {
        const { secret, endpointUrl } = resolveMemberTransport(room, member)
        if (!secret || !endpointUrl) {
          return { slug: member.slug, ok: false, authRejected: false }
        }
        let res
        try {
          res = await postToPeer({ targetSlug: member.slug, endpointUrl, path, payload, secret, groupId, timeoutMs })
        } catch (err) {
          res = { ok: false, error: err?.message || String(err) }
        }
        const authRejected = !res.ok && (res.status === 401 || res.status === 403)
        if (res.ok && store.getPeer(member.slug)) {
          store.setPeerStatus(member.slug, 'online')
        } else if (authRejected && room?.type === 'pair' && store.getPeer(member.slug)) {
          store.setPeerStatus(member.slug, 'unpaired-by-peer')
        }
        if (!res.ok && enqueueOnFailure && (!res.status || res.status >= 500 || res.status === 429)) {
          outboxEntries.push({ targetSlug: member.slug, endpointUrl, path, payload, groupId })
        }
        return { slug: member.slug, ok: Boolean(res.ok), authRejected }
      }),
    )

    if (outboxEntries.length > 0) {
      store.enqueueOutboxBatch(outboxEntries)
    }

    return {
      deliveredTo: results.filter((r) => r.ok).map((r) => r.slug),
      pendingPeers: results.filter((r) => !r.ok).map((r) => r.slug),
      authRejectedPeers: results.filter((r) => r.authRejected).map((r) => r.slug),
    }
  }

  async function broadcastActivityToRoom(roomId, payload) {
    const room = store.getRoom(roomId)
    if (!room || !Array.isArray(room.members)) return
    await deliverToRoomMembers(room, {
      path: '/mesh/status',
      payload,
      timeoutMs: Math.min(requestTimeoutMs, 5000),
    })
  }

  function setAgentActivity({
    roomId,
    slug,
    ownerName = '',
    stage = 'preparing',
    detail = '',
    isModerator = false,
    broadcast = true,
    ttlMs = AGENT_STATUS_TTL_MS,
  } = {}) {
    const cleanRoomId = String(roomId || '').trim()
    const cleanSlug = sanitizeSlug(slug)
    if (!cleanRoomId || !cleanSlug) return null
    const nowMs = Date.now()
    const key = `${cleanRoomId}:${cleanSlug}`
    const seq = ++localStatusSeq
    activityVersion += 1
    const entry = {
      roomId: cleanRoomId,
      slug: cleanSlug,
      ownerName: String(ownerName || cleanSlug).trim() || cleanSlug,
      stage: String(stage || 'preparing'),
      detail: String(detail || ''),
      isModerator: Boolean(isModerator),
      updatedAt: nowMs,
      expiresAt: nowMs + Math.max(5000, Number(ttlMs) || AGENT_STATUS_TTL_MS),
    }
    activityMap.set(key, entry)
    if (broadcast) {
      void broadcastActivityToRoom(cleanRoomId, {
        action: 'set',
        seq,
        roomId: cleanRoomId,
        slug: cleanSlug,
        ownerName: entry.ownerName,
        stage: entry.stage,
        detail: entry.detail,
        isModerator: entry.isModerator,
      })
    }
    return entry
  }

  function clearAgentActivity({ roomId, slug, broadcast = true } = {}) {
    const cleanRoomId = String(roomId || '').trim()
    const cleanSlug = sanitizeSlug(slug)
    if (!cleanRoomId || !cleanSlug) return false
    const existed = activityMap.delete(`${cleanRoomId}:${cleanSlug}`)
    if (existed) activityVersion += 1
    const seq = ++localStatusSeq
    if (broadcast) {
      void broadcastActivityToRoom(cleanRoomId, {
        action: 'clear',
        seq,
        roomId: cleanRoomId,
        slug: cleanSlug,
      })
    }
    return existed
  }

  function setAgentWakeHandler(fn) {
    agentWakeHandler = typeof fn === 'function' ? fn : null
  }

  function setCatalogChangeHandler(fn) {
    catalogChangeHandler = typeof fn === 'function' ? fn : null
  }

  function setHasRuntimeSkillProvider(active) {
    hasRuntimeSkillProvider = Boolean(active)
  }

  function notifyCatalogChanged() {
    if (!hasRuntimeSkillProvider) {
      syncSkillFile({ config, env, snapshot: store.getSnapshot() })
    }
    if (typeof catalogChangeHandler === 'function') {
      try { catalogChangeHandler() } catch {}
    }
  }

  function maybeDispatchAgentWake(roomId, message, duplicate, wakeInfo) {
    if (duplicate || !wakeInfo?.wake || !agentWakeEnabled || typeof agentWakeHandler !== 'function') return
    const room = store.getRoom(roomId)
    if (!room) return
    const senderSlug = sanitizeSlug(message?.sender?.slug || '') || 'global'
    if (!wakeLimiter.allow(senderSlug)) {
      logger?.warn?.(`Rate-limited agent wake from "${senderSlug}" in room "${roomId}"`)
      return
    }
    // Ack ONLY this message after its wake handler completes successfully.
    Promise.resolve()
      .then(() => agentWakeHandler({
        room,
        message,
        nextHop: wakeInfo.nextHop || 1,
      }))
      .then(() => {
        store.ackAgentMessage(roomId, message.id)
      })
      .catch((err) => {
        logger?.warn?.(`Agent wake failed for message ${message.id}: ${err?.message || err}`)
      })
  }

  async function claimPairInvite(rawInvite, headers = null) {
    store.updateSelf(headers)
    const self = store.getSelf()
    const parsed = parsePairInvite(rawInvite, self.publicOrigin, self.meshPort)
    if (!parsed) {
      return { ok: false, status: 400, error: 'Invalid pair code or URI format' }
    }
    if (parsed.slug === self.slug) {
      return { ok: false, status: 400, error: 'Cannot pair a sandbox with itself' }
    }

    const ecdhKp = generateEcdhKeyPair()
    const result = await postToPeer({
      targetSlug: parsed.slug,
      endpointUrl: parsed.endpointUrl,
      path: '/pair/claim',
      signed: false,
      payload: {
        token: parsed.token,
        peerPublicKey: ecdhKp.publicKeyB64,
        peerProfile: {
          slug: self.slug,
          ownerName: self.ownerName,
          ownerEmail: self.ownerEmail,
          role: self.role || '',
          description: self.description || '',
          endpointUrl: self.endpointUrl,
        },
      },
    })

    if (!result.ok) {
      return {
        ok: false,
        status: result.status || 502,
        error: result.error || `Could not reach sandbox "${parsed.slug}"`,
      }
    }

    const remoteData = result.data
    let sharedSecret = ''
    if (typeof remoteData.hostPublicKey === 'string' && remoteData.hostPublicKey) {
      try {
        sharedSecret = deriveEcdhSharedSecret(parsed.token, ecdhKp.privateKey, remoteData.hostPublicKey)
      } catch (err) {
        return { ok: false, status: 502, error: `ECDH key derivation failed: ${err?.message || err}` }
      }
    } else if (typeof remoteData.sharedSecret === 'string' && remoteData.sharedSecret) {
      sharedSecret = remoteData.sharedSecret
    } else {
      return { ok: false, status: 502, error: 'Pair response missing key agreement material' }
    }

    const remotePeerProfile = {
      ...remoteData.peer,
      endpointUrl: remoteData.peer?.endpointUrl || result.usedBaseUrl || parsed.endpointUrl,
    }
    const { peer, room } = store.upsertPairedPeer({
      peerProfile: remotePeerProfile,
      sharedSecret,
    })

    store.recordMessage({
      roomId: room.id,
      sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
      kind: 'system',
      text: `Paired with ${peer.ownerName} (${peer.slug}) via Traefik mesh.`,
    })
    notifyCatalogChanged()

    return { ok: true, peer, room, state: getStateSnapshot() }
  }

  async function broadcastGroupSync(room, targetSlugs = null, { syncRemovals = false } = {}) {
    const fullRoom = store.getRoom(room.id)
    if (!fullRoom || fullRoom.type !== 'group') return { deliveredTo: [], pendingPeers: [] }
    return deliverToRoomMembers(fullRoom, {
      path: '/mesh/group-sync',
      payload: { group: buildGroupRoomMeta(fullRoom, { syncRemovals }) },
      enqueueOnFailure: true,
      targetSlugs,
    })
  }

  async function createGroup({
    name: groupName,
    memberSlugs = [],
    moderatorSlug = '',
    headers = null,
  }) {
    store.updateSelf(headers)
    let room
    try {
      room = store.createGroupRoom({
        name: groupName,
        memberSlugs,
        moderatorSlug,
      })
    } catch (err) {
      return { ok: false, status: 400, error: err?.message || String(err) }
    }
    const syncResult = await broadcastGroupSync(room)
    const self = store.getSelf()
    store.recordMessage({
      roomId: room.id,
      threadId: room.activeThreadId || '',
      sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
      kind: 'system',
      text: `Created group "${room.name}" (Moderator: @${room.moderatorSlug}) with ${room.members.map((m) => m.slug).join(', ')}.`,
      delivery: syncResult,
    })
    notifyCatalogChanged()
    return { ok: true, room, sync: syncResult, state: getStateSnapshot() }
  }

  async function inviteToGroup({ roomId, memberSlugs = [], headers = null }) {
    store.updateSelf(headers)
    let room
    try {
      room = store.addMembersToGroup(roomId, memberSlugs)
    } catch (err) {
      return { ok: false, status: 400, error: err?.message || String(err) }
    }
    const syncResult = await broadcastGroupSync(room)
    const self = store.getSelf()
    await sendMessage({
      roomId: room.id,
      text: `${self.ownerName} (${self.slug}) invited ${memberSlugs.join(', ')} to the group.`,
      kind: 'system',
      actor: 'system',
    })
    return { ok: true, room, sync: syncResult, state: getStateSnapshot() }
  }

  async function updateGroupModeration({ roomId, moderatorSlug, headers = null }) {
    store.updateSelf(headers)
    let room
    try {
      room = store.updateGroupModeration(roomId, { moderatorSlug })
    } catch (err) {
      return { ok: false, status: 400, error: err?.message || String(err) }
    }
    const syncResult = await broadcastGroupSync(room)
    notifyCatalogChanged()
    return { ok: true, room, sync: syncResult, state: getStateSnapshot() }
  }

  async function renameGroup({ roomId, name: nextName, headers = null }) {
    store.updateSelf(headers)
    let room
    try {
      room = store.renameGroupRoom(roomId, nextName)
    } catch (err) {
      return { ok: false, status: 400, error: err?.message || String(err) }
    }
    const self = store.getSelf()
    store.recordMessage({
      roomId: room.id,
      threadId: room.activeThreadId || '',
      sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
      kind: 'system',
      text: `Renamed group to "${room.name}".`,
    })
    const syncResult = await broadcastGroupSync(room)
    notifyCatalogChanged()
    return { ok: true, room, sync: syncResult, state: getStateSnapshot() }
  }

  function clearPeerRuntimeState({ slug = '', roomIds = [] } = {}) {
    const cleanSlug = sanitizeSlug(slug)
    if (cleanSlug) {
      reachableBaseUrlMap.delete(cleanSlug)
    }
    const cleanRooms = new Set((Array.isArray(roomIds) ? roomIds : []).filter(Boolean))
    let removedActivity = false
    for (const key of [...activityMap.keys()]) {
      const colonIdx = key.indexOf(':')
      const rId = colonIdx >= 0 ? key.slice(0, colonIdx) : ''
      const s = colonIdx >= 0 ? key.slice(colonIdx + 1) : ''
      if (cleanRooms.has(rId) || (cleanSlug && s === cleanSlug)) {
        activityMap.delete(key)
        removedActivity = true
      }
    }
    for (const key of [...peerStatusSeqMap.keys()]) {
      const colonIdx = key.indexOf(':')
      const rId = colonIdx >= 0 ? key.slice(0, colonIdx) : ''
      const s = colonIdx >= 0 ? key.slice(colonIdx + 1) : ''
      if (cleanRooms.has(rId) || (cleanSlug && s === cleanSlug)) {
        peerStatusSeqMap.delete(key)
      }
    }
    if (removedActivity) activityVersion += 1
  }

  async function unpairPeer({ slug, headers = null } = {}) {
    store.updateSelf(headers)
    const self = store.getSelf()
    const cleanSlug = sanitizeSlug(slug)
    if (!cleanSlug) {
      return { ok: false, status: 400, error: 'Peer slug is required' }
    }
    const peer = store.getPeer(cleanSlug)
    const pRoomId = pairRoomId(self.slug, cleanSlug)
    const existingPairRoom = store.getRoom(pRoomId)
    if (!peer && !existingPairRoom) {
      return {
        ok: true,
        slug: cleanSlug,
        alreadyRemoved: true,
        remoteNotified: false,
        updatedGroups: [],
        removedGroups: [],
        state: getStateSnapshot(),
      }
    }

    let remoteNotified = false
    let remoteError = ''
    if (peer?.sharedSecret && peer?.endpointUrl) {
      const notifyRes = await postToPeer({
        targetSlug: cleanSlug,
        endpointUrl: peer.endpointUrl,
        path: '/mesh/unpair',
        payload: { slug: self.slug, reason: 'unpaired', unpairedAt: Date.now() },
        secret: peer.sharedSecret,
        timeoutMs: Math.min(requestTimeoutMs, 4000),
      }).catch((err) => ({ ok: false, error: err?.message || String(err) }))
      remoteNotified = Boolean(notifyRes.ok)
      remoteError = notifyRes.ok ? '' : (notifyRes.error || '')
    }

    const snapBefore = store.getSnapshot()
    const ownedGroupIds = []
    const peerOwnedGroupIds = []
    for (const grp of snapBefore.rooms || []) {
      if (grp.type !== 'group') continue
      if (grp.createdBy === self.slug && Array.isArray(grp.members) && grp.members.some((m) => m.slug === cleanSlug)) {
        ownedGroupIds.push(grp.id)
      } else if (grp.createdBy === cleanSlug) {
        peerOwnedGroupIds.push(grp.id)
      }
    }

    store.removePeer(cleanSlug)

    const updatedGroups = []
    for (const gid of ownedGroupIds) {
      try {
        const updatedRoom = store.removeGroupMember(gid, cleanSlug)
        store.recordMessage({
          roomId: gid,
          threadId: updatedRoom.activeThreadId || '',
          sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
          kind: 'system',
          text: `Removed @${cleanSlug} from group after unpairing (group key rotated).`,
        })
        await broadcastGroupSync(updatedRoom, null, { syncRemovals: true })
        updatedGroups.push(gid)
      } catch {}
    }

    const removedGroups = []
    for (const gid of peerOwnedGroupIds) {
      const grpRoom = store.getRoom(gid)
      if (grpRoom && !grpRoom.unpaired && (grpRoom.members || []).some((m) => m.slug !== self.slug && m.slug !== cleanSlug)) {
        await deliverToRoomMembers(grpRoom, {
          path: '/mesh/group-leave',
          payload: { roomId: gid, slug: self.slug },
          targetSlugs: (grpRoom.members || []).filter((m) => m.slug !== cleanSlug && m.slug !== self.slug).map((m) => m.slug),
          timeoutMs: Math.min(requestTimeoutMs, 4000),
        }).catch(() => {})
      }
      if (store.removeRoom(gid)) {
        removedGroups.push(gid)
      }
    }

    clearPeerRuntimeState({ slug: cleanSlug, roomIds: [pRoomId, ...peerOwnedGroupIds] })
    notifyCatalogChanged()

    return {
      ok: true,
      slug: cleanSlug,
      remoteNotified,
      remoteError,
      updatedGroups,
      removedGroups,
      state: getStateSnapshot(),
    }
  }

  async function handleRemoteUnpair(fromSlug) {
    const cleanFrom = sanitizeSlug(fromSlug)
    const self = store.getSelf()
    const info = store.handleRemoteUnpair(cleanFrom)

    if (info.pairRoomId) {
      const peerLabel = info.prevPeer?.ownerName && info.prevPeer.ownerName !== cleanFrom
        ? `${info.prevPeer.ownerName} (@${cleanFrom})`
        : `@${cleanFrom}`
      store.recordMessage({
        roomId: info.pairRoomId,
        sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
        kind: 'system',
        text: `${peerLabel} unpaired from this sandbox.`,
      })
    }

    for (const gid of info.ownedGroupIds || []) {
      try {
        const updatedRoom = store.removeGroupMember(gid, cleanFrom)
        store.recordMessage({
          roomId: gid,
          threadId: updatedRoom.activeThreadId || '',
          sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
          kind: 'system',
          text: `@${cleanFrom} unpaired and was removed from the group (group key rotated).`,
        })
        await broadcastGroupSync(updatedRoom, null, { syncRemovals: true })
      } catch {}
    }

    for (const gid of info.peerOwnedGroupIds || []) {
      if (store.markRoomUnpaired(gid, { bySlug: cleanFrom })) {
        store.recordMessage({
          roomId: gid,
          sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
          kind: 'system',
          text: `Group creator @${cleanFrom} unpaired; this group is disconnected.`,
        })
      }
    }

    clearPeerRuntimeState({
      slug: cleanFrom,
      roomIds: [info.pairRoomId, ...(info.peerOwnedGroupIds || [])].filter(Boolean),
    })
    notifyCatalogChanged()
    return {
      pairRoomId: info.pairRoomId,
      updatedGroups: info.ownedGroupIds,
      disconnectedGroups: info.peerOwnedGroupIds,
    }
  }

  async function pingPeer({ slug, headers = null } = {}) {
    store.updateSelf(headers)
    const cleanSlug = sanitizeSlug(slug)
    const peer = store.getPeer(cleanSlug)
    if (!peer) {
      return { ok: false, status: 404, error: `Sandbox "${cleanSlug || slug}" is not paired` }
    }
    const startedAt = Date.now()
    const res = await postToPeer({
      targetSlug: cleanSlug,
      endpointUrl: peer.endpointUrl,
      path: '/mesh/ping',
      payload: {},
      secret: peer.sharedSecret,
      timeoutMs: Math.min(requestTimeoutMs, 5000),
    }).catch((err) => ({ ok: false, status: 502, error: err?.message || String(err) }))
    const latencyMs = Math.max(0, Date.now() - startedAt)

    if (res.ok) {
      store.touchPeer(cleanSlug, { status: 'online', peerProfile: res.data?.peer || null, latencyMs })
      return {
        ok: true,
        slug: cleanSlug,
        reachable: true,
        status: 'online',
        latencyMs,
        state: getStateSnapshot(),
      }
    }
    const isAuthRejected = res.status === 401 || res.status === 403
    const nextStatus = isAuthRejected ? 'unpaired-by-peer' : 'offline'
    store.setPeerStatus(cleanSlug, nextStatus)
    return {
      ok: true,
      slug: cleanSlug,
      reachable: false,
      status: nextStatus,
      latencyMs,
      error: res.error || '',
      state: getStateSnapshot(),
    }
  }

  async function leaveGroup({ roomId, headers = null } = {}) {
    store.updateSelf(headers)
    const self = store.getSelf()
    const room = store.getRoom(roomId)
    if (!room || room.type !== 'group') {
      return { ok: false, status: 404, error: `Group room "${roomId}" not found` }
    }
    if (!room.unpaired && (room.members || []).some((m) => m.slug !== self.slug)) {
      await deliverToRoomMembers(room, {
        path: '/mesh/group-leave',
        payload: { roomId: room.id, slug: self.slug },
        timeoutMs: Math.min(requestTimeoutMs, 4000),
      }).catch(() => {})
    }
    store.leaveGroupRoom(room.id, self.slug)
    clearPeerRuntimeState({ roomIds: [room.id] })
    notifyCatalogChanged()
    return { ok: true, roomId: room.id, state: getStateSnapshot() }
  }

  async function handleRemoteGroupLeave({ roomId, fromSlug }) {
    const room = store.getRoom(roomId)
    if (!room || room.type !== 'group') {
      return { ok: false, status: 404, error: `Group room "${roomId}" not found` }
    }
    const self = store.getSelf()
    const cleanFrom = sanitizeSlug(fromSlug)
    if (cleanFrom && cleanFrom === room.createdBy) {
      store.markRoomUnpaired(roomId, { bySlug: cleanFrom })
      store.recordMessage({
        roomId,
        sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
        kind: 'system',
        text: `Group creator @${cleanFrom} dissolved/left the group; this group is disconnected.`,
      })
    } else if (self.slug === room.createdBy) {
      try {
        const updatedRoom = store.removeGroupMember(roomId, cleanFrom)
        store.recordMessage({
          roomId,
          threadId: updatedRoom.activeThreadId || '',
          sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
          kind: 'system',
          text: `@${cleanFrom} left the group (group key rotated).`,
        })
        await broadcastGroupSync(updatedRoom, null, { syncRemovals: true })
      } catch (err) {
        return { ok: false, status: 400, error: err?.message || String(err) }
      }
    } else {
      store.leaveGroupRoom(roomId, cleanFrom)
      store.recordMessage({
        roomId,
        threadId: room.activeThreadId || '',
        sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
        kind: 'system',
        text: `@${cleanFrom} left the group.`,
      })
    }
    activityMap.delete(`${roomId}:${cleanFrom}`)
    peerStatusSeqMap.delete(`${roomId}:${cleanFrom}`)
    activityVersion += 1
    notifyCatalogChanged()
    return { ok: true, roomId }
  }

  async function removeRoom({ roomId, headers = null } = {}) {
    store.updateSelf(headers)
    const cleanId = String(roomId || '').trim()
    const room = store.getRoom(cleanId)
    if (!room) {
      return { ok: true, alreadyRemoved: true, roomId: cleanId, state: getStateSnapshot() }
    }
    if (room.type === 'pair') {
      if (!room.unpaired && room.peerSlug && store.getPeer(room.peerSlug)) {
        return unpairPeer({ slug: room.peerSlug, headers })
      }
      store.removeRoom(cleanId)
      clearPeerRuntimeState({ slug: room.peerSlug || '', roomIds: [cleanId] })
      notifyCatalogChanged()
      return { ok: true, roomId: cleanId, state: getStateSnapshot() }
    }
    if (!room.unpaired && (room.members || []).length > 1) {
      return leaveGroup({ roomId: cleanId, headers })
    }
    store.removeRoom(cleanId)
    clearPeerRuntimeState({ roomIds: [cleanId] })
    notifyCatalogChanged()
    return { ok: true, roomId: cleanId, state: getStateSnapshot() }
  }

  async function removeFromGroup({ roomId, slug, headers = null }) {
    store.updateSelf(headers)
    const self = store.getSelf()
    const cleanTarget = sanitizeSlug(slug)
    let room
    try {
      room = store.removeGroupMember(roomId, cleanTarget)
    } catch (err) {
      return { ok: false, status: 400, error: err?.message || String(err) }
    }
    store.recordMessage({
      roomId: room.id,
      threadId: room.activeThreadId || '',
      sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
      kind: 'system',
      text: `Removed @${cleanTarget} from group (group key rotated).`,
    })
    const syncResult = await broadcastGroupSync(room, null, { syncRemovals: true })
    notifyCatalogChanged()
    return { ok: true, room, sync: syncResult, state: getStateSnapshot() }
  }

  async function sendMessage({
    roomId,
    text,
    files = [],
    kind = 'chat',
    taskId = '',
    actor = 'human',
    hop = 0,
    threadId = '',
    phase = '',
    newTopic = false,
    mentionsOverride = null,
    headers = null,
  }) {
    store.updateSelf(headers)
    const self = store.getSelf()
    const room = store.getRoom(roomId)
    if (!room) {
      return { ok: false, status: 404, error: `Room "${roomId}" does not exist` }
    }
    if (room.unpaired) {
      return { ok: false, status: 409, error: `Room "${roomId}" is unpaired; re-pair before sending messages` }
    }
    const normalizedActor = ['human', 'agent', 'system'].includes(actor) ? actor : 'human'
    const cleanText = String(text ?? '').trim()
    // Only parse `#filepath` inline references from human messages; Agent prose must never
    // trigger implicit file exfiltration via prompt injection.
    const inlineFileRefs = normalizedActor === 'human' ? extractFileReferences(cleanText) : []
    const allFileRefs = [...new Set([
      ...(Array.isArray(files) ? files.map((f) => String(f || '').trim()).filter(Boolean) : []),
      ...inlineFileRefs,
    ])]

    if (!cleanText && allFileRefs.length === 0) {
      return { ok: false, status: 400, error: 'Message text or #file reference is required' }
    }

    if (allFileRefs.length === 1 && cleanText === `#${allFileRefs[0]}`) {
      return sendFile({
        roomId: room.id,
        threadId,
        filePath: allFileRefs[0],
        text: '',
        actor: normalizedActor,
        headers,
      })
    }

    const rawHop = typeof hop === 'number' && Number.isFinite(hop) ? Math.max(0, Math.trunc(hop)) : 0
    const numericHop = normalizedActor === 'agent'
      ? Math.max(rawHop, getActiveAgentHop(room.id))
      : rawHop
    if (normalizedActor === 'agent' && numericHop > store.maxAgentHops) {
      return {
        ok: false,
        status: 429,
        error: `Agent hop limit (${store.maxAgentHops}) exceeded to prevent infinite loops`,
      }
    }

    const mentions = Array.isArray(mentionsOverride)
      ? mentionsOverride
      : (phase === 'turn' && normalizedActor === 'agent' ? [] : extractMentions(cleanText))
    const hasAgentMention = mentions.some((m) => m === 'agent' || m.endsWith('-agent'))
    const effectiveKind = ['chat', 'task', 'file', 'system', 'approval'].includes(kind)
      ? (kind === 'chat' && hasAgentMention ? 'task' : kind)
      : 'chat'

    const { message, duplicate, wakeInfo } = store.recordMessage({
      roomId: room.id,
      threadId: String(threadId || room.activeThreadId || '').trim(),
      phase,
      sender: {
        slug: self.slug,
        ownerName: self.ownerName,
        ownerEmail: self.ownerEmail,
        actor: normalizedActor,
      },
      kind: effectiveKind,
      taskId: String(taskId || '').trim().slice(0, 96),
      text: cleanText || `Shared ${allFileRefs.map((f) => `#${f}`).join(' ')}`,
      mentions,
      hop: numericHop,
    })
    maybeDispatchAgentWake(room.id, message, duplicate, wakeInfo)

    const { deliveredTo, pendingPeers, authRejectedPeers = [] } = await deliverToRoomMembers(room, {
      path: '/mesh/message',
      payload: {
        message,
        newTopic: Boolean(newTopic),
        roomMeta: buildGroupRoomMeta(room),
      },
      enqueueOnFailure: true,
    })

    const updatedMsg = store.updateMessageDelivery(room.id, message.id, {
      deliveredTo,
      pendingPeers,
    })

    if (room.type === 'pair' && authRejectedPeers.length > 0) {
      return {
        ok: false,
        status: 401,
        error: `Peer @${authRejectedPeers[0]} rejected authentication (may have unpaired or rotated keys)`,
        message: updatedMsg || message,
        delivery: { deliveredTo, pendingPeers, authRejectedPeers },
        state: getStateSnapshot(),
      }
    }

    for (const refPath of allFileRefs) {
      const resolved = resolveShareableFile(refPath, normalizedActor)
      if (resolved.ok) {
        await sendFile({
          roomId: room.id,
          threadId: message.threadId,
          filePath: resolved.path,
          text: `#${refPath}`,
          actor: normalizedActor,
        })
      }
    }

    if (normalizedActor === 'agent' && room.type !== 'system') {
      void emitControlPlaneEvent('message.agent', {
        roomId: room.id,
        threadId: message.threadId || '',
        messageId: message.id,
        taskId: message.taskId || '',
        kind: message.kind || 'chat',
      })
    }

    return {
      ok: true,
      message: updatedMsg || message,
      delivery: { deliveredTo, pendingPeers },
      state: getStateSnapshot(),
    }
  }

  async function startNewTopic({ roomId, headers = null }) {
    store.updateSelf(headers)
    const room = store.getRoom(roomId)
    if (!room) {
      return { ok: false, status: 404, error: `Room "${roomId}" does not exist` }
    }
    if (room.unpaired) {
      return { ok: false, status: 409, error: `Room "${roomId}" is unpaired; re-pair before sending messages` }
    }
    const msgs = store.getSnapshot().messages?.[room.id] || []
    if (!canStartNewTopic(room, msgs)) {
      return {
        ok: true,
        alreadyFresh: true,
        roomId: room.id,
        threadId: room.activeThreadId || '',
        state: getStateSnapshot(),
      }
    }
    let rotated
    try {
      rotated = store.rotateRoomThread(roomId)
    } catch (err) {
      return { ok: false, status: 400, error: err?.message || String(err) }
    }
    const sendRes = await sendMessage({
      roomId: rotated.room.id,
      threadId: rotated.threadId,
      newTopic: true,
      text: '─── Started a new conversation topic (fresh Agent context isolated) ───',
      kind: 'system',
      actor: 'system',
      headers,
    })
    return {
      ok: Boolean(sendRes.ok),
      alreadyFresh: false,
      roomId: rotated.room.id,
      threadId: rotated.threadId,
      state: getStateSnapshot(),
      error: sendRes.error || '',
    }
  }

  async function sendFile({
    roomId,
    threadId = '',
    filePath,
    text = '',
    actor = 'human',
    headers = null,
  }) {
    store.updateSelf(headers)
    const self = store.getSelf()
    const room = store.getRoom(roomId)
    if (!room) {
      return { ok: false, status: 404, error: `Room "${roomId}" does not exist` }
    }
    if (room.unpaired) {
      return { ok: false, status: 409, error: `Room "${roomId}" is unpaired; re-pair before sending messages` }
    }
    const resolved = resolveShareableFile(filePath, actor)
    if (!resolved.ok) {
      return resolved
    }
    let fileStat
    try {
      fileStat = await stat(resolved.path)
    } catch {
      return { ok: false, status: 404, error: `File not found: ${filePath}` }
    }
    if (!fileStat.isFile()) {
      return { ok: false, status: 400, error: `Not a regular file: ${filePath}` }
    }
    if (fileStat.size > maxFileBytes) {
      return { ok: false, status: 413, error: `File exceeds ${maxFileBytes} byte limit` }
    }

    const rawBytes = await readFile(resolved.path)
    const fileName = safeFileName(basename(resolved.path))
    const sha256 = sha256Hex(rawBytes)
    const contentBase64 = rawBytes.toString('base64')

    const { message } = store.recordMessage({
      roomId: room.id,
      threadId: String(threadId || room.activeThreadId || '').trim(),
      sender: {
        slug: self.slug,
        ownerName: self.ownerName,
        ownerEmail: self.ownerEmail,
        actor: actor === 'agent' ? 'agent' : 'human',
      },
      kind: 'file',
      text: String(text || `#${fileName}`).trim(),
      attachment: {
        name: fileName,
        size: fileStat.size,
        sha256,
        sourcePath: resolved.path,
      },
    })

    // Omit local `sourcePath` from the wire payload so host filesystem paths stay private.
    const wireMessage = {
      ...message,
      attachment: {
        name: fileName,
        size: fileStat.size,
        sha256,
      },
    }

    const { deliveredTo, pendingPeers } = await deliverToRoomMembers(room, {
      path: '/mesh/file-offer',
      payload: {
        message: wireMessage,
        fileName,
        contentBase64,
        sha256,
        roomMeta: buildGroupRoomMeta(room),
      },
      timeoutMs: fileTimeoutMs,
    })

    const updatedMsg = store.updateMessageDelivery(room.id, message.id, {
      deliveredTo,
      pendingPeers,
    })

    return {
      ok: true,
      message: updatedMsg || message,
      delivery: { deliveredTo, pendingPeers },
      state: getStateSnapshot(),
    }
  }

  async function uploadAndSendFile({
    roomId,
    fileName,
    contentBase64,
    text = '',
    threadId = '',
    headers = null,
  }) {
    store.updateSelf(headers)
    const room = store.getRoom(roomId)
    if (!room) {
      return { ok: false, status: 404, error: `Room "${roomId}" does not exist` }
    }
    if (room.unpaired) {
      return { ok: false, status: 409, error: `Room "${roomId}" is unpaired; re-pair before sending messages` }
    }
    const cleanName = safeFileName(fileName || 'upload.bin')
    const rawBase64 = String(contentBase64 || '').replace(/^data:[^;]+;base64,/, '').trim()
    const fileBytes = Buffer.from(rawBase64, 'base64')
    if (fileBytes.byteLength === 0) {
      return { ok: false, status: 400, error: 'Uploaded file is empty' }
    }
    if (fileBytes.byteLength > maxFileBytes) {
      return { ok: false, status: 413, error: `File exceeds ${maxFileBytes} byte limit` }
    }

    const uploadDir = join(inboxDir, 'uploads')
    await mkdir(uploadDir, { recursive: true })
    let savedPath = join(uploadDir, cleanName)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = uniqueFilePath(uploadDir, cleanName)
      try {
        await writeFile(candidate, fileBytes, { flag: 'wx' })
        savedPath = candidate
        break
      } catch (err) {
        if (err?.code !== 'EEXIST' || attempt === 4) {
          return { ok: false, status: 500, error: err?.message || 'Failed to save uploaded file' }
        }
      }
    }

    return sendFile({
      roomId: room.id,
      threadId,
      filePath: savedPath,
      text: String(text || '').trim(),
      actor: 'human',
      headers,
    })
  }

  async function readAttachmentFile({ roomId, msgId } = {}) {
    const cleanRoomId = String(roomId || '').trim()
    const cleanMsgId = String(msgId || '').trim()
    const msg = store.getMessage(cleanRoomId, cleanMsgId)
    if (!msg || !msg.attachment) {
      return { ok: false, status: 404, error: 'Attachment not found in room history' }
    }
    const candidatePath = msg.attachment.savedPath || msg.attachment.sourcePath || ''
    if (!candidatePath) {
      return { ok: false, status: 404, error: 'Attachment file path is unavailable locally' }
    }
    const resolved = resolveShareableFile(candidatePath, 'human')
    if (!resolved.ok) {
      return resolved
    }
    let fileStat
    try {
      fileStat = await stat(resolved.path)
    } catch {
      return { ok: false, status: 404, error: 'Attachment file no longer exists on disk' }
    }
    if (!fileStat.isFile()) {
      return { ok: false, status: 400, error: 'Attachment target is not a regular file' }
    }
    if (fileStat.size > maxFileBytes) {
      return { ok: false, status: 413, error: 'Attachment exceeds preview/download size cap' }
    }
    const bytes = await readFile(resolved.path)
    const displayName = safeFileName(msg.attachment.name || basename(resolved.path))
    const info = classifyAttachmentFile(displayName)
    return {
      ok: true,
      name: displayName,
      size: bytes.byteLength,
      bytes,
      ...info,
    }
  }

  async function broadcastTaskSync(room, tasks = []) {
    if (!room || !Array.isArray(tasks) || tasks.length === 0) {
      return { deliveredTo: [], pendingPeers: [] }
    }
    return deliverToRoomMembers(room, {
      path: '/mesh/task-sync',
      payload: {
        roomId: room.id,
        tasks,
        roomMeta: buildGroupRoomMeta(room),
      },
      enqueueOnFailure: true,
    })
  }

  async function createTasks({
    roomId,
    threadId = '',
    tasks = [],
    actor = 'human',
    notifyAssignees = true,
    headers = null,
  } = {}) {
    store.updateSelf(headers)
    const self = store.getSelf()
    const cleanRoomId = String(roomId || '').trim()
    const room = store.getRoom(cleanRoomId)
    if (!room) {
      return { ok: false, status: 404, error: `Room "${cleanRoomId}" does not exist` }
    }
    if (room.unpaired) {
      return { ok: false, status: 409, error: `Room "${cleanRoomId}" is unpaired` }
    }
    const rawList = Array.isArray(tasks) ? tasks.filter((t) => t && typeof t === 'object') : []
    if (rawList.length === 0) {
      return { ok: false, status: 400, error: 'At least one task is required' }
    }
    const effectiveThreadId = String(threadId || room.activeThreadId || '').trim()
    const memberSet = new Set((room.members || []).map((m) => sanitizeSlug(m.slug)).filter(Boolean))
    memberSet.add(self.slug)

    const created = []
    const superseded = []
    const supersededIds = new Set()
    const createdIds = new Set()
    try {
      for (const raw of rawList) {
        const assignee = sanitizeSlug(raw.assigneeSlug || '')
        if (assignee && !memberSet.has(assignee)) {
          return {
            ok: false,
            status: 400,
            error: `Assignee "@${assignee}" is not a member of room "${room.name}"`,
          }
        }
        const resolvedDeps = []
        if (Array.isArray(raw.dependsOn)) {
          for (const dep of raw.dependsOn) {
            if (typeof dep === 'number' && Number.isInteger(dep) && dep >= 0 && dep < created.length) {
              resolvedDeps.push(created[dep].id)
            } else if (typeof dep === 'string' && dep.trim()) {
              resolvedDeps.push(dep.trim())
            }
          }
        }
        if (Array.isArray(raw.dependsOnIndices)) {
          for (const idx of raw.dependsOnIndices) {
            if (Number.isInteger(idx) && idx >= 0 && idx < created.length) {
              resolvedDeps.push(created[idx].id)
            }
          }
        }
        const task = store.createTask(cleanRoomId, {
          ...raw,
          threadId: effectiveThreadId,
          assigneeSlug: assignee,
          createdBy: self.slug,
          dependsOn: resolvedDeps,
        })
        created.push(task)
        createdIds.add(task.id)

        const explicitReplaceIds = [
          ...(typeof raw.replacesTaskId === 'string' && raw.replacesTaskId.trim() ? [raw.replacesTaskId.trim()] : []),
          ...(Array.isArray(raw.supersedesTaskIds) ? raw.supersedesTaskIds : []),
        ]
        const toSupersede = findSupersededBlockedTasks(store.listRoomTasks(cleanRoomId), task, {
          explicitIds: explicitReplaceIds,
        })
        for (const oldTask of toSupersede) {
          if (createdIds.has(oldTask.id) || supersededIds.has(oldTask.id)) continue
          const closed = store.updateTask(
            cleanRoomId,
            oldTask.id,
            {
              status: 'cancelled',
              summary: `Superseded by follow-up task [${task.id}]: ${task.title}`,
            },
            { allowApprovalDecision: false },
          )
          superseded.push(closed)
          supersededIds.add(oldTask.id)
        }
      }
    } catch (err) {
      return { ok: false, status: 400, error: err?.message || String(err) }
    }

    const sync = await broadcastTaskSync(room, [...created, ...superseded])
    const allTasks = store.listRoomTasks(cleanRoomId)
    const dispatchedTasks = []
    const blockedByDependencies = []
    const waitingForApproval = []

    const dispatchPromises = []
    for (const task of created) {
      if (task.approvalRequired && task.approvalStatus === 'pending') {
        waitingForApproval.push(task)
        dispatchPromises.push(
          sendMessage({
            roomId: cleanRoomId,
            threadId: effectiveThreadId,
            kind: 'approval',
            taskId: task.id,
            actor: actor === 'agent' ? 'agent' : 'human',
            hop: actor === 'agent' ? 1 : 0,
            mentionsOverride: [],
            text: task.approvalPrompt || task.title,
          }),
        )
        continue
      }
      if (!areTaskDependenciesMet(task, allTasks)) {
        blockedByDependencies.push(task)
        continue
      }
      if (notifyAssignees && task.assigneeSlug && task.status === 'todo') {
        dispatchedTasks.push(task)
        const descLine = task.description ? `\n\n${task.description}` : ''
        const dispatchText = `@${task.assigneeSlug} **[Task \`${task.id}\`] ${task.title}**${descLine}\n\n_(Please update progress via \`mesh_task_update\` with \`taskId="${task.id}"\` as you work, and mark \`status="done"\` or \`"in_review"\` with \`artifacts\` when finished.)_`
        dispatchPromises.push(
          sendMessage({
            roomId: cleanRoomId,
            threadId: effectiveThreadId,
            phase: 'turn',
            kind: 'task',
            taskId: task.id,
            actor: actor === 'agent' ? 'agent' : 'human',
            hop: actor === 'agent' ? 1 : 0,
            mentionsOverride: [task.assigneeSlug],
            text: dispatchText,
          }),
        )
      }
    }

    if (dispatchPromises.length > 0) {
      await Promise.all(dispatchPromises)
    }

    return {
      ok: true,
      roomId: cleanRoomId,
      threadId: effectiveThreadId,
      tasks: created,
      supersededTasks: superseded,
      dispatchedTasks,
      blockedByDependencies,
      waitingForApproval,
      sync,
      state: getStateSnapshot(),
    }
  }

  function computeUnblockedDependents(roomId, task, prevStatus) {
    if (!task || task.status !== 'done' || prevStatus === 'done') return []
    const allRoomTasks = store.listRoomTasks(roomId)
    return allRoomTasks.filter(
      (t) =>
        t.id !== task.id
        && t.status === 'todo'
        && !(t.approvalRequired && t.approvalStatus === 'pending')
        && Array.isArray(t.dependsOn)
        && t.dependsOn.includes(task.id)
        && areTaskDependenciesMet(t, allRoomTasks),
    )
  }

  async function dispatchTaskHandoff({
    roomId,
    taskId,
    initialPrevStatus,
    notifyModerator = true,
    actor = 'agent',
  }) {
    const self = store.getSelf()
    const cleanRoomId = String(roomId || '').trim()
    const room = store.getRoom(cleanRoomId)
    const latest = room && !room.unpaired ? store.getTask(cleanRoomId, taskId) : null
    if (!room || !latest) {
      return { notifiedModerator: false, autoDispatchedIds: [], unblockedDependents: [] }
    }

    const transitionedToTerminal = latest.status !== initialPrevStatus
      && ['done', 'in_review', 'blocked'].includes(latest.status)
    const unblockedDependents = computeUnblockedDependents(cleanRoomId, latest, initialPrevStatus)
    const dispatchable = unblockedDependents.filter(
      (d) => d.assigneeSlug && (!d.approvalRequired || d.approvalStatus === 'approved'),
    )
    const autoDispatchedIds = dispatchable.map((d) => d.id)

    // 1. ALWAYS notify group Moderator with [Task · DONE / READY FOR REVIEW / BLOCKED] FIRST,
    //    so chat history preserves strict causal order (files -> DONE -> UNBLOCKED).
    let notifiedModerator = false
    const shouldNotifyMod = (
      actor === 'agent'
      && notifyModerator !== false
      && transitionedToTerminal
    )
    if (shouldNotifyMod) {
      const modSlug = room.type === 'group' ? sanitizeSlug(room.moderatorSlug || room.createdBy || '') : ''
      const targetMention = modSlug && modSlug !== self.slug ? [modSlug] : []
      if (targetMention.length > 0) {
        const artifactLine = latest.artifacts?.length
          ? `\nArtifacts: ${latest.artifacts.map((a) => `\`${a}\``).join(', ')}`
          : ''
        const unlockLine = unblockedDependents.length > 0
          ? `\nUnblocked downstream tasks (${autoDispatchedIds.length > 0 ? 'auto-dispatched to assignees' : 'ready to dispatch'}): ${unblockedDependents.map((d) => `\`${d.id}\` (${d.title}${d.assigneeSlug ? ` -> @${d.assigneeSlug}` : ''})`).join(', ')}`
          : ''
        const statusLabel = latest.status === 'done'
          ? 'DONE'
          : latest.status === 'in_review'
            ? 'READY FOR REVIEW'
            : 'BLOCKED'
        await sendMessage({
          roomId: cleanRoomId,
          threadId: latest.threadId || room.activeThreadId || '',
          phase: 'turn',
          kind: 'task',
          taskId: latest.id,
          actor: 'agent',
          hop: 1,
          mentionsOverride: targetMention,
          text: `**[Task \`${latest.id}\` · ${statusLabel}]** ${latest.title}\n${latest.summary || '(no summary)'}${artifactLine}${unlockLine}`,
        })
        notifiedModerator = true
      }
    }

    // 2. THEN automatically wake newly unblocked downstream DAG tasks in parallel.
    if (dispatchable.length > 0) {
      await Promise.all(
        dispatchable.map(async (d) => {
          const descBlock = d.description ? `\n\n${d.description}` : ''
          await sendMessage({
            roomId: cleanRoomId,
            threadId: d.threadId || latest.threadId || room.activeThreadId || '',
            phase: 'turn',
            kind: 'task',
            taskId: d.id,
            actor: 'agent',
            hop: 1,
            mentionsOverride: [d.assigneeSlug],
            text: `@${d.assigneeSlug} **[Task \`${d.id}\` · UNBLOCKED]** ${d.title}\nUpstream dependency \`${latest.id}\` (${latest.title}) is now DONE — please begin executing this task now.${descBlock}`,
          })
        }),
      )
    }

    return { notifiedModerator, autoDispatchedIds, unblockedDependents }
  }

  async function updateTask({
    roomId,
    taskId,
    title,
    description,
    assigneeSlug,
    status,
    priority,
    summary,
    artifacts,
    shareFiles = [],
    mergeArtifacts = true,
    dependsOn,
    approvalRequired,
    approvalPrompt,
    approvalStatus,
    notifyModerator = true,
    actor = 'human',
    headers = null,
  } = {}) {
    store.updateSelf(headers)
    const self = store.getSelf()
    const cleanRoomId = String(roomId || '').trim()
    const room = store.getRoom(cleanRoomId)
    if (!room) {
      return { ok: false, status: 404, error: `Room "${cleanRoomId}" does not exist` }
    }
    if (room.unpaired) {
      return { ok: false, status: 409, error: `Room "${cleanRoomId}" is unpaired` }
    }
    const prevTask = store.getTask(cleanRoomId, taskId)
    if (!prevTask) {
      return { ok: false, status: 404, error: `Task "${taskId}" not found` }
    }
    if (assigneeSlug !== undefined) {
      const cleanAssignee = sanitizeSlug(assigneeSlug || '')
      const memberSet = new Set((room.members || []).map((m) => sanitizeSlug(m.slug)).filter(Boolean))
      memberSet.add(self.slug)
      if (cleanAssignee && !memberSet.has(cleanAssignee)) {
        return { ok: false, status: 400, error: `Assignee "@${cleanAssignee}" is not a member of this room` }
      }
    }

    // Atomic file delivery: validate and share all requested `shareFiles` BEFORE committing
    // the task status update, so downstream peers never wake before deliverables exist.
    const cleanShareFiles = Array.isArray(shareFiles)
      ? shareFiles.map((f) => String(f || '').trim()).filter(Boolean)
      : []
    const sharedFileResults = []
    if (cleanShareFiles.length > 0) {
      const validatedPaths = []
      for (const fp of cleanShareFiles) {
        const resolved = resolveShareableFile(fp, actor === 'agent' ? 'agent' : 'human')
        if (!resolved.ok) {
          return {
            ok: false,
            status: resolved.status || 400,
            error: `Cannot share file "${fp}" before updating task: ${resolved.error}`,
          }
        }
        validatedPaths.push({ raw: fp, resolvedPath: resolved.path })
      }
      for (const item of validatedPaths) {
        const fileRes = await sendFile({
          roomId: cleanRoomId,
          threadId: prevTask.threadId || room.activeThreadId || '',
          filePath: item.resolvedPath,
          text: `Deliverable for task \`${prevTask.id}\` (${prevTask.title}): ${item.raw}`,
          actor: actor === 'agent' ? 'agent' : 'human',
          headers,
        })
        if (!fileRes.ok) {
          return {
            ok: false,
            status: fileRes.status || 400,
            error: `Failed to share file "${item.raw}" before updating task: ${fileRes.error || 'send failed'}`,
          }
        }
        sharedFileResults.push(item.raw)
      }
    }

    const combinedArtifacts = (() => {
      if (artifacts === undefined && sharedFileResults.length === 0) return undefined
      const base = Array.isArray(artifacts) ? artifacts.map((a) => String(a || '').trim()).filter(Boolean) : []
      for (const sf of sharedFileResults) {
        if (!base.includes(sf)) base.push(sf)
      }
      return base
    })()

    const prevStatus = prevTask.status
    let updated
    try {
      updated = store.updateTask(
        cleanRoomId,
        taskId,
        {
          title,
          description,
          assigneeSlug,
          status,
          priority,
          summary,
          artifacts: combinedArtifacts,
          mergeArtifacts,
          dependsOn,
          approvalRequired,
          approvalPrompt,
          approvalStatus,
        },
        { allowApprovalDecision: actor === 'human' },
      )
    } catch (err) {
      const msg = err?.message || String(err)
      return {
        ok: false,
        status: /Only human approval/i.test(msg) ? 403 : 400,
        error: msg,
      }
    }

    const autoReleasedBlockedTasks = []
    if (updated.status === 'done' && prevStatus !== 'done') {
      const touchedIds = new Set([updated.id])
      const allRoomTasks = store.listRoomTasks(cleanRoomId)

      // 1. Auto-close older superseded blocked tasks for the same assignee/title in this room/thread
      for (const oldTask of findSupersededBlockedTasks(allRoomTasks, updated)) {
        if (touchedIds.has(oldTask.id)) continue
        const closed = store.updateTask(
          cleanRoomId,
          oldTask.id,
          {
            status: 'cancelled',
            summary: `Auto-resolved by completed task [${updated.id}]: ${updated.title}`,
          },
          { allowApprovalDecision: false },
        )
        autoReleasedBlockedTasks.push(closed)
        touchedIds.add(oldTask.id)
      }

      // 2. Auto-unblock downstream DAG tasks that were blocked waiting on this completed dependency
      const latestRoomTasks = store.listRoomTasks(cleanRoomId)
      for (const depTask of latestRoomTasks) {
        if (
          touchedIds.has(depTask.id)
          || depTask.status !== 'blocked'
          || (depTask.approvalRequired && depTask.approvalStatus === 'pending')
          || !Array.isArray(depTask.dependsOn)
          || !depTask.dependsOn.includes(updated.id)
          || !areTaskDependenciesMet(depTask, latestRoomTasks)
        ) {
          continue
        }
        const reopened = store.updateTask(
          cleanRoomId,
          depTask.id,
          {
            status: 'todo',
            summary: `Unblocked after upstream task [${updated.id}] (${updated.title}) completed`,
          },
          { allowApprovalDecision: false },
        )
        autoReleasedBlockedTasks.push(reopened)
        touchedIds.add(depTask.id)
      }
    }

    const sync = await broadcastTaskSync(room, [updated, ...autoReleasedBlockedTasks])

    const activeTurn = actor === 'agent' ? findActiveAgentTurn(cleanRoomId) : null
    const isHandoffCandidate = (
      updated.status !== prevStatus
      && ['done', 'in_review', 'blocked'].includes(updated.status)
    )
    const alreadyQueued = activeTurn ? activeTurn.deferredTaskHandoffs.get(updated.id) : null
    let unblockedDependents = computeUnblockedDependents(
      cleanRoomId,
      updated,
      alreadyQueued ? alreadyQueued.initialPrevStatus : prevStatus,
    )
    let handoffDeferred = false

    if (activeTurn && (isHandoffCandidate || alreadyQueued)) {
      // Defer Moderator wake & downstream DAG dispatch until the Agent's current turn finishes,
      // guaranteeing late file uploads or revisions in the same turn always land BEFORE handoff.
      if (!alreadyQueued) {
        activeTurn.deferredTaskHandoffs.set(updated.id, {
          roomId: cleanRoomId,
          taskId: updated.id,
          initialPrevStatus: prevStatus,
          notifyModerator: notifyModerator !== false,
          actor: 'agent',
        })
      } else if (notifyModerator === false) {
        alreadyQueued.notifyModerator = false
      }
      handoffDeferred = true
    } else if (isHandoffCandidate) {
      const handoff = await dispatchTaskHandoff({
        roomId: cleanRoomId,
        taskId: updated.id,
        initialPrevStatus: prevStatus,
        notifyModerator,
        actor,
      })
      unblockedDependents = handoff.unblockedDependents
    }

    if (isHandoffCandidate && !handoffDeferred) {
      void emitControlPlaneEvent('task.updated', {
        roomId: cleanRoomId,
        taskId: updated.id,
        status: updated.status,
        summary: updated.summary || '',
      })
    }

    return {
      ok: true,
      task: updated,
      autoReleasedBlockedTasks,
      unblockedDependents,
      sharedFiles: sharedFileResults,
      handoffDeferred,
      sync,
      state: getStateSnapshot(),
    }
  }

  async function requestApproval({
    roomId,
    threadId = '',
    taskId = '',
    title = '',
    prompt = '',
    assigneeSlug = '',
    actor = 'agent',
    headers = null,
  } = {}) {
    store.updateSelf(headers)
    const self = store.getSelf()
    const cleanRoomId = String(roomId || '').trim()
    const room = store.getRoom(cleanRoomId)
    if (!room) {
      return { ok: false, status: 404, error: `Room "${cleanRoomId}" does not exist` }
    }
    if (room.unpaired) {
      return { ok: false, status: 409, error: `Room "${cleanRoomId}" is unpaired` }
    }
    const effectiveThreadId = String(threadId || room.activeThreadId || '').trim()
    const cleanPrompt = String(prompt || title || '').trim()
    if (!cleanPrompt) {
      return { ok: false, status: 400, error: 'Approval prompt or title is required' }
    }

    let task
    try {
      if (taskId && store.getTask(cleanRoomId, taskId)) {
        task = store.updateTask(
          cleanRoomId,
          taskId,
          {
            approvalRequired: true,
            approvalStatus: 'pending',
            approvalPrompt: cleanPrompt,
            ...(assigneeSlug ? { assigneeSlug } : {}),
          },
          { allowApprovalDecision: false },
        )
      } else {
        task = store.createTask(cleanRoomId, {
          threadId: effectiveThreadId,
          title: String(title || cleanPrompt).trim().slice(0, 160),
          description: cleanPrompt,
          assigneeSlug: sanitizeSlug(assigneeSlug || room.moderatorSlug || self.slug),
          createdBy: self.slug,
          status: 'in_review',
          priority: 'high',
          approvalRequired: true,
          approvalPrompt: cleanPrompt,
        })
      }
    } catch (err) {
      return { ok: false, status: 400, error: err?.message || String(err) }
    }

    const sync = await broadcastTaskSync(room, [task])
    const msgRes = await sendMessage({
      roomId: cleanRoomId,
      threadId: task.threadId || effectiveThreadId,
      kind: 'approval',
      taskId: task.id,
      actor: actor === 'agent' ? 'agent' : 'human',
      hop: actor === 'agent' ? 1 : 0,
      mentionsOverride: [],
      text: cleanPrompt,
    })

    void emitControlPlaneEvent('approval.requested', {
      roomId: cleanRoomId,
      taskId: task.id,
      status: task.status,
    })

    return {
      ok: true,
      task,
      message: msgRes.message || null,
      sync,
      state: getStateSnapshot(),
    }
  }

  async function decideApproval({
    roomId,
    taskId,
    decision,
    comment = '',
    headers = null,
  } = {}) {
    store.updateSelf(headers)
    const self = store.getSelf()
    const cleanRoomId = String(roomId || '').trim()
    const room = store.getRoom(cleanRoomId)
    if (!room) {
      return { ok: false, status: 404, error: `Room "${cleanRoomId}" does not exist` }
    }
    if (room.unpaired) {
      return { ok: false, status: 409, error: `Room "${cleanRoomId}" is unpaired` }
    }
    const cleanDecision = String(decision || '').trim().toLowerCase()
    if (!['approved', 'rejected'].includes(cleanDecision)) {
      return { ok: false, status: 400, error: 'Decision must be "approved" or "rejected"' }
    }
    const existing = store.getTask(cleanRoomId, taskId)
    if (!existing) {
      return { ok: false, status: 404, error: `Task "${taskId}" not found` }
    }

    const cleanComment = String(comment || '').trim().slice(0, 1000)
    const nextStatus = cleanDecision === 'rejected'
      ? (existing.status === 'done' || existing.status === 'in_review' || existing.status === 'todo' ? 'in_progress' : existing.status)
      : (existing.status === 'blocked' ? 'in_progress' : existing.status)

    const updated = store.updateTask(
      cleanRoomId,
      taskId,
      {
        approvalRequired: true,
        approvalStatus: cleanDecision,
        approvalDecidedBy: self.ownerName || self.slug,
        approvalComment: cleanComment,
        status: nextStatus,
      },
      { allowApprovalDecision: true },
    )
    const sync = await broadcastTaskSync(room, [updated])

    // Wake the task assignee (or group Moderator) automatically so the workflow continues seamlessly
    const wakeTarget = updated.assigneeSlug
      || (room.type === 'group' ? sanitizeSlug(room.moderatorSlug || room.createdBy || '') : '')
    const decisionTag = cleanDecision === 'approved' ? 'APPROVED' : 'REJECTED'
    const commentLine = cleanComment ? `\nComment: ${cleanComment}` : ''
    const wakeText = `${wakeTarget ? `@${wakeTarget} ` : ''}**[Human Approval ${decisionTag}]** Task \`${updated.id}\` (${updated.title})${commentLine}\n${cleanDecision === 'approved' ? 'Approval granted — please proceed with the next steps.' : 'Changes requested — please revise and re-submit.'}`

    const msgRes = await sendMessage({
      roomId: cleanRoomId,
      threadId: updated.threadId || room.activeThreadId || '',
      kind: 'task',
      taskId: updated.id,
      actor: 'human',
      hop: 0,
      mentionsOverride: wakeTarget ? [wakeTarget] : [],
      text: wakeText,
      headers,
    })

    return {
      ok: true,
      task: updated,
      message: msgRes.message || null,
      sync,
      state: getStateSnapshot(),
    }
  }

  async function updateProfile({ ownerName, role, description, instructions, headers = null }) {
    store.updateSelf(headers)
    const updatedSelf = store.updateSelfProfile({ ownerName, role, description, instructions })
    const snap = store.getSnapshot()
    const peers = (snap.peers || [])
      .map((p) => store.getPeer(p.slug))
      .filter((p) => p?.sharedSecret && p?.endpointUrl)
    const results = await Promise.all(
      peers.map(async (peer) => {
        const res = await postToPeer({
          targetSlug: peer.slug,
          endpointUrl: peer.endpointUrl,
          path: '/mesh/profile-sync',
          payload: {
            peerProfile: {
              slug: updatedSelf.slug,
              ownerName: updatedSelf.ownerName,
              ownerEmail: updatedSelf.ownerEmail,
              role: updatedSelf.role || '',
              description: updatedSelf.description || '',
              endpointUrl: updatedSelf.endpointUrl,
            },
          },
          secret: peer.sharedSecret,
        })
        return res.ok ? peer.slug : null
      }),
    )
    const syncedTo = results.filter(Boolean)
    notifyCatalogChanged()
    return { ok: true, self: updatedSelf, syncedTo, state: getStateSnapshot() }
  }

  async function flushOutbox({ force = false } = {}) {
    if (outboxFlushPromise) return outboxFlushPromise
    outboxFlushPromise = (async () => {
      const items = store.listOutbox()
      if (items.length === 0) return { flushed: 0 }
      const nowMs = Date.now()
      const doneIds = []
      const retryUpdates = new Map()

      for (const item of items) {
        if (!force && item.nextRetryAt && item.nextRetryAt > nowMs) continue
        const peer = store.getPeer(item.targetSlug)
        const room = item.groupId ? store.getRoom(item.groupId) : null
        const secret = peer?.sharedSecret || room?.groupSecret || ''
        if (!secret) {
          doneIds.push(item.id)
          continue
        }
        const endpointUrl = peer?.endpointUrl || item.endpointUrl
        const res = await postToPeer({
          targetSlug: item.targetSlug,
          endpointUrl,
          path: item.path,
          payload: item.payload,
          secret,
          groupId: item.groupId || '',
        })
        if (res.ok) {
          doneIds.push(item.id)
          if (peer) store.setPeerStatus(item.targetSlug, 'online')
        } else if (res.status === 401 || res.status === 403) {
          doneIds.push(item.id)
          if (peer && !item.groupId) store.setPeerStatus(item.targetSlug, 'unpaired-by-peer')
        } else {
          const nextAttempts = (Number(item.attempts) || 0) + 1
          const backoffMs = Math.min(5 * 60 * 1000, 2000 * (2 ** Math.min(nextAttempts, 8)))
          retryUpdates.set(item.id, {
            attempts: nextAttempts,
            nextRetryAt: nowMs + backoffMs,
            lastError: res.error || `HTTP ${res.status || 502}`,
          })
        }
      }

      store.updateOutbox(doneIds, retryUpdates, { nowMs })
      return { flushed: doneIds.length }
    })().finally(() => {
      outboxFlushPromise = null
    })
    return outboxFlushPromise
  }

  const handleIncomingMeshHttp = createIncomingMeshHandler({
    store,
    localToken,
    replayGuard,
    pairLimiter,
    maxFileBytes,
    inboxDir,
    peerStatusSeqMap,
    claimPairInvite,
    unpairPeer,
    handleRemoteUnpair,
    pingPeer,
    createGroup,
    inviteToGroup,
    updateGroupModeration,
    removeFromGroup,
    leaveGroup,
    handleRemoteGroupLeave,
    startNewTopic,
    sendMessage,
    sendFile,
    updateTask,
    flushOutbox: () => flushOutbox({ force: true }),
    setAgentActivity,
    clearAgentActivity,
    maybeDispatchAgentWake,
    notifyCatalogChanged,
    getActiveAgentHop,
  })

  function listFiles(query = '', limit = 30) {
    return searchWorkspaceFiles(homeDir, query, limit)
  }

  return {
    store,
    localToken,
    homeDir,
    maxFileBytes,
    agentTurnTimeoutMs,
    getRevision,
    getActiveStatuses,
    getStateSnapshot,
    setAgentActivity,
    clearAgentActivity,
    setAgentWakeHandler,
    setCatalogChangeHandler,
    setHasRuntimeSkillProvider,
    beginAgentTurn,
    getActiveAgentHop,
    hasPendingTurnNotification,
    listFiles,
    updateProfile,
    claimPairInvite,
    unpairPeer,
    handleRemoteUnpair,
    pingPeer,
    createGroup,
    inviteToGroup,
    updateGroupModeration,
    renameGroup,
    removeFromGroup,
    leaveGroup,
    handleRemoteGroupLeave,
    removeRoom,
    startNewTopic,
    sendMessage,
    sendFile,
    uploadAndSendFile,
    readAttachmentFile,
    createTasks,
    updateTask,
    requestApproval,
    decideApproval,
    checkControlPlaneToolPolicy,
    checkControlPlaneToolApprovalStatus,
    flushOutbox,
    handleIncomingMeshHttp,
  }
}

export function startMeshHttpServer(
  service,
  { port = DEFAULT_MESH_PORT, host = '127.0.0.1', logger = null } = {},
) {
  const cap = maxMeshBodyBytes(service.maxFileBytes)
  const server = createServer((req, res) => {
    const chunks = []
    let total = 0
    let tooLarge = false
    req.on('error', (err) => {
      logger?.warn?.(`Mesh HTTP request error: ${err?.message || err}`)
    })
    req.on('data', (chunk) => {
      if (tooLarge) return
      total += chunk.length
      if (total <= cap) {
        chunks.push(chunk)
      } else {
        tooLarge = true
        chunks.length = 0
        if (!res.headersSent) {
          res.writeHead(413, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify({ ok: false, error: 'Request payload exceeds size limit' }))
        }
        req.resume()
      }
    })
    req.on('end', () => {
      if (tooLarge) return
      const rawBody = Buffer.concat(chunks).toString('utf8')
      const remoteAddress = req.socket?.remoteAddress || ''
      void service
        .handleIncomingMeshHttp(req.method || 'GET', req.url || '/', req.headers || {}, rawBody, { remoteAddress })
        .then((result) => {
          if (res.writableEnded) return
          res.writeHead(result.status || 200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify(result.body))
        })
        .catch((err) => {
          if (res.writableEnded) return
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: err?.message || 'Internal mesh error' }))
        })
    })
  })

  return new Promise((resolveServer) => {
    server.on('error', (err) => {
      logger?.warn?.(`Mesh HTTP listener failed on ${host}:${port}: ${err?.message || err}`)
      resolveServer({ server: null, port: Number(port) || DEFAULT_MESH_PORT, error: err, close: () => {} })
    })
    server.listen(port, host, () => {
      const addr = server.address()
      const boundPort = typeof addr === 'object' && addr ? addr.port : Number(port) || DEFAULT_MESH_PORT
      service.store.updateSelf(null, boundPort)
      resolveServer({
        server,
        port: boundPort,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

export function apply(ctx, config = {}) {
  const logger = ctx.logger?.('sandbox-mesh') || null
  const service = createMeshService({ config, logger })
  const desiredPort = config.port !== undefined ? Number(config.port) : DEFAULT_MESH_PORT

  wireHarnessRuntime(ctx, service, { logger })

  let disposed = false
  let serverHandle = null
  if (config.disableServer !== true) {
    void startMeshHttpServer(service, { port: desiredPort, logger }).then((handle) => {
      if (disposed) {
        void handle.close?.()
        return
      }
      serverHandle = handle
      installAgentBridge({
        config,
        localToken: service.localToken,
        meshPort: handle.port,
        snapshot: service.store.getSnapshot(),
      })
    })
  } else {
    installAgentBridge({
      config,
      localToken: service.localToken,
      meshPort: desiredPort || DEFAULT_MESH_PORT,
      snapshot: service.store.getSnapshot(),
    })
  }

  const outboxTimer = setInterval(() => {
    if (service.store.listOutbox().length > 0) {
      void service.flushOutbox()
    }
  }, 15 * 1000)
  outboxTimer.unref?.()

  ctx.effect(() => () => {
    disposed = true
    clearInterval(outboxTimer)
    void serverHandle?.close?.()
    serverHandle = null
  }, 'sandbox-mesh: p2p http listener')

  registerBrowserRoutes(ctx, service)
}
