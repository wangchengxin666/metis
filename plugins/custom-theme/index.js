import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  applyManagedBrandToState,
  buildDefaultThemeState,
  buildFirstPaintCss,
  isValidCssVarName,
  normalizeThemeState,
  sanitizeBrandSvg,
  sanitizeCssValue,
} from './src/shared/presets.js'

export const name = 'custom-theme'

// Expose `managedBrand` as a top-level Volatile field when Schemastery is present
// (DSH >= 0.2.3 automatically pushes Volatile Config fields to the browser via dsh-client-config).
async function loadSchemastery() {
  try {
    const mod = await import('@deepseek-ai/schemastery')
    return mod?.default || mod
  } catch {}
  const anchors = [
    process.argv[1],
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json',
    '/usr/local/lib/node_modules/@deepseek-ai/schemastery/package.json',
  ].filter(Boolean)
  for (const anchor of anchors) {
    try {
      const realAnchor = existsSync(anchor) ? realpathSync(anchor) : anchor
      const req = createRequire(realAnchor)
      const resolved = req.resolve('@deepseek-ai/schemastery')
      const mod = await import(pathToFileURL(resolved).href)
      return mod?.default || mod
    } catch {}
  }
  return null
}

const _schemastery = await loadSchemastery()

export const Config = _schemastery && typeof _schemastery.object === 'function'
  ? _schemastery.object({
      storagePath: _schemastery.string().default(''),
      managedBrand: typeof _schemastery.any().volatile === 'function'
        ? _schemastery.any().volatile()
        : _schemastery.any(),
    })
  : undefined

export const STATE_ENDPOINT = '/api/custom-theme.state'
export const SAVE_ENDPOINT = '/api/custom-theme.save'
export const RESET_ENDPOINT = '/api/custom-theme.reset'

export function resolveStoragePath(config = {}, env = process.env) {
  if (typeof config?.storagePath === 'string' && config.storagePath.trim()) {
    return config.storagePath.trim()
  }
  const dshHome = String(env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
  return join(dshHome, 'custom-theme.json')
}

export function validateThemeInput(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return 'Request payload must be a JSON object'
  }
  if (candidate.tokens && typeof candidate.tokens === 'object') {
    for (const [tokenName, pair] of Object.entries(candidate.tokens)) {
      if (!isValidCssVarName(tokenName)) {
        return `Invalid CSS custom property name: ${tokenName}`
      }
      if (!pair || typeof pair !== 'object') {
        return `Token ${tokenName} must contain { light, dark } strings`
      }
      if (!sanitizeCssValue(pair.light) || !sanitizeCssValue(pair.dark)) {
        return `Invalid CSS value for token ${tokenName}`
      }
    }
  }
  if (Array.isArray(candidate.customTokens)) {
    for (const row of candidate.customTokens) {
      if (!row || typeof row !== 'object') return 'Each custom token entry must be an object'
      const varName = typeof row.name === 'string' ? row.name.trim() : ''
      if (!varName) continue
      if (!isValidCssVarName(varName)) {
        return `Invalid custom CSS variable name: ${varName}`
      }
      const lightOk = !row.light || Boolean(sanitizeCssValue(row.light))
      const darkOk = !row.dark || Boolean(sanitizeCssValue(row.dark))
      if (!lightOk || !darkOk) {
        return `Disallowed characters in CSS value for ${varName}`
      }
    }
  }
  if (candidate.brand && typeof candidate.brand === 'object' && typeof candidate.brand.iconSvg === 'string') {
    const rawSvg = candidate.brand.iconSvg.trim()
    if (rawSvg && !sanitizeBrandSvg(rawSvg)) {
      return 'Brand SVG must be a valid <svg viewBox="..."> document without scripts or event handlers'
    }
  }
  return ''
}

export function createThemeStore(filePath, getManagedBrand = () => null) {
  let cachedState = null
  let cachedSig = ''

  function defaultState() {
    const managed = typeof getManagedBrand === 'function' ? getManagedBrand() : null
    return applyManagedBrandToState(buildDefaultThemeState(), managed)
  }

  function readFromDisk() {
    if (!existsSync(filePath)) {
      cachedState = defaultState()
      cachedSig = 'missing'
      return { state: cachedState, source: 'default' }
    }
    try {
      const stat = statSync(filePath)
      const sig = `${stat.mtimeMs}:${stat.size}`
      if (cachedState && cachedSig === sig) {
        return { state: cachedState, source: 'file' }
      }
      const raw = JSON.parse(readFileSync(filePath, 'utf8'))
      cachedState = normalizeThemeState(raw)
      cachedSig = sig
      return { state: cachedState, source: 'file' }
    } catch {
      cachedState = defaultState()
      cachedSig = 'fallback'
      return { state: cachedState, source: 'default' }
    }
  }

  function writeToDisk(nextState) {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8')
    renameSync(tmpPath, filePath)
    const stat = statSync(filePath)
    cachedState = nextState
    cachedSig = `${stat.mtimeMs}:${stat.size}`
  }

  function save(rawPayload) {
    const body = rawPayload && typeof rawPayload === 'object' && rawPayload.state
      ? rawPayload.state
      : rawPayload
    const errMsg = validateThemeInput(body)
    if (errMsg) {
      return { ok: false, error: errMsg }
    }
    const normalized = normalizeThemeState(body)
    writeToDisk(normalized)
    return { ok: true, state: normalized }
  }

  function reset(mode = 'default') {
    if (mode === 'official') {
      const next = { ...buildDefaultThemeState(), enabled: false }
      writeToDisk(next)
      return { ok: true, state: next }
    }
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true })
    }
    cachedState = defaultState()
    cachedSig = 'missing'
    return { ok: true, state: cachedState }
  }

  return {
    filePath,
    getState() {
      return readFromDisk()
    },
    save,
    reset,
  }
}

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

export function apply(ctx, config = {}) {
  const storagePath = resolveStoragePath(config)
  const readManagedBrand = () => {
    const raw = config?.managedBrand
    if (raw && typeof raw.get === 'function') return raw.get()
    return raw && typeof raw === 'object' ? raw : null
  }
  const store = createThemeStore(storagePath, readManagedBrand)

  const offInject = ctx.on('webserver/index-inject', (table) => {
    const { state } = store.getState()
    table.push({
      kind: 'global',
      name: '__DSH_CUSTOM_THEME__',
      value: state,
    })
    const css = buildFirstPaintCss(state)
    if (css) {
      table.push({ kind: 'style', text: css })
    }
  })
  ctx.effect(() => offInject, 'custom-theme: webserver first-paint injection')

  ctx.inject(['connection'], ({ connection }) => {
    const disposers = [
      connection.fetch.register({
        path: STATE_ENDPOINT,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch() {
          const { state, source } = store.getState()
          return jsonResponse({ ok: true, state, source })
        },
      }),
      connection.fetch.register({
        path: SAVE_ENDPOINT,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
          const body = await parseJsonRequest(request)
          if (!body) {
            return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400)
          }
          const result = store.save(body)
          if (!result.ok) {
            return jsonResponse(result, 400)
          }
          return jsonResponse({ ok: true, state: result.state })
        },
      }),
      connection.fetch.register({
        path: RESET_ENDPOINT,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
          const body = await parseJsonRequest(request)
          const mode = body?.mode === 'official' ? 'official' : 'default'
          return jsonResponse(store.reset(mode))
        },
      }),
    ]
    ctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'custom-theme: http routes')
  })
}
