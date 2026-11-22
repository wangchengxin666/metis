import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_DIR } from './deps.mjs'

const iconPkg = readFileSync(join(PLUGIN_DIR, 'icon.svg'), 'utf8')
const iconMirror = readFileSync(join(PLUGIN_DIR, '..', 'icons', 'sandbox-memory.svg'), 'utf8')

assert.equal(iconPkg, iconMirror, 'plugins/icons/sandbox-memory.svg must match plugins/sandbox-memory/icon.svg')
assert.match(iconPkg, /^<svg\b[^>]*viewBox="0 0 36 36"/, 'SVG must have viewBox="0 0 36 36"')
for (const forbidden of ['<script', '<text', '<image', '<foreignObject', '<style', 'onload']) {
  assert.ok(!iconPkg.toLowerCase().includes(forbidden.toLowerCase()), `Forbidden SVG content: ${forbidden}`)
}
console.log('icon-check ok')
