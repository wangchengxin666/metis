import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { MEMORY_CATEGORIES } from '../shared/model.js'
import { createTurnAutoCaptureObserver } from './auto-capture.js'

const GLOBAL_DSH_NM = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'

async function importDshPkg(pkgShortName, fullPkgName) {
  try {
    return await import(fullPkgName)
  } catch {
    const candidate = `${GLOBAL_DSH_NM}/${pkgShortName}/lib/index.js`
    if (existsSync(candidate)) {
      return import(pathToFileURL(candidate).href)
    }
    return null
  }
}

export async function loadHarnessToolPrimitives() {
  const toolsMod = await importDshPkg('dsh-tools', '@deepseek-ai/dsh-tools')
  return {
    defineTool: toolsMod?.defineTool || ((spec) => spec),
  }
}

export function buildMemorySkillMarkdown(service) {
  const snap = service.getStateSnapshot()
  const stats = snap.stats || {}
  const budget = snap.preview?.budget || {}
  return [
    '# Sandbox Memory & Environment Skill',
    '',
    `Current Memory Center status: ${stats.enabled || 0} active memories (${stats.pinned || 0} pinned), ~${budget.totalTokens || 0} injected tokens.`,
    '',
    '## Native Tools',
    '- `memory_search(query, category?, limit?)` — Search all cross-session memories using CJK-aware BM25 ranking.',
    '- `memory_get(ids)` — Fetch full Markdown details for one or more memory IDs seen in the Memory Index.',
    '- `memory_save(title, summary, content, category?, tags?, pinned?, dedupeKey?)` — Persist durable user preferences, project facts, environment configs, workflows, or pitfalls (auto-deduplicated & secret-scrubbed).',
    '- `memory_update(id, ...)` — Update an existing memory when facts/ports/preferences change.',
    '- `memory_delete(id)` — Remove an obsolete or incorrect memory.',
    '- `env_snapshot(refresh?)` — Inspect the live sandbox environment (public URLs, toolchains, `/home/workspace` projects, `sandbox-service` daemons, `sandbox-expose` routes, and `sandbox-cron` jobs).',
    '',
    '## Best Practices',
    '- Never write API keys, tokens, passwords, or private keys into memory.',
    '- Keep `summary` to one crisp line (≤ 120 chars) so the always-visible index stays lean.',
    '- Prefer updating an existing memory over creating duplicates when a port, URL, or rule changes.',
  ].join('\n')
}

export function wireHarnessRuntime(ctx, service, { logger = null } = {}) {
  let primitivesPromise = null
  const getPrimitives = () => {
    primitivesPromise ??= loadHarnessToolPrimitives()
    return primitivesPromise
  }

  if (typeof ctx.inject !== 'function') return

  // 1. Register KV-Cache-friendly System Prompt Section (static guide) + Cache-Safe Prompt Context (env snapshot + bounded index)
  ctx.inject(['systemPrompt'], (spCtx) => {
    const sp = spCtx.systemPrompt ?? spCtx.get?.('systemPrompt')
    if (!sp) return
    const disposers = []
    try {
      if (typeof sp.section === 'function') {
        const dGuide = sp.section({
          name: 'sandbox-memory:guide',
          order: 85,
          interpolate: false,
          text: () => service.getStandingGuide(),
        })
        if (typeof dGuide === 'function') disposers.push(dGuide)
      }
      if (typeof sp.context === 'function') {
        const dContext = sp.context({
          name: 'sandbox-memory:context',
          order: 40,
          interpolate: false,
          text: () => service.getInjectedContext(),
        })
        if (typeof dContext === 'function') disposers.push(dContext)
      } else if (typeof sp.section === 'function') {
        // Graceful fallback if host runtime only provides section()
        const dFallback = sp.section({
          name: 'sandbox-memory:context',
          order: 86,
          interpolate: false,
          text: () => service.getInjectedContext(),
        })
        if (typeof dFallback === 'function') disposers.push(dFallback)
      }
    } catch (err) {
      logger?.warn?.(`Failed to register systemPrompt hooks: ${err?.message || err}`)
    }
    spCtx.effect(() => () => {
      for (const d of disposers) {
        try { d() } catch {}
      }
    }, 'sandbox-memory: systemPrompt hooks')
  })

  // 2. Register dynamic Skill Provider for discoverability
  ctx.inject(['skills'], (skillCtx) => {
    const skillsSvc = skillCtx.skills ?? skillCtx.get?.('skills')
    if (!skillsSvc || typeof skillsSvc.registerProvider !== 'function') return
    try {
      let controlRef = null
      const disposeProvider = skillsSvc.registerProvider(
        {
          name: 'sandbox-memory-skill-provider',
          async list() {
            const stats = service.store.getStats()
            return [
              {
                name: 'sandbox-memory',
                description: `Persistent cross-session memory & live sandbox environment awareness (${stats.enabled} active memories).`,
                whenToUse: 'Use when recalling user preferences, past project conventions, sandbox services/routes/toolchains, or saving/updating durable facts.',
                invocation: { modelInvocable: true, userInvocable: true },
                source: 'runtime',
                provider: 'sandbox-memory-skill-provider',
                rank: 190,
                locator: 'sandbox-memory',
              },
            ]
          },
          async get() {
            const stats = service.store.getStats()
            return {
              name: 'sandbox-memory',
              description: `Persistent cross-session memory & live sandbox environment awareness (${stats.enabled} active memories).`,
              whenToUse: 'Use when recalling user preferences, past project conventions, sandbox services/routes/toolchains, or saving/updating durable facts.',
              invocation: { modelInvocable: true, userInvocable: true },
              source: 'runtime',
              provider: 'sandbox-memory-skill-provider',
              content: buildMemorySkillMarkdown(service),
            }
          },
        },
        (ctrl) => {
          controlRef = ctrl
        },
      )
      const offChange = service.onChange?.(() => {
        try { controlRef?.invalidate?.() } catch {}
      })
      skillCtx.effect(() => () => {
        offChange?.()
        disposeProvider?.()
      }, 'sandbox-memory: dynamic skill provider')
    } catch {}
  })

  // 3. Register 6 first-class Harness Tools (lazy recall + auto-write + live env inspection)
  ctx.inject(['tools'], (toolCtx) => {
    let disposed = false
    const disposers = []

    void (async () => {
      const { defineTool } = await getPrimitives()
      if (disposed || !toolCtx.tools || typeof toolCtx.tools.register !== 'function') return

      const reg = (spec) => {
        const d = toolCtx.tools.register(defineTool(spec))
        if (typeof d === 'function') disposers.push(d)
      }

      // Tool 1: memory_save
      reg({
        name: 'memory_save',
        description:
          'Save or update a durable cross-session memory (user preference, project fact, environment setup, workflow rule, or pitfall). Automatically deduplicates and redacts secrets. Keep summary to one concise line.',
        parameters: {
          title: {
            type: 'string',
            required: true,
            description: 'Short descriptive title (e.g., "Frontend Package Manager Preference").',
          },
          summary: {
            type: 'string',
            description: 'Concise one-line summary shown in the compact Memory Index (<= 140 chars).',
          },
          content: {
            type: 'string',
            required: true,
            description: 'Full detailed markdown note fetched on demand via memory_get. Never include secrets/passwords/API keys.',
          },
          category: {
            type: 'string',
            description: `One of: ${MEMORY_CATEGORIES.join(', ')}. Defaults to "fact".`,
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional short tags for faster filtering (e.g., ["yarn", "frontend"]).',
          },
          pinned: {
            type: 'boolean',
            description: 'Pin high-priority memory so it always remains at the top of the Memory Index.',
          },
          dedupeKey: {
            type: 'string',
            description: 'Optional stable key (e.g., "proj:billing-api") so repeated saves update in place.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
          },
          render: (_args, val) => {
            if (!val?.ok) {
              return [{ type: 'text', text: `memory_save failed: ${val?.error || 'unknown error'}` }]
            }
            const e = val.entry || {}
            const redactNote = val.redacted ? ' (sensitive tokens redacted)' : ''
            return [{
              type: 'text',
              text: `${val.action === 'updated' ? 'Updated' : 'Saved'} memory [${e.id}] (${e.category}): "${e.title}" — ${e.summary}${redactNote}`,
            }]
          },
        },
        async execute(args, execCtx) {
          return service.saveMemory({
            title: args?.title,
            summary: args?.summary,
            content: args?.content,
            category: args?.category || 'fact',
            tags: args?.tags || [],
            pinned: Boolean(args?.pinned),
            dedupeKey: args?.dedupeKey || '',
            source: 'agent',
            sessionId: execCtx?.sessionId || execCtx?.session?.id || '',
          })
        },
      })

      // Tool 2: memory_search
      reg({
        name: 'memory_search',
        description:
          'Search stored cross-session memories using CJK-aware BM25 ranking. Returns concise matching summaries and IDs (call memory_get for full body).',
        parameters: {
          query: {
            type: 'string',
            description: 'Keywords or phrase to search (Chinese or English). Leave empty to list top recent/pinned memories.',
          },
          category: {
            type: 'string',
            description: `Optional category filter (${MEMORY_CATEGORIES.join(', ')}).`,
          },
          tag: {
            type: 'string',
            description: 'Optional exact tag filter.',
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return (default 8, max 25).',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
          },
          render: (_args, val) => {
            const matches = Array.isArray(val?.matches) ? val.matches : []
            if (matches.length === 0) {
              return [{ type: 'text', text: 'No matching memories found.' }]
            }
            const lines = matches.map((m) =>
              `- [${m.id}|${m.category}${m.pinned ? '|pinned' : ''}] ${m.title} — ${m.summary}${m.tags?.length ? ` (${m.tags.join(', ')})` : ''}`,
            )
            return [{ type: 'text', text: `Found ${matches.length} memory match(es):\n${lines.join('\n')}` }]
          },
        },
        async execute(args) {
          const limit = Math.max(1, Math.min(25, Number(args?.limit) || 8))
          const ranked = service.store.search(
            args?.query || '',
            {
              category: args?.category || '',
              tag: args?.tag || '',
              includeDisabled: false,
              limit,
            },
            { trackSearch: true },
          )
          return {
            ok: true,
            count: ranked.length,
            matches: ranked.map(({ entry, score }) => ({
              id: entry.id,
              title: entry.title,
              summary: entry.summary,
              category: entry.category,
              tags: entry.tags,
              source: entry.source,
              pinned: entry.pinned,
              score,
              updatedAt: entry.updatedAt,
            })),
          }
        },
      })

      // Tool 3: memory_get
      reg({
        name: 'memory_get',
        description: 'Read the full detailed content of one or more memories by ID.',
        parameters: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            required: true,
            description: 'Array of memory IDs (e.g., ["mem_a1b2c3d4e5"]).',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
          },
          render: (_args, val) => {
            const entries = Array.isArray(val?.entries) ? val.entries : []
            if (entries.length === 0) {
              return [{ type: 'text', text: 'No memories found for the requested IDs.' }]
            }
            const blocks = entries.map((e) => [
              `### [${e.id}] ${e.title} (${e.category}, source: ${e.source})`,
              e.tags?.length ? `Tags: ${e.tags.join(', ')}` : '',
              e.content,
            ].filter(Boolean).join('\n'))
            return [{ type: 'text', text: blocks.join('\n\n---\n\n') }]
          },
        },
        async execute(args) {
          const ids = Array.isArray(args?.ids) ? args.ids : (args?.id ? [args.id] : [])
          const entries = service.store.getMany(ids, { trackAccess: true })
          return { ok: true, count: entries.length, entries }
        },
      })

      // Tool 4: memory_update
      reg({
        name: 'memory_update',
        description: 'Update an existing memory by ID when information changes or needs correction.',
        parameters: {
          id: { type: 'string', required: true, description: 'Memory ID to update.' },
          title: { type: 'string', description: 'Updated title.' },
          summary: { type: 'string', description: 'Updated concise one-line summary.' },
          content: { type: 'string', description: 'Updated full markdown content.' },
          category: { type: 'string', description: `Updated category (${MEMORY_CATEGORIES.join(', ')}).` },
          tags: { type: 'array', items: { type: 'string' }, description: 'Updated tags.' },
          pinned: { type: 'boolean', description: 'Pin or unpin this memory.' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
          },
          render: (_args, val) => {
            if (!val?.ok) return [{ type: 'text', text: `memory_update failed: ${val?.error || 'not found'}` }]
            const e = val.entry || {}
            return [{ type: 'text', text: `Updated memory [${e.id}] (${e.category}): "${e.title}" — ${e.summary}` }]
          },
        },
        async execute(args) {
          return service.updateMemory(args?.id, {
            title: args?.title,
            summary: args?.summary,
            content: args?.content,
            category: args?.category,
            tags: args?.tags,
            pinned: args?.pinned,
          })
        },
      })

      // Tool 5: memory_delete
      reg({
        name: 'memory_delete',
        description: 'Delete an outdated or incorrect memory by ID.',
        parameters: {
          id: { type: 'string', required: true, description: 'Memory ID to delete.' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
          },
          render: (_args, val) => {
            if (!val?.ok) return [{ type: 'text', text: `memory_delete failed: ${val?.error || 'not found'}` }]
            return [{ type: 'text', text: `Deleted memory [${val.removed?.id}] ("${val.removed?.title || ''}").` }]
          },
        },
        async execute(args) {
          return service.deleteMemory(args?.id)
        },
      })

      // Tool 6: env_snapshot
      reg({
        name: 'env_snapshot',
        description:
          'Refresh and inspect the live sandbox environment snapshot: public URLs, installed toolchains, /home/workspace projects, sandbox-service daemons, sandbox-expose routes, and sandbox-cron jobs.',
        parameters: {
          refresh: {
            type: 'boolean',
            description: 'Force a live rescan before returning (default true).',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
          },
          render: (_args, val) => {
            const snap = val?.snapshot
            if (!snap) return [{ type: 'text', text: 'Sandbox environment snapshot unavailable.' }]
            const info = snap.info || {}
            const lines = [
              `Sandbox: slug=${info.slug || 'local'}, home=${info.homeDir || '/home/workspace'}`,
              info.publicUrl ? `Public URL: ${info.publicUrl}` : '',
              info.appsBaseUrl ? `Apps Base: ${info.appsBaseUrl}<name>/ | Port Proxy: ${info.portProxyBaseUrl}<port>/` : '',
              `Toolchains (${(snap.toolchains || []).length}): ${(snap.toolchains || []).map((t) => `${t.name}@${t.version}`).join(', ') || '(none)'}`,
              `Projects (${(snap.projects || []).length}): ${(snap.projects || []).map((p) => (p.stacks?.length ? `${p.name} [${p.stacks.join(', ')}]` : p.name)).join(', ') || '(none)'}`,
              `Services (${(snap.services || []).length}): ${(snap.services || []).map((s) => `${s.name} (${s.status}) -> ${s.command}`).join(' | ') || '(none)'}`,
              `Exposed Routes (${(snap.routes || []).length}): ${(snap.routes || []).map((r) => `${r.name} -> ${r.target} (${r.publicUrl})`).join(' | ') || '(none)'}`,
              `Cron Jobs (${(snap.cron || []).length}): ${(snap.cron || []).join(' ; ') || '(none)'}`,
            ].filter(Boolean)
            return [{ type: 'text', text: lines.join('\n') }]
          },
        },
        async execute(args) {
          const shouldRefresh = args?.refresh !== false
          const snapshot = shouldRefresh
            ? await service.envScanner.refresh({ forceToolchains: false })
            : service.envScanner.getCachedSnapshot()
          return { ok: true, snapshot }
        },
      })
    })().catch((err) => {
      logger?.warn?.(`Failed to register sandbox-memory tools: ${err?.message || err}`)
    })

    toolCtx.effect(() => () => {
      disposed = true
      for (const d of disposers) {
        try { d() } catch {}
      }
    }, 'sandbox-memory: native harness tools')
  })

  // 4. Zero-Token Turn-End Auto-Capture Observer on `session/event`
  if (typeof ctx.on === 'function') {
    const observer = createTurnAutoCaptureObserver({
      store: service.store,
      envScanner: service.envScanner,
      logger,
    })
    const offSessionEvent = ctx.on('session/event', (a, b) => {
      try {
        observer.handleSessionEvent(a, b)
      } catch (err) {
        logger?.warn?.(`session/event observer error: ${err?.message || err}`)
      }
    })
    ctx.effect?.(() => () => {
      observer.reset()
      if (typeof offSessionEvent === 'function') offSessionEvent()
    }, 'sandbox-memory: session auto-capture observer')
  }
}
