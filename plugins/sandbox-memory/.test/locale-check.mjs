import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_DIR } from './deps.mjs'
import * as clientLocale from '../src/client/locale.js'

for (const lang of ['en', 'zh']) {
  const manifestLocale = JSON.parse(readFileSync(join(PLUGIN_DIR, 'locale', `${lang}.json`), 'utf8'))
  assert.ok(typeof manifestLocale.name === 'string' && manifestLocale.name.trim())
  assert.ok(typeof manifestLocale.description === 'string' && manifestLocale.description.trim())
}

const enKeys = Object.keys(clientLocale.en).sort()
const zhKeys = Object.keys(clientLocale.zh).sort()
assert.deepEqual(zhKeys, enKeys, 'zh client locale keys must match en keys')
for (const key of enKeys) {
  assert.ok(typeof clientLocale.en[key] === 'string' && clientLocale.en[key].length > 0)
  assert.ok(typeof clientLocale.zh[key] === 'string' && clientLocale.zh[key].length > 0)
}
console.log('locale-check ok')
