export const STATE_ENDPOINT = '/api/work-delivery.state'
export const TASK_CREATE_ENDPOINT = '/api/work-delivery.task-create'
export const TASK_STATUS_ENDPOINT = '/api/work-delivery.task-status'
export const TASK_APPROVE_ENDPOINT = '/api/work-delivery.task-approve'
export const APP_EXPOSE_ENDPOINT = '/api/work-delivery.app-expose'
export const APP_UNEXPOSE_ENDPOINT = '/api/work-delivery.app-unexpose'
export const CRON_ADD_ENDPOINT = '/api/work-delivery.cron-add'
export const CRON_REMOVE_ENDPOINT = '/api/work-delivery.cron-remove'
export const SERVICE_ACTION_ENDPOINT = '/api/work-delivery.service-action'
export const SERVICE_ADD_ENDPOINT = '/api/work-delivery.service-add'
export const SERVICE_REMOVE_ENDPOINT = '/api/work-delivery.service-remove'
export const SERVICE_LOGS_ENDPOINT = '/api/work-delivery.service-logs'

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
        path: TASK_CREATE_ENDPOINT,
        validate: (body) => (body && body.title ? null : 'title is required'),
        run: (body) => service.createTask({
          title: body.title,
          description: body.description || '',
          priority: body.priority || 'normal',
          roomId: body.roomId || '',
          approvalRequired: Boolean(body.approvalRequired),
        }),
      },
      {
        path: TASK_STATUS_ENDPOINT,
        validate: (body) => (body && body.taskId && body.status ? null : 'taskId and status are required'),
        run: (body) => service.updateTaskStatus({
          taskId: body.taskId,
          status: body.status,
          roomId: body.roomId || '',
        }),
      },
      {
        path: TASK_APPROVE_ENDPOINT,
        validate: (body) => (body && body.taskId && body.decision ? null : 'taskId and decision are required'),
        run: (body) => service.decideApproval({
          taskId: body.taskId,
          decision: body.decision,
          roomId: body.roomId || '',
        }),
      },
      {
        path: APP_EXPOSE_ENDPOINT,
        validate: (body) => (body && body.name && body.port != null ? null : 'name and port are required'),
        run: (body) => service.exposeApp({ name: body.name, port: body.port }),
      },
      {
        path: APP_UNEXPOSE_ENDPOINT,
        validate: (body) => (body && body.name ? null : 'name is required'),
        run: (body) => service.unexposeApp({ name: body.name }),
      },
      {
        path: CRON_ADD_ENDPOINT,
        validate: (body) => (body && body.schedule && body.command ? null : 'schedule and command are required'),
        run: (body) => service.addCronJob({ schedule: body.schedule, command: body.command }),
      },
      {
        path: CRON_REMOVE_ENDPOINT,
        validate: (body) => (body && body.raw ? null : 'raw is required'),
        run: (body) => service.removeCronJob({ raw: body.raw }),
      },
      {
        path: SERVICE_ACTION_ENDPOINT,
        validate: (body) => (body && body.name && body.action ? null : 'name and action are required'),
        run: (body) => service.controlService({ name: body.name, action: body.action }),
      },
      {
        path: SERVICE_ADD_ENDPOINT,
        validate: (body) => (body && body.name && body.command ? null : 'name and command are required'),
        run: (body) => service.addService({ name: body.name, command: body.command }),
      },
      {
        path: SERVICE_REMOVE_ENDPOINT,
        validate: (body) => (body && body.name ? null : 'name is required'),
        run: (body) => service.removeService({ name: body.name }),
      },
    ]

    const disposers = [
      connection.fetch.register({
        path: STATE_ENDPOINT,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch() {
          return jsonResponse({
            ok: true,
            state: service.getStateSnapshot(),
          })
        },
      }),
      connection.fetch.register({
        path: SERVICE_LOGS_ENDPOINT,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch(request) {
          let name = ''
          let tail = 120
          try {
            const u = new URL(request.url, 'http://localhost')
            name = u.searchParams.get('name') || ''
            tail = Number(u.searchParams.get('tail')) || 120
          } catch {}
          if (!name) return jsonResponse({ ok: false, error: 'name is required' }, 400)
          const res = service.readServiceLogs({ name, tail })
          const errStatus = Number.isInteger(res?.status) ? res.status : 400
          return jsonResponse(res, res?.ok === false ? errStatus : 200)
        },
      }),
      ...postRoutes.map((spec) =>
        connection.fetch.register({
          path: spec.path,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            const body = await parseJsonRequest(request)
            if (!body || typeof body !== 'object') {
              return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400)
            }
            const errMsg = spec.validate ? spec.validate(body) : null
            if (errMsg) {
              return jsonResponse({ ok: false, error: errMsg }, 400)
            }
            const result = await spec.run(body)
            const errStatus = Number.isInteger(result?.status) ? result.status : 400
            return jsonResponse(result, result?.ok === false ? errStatus : 200)
          },
        }),
      ),
    ]

    ctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'work-delivery: browser api routes')
  })
}
