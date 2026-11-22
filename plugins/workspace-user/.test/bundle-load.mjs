import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { PLUGIN_DIR, importExternal } from './deps.mjs'
import { renderClientBundle } from '../scripts/bundle-client.mjs'

const builtBefore = readFileSync(join(PLUGIN_DIR, 'client.js'), 'utf8')
const builtExpected = renderClientBundle()
assert.equal(builtExpected, builtBefore, 'client.js was out of date relative to src/client/*')
const builtAfter = builtBefore

const pkg = JSON.parse(readFileSync(join(PLUGIN_DIR, 'package.json'), 'utf8'))
assert.equal(pkg.exports['./client'], './client.js')
assert.equal(pkg.dsh?.client?.platform, 'web')

const react = await importExternal('react')
const reactDom = await importExternal('react-dom')

let registered = null
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(entry) {
        registered = entry
      },
    },
  },
}
vm.runInNewContext(builtAfter, sandbox, { filename: 'client.js' })

assert.ok(registered, 'window.__ModuleLoader__.load was not called')
assert.equal(registered.id, '@metis/workspace-user')
assert.equal(typeof registered.factory, 'function')

const mod = registered.factory((spec) => {
  if (spec === 'react') return react.default || react
  if (spec === 'react-dom') return reactDom.default || reactDom
  throw new Error(`Unexpected external require: ${spec}`)
})

assert.deepEqual([...mod.inject], ['slots', 'locale'])
assert.equal(typeof mod.apply, 'function')
console.log('bundle-load ok')
