import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeSlug } from '../shared/protocol.js'
import {
  constantTimeEqualString,
  createRateLimiter,
  sha256Hex,
  verifySignedRequest,
} from './crypto.js'
import { safeFileName, uniqueFilePath } from './files.js'

export const STATE_ENDPOINT = '/api/sandbox-mesh.state'
export const PROFILE_ENDPOINT = '/api/sandbox-mesh.profile'
export const FILES_ENDPOINT = '/api/sandbox-mesh.files'
export const PAIR_CODE_ENDPOINT = '/api/sandbox-mesh.pair-code'
export const PAIR_CLAIM_ENDPOINT = '/api/sandbox-mesh.pair-claim'
export const GROUP_CREATE_ENDPOINT = '/api/sandbox-mesh.group-create'
export const GROUP_INVITE_ENDPOINT = '/api/sandbox-mesh.group-invite'
export const GROUP_MODERATE_ENDPOINT = '/api/sandbox-mesh.group-moderate'
export const GROUP_REMOVE_ENDPOINT = '/api/sandbox-mesh.group-remove'
export const NEW_TOPIC_ENDPOINT = '/api/sandbox-mesh.new-topic'
export const SEND_ENDPOINT = '/api/sandbox-mesh.send'
export const SEND_FILE_ENDPOINT = '/api/sandbox-mesh.send-file'
export const MARK_READ_ENDPOINT = '/api/sandbox-mesh.mark-read'
export const PEER_REMOVE_ENDPOINT = '/api/sandbox-mesh.peer-remove'
export const PEER_PING_ENDPOINT = '/api/sandbox-mesh.peer-ping'
export const GROUP_LEAVE_ENDPOINT = '/api/sandbox-mesh.group-leave'
export const GROUP_RENAME_ENDPOINT = '/api/sandbox-mesh.group-rename'
export const ROOM_REMOVE_ENDPOINT = '/api/sandbox-mesh.room-remove'
export const FILE_DOWNLOAD_ENDPOINT = '/api/sandbox-mesh.file-download'
export const FILE_UPLOAD_ENDPOINT = '/api/sandbox-mesh.file-upload'
export const TASK_CREATE_ENDPOINT = '/api/sandbox-mesh.task-create'
export const TASK_UPDATE_ENDPOINT = '/api/sandbox-mesh.task-update'
export const APPROVAL_DECIDE_ENDPOINT = '/api/sandbox-mesh.approval-decide'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function parseJsonRequest(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function readHeader(headers, key) {
  if (!headers) return ''
  if (typeof headers.get === 'function') return String(headers.get(key) || '').trim()
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower && v != null) {
      return String(Array.isArray(v) ? v[0] : v).trim()
    }
  }
  return ''
}

function extractRateLimitKey(headers, remoteAddress = '') {
  // Prefer socket remoteAddress or the rightmost proxy-appended forwarded IP so clients cannot
  // bypass rate limits by prepending arbitrary values to x-forwarded-for.
  const realIp = readHeader(headers, 'x-real-ip')
  const forwarded = readHeader(headers, 'x-forwarded-for')
  const lastForwarded = forwarded ? forwarded.split(',').pop().trim() : ''
  return (remoteAddress && !/^127\.0\.0\.1$|^::1$/.test(remoteAddress))
    ? remoteAddress
    : (realIp || lastForwarded || remoteAddress || 'global')
}

async function writeUniqueInboxFile(targetDir, fileName, fileBytes) {
  await mkdir(targetDir, { recursive: true })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = uniqueFilePath(targetDir, fileName)
    try {
      await writeFile(candidate, fileBytes, { flag: 'wx' })
      return candidate
    } catch (err) {
      if (err?.code !== 'EEXIST' || attempt === 4) throw err
    }
  }
  return join(targetDir, fileName)
}

/** Register browser-facing `/api/sandbox-mesh.*` endpoints on Cordis `connection`. */
export function registerBrowserRoutes(ctx, service) {
  ctx.inject(['connection'], ({ connection }) => {
    const postRoutes = [
      {
        path: PROFILE_ENDPOINT,
        validate: (body) => (body && typeof body === 'object' ? null : 'Invalid JSON body'),
        run: (body, headers) => service.updateProfile({
          ownerName: body.ownerName,
          role: body.role,
          description: body.description,
          instructions: body.instructions,
          headers,
        }),
      },
      {
        path: PAIR_CODE_ENDPOINT,
        optionalBody: true,
        run: (_body, headers) => {
          service.store.updateSelf(headers)
          const invite = service.store.createPairCode()
          return { ok: true, invite, state: service.getStateSnapshot() }
        },
      },
      {
        path: PAIR_CLAIM_ENDPOINT,
        validate: (body) => (body && body.invite ? null : 'Pair code or URI is required'),
        run: (body, headers) => service.claimPairInvite(body.invite, headers),
      },
      {
        path: GROUP_CREATE_ENDPOINT,
        validate: (body) => (body && body.name ? null : 'Group name is required'),
        run: (body, headers) => service.createGroup({
          name: body.name,
          memberSlugs: Array.isArray(body.memberSlugs) ? body.memberSlugs : [],
          moderatorSlug: body.moderatorSlug || '',
          headers,
        }),
      },
      {
        path: GROUP_INVITE_ENDPOINT,
        validate: (body) => (body && body.roomId && Array.isArray(body.memberSlugs) ? null : 'roomId and memberSlugs are required'),
        run: (body, headers) => service.inviteToGroup({
          roomId: body.roomId,
          memberSlugs: body.memberSlugs,
          headers,
        }),
      },
      {
        path: GROUP_MODERATE_ENDPOINT,
        validate: (body) => (body && body.roomId ? null : 'roomId is required'),
        run: (body, headers) => service.updateGroupModeration({
          roomId: body.roomId,
          moderatorSlug: body.moderatorSlug,
          headers,
        }),
      },
      {
        path: GROUP_REMOVE_ENDPOINT,
        validate: (body) => (body && body.roomId && body.slug ? null : 'roomId and slug are required'),
        run: (body, headers) => service.removeFromGroup({
          roomId: body.roomId,
          slug: body.slug,
          headers,
        }),
      },
      {
        path: NEW_TOPIC_ENDPOINT,
        validate: (body) => (body && body.roomId ? null : 'roomId is required'),
        run: (body, headers) => service.startNewTopic({
          roomId: body.roomId,
          headers,
        }),
      },
      {
        path: SEND_ENDPOINT,
        validate: (body) => (body && body.roomId ? null : 'roomId is required'),
        run: (body, headers) => service.sendMessage({
          roomId: body.roomId,
          text: body.text,
          files: Array.isArray(body.files) ? body.files : [],
          kind: body.kind || 'chat',
          actor: body.actor || 'human',
          hop: Number(body.hop) || 0,
          threadId: body.threadId || '',
          headers,
        }),
      },
      {
        path: SEND_FILE_ENDPOINT,
        validate: (body) => (body && body.roomId && body.filePath ? null : 'roomId and filePath are required'),
        run: (body, headers) => service.sendFile({
          roomId: body.roomId,
          filePath: body.filePath,
          text: body.text || '',
          actor: body.actor || 'human',
          headers,
        }),
      },
      {
        path: MARK_READ_ENDPOINT,
        optionalBody: true,
        run: (body) => {
          if (body?.roomId) {
            service.store.markRoomRead(body.roomId)
          }
          return { ok: true, state: service.getStateSnapshot() }
        },
      },
      {
        path: PEER_REMOVE_ENDPOINT,
        validate: (body) => (body?.slug ? null : 'Peer slug is required'),
        run: (body, headers) => service.unpairPeer({
          slug: body.slug,
          headers,
        }),
      },
      {
        path: PEER_PING_ENDPOINT,
        validate: (body) => (body?.slug ? null : 'Peer slug is required'),
        run: (body, headers) => service.pingPeer({
          slug: body.slug,
          headers,
        }),
      },
      {
        path: GROUP_LEAVE_ENDPOINT,
        validate: (body) => (body?.roomId ? null : 'roomId is required'),
        run: (body, headers) => service.leaveGroup({
          roomId: body.roomId,
          headers,
        }),
      },
      {
        path: GROUP_RENAME_ENDPOINT,
        validate: (body) => (body?.roomId && body?.name ? null : 'roomId and name are required'),
        run: (body, headers) => service.renameGroup({
          roomId: body.roomId,
          name: body.name,
          headers,
        }),
      },
      {
        path: FILE_UPLOAD_ENDPOINT,
        validate: (body) => (body?.roomId && body?.fileName && typeof body?.contentBase64 === 'string'
          ? null
          : 'roomId, fileName, and contentBase64 are required'),
        run: (body, headers) => service.uploadAndSendFile({
          roomId: body.roomId,
          fileName: body.fileName,
          contentBase64: body.contentBase64,
          text: body.text || '',
          threadId: body.threadId || '',
          headers,
        }),
      },
      {
        path: ROOM_REMOVE_ENDPOINT,
        validate: (body) => (body?.roomId ? null : 'roomId is required'),
        run: (body, headers) => service.removeRoom({
          roomId: body.roomId,
          headers,
        }),
      },
      {
        path: TASK_CREATE_ENDPOINT,
        validate: (body) => (body?.roomId && (body?.title || (Array.isArray(body?.tasks) && body.tasks.length > 0))
          ? null
          : 'roomId and task title (or tasks[]) are required'),
        run: (body, headers) => service.createTasks({
          roomId: body.roomId,
          threadId: body.threadId || '',
          tasks: Array.isArray(body.tasks) ? body.tasks : [body],
          actor: 'human',
          notifyAssignees: body.notifyAssignees !== false,
          headers,
        }),
      },
      {
        path: TASK_UPDATE_ENDPOINT,
        validate: (body) => (body?.roomId && body?.taskId ? null : 'roomId and taskId are required'),
        run: (body, headers) => service.updateTask({
          roomId: body.roomId,
          taskId: body.taskId,
          title: body.title,
          description: body.description,
          assigneeSlug: body.assigneeSlug,
          status: body.status,
          priority: body.priority,
          summary: body.summary,
          artifacts: body.artifacts,
          mergeArtifacts: body.mergeArtifacts,
          dependsOn: body.dependsOn,
          approvalRequired: body.approvalRequired,
          approvalPrompt: body.approvalPrompt,
          notifyModerator: false,
          actor: 'human',
          headers,
        }),
      },
      {
        path: APPROVAL_DECIDE_ENDPOINT,
        validate: (body) => (body?.roomId && body?.taskId && ['approved', 'rejected'].includes(String(body?.decision || '').toLowerCase())
          ? null
          : 'roomId, taskId, and decision ("approved" or "rejected") are required'),
        run: (body, headers) => service.decideApproval({
          roomId: body.roomId,
          taskId: body.taskId,
          decision: String(body.decision || '').toLowerCase(),
          comment: body.comment || '',
          headers,
        }),
      },
    ]

    const disposers = [
      connection.fetch.register({
        path: STATE_ENDPOINT,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch(request) {
          service.store.updateSelf(request.headers)
          const currentRev = service.getRevision()
          let sinceRev = ''
          try {
            sinceRev = new URL(request.url, 'http://localhost').searchParams.get('rev') || ''
          } catch {}
          if (sinceRev && Number(sinceRev) === currentRev) {
            return jsonResponse({ ok: true, unchanged: true, rev: currentRev })
          }
          return jsonResponse({ ok: true, rev: currentRev, state: service.getStateSnapshot() })
        },
      }),
      connection.fetch.register({
        path: FILES_ENDPOINT,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch(request) {
          let q = ''
          try {
            const u = new URL(request.url, 'http://localhost')
            q = u.searchParams.get('q') || ''
          } catch {}
          const files = service.listFiles(q, 40)
          return jsonResponse({ ok: true, files })
        },
      }),
      connection.fetch.register({
        path: FILE_DOWNLOAD_ENDPOINT,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        async fetch(request) {
          let roomId = ''
          let msgId = ''
          let inline = false
          try {
            const u = new URL(request.url, 'http://localhost')
            roomId = u.searchParams.get('roomId') || ''
            msgId = u.searchParams.get('msgId') || ''
            inline = u.searchParams.get('inline') === '1'
          } catch {}
          if (!roomId || !msgId) {
            return jsonResponse({ ok: false, error: 'roomId and msgId are required' }, 400)
          }
          const result = await service.readAttachmentFile({ roomId, msgId })
          if (!result.ok) {
            return jsonResponse({ ok: false, error: result.error || 'Attachment unavailable' }, result.status || 404)
          }
          const headers = {
            'content-type': inline ? result.inlineMimeType : result.mimeType,
            'content-length': String(result.bytes.byteLength),
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'x-mesh-preview-kind': result.kind,
          }
          if (!inline) {
            headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`
          }
          if (request.method === 'HEAD') {
            return new Response(null, { status: 200, headers })
          }
          return new Response(result.bytes, { status: 200, headers })
        },
      }),
      ...postRoutes.map((spec) =>
        connection.fetch.register({
          path: spec.path,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            const body = await parseJsonRequest(request)
            if (!spec.optionalBody && (!body || typeof body !== 'object')) {
              return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400)
            }
            const errMsg = spec.validate ? spec.validate(body) : null
            if (errMsg) {
              return jsonResponse({ ok: false, error: errMsg }, 400)
            }
            const result = await spec.run(body || {}, request.headers)
            const errStatus = Number.isInteger(result?.status) ? result.status : 400
            return jsonResponse(result, result?.ok === false ? errStatus : 200)
          },
        }),
      ),
    ]

    ctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'sandbox-mesh: browser api routes')
  })
}

/**
 * Create the incoming HTTP router handling `/local/cli`, `/pair/claim`, and HMAC-signed `/mesh/*` routes
 * with strict per-route sender and room authorization.
 */
export function createIncomingMeshHandler({
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
  flushOutbox,
  setAgentActivity,
  clearAgentActivity,
  maybeDispatchAgentWake,
  notifyCatalogChanged,
  getActiveAgentHop,
}) {
  const pairGlobalLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 25 })

  function applyRemoteGroupMeta(verified, groupPayload, expectedRoomId = '') {
    if (!groupPayload || typeof groupPayload !== 'object' || groupPayload.type === 'pair') {
      return { ok: false, status: 400, error: 'Invalid group metadata' }
    }
    const roomId = String(groupPayload.id || '').trim()
    if (!/^grp_[a-zA-Z0-9_-]{1,96}$/.test(roomId)) {
      return { ok: false, status: 400, error: 'Invalid group id' }
    }
    if (expectedRoomId && roomId !== expectedRoomId) {
      return { ok: false, status: 403, error: 'Group metadata roomId mismatch' }
    }

    const self = store.getSelf()
    const existing = store.getRoom(roomId)
    if (existing && existing.type !== 'group') {
      return { ok: false, status: 403, error: 'Cannot overwrite non-group room' }
    }

    if (!existing) {
      // Only a directly paired sandbox can introduce a brand new group room.
      if (verified.scope !== 'pair') {
        return { ok: false, status: 403, error: 'Pairwise HMAC authentication is required to create a group' }
      }
      const memberSlugs = new Set(
        (Array.isArray(groupPayload.members) ? groupPayload.members : [])
          .map((m) => sanitizeSlug(m?.slug))
          .filter(Boolean),
      )
      if (!memberSlugs.has(verified.fromSlug) || !memberSlugs.has(self.slug)) {
        return { ok: false, status: 403, error: 'Group membership must include both sender and recipient' }
      }
      const createdBy = sanitizeSlug(groupPayload.createdBy || '')
      const room = store.upsertGroupRoom(groupPayload, {
        remote: true,
        authoritative: !createdBy || createdBy === verified.fromSlug,
        creatorAuthority: !createdBy || createdBy === verified.fromSlug,
      })
      return { ok: true, room, isNew: true }
    }

    if (existing.unpaired) {
      const memberSlugs = new Set(
        (Array.isArray(groupPayload.members) ? groupPayload.members : [])
          .map((m) => sanitizeSlug(m?.slug))
          .filter(Boolean),
      )
      if (
        verified.scope !== 'pair'
        || verified.fromSlug !== existing.createdBy
        || !memberSlugs.has(verified.fromSlug)
        || !memberSlugs.has(self.slug)
      ) {
        return { ok: false, status: 403, error: `Group "${existing.id}" is disconnected` }
      }
      const room = store.upsertGroupRoom(groupPayload, {
        remote: true,
        authoritative: true,
        creatorAuthority: true,
      })
      return { ok: true, room, isNew: false }
    }

    if (!store.isRoomMember(existing.id, verified.fromSlug)) {
      return { ok: false, status: 403, error: `Sandbox "${verified.fromSlug}" is not a member of group "${existing.id}"` }
    }
    if (verified.groupId && verified.groupId !== existing.id) {
      return { ok: false, status: 403, error: 'Mesh group header mismatch' }
    }
    if (store.getPeer(verified.fromSlug)?.sharedSecret && verified.scope !== 'pair') {
      return { ok: false, status: 403, error: 'Pairwise HMAC signature is required for paired sandboxes' }
    }

    const isCreator = verified.scope === 'pair' && verified.fromSlug === existing.createdBy
    // An appointed Moderator who is not directly paired with this member signs with the room's
    // groupSecret (same trust model as /mesh/message & /mesh/task-sync), allowing Moderator-led
    // group rename / handoff while keeping member removal & groupSecret rotation strictly creator-only.
    const isModerator = verified.fromSlug === existing.moderatorSlug
      && (verified.scope === 'pair' || !store.getPeer(verified.fromSlug)?.sharedSecret)
    const room = store.upsertGroupRoom(groupPayload, {
      remote: true,
      authoritative: isCreator || isModerator,
      creatorAuthority: isCreator,
    })
    return { ok: true, room, isNew: false }
  }

  function authorizeRoomSender(verified, roomId, claimedSlug = null) {
    if (!roomId) {
      return { ok: false, status: 400, error: 'roomId is required' }
    }
    if (verified.groupId && verified.groupId !== roomId) {
      return { ok: false, status: 403, error: 'Mesh group header does not match target roomId' }
    }
    const room = store.getRoom(roomId)
    if (!room) {
      return { ok: false, status: 404, error: `Unknown room "${roomId}"` }
    }
    if (!store.isRoomMember(roomId, verified.fromSlug)) {
      return { ok: false, status: 403, error: `Sandbox "${verified.fromSlug}" is not authorized for room "${roomId}"` }
    }
    if (room.type === 'pair' && verified.scope !== 'pair') {
      return { ok: false, status: 403, error: 'Pairwise HMAC authentication is required for 1-on-1 rooms' }
    }
    // If this node holds a pairwise secret with `fromSlug`, reject requests authenticated only
    // with a shared groupSecret so another group member cannot impersonate a paired peer.
    if (store.getPeer(verified.fromSlug)?.sharedSecret && verified.scope !== 'pair') {
      return { ok: false, status: 403, error: 'Pairwise HMAC signature is required for paired sandboxes' }
    }
    if (claimedSlug !== null && claimedSlug !== '') {
      const cleanClaimed = sanitizeSlug(claimedSlug)
      if (!cleanClaimed || cleanClaimed !== verified.fromSlug) {
        return { ok: false, status: 403, error: 'Sender slug does not match authenticated sandbox' }
      }
    }
    return { ok: true, room }
  }

  async function handleLocalCli(headers, rawBody) {
    const forwardedPrefix = readHeader(headers, 'x-forwarded-prefix') || readHeader(headers, 'x-forwarded-for')
    if (forwardedPrefix) {
      return { status: 403, body: { ok: false, error: 'Local CLI endpoint is not accessible through reverse proxy' } }
    }
    const auth = readHeader(headers, 'authorization')
    if (!constantTimeEqualString(auth, `Bearer ${localToken}`)) {
      return { status: 401, body: { ok: false, error: 'Invalid local CLI token' } }
    }
    let body = {}
    try { body = JSON.parse(rawBody || '{}') } catch {}
    const action = body.action
    const httpStatus = (res) => (Number.isInteger(res?.status) ? res.status : (res?.ok ? 200 : 400))

    const handlers = {
      status: () => ({ status: 200, body: { ok: true, ...store.getSnapshot() } }),
      'pair-code': () => ({ status: 200, body: { ok: true, invite: store.createPairCode() } }),
      pair: async () => {
        const res = await claimPairInvite(body.invite)
        return { status: httpStatus(res), body: res }
      },
      'group-create': async () => {
        const res = await createGroup({
          name: body.name,
          memberSlugs: body.memberSlugs,
          moderatorSlug: body.moderatorSlug,
        })
        return { status: httpStatus(res), body: res }
      },
      'group-invite': async () => {
        const res = await inviteToGroup({ roomId: body.roomId, memberSlugs: body.memberSlugs })
        return { status: httpStatus(res), body: res }
      },
      'group-moderate': async () => {
        const res = await updateGroupModeration({ roomId: body.roomId, moderatorSlug: body.moderatorSlug })
        return { status: httpStatus(res), body: res }
      },
      'group-remove': async () => {
        const res = await removeFromGroup({ roomId: body.roomId, slug: body.slug })
        return { status: httpStatus(res), body: res }
      },
      'new-topic': async () => {
        const res = await startNewTopic({ roomId: body.roomId })
        return { status: httpStatus(res), body: res }
      },
      rooms: () => ({ status: 200, body: { ok: true, rooms: store.getSnapshot().rooms } }),
      messages: () => {
        const snap = store.getSnapshot()
        return { status: 200, body: { ok: true, roomId: body.roomId, messages: snap.messages[body.roomId] || [] } }
      },
      inbox: () => {
        const inbox = store.getAgentInbox({ ack: Boolean(body.ack), roomId: body.roomId || '' })
        return { status: 200, body: { ok: true, inbox } }
      },
      send: async () => {
        const actor = body.actor || 'agent'
        const activeHop = actor === 'agent' ? (getActiveAgentHop?.(body.roomId) || 0) : 0
        const requestedHop = Number(body.hop) || 0
        const res = await sendMessage({
          roomId: body.roomId,
          text: body.text,
          kind: body.kind || 'chat',
          actor,
          hop: actor === 'agent' ? Math.max(requestedHop, activeHop) : requestedHop,
          threadId: body.threadId || '',
        })
        return { status: httpStatus(res), body: res }
      },
      'send-file': async () => {
        const res = await sendFile({
          roomId: body.roomId,
          filePath: body.filePath,
          text: body.text || '',
          actor: body.actor || 'agent',
        })
        return { status: httpStatus(res), body: res }
      },
      unpair: async () => {
        const res = await unpairPeer({ slug: body.slug })
        return { status: httpStatus(res), body: res }
      },
      ping: async () => {
        const res = await pingPeer({ slug: body.slug })
        return { status: httpStatus(res), body: res }
      },
      'group-leave': async () => {
        const res = await leaveGroup({ roomId: body.roomId })
        return { status: httpStatus(res), body: res }
      },
      tasks: () => ({
        status: 200,
        body: { ok: true, roomId: body.roomId, tasks: store.listRoomTasks(body.roomId, { threadId: body.threadId || '' }) },
      }),
      'task-update': async () => {
        if (typeof updateTask !== 'function') {
          return { status: 501, body: { ok: false, error: 'Task update unavailable' } }
        }
        const res = await updateTask({
          roomId: body.roomId,
          taskId: body.taskId,
          status: body.status,
          summary: body.summary,
          artifacts: body.artifacts,
          shareFiles: body.shareFiles,
          mergeArtifacts: true,
          actor: body.actor === 'human' ? 'human' : 'agent',
          notifyModerator: body.notifyModerator !== false,
        })
        return { status: httpStatus(res), body: res }
      },
    }

    const fn = handlers[action]
    if (!fn) {
      return { status: 400, body: { ok: false, error: `Unknown CLI action: ${action}` } }
    }
    return fn()
  }

  return async function handleIncomingMeshHttp(method, urlPath, headers, rawBody, { remoteAddress = '' } = {}) {
    const cleanPath = String(urlPath || '/').split('?')[0]

    // 1. Local CLI endpoint (loopback + 0600 bearer token)
    if (cleanPath === '/local/cli' && method === 'POST') {
      return handleLocalCli(headers, rawBody)
    }

    // 2. One-time pair claim endpoint (rate-limited + 144-bit single-use token + X25519 ECDH)
    if (cleanPath === '/pair/claim' && method === 'POST') {
      const clientKey = extractRateLimitKey(headers, remoteAddress)
      if (!pairGlobalLimiter.allow('global') || !pairLimiter.allow(clientKey)) {
        return { status: 429, body: { ok: false, error: 'Too many pairing attempts; try again later' } }
      }
      let body = null
      try { body = JSON.parse(rawBody || '{}') } catch {}
      if (!body || typeof body !== 'object') {
        return { status: 400, body: { ok: false, error: 'Invalid JSON body' } }
      }
      const res = store.verifyAndConsumeInvite({
        token: body.token,
        peerKey: body.peerKey,
        peerPublicKey: body.peerPublicKey,
        peerProfile: body.peerProfile,
      })
      if (!res.ok) {
        return { status: res.status || 401, body: { ok: false, error: res.error } }
      }
      const self = store.getSelf()
      store.recordMessage({
        roomId: res.room.id,
        sender: { slug: self.slug, ownerName: self.ownerName, ownerEmail: self.ownerEmail, actor: 'system' },
        kind: 'system',
        text: `${res.peer.ownerName} (${res.peer.slug}) paired with this sandbox.`,
      })
      notifyCatalogChanged()
      const responseBody = {
        ok: true,
        peer: self,
        room: res.room,
      }
      // When ECDH key agreement is used, the shared secret is never transmitted over the wire.
      if (res.hostPublicKey) {
        responseBody.hostPublicKey = res.hostPublicKey
      } else {
        responseBody.sharedSecret = res.sharedSecret
      }
      return { status: 200, body: responseBody }
    }

    // 3. All /mesh/* routes require HMAC-SHA256 + timestamp + nonce replay guard + route authorization
    if (cleanPath.startsWith('/mesh/')) {
      const verified = verifySignedRequest({
        method,
        path: cleanPath,
        headers,
        body: rawBody,
        resolveSecret: ({ fromSlug, groupId }) => store.resolveVerificationSecrets({ fromSlug, groupId }),
        replayGuard,
      })
      if (!verified.ok) {
        return { status: verified.status || 401, body: { ok: false, error: verified.error } }
      }
      const self = store.getSelf()
      if (verified.fromSlug === self.slug) {
        return { status: 403, body: { ok: false, error: 'Self-originated mesh HTTP request rejected' } }
      }

      if (cleanPath === '/mesh/ping' && (method === 'GET' || method === 'POST')) {
        if (verified.groupId && !store.isRoomMember(verified.groupId, verified.fromSlug)) {
          return { status: 403, body: { ok: false, error: 'Not a member of specified group' } }
        }
        if (!verified.groupId && verified.scope !== 'pair') {
          return { status: 403, body: { ok: false, error: 'Pairwise authentication required' } }
        }
        if (verified.scope === 'pair') {
          store.touchPeer?.(verified.fromSlug, { status: 'online' })
        }
        void flushOutbox()
        return { status: 200, body: { ok: true, peer: self } }
      }

      let body = null
      try { body = JSON.parse(rawBody || '{}') } catch {}
      if (!body || typeof body !== 'object') {
        return { status: 400, body: { ok: false, error: 'Invalid JSON body' } }
      }

      if (cleanPath === '/mesh/unpair' && method === 'POST') {
        if (verified.scope !== 'pair') {
          return { status: 403, body: { ok: false, error: 'Pairwise HMAC authentication is required for unpair' } }
        }
        if (body.slug !== undefined && body.slug !== '' && sanitizeSlug(body.slug) !== verified.fromSlug) {
          return { status: 403, body: { ok: false, error: 'Unpair slug must match authenticated peer' } }
        }
        const res = await handleRemoteUnpair(verified.fromSlug)
        return { status: 200, body: { ok: true, unpaired: verified.fromSlug, ...res } }
      }

      if (cleanPath === '/mesh/group-leave' && method === 'POST') {
        const roomId = String(body.roomId || '').trim()
        const authRes = authorizeRoomSender(verified, roomId, body.slug ?? verified.fromSlug)
        if (!authRes.ok) {
          return { status: authRes.status, body: { ok: false, error: authRes.error } }
        }
        if (authRes.room.type !== 'group') {
          return { status: 400, body: { ok: false, error: 'group-leave applies only to group rooms' } }
        }
        const res = await handleRemoteGroupLeave({ roomId, fromSlug: verified.fromSlug })
        return { status: res.status || (res.ok ? 200 : 400), body: res }
      }

      if (cleanPath === '/mesh/profile-sync' && method === 'POST') {
        if (verified.scope !== 'pair') {
          return { status: 403, body: { ok: false, error: 'Pairwise authentication required for profile-sync' } }
        }
        try {
          if (body.peerProfile && sanitizeSlug(body.peerProfile.slug) === verified.fromSlug) {
            const { peer } = store.upsertPairedPeer({
              peerProfile: { ...body.peerProfile, slug: verified.fromSlug },
            })
            notifyCatalogChanged()
            return { status: 200, body: { ok: true, peer } }
          }
          return { status: 403, body: { ok: false, error: 'peerProfile slug must match authenticated peer' } }
        } catch (err) {
          return { status: 400, body: { ok: false, error: err?.message || String(err) } }
        }
      }

      if (cleanPath === '/mesh/group-sync' && method === 'POST') {
        try {
          const metaRes = applyRemoteGroupMeta(verified, body.group)
          if (!metaRes.ok) {
            return { status: metaRes.status, body: { ok: false, error: metaRes.error } }
          }
          notifyCatalogChanged()
          return { status: 200, body: { ok: true, room: metaRes.room } }
        } catch (err) {
          return { status: 400, body: { ok: false, error: err?.message || String(err) } }
        }
      }

      if (cleanPath === '/mesh/task-sync' && method === 'POST') {
        try {
          const roomId = String(body.roomId || '').trim()
          if (!roomId) {
            return { status: 400, body: { ok: false, error: 'roomId is required' } }
          }
          if (body.roomMeta && body.roomMeta.type === 'group') {
            const metaRes = applyRemoteGroupMeta(verified, body.roomMeta, roomId)
            if (!metaRes.ok) {
              return { status: metaRes.status, body: { ok: false, error: metaRes.error } }
            }
          }
          const authRes = authorizeRoomSender(verified, roomId, null)
          if (!authRes.ok) {
            return { status: authRes.status, body: { ok: false, error: authRes.error } }
          }
          const incomingTasks = Array.isArray(body.tasks)
            ? body.tasks
            : (body.task && typeof body.task === 'object' ? [body.task] : [])
          const synced = []
          for (const rawTask of incomingTasks) {
            try {
              const res = store.upsertRemoteTask(roomId, rawTask)
              synced.push({ id: res.task.id, applied: res.applied })
            } catch {}
          }
          return { status: 200, body: { ok: true, roomId, synced } }
        } catch (err) {
          return { status: 400, body: { ok: false, error: err?.message || String(err) } }
        }
      }

      if (cleanPath === '/mesh/status' && method === 'POST') {
        const statusRoomId = String(body.roomId || '').trim()
        const targetSlug = sanitizeSlug(body.slug || verified.fromSlug)
        if (!statusRoomId || !targetSlug) {
          return { status: 400, body: { ok: false, error: 'roomId and slug are required' } }
        }
        const authRes = authorizeRoomSender(verified, statusRoomId, targetSlug)
        if (!authRes.ok) {
          return { status: authRes.status, body: { ok: false, error: authRes.error } }
        }
        const seqKey = `${statusRoomId}:${targetSlug}`
        const incomingSeq = Number(body.seq)
        if (Number.isFinite(incomingSeq)) {
          const prevSeq = peerStatusSeqMap.get(seqKey) ?? -1
          if (incomingSeq < prevSeq) {
            return { status: 200, body: { ok: true, stale: true } }
          }
          peerStatusSeqMap.set(seqKey, incomingSeq)
        }
        if (body.action === 'clear') {
          clearAgentActivity({ roomId: statusRoomId, slug: targetSlug, broadcast: false })
        } else {
          setAgentActivity({
            roomId: statusRoomId,
            slug: targetSlug,
            ownerName: String(body.ownerName || targetSlug),
            stage: String(body.stage || 'preparing'),
            detail: String(body.detail || ''),
            isModerator: Boolean(body.isModerator),
            broadcast: false,
          })
        }
        return { status: 200, body: { ok: true } }
      }

      if (cleanPath === '/mesh/message' && method === 'POST') {
        try {
          const msgInput = body.message
          if (!msgInput || typeof msgInput !== 'object') {
            return { status: 400, body: { ok: false, error: 'message object is required' } }
          }
          const roomId = String(msgInput.roomId || '').trim()
          if (body.roomMeta && body.roomMeta.type === 'group') {
            const metaRes = applyRemoteGroupMeta(verified, body.roomMeta, roomId)
            if (!metaRes.ok) {
              return { status: metaRes.status, body: { ok: false, error: metaRes.error } }
            }
          }
          const authRes = authorizeRoomSender(verified, roomId, msgInput.sender?.slug ?? null)
          if (!authRes.ok) {
            return { status: authRes.status, body: { ok: false, error: authRes.error } }
          }
          let safeAttachment = null
          if (msgInput.attachment && typeof msgInput.attachment === 'object') {
            const { savedPath: _sp, sourcePath: _src, ...restAtt } = msgInput.attachment
            safeAttachment = restAtt
          }
          const safeMsg = {
            ...msgInput,
            roomId,
            attachment: safeAttachment,
            sender: {
              ...(msgInput.sender && typeof msgInput.sender === 'object' ? msgInput.sender : {}),
              slug: verified.fromSlug,
            },
          }
          if (body.newTopic === true && typeof msgInput.threadId === 'string' && msgInput.threadId.trim()) {
            try {
              store.rotateRoomThread(roomId, { nextThreadId: msgInput.threadId.trim().slice(0, 96) })
            } catch {}
          }
          const { message, duplicate, wakeInfo } = store.recordMessage(safeMsg, { isIncoming: true })
          maybeDispatchAgentWake(message.roomId, message, duplicate, wakeInfo)
          return { status: 200, body: { ok: true, messageId: message.id, duplicate, wakeInfo } }
        } catch (err) {
          return { status: 400, body: { ok: false, error: err?.message || String(err) } }
        }
      }

      if (cleanPath === '/mesh/file-offer' && method === 'POST') {
        try {
          const msgInput = body.message
          if (!msgInput || typeof msgInput !== 'object') {
            return { status: 400, body: { ok: false, error: 'message object is required' } }
          }
          const roomId = String(msgInput.roomId || '').trim()
          if (body.roomMeta && body.roomMeta.type === 'group') {
            const metaRes = applyRemoteGroupMeta(verified, body.roomMeta, roomId)
            if (!metaRes.ok) {
              return { status: metaRes.status, body: { ok: false, error: metaRes.error } }
            }
          }
          const authRes = authorizeRoomSender(verified, roomId, msgInput.sender?.slug ?? null)
          if (!authRes.ok) {
            return { status: authRes.status, body: { ok: false, error: authRes.error } }
          }
          if (msgInput.id && store.hasMessage(roomId, msgInput.id)) {
            return { status: 200, body: { ok: true, messageId: msgInput.id, duplicate: true } }
          }

          const safeRoomDir = roomId.replace(/[^a-zA-Z0-9_-]/g, '_')
          const fileName = safeFileName(body.fileName || msgInput?.attachment?.name || 'file.bin')
          const fileBytes = Buffer.from(String(body.contentBase64 || ''), 'base64')
          if (fileBytes.byteLength > maxFileBytes) {
            return { status: 413, body: { ok: false, error: 'Shared file exceeds size limit' } }
          }
          const actualSha = sha256Hex(fileBytes)
          if (body.sha256 && body.sha256 !== actualSha) {
            return { status: 400, body: { ok: false, error: 'File SHA-256 integrity mismatch' } }
          }

          const targetDir = join(inboxDir, safeRoomDir)
          const savedPath = await writeUniqueInboxFile(targetDir, fileName, fileBytes)

          const { sourcePath: _srcPath, savedPath: _prevSaved, ...cleanAtt } =
            msgInput?.attachment && typeof msgInput.attachment === 'object' ? msgInput.attachment : {}

          const { message, duplicate, wakeInfo } = store.recordMessage(
            {
              ...msgInput,
              roomId,
              sender: {
                ...(msgInput.sender && typeof msgInput.sender === 'object' ? msgInput.sender : {}),
                slug: verified.fromSlug,
              },
              kind: 'file',
              attachment: {
                ...cleanAtt,
                name: fileName,
                size: fileBytes.byteLength,
                sha256: actualSha,
                savedPath,
              },
            },
            { isIncoming: true },
          )
          maybeDispatchAgentWake(message.roomId, message, duplicate, wakeInfo)
          return { status: 200, body: { ok: true, messageId: message.id, fileName, duplicate } }
        } catch (err) {
          return { status: 400, body: { ok: false, error: err?.message || String(err) } }
        }
      }
    }

    return { status: 404, body: { ok: false, error: `Unknown mesh route: ${cleanPath}` } }
  }
}
