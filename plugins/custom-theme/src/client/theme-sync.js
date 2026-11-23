import {
  applyManagedBrandToState,
  buildDefaultThemeState,
  compileTokenOverrides,
  normalizeThemeState,
  sanitizeBrandSvg,
} from '../shared/presets.js'

export const STORAGE_KEY = 'dsh-dock:custom-theme'
const STATE_ENDPOINT = 'api/custom-theme.state'
const SAVE_ENDPOINT = 'api/custom-theme.save'
const RESET_ENDPOINT = 'api/custom-theme.reset'

function readLocalStorageState() {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeThemeState(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeLocalStorageState(state) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage quota or private-browsing failures.
  }
}

export function resolveInitialThemeState(globalObj = globalThis) {
  const bootState = globalObj?.__DSH_CUSTOM_THEME__
  if (bootState && typeof bootState === 'object') {
    const normalized = normalizeThemeState(bootState)
    writeLocalStorageState(normalized)
    return normalized
  }
  const cached = readLocalStorageState()
  if (cached) return cached
  return buildDefaultThemeState()
}

export function createThemeController({
  React,
  themeSvc,
  slotsSvc,
  fetchImpl = globalThis.fetch,
  globalObj = globalThis,
}) {
  const H = React.createElement
  let state = resolveInitialThemeState(globalObj)
  let stateSource = 'default'
  let latestManagedBrand = null
  let colorPreference = themeSvc?.getTheme?.()?.preference || 'system'
  let activeScheme = themeSvc?.getTheme?.()?.active?.colorScheme || 'light'
  let statusKind = 'idle'
  let statusKey = ''
  let statusSeq = 0
  let errorText = ''

  let disposeTokens = null
  let lastTokenSig = ''
  let disposeBrandMark = null
  let lastBrandSvg = ''
  let disposeBrandName = null
  let lastBrandName = ''
  let saveTimer = null
  let disposed = false

  const listeners = new Set()

  function notify() {
    for (const listener of listeners) {
      listener()
    }
  }

  function applyTokenLayer(nextState) {
    const overrides = compileTokenOverrides(nextState)
    const sig = JSON.stringify(overrides)
    if (sig === lastTokenSig) return
    lastTokenSig = sig
    if (!themeSvc || typeof themeSvc.overrideTokens !== 'function') return
    if (Object.keys(overrides).length === 0) {
      disposeTokens?.()
      disposeTokens = null
      return
    }
    disposeTokens = themeSvc.overrideTokens('custom-theme', overrides)
  }

  function syncBrandSlots(nextState) {
    if (!slotsSvc || typeof slotsSvc.inject !== 'function') return
    const activeBrand = Boolean(nextState.enabled && nextState.brand?.enabled)
    const nextSvg = activeBrand ? sanitizeBrandSvg(nextState.brand?.iconSvg || '') : ''
    const nextName = activeBrand ? String(nextState.brand?.name || '').trim() : ''

    if (nextSvg !== lastBrandSvg) {
      disposeBrandMark?.()
      disposeBrandMark = null
      lastBrandSvg = nextSvg
      if (nextSvg) {
        const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(nextSvg)}`
        disposeBrandMark = slotsSvc.inject('sidebar.brand.mark', () =>
          slotsSvc.register(
            { name: 'sidebar.brand.mark', priority: -10 },
            function CustomBrandMark({ size = 24 }) {
              return H('img', {
                src: dataUri,
                width: size,
                height: size,
                alt: nextName || '',
                style: {
                  display: 'block',
                  width: `${size}px`,
                  height: `${size}px`,
                  objectFit: 'contain',
                  borderRadius: '4px',
                },
              })
            },
          ),
        )
      }
    }

    if (nextName !== lastBrandName) {
      disposeBrandName?.()
      disposeBrandName = null
      lastBrandName = nextName
      if (nextName) {
        disposeBrandName = slotsSvc.inject('sidebar.brand.name', () =>
          slotsSvc.register(
            { name: 'sidebar.brand.name', priority: -10 },
            function CustomBrandName() {
              return H('span', { className: 'ct-brand-name-slot' }, nextName)
            },
          ),
        )
      }
    }
  }

  function applyStateLocally(nextState, { persistCache = true } = {}) {
    state = normalizeThemeState(nextState)
    if (persistCache) writeLocalStorageState(state)
    applyTokenLayer(state)
    syncBrandSlots(state)
    notify()
  }

  async function syncFromHost() {
    if (typeof fetchImpl !== 'function') return
    try {
      const res = await fetchImpl(STATE_ENDPOINT, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!res.ok || disposed) return
      const data = await res.json()
      if (data?.source === 'file' || data?.source === 'default') {
        stateSource = data.source
      }
      if (data?.state && !disposed) {
        const next = stateSource === 'default' && latestManagedBrand
          ? applyManagedBrandToState(data.state, latestManagedBrand)
          : data.state
        applyStateLocally(next)
      }
    } catch {
      // Keep boot/cached theme cleanly if Host is temporarily unreachable.
    }
  }

  function applyManagedBrand(managedBrand) {
    latestManagedBrand = managedBrand && typeof managedBrand === 'object' ? managedBrand : null
    if (disposed || stateSource === 'file' || !latestManagedBrand) return
    const next = applyManagedBrandToState(buildDefaultThemeState(), latestManagedBrand)
    applyStateLocally(next, { persistCache: false })
  }

  async function saveState(candidateState = state, { statusOverrideKey = 'statusSaved' } = {}) {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const normalized = normalizeThemeState(candidateState)
    stateSource = 'file'
    applyStateLocally(normalized)
    statusKind = 'saving'
    statusKey = 'statusSaving'
    errorText = ''
    notify()

    if (typeof fetchImpl !== 'function') {
      statusKind = 'saved'
      statusKey = statusOverrideKey
      statusSeq += 1
      notify()
      return { ok: true, state: normalized }
    }

    try {
      const res = await fetchImpl(SAVE_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: normalized }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || payload?.ok === false) {
        statusKind = 'error'
        statusKey = ''
        statusSeq += 1
        errorText = payload?.error || `HTTP ${res.status}`
        notify()
        return { ok: false, error: errorText }
      }
      if (payload?.state) {
        stateSource = 'file'
        applyStateLocally(payload.state)
      }
      statusKind = 'saved'
      statusKey = statusOverrideKey
      statusSeq += 1
      errorText = ''
      notify()
      return { ok: true, state }
    } catch (err) {
      statusKind = 'error'
      statusKey = ''
      statusSeq += 1
      errorText = err instanceof Error ? err.message : String(err)
      notify()
      return { ok: false, error: errorText }
    }
  }

  function scheduleSave(candidateState, delayMs = 380) {
    applyStateLocally(candidateState)
    if (saveTimer) clearTimeout(saveTimer)
    statusKind = 'saving'
    statusKey = 'statusSaving'
    errorText = ''
    notify()
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveState(state)
    }, delayMs)
  }

  async function resetState(mode = 'default') {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    statusKind = 'saving'
    statusKey = 'statusSaving'
    errorText = ''
    notify()

    if (typeof fetchImpl !== 'function') {
      const next = mode === 'official'
        ? { ...buildDefaultThemeState(), enabled: false }
        : buildDefaultThemeState()
      applyStateLocally(next)
      statusKind = 'saved'
      statusKey = 'statusReset'
      statusSeq += 1
      notify()
      return { ok: true, state }
    }

    try {
      const res = await fetchImpl(RESET_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || !payload?.state) {
        statusKind = 'error'
        statusSeq += 1
        errorText = payload?.error || `HTTP ${res.status}`
        notify()
        return { ok: false, error: errorText }
      }
      if (mode === 'default') stateSource = 'default'
      else stateSource = 'file'
      applyStateLocally(payload.state)
      statusKind = 'saved'
      statusKey = 'statusReset'
      statusSeq += 1
      errorText = ''
      notify()
      return { ok: true, state }
    } catch (err) {
      statusKind = 'error'
      statusSeq += 1
      errorText = err instanceof Error ? err.message : String(err)
      notify()
      return { ok: false, error: errorText }
    }
  }

  function setColorPreference(mode) {
    if (typeof themeSvc?.setTheme === 'function') {
      themeSvc.setTheme(mode)
      const snap = themeSvc.getTheme?.()
      if (snap) {
        colorPreference = snap.preference
        activeScheme = snap.active?.colorScheme || activeScheme
      }
      notify()
    }
  }

  function handleThemeChange(snapshot) {
    if (!snapshot) return
    colorPreference = snapshot.preference || colorPreference
    activeScheme = snapshot.active?.colorScheme || activeScheme
    notify()
  }

  // Apply immediately so first mounted render already carries defaults/booted tokens.
  applyTokenLayer(state)
  syncBrandSlots(state)

  let removeStorageListener = () => {}
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onStorage = (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        applyStateLocally(JSON.parse(event.newValue), { persistCache: false })
      } catch {
        // Ignore invalid cross-tab payload.
      }
    }
    window.addEventListener('storage', onStorage)
    removeStorageListener = () => window.removeEventListener('storage', onStorage)
  }

  return {
    getSnapshot() {
      return {
        state,
        colorPreference,
        activeScheme,
        statusKind,
        statusKey,
        statusSeq,
        errorText,
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    syncFromHost,
    applyManagedBrand,
    applyPreview: (next) => applyStateLocally(next),
    scheduleSave,
    saveState,
    resetState,
    setColorPreference,
    handleThemeChange,
    dispose() {
      disposed = true
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      removeStorageListener()
      disposeTokens?.()
      disposeTokens = null
      disposeBrandMark?.()
      disposeBrandMark = null
      disposeBrandName?.()
      disposeBrandName = null
      listeners.clear()
    },
  }
}
