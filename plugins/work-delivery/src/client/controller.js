const WD_STATE_API = 'api/work-delivery.state'
const WD_TASK_CREATE_API = 'api/work-delivery.task-create'
const WD_TASK_STATUS_API = 'api/work-delivery.task-status'
const WD_TASK_APPROVE_API = 'api/work-delivery.task-approve'
const WD_APP_EXPOSE_API = 'api/work-delivery.app-expose'
const WD_APP_UNEXPOSE_API = 'api/work-delivery.app-unexpose'
const WD_CRON_ADD_API = 'api/work-delivery.cron-add'
const WD_CRON_REMOVE_API = 'api/work-delivery.cron-remove'
const WD_SERVICE_ACTION_API = 'api/work-delivery.service-action'
const WD_SERVICE_ADD_API = 'api/work-delivery.service-add'
const WD_SERVICE_REMOVE_API = 'api/work-delivery.service-remove'
const WD_SERVICE_LOGS_API = 'api/work-delivery.service-logs'

function defaultWorkDeliveryState() {
  return {
    slug: 'sandbox',
    role: '',
    description: '',
    sop: '',
    exposed_apps: [],
    cron_jobs: [],
    user_services: [],
    shared_files: [],
    token_usage: { estimated_tokens: 0, sessions_count: 0, messages_count: 0 },
    peers: [],
    groups: [],
    tasks: [],
    active_tasks_count: 0,
    done_tasks_count: 0,
    pending_approvals: [],
    updated_at: 0,
  }
}

export function createWorkDeliveryController({
  fetchImpl = globalThis.fetch,
} = {}) {
  let state = defaultWorkDeliveryState()
  let loading = false
  let busy = false
  let toast = null
  let toastTimer = null
  let disposed = false
  const listeners = new Set()

  function emit() {
    if (disposed) return
    for (const fn of listeners) {
      try { fn() } catch {}
    }
  }

  function showToast(kind, key, detail = '') {
    if (toastTimer) clearTimeout(toastTimer)
    toast = { kind, key, detail, id: Date.now() }
    emit()
    toastTimer = setTimeout(() => {
      toast = null
      toastTimer = null
      emit()
    }, 3400)
    toastTimer.unref?.()
  }

  async function requestJson(url, opts = {}) {
    if (typeof fetchImpl !== 'function') return { ok: false, error: 'Fetch unavailable' }
    try {
      const res = await fetchImpl(url, {
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          ...(opts.headers || {}),
        },
        ...opts,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        return { ok: false, error: data.error || `HTTP ${res.status}` }
      }
      return data
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  }

  function applyState(nextState) {
    if (nextState && typeof nextState === 'object') {
      state = { ...defaultWorkDeliveryState(), ...nextState }
    }
  }

  async function syncFromHost() {
    if (disposed) return state
    loading = true
    emit()
    const res = await requestJson(WD_STATE_API, { method: 'GET' })
    loading = false
    if (res.ok && res.state) {
      applyState(res.state)
    }
    emit()
    return state
  }

  async function mutate(apiUrl, payload, okToastKey) {
    busy = true
    emit()
    const res = await requestJson(apiUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    busy = false
    if (res.ok) {
      if (res.state) applyState(res.state)
      else await syncFromHost()
      if (okToastKey) showToast('ok', okToastKey)
    } else {
      showToast('err', 'toastError', res.error || '')
    }
    emit()
    return res
  }

  async function createTask({ title, description = '', priority = 'normal', roomId = '', approvalRequired = false }) {
    busy = true
    emit()
    if (roomId && roomId !== 'inbox:portal') {
      const meshRes = await requestJson('api/sandbox-mesh.task-create', {
        method: 'POST',
        body: JSON.stringify({
          roomId,
          title,
          description,
          priority,
          approvalRequired: Boolean(approvalRequired),
        }),
      })
      if (meshRes.ok) {
        busy = false
        await syncFromHost()
        showToast('ok', 'toastTaskCreated')
        return meshRes
      }
    }
    busy = false
    return mutate(WD_TASK_CREATE_API, { title, description, priority, roomId, approvalRequired }, 'toastTaskCreated')
  }

  async function updateTaskStatus({ taskId, status, roomId = '' }) {
    busy = true
    emit()
    if (roomId && roomId !== 'inbox:portal') {
      const meshRes = await requestJson('api/sandbox-mesh.task-update', {
        method: 'POST',
        body: JSON.stringify({ roomId, taskId, status }),
      })
      if (meshRes.ok) {
        busy = false
        await syncFromHost()
        showToast('ok', 'toastTaskUpdated')
        return meshRes
      }
    }
    busy = false
    return mutate(WD_TASK_STATUS_API, { taskId, status, roomId }, 'toastTaskUpdated')
  }

  async function decideApproval({ taskId, decision, roomId = '' }) {
    busy = true
    emit()
    if (roomId && roomId !== 'inbox:portal') {
      const meshRes = await requestJson('api/sandbox-mesh.approval-decide', {
        method: 'POST',
        body: JSON.stringify({ roomId, taskId, decision }),
      })
      if (meshRes.ok) {
        busy = false
        await syncFromHost()
        showToast('ok', 'toastApproved')
        return meshRes
      }
    }
    busy = false
    return mutate(WD_TASK_APPROVE_API, { taskId, decision, roomId }, 'toastApproved')
  }

  function exposeApp({ name, port }) {
    return mutate(WD_APP_EXPOSE_API, { name, port }, 'toastAppExposed')
  }

  function unexposeApp({ name }) {
    return mutate(WD_APP_UNEXPOSE_API, { name }, 'toastAppRemoved')
  }

  function addCronJob({ schedule, command }) {
    return mutate(WD_CRON_ADD_API, { schedule, command }, 'toastCronAdded')
  }

  function removeCronJob({ raw }) {
    return mutate(WD_CRON_REMOVE_API, { raw }, 'toastCronRemoved')
  }

  function controlService({ name, action }) {
    return mutate(WD_SERVICE_ACTION_API, { name, action }, 'toastServiceOk')
  }

  function addService({ name, command }) {
    return mutate(WD_SERVICE_ADD_API, { name, command }, 'toastServiceOk')
  }

  function removeService({ name }) {
    return mutate(WD_SERVICE_REMOVE_API, { name }, 'toastServiceOk')
  }

  async function readServiceLogs(name) {
    const res = await requestJson(`${WD_SERVICE_LOGS_API}?name=${encodeURIComponent(name)}&tail=120`, {
      method: 'GET',
    })
    return res.ok ? (res.logs || '') : (res.error || 'Failed to read logs')
  }

  return {
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    getSnapshot() {
      return { state, loading, busy, toast }
    },
    syncFromHost,
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
    dispose() {
      disposed = true
      if (toastTimer) clearTimeout(toastTimer)
      listeners.clear()
    },
  }
}
