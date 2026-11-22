import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_DIR = dirname(TEST_DIR)

function candidateNodeModules() {
  const candidates = []
  for (const envKey of ['DSH_RUNTIME_DIR', 'DSH_INSTALL_DIR']) {
    const val = process.env[envKey]
    if (val) {
      candidates.push(resolve(val, 'node_modules'))
      candidates.push(resolve(val))
    }
  }
  candidates.push(join(PLUGIN_DIR, 'node_modules'))
  const appDataScratch = process.env.USERPROFILE
    ? join(
        process.env.USERPROFILE,
        '.gemini',
        'antigravity',
        'brain',
        '7195499d-038c-48bc-87ec-2d8642afd2c4',
        'scratch',
        'dsh-runtime',
        'node_modules',
      )
    : ''
  if (appDataScratch) candidates.push(appDataScratch)
  candidates.push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules')
  candidates.push('/usr/local/lib/node_modules')
  return candidates.filter((dir) => dir && existsSync(dir))
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ESC[ch])
const VOID_TAGS = new Set(['img', 'input', 'br', 'hr'])

function renderNode(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(renderNode).join('')
  if (typeof node !== 'object') return esc(node)
  const { type, props = {} } = node
  if (typeof type === 'function') return renderNode(type(props))
  if (typeof type !== 'string') return renderNode(props.children)
  const attrs = []
  for (const [k, v] of Object.entries(props)) {
    if (k === 'children' || k === 'key' || k === 'ref' || v == null || v === false || typeof v === 'function') continue
    if (k === 'style' && typeof v === 'object') {
      const css = Object.entries(v).map(([sk, sv]) => `${sk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${sv}`).join(';')
      if (css) attrs.push(`style="${esc(css)}"`)
      continue
    }
    const attrName = k === 'className' ? 'class' : k
    attrs.push(v === true ? attrName : `${attrName}="${esc(v)}"`)
  }
  const open = `<${type}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`
  if (VOID_TAGS.has(type)) return open
  return `${open}${renderNode(props.children)}</${type}>`
}

const FALLBACK_REACT = {
  Fragment: Symbol.for('react.fragment'),
  createElement: (type, props, ...children) => ({
    type,
    props: { ...(props || {}), children: children.length <= 1 ? children[0] : children },
  }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: (init) => ({ current: init }),
  useCallback: (fn) => fn,
}

export async function importExternal(pkgName) {
  const parts = pkgName.split('/')
  const rootPkg = pkgName.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  for (const base of candidateNodeModules()) {
    const pkgDir = join(base, ...rootPkg.split('/'))
    if (!existsSync(pkgDir)) continue
    try {
      const req = createRequire(join(base, 'package.json'))
      const entry = req.resolve(pkgName)
      return import(pathToFileURL(entry).href)
    } catch {
      continue
    }
  }
  try {
    return await import(pkgName)
  } catch (err) {
    if (pkgName === 'react') return { default: FALLBACK_REACT, ...FALLBACK_REACT }
    if (pkgName === 'react-dom') return { default: { createPortal: (n) => n }, createPortal: (n) => n }
    if (pkgName === 'react-dom/server') return { renderToStaticMarkup: renderNode, default: { renderToStaticMarkup: renderNode } }
    throw err
  }
}
