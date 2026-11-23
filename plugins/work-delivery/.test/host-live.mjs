import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORK_DELIVERY_TOOL_NAMES, createWorkDeliveryService } from '../index.js'
import { wireHarnessRuntime } from '../src/host/harness-bridge.js'

const tmpHome = mkdtempSync(join(tmpdir(), 'wd-host-test-'))
try {
  // Seed sample caddy app, shared file, and logs
  const appsDir = join(tmpHome, '.dsh-sandbox', 'caddy', 'apps.d')
  const sharedDir = join(tmpHome, 'shared')
  const logsDir = join(tmpHome, 'logs')
  mkdirSync(appsDir, { recursive: true })
  mkdirSync(sharedDir, { recursive: true })
  mkdirSync(logsDir, { recursive: true })

  writeFileSync(
    join(appsDir, 'demo.caddy'),
    '# App: demo -> 127.0.0.1:5173 mounted at /s/lead/apps/demo/\n',
    'utf8',
  )
  writeFileSync(join(sharedDir, 'TEAM_README.md'), '# Team Alpha\n', 'utf8')
  writeFileSync(join(logsDir, 'api.log'), 'server listening on :3000\n', 'utf8')

  const execCalls = []
  const service = createWorkDeliveryService({
    homeDir: tmpHome,
    env: { SANDBOX_SLUG: 'lead', SANDBOX_PUBLIC_ORIGIN: 'http://localhost:9000' },
    execCmd: (cmd, args) => {
      execCalls.push({ cmd, args })
      if (cmd === '/usr/local/bin/sandbox-expose' && args[0] !== '--remove') {
        writeFileSync(
          join(appsDir, `${args[0]}.caddy`),
          `# App: ${args[0]} -> 127.0.0.1:${args[1]} mounted at /s/lead/apps/${args[0]}/\n`,
          'utf8',
        )
      }
      return 'OK'
    },
  })

  // 1. State inspection
  const snap1 = service.getStateSnapshot()
  assert.equal(snap1.slug, 'lead')
  assert.equal(snap1.exposed_apps.length, 1)
  assert.equal(snap1.exposed_apps[0].name, 'demo')
  assert.equal(snap1.shared_files.length, 1)

  // 2. Task create -> approve -> mark done
  const created = service.createTask({
    title: 'Prepare Q4 executive report',
    description: 'Include revenue breakdown',
    priority: 'high',
    approvalRequired: true,
  })
  assert.equal(created.ok, true)
  assert.equal(created.state.tasks.length, 1)
  assert.equal(created.state.pending_approvals.length, 1)

  const approved = service.decideApproval({ taskId: created.task_id, decision: 'approved' })
  assert.equal(approved.ok, true)
  assert.equal(approved.state.pending_approvals.length, 0)

  const done = service.updateTaskStatus({ taskId: created.task_id, status: 'done' })
  assert.equal(done.ok, true)
  assert.equal(done.state.done_tasks_count, 1)

  // 3. Service logs & validation
  const logsRes = service.readServiceLogs({ name: 'api', tail: 50 })
  assert.equal(logsRes.ok, true)
  assert.ok(logsRes.logs.includes('server listening'))

  const badApp = service.exposeApp({ name: 'BAD NAME!', port: 8080 })
  assert.equal(badApp.ok, false)

  // 5. Harness tools + systemPrompt registration
  const registeredTools = new Map()
  let registeredPrompt = ''
  const mockCtx = {
    inject(deps, fn) {
      if (deps.includes('systemPrompt')) {
        fn({
          systemPrompt: {
            section(spec) {
              registeredPrompt = spec.text()
              return () => {}
            },
          },
          effect() {},
        })
      }
      if (deps.includes('tools')) {
        fn({
          tools: {
            register(tool) {
              registeredTools.set(tool.name, tool)
              return () => {}
            },
          },
          effect() {},
        })
      }
    },
  }
  wireHarnessRuntime(mockCtx, service)
  await new Promise((r) => setTimeout(r, 30))

  assert.ok(registeredPrompt.includes('sandbox-expose'))
  assert.deepEqual([...registeredTools.keys()].sort(), [...WORK_DELIVERY_TOOL_NAMES].sort())

  // Execute delivery_overview and delivery_task_create tools as AI chat would
  const ovTool = registeredTools.get('delivery_overview')
  const ovVal = await ovTool.execute({})
  assert.equal(ovVal.ok, true)
  const ovText = ovTool.output.render({}, ovVal)[0].text
  assert.ok(ovText.includes('Published Pages (1)'))

  const tkTool = registeredTools.get('delivery_task_create')
  const tkVal = await tkTool.execute({ title: 'Follow up with finance', priority: 'high' })
  assert.equal(tkVal.ok, true)
  const tkText = tkTool.output.render({ title: 'Follow up with finance' }, tkVal)[0].text
  assert.ok(tkText.includes('Follow up with finance'))

  console.log('host-live ok')
} finally {
  rmSync(tmpHome, { recursive: true, force: true })
}
