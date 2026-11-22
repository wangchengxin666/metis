import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  APP_NAME_RE,
  SERVICE_NAME_RE,
  normalizeAppName,
  normalizeServiceName,
  validateCronSchedule,
} from '../shared/model.js'

function defaultExec(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    timeout: 8000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
}

function readJsonSafe(filePath, fallback) {
  if (!existsSync(filePath)) return fallback
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, filePath)
}

export function createWorkDeliveryService({
  env = process.env,
  homeDir,
  execCmd = defaultExec,
  logger = null,
} = {}) {
  const home = homeDir || env.HOME || homedir() || '/home/workspace'
  const dshHome = env.DSH_HOME || join(home, '.dsh')
  const sandboxDir = join(home, '.dsh-sandbox')
  const meshFile = join(dshHome, 'sandbox-mesh.json')
  const appsDir = join(sandboxDir, 'caddy', 'apps.d')
  const servicesConfDir = join(sandboxDir, 'services', 'conf.d')
  const supConf = join(sandboxDir, 'services', 'supervisord.conf')
  const cronFile = join(sandboxDir, 'crontab')
  const sharedDir = join(home, 'shared')
  const logsDir = join(home, 'logs')

  function resolveSandboxMeta() {
    const info = readJsonSafe(join(sandboxDir, 'info.json'), {})
    const publicOrigin = String(
      env.SANDBOX_PUBLIC_ORIGIN || info.publicOrigin || '',
    ).replace(/\/+$/, '')
    const basePath = String(
      env.SANDBOX_BASE_PATH || info.basePath || '',
    ).replace(/\/+$/, '')
    const slug = String(
      env.SANDBOX_SLUG || info.slug || (basePath.startsWith('/s/') ? basePath.slice(3) : '') || 'sandbox',
    )
    return { publicOrigin, basePath, slug }
  }

  function readExposedApps() {
    const { publicOrigin } = resolveSandboxMeta()
    const apps = []
    if (!existsSync(appsDir)) return apps
    try {
      for (const fname of readdirSync(appsDir).sort()) {
        if (!fname.endsWith('.caddy') || fname === '00-empty.caddy') continue
        try {
          const content = readFileSync(join(appsDir, fname), 'utf8')
          const m = content.match(/^#\s*App:\s*(\S+)\s*->\s*(\S+)\s*mounted\s*at\s*(\S+)/m)
          if (m) {
            const mountPath = m[3]
            const portMatch = m[2].match(/:(\d+)$/)
            apps.push({
              name: m[1],
              target: m[2],
              port: portMatch ? Number(portMatch[1]) : null,
              mount_path: mountPath,
              url: publicOrigin ? `${publicOrigin}${mountPath}` : mountPath,
            })
          }
        } catch {}
      }
    } catch {}
    return apps
  }

  function readServices() {
    const statusMap = {}
    if (existsSync(supConf)) {
      try {
        const raw = execCmd('supervisorctl', ['-c', supConf, 'status'])
        for (const line of String(raw || '').split(/\r?\n/)) {
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 2) {
            statusMap[parts[0]] = { status: parts[1], detail: parts.slice(2).join(' ') }
          }
        }
      } catch (err) {
        const raw = err?.stdout ? String(err.stdout) : ''
        for (const line of raw.split(/\r?\n/)) {
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 2) {
            statusMap[parts[0]] = { status: parts[1], detail: parts.slice(2).join(' ') }
          }
        }
      }
    }

    const list = []
    if (!existsSync(servicesConfDir)) return list
    try {
      for (const fname of readdirSync(servicesConfDir).sort()) {
        if (!fname.endsWith('.conf')) continue
        const svcName = fname.slice(0, -5)
        let command = ''
        let directory = ''
        try {
          const content = readFileSync(join(servicesConfDir, fname), 'utf8')
          const cmdMatch = content.match(/^command=(.+)$/m)
          const dirMatch = content.match(/^directory=(.+)$/m)
          if (cmdMatch) command = cmdMatch[1].trim()
          if (dirMatch) directory = dirMatch[1].trim()
        } catch {}
        const st = statusMap[svcName] || { status: 'UNKNOWN', detail: '' }
        list.push({
          name: svcName,
          status: st.status,
          detail: st.detail,
          command,
          directory,
        })
      }
    } catch {}
    return list
  }

  function readCronJobs() {
    const jobs = []
    if (!existsSync(cronFile)) return jobs
    try {
      const raw = readFileSync(cronFile, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const tokens = trimmed.split(/\s+/)
        if (tokens.length >= 6) {
          jobs.push({
            schedule: tokens.slice(0, 5).join(' '),
            command: tokens.slice(5).join(' '),
            raw: trimmed,
          })
        } else {
          jobs.push({
            schedule: '',
            command: trimmed,
            raw: trimmed,
          })
        }
      }
    } catch {}
    return jobs
  }

  function readSharedFiles() {
    const files = []
    if (!existsSync(sharedDir)) return files
    try {
      for (const fname of readdirSync(sharedDir).sort()) {
        const fpath = join(sharedDir, fname)
        try {
          const st = statSync(fpath)
          if (st.isFile()) {
            files.push({
              name: fname,
              size_bytes: st.size,
              updated_at: st.mtimeMs,
            })
          }
        } catch {}
      }
    } catch {}
    return files
  }

  function readMeshAndUsage() {
    const { slug } = resolveSandboxMeta()
    const summary = {
      slug,
      role: '',
      description: '',
      sop: '',
      peers: [],
      groups: [],
      tasks: [],
      active_tasks_count: 0,
      done_tasks_count: 0,
      pending_approvals: [],
    }
    let totalChars = 0
    let totalMessages = 0
    let totalSessions = 0

    if (existsSync(meshFile)) {
      try {
        const meshRaw = readFileSync(meshFile, 'utf8')
        totalChars += meshRaw.length
        const mesh = JSON.parse(meshRaw)
        if (mesh && typeof mesh === 'object') {
          const selfObj = mesh.self || {}
          summary.slug = selfObj.slug || slug
          summary.role = selfObj.role || ''
          summary.description = selfObj.description || ''
          summary.sop = String(selfObj.instructions || '').trim()

          for (const p of Object.values(mesh.peers || {})) {
            if (p && p.slug) {
              summary.peers.push({
                slug: p.slug,
                owner_name: p.ownerName || p.slug,
                role: p.role || '',
                status: p.status || 'online',
              })
            }
          }
          for (const r of Object.values(mesh.rooms || {})) {
            if (r && r.type === 'group' && !r.unpaired) {
              summary.groups.push({
                id: r.id,
                name: r.name || r.id,
                moderator_slug: r.moderatorSlug || r.createdBy || '',
                member_count: Array.isArray(r.members) ? r.members.length : 0,
              })
            }
          }
          for (const msgList of Object.values(mesh.messages || {})) {
            if (Array.isArray(msgList)) totalMessages += msgList.length
          }
          for (const [roomId, taskList] of Object.entries(mesh.tasks || {})) {
            if (!Array.isArray(taskList)) continue
            for (const tk of taskList) {
              if (!tk || typeof tk !== 'object') continue
              const status = tk.status || 'open'
              if (status === 'done') summary.done_tasks_count += 1
              else if (status !== 'cancelled') summary.active_tasks_count += 1
              const item = {
                id: tk.id,
                room_id: roomId,
                title: tk.title || tk.id,
                description: tk.description || '',
                status,
                priority: tk.priority || 'normal',
                assignee_slug: tk.assigneeSlug || summary.slug,
                approval_required: Boolean(tk.approvalRequired),
                approval_status: tk.approvalStatus || 'none',
                created_at: tk.createdAt || 0,
              }
              summary.tasks.push(item)
              if (item.approval_required && item.approval_status === 'pending') {
                summary.pending_approvals.push({
                  id: item.id,
                  room_id: roomId,
                  title: item.title,
                  assignee_slug: item.assignee_slug,
                })
              }
            }
          }
        }
      } catch (err) {
        logger?.warn?.(`Failed reading mesh state: ${err?.message || err}`)
      }
    }

    if (existsSync(dshHome)) {
      try {
        for (const fname of readdirSync(dshHome)) {
          if (fname.endsWith('.json') || fname.endsWith('.jsonl') || fname.endsWith('.md')) {
            try {
              const st = statSync(join(dshHome, fname))
              if (st.isFile()) {
                totalChars += st.size
                totalSessions += 1
              }
            } catch {}
          }
        }
      } catch {}
    }

    return {
      mesh: summary,
      token_usage: {
        estimated_tokens: Math.round(totalChars / 4),
        sessions_count: totalSessions,
        messages_count: totalMessages,
      },
    }
  }

  function getStateSnapshot() {
    const { mesh, token_usage } = readMeshAndUsage()
    return {
      slug: mesh.slug,
      role: mesh.role,
      description: mesh.description,
      sop: mesh.sop,
      exposed_apps: readExposedApps(),
      cron_jobs: readCronJobs(),
      user_services: readServices(),
      shared_files: readSharedFiles(),
      token_usage,
      peers: mesh.peers,
      groups: mesh.groups,
      tasks: mesh.tasks,
      active_tasks_count: mesh.active_tasks_count,
      done_tasks_count: mesh.done_tasks_count,
      pending_approvals: mesh.pending_approvals,
      updated_at: Date.now(),
    }
  }

  function loadOrInitMeshState() {
    const { slug } = resolveSandboxMeta()
    mkdirSync(dshHome, { recursive: true })
    const raw = readJsonSafe(meshFile, null)
    const state = {
      version: 1,
      self: { slug },
      peers: {},
      rooms: {},
      messages: {},
      tasks: {},
      outbox: [],
      ...(raw || {}),
    }
    if (!state.self || typeof state.self !== 'object') state.self = { slug }
    if (!state.self.slug) state.self.slug = slug
    if (!state.rooms || typeof state.rooms !== 'object') state.rooms = {}
    if (!state.tasks || typeof state.tasks !== 'object') state.tasks = {}
    if (!state.messages || typeof state.messages !== 'object') state.messages = {}
    return state
  }

  function createTask({ title, description = '', priority = 'normal', roomId = '', approvalRequired = false }) {
    const cleanTitle = String(title || '').trim()
    if (!cleanTitle) return { ok: false, error: 'Task title is required', status: 400 }
    const cleanPriority = ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal'
    const state = loadOrInitMeshState()
    const selfSlug = state.self.slug || 'sandbox'
    const nowMs = Date.now()
    const taskId = `tsk_${nowMs.toString(36)}_${randomBytes(3).toString('hex')}`
    const msgId = `msg_${nowMs.toString(36)}_${randomBytes(3).toString('hex')}`

    let targetRoomId = String(roomId || '').trim()
    if (!targetRoomId || !state.rooms[targetRoomId]) {
      const groupRoom = Object.values(state.rooms).find((r) => r && r.type === 'group' && !r.unpaired)
      if (groupRoom && groupRoom.id) {
        targetRoomId = groupRoom.id
      } else {
        targetRoomId = 'inbox:portal'
        if (!state.rooms[targetRoomId]) {
          state.rooms[targetRoomId] = {
            id: targetRoomId,
            type: 'group',
            name: 'Work & Delivery Inbox',
            peerSlug: '',
            groupSecret: '',
            createdBy: selfSlug,
            moderatorSlug: selfSlug,
            activeThreadId: 'thr_inbox',
            unpaired: false,
            members: [{ slug: selfSlug, ownerName: selfSlug }],
            createdAt: nowMs,
            updatedAt: nowMs,
            unreadCount: 0,
          }
        }
      }
    }

    if (!Array.isArray(state.tasks[targetRoomId])) state.tasks[targetRoomId] = []
    state.tasks[targetRoomId].unshift({
      id: taskId,
      roomId: targetRoomId,
      title: cleanTitle,
      description: String(description || '').trim(),
      status: 'open',
      priority: cleanPriority,
      assigneeSlug: selfSlug,
      creatorSlug: 'human',
      approvalRequired: Boolean(approvalRequired),
      approvalStatus: approvalRequired ? 'pending' : 'none',
      createdAt: nowMs,
      updatedAt: nowMs,
    })

    if (!Array.isArray(state.messages[targetRoomId])) state.messages[targetRoomId] = []
    state.messages[targetRoomId].push({
      id: msgId,
      roomId: targetRoomId,
      threadId: state.rooms[targetRoomId]?.activeThreadId || 'thr_inbox',
      sender: { slug: 'work-delivery', ownerName: 'Work & Delivery', actor: 'human' },
      kind: 'text',
      text: `[Task] #${taskId} ${cleanTitle}${description ? `\n${String(description).trim()}` : ''}`,
      createdAt: nowMs,
      ackedByAgent: false,
    })

    writeJsonAtomic(meshFile, state)
    return { ok: true, task_id: taskId, room_id: targetRoomId, state: getStateSnapshot() }
  }

  function updateTaskStatus({ taskId, status, roomId = '' }) {
    const cleanId = String(taskId || '').trim()
    const cleanStatus = ['open', 'in_progress', 'done', 'cancelled'].includes(status) ? status : ''
    if (!cleanId || !cleanStatus) {
      return { ok: false, error: 'taskId and valid status are required', status: 400 }
    }
    const state = loadOrInitMeshState()
    const roomIds = roomId && Array.isArray(state.tasks[roomId]) ? [roomId] : Object.keys(state.tasks)
    let found = false
    for (const rId of roomIds) {
      const list = state.tasks[rId]
      if (!Array.isArray(list)) continue
      for (const tk of list) {
        if (tk && tk.id === cleanId) {
          tk.status = cleanStatus
          tk.updatedAt = Date.now()
          found = true
          break
        }
      }
      if (found) break
    }
    if (!found) return { ok: false, error: `Task ${cleanId} not found`, status: 404 }
    writeJsonAtomic(meshFile, state)
    return { ok: true, task_id: cleanId, status: cleanStatus, state: getStateSnapshot() }
  }

  function decideApproval({ taskId, decision, roomId = '' }) {
    const cleanId = String(taskId || '').trim()
    const cleanDecision = String(decision || '').trim().toLowerCase()
    if (!cleanId || !['approved', 'rejected'].includes(cleanDecision)) {
      return { ok: false, error: 'taskId and decision (approved|rejected) are required', status: 400 }
    }
    const state = loadOrInitMeshState()
    const roomIds = roomId && Array.isArray(state.tasks[roomId]) ? [roomId] : Object.keys(state.tasks)
    let found = false
    for (const rId of roomIds) {
      const list = state.tasks[rId]
      if (!Array.isArray(list)) continue
      for (const tk of list) {
        if (tk && tk.id === cleanId) {
          tk.approvalStatus = cleanDecision
          if (cleanDecision === 'rejected' && tk.status === 'open') {
            tk.status = 'cancelled'
          }
          tk.updatedAt = Date.now()
          found = true
          break
        }
      }
      if (found) break
    }
    if (!found) return { ok: false, error: `Task ${cleanId} not found`, status: 404 }
    writeJsonAtomic(meshFile, state)
    return { ok: true, task_id: cleanId, decision: cleanDecision, state: getStateSnapshot() }
  }

  function exposeApp({ name, port }) {
    const cleanName = normalizeAppName(name)
    const portNum = Number.parseInt(String(port ?? ''), 10)
    if (!APP_NAME_RE.test(cleanName)) {
      return { ok: false, error: `Invalid app name: ${name}`, status: 400 }
    }
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      return { ok: false, error: `Invalid port: ${port}`, status: 400 }
    }
    try {
      const { basePath, publicOrigin } = resolveSandboxMeta()
      execCmd('/usr/local/bin/sandbox-expose', [cleanName, String(portNum)], {
        env: {
          ...env,
          HOME: home,
          ...(basePath ? { SANDBOX_BASE_PATH: basePath } : {}),
          ...(publicOrigin ? { SANDBOX_PUBLIC_ORIGIN: publicOrigin } : {}),
        },
      })
      return { ok: true, name: cleanName, port: portNum, state: getStateSnapshot() }
    } catch (err) {
      const msg = String(err?.stderr || err?.stdout || err?.message || err).trim().slice(-240)
      return { ok: false, error: msg || 'Failed to publish page', status: 500 }
    }
  }

  function unexposeApp({ name }) {
    const cleanName = normalizeAppName(name)
    if (!APP_NAME_RE.test(cleanName)) {
      return { ok: false, error: `Invalid app name: ${name}`, status: 400 }
    }
    try {
      execCmd('/usr/local/bin/sandbox-expose', ['--remove', cleanName], {
        env: { ...env, HOME: home },
      })
      return { ok: true, name: cleanName, state: getStateSnapshot() }
    } catch (err) {
      const msg = String(err?.stderr || err?.stdout || err?.message || err).trim().slice(-240)
      return { ok: false, error: msg || 'Failed to unpublish page', status: 500 }
    }
  }

  function addCronJob({ schedule, command }) {
    const cleanSched = validateCronSchedule(schedule)
    const cleanCmd = String(command || '').trim()
    if (!cleanSched) {
      return { ok: false, error: 'Invalid 5-field cron schedule', status: 400 }
    }
    if (!cleanCmd || /[\r\n]/.test(cleanCmd)) {
      return { ok: false, error: 'Command is required and must be a single line', status: 400 }
    }
    const line = `${cleanSched} ${cleanCmd}`
    try {
      if (existsSync('/usr/local/bin/sandbox-cron')) {
        execCmd('/usr/local/bin/sandbox-cron', ['add', line], {
          env: { ...env, HOME: home },
        })
      } else {
        mkdirSync(sandboxDir, { recursive: true })
        const existing = existsSync(cronFile) ? readFileSync(cronFile, 'utf8') : ''
        const lines = existing.split(/\r?\n/).filter((l) => l.trim().length > 0)
        if (!lines.includes(line)) lines.push(line)
        writeFileSync(cronFile, `${lines.join('\n')}\n`, 'utf8')
      }
      return { ok: true, line, state: getStateSnapshot() }
    } catch (err) {
      const msg = String(err?.stderr || err?.stdout || err?.message || err).trim().slice(-240)
      return { ok: false, error: msg || 'Failed to add schedule', status: 500 }
    }
  }

  function removeCronJob({ raw }) {
    const target = String(raw || '').trim()
    if (!target) return { ok: false, error: 'raw schedule line is required', status: 400 }
    try {
      if (existsSync(cronFile)) {
        const lines = readFileSync(cronFile, 'utf8')
          .split(/\r?\n/)
          .filter((l) => l.trim() && l.trim() !== target)
        writeFileSync(cronFile, lines.length ? `${lines.join('\n')}\n` : '', 'utf8')
        if (existsSync('/usr/local/bin/sandbox-cron')) {
          try {
            execCmd('/usr/local/bin/sandbox-cron', ['sync'], { env: { ...env, HOME: home } })
          } catch {}
        }
      }
      return { ok: true, state: getStateSnapshot() }
    } catch (err) {
      return { ok: false, error: err?.message || 'Failed to remove schedule', status: 500 }
    }
  }

  function controlService({ name, action }) {
    const cleanName = normalizeServiceName(name)
    if (!SERVICE_NAME_RE.test(cleanName)) {
      return { ok: false, error: `Invalid service name: ${name}`, status: 400 }
    }
    if (!['start', 'stop', 'restart'].includes(action)) {
      return { ok: false, error: `Unsupported action: ${action}`, status: 400 }
    }
    try {
      const out = execCmd('supervisorctl', ['-c', supConf, action, cleanName], {
        env: { ...env, HOME: home },
      })
      return {
        ok: true,
        service: cleanName,
        action,
        detail: String(out || '').trim().slice(-240),
        state: getStateSnapshot(),
      }
    } catch (err) {
      const msg = String(err?.stderr || err?.stdout || err?.message || err).trim().slice(-240)
      return { ok: false, error: msg || 'Service control failed', status: 500 }
    }
  }

  function addService({ name, command }) {
    const cleanName = normalizeServiceName(name)
    const cleanCmd = String(command || '').trim()
    if (!SERVICE_NAME_RE.test(cleanName)) {
      return { ok: false, error: `Invalid service name: ${name}`, status: 400 }
    }
    if (!cleanCmd || /[\r\n]/.test(cleanCmd)) {
      return { ok: false, error: 'Command is required', status: 400 }
    }
    try {
      execCmd('/usr/local/bin/sandbox-service', ['add', cleanName, cleanCmd], {
        env: { ...env, HOME: home },
      })
      return { ok: true, service: cleanName, state: getStateSnapshot() }
    } catch (err) {
      const msg = String(err?.stderr || err?.stdout || err?.message || err).trim().slice(-240)
      return { ok: false, error: msg || 'Failed to add service', status: 500 }
    }
  }

  function removeService({ name }) {
    const cleanName = normalizeServiceName(name)
    if (!SERVICE_NAME_RE.test(cleanName)) {
      return { ok: false, error: `Invalid service name: ${name}`, status: 400 }
    }
    try {
      execCmd('/usr/local/bin/sandbox-service', ['remove', cleanName], {
        env: { ...env, HOME: home },
      })
      return { ok: true, service: cleanName, state: getStateSnapshot() }
    } catch (err) {
      const msg = String(err?.stderr || err?.stdout || err?.message || err).trim().slice(-240)
      return { ok: false, error: msg || 'Failed to remove service', status: 500 }
    }
  }

  function readServiceLogs({ name, tail = 120 }) {
    const cleanName = normalizeServiceName(name)
    if (!SERVICE_NAME_RE.test(cleanName)) {
      return { ok: false, error: `Invalid service name: ${name}`, status: 400 }
    }
    const maxLines = Math.max(10, Math.min(500, Number(tail) || 120))
    const chunks = []
    for (const ext of ['.log', '.err']) {
      const f = join(logsDir, `${cleanName}${ext}`)
      if (existsSync(f)) {
        try {
          const lines = readFileSync(f, 'utf8').split(/\r?\n/)
          const sliced = lines.slice(-maxLines).join('\n').trim()
          if (sliced) chunks.push(`=== ${cleanName}${ext} ===\n${sliced}`)
        } catch {}
      }
    }
    return { ok: true, name: cleanName, logs: chunks.join('\n\n') }
  }

  return {
    getStateSnapshot,
    createTask,
    updateTaskStatus,
    decideApproval,
    exposeApp,
    unexposeApp,
    addCronJob,
    removeCronJob,
    controlService,
    addService,
    removeService,
    readServiceLogs,
  }
}
