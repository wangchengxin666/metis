import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adminSectionFromRoute,
  apiFetch,
  extractProjectIdFromPath,
  isAdminRoute,
  parseApiErrorDetail,
  resolveInitialRoute,
  resolveInitialView,
  resolveSafeNextPath,
  routeFromAdminSection,
  slugifyOidcName,
} from './client.ts'
import {
  matchesPlugin,
  mergeCustomPluginTokens,
  parsePluginSpec,
  togglePluginToken,
} from './plugins.ts'

test('parseApiErrorDetail handles string detail, Pydantic list detail, and fallbacks', () => {
  assert.equal(parseApiErrorDetail({ detail: '未授权访问' }, 401), '未授权访问')
  assert.equal(
    parseApiErrorDetail({ detail: [{ msg: 'field required' }, { msg: 'invalid email' }] }, 422),
    'field required; invalid email',
  )
  assert.equal(parseApiErrorDetail({}, 500), 'HTTP 500')
  assert.equal(parseApiErrorDetail(null, 502), 'HTTP 502')
})

test('resolveInitialRoute and project path helpers enforce 3+5 Project-centric RBAC navigation', () => {
  assert.equal(resolveInitialRoute({ authenticated: false, admin: false }, '/admin'), 'login')
  assert.equal(resolveInitialRoute({ authenticated: true, admin: false }, '/admin/ops'), 'projects')
  assert.equal(resolveInitialRoute({ authenticated: true, admin: false }, '/'), 'projects')
  assert.equal(resolveInitialRoute({ authenticated: true, admin: false }, '/projects'), 'projects')
  assert.equal(resolveInitialRoute({ authenticated: true, admin: false }, '/projects/invoice-v1'), 'projects')
  assert.equal(resolveInitialRoute({ authenticated: true, admin: false }, '/inbox'), 'inbox')
  assert.equal(resolveInitialRoute({ authenticated: true, admin: false }, '/workforce'), 'workforce')
  assert.equal(resolveInitialRoute({ authenticated: true, admin: false }, '/analytics'), 'projects')
  assert.equal(
    resolveInitialRoute({ authenticated: true, admin: false, is_team_lead: true }, '/analytics'),
    'analytics',
  )
  assert.equal(resolveInitialRoute({ authenticated: true, admin: true }, '/analytics'), 'analytics')
  assert.equal(resolveInitialRoute({ authenticated: true, admin: true }, '/'), 'projects')
  assert.equal(resolveInitialRoute({ authenticated: true, admin: true }, '/admin'), 'admin-workforce')
  assert.equal(resolveInitialRoute({ authenticated: true, admin: true }, '/admin/llm'), 'admin-llm')
  assert.equal(
    resolveInitialRoute({ authenticated: true, admin: true }, '/admin/capabilities'),
    'admin-capabilities',
  )
  assert.equal(resolveInitialRoute({ authenticated: true, admin: true }, '/admin/access'), 'admin-access')
  assert.equal(resolveInitialRoute({ authenticated: true, admin: true }, '/admin/ops'), 'admin-ops')

  assert.equal(extractProjectIdFromPath('/projects'), null)
  assert.equal(extractProjectIdFromPath('/projects/proj-123'), 'proj-123')
  assert.equal(extractProjectIdFromPath('/inbox'), null)

  assert.equal(isAdminRoute('admin-ops'), true)
  assert.equal(isAdminRoute('projects'), false)
  assert.equal(adminSectionFromRoute('admin-access'), 'access')
  assert.equal(adminSectionFromRoute('admin-capabilities'), 'capabilities')
  assert.equal(routeFromAdminSection('ops'), 'admin-ops')

  assert.equal(resolveInitialView({ authenticated: false, admin: false }, '/admin'), 'login')
  assert.equal(resolveInitialView({ authenticated: true, admin: false }, '/admin'), 'my')
  assert.equal(resolveInitialView({ authenticated: true, admin: true }, '/admin'), 'admin')
  assert.equal(resolveInitialView({ authenticated: true, admin: true }, '/'), 'my')
})

test('apiFetch returns parsed JSON on success and surfaces FastAPI detail on HTTP errors', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  const ok = await apiFetch('/healthz')
  assert.deepEqual(ok, { status: 'ok' })

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: 'permission denied' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })

  await assert.rejects(() => apiFetch('/api/overview'), { message: 'permission denied' })
})

test('resolveSafeNextPath permits relative paths and rejects protocol/external URLs', () => {
  assert.equal(resolveSafeNextPath('/s/alice/'), '/s/alice/')
  assert.equal(resolveSafeNextPath('  /my?foo=1 '), '/my?foo=1')
  assert.equal(resolveSafeNextPath('//evil.com/phish'), null)
  assert.equal(resolveSafeNextPath('https://evil.com'), null)
  assert.equal(resolveSafeNextPath(''), null)
  assert.equal(resolveSafeNextPath(null), null)
})

test('slugifyOidcName normalizes names and rejects reserved route slugs', () => {
  assert.equal(slugifyOidcName('Keycloak Corp SSO'), 'keycloak-corp-sso')
  assert.equal(slugifyOidcName('  Okta_EU (Prod) '), 'okta-eu-prod')
  assert.equal(slugifyOidcName('start'), '')
  assert.equal(slugifyOidcName('callback'), '')
  assert.equal(slugifyOidcName('企业微信'), '')
})

test('plugin spec helpers parse, toggle, and deduplicate registry vs custom entries', () => {
  const registry = [
    { slug: 'sandbox-mesh', package_name: '@metis/sandbox-mesh' },
    { slug: 'work-delivery', package_name: '@metis/work-delivery' },
  ]

  assert.deepEqual(
    parsePluginSpec(' sandbox-mesh, , work-delivery , sandbox-mesh '),
    ['sandbox-mesh', 'work-delivery'],
  )
  assert.equal(matchesPlugin('@metis/sandbox-mesh', registry[0]), true)
  assert.equal(matchesPlugin('sandbox-mesh.tgz', registry[0]), true)

  // Toggling off removes matching package_name/tgz variants as well
  assert.equal(
    togglePluginToken('@metis/sandbox-mesh,custom-pkg', registry[0]),
    'custom-pkg',
  )
  assert.equal(togglePluginToken('custom-pkg', registry[0]), 'custom-pkg,sandbox-mesh')

  // Custom input matching an already-selected registry plugin by package_name does not duplicate
  assert.equal(
    mergeCustomPluginTokens(
      'sandbox-mesh',
      '@metis/sandbox-mesh, work-delivery.tgz, https://example.com/p.tgz',
      registry,
    ),
    'sandbox-mesh,work-delivery,https://example.com/p.tgz',
  )
})
