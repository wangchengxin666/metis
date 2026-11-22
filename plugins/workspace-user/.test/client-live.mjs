import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { PLUGIN_DIR, importExternal } from './deps.mjs'
import {
  avatarInitials,
  extractSlugFromLocation,
  fetchWorkspaceIdentity,
  mergeIdentitySources,
} from '../src/client/identity.js'
import { createWorkspaceUserLauncher } from '../src/client/launcher.js'

const { Context, Service } = await importExternal('@deepseek-ai/cordis')
const React = (await importExternal('react')).default || await importExternal('react')
const ReactDOM = (await importExternal('react-dom')).default || await importExternal('react-dom')
const ReactDOMServer = await importExternal('react-dom/server')

// 1. Test identity slug extraction & merging logic
assert.equal(extractSlugFromLocation('/s/alice-dev/sessions'), 'alice-dev')
assert.equal(extractSlugFromLocation('/'), '')

{
  const merged = mergeIdentitySources({
    headerData: {
      viewerEmail: 'admin@example.com',
      viewerName: '',
      isAdmin: true,
      ownerEmail: 'alice@example.com',
      ownerName: '爱丽丝',
    },
    managerData: {
      authenticated: true,
      email: 'admin@example.com',
      display_name: '平台管理员',
      admin: true,
      auth_mode: 'token',
      sandbox: {
        slug: 'alice',
        owner_email: 'alice@example.com',
        owner_display_name: '爱丽丝',
      },
    },
  })
  assert.equal(merged.status, 'ready')
  assert.equal(merged.viewerName, '平台管理员')
  assert.equal(merged.viewerEmail, 'admin@example.com')
  assert.equal(merged.isAdmin, true)
  assert.equal(merged.isInspectingOther, true)
  assert.equal(merged.ownerName, '爱丽丝')
  assert.equal(merged.authMode, 'token')
}

{
  const nonAdminOwn = mergeIdentitySources({
    headerData: { viewerEmail: 'bob@example.com', ownerEmail: 'bob@example.com', isAdmin: false },
    managerData: null,
  })
  assert.equal(nonAdminOwn.isAdmin, false)
  assert.equal(nonAdminOwn.isInspectingOther, false)
  assert.equal(avatarInitials('爱丽丝', 'alice@example.com'), '爱')
  assert.equal(avatarInitials('Alice Wang', 'alice@example.com'), 'AW')
}

// 2. Test fetchWorkspaceIdentity resilience when one endpoint fails
{
  const identity = await fetchWorkspaceIdentity(async (url) => {
    if (String(url).startsWith('/api/auth/me')) {
      return new Response('down', { status: 503 })
    }
    return new Response(JSON.stringify({
      viewerEmail: 'user@example.com',
      viewerName: 'User One',
      isAdmin: false,
      ownerEmail: 'user@example.com',
    }), { status: 200 })
  })
  assert.equal(identity.status, 'ready')
  assert.equal(identity.viewerName, 'User One')
  assert.equal(identity.viewerEmail, 'user@example.com')
}

// 3. Install client plugin into a live Cordis Context with fake DOM head & slots
const appendedStyles = []
globalThis.document = {
  head: {
    querySelector(selector) {
      if (selector.includes('@metis/workspace-user')) {
        return appendedStyles.find((el) => el.attributes['data-plugin'] === '@metis/workspace-user') || null
      }
      return null
    },
    appendChild(el) {
      appendedStyles.push(el)
    },
  },
  createElement(tag) {
    return {
      tagName: tag.toUpperCase(),
      attributes: {},
      textContent: '',
      setAttribute(k, v) { this.attributes[k] = v },
      remove() {
        const idx = appendedStyles.indexOf(this)
        if (idx >= 0) appendedStyles.splice(idx, 1)
      },
    }
  },
}

const bundleSource = readFileSync(join(PLUGIN_DIR, 'client.js'), 'utf8')
let entryDef = null
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
  if (spec === 'react-dom') return ReactDOM
  throw new Error(`Unexpected require ${spec}`)
})

const slotRegistrations = []
let currentLocale = 'zh-CN'
const localeListeners = new Set()

class MockSlots extends Service {
  constructor(ctx) {
    super(ctx, 'slots', true)
  }
  inject(_slotName, callback) {
    const dispose = callback()
    return this.ctx.effect(() => dispose, 'test slot inject')
  }
  register(options, component) {
    const rec = { options, component }
    slotRegistrations.push(rec)
    return () => {
      const idx = slotRegistrations.indexOf(rec)
      if (idx >= 0) slotRegistrations.splice(idx, 1)
    }
  }
}

const ctx = new Context()
ctx.plugin(MockSlots)
ctx.provide('locale', {
  getSnapshot() { return { active: currentLocale } },
  subscribe(fn) {
    localeListeners.add(fn)
    return () => { localeListeners.delete(fn) }
  },
})

const fiber = ctx.plugin(exported)
await fiber.inertia
await new Promise((r) => setTimeout(r, 20))

assert.equal(appendedStyles.length, 1, 'Expected style element to be injected into head')
assert.equal(slotRegistrations.length, 1, 'Expected settings.launcher registration')
assert.equal(slotRegistrations[0].options.name, 'settings.launcher')
assert.equal(slotRegistrations[0].options.priority, -10)

// Render expanded and collapsed component HTML with ReactDOMServer
const Launcher = slotRegistrations[0].component
const htmlWide = ReactDOMServer.renderToStaticMarkup(
  React.createElement(Launcher, {
    wide: true,
    settingsOpen: false,
    openSettings() {},
  }),
)
assert.ok(htmlWide.includes('wu-trigger'), 'Expanded trigger class missing')
assert.ok(htmlWide.includes('wu-name'), 'Expanded user name element missing')

const htmlCollapsed = ReactDOMServer.renderToStaticMarkup(
  React.createElement(Launcher, {
    wide: false,
    settingsOpen: false,
    openSettings() {},
  }),
)
assert.ok(htmlCollapsed.includes('data-collapsed="true"'), 'Collapsed state attribute missing')

// Also test createWorkspaceUserLauncher render output with both English & inspecting-admin identity
const AdminLauncher = createWorkspaceUserLauncher({
  React,
  ReactDOM,
  getLocale: () => 'zh-CN',
  subscribeLocale: () => () => {},
  initialIdentity: {
    status: 'ready',
    viewerEmail: 'ops@example.com',
    viewerName: '平台运维',
    isAdmin: true,
    ownerEmail: 'alice@example.com',
    ownerName: '爱丽丝',
    sandboxSlug: 'alice',
    authMode: 'token',
    isInspectingOther: true,
  },
})
const htmlAdmin = ReactDOMServer.renderToStaticMarkup(
  React.createElement(AdminLauncher, {
    wide: true,
    settingsOpen: false,
    openSettings() {},
  }),
)
assert.ok(htmlAdmin.includes('平台运维'), 'Admin display name missing')
assert.ok(htmlAdmin.includes('ops@example.com'), 'Admin email missing')
assert.ok(htmlAdmin.includes('管理员'), 'Admin badge missing')
assert.ok(htmlAdmin.includes('代管访问'), 'Admin inspection badge missing')
assert.ok(htmlAdmin.includes('归属 爱丽丝'), 'Sandbox owner notice missing')
assert.ok(htmlAdmin.includes('data-inspecting="true"'), 'Inspecting data attribute missing')

// Test open popup menu renders Back to /my, Admin Console, Sign Out, and owner warning
globalThis.document.body = {}
const AdminMenuLauncher = createWorkspaceUserLauncher({
  React,
  ReactDOM: { ...ReactDOM, createPortal: (node) => node },
  getLocale: () => 'zh-CN',
  subscribeLocale: () => () => {},
  initialIdentity: {
    status: 'ready',
    viewerEmail: 'ops@example.com',
    viewerName: '平台运维',
    isAdmin: true,
    ownerEmail: 'alice@example.com',
    ownerName: '爱丽丝',
    sandboxSlug: 'alice',
    authMode: 'token',
    isInspectingOther: true,
  },
  initialMenuOpen: true,
})
const htmlMenu = ReactDOMServer.renderToStaticMarkup(
  React.createElement(AdminMenuLauncher, {
    wide: true,
    settingsOpen: false,
    settingsShortcut: { keys: ['Ctrl', '+', 'Alt', '+', ','] },
    openSettings() {},
  }),
)
assert.ok(htmlMenu.includes('href="/my"'), 'Menu missing /my link')
assert.ok(htmlMenu.includes('href="/admin"'), 'Admin menu missing /admin link')
assert.ok(htmlMenu.includes('href="/auth/logout"'), 'Menu missing /auth/logout link')
assert.ok(htmlMenu.includes('<kbd class="wu-shortcut-kbd">Ctrl</kbd>'), 'Menu missing Ctrl keycap')
assert.ok(!htmlMenu.includes('+++'), 'Menu shortcut must not double plus separators')
assert.ok(htmlMenu.includes('当前工作区归属于 爱丽丝 (alice@example.com)'), 'Menu missing inspecting owner notice')

// Verify non-admin in authMode=none omits /admin and /auth/logout
const NoneModeUserLauncher = createWorkspaceUserLauncher({
  React,
  ReactDOM: { ...ReactDOM, createPortal: (node) => node },
  getLocale: () => 'en-US',
  subscribeLocale: () => () => {},
  initialIdentity: {
    status: 'ready',
    viewerEmail: 'user@example.com',
    viewerName: 'Regular User',
    isAdmin: false,
    ownerEmail: 'user@example.com',
    ownerName: 'Regular User',
    sandboxSlug: 'user',
    authMode: 'none',
    isInspectingOther: false,
  },
  initialMenuOpen: true,
})
const htmlNoneMenu = ReactDOMServer.renderToStaticMarkup(
  React.createElement(NoneModeUserLauncher, {
    wide: true,
    settingsOpen: false,
    openSettings() {},
  }),
)
assert.ok(htmlNoneMenu.includes('href="/my"'), 'Regular user menu missing /my link')
assert.ok(!htmlNoneMenu.includes('href="/admin"'), 'Regular user should not see /admin link')
assert.ok(!htmlNoneMenu.includes('href="/auth/logout"'), 'authMode=none should hide logout link')

await fiber.dispose()
assert.equal(slotRegistrations.length, 0, 'Slot registration must dispose cleanly')
assert.equal(appendedStyles.length, 0, 'Style element must remove cleanly on dispose')
await ctx.fiber.dispose()
console.log('client-live ok')
