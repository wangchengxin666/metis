import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { PLUGIN_DIR, importExternal } from './deps.mjs'
import { createMeshController } from '../src/client/mesh-controller.js'
import {
  copyTextToClipboard,
  createMeshChatPage,
  createMeshSettingsPage,
  detectComposerTrigger,
  formatTaskArtifact,
} from '../src/client/mesh-page.js'
import {
  formatBytes,
  localizeSystemMessage,
  renderMarkdownMessage,
  stripMarkdownForPreview,
} from '../src/client/markdown.js'
import {
  createMeshToolView,
  createMeshWakePromptView,
  parseIncomingWakePrompt,
} from '../src/client/tool-views.js'
import { canStartNewTopic, parsePairInvite, resolveBrowserOriginUrl } from '../src/shared/protocol.js'
import { MESH_CSS } from '../src/client/styles.js'

const { Context, Service } = await importExternal('@deepseek-ai/cordis')
const React = (await importExternal('react')).default || await importExternal('react')
const ReactDOMServer = await importExternal('react-dom/server')

// 1. Test @ and # trigger detection + Chat Main View vs Settings Pairing View separation
{
  assert.deepEqual(detectComposerTrigger('Hello @bob'), {
    trigger: '@',
    query: 'bob',
    replaceStart: 6,
  })
  assert.deepEqual(detectComposerTrigger('Check #README.md'), {
    trigger: '#',
    query: 'README.md',
    replaceStart: 6,
  })
  assert.equal(detectComposerTrigger('Normal text '), null)

  const mockServerState = {
    self: {
      slug: 'alice',
      ownerName: 'Alice',
      ownerEmail: 'alice@example.com',
      publicOrigin: 'https://dock.example.com',
      basePath: '/s/alice',
      meshPort: 4090,
      endpointUrl: 'https://dock.example.com/s/alice/p/4090',
    },
    activeInvite: {
      codeId: 'k8F9mP',
      shortCode: 'alice.k8F9mP2xQ7vL4nR1wZ3y',
      inviteUri: 'https://dock.example.com/s/alice/p/4090#pair=alice.k8F9mP2xQ7vL4nR1wZ3y',
      expiresAt: Date.now() + 300_000,
    },
    peers: [
      {
        slug: 'bob',
        ownerName: 'Bob',
        ownerEmail: 'bob@example.com',
        endpointUrl: 'https://dock.example.com/s/bob/p/4090',
        status: 'online',
      },
    ],
    rooms: [
      {
        id: 'pair:alice:bob',
        type: 'pair',
        name: 'Bob (bob)',
        peerSlug: 'bob',
        members: [
          { slug: 'alice', ownerName: 'Alice', endpointUrl: 'https://dock.example.com/s/alice/p/4090' },
          { slug: 'bob', ownerName: 'Bob', endpointUrl: 'https://dock.example.com/s/bob/p/4090' },
        ],
        unreadCount: 1,
      },
    ],
    messages: {
      'pair:alice:bob': [
        {
          id: 'msg_1',
          roomId: 'pair:alice:bob',
          sender: { slug: 'bob', ownerName: 'Bob', actor: 'agent' },
          kind: 'task',
          text: '@alice-agent Ready to sync database schema',
          hop: 1,
          wakeAgent: true,
          delivery: { deliveredTo: ['alice'], pendingPeers: [] },
          createdAt: Date.now(),
        },
      ],
    },
    outboxCount: 0,
    maxAgentHops: 3,
  }

  const controller = createMeshController({
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, state: mockServerState }), { status: 200 }),
  })

  await controller.syncFromHost()
  assert.equal(controller.getSnapshot().state.self.slug, 'alice')
  assert.equal(controller.getSnapshot().selectedRoomId, 'pair:alice:bob')

  // Verify Left-Sidebar Chat Main Page is pure chat + group creation + unified @/# composer (NO pairing box)
  const ChatPage = createMeshChatPage({
    React,
    controller,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
  })
  const chatHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(ChatPage, {}))
  assert.ok(chatHtml.includes('协同会话'))
  assert.ok(chatHtml.includes('+ 建群'))
  assert.ok(chatHtml.includes('Bob (bob)'))
  assert.ok(chatHtml.includes('新话题'))
  assert.ok(chatHtml.includes('sm-inline-mention'))
  assert.ok(chatHtml.includes('<svg'))
  assert.ok(chatHtml.includes('@alice-agent'))
  assert.ok(chatHtml.includes('Ready to sync database schema'))
  assert.ok(chatHtml.includes('输入 @ 提及成员，输入 # 发送工作区文件'))
  assert.ok(!chatHtml.includes('同网关短码'), 'Chat view must not contain pairing configuration boxes')

  // Verify Minimalist LLM-Moderated Group Room renders cleanly with New Topic divider
  const moderatedGroupState = {
    ...mockServerState,
    rooms: [
      {
        id: 'grp_mod_1',
        type: 'group',
        name: '前后端联调群',
        createdBy: 'alice',
        moderatorSlug: 'alice',
        activeThreadId: 'thr_2',
        members: mockServerState.rooms[0].members,
        unreadCount: 0,
      },
    ],
    messages: {
      grp_mod_1: [
        {
          id: 'msg_div',
          roomId: 'grp_mod_1',
          threadId: 'thr_2',
          sender: { slug: 'alice', ownerName: 'Alice', actor: 'system' },
          kind: 'system',
          text: '─── Started a new conversation topic (fresh Agent context isolated) ───',
          createdAt: Date.now(),
        },
        {
          id: 'msg_syn',
          roomId: 'grp_mod_1',
          threadId: 'thr_2',
          sender: { slug: 'alice', ownerName: 'Alice', actor: 'agent' },
          kind: 'chat',
          text: '已经协调 @bob 查完接口并修复。',
          createdAt: Date.now(),
        },
        {
          id: 'msg_task_new',
          roomId: 'grp_mod_1',
          threadId: 'thr_3',
          sender: { slug: 'alice', ownerName: 'Alice', actor: 'agent' },
          kind: 'task',
          text: '@bob Check migration status',
          createdAt: Date.now(),
        },
        {
          id: 'msg_task_reply',
          roomId: 'grp_mod_1',
          threadId: 'thr_3',
          sender: { slug: 'bob', ownerName: 'Bob', actor: 'agent' },
          kind: 'chat',
          text: 'Migration is clean',
          createdAt: Date.now(),
        },
      ],
    },
    activeStatuses: {
      grp_mod_1: [
        {
          roomId: 'grp_mod_1',
          slug: 'alice',
          ownerName: 'Alice',
          stage: 'coordinating',
          detail: '',
          isModerator: true,
          updatedAt: Date.now(),
        },
        {
          roomId: 'grp_mod_1',
          slug: 'bob',
          ownerName: 'Bob',
          stage: 'waiting_peer',
          detail: 'alice',
          isModerator: false,
          updatedAt: Date.now(),
        },
      ],
    },
  }
  const grpController = createMeshController({
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, state: moderatedGroupState }), { status: 200 }),
  })
  await grpController.syncFromHost()
  const GrpChatPage = createMeshChatPage({
    React,
    controller: grpController,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
  })
  const grpHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(GrpChatPage, {}))
  assert.ok(grpHtml.includes('主持人: @alice'))
  assert.ok(grpHtml.includes('sm-topic-divider'))
  assert.ok(grpHtml.includes('开启新话题（上下文已隔离）'))
  assert.ok(grpHtml.includes('新委托对话（上下文已隔离）'))
  assert.ok(grpHtml.includes('sm-typing-bubble'), 'Active preparing/answering bubble should render')
  assert.ok(grpHtml.includes('sm-typing-dots'), 'Animated bouncing dots should render')
  assert.ok(grpHtml.includes('sm-dot-live'), 'Busy member pill should show live pulsing dot')
  assert.ok(grpHtml.includes('正在统筹调度成员…'))
  assert.ok(grpHtml.includes('正在协同等待 @alice…'))
  assert.ok(MESH_CSS.includes('@keyframes sm-dot-bounce'))
  assert.equal((grpHtml.match(/新委托对话（上下文已隔离）/g) || []).length, 1, 'Replies in same thread must NOT emit duplicate dividers')
  assert.ok(!grpHtml.includes('当前已是全新空话题，无需重复创建'), 'New Topic button must be enabled when active thread has messages')
  assert.ok(!grpHtml.includes('主持有序研讨'), 'Hardcoded roundtable UI button must be removed')

  // Verify New Topic button is disabled when room was just rotated to a fresh empty thread (thr_4)
  const freshTopicState = {
    ...moderatedGroupState,
    rooms: [{ ...moderatedGroupState.rooms[0], activeThreadId: 'thr_4' }],
  }
  const freshController = createMeshController({
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, state: freshTopicState }), { status: 200 }),
  })
  await freshController.syncFromHost()
  const FreshChatPage = createMeshChatPage({
    React,
    controller: freshController,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
  })
  const freshHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(FreshChatPage, {}))
  assert.match(freshHtml, /disabled(?:="")?\s+title="当前已是全新空话题，无需重复创建"/, 'New Topic button must be disabled on fresh empty thread')
  freshController.dispose()

  // Active thread with existing message allows New Topic; fresh thread forbids duplicate New Topic
  assert.equal(canStartNewTopic({ id: 'g', activeThreadId: 'thr_3' }, moderatedGroupState.messages.grp_mod_1), true)
  assert.equal(canStartNewTopic({ id: 'g', activeThreadId: 'thr_fresh' }, moderatedGroupState.messages.grp_mod_1), false)
  assert.equal(canStartNewTopic({ id: 'g', activeThreadId: 'thr_fresh' }, []), false)
  grpController.dispose()

  // Verify Settings Page contains pairing config & non-wrapping labels
  const SettingsPage = createMeshSettingsPage({
    React,
    controller,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
  })
  const settingsHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(SettingsPage, {}))
  assert.ok(settingsHtml.includes('协同空间与角色名片'))
  assert.ok(settingsHtml.includes('本沙箱 Agent 名片'))
  assert.ok(settingsHtml.includes('https://dock.example.com/s/alice/p/4090'))
  assert.ok(settingsHtml.includes('alice.k8F9mP2xQ7vL4nR1wZ3y'))
  assert.ok(settingsHtml.includes('同网关短码'))
  assert.ok(settingsHtml.includes('测试连接'))
  assert.match(settingsHtml, /<input[^>]*class="sm-invite-code"/i)
  assert.ok(MESH_CSS.includes('.sm-invite-label'))
  assert.ok(MESH_CSS.includes('white-space: nowrap;'))

  // Empty-state onboarding in ChatPage renders direct Quick-Start Pairing UI
  const emptyController = createMeshController({
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      state: { ...mockServerState, peers: [], rooms: [], messages: {} },
    }), { status: 200 }),
  })
  await emptyController.syncFromHost()
  const EmptyChatPage = createMeshChatPage({
    React,
    controller: emptyController,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
  })
  const emptyChatHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(EmptyChatPage, {}))
  assert.ok(emptyChatHtml.includes('开启协同空间'))
  assert.ok(emptyChatHtml.includes('生成配对码'))
  emptyController.dispose()

  // Unpaired room renders disconnected notice & remove/repair actions instead of composer
  const unpairedController = createMeshController({
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      state: {
        ...mockServerState,
        peers: [],
        rooms: [{ ...mockServerState.rooms[0], unpaired: true, unpairedBy: 'bob' }],
      },
    }), { status: 200 }),
  })
  await unpairedController.syncFromHost()
  const UnpairedChatPage = createMeshChatPage({
    React,
    controller: unpairedController,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
  })
  const unpairedHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(UnpairedChatPage, {}))
  assert.ok(unpairedHtml.includes('已解除配对'))
  assert.ok(unpairedHtml.includes('移除会话'))
  assert.ok(unpairedHtml.includes('重新配对'))
  assert.ok(!unpairedHtml.includes('<textarea'))
  unpairedController.dispose()

  controller.dispose()
}

// 1b. Clipboard copy fallback (HTTP non-secure context, rejected Clipboard API, manual fallback) & forgiving invite parsing
{
  const parsedQuoted = parsePairInvite('  `#pair=alice.k8F9mP2xQ7vL4nR1wZ3y`  ', 'https://dock.example.com')
  assert.equal(parsedQuoted?.slug, 'alice')
  assert.equal(parsedQuoted?.shortCode, 'alice.k8F9mP2xQ7vL4nR1wZ3y')

  const parsedSlash = parsePairInvite('http://192.168.1.50:9000/s/bob/p/4090/#pair=bob.abcd1234efgh5678')
  assert.equal(parsedSlash?.slug, 'bob')
  assert.equal(parsedSlash?.endpointUrl, 'http://192.168.1.50:9000/s/bob/p/4090')

  assert.equal(
    resolveBrowserOriginUrl('http://localhost:9000/s/alice/p/4090#pair=alice.123', 'http://192.168.1.50:9000'),
    'http://192.168.1.50:9000/s/alice/p/4090#pair=alice.123',
  )
  assert.equal(
    resolveBrowserOriginUrl('https://dock.example.com/s/alice/p/4090', 'http://192.168.1.50:9000'),
    'https://dock.example.com/s/alice/p/4090',
  )

  // Mock DOM inside a focus-trapped dialog container
  const createMockDom = ({ execResult = true } = {}) => {
    const dialogChildren = []
    const dialogContainer = {
      appendChild(el) { dialogChildren.push(el); el.parentElement = dialogContainer },
    }
    const inputEl = {
      parentElement: dialogContainer,
      focused: false,
      selected: false,
      focus() { this.focused = true },
      select() { this.selected = true },
      setSelectionRange() {},
    }
    const doc = {
      activeElement: inputEl,
      body: { appendChild(el) { el.parentElement = doc.body } },
      execCommandCalls: [],
      createElement(tag) {
        return {
          tagName: tag.toUpperCase(),
          value: '',
          style: {},
          setAttribute() {},
          focus() {},
          select() {},
          setSelectionRange() {},
          remove() {
            const idx = dialogChildren.indexOf(this)
            if (idx >= 0) dialogChildren.splice(idx, 1)
          },
        }
      },
      execCommand(cmd) {
        this.execCommandCalls.push(cmd)
        return execResult
      },
    }
    return { doc, inputEl, dialogChildren }
  }

  // Non-HTTPS context: skips navigator.clipboard and uses synchronous execCommand cleanly
  {
    const { doc, inputEl } = createMockDom({ execResult: true })
    let asyncCalled = false
    const res = await copyTextToClipboard('alice.k8F9mP2xQ7vL4nR1wZ3y', {
      fallbackInput: inputEl,
      win: { isSecureContext: false },
      nav: { clipboard: { writeText: async () => { asyncCalled = true } } },
      doc,
    })
    assert.equal(res.ok, true)
    assert.equal(res.method, 'execCommand')
    assert.equal(asyncCalled, false, 'Non-secure context must use synchronous execCommand immediately')
    assert.deepEqual(doc.execCommandCalls, ['copy'])
  }

  // Secure context where Clipboard API throws: falls back to execCommand
  {
    const { doc, inputEl } = createMockDom({ execResult: true })
    const res = await copyTextToClipboard('https://dock.example.com/s/alice/p/4090#pair=alice.xxx', {
      fallbackInput: inputEl,
      win: { isSecureContext: true },
      nav: { clipboard: { writeText: async () => { throw new Error('NotAllowedError') } } },
      doc,
    })
    assert.equal(res.ok, true)
    assert.equal(res.method, 'execCommand')
  }

  // Both Clipboard API and execCommand blocked: selects fallbackInput cleanly & reports manual
  {
    const { doc, inputEl } = createMockDom({ execResult: false })
    const res = await copyTextToClipboard('alice.xxx', {
      fallbackInput: inputEl,
      win: { isSecureContext: false },
      nav: null,
      doc,
    })
    assert.equal(res.ok, false)
    assert.equal(res.method, 'manual')
    assert.equal(inputEl.selected, true)
  }
}

// 1c. Controller actions (pingPeer, removePeer, leaveGroup, removeRoom) status transitions
{
  const calls = []
  const ctrl = createMeshController({
    fetchImpl: async (url, opts) => {
      calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null })
      if (url.includes('peer-ping')) {
        return new Response(JSON.stringify({ ok: true, reachable: false, status: 'unpaired-by-peer', state: { peers: [], rooms: [] } }), { status: 200 })
      }
      if (url.includes('peer-remove')) {
        return new Response(JSON.stringify({ ok: true, remoteNotified: false, state: { peers: [], rooms: [] } }), { status: 200 })
      }
      if (url.includes('group-leave')) {
        return new Response(JSON.stringify({ ok: true, state: { peers: [], rooms: [] } }), { status: 200 })
      }
      if (url.includes('room-remove')) {
        return new Response(JSON.stringify({ ok: true, state: { peers: [], rooms: [] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, state: { peers: [], rooms: [] } }), { status: 200 })
    },
  })

  await ctrl.pingPeer('bob')
  assert.equal(ctrl.getSnapshot().statusKey, 'statusPingUnpaired')

  await ctrl.removePeer('bob')
  assert.equal(ctrl.getSnapshot().statusKey, 'statusUnpairedOffline')

  await ctrl.leaveGroup('grp_1')
  assert.equal(ctrl.getSnapshot().statusKey, 'statusGroupLeft')

  await ctrl.removeRoom('pair:alice:bob')
  assert.equal(ctrl.getSnapshot().statusKey, 'statusRoomRemoved')

  assert.equal(calls.some((c) => c.url.includes('api/sandbox-mesh.peer-ping') && c.body.slug === 'bob'), true)
  assert.equal(calls.some((c) => c.url.includes('api/sandbox-mesh.peer-remove') && c.body.slug === 'bob'), true)
  assert.equal(calls.some((c) => c.url.includes('api/sandbox-mesh.group-leave') && c.body.roomId === 'grp_1'), true)
  assert.equal(calls.some((c) => c.url.includes('api/sandbox-mesh.room-remove') && c.body.roomId === 'pair:alice:bob'), true)
  ctrl.dispose()
}

// 2. Full client.js VM load + Cordis slot registrations (sidebar.panellist + main + settings.section)
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
  const registeredTriggerSources = []
  const registeredUserTextRules = []
  ctx.plugin(MockSlots)
  ctx.provide('locale', {
    getSnapshot() { return { active: activeLang } },
    subscribe(fn) {
      localeListeners.add(fn)
      return () => localeListeners.delete(fn)
    },
    register() { return () => {} },
  })
  ctx.provide('inputTriggers', {
    registerSource(src) {
      registeredTriggerSources.push(src)
      return () => {
        const i = registeredTriggerSources.indexOf(src)
        if (i >= 0) registeredTriggerSources.splice(i, 1)
      }
    },
  })
  ctx.provide('uiConversation', {
    userText: {
      register(rule) {
        registeredUserTextRules.push(rule)
        return () => {
          const i = registeredUserTextRules.indexOf(rule)
          if (i >= 0) registeredUserTextRules.splice(i, 1)
        }
      },
    },
  })

  const fiber = ctx.plugin(exported)
  await fiber.inertia
  await new Promise((r) => setTimeout(r, 20))

  assert.equal(appendedStyles.length, 1)
  assert.equal(registeredTriggerSources.length, 1, 'Expected native Session @ trigger source to be registered')
  assert.equal(registeredTriggerSources[0].trigger, '@')
  assert.equal(registeredTriggerSources[0].name, 'sandbox-mesh')

  // Verify userText rules (mention chip + legacy XML peer chip + incoming wake prompt card)
  assert.equal(registeredUserTextRules.length, 3, 'Expected 3 uiConversation.userText rules')
  assert.ok(registeredUserTextRules.some((r) => r.id === 'sandbox-mesh'))
  assert.ok(registeredUserTextRules.some((r) => r.id === 'sandbox-mesh-legacy-peer'))
  assert.ok(registeredUserTextRules.some((r) => r.id === 'sandbox-mesh-wake'))

  // Verify native DSH tool.call.toolview slots for all 5 mesh_* tools
  for (const toolKey of ['mesh_ask_peer', 'mesh_discuss_group', 'mesh_list_peers', 'mesh_send_message', 'mesh_share_file']) {
    assert.ok(
      regs.some((r) => r.opts.name === 'tool.call.toolview' && r.opts.key === toolKey),
      `Expected tool.call.toolview registration for ${toolKey}`,
    )
  }

  const serializedRef = await registeredTriggerSources[0].codec.serialize('@[bob](dsh-mesh:bob)')
  assert.equal(serializedRef, '@[bob](dsh-mesh:bob)')
  assert.equal(registeredTriggerSources[0].codec.clipboardText('@[bob](dsh-mesh:bob)'), '@bob')

  assert.ok(regs.some((r) => r.opts.name === 'sidebar.panellist' && r.opts.id === 'sandbox-mesh'))
  assert.ok(regs.some((r) => r.opts.name === 'main' && r.opts.key === 'sandbox-mesh'))
  assert.ok(regs.some((r) => r.opts.name === 'settings.section' && r.opts.id === 'sandbox-mesh' && r.opts.label === 'Collab Space'))

  activeLang = 'zh-CN'
  for (const fn of localeListeners) fn({ active: activeLang })
  assert.ok(regs.some((r) => r.opts.name === 'settings.section' && r.opts.label === '协同空间'))

  await fiber.dispose()
  assert.equal(appendedStyles.length, 0)
  assert.equal(regs.length, 0)
  assert.equal(registeredTriggerSources.length, 0)
  assert.equal(registeredUserTextRules.length, 0)
  await ctx.fiber.dispose()
}

// 3. Rich Markdown, XSS safety, Delegation Collapse, System Pills, Theme Tokens, Tool Cards & Wake Cards
{
  // DSH real theme CSS tokens used (dark mode & custom-theme safe)
  assert.ok(MESH_CSS.includes('--dsw-alias-label-primary'))
  assert.ok(MESH_CSS.includes('--dsw-alias-bg-layer-1'))
  assert.ok(MESH_CSS.includes('--dsw-alias-brand-primary'))
  assert.ok(!MESH_CSS.includes('--dsw-alias-label-pri,'))
  assert.ok(!MESH_CSS.includes('--dsw-alias-bg-surface'))
  assert.ok(!MESH_CSS.includes('--dsw-alias-Interactive-pri'))

  // Markdown renderer: headings, bold, inline code, fenced code block with copy button, GFM table, safe links, @mention & #file
  const sampleMd = [
    '## 汇总报告 (@alice)',
    '',
    '全部 **PASS**，检查 #README.md 和 `sha256sum`（邮箱 alice@example.com 不误判）并查看 [文档](https://example.com/docs) 与 [bad](javascript:alert(1))。',
    '',
    '| 节点 | 结果 |',
    '|---|---|',
    '| **alice** | `OK` |',
    '',
    '```bash',
    'echo "hello"',
    '```',
  ].join('\n')

  const mdHtml = ReactDOMServer.renderToStaticMarkup(
    renderMarkdownMessage(React.createElement, sampleMd, {
      keyPrefix: 'tmd',
      onCopyCode: () => {},
    }),
  )
  assert.ok(mdHtml.includes('sm-md-h2'), 'Should render Markdown H2 heading')
  assert.ok(mdHtml.includes('<strong>PASS</strong>'), 'Should render Markdown bold')
  assert.ok(mdHtml.includes('sm-md-inline-code'), 'Should render inline code')
  assert.ok(mdHtml.includes('sm-md-table'), 'Should render GFM table')
  assert.ok(mdHtml.includes('sm-md-codeblock'), 'Should render fenced code block')
  assert.ok(mdHtml.includes('sm-md-copy-btn'), 'Should render copy button on fenced code block')
  assert.ok(mdHtml.includes('https://example.com/docs'), 'Should render safe https link')
  assert.ok(!mdHtml.includes('href="javascript:'), 'Must block javascript: URLs')
  assert.ok(mdHtml.includes('sm-inline-mention'), 'Should preserve @mention chip')
  assert.ok(mdHtml.includes('alice@example.com'), 'Email address must not be split into @mention chip')
  assert.ok(mdHtml.includes('sm-inline-file'), 'Should preserve #file chip')

  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(2 * 1024 * 1024), '2.00 MB')
  assert.ok(!stripMarkdownForPreview('**bold** `code` node -e \'const x="123456789012345678901234567890"\'').includes('**'))

  // Localized system pill & collapsible group delegation (phase='turn') + upgraded file card + topology bar
  const richGroupState = {
    self: { slug: 'alice', ownerName: 'Alice', endpointUrl: 'https://dock.example.com/s/alice/p/4090' },
    peers: [{ slug: 'bob', ownerName: 'Bob', status: 'online', lastLatencyMs: 14 }],
    rooms: [
      {
        id: 'grp_rich',
        type: 'group',
        name: '联调群',
        createdBy: 'alice',
        moderatorSlug: 'alice',
        activeThreadId: 'thr_1',
        members: [
          { slug: 'alice', ownerName: 'Alice' },
          { slug: 'bob', ownerName: 'Bob' },
        ],
      },
    ],
    messages: {
      grp_rich: [
        {
          id: 'sys_1',
          roomId: 'grp_rich',
          threadId: 'thr_1',
          sender: { slug: 'alice', ownerName: 'Alice', actor: 'system' },
          kind: 'system',
          text: 'Paired with Bob (bob) via Traefik mesh.',
          createdAt: Date.now() - 5000,
        },
        {
          id: 'turn_1',
          roomId: 'grp_rich',
          threadId: 'thr_1',
          phase: 'turn',
          sender: { slug: 'alice', ownerName: 'Alice', actor: 'agent' },
          kind: 'task',
          mentions: ['bob'],
          text: '@bob 检查节点状态',
          createdAt: Date.now() - 4000,
        },
        {
          id: 'turn_2',
          roomId: 'grp_rich',
          threadId: 'thr_1',
          phase: 'turn',
          sender: { slug: 'bob', ownerName: 'Bob', actor: 'agent' },
          kind: 'chat',
          text: '全部正常',
          createdAt: Date.now() - 3000,
        },
        {
          id: 'file_1',
          roomId: 'grp_rich',
          threadId: 'thr_1',
          sender: { slug: 'bob', ownerName: 'Bob', actor: 'agent' },
          kind: 'file',
          text: '检查报告',
          attachment: { name: 'report.json', size: 2048, savedPath: '/home/workspace/mesh-inbox/grp_rich/report.json' },
          createdAt: Date.now() - 2000,
        },
        {
          id: 'sum_1',
          roomId: 'grp_rich',
          threadId: 'thr_1',
          sender: { slug: 'alice', ownerName: 'Alice', actor: 'agent' },
          kind: 'chat',
          text: '## 汇总结论\n\n全部 **PASS**。',
          createdAt: Date.now() - 1000,
        },
      ],
    },
    activeStatuses: {
      grp_rich: [
        { roomId: 'grp_rich', slug: 'alice', ownerName: 'Alice', stage: 'waiting_peer', detail: 'bob', isModerator: true, updatedAt: Date.now() },
      ],
    },
  }
  const richCtrl = createMeshController({
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, state: richGroupState }), { status: 200 }),
  })
  await richCtrl.syncFromHost()
  const RichChat = createMeshChatPage({
    React,
    controller: richCtrl,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
  })
  const richHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(RichChat, {}))
  assert.ok(richHtml.includes('sm-system-pill'), 'System events must render as centered pill')
  assert.ok(richHtml.includes('已成功配对 Bob (bob)'), 'English system events should localize cleanly in zh-CN')
  assert.ok(richHtml.includes('sm-collab-group'), 'Group phase=turn steps must render inside collapsible collaboration card')
  assert.ok(richHtml.includes('协同调度过程'), 'Collaboration card header should render')
  assert.ok(richHtml.includes('sm-topology-bar'), 'Live collaboration topology bar should render when active')
  assert.ok(richHtml.includes('2.0 KB'), 'File card should display human-readable size')
  assert.ok(richHtml.includes('预览') && richHtml.includes('下载'), 'File card must include Preview & Download actions')
  assert.ok(!richHtml.includes('已存至：'), 'File card must not dump raw savedPath code inline')
  assert.ok(richHtml.includes('<strong>PASS</strong>'), 'Final summary message must render Markdown')

  // Native DSH tool.call.toolview card must render clean UI with ZERO raw JSON
  const MeshToolCard = createMeshToolView({
    React,
    controller: richCtrl,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
  })
  const toolCardHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(MeshToolCard, {
      callId: 'c1',
      toolName: 'mesh_ask_peer',
      phase: 'result',
      block: {
        kind: 'tool-result',
        call: {
          name: 'mesh_ask_peer',
          argsRaw: JSON.stringify({ targetSlug: 'bob', roomId: 'pair:alice:bob', question: '请检查 API 健康状态' }),
        },
        content: [{ type: 'text', text: '[Remote Agent @bob · thread=thr_1]:\nAPI 全部正常' }],
        isError: false,
      },
    }),
  )
  assert.ok(toolCardHtml.includes('跨沙箱协作'))
  assert.ok(toolCardHtml.includes('@bob'))
  assert.ok(toolCardHtml.includes('请检查 API 健康状态'))
  assert.ok(toolCardHtml.includes('已回复'))
  assert.ok(!toolCardHtml.includes('"targetSlug"'), 'Tool card must never expose raw JSON args')

  // Incoming wake prompt card must hide raw XML tags by default
  const wakeRaw = [
    '[SANDBOX MESH INCOMING REQUEST]',
    'You are the DSH Agent of sandbox "alice" (Alice).',
    'Room: "联调群" (roomId: "grp_rich", type: group)',
    'Sender: Bob (@bob, actor: human)',
    '<remote-mesh-context>',
    '(none)',
    '</remote-mesh-context>',
    '<remote-mesh-message>',
    '请分析一下今天的性能报告',
    '</remote-mesh-message>',
    'Instructions:\n1. Do work.',
  ].join('\n')
  const parsedWake = parseIncomingWakePrompt(wakeRaw)
  assert.equal(parsedWake?.senderSlug, 'bob')
  assert.equal(parsedWake?.roomName, '联调群')
  assert.equal(parsedWake?.body, '请分析一下今天的性能报告')
  const WakeCard = createMeshWakePromptView({ React, getLocale: () => 'zh-CN' })
  const wakeHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(WakeCard, { node: { data: parsedWake }, raw: wakeRaw }),
  )
  assert.ok(wakeHtml.includes('协同空间协作请求'))
  assert.ok(wakeHtml.includes('请分析一下今天的性能报告'))
  assert.ok(!wakeHtml.includes('&lt;remote-mesh-context&gt;'), 'Collapsed wake card must hide raw XML tags')

  // Verify localizeSystemMessage helper
  assert.equal(localizeSystemMessage('Renamed group to "New Name".', (k) => k), 'sysGroupRenamed「New Name」')

  // Verify native tool cards for all 4 new task & approval tools
  for (const [toolName, args, expectedText] of [
    ['mesh_dispatch_tasks', { roomId: 'grp_rich', tasks: [{ title: 'Build API', assigneeSlug: 'bob' }] }, '并行派发任务'],
    ['mesh_task_board', { roomId: 'grp_rich' }, '查看任务板'],
    ['mesh_task_update', { roomId: 'grp_rich', taskId: 'tsk_1', status: 'done', summary: 'API tests passed' }, '更新任务进度'],
    ['mesh_request_approval', { roomId: 'grp_rich', title: '生产发布审批', prompt: '确认发布 v2.0？' }, '人工审批门禁'],
  ]) {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(MeshToolCard, {
        callId: `c-${toolName}`,
        toolName,
        phase: 'result',
        block: {
          kind: 'tool-result',
          call: { name: toolName, argsRaw: JSON.stringify(args) },
          content: [{ type: 'text', text: 'OK' }],
          isError: false,
        },
      }),
    )
    assert.ok(html.includes(expectedText), `Expected tool card for ${toolName} to include "${expectedText}"`)
  }

  // Verify inline Human Approval Gate card + Task Board header badge + Settings Role SOP UI
  const taskStatePayload = {
    ok: true,
    rev: 99,
    state: {
      self: {
        slug: 'alice',
        ownerName: 'Alice',
        role: '系统架构与评审顾问',
        description: '统筹方案',
        instructions: 'Always run tests via local MCP before merge.',
        endpointUrl: 'http://localhost:9000/s/alice/p/4090',
      },
      peers: [{ slug: 'bob', ownerName: 'Bob', role: '后端专家', status: 'online' }],
      rooms: [
        {
          id: 'grp_proj',
          type: 'group',
          name: 'Release Team',
          createdBy: 'alice',
          moderatorSlug: 'alice',
          activeThreadId: 'thr_p1',
          members: [
            { slug: 'alice', ownerName: 'Alice', role: '架构师' },
            { slug: 'bob', ownerName: 'Bob', role: '后端专家' },
          ],
          unreadCount: 0,
        },
      ],
      tasks: {
        grp_proj: [
          {
            id: 'tsk_gate1',
            roomId: 'grp_proj',
            threadId: 'thr_p1',
            title: '生产发布确认',
            description: 'Release v2.0',
            assigneeSlug: 'bob',
            status: 'in_review',
            priority: 'high',
            approvalRequired: true,
            approvalStatus: 'pending',
            approvalPrompt: '所有单测通过，是否批准上线？',
            createdAt: Date.now() - 1000,
            updatedAt: Date.now(),
            version: 1,
          },
          {
            id: 'tsk_done1',
            roomId: 'grp_proj',
            threadId: 'thr_p1',
            title: '完成接口开发',
            assigneeSlug: 'bob',
            status: 'done',
            priority: 'medium',
            artifacts: ['branch:feat/v2'],
            createdAt: Date.now() - 2000,
            updatedAt: Date.now() - 500,
            version: 2,
          },
        ],
      },
      messages: {
        grp_proj: [
          {
            id: 'm_appr1',
            roomId: 'grp_proj',
            threadId: 'thr_p1',
            kind: 'approval',
            taskId: 'tsk_gate1',
            sender: { slug: 'alice', ownerName: 'Alice', actor: 'agent' },
            text: '所有单测通过，是否批准上线？',
            createdAt: Date.now(),
          },
        ],
      },
      activeStatuses: {},
    },
  }
  const approvalCalls = []
  const taskCtrl = createMeshController({
    fetchImpl: async (url, init) => {
      if (String(url).includes('approval-decide')) {
        approvalCalls.push(JSON.parse(init.body))
        const nextPayload = JSON.parse(JSON.stringify(taskStatePayload))
        nextPayload.state.tasks.grp_proj[0].approvalStatus = 'approved'
        nextPayload.state.tasks.grp_proj[0].approvalDecidedBy = 'Alice'
        return new Response(JSON.stringify(nextPayload), { status: 200 })
      }
      return new Response(JSON.stringify(taskStatePayload), { status: 200 })
    },
  })
  await taskCtrl.syncFromHost()
  assert.equal(taskCtrl.getUnreadSummary().pendingApprovals, 1)

  const openedSessions = []
  taskStatePayload.state.rooms[0].agentSessionId = 'session-mesh-demo-log'
  await taskCtrl.syncFromHost()
  const TaskChatPage = createMeshChatPage({
    React,
    controller: taskCtrl,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
    openAgentSession: (sid) => openedSessions.push(sid),
  })
  const pendingHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(TaskChatPage))
  assert.ok(pendingHtml.includes('任务板 1/2'), 'Header must show live task progress 1/2')
  assert.ok(pendingHtml.includes('执行日志'), 'Header must show Agent Log button when active room has agentSessionId')
  assert.ok(pendingHtml.includes('生产发布确认'), 'Inline approval card must render linked task title')
  assert.ok(pendingHtml.includes('批准继续'), 'Pending approval card must show Approve button')
  assert.ok(pendingHtml.includes('驳回修改'), 'Pending approval card must show Reject button')

  await taskCtrl.decideApproval({ roomId: 'grp_proj', taskId: 'tsk_gate1', decision: 'approved', comment: 'LGTM' })
  assert.equal(approvalCalls.length, 1)
  assert.equal(approvalCalls[0].decision, 'approved')
  assert.equal(taskCtrl.getUnreadSummary().pendingApprovals, 0)
  const approvedHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(TaskChatPage))
  assert.ok(approvedHtml.includes('已批准'), 'Approved card must show approved status')
  assert.ok(!approvedHtml.includes('批准继续'), 'Approved card must hide Approve button after decision')

  // Verify progressive-disclosure Task Board drawer & artifact formatting
  assert.deepEqual(
    formatTaskArtifact('/home/workspace/collab-space/todo-mini/server.py'),
    { full: '/home/workspace/collab-space/todo-mini/server.py', tag: '', label: 'todo-mini/server.py', isHttp: false },
  )
  assert.deepEqual(
    formatTaskArtifact('branch:feat/v2'),
    { full: 'branch:feat/v2', tag: 'branch', label: 'feat/v2', isHttp: false },
  )
  assert.deepEqual(
    formatTaskArtifact('https://preview.local/auth'),
    { full: 'https://preview.local/auth', tag: 'URL', label: 'preview.local/auth', isHttp: true },
  )
  const shaFmt = formatTaskArtifact('artifact-candidate: /home/workspace/collab-space/todo-mini/server.py (sha256 c9911ec84a718ffdb3cf0b7508896d74715e0fb4f0751e508481e1bb7d2e30ba)')
  assert.equal(shaFmt.tag, 'artifact-candidate')
  assert.ok(shaFmt.label.includes('c9911ec84a71…'), 'Long SHA256 hashes must be compacted in artifact labels')
  assert.ok(!shaFmt.label.includes('/home/workspace/collab-space/'), 'Verbose workspace prefix should be stripped')

  const denseBoardPayload = JSON.parse(JSON.stringify(taskStatePayload))
  denseBoardPayload.state.tasks.grp_proj = [
    {
      id: 'tsk_active_dense',
      title: '实现核心网关与全套回归验证',
      description: 'LONG_SPEC_SHOULD_STAY_COLLAPSED_IN_CARD',
      summary: 'HUGE_SUMMARY_SHOULD_BE_COLLAPSED_BY_DEFAULT_IN_BOARD',
      status: 'in_progress',
      priority: 'high',
      assigneeSlug: 'bob',
      artifacts: [
        '/home/workspace/collab-space/app/a1.py',
        '/home/workspace/collab-space/app/a2.py',
        '/home/workspace/collab-space/app/a3.py',
        '/home/workspace/collab-space/app/a4.py',
        '/home/workspace/collab-space/app/a5.py',
        '/home/workspace/collab-space/app/a6.py',
      ],
      updatedAt: Date.now(),
    },
    {
      id: 'tsk_gate_dense',
      title: '生产上线前最终人工审批',
      approvalRequired: true,
      approvalStatus: 'pending',
      approvalPrompt: '请确认 61/61 单测与 102/102 E2E 全部通过后放行。',
      status: 'in_review',
      priority: 'urgent',
      assigneeSlug: 'alice',
      artifacts: [],
      updatedAt: Date.now(),
    },
    {
      id: 'tsk_done_hidden',
      title: '已完成的前置初始化任务',
      summary: 'COMPLETED_TASK_SUMMARY_SHOULD_START_GROUPED',
      status: 'done',
      priority: 'low',
      assigneeSlug: 'bob',
      artifacts: ['doc:init.md'],
      updatedAt: Date.now() - 60000,
    },
  ]
  const denseCtrl = createMeshController({
    fetchImpl: async () => new Response(JSON.stringify(denseBoardPayload), { status: 200 }),
  })
  await denseCtrl.syncFromHost()
  const OpenBoardPage = createMeshChatPage({
    React,
    controller: denseCtrl,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
    initialRightPanel: 'tasks',
  })
  const boardHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(OpenBoardPage))
  assert.ok(boardHtml.includes('sm-detail-drawer is-wide'), 'Task Board drawer must use wider layout')
  assert.ok(boardHtml.includes('待处理'), 'Task Board must show Active filter tab')
  assert.ok(boardHtml.includes('全部'), 'Task Board must show All filter tab')
  assert.ok(boardHtml.includes('已完成 (1)'), 'Completed tasks must collapse into a grouped section when active tasks exist')
  assert.ok(boardHtml.includes('实现核心网关与全套回归验证'), 'Active task title must be visible')
  assert.ok(!boardHtml.includes('HUGE_SUMMARY_SHOULD_BE_COLLAPSED_BY_DEFAULT_IN_BOARD'), 'Long task summary must stay collapsed until clicked')
  assert.ok(!boardHtml.includes('app/a5.py'), 'Artifact paths must not sprawl onto collapsed task cards')
  assert.ok(!boardHtml.includes('已完成的前置初始化任务'), 'Completed task cards must stay tucked under the collapsible Completed group by default')
  assert.ok(boardHtml.includes('生产上线前最终人工审批') && boardHtml.includes('批准继续'), 'Pending approval actions must remain directly actionable on collapsed cards')
  denseCtrl.dispose()

  const TaskSettingsPage = createMeshSettingsPage({
    React,
    controller: taskCtrl,
    getLocale: () => 'zh-CN',
    subscribeLocale: () => () => {},
  })
  const settingsSopHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(TaskSettingsPage))
  assert.ok(settingsSopHtml.includes('角色规范与工作 SOP'), 'Settings must render Role SOP editor')
  assert.ok(settingsSopHtml.includes('Always run tests via local MCP before merge.'))
  assert.ok(settingsSopHtml.includes('DevOps 与运维部署专家'), 'Settings must include DevOps role preset')
  assert.ok(settingsSopHtml.includes('全栈工程师'), 'Settings must include Full-Stack Engineer role preset')
  assert.ok(settingsSopHtml.includes('安全审计与合规专家'), 'Settings must include Security Auditor role preset')

  // DSH 0.2.3 PartialArguments & structured expanded tool cards (never leaking `text(key)` JS method source or LLM coaching text)
  const makePartialArgs = (obj) => ({
    keys() { return Object.keys(obj) },
    text(key) { return typeof obj[key] === 'string' ? obj[key] : undefined },
    value(key) { return typeof obj[key] === 'string' ? undefined : obj[key] },
  })
  const expandedDisclosure = () => ({ expanded: true, toggle() {} })

  // 1) mesh_task_update with PartialArguments must NOT print `text(key)` or `[handoff queued...]`
  const updHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(MeshToolCard, {
      callId: 'c-upd',
      toolName: 'mesh_task_update',
      phase: 'result',
      useDisclosure: expandedDisclosure,
      openFile: () => {},
      block: {
        kind: 'tool-result',
        call: {
          name: 'mesh_task_update',
          args: makePartialArgs({
            roomId: 'grp_rich',
            taskId: 'tsk_abc_123',
            status: 'done',
            summary: '完成 `/healthz` 接口与 **WebSocket** 推送',
            artifacts: ['/home/workspace/app/server.js', 'https://example.com/demo'],
          }),
          argsRaw: JSON.stringify({
            roomId: 'grp_rich',
            taskId: 'tsk_abc_123',
            status: 'done',
            summary: '完成 `/healthz` 接口与 **WebSocket** 推送',
            artifacts: ['/home/workspace/app/server.js', 'https://example.com/demo'],
          }),
        },
        content: [{
          type: 'text',
          text: 'Updated task [tsk_abc_123] "后端 API 服务实现" -> done (shared 1 file(s) first): 完成 /healthz 接口 (2 downstream task(s) unblocked) [handoff queued — will notify moderator/downstream automatically as soon as your turn ends]',
        }],
        isError: false,
      },
    }),
  )
  assert.ok(updHtml.includes('后端 API 服务实现'))
  assert.ok(updHtml.includes('已完成'))
  assert.ok(updHtml.includes('<strong>WebSocket</strong>'))
  assert.ok(updHtml.includes('server.js'))
  assert.ok(updHtml.includes('https://example.com/demo'))
  assert.ok(updHtml.includes('已自动解锁 2 个下游任务'))
  assert.ok(!updHtml.includes('text(key)'), 'Must never leak PartialArguments.prototype.text JS source')
  assert.ok(!updHtml.includes('handoff queued'), 'Must hide internal LLM handoff note from user card')

  // 2) mesh_share_file with PartialArguments must display real filename & room (never blank pill)
  const shareHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(MeshToolCard, {
      callId: 'c-share',
      toolName: 'mesh_share_file',
      phase: 'result',
      useDisclosure: expandedDisclosure,
      openFile: () => {},
      block: {
        kind: 'tool-result',
        call: {
          name: 'mesh_share_file',
          args: makePartialArgs({ roomId: 'grp_rich', filePath: '/home/workspace/status_pulse/server.js', caption: '后端入口文件' }),
        },
        content: [{ type: 'text', text: 'Shared file to mesh room.' }],
      },
    }),
  )
  assert.ok(shareHtml.includes('server.js'))
  assert.ok(shareHtml.includes('联调群'))
  assert.ok(shareHtml.includes('后端入口文件'))
  assert.ok(!shareHtml.includes('text(key)'))

  // 3) mesh_dispatch_tasks must render structured task items and hide `NEXT STEP: END YOUR TURN`
  const dispHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(MeshToolCard, {
      callId: 'c-disp',
      toolName: 'mesh_dispatch_tasks',
      phase: 'result',
      useDisclosure: expandedDisclosure,
      block: {
        kind: 'tool-result',
        call: {
          name: 'mesh_dispatch_tasks',
          args: makePartialArgs({
            roomId: 'grp_rich',
            mode: 'async',
            tasks: [
              { title: '实现核心 API', assigneeSlug: 'bob', priority: 'high', description: '提供 `/healthz` 接口' },
              { title: '生产发布审批', assigneeSlug: 'alice', approvalRequired: true, dependsOnIndices: [0] },
            ],
          }),
        },
        content: [{
          type: 'text',
          text: [
            'Dispatched 2 task(s) in grp_rich (mode: async):',
            '- [tsk_1] 实现核心 API (in_progress · @bob)',
            '- [tsk_2] 生产发布审批 (todo · @alice · awaiting human approval · deps: tsk_1)',
            '',
            'NEXT STEP: Post a brief status update and END YOUR TURN now. Do NOT call `wait_agent`, `sleep`, or poll.',
          ].join('\n'),
        }],
      },
    }),
  )
  assert.ok(dispHtml.includes('sm-tool-task-list'))
  assert.ok(dispHtml.includes('实现核心 API'))
  assert.ok(dispHtml.includes('生产发布审批'))
  assert.ok(dispHtml.includes('待审批'))
  assert.ok(!dispHtml.includes('END YOUR TURN'), 'Must hide internal LLM turn-ending instruction')
  assert.ok(!dispHtml.includes('wait_agent'))

  // 4) mesh_discuss_group must render group metadata + topic and hide `Next steps as Moderator`
  const discHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(MeshToolCard, {
      callId: 'c-disc',
      toolName: 'mesh_discuss_group',
      phase: 'result',
      useDisclosure: expandedDisclosure,
      block: {
        kind: 'tool-result',
        call: {
          name: 'mesh_discuss_group',
          args: makePartialArgs({ groupName: '发布协同群', topic: '对齐 v1.0 上线检查项' }),
        },
        content: [{
          type: 'text',
          text: [
            'Created task group "发布协同群" ready (roomId="grp_new", threadId="thr_1"). You are the LLM Moderator (@alice). Members:',
            '- @bob (Backend): API & DB',
            'Next steps as Moderator (passing roomId and threadId): call mesh_dispatch_tasks...',
          ].join('\n'),
        }],
      },
    }),
  )
  assert.ok(discHtml.includes('发布协同群'))
  assert.ok(discHtml.includes('新建群聊'))
  assert.ok(discHtml.includes('对齐 v1.0 上线检查项'))
  assert.ok(!discHtml.includes('Next steps as Moderator'))

  // 5) mesh_task_board & mesh_list_peers text outputs render cleanly, and stripMarkdownForPreview preserves underscores
  assert.equal(stripMarkdownForPreview('Check tsk_abc_123 and _italic_ text'), 'Check tsk_abc_123 and italic text')
  const tbHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(MeshToolCard, {
      callId: 'c-tb',
      toolName: 'mesh_task_board',
      phase: 'result',
      useDisclosure: expandedDisclosure,
      block: {
        kind: 'tool-result',
        call: { name: 'mesh_task_board', args: makePartialArgs({ roomId: 'grp_rich' }) },
        content: [{
          type: 'text',
          text: 'Task Board (grp_rich) — 1/2 done, 1 in progress, 0 in review, 0 blocked:\n- [done] tsk_1 · 实现 API (@bob | artifacts: /home/workspace/api.js) — 测试通过',
        }],
      },
    }),
  )
  assert.ok(tbHtml.includes('已完成 1/2'))
  assert.ok(tbHtml.includes('进行中 1'))
  assert.ok(tbHtml.includes('实现 API'))

  taskCtrl.dispose()
  richCtrl.dispose()
}

console.log('client-live ok')
