import { createMemoryStore, resolveMemoryDir } from './src/host/store.js'
import { createEnvironmentScanner } from './src/host/env-scanner.js'
import { buildContextBundle, buildStandingGuide } from './src/host/prompt-builder.js'
import {
  CLEAR_ENDPOINT,
  CREATE_ENDPOINT,
  DELETE_ENDPOINT,
  ENV_REFRESH_ENDPOINT,
  EXPORT_ENDPOINT,
  IMPORT_ENDPOINT,
  registerBrowserRoutes,
  SEARCH_ENDPOINT,
  SETTINGS_ENDPOINT,
  STATE_ENDPOINT,
  UPDATE_ENDPOINT,
} from './src/host/routes.js'
import { wireHarnessRuntime } from './src/host/harness-bridge.js'

export const name = 'sandbox-memory'

export {
  STATE_ENDPOINT,
  CREATE_ENDPOINT,
  UPDATE_ENDPOINT,
  DELETE_ENDPOINT,
  CLEAR_ENDPOINT,
  SETTINGS_ENDPOINT,
  ENV_REFRESH_ENDPOINT,
  EXPORT_ENDPOINT,
  IMPORT_ENDPOINT,
  SEARCH_ENDPOINT,
  resolveMemoryDir,
}

export function createMemoryService({
  config = {},
  env = process.env,
  execCmd,
  logger = null,
} = {}) {
  let envRevision = 0
  const changeListeners = new Set()

  function notifyChanged() {
    for (const fn of changeListeners) {
      try { fn() } catch {}
    }
  }

  const store = createMemoryStore({ config, env })
  const envScanner = createEnvironmentScanner({
    config,
    env,
    execCmd,
    onChange: () => {
      envRevision += 1
      notifyChanged()
    },
  })

  function getRevision() {
    return store.getRevision() + envRevision
  }

  function getPreviewBundle() {
    return buildContextBundle(
      store.list(),
      envScanner.getCachedSnapshot(),
      store.getSettings(),
    )
  }

  function getStandingGuide() {
    return buildStandingGuide(store.getSettings())
  }

  function getInjectedContext() {
    return getPreviewBundle().contextText
  }

  function getStateSnapshot() {
    const memories = store.list()
    const settings = store.getSettings()
    const envSnapshot = envScanner.getCachedSnapshot()
    const preview = buildContextBundle(memories, envSnapshot, settings)
    return {
      memories,
      settings,
      envSnapshot,
      preview,
      stats: store.getStats(),
      storageDir: store.rootDir,
      indexFile: store.indexFile,
    }
  }

  function saveMemory(input) {
    const res = store.upsert(input)
    if (res.ok) notifyChanged()
    return res.ok ? { ...res, state: getStateSnapshot() } : res
  }

  function updateMemory(id, patch, { isManual = false } = {}) {
    const res = store.update(id, patch, { skipRedaction: isManual })
    if (res.ok) notifyChanged()
    return res.ok ? { ...res, state: getStateSnapshot() } : res
  }

  function deleteMemory(id) {
    const res = store.remove(id)
    if (res.ok) notifyChanged()
    return res.ok ? { ...res, state: getStateSnapshot() } : res
  }

  function clearMemories(source = 'auto') {
    const res = store.clearBySource(source)
    if (res.ok) notifyChanged()
    return { ...res, state: getStateSnapshot() }
  }

  function updateSettings(patch) {
    const settings = store.updateSettings(patch)
    notifyChanged()
    return { ok: true, settings, state: getStateSnapshot() }
  }

  async function refreshEnvironment({ forceToolchains = false } = {}) {
    const snapshot = await envScanner.refresh({ forceToolchains })
    envRevision += 1
    notifyChanged()
    return { ok: true, envSnapshot: snapshot, state: getStateSnapshot() }
  }

  function importMemories(payload, { mode = 'merge' } = {}) {
    const res = store.importData(payload, { mode })
    if (res.ok) notifyChanged()
    return res.ok ? { ...res, state: getStateSnapshot() } : res
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return () => {}
    changeListeners.add(fn)
    return () => { changeListeners.delete(fn) }
  }

  function start() {
    envScanner.startWatching()
    void envScanner.refresh({ forceToolchains: true }).catch((err) => {
      logger?.warn?.(`Initial environment scan failed: ${err?.message || err}`)
    })
  }

  function dispose() {
    envScanner.dispose()
    changeListeners.clear()
  }

  return {
    store,
    envScanner,
    getRevision,
    getStandingGuide,
    getInjectedContext,
    getPreviewBundle,
    getStateSnapshot,
    saveMemory,
    updateMemory,
    deleteMemory,
    clearMemories,
    updateSettings,
    refreshEnvironment,
    importMemories,
    onChange,
    start,
    dispose,
  }
}

export function apply(ctx, config = {}) {
  const logger = ctx.logger ? ctx.logger('sandbox-memory') : null
  const service = createMemoryService({ config, env: process.env, logger })
  service.start()

  registerBrowserRoutes(ctx, service)
  wireHarnessRuntime(ctx, service, { logger })

  ctx.effect(() => () => {
    service.dispose()
  }, 'sandbox-memory: service lifecycle')
}
