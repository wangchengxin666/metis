import { DEFAULT_SETTINGS } from '../shared/model.js'

const MEM_STATE_API = 'api/sandbox-memory.state'
const MEM_CREATE_API = 'api/sandbox-memory.create'
const MEM_UPDATE_API = 'api/sandbox-memory.update'
const MEM_DELETE_API = 'api/sandbox-memory.delete'
const MEM_CLEAR_API = 'api/sandbox-memory.clear'
const MEM_SETTINGS_API = 'api/sandbox-memory.settings'
const MEM_ENV_REFRESH_API = 'api/sandbox-memory.env-refresh'
const MEM_EXPORT_API = 'api/sandbox-memory.export'
const MEM_IMPORT_API = 'api/sandbox-memory.import'

function defaultMemoryUiState() {
  return {
    memories: [],
    settings: { ...DEFAULT_SETTINGS, envSections: { ...DEFAULT_SETTINGS.envSections } },
    envSnapshot: {
      info: {},
      toolchains: [],
      projects: [],
      services: [],
      routes: [],
      cron: [],
      scannedAt: 0,
    },
    preview: {
      guideText: '',
      envText: '',
      indexText: '',
      contextText: '',
      budget: {
        guideTokens: 0,
        envTokens: 0,
        indexTokens: 0,
        totalTokens: 0,
        indexChars: 0,
        maxIndexChars: 2800,
        includedCount: 0,
        omittedCount: 0,
        totalEnabledCount: 0,
      },
    },
    stats: {
      total: 0,
      enabled: 0,
      disabled: 0,
      pinned: 0,
      byCategory: {},
      bySource: { auto: 0, agent: 0, manual: 0 },
    },
    storageDir: '',
    indexFile: '',
  }
}

export function createMemoryController({
  fetchImpl = globalThis.fetch,
} = {}) {
  let state = defaultMemoryUiState()
  let busy = false
  let syncing = false
  let lastRev = ''
  let toast = null
  let toastTimer = null
  let syncInFlight = null
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
    }, 3600)
    toastTimer.unref?.()
  }

  function clearToast() {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    toast = null
    emit()
  }

  function applyState(nextState, rev = '') {
    if (nextState && typeof nextState === 'object') {
      state = {
        ...defaultMemoryUiState(),
        ...nextState,
      }
    }
    if (rev !== undefined && rev !== '') {
      lastRev = String(rev)
    }
  }

  async function requestJson(url, opts = {}) {
    if (typeof fetchImpl !== 'function') {
      return { ok: false, error: 'Fetch unavailable' }
    }
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

  async function syncFromHost({ force = false } = {}) {
    if (disposed) return state
    if (syncInFlight && !force) return syncInFlight
    syncing = true
    const url = !force && lastRev ? `${MEM_STATE_API}?rev=${encodeURIComponent(lastRev)}` : MEM_STATE_API
    syncInFlight = (async () => {
      const data = await requestJson(url, { method: 'GET' })
      if (data.ok && !data.unchanged && data.state) {
        applyState(data.state, data.rev)
        emit()
      } else if (data.ok && data.rev) {
        lastRev = String(data.rev)
      }
      return state
    })().finally(() => {
      syncing = false
      syncInFlight = null
    })
    return syncInFlight
  }

  async function mutate(url, body, successKey) {
    busy = true
    emit()
    try {
      const data = await requestJson(url, {
        method: 'POST',
        body: JSON.stringify(body || {}),
      })
      if (!data.ok) {
        showToast('error', 'toastError', data.error || '')
        return data
      }
      if (data.state) {
        applyState(data.state, '')
        lastRev = ''
      }
      if (successKey) showToast('ok', successKey)
      else emit()
      return data
    } finally {
      busy = false
      emit()
    }
  }

  async function createMemory(payload) {
    return mutate(MEM_CREATE_API, payload, 'toastSaved')
  }

  async function updateMemory(id, patch) {
    return mutate(MEM_UPDATE_API, { id, ...patch }, 'toastUpdated')
  }

  async function deleteMemory(id) {
    return mutate(MEM_DELETE_API, { id }, 'toastDeleted')
  }

  async function clearAutoMemories() {
    return mutate(MEM_CLEAR_API, { source: 'auto' }, 'toastCleared')
  }

  async function saveSettings(patch) {
    return mutate(MEM_SETTINGS_API, { settings: patch }, 'toastSettingsSaved')
  }

  async function refreshEnvironment(forceToolchains = false) {
    return mutate(MEM_ENV_REFRESH_API, { forceToolchains }, 'toastEnvRefreshed')
  }

  async function exportMemories() {
    const data = await requestJson(MEM_EXPORT_API, { method: 'GET' })
    if (!data.ok) {
      showToast('error', 'toastError', data.error || '')
      return null
    }
    showToast('ok', 'toastExported')
    return data.data
  }

  async function importMemories(payload, mode = 'merge') {
    return mutate(MEM_IMPORT_API, { payload, mode }, 'toastImported')
  }

  function getSnapshot() {
    return {
      state,
      busy,
      syncing,
      toast,
    }
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function dispose() {
    disposed = true
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    listeners.clear()
  }

  return {
    getSnapshot,
    subscribe,
    syncFromHost,
    createMemory,
    updateMemory,
    deleteMemory,
    clearAutoMemories,
    saveSettings,
    refreshEnvironment,
    exportMemories,
    importMemories,
    showToast,
    clearToast,
    dispose,
  }
}
