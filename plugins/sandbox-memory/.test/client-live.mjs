import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { PLUGIN_DIR, importExternal } from './deps.mjs'
import { createMemoryController } from '../src/client/memory-controller.js'
import { createMemoryMainPage, createMemorySettingsPage } from '../src/client/memory-page.js'
import { createMemoryToolView } from '../src/client/tool-views.js'
import { MEMORY_CSS } from '../src/client/styles.js'

const { Context, Service } = await importExternal('@deepseek-ai/cordis')
const React = (await importExternal('react')).default || await importExternal('react')
const ReactDOMServer = await importExternal('react-dom/server')

const mockHostState = {
  memories: [
    {
      id: 'mem_abc1234567',
      title: '前端统一使用 Yarn',
      summary: '所有前端工程使用 yarn 4，禁止 npm install',
      content: '项目采用 Yarn 4 + Corepack，构建命令为 corepack yarn build。',
      category: 'preference',
      tags: ['yarn', 'frontend'],
      source: 'auto',
      pinned: true,
      enabled: true,
      accessCount: 3,
      createdAt: Date.now() - 60000,
      updatedAt: Date.now() - 30000,
    },
    {
      id: 'mem_def9876543',
      title: 'Billing API 服务端口',
      summary: 'FastAPI 运行在 127.0.0.1:8001，暴露于 /s/alice/apps/billing/',
      content: '使用 sandbox-service billing 管理。',
      category: 'project',
      tags: ['billing', 'fastapi'],
      source: 'agent',
      pinned: false,
      enabled: true,
      accessCount: 1,
      createdAt: Date.now() - 120000,
      updatedAt: Date.now() - 10000,
    },
  ],
  settings: {
    enabled: true,
    autoCapture: true,
    agentAutoWrite: true,
    includeEnvSnapshot: true,
    maxIndexItems: 30,
    maxIndexChars: 2800,
    envSections: {
      urls: true,
      toolchains: true,
      projects: true,
      services: true,
      routes: true,
      cron: true,
    },
  },
  envSnapshot: {
    info: {
      slug: 'alice',
      homeDir: '/home/workspace',
      publicUrl: 'https://dock.example.com/s/alice/',
      appsBaseUrl: 'https://dock.example.com/s/alice/apps/',
      portProxyBaseUrl: 'https://dock.example.com/s/alice/p/',
    },
    toolchains: [{ name: 'node', version: '24.22.3' }, { name: 'python3', version: '3.13.2' }],
    projects: [{ name: 'billing-api', path: '/home/workspace/billing-api', stacks: ['python', 'git'] }],
    services: [{ name: 'billing', status: 'running', command: 'uvicorn main:app --port 8001' }],
    routes: [{ name: 'billing', target: '127.0.0.1:8001', mountPath: '/s/alice/apps/billing/', publicUrl: 'https://dock.example.com/s/alice/apps/billing/' }],
    cron: ['0 9 * * * /home/workspace/daily.sh'],
    scannedAt: Date.now() - 5000,
  },
  preview: {
    guideText: '# Sandbox Memory & Environment Guide\n...',
    envText: '[Sandbox Environment Snapshot]\n- Services: billing(running)',
    indexText: '[Persistent Memory Index (2 active)]\n- *[mem_abc1234567|preference] 前端统一使用 Yarn — 所有前端工程使用 yarn 4',
    contextText: '[Sandbox Environment Snapshot]\n...\n[Persistent Memory Index]',
    budget: {
      guideTokens: 110,
      envTokens: 85,
      indexTokens: 90,
      totalTokens: 285,
      indexChars: 140,
      maxIndexChars: 2800,
      includedCount: 2,
      omittedCount: 0,
      totalEnabledCount: 2,
    },
  },
  stats: {
    total: 2,
    enabled: 2,
    disabled: 0,
    pinned: 1,
    byCategory: { preference: 1, project: 1 },
    bySource: { auto: 1, agent: 1, manual: 0 },
  },
  storageDir: '/home/workspace/.dsh/memory',
}

// 1. Controller actions & SSR rendering of Main Page + Settings Page + Tool Views
{
  const calls = []
  const controller = createMemoryController({
    fetchImpl: async (url, opts) => {
      calls.push({ url, method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null })
      if (url.includes('sandbox-memory.export')) {
        return new Response(JSON.stringify({ ok: true, data: { memories: mockHostState.memories } }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, rev: 5, state: mockHostState }), { status: 200 })
    },
  })

  await controller.syncFromHost({ force: true })
  assert.equal(controller.getSnapshot().state.memories.length, 2)

  await controller.createMemory({ title: 'Test', content: 'Body', category: 'fact' })
  await controller.updateMemory('mem_abc1234567', { pinned: false })
  await controller.saveSettings({ autoCapture: false })
  await controller.refreshEnvironment(true)
  await controller.clearAutoMemories()
  const exported = await controller.exportMemories()
  assert.equal(exported.memories.length, 2)
  await controller.importMemories(exported, 'merge')
  await controller.deleteMemory('mem_def9876543')

  assert.ok(calls.some((c) => c.url.includes('api/sandbox-memory.create')))
  assert.ok(calls.some((c) => c.url.includes('api/sandbox-memory.update')))
  assert.ok(calls.some((c) => c.url.includes('api/sandbox-memory.settings')))
  assert.ok(calls.some((c) => c.url.includes('api/sandbox-memory.env-refresh')))
  assert.ok(calls.some((c) => c.url.includes('api/sandbox-memory.clear')))
  assert.ok(calls.some((c) => c.url.includes('api/sandbox-memory.import')))
  assert.ok(calls.some((c) => c.url.includes('api/sandbox-memory.delete')))

  // Render Main Page (Chinese)
  const MainPageZh = createMemoryMainPage({
    React,
    controller,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
  })
  const mainHtmlZh = ReactDOMServer.renderToStaticMarkup(React.createElement(MainPageZh, {}))
  assert.ok(mainHtmlZh.includes('记忆中心'))
  assert.ok(mainHtmlZh.includes('前端统一使用 Yarn'))
  assert.ok(mainHtmlZh.includes('Billing API 服务端口'))
  assert.ok(mainHtmlZh.includes('~285'))
  assert.ok(mainHtmlZh.includes('常驻索引'))
  assert.ok(mainHtmlZh.includes('自动捕获'))
  assert.ok(mainHtmlZh.includes('Agent 写入'))

  // Render Settings Page (English)
  const SettingsPageEn = createMemorySettingsPage({
    React,
    controller,
    getLocale: () => 'en-US',
    subscribeLocale: () => () => {},
  })
  const settingsHtmlEn = ReactDOMServer.renderToStaticMarkup(React.createElement(SettingsPageEn, {}))
  assert.ok(settingsHtmlEn.includes('Auto-Write &amp; Token Budget Policy'))
  assert.ok(settingsHtmlEn.includes('Zero-Token Auto-Capture on Turn End'))
  assert.ok(settingsHtmlEn.includes('Include Compact Environment Snapshot'))

  // Render Native Chat Tool Cards (no raw JSON dumps)
  const ToolCard = createMemoryToolView({
    React,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
  })
  const saveCardHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(ToolCard, {
      toolName: 'memory_save',
      phase: 'result',
      block: {
        call: {
          name: 'memory_save',
          argsRaw: JSON.stringify({ title: '包管理规范', category: 'preference' }),
        },
        content: [{ type: 'text', text: 'Saved memory [mem_abc1234567] (preference): "包管理规范"' }],
      },
    }),
  )
  assert.ok(saveCardHtml.includes('已保存记忆'))
  assert.ok(saveCardHtml.includes('包管理规范'))
  assert.ok(!saveCardHtml.includes('"category"'), 'Tool card must not dump raw JSON args')

  // Verify real DSH CSS design tokens are used
  assert.ok(MEMORY_CSS.includes('--dsw-alias-label-primary'))
  assert.ok(MEMORY_CSS.includes('--dsw-alias-bg-layer-1'))
  assert.ok(MEMORY_CSS.includes('--dsw-alias-brand-primary'))

  controller.dispose()
}

// 2. Full client.js VM load + Cordis slot registrations & clean disposal
{
  const appendedStyles = []
  globalThis.document = {
    head: {
      querySelector(sel) {
        return appendedStyles.find((s) => sel.includes(s.attributes['data-plugin'])) || null
      },
      appendChild(el) { appendedStyles.push(el) },
    },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        attributes: {},
        textContent: '',
        setAttribute(k, v) { this.attributes[k] = v },
        remove() {
          const i = appendedStyles.indexOf(this)
          if (i >= 0) appendedStyles.splice(i, 1)
        },
      }
    },
  }

  let entryDef = null
  const bundleSource = readFileSync(join(PLUGIN_DIR, 'client.js'), 'utf8')
  vm.runInNewContext(bundleSource, {
    get document() { return globalThis.document },
    window: {
      __ModuleLoader__: {
        load(def) { entryDef = def },
      },
    },
  })

  const exported = entryDef.factory((spec) => {
    if (spec === 'react') return React
    throw new Error(`Unexpected require ${spec}`)
  })

  const regs = []
  let activeLang = 'en-US'
  const localeListeners = new Set()

  class MockSlots extends Service {
    constructor(ctx) {
      super(ctx, 'slots', true)
    }
    inject(_k, cb) {
      const dispose = cb()
      return this.ctx.effect(() => dispose, 'test inject')
    }
    register(opts, comp) {
      const rec = { opts, comp }
      regs.push(rec)
      return () => {
        const i = regs.indexOf(rec)
        if (i >= 0) regs.splice(i, 1)
      }
    }
  }

  const ctx = new Context()
  ctx.plugin(MockSlots)
  ctx.provide('locale', {
    getSnapshot() { return { active: activeLang } },
    subscribe(fn) {
      localeListeners.add(fn)
      return () => localeListeners.delete(fn)
    },
    register() { return () => {} },
  })

  const fiber = ctx.plugin(exported)
  await fiber.inertia
  await new Promise((r) => setTimeout(r, 20))

  assert.equal(appendedStyles.length, 1)
  assert.ok(regs.some((r) => r.opts.name === 'sidebar.panellist' && r.opts.id === 'sandbox-memory'))
  assert.ok(regs.some((r) => r.opts.name === 'main' && r.opts.key === 'sandbox-memory'))
  assert.ok(regs.some((r) => r.opts.name === 'settings.section' && r.opts.id === 'sandbox-memory' && r.opts.label === 'Memory Center'))
  for (const toolKey of ['memory_save', 'memory_search', 'memory_get', 'memory_update', 'memory_delete', 'env_snapshot']) {
    assert.ok(regs.some((r) => r.opts.name === 'tool.call.toolview' && r.opts.key === toolKey))
  }

  activeLang = 'zh-CN'
  for (const fn of localeListeners) fn({ active: activeLang })
  assert.ok(regs.some((r) => r.opts.name === 'settings.section' && r.opts.label === '记忆中心'))

  await fiber.dispose()
  assert.equal(appendedStyles.length, 0)
  assert.equal(regs.length, 0)
  await ctx.fiber.dispose()
}

console.log('client-live ok')
