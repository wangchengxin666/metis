import assert from 'node:assert/strict'
import { importExternal } from './deps.mjs'
import { createWorkDeliveryController } from '../src/client/controller.js'
import { createWorkDeliveryPage } from '../src/client/page.js'
import { createWorkDeliveryToolView } from '../src/client/tool-views.js'

const reactMod = await importExternal('react')
const React = reactMod.default || reactMod
const rdsMod = await importExternal('react-dom/server')
const renderToStaticMarkup = rdsMod.renderToStaticMarkup || rdsMod.default?.renderToStaticMarkup

const manyTasks = Array.from({ length: 15 }, (_, idx) => ({
  id: `tsk_${idx + 1}`,
  room_id: 'grp_1',
  title: `Deliverable Task #${idx + 1}`,
  description: `Detailed notes for task ${idx + 1}`,
  status: idx < 5 ? 'open' : 'done',
  priority: 'normal',
  assignee_slug: 'lead',
}))

const mockState = {
  slug: 'lead',
  role: 'Tech Lead',
  description: 'Architecture & Delivery',
  sop: 'Run tests before release',
  exposed_apps: [
    { name: 'demo', target: '127.0.0.1:5173', mount_path: '/s/lead/apps/demo/', url: 'http://localhost:9000/s/lead/apps/demo/' },
  ],
  user_services: [],
  shared_files: [{ name: 'TEAM_README.md', size_bytes: 256 }],
  token_usage: { estimated_tokens: 1200, sessions_count: 3, messages_count: 8 },
  peers: [{ slug: 'qa', role: 'QA Engineer' }],
  groups: [{ id: 'grp_1', name: 'Core Team', member_count: 3 }],
  tasks: manyTasks,
  active_tasks_count: 5,
  done_tasks_count: 10,
  pending_approvals: [{ id: 'tsk_1', room_id: 'grp_1', title: 'Deliverable Task #1', assignee_slug: 'lead' }],
}

const ctrl = createWorkDeliveryController({
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() { return { ok: true, state: mockState } },
  }),
})
await ctrl.syncFromHost()
assert.equal(ctrl.getSnapshot().state.tasks.length, 15)

const Page = createWorkDeliveryPage({
  React,
  controller: ctrl,
  getLocale: () => 'zh-CN',
  subscribeLocale: () => () => {},
})
const html = renderToStaticMarkup(React.createElement(Page))
assert.ok(html.includes('工作与交付中心'))
assert.ok(html.includes('demo'))
assert.ok(html.includes('Deliverable Task #1'))
// Pagination caps initial list at 8 tasks and shows remaining 7
assert.ok(!html.includes('Deliverable Task #12'))
assert.ok(html.includes('剩余 7 条'))
assert.ok(html.includes('TEAM_README.md'))
// Scheduled tasks are owned by DSH native Automations (dsh-schedule), not duplicated here
assert.ok(!html.includes('定时事务'))

// Render AI chat tool views with DSH 0.2.3 PartialArguments & expanded structured views
const makePartialArgs = (obj) => ({
  keys() { return Object.keys(obj) },
  text(k) { return typeof obj[k] === 'string' ? obj[k] : undefined },
  value(k) { return typeof obj[k] === 'string' ? undefined : obj[k] },
})
const expandedDisclosure = () => ({ expanded: true, toggle() {} })
const ToolView = createWorkDeliveryToolView({
  React,
  getLocale: () => 'zh-CN',
  subscribeLocale: () => () => {},
})
const toolHtml = renderToStaticMarkup(
  React.createElement(ToolView, {
    callId: 'wd1',
    toolName: 'delivery_task_create',
    phase: 'result',
    useDisclosure: expandedDisclosure,
    block: {
      kind: 'tool-result',
      call: {
        name: 'delivery_task_create',
        args: makePartialArgs({ title: 'Prepare Q4 review', description: 'Check KPI metrics', priority: 'high', approvalRequired: true }),
      },
      content: [{ type: 'text', text: 'Created task #tsk_1: "Prepare Q4 review" (pending human approval)' }],
      isError: false,
    },
  }),
)
assert.ok(toolHtml.includes('记录工作任务'))
assert.ok(toolHtml.includes('Prepare Q4 review'))
assert.ok(toolHtml.includes('需人工审批'))
assert.ok(toolHtml.includes('Check KPI metrics'))
assert.ok(!toolHtml.includes('text(k)'))

const overviewHtml = renderToStaticMarkup(
  React.createElement(ToolView, {
    callId: 'wd2',
    toolName: 'delivery_overview',
    phase: 'result',
    useDisclosure: expandedDisclosure,
    block: {
      kind: 'tool-result',
      call: { name: 'delivery_overview', args: makePartialArgs({}) },
      content: [{
        type: 'text',
        text: [
          'Work & Delivery Overview (@lead · Tech Lead)',
          '- Tasks: 5 active, 10 done, 1 pending approval',
          '- Published Pages (1): demo -> http://localhost:9000/s/lead/apps/demo/',
          '- Background Services (1): api (running)',
        ].join('\n'),
      }],
    },
  }),
)
assert.ok(overviewHtml.includes('进行中 5 · 已完成 10 · 页面 1'))
assert.ok(overviewHtml.includes('wd-tool-metrics'))
assert.ok(overviewHtml.includes('http://localhost:9000/s/lead/apps/demo/'))
assert.ok(overviewHtml.includes('wd-tool-dot running'))

ctrl.dispose()
console.log('client-live ok')
