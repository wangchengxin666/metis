import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importExternal } from './deps.mjs'
import * as hostPlugin from '../index.js'
import { estimateTokens, redactSecrets } from '../src/shared/model.js'
import { extractHeuristicMemoriesFromUserText } from '../src/host/auto-capture.js'

const { Context } = await importExternal('@deepseek-ai/cordis')

const tempDir = mkdtempSync(join(tmpdir(), 'dsh-sandbox-memory-'))

try {
  // -------------------------------------------------------------------------
  // Part 1: Secret redaction, token estimation & heuristic capture unit checks
  // -------------------------------------------------------------------------
  {
    const scrubbed = redactSecrets(
      'My OpenAI key is sk-proj-abc1234567890defghijk and github ghp_1234567890abcdefghijklmno and PASSWORD=supersecretvalue',
    )
    assert.equal(scrubbed.redacted, true)
    assert.ok(!scrubbed.text.includes('sk-proj-abc1234567890defghijk'))
    assert.ok(!scrubbed.text.includes('ghp_1234567890abcdefghijklmno'))
    assert.ok(!scrubbed.text.includes('supersecretvalue'))
    assert.ok(scrubbed.text.includes('[REDACTED_API_KEY]'))
    assert.ok(scrubbed.text.includes('[REDACTED_GH_TOKEN]'))

    assert.ok(estimateTokens('Hello world') > 0)
    assert.ok(estimateTokens('记住以后前端项目一律使用 yarn 安装依赖') >= 10)

    const zhAuto = extractHeuristicMemoriesFromUserText('请记住：所有前端项目一律使用 yarn 而不是 npm。')
    assert.equal(zhAuto.length, 1)
    assert.equal(zhAuto[0].category, 'preference')
    assert.equal(zhAuto[0].source, 'auto')

    const enAuto = extractHeuristicMemoriesFromUserText('From now on, always run pytest before committing backend changes.')
    assert.equal(enAuto.length, 1)
    assert.equal(enAuto[0].category, 'preference')

    const questionIgnored = extractHeuristicMemoriesFromUserText('你记住刚才报错的行号了吗？')
    assert.equal(questionIgnored.length, 0)
  }

  // -------------------------------------------------------------------------
  // Part 2: Live Environment Scanner + Store + Token Budget + Markdown Mirror
  // -------------------------------------------------------------------------
  {
    const homeDir = join(tempDir, 'home-env')
    const dshHome = join(homeDir, '.dsh')
    const stateDir = join(homeDir, '.dsh-sandbox')
    const toolchainDir = join(tempDir, 'opt-toolchain')

    mkdirSync(join(stateDir, 'services', 'conf.d'), { recursive: true })
    mkdirSync(join(stateDir, 'caddy', 'apps.d'), { recursive: true })
    mkdirSync(join(homeDir, 'billing-api'), { recursive: true })
    mkdirSync(join(homeDir, 'web-portal'), { recursive: true })
    mkdirSync(join(toolchainDir, 'dotnet'), { recursive: true })

    writeFileSync(join(homeDir, 'billing-api', 'pyproject.toml'), '[project]\nname="billing"\n', 'utf8')
    writeFileSync(join(homeDir, 'web-portal', 'package.json'), '{"name":"web-portal"}\n', 'utf8')
    writeFileSync(join(homeDir, 'web-portal', 'tsconfig.json'), '{}\n', 'utf8')

    writeFileSync(
      join(stateDir, 'info.json'),
      JSON.stringify({
        public_origin: 'https://dock.example.com',
        base_path: '/s/alice',
        public_url: 'https://dock.example.com/s/alice/',
        apps_base_url: 'https://dock.example.com/s/alice/apps/',
        port_proxy_base_url: 'https://dock.example.com/s/alice/p/',
      }),
      'utf8',
    )
    writeFileSync(join(stateDir, 'services', 'supervisord.conf'), '[supervisord]\n', 'utf8')
    writeFileSync(join(stateDir, 'services', 'supervisor.sock'), '', 'utf8')
    writeFileSync(
      join(stateDir, 'services', 'conf.d', 'billing.conf'),
      '[program:billing]\ncommand=uvicorn main:app --port 8001\ndirectory=/home/workspace/billing-api\nautostart=true\n',
      'utf8',
    )
    writeFileSync(
      join(stateDir, 'caddy', 'apps.d', '00-empty.caddy'),
      '# empty\n',
      'utf8',
    )
    writeFileSync(
      join(stateDir, 'caddy', 'apps.d', 'billing.caddy'),
      '# Managed by sandbox-expose(1)\n# App: billing -> 127.0.0.1:8001 mounted at /s/alice/apps/billing/\n',
      'utf8',
    )
    writeFileSync(
      join(stateDir, 'crontab'),
      '# comment\n0 9 * * * /home/workspace/billing-api/daily.sh\n',
      'utf8',
    )

    const svc = hostPlugin.createMemoryService({
      config: {
        homeDir,
        dshHome,
        sandboxStateDir: stateDir,
        toolchainDir,
        disableWatchers: true,
        maxIndexItems: 5,
        maxIndexChars: 900,
      },
      execCmd: async (cmd, args) => {
        if (cmd === 'supervisorctl') {
          return { ok: true, stdout: 'billing                          RUNNING   pid 42, uptime 0:10:00\n', stderr: '' }
        }
        if (cmd.includes('node') && args[0] === '-v') return { ok: true, stdout: 'v24.19.0\n', stderr: '' }
        if (cmd === 'python3') return { ok: true, stdout: 'Python 3.13.2\n', stderr: '' }
        if (cmd === 'git') return { ok: true, stdout: 'git version 2.47.0\n', stderr: '' }
        return { ok: false, stdout: '', stderr: '' }
      },
    })

    const envRes = await svc.refreshEnvironment({ forceToolchains: true })
    assert.equal(envRes.ok, true)
    assert.equal(envRes.envSnapshot.info.slug, 'alice')
    assert.equal(envRes.envSnapshot.projects.length, 2)
    assert.ok(envRes.envSnapshot.projects.some((p) => p.name === 'billing-api' && p.stacks.includes('python')))
    assert.ok(envRes.envSnapshot.projects.some((p) => p.name === 'web-portal' && p.stacks.includes('ts')))
    assert.equal(envRes.envSnapshot.services.length, 1)
    assert.equal(envRes.envSnapshot.services[0].status, 'running')
    assert.equal(envRes.envSnapshot.routes.length, 1)
    assert.equal(envRes.envSnapshot.routes[0].publicUrl, 'https://dock.example.com/s/alice/apps/billing/')
    assert.equal(envRes.envSnapshot.cron.length, 1)
    assert.ok(envRes.envSnapshot.toolchains.some((t) => t.name === 'dotnet'))

    // Save memories + verify deduplication + Markdown mirror sync + CJK/EN search
    const m1 = svc.saveMemory({
      title: '包管理器规范',
      summary: '所有前端项目一律使用 yarn 而不是 npm',
      content: '项目采用 Yarn 4 Corepack，不要执行 npm install，统一执行 yarn install。',
      category: 'preference',
      tags: ['yarn', 'frontend'],
      pinned: true,
      source: 'manual',
      dedupeKey: 'pref:pkg-mgr',
    })
    assert.equal(m1.ok, true)
    assert.equal(m1.action, 'created')
    assert.ok(existsSync(join(dshHome, 'memory', 'MEMORY.md')))
    assert.ok(existsSync(join(dshHome, 'memory', 'entries', `${m1.entry.id}.md`)))
    assert.ok(readFileSync(join(dshHome, 'memory', 'MEMORY.md'), 'utf8').includes('包管理器规范'))

    // Upsert with same dedupeKey updates in place instead of creating duplicate
    const m1Up = svc.saveMemory({
      title: '包管理器规范',
      summary: '前端统一使用 yarn 4，禁止 npm',
      content: '统一使用 corepack yarn install。',
      category: 'preference',
      tags: ['corepack'],
      source: 'agent',
      dedupeKey: 'pref:pkg-mgr',
    })
    assert.equal(m1Up.ok, true)
    assert.equal(m1Up.action, 'updated')
    assert.equal(m1Up.entry.id, m1.entry.id)
    assert.equal(svc.store.list().length, 1)

    // Add 6 more memories to test strict index cap (maxIndexItems = 5)
    for (let i = 1; i <= 6; i += 1) {
      svc.saveMemory({
        title: `Billing Service Detail ${i}`,
        summary: `Detail note #${i} for billing API running on port ${8000 + i}`,
        content: `Extended documentation for billing component ${i} with FastAPI and SQLite.`,
        category: 'project',
        tags: ['billing', `part-${i}`],
        source: i % 2 === 0 ? 'auto' : 'agent',
      })
    }

    const preview = svc.getPreviewBundle()
    assert.equal(preview.budget.includedCount, 5)
    assert.equal(preview.budget.omittedCount, 2)
    assert.ok(preview.indexText.includes(m1.entry.id), 'Pinned memory must always be included first in bounded index')
    assert.ok(preview.indexText.includes('2 more memories available via memory_search'))
    assert.ok(preview.envText.includes('billing(running)'))
    assert.ok(preview.envText.includes('/s/alice/apps/billing/'))
    assert.ok(preview.budget.totalTokens > 0 && preview.budget.totalTokens < 800)

    // Bilingual BM25 search finds Chinese and English memories cleanly
    const zhSearch = svc.store.search('前端 yarn', { limit: 5 })
    assert.ok(zhSearch.length >= 1)
    assert.equal(zhSearch[0].entry.id, m1.entry.id)

    const enSearch = svc.store.search('FastAPI port 8006', { limit: 5 })
    assert.ok(enSearch.length >= 1)
    assert.ok(enSearch[0].entry.title.includes('6'))

    // Export & Import roundtrip
    const exported = svc.store.exportData()
    assert.equal(exported.memories.length, 7)

    // Deleting a memory removes its entry markdown file too
    const delRes = svc.deleteMemory(m1.entry.id)
    assert.equal(delRes.ok, true)
    assert.equal(existsSync(join(dshHome, 'memory', 'entries', `${m1.entry.id}.md`)), false)

    // Clear auto memories only removes source === 'auto'
    const clearRes = svc.clearMemories('auto')
    assert.equal(clearRes.ok, true)
    assert.equal(clearRes.removedCount, 3)
    assert.ok(svc.store.list().every((m) => m.source !== 'auto'))

    // Import restores cleanly
    const impRes = svc.importMemories(exported, { mode: 'replace' })
    assert.equal(impRes.ok, true)
    assert.equal(impRes.total, 7)

    svc.dispose()
  }

  // -------------------------------------------------------------------------
  // Part 3: Full Cordis Host Lifecycle (Routes + systemPrompt + Tools + Skills + session/event Auto-Capture)
  // -------------------------------------------------------------------------
  {
    const ctx = new Context()
    const routes = new Map()
    const promptSections = new Map()
    const promptContexts = new Map()
    const tools = new Map()
    let registeredSkillProvider = null
    let skillInvalidations = 0

    ctx.provide('connection', {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return () => { routes.delete(route.path) }
        },
      },
    })
    ctx.provide('systemPrompt', {
      section(def) {
        promptSections.set(def.name, def)
        return () => { promptSections.delete(def.name) }
      },
      context(def) {
        promptContexts.set(def.name, def)
        return () => { promptContexts.delete(def.name) }
      },
    })
    ctx.provide('tools', {
      register(def) {
        tools.set(def.name, def)
        return () => { tools.delete(def.name) }
      },
    })
    ctx.provide('skills', {
      registerProvider(provider, onControl) {
        registeredSkillProvider = provider
        onControl?.({ invalidate: () => { skillInvalidations += 1 } })
        return () => { registeredSkillProvider = null }
      },
    })

    const homeDir = join(tempDir, 'home-cordis')
    const dshHome = join(homeDir, '.dsh')
    const fiber = ctx.plugin(hostPlugin, {
      homeDir,
      dshHome,
      disableWatchers: true,
      disableToolchainProbe: true,
    })
    await fiber.inertia
    await new Promise((r) => setTimeout(r, 40))

    // Verify all 10 browser routes registered
    for (const ep of [
      hostPlugin.STATE_ENDPOINT,
      hostPlugin.CREATE_ENDPOINT,
      hostPlugin.UPDATE_ENDPOINT,
      hostPlugin.DELETE_ENDPOINT,
      hostPlugin.CLEAR_ENDPOINT,
      hostPlugin.SETTINGS_ENDPOINT,
      hostPlugin.ENV_REFRESH_ENDPOINT,
      hostPlugin.EXPORT_ENDPOINT,
      hostPlugin.IMPORT_ENDPOINT,
      hostPlugin.SEARCH_ENDPOINT,
    ]) {
      assert.ok(routes.has(ep), `Expected route ${ep} to be registered`)
    }

    // Verify systemPrompt hooks (both static section + cache-safe context with interpolate: false)
    assert.ok(promptSections.has('sandbox-memory:guide'))
    assert.equal(promptSections.get('sandbox-memory:guide').interpolate, false)
    assert.ok(promptContexts.has('sandbox-memory:context'))
    assert.equal(promptContexts.get('sandbox-memory:context').interpolate, false)

    // Verify all 6 native tools registered
    for (const toolName of ['memory_save', 'memory_search', 'memory_get', 'memory_update', 'memory_delete', 'env_snapshot']) {
      assert.ok(tools.has(toolName), `Expected tool ${toolName} to be registered`)
    }

    // Verify dynamic Skill provider
    assert.ok(registeredSkillProvider)
    const skillList = await registeredSkillProvider.list({})
    assert.equal(skillList[0].name, 'sandbox-memory')

    // Test Agent Tool end-to-end: memory_save -> memory_search -> memory_get -> memory_update -> memory_delete
    const saveTool = tools.get('memory_save')
    const searchTool = tools.get('memory_search')
    const getTool = tools.get('memory_get')
    const updateTool = tools.get('memory_update')
    const deleteTool = tools.get('memory_delete')
    const envTool = tools.get('env_snapshot')

    const saved = await saveTool.execute({
      title: 'Docker Compose Network',
      summary: 'Internal sandbox traffic uses dsh-manager bridge network',
      content: 'Containers join dsh-manager with API_KEY=sk-proj-secret1234567890abcdef',
      category: 'environment',
      tags: ['docker', 'network'],
    })
    assert.equal(saved.ok, true)
    assert.equal(saved.redacted, true)
    assert.ok(!saved.entry.content.includes('sk-proj-secret1234567890abcdef'))
    assert.ok(skillInvalidations >= 1)

    const found = await searchTool.execute({ query: 'dsh-manager' })
    assert.equal(found.ok, true)
    assert.equal(found.count, 1)

    const fetched = await getTool.execute({ ids: [saved.entry.id] })
    assert.equal(fetched.ok, true)
    assert.equal(fetched.entries[0].accessCount, 1)

    const updated = await updateTool.execute({ id: saved.entry.id, pinned: true })
    assert.equal(updated.ok, true)
    assert.equal(updated.entry.pinned, true)

    const envToolRes = await envTool.execute({ refresh: false })
    assert.equal(envToolRes.ok, true)
    assert.ok(envToolRes.snapshot.info)

    // Verify promptContext now contains the saved memory index
    const injectedContextText = promptContexts.get('sandbox-memory:context').text()
    assert.ok(injectedContextText.includes('Docker Compose Network'))

    // Test Zero-Token Turn-End Auto-Capture via real DSH `session/event` payload shapes
    ctx.emit('session/event', { id: 'sess-user-1' }, { type: 'turn/start', data: { turn: 1 } })
    // Synthetic context user/message (non-user source) must be ignored
    ctx.emit('session/event', { id: 'sess-user-1' }, {
      type: 'user/message',
      data: {
        id: 'ctx-1',
        role: 'user',
        source: { kind: 'context' },
        content: [{ type: 'text', text: '记住这条合成系统上下文不应该被自动捕获。' }],
      },
    })
    ctx.emit('session/event', { id: 'sess-user-1' }, {
      type: 'user/message',
      data: {
        id: 'usr-1',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: '记住以后所有回复都用中文并附带文件路径。' }],
      },
    })
    ctx.emit('session/event', { id: 'sess-user-1' }, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    })

    // Verify Browser STATE_ENDPOINT returns both agent-saved and auto-captured memories
    const stateRes = await routes.get(hostPlugin.STATE_ENDPOINT).fetch(
      new Request('http://localhost/api/sandbox-memory.state'),
    )
    assert.equal(stateRes.status, 200)
    const stateJson = await stateRes.json()
    assert.equal(stateJson.ok, true)
    assert.equal(stateJson.state.memories.length, 2)
    assert.ok(stateJson.state.memories.some((m) => m.source === 'auto' && m.content.includes('附带文件路径')))
    assert.ok(!stateJson.state.memories.some((m) => m.content.includes('合成系统上下文')))

    // Verify auto-capture is skipped when Agent already called memory_save in the turn (real DSH tool/call shape)
    ctx.emit('session/event', { id: 'sess-user-2' }, { type: 'turn/start', data: { turn: 1 } })
    ctx.emit('session/event', { id: 'sess-user-2' }, {
      type: 'user/message',
      data: {
        id: 'usr-2',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: '记住这条由 Agent 主动保存的规则。' }],
      },
    })
    ctx.emit('session/event', { id: 'sess-user-2' }, {
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'call_1', name: 'memory_save', arguments: '{}' },
    })
    ctx.emit('session/event', { id: 'sess-user-2' }, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    })
    const afterSkipRes = await (await routes.get(hostPlugin.STATE_ENDPOINT).fetch(
      new Request('http://localhost/api/sandbox-memory.state'),
    )).json()
    assert.equal(afterSkipRes.state.memories.length, 2, 'Auto-capture must not duplicate when memory_save already ran in turn')

    // Verify manual browser CREATE_ENDPOINT + SETTINGS_ENDPOINT + DELETE tool
    const createRes = await routes.get(hostPlugin.CREATE_ENDPOINT).fetch(
      new Request('http://localhost/api/sandbox-memory.create', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Manual Deploy Note',
          content: 'Always run pytest before docker compose build.',
          category: 'workflow',
          tags: ['deploy'],
        }),
      }),
    )
    assert.equal(createRes.status, 200)
    const createdJson = await createRes.json()
    assert.equal(createdJson.ok, true)
    assert.equal(createdJson.entry.source, 'manual')

    const settingsRes = await routes.get(hostPlugin.SETTINGS_ENDPOINT).fetch(
      new Request('http://localhost/api/sandbox-memory.settings', {
        method: 'POST',
        body: JSON.stringify({ settings: { enabled: false } }),
      }),
    )
    assert.equal(settingsRes.status, 200)
    assert.equal(promptSections.get('sandbox-memory:guide').text(), '')
    assert.equal(promptContexts.get('sandbox-memory:context').text(), '')

    const deleted = await deleteTool.execute({ id: saved.entry.id })
    assert.equal(deleted.ok, true)

    await ctx.fiber.dispose()
    assert.equal(routes.size, 0, 'All routes must unregister on dispose')
    assert.equal(promptSections.size, 0, 'All prompt sections must unregister on dispose')
    assert.equal(promptContexts.size, 0, 'All prompt contexts must unregister on dispose')
    assert.equal(tools.size, 0, 'All tools must unregister on dispose')
    assert.equal(registeredSkillProvider, null, 'Skill provider must unregister on dispose')
  }

  console.log('host-live ok')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
