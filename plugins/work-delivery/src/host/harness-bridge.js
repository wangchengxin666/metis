import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

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

export const WORK_DELIVERY_TOOL_NAMES = [
  'delivery_overview',
  'delivery_task_create',
]

export function buildStandingGuide() {
  return [
    '## Work & Delivery Hub (工作与交付)',
    'Users create deliverables conversationally in chat and view/approve them in the "Work & Delivery" sidebar:',
    '- Online pages (`sandbox-expose`) and background services (`sandbox-service`) created via shell (see `sandbox-services` skill) appear live in Work & Delivery automatically. Recurring AI schedules belong in DSH native Automations (`schedule` tool).',
    '- Team tasks & approvals use `sandbox-mesh` (`mesh_dispatch_tasks`, `mesh_task_update`, `mesh_request_approval`); for quick solo personal tasks outside a group, use `delivery_task_create`.',
    '- Call `delivery_overview()` whenever you need a single compact view of all current tasks, pending approvals, published pages, and services.',
  ].join('\n')
}

export function buildWorkDeliverySkillMarkdown(service) {
  const snap = service.getStateSnapshot()
  return [
    '# Work & Delivery Hub Skill',
    '',
    `Current status: ${snap.active_tasks_count} active tasks (${snap.pending_approvals.length} pending approvals), ${snap.exposed_apps.length} published pages, ${snap.user_services.length} background services.`,
    '',
    buildStandingGuide(),
  ].join('\n')
}

export function wireHarnessRuntime(ctx, service, { logger = null } = {}) {
  let primitivesPromise = null
  const getPrimitives = () => {
    primitivesPromise ??= loadHarnessToolPrimitives()
    return primitivesPromise
  }

  if (typeof ctx.inject !== 'function') return

  // 1. Register compact standing guide (zero duplication with sandbox-services / sandbox-mesh)
  ctx.inject(['systemPrompt'], (spCtx) => {
    const sp = spCtx.systemPrompt ?? spCtx.get?.('systemPrompt')
    if (!sp || typeof sp.section !== 'function') return
    let disposeGuide = null
    try {
      disposeGuide = sp.section({
        name: 'work-delivery:guide',
        order: 87,
        interpolate: false,
        text: () => buildStandingGuide(),
      })
    } catch (err) {
      logger?.warn?.(`Failed to register systemPrompt guide: ${err?.message || err}`)
    }
    spCtx.effect(() => () => {
      try { disposeGuide?.() } catch {}
    }, 'work-delivery: systemPrompt guide')
  })

  // 2. Register lightweight runtime Skill Provider
  ctx.inject(['skills'], (skillCtx) => {
    const skillsSvc = skillCtx.skills ?? skillCtx.get?.('skills')
    if (!skillsSvc || typeof skillsSvc.registerProvider !== 'function') return
    try {
      const disposeProvider = skillsSvc.registerProvider({
        name: 'work-delivery-skill-provider',
        async list() {
          return [
            {
              name: 'work-delivery',
              description: 'Inspect current Work & Delivery items (tasks, approvals, published pages, services) or capture a personal task.',
              whenToUse: 'Use when summarizing current deliverables/tasks/services or capturing a solo personal task outside a project group.',
              invocation: { modelInvocable: true, userInvocable: true },
              source: 'runtime',
              provider: 'work-delivery-skill-provider',
              rank: 185,
              locator: 'work-delivery',
            },
          ]
        },
        async get() {
          return {
            name: 'work-delivery',
            description: 'Inspect current Work & Delivery items (tasks, approvals, published pages, services) or capture a personal task.',
            whenToUse: 'Use when summarizing current deliverables/tasks/services or capturing a solo personal task outside a project group.',
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'runtime',
            provider: 'work-delivery-skill-provider',
            content: buildWorkDeliverySkillMarkdown(service),
          }
        },
      })
      skillCtx.effect(() => () => {
        try { disposeProvider?.() } catch {}
      }, 'work-delivery: skill provider')
    } catch {}
  })

  // 3. Register ONLY 2 non-overlapping native tools (creation of expose/cron/service uses sandbox-services CLI; group tasks use sandbox-mesh)
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

      reg({
        name: 'delivery_overview',
        description: 'Inspect current Work & Delivery Hub summary: active tasks, pending human approvals, published online web pages, shared files, and background services.',
        parameters: {},
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, val) => {
            const s = val?.state || {}
            const lines = [
              `Work & Delivery Overview (@${s.slug || 'sandbox'}${s.role ? ` · ${s.role}` : ''})`,
              `- Tasks: ${s.active_tasks_count || 0} active, ${s.done_tasks_count || 0} done, ${(s.pending_approvals || []).length} pending approval`,
              `- Published Pages (${(s.exposed_apps || []).length}): ${(s.exposed_apps || []).map((a) => `${a.name} -> ${a.url || a.mount_path}`).join('; ') || 'none'}`,
              `- Background Services (${(s.user_services || []).length}): ${(s.user_services || []).map((sv) => `${sv.name} (${sv.status})`).join('; ') || 'none'}`,
            ]
            return [{ type: 'text', text: lines.join('\n') }]
          },
        },
        async execute() {
          return { ok: true, state: service.getStateSnapshot() }
        },
        presentCall: () => ({
          card: 'generic',
          title: 'Inspect Work & Delivery overview',
          kind: 'other',
        }),
      })

      reg({
        name: 'delivery_task_create',
        description: 'Capture a personal work task in the Work & Delivery dashboard (optionally requiring human approval). Use sandbox-mesh tools for multi-agent group tasks.',
        parameters: {
          title: {
            type: 'string',
            required: true,
            description: 'Concise task title.',
          },
          description: {
            type: 'string',
            description: 'Optional task details or acceptance criteria.',
          },
          priority: {
            type: 'string',
            description: 'One of: low, normal, high, urgent (default normal).',
          },
          approvalRequired: {
            type: 'boolean',
            description: 'Set true if human sign-off is required.',
          },
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (args, val) => {
            if (!val?.ok) return [{ type: 'text', text: `Failed to create task: ${val?.error || 'unknown error'}` }]
            return [{
              type: 'text',
              text: `Created task #${val.task_id}: "${args?.title || ''}"${args?.approvalRequired ? ' (pending human approval)' : ''}`,
            }]
          },
        },
        async execute(args) {
          return service.createTask({
            title: args?.title,
            description: args?.description || '',
            priority: args?.priority || 'normal',
            approvalRequired: Boolean(args?.approvalRequired),
          })
        },
        presentCall: (args) => ({
          card: 'generic',
          title: `Capture task: ${args?.title || ''}`,
          kind: 'other',
          rawInput: String(args?.description || args?.title || '').slice(0, 200),
        }),
      })
    })().catch((err) => {
      logger?.warn?.(`Failed to register work-delivery tools: ${err?.message || err}`)
    })

    toolCtx.effect(() => () => {
      disposed = true
      for (const d of disposers) {
        try { d() } catch {}
      }
    }, 'work-delivery: harness tools')
  })
}
