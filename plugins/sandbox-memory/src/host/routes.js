export const STATE_ENDPOINT = '/api/sandbox-memory.state'
export const CREATE_ENDPOINT = '/api/sandbox-memory.create'
export const UPDATE_ENDPOINT = '/api/sandbox-memory.update'
export const DELETE_ENDPOINT = '/api/sandbox-memory.delete'
export const CLEAR_ENDPOINT = '/api/sandbox-memory.clear'
export const SETTINGS_ENDPOINT = '/api/sandbox-memory.settings'
export const ENV_REFRESH_ENDPOINT = '/api/sandbox-memory.env-refresh'
export const EXPORT_ENDPOINT = '/api/sandbox-memory.export'
export const IMPORT_ENDPOINT = '/api/sandbox-memory.import'
export const SEARCH_ENDPOINT = '/api/sandbox-memory.search'

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

export function registerBrowserRoutes(ctx, service) {
  ctx.inject(['connection'], ({ connection }) => {
    const postRoutes = [
      {
        path: CREATE_ENDPOINT,
        validate: (body) => (body && (body.content || body.summary || body.title)
          ? null
          : 'title, summary, or content is required'),
        run: (body) => service.saveMemory({
          title: body.title,
          summary: body.summary,
          content: body.content,
          category: body.category,
          tags: body.tags,
          pinned: Boolean(body.pinned),
          enabled: body.enabled !== false,
          source: 'manual',
          dedupeKey: body.dedupeKey || '',
        }),
      },
      {
        path: UPDATE_ENDPOINT,
        validate: (body) => (body && body.id ? null : 'id is required'),
        run: (body) => service.updateMemory(body.id, {
          title: body.title,
          summary: body.summary,
          content: body.content,
          category: body.category,
          tags: body.tags,
          pinned: body.pinned,
          enabled: body.enabled,
        }, { isManual: true }),
      },
      {
        path: DELETE_ENDPOINT,
        validate: (body) => (body && body.id ? null : 'id is required'),
        run: (body) => service.deleteMemory(body.id),
      },
      {
        path: CLEAR_ENDPOINT,
        optionalBody: true,
        run: (body) => service.clearMemories(body?.source || 'auto'),
      },
      {
        path: SETTINGS_ENDPOINT,
        validate: (body) => (body && typeof body === 'object' ? null : 'Invalid settings payload'),
        run: (body) => service.updateSettings(body.settings || body),
      },
      {
        path: ENV_REFRESH_ENDPOINT,
        optionalBody: true,
        run: (body) => service.refreshEnvironment({ forceToolchains: Boolean(body?.forceToolchains) }),
      },
      {
        path: IMPORT_ENDPOINT,
        validate: (body) => (body && (body.payload || Array.isArray(body.memories))
          ? null
          : 'Import payload is required'),
        run: (body) => service.importMemories(body.payload || body, { mode: body.mode || 'merge' }),
      },
    ]

    const disposers = [
      connection.fetch.register({
        path: STATE_ENDPOINT,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch(request) {
          const currentRev = service.getRevision()
          let sinceRev = ''
          try {
            sinceRev = new URL(request.url, 'http://localhost').searchParams.get('rev') || ''
          } catch {}
          if (sinceRev && Number(sinceRev) === currentRev) {
            return jsonResponse({ ok: true, unchanged: true, rev: currentRev })
          }
          return jsonResponse({
            ok: true,
            rev: currentRev,
            state: service.getStateSnapshot(),
          })
        },
      }),
      connection.fetch.register({
        path: EXPORT_ENDPOINT,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch() {
          return jsonResponse({
            ok: true,
            data: service.store.exportData(),
          })
        },
      }),
      connection.fetch.register({
        path: SEARCH_ENDPOINT,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch(request) {
          let q = ''
          let category = ''
          let source = ''
          let limit = 30
          try {
            const u = new URL(request.url, 'http://localhost')
            q = u.searchParams.get('q') || ''
            category = u.searchParams.get('category') || ''
            source = u.searchParams.get('source') || ''
            const rawLimit = Number(u.searchParams.get('limit'))
            if (Number.isFinite(rawLimit) && rawLimit > 0) limit = Math.min(100, rawLimit)
          } catch {}
          const results = service.store.search(q, {
            category,
            source,
            includeDisabled: true,
            limit,
          })
          return jsonResponse({ ok: true, results })
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
            const result = await spec.run(body || {})
            const errStatus = Number.isInteger(result?.status) ? result.status : 400
            return jsonResponse(result, result?.ok === false ? errStatus : 200)
          },
        }),
      ),
    ]

    ctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'sandbox-memory: browser api routes')
  })
}
