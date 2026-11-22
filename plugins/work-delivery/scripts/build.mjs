import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildClientBundle } from './bundle-client.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

buildClientBundle()
execFileSync(process.execPath, ['--check', join(ROOT, 'index.js')], { stdio: 'pipe' })
console.log('work-delivery build complete')
