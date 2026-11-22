import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_DIR } from './deps.mjs'

const svg = readFileSync(join(PLUGIN_DIR, 'icon.svg'), 'utf8')
assert.ok(svg.includes('<svg') && svg.includes('</svg>'), 'icon.svg must be valid SVG')
assert.ok(!/<script/i.test(svg), 'icon.svg must not contain scripts')
console.log('icon-check ok')
