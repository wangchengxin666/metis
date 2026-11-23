import { createWorkDeliveryService } from './src/host/service.js'
import {
  APP_EXPOSE_ENDPOINT,
  APP_UNEXPOSE_ENDPOINT,
  SERVICE_ACTION_ENDPOINT,
  SERVICE_ADD_ENDPOINT,
  SERVICE_LOGS_ENDPOINT,
  SERVICE_REMOVE_ENDPOINT,
  STATE_ENDPOINT,
  TASK_APPROVE_ENDPOINT,
  TASK_CREATE_ENDPOINT,
  TASK_STATUS_ENDPOINT,
  registerBrowserRoutes,
} from './src/host/routes.js'
import {
  WORK_DELIVERY_TOOL_NAMES,
  buildStandingGuide,
  buildWorkDeliverySkillMarkdown,
  wireHarnessRuntime,
} from './src/host/harness-bridge.js'

export const name = 'work-delivery'

export {
  STATE_ENDPOINT,
  TASK_CREATE_ENDPOINT,
  TASK_STATUS_ENDPOINT,
  TASK_APPROVE_ENDPOINT,
  APP_EXPOSE_ENDPOINT,
  APP_UNEXPOSE_ENDPOINT,
  SERVICE_ACTION_ENDPOINT,
  SERVICE_ADD_ENDPOINT,
  SERVICE_REMOVE_ENDPOINT,
  SERVICE_LOGS_ENDPOINT,
  WORK_DELIVERY_TOOL_NAMES,
  buildStandingGuide,
  buildWorkDeliverySkillMarkdown,
  createWorkDeliveryService,
}

export function apply(ctx) {
  const logger = ctx.logger ? ctx.logger('work-delivery') : null
  const service = createWorkDeliveryService({ logger })
  registerBrowserRoutes(ctx, service)
  wireHarnessRuntime(ctx, service, { logger })
}
