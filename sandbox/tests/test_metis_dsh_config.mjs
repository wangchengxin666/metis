import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.resolve(__dirname, '../rootfs/usr/local/bin/metis-dsh-config')

function createTestEnv(withCustomTheme = true) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metis-dsh-config-'))
  // JSON is a valid YAML 1.2 subset, enabling offline testing without container-global yaml
  const stubYaml = path.join(tmp, 'yaml-stub.cjs')
  fs.writeFileSync(
    stubYaml,
    'module.exports = { parse: (s) => (s && s.trim() ? JSON.parse(s) : null), stringify: (v) => JSON.stringify(v, null, 2) + "\\n" }\n',
    'utf8',
  )
  const dshHome = path.join(tmp, '.dsh')
  const profileDir = path.join(dshHome, 'profiles', 'web')
  fs.mkdirSync(profileDir, { recursive: true })
  const deps = withCustomTheme ? { '@metis/custom-theme': '0.1.0' } : {}
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ dependencies: deps }), 'utf8')

  const run = (args, extraEnv = {}) =>
    execFileSync(process.execPath, [SCRIPT_PATH, ...args], {
      env: {
        ...process.env,
        HOME: tmp,
        DSH_HOME: dshHome,
        METIS_YAML_MODULE: stubYaml,
        ...extraEnv,
      },
      encoding: 'utf8',
    })

  return { tmp, dshHome, profileDir, run }
}

test('metis-dsh-config sync-market, sync-llm, and sync-theme write atomic valid config', () => {
  const { tmp, dshHome, profileDir, run } = createTestEnv(true)
  try {
    const outMarket = run(['sync-market'], {
      INDEX_URL: 'http://dsh-manager:9000/plugins/index.json',
      EXTRA_INDEXES: JSON.stringify(['https://extra.example/index.json']),
      NPM_REGISTRY: 'http://dsh-manager:9000/plugins/npm',
    })
    assert.match(outMarket, /INSTALLED_DEPS=\["@metis\/custom-theme"\]/)

    const outLlm = run(['sync-llm'], {
      LLM_PUSH_PAYLOAD: JSON.stringify({
        providerKey: 'mgr-abc123',
        credRef: 'DSH_LLM_MGR_ABC123_KEY',
        displayName: 'Test Model',
        apiProtocol: 'openai-completions',
        baseUrl: 'https://api.example.com/v1',
        model: 'deepseek-chat',
        apiKey: 'sk-test-secret',
        contextWindow: 128000,
        maxTokens: 16384,
        supportsImage: true,
        reasoningEffort: 'medium',
        thinkingFormat: 'deepseek',
        setAsDefault: true,
        replaceManaged: true,
      }),
    })
    assert.match(outLlm, /LLM_SYNC_OK:mgr-abc123:deepseek-chat/)

    const outTheme = run(['sync-theme'], {
      METIS_BRAND_THEME_JSON: JSON.stringify({
        primary: '#10b981',
        accent: '#0ea5e9',
        mode: 'light',
        brandTitle: 'Acme AI',
        brandLogoSvg: '<svg viewBox="0 0 24 24"></svg>',
      }),
    })
    assert.match(outTheme, /THEME_SYNC_OK/)

    const entries = JSON.parse(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'))
    const credDoc = JSON.parse(fs.readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8'))
    const npmrc = fs.readFileSync(path.join(profileDir, '.npmrc'), 'utf8')
    const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'))

    const market = entries.find((e) => e.id === 'plugin-market')
    assert.deepEqual(market.config.indexes, [
      'http://dsh-manager:9000/plugins/index.json',
      'https://extra.example/index.json',
    ])

    const llm = entries.find((e) => e.id === 'llm-pi-ai')
    assert.equal(llm.config.providers['mgr-abc123'].baseURL, 'https://api.example.com/v1')
    assert.equal(llm.config.providers['mgr-abc123'].compat.thinkingFormat, 'deepseek')

    const defModel = entries.find((e) => e.id === 'agent-default-model')
    assert.deepEqual(defModel.config, {
      provider: 'mgr-abc123',
      model: 'deepseek-chat',
      reasoningEffort: 'medium',
    })

    const theme = entries.find((e) => e.id === 'custom-theme')
    assert.equal(theme.config.managedBrand.primary, '#10b981')
    assert.equal(theme.config.managedBrand.brandTitle, 'Acme AI')

    assert.equal(credDoc.refs.DSH_LLM_MGR_ABC123_KEY, 'sk-test-secret')
    assert.match(npmrc, /^registry=http:\/\/dsh-manager:9000\/plugins\/npm/m)
    assert.ok(pkg.dsh.profile.bundles.includes('@deepseek-ai/dsh-experimental-plugin-market-bundle'))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('metis-dsh-config sync-theme skips when @metis/custom-theme is not installed', () => {
  const { tmp, profileDir, run } = createTestEnv(false)
  try {
    const out = run(['sync-theme'], {
      METIS_BRAND_THEME_JSON: JSON.stringify({ primary: '#6366f1', mode: 'dark' }),
    })
    assert.match(out, /THEME_SYNC_SKIPPED:not_installed/)
    assert.equal(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), false)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
