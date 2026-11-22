import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const IGNORED_WORKSPACE_DIRS = new Set([
  'logs',
  'collab-space',
  'mesh-inbox',
  'node_modules',
  'venv',
  '__pycache__',
  'tmp',
  'dist',
  'build',
])

const MAX_PROJECTS = 18

function runCmdAsync(cmd, args, timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, stdout: String(stdout || ''), stderr: String(stderr || '') })
          return
        }
        resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') })
      })
      child.on('error', () => resolve({ ok: false, stdout: '', stderr: '' }))
    } catch {
      resolve({ ok: false, stdout: '', stderr: '' })
    }
  })
}

function readJsonSafe(filePath) {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function readTextSafe(filePath) {
  try {
    if (!existsSync(filePath)) return ''
    return readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

export function parseSupervisorConf(text, fallbackName = '') {
  const nameMatch = text.match(/^\s*\[program:([^\]]+)\]/m)
  const cmdMatch = text.match(/^\s*command\s*=\s*(.+)$/m)
  const dirMatch = text.match(/^\s*directory\s*=\s*(.+)$/m)
  const autoMatch = text.match(/^\s*autostart\s*=\s*(.+)$/m)
  return {
    name: (nameMatch?.[1] || fallbackName).trim(),
    command: (cmdMatch?.[1] || '').trim(),
    directory: (dirMatch?.[1] || '').trim(),
    autostart: autoMatch ? autoMatch[1].trim().toLowerCase() !== 'false' : true,
    status: 'configured',
  }
}

export function parseSupervisorStatusOutput(stdout) {
  const statusMap = new Map()
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const clean = line.trim()
    if (!clean) continue
    const match = clean.match(/^([a-zA-Z0-9_.:-]+)\s+([A-Z]+)\b/)
    if (match) {
      statusMap.set(match[1], match[2].toLowerCase())
    }
  }
  return statusMap
}

export function parseCaddyAppSnippet(text, fileName = '', publicOrigin = '') {
  const appLine = String(text || '').match(/^#\s*App:\s*([^\s]+)\s*->\s*([^\s]+)\s+mounted\s+at\s+([^\s]+)/m)
  if (!appLine) return null
  const name = appLine[1].trim() || basename(fileName, '.caddy')
  const target = appLine[2].trim()
  const mountPath = appLine[3].trim()
  const origin = String(publicOrigin || '').replace(/\/+$/, '')
  return {
    name,
    target,
    mountPath,
    publicUrl: origin ? `${origin}${mountPath}` : mountPath,
  }
}

function detectProjectStacks(dirPath) {
  const stacks = []
  let entries = []
  try {
    entries = readdirSync(dirPath)
  } catch {
    return stacks
  }
  const set = new Set(entries)
  if (set.has('package.json')) {
    if (set.has('tsconfig.json')) stacks.push('ts')
    else stacks.push('node')
  }
  if (set.has('pyproject.toml') || set.has('requirements.txt') || set.has('setup.py')) {
    stacks.push('python')
  }
  if (set.has('Cargo.toml')) stacks.push('rust')
  if (set.has('go.mod')) stacks.push('go')
  if (entries.some((f) => f.endsWith('.csproj') || f.endsWith('.sln'))) stacks.push('dotnet')
  if (set.has('Dockerfile') || set.has('docker-compose.yml') || set.has('compose.yml')) stacks.push('docker')
  if (set.has('.git')) stacks.push('git')
  return stacks.slice(0, 4)
}

export function createEnvironmentScanner({
  config = {},
  env = process.env,
  execCmd = runCmdAsync,
  onChange = null,
} = {}) {
  const homeDir = String(config.homeDir || env.HOME || '').trim() || homedir()
  const sandboxStateDir = String(config.sandboxStateDir || join(homeDir, '.dsh-sandbox'))
  const toolchainDir = String(config.toolchainDir || env.TOOLCHAIN_DIR || '/opt/toolchain')

  let cachedSnapshot = null
  let cachedToolchains = null
  let lastScanAt = 0
  let inflightScan = null
  let watchers = []
  let debounceTimer = null

  async function detectToolchains() {
    if (cachedToolchains && config.disableToolchainProbe !== true) {
      return cachedToolchains
    }
    const items = []
    if (config.disableToolchainProbe === true) {
      cachedToolchains = items
      return items
    }

    const probes = [
      { name: 'node', cmd: process.execPath || 'node', args: ['-v'], parse: (s) => s.trim().replace(/^v/, '') },
      { name: 'python3', cmd: 'python3', args: ['--version'], parse: (s) => s.replace(/^Python\s+/i, '').trim() },
      { name: 'uv', cmd: 'uv', args: ['--version'], parse: (s) => s.replace(/^uv\s+/i, '').trim().split(/\s+/)[0] },
      { name: 'pnpm', cmd: 'pnpm', args: ['--version'], parse: (s) => s.trim().split(/\s+/)[0] },
      { name: 'git', cmd: 'git', args: ['--version'], parse: (s) => s.replace(/^git version\s+/i, '').trim().split(/\s+/)[0] },
      { name: 'dotnet', cmd: 'dotnet', args: ['--version'], parse: (s) => s.trim().split(/\s+/)[0] },
      { name: 'go', cmd: 'go', args: ['version'], parse: (s) => (s.match(/go([0-9.]+)/) || [])[1] || '' },
      { name: 'rustc', cmd: 'rustc', args: ['--version'], parse: (s) => s.replace(/^rustc\s+/i, '').trim().split(/\s+/)[0] },
    ]

    const results = await Promise.all(
      probes.map(async (p) => {
        const res = await execCmd(p.cmd, p.args, 1200)
        if (!res.ok) return null
        const ver = p.parse(res.stdout || res.stderr || '')
        return ver ? { name: p.name, version: ver } : null
      }),
    )
    for (const r of results) {
      if (r) items.push(r)
    }

    // Also inspect /opt/toolchain subdirectories for custom build-time SDKs
    try {
      if (existsSync(toolchainDir)) {
        const known = new Set(items.map((x) => x.name.toLowerCase()))
        for (const entry of readdirSync(toolchainDir)) {
          if (entry.startsWith('.') || entry === 'bin' || entry === 'env.sh') continue
          const full = join(toolchainDir, entry)
          try {
            if (statSync(full).isDirectory() && !known.has(entry.toLowerCase())) {
              items.push({ name: entry, version: 'installed' })
            }
          } catch {}
        }
      }
    } catch {}

    cachedToolchains = items
    return items
  }

  function scanInfo() {
    const infoJson = readJsonSafe(join(sandboxStateDir, 'info.json')) || {}
    const publicOrigin = String(
      infoJson.public_origin
      || readTextSafe(join(sandboxStateDir, 'public-origin.txt')).trim()
      || env.SANDBOX_PUBLIC_ORIGIN
      || '',
    ).replace(/\/+$/, '')
    const basePath = String(
      infoJson.base_path
      ?? readTextSafe(join(sandboxStateDir, 'base-path.txt')).trim()
      ?? env.SANDBOX_BASE_PATH
      ?? '',
    ).replace(/\/+$/, '')
    const publicUrl = String(
      infoJson.public_url
      || readTextSafe(join(sandboxStateDir, 'public-url.txt')).trim()
      || env.SANDBOX_PUBLIC_URL
      || (publicOrigin ? `${publicOrigin}${basePath}/` : ''),
    )
    const appsBaseUrl = String(
      infoJson.apps_base_url
      || (publicOrigin ? `${publicOrigin}${basePath}/apps/` : `${basePath}/apps/`),
    )
    const portProxyBaseUrl = String(
      infoJson.port_proxy_base_url
      || (publicOrigin ? `${publicOrigin}${basePath}/p/` : `${basePath}/p/`),
    )
    const slugMatch = basePath.match(/^\/s\/([^/]+)/)
    return {
      slug: String(config.slug || slugMatch?.[1] || '').trim(),
      template: String(env.SANDBOX_TEMPLATE || '').trim(),
      homeDir,
      publicOrigin,
      basePath,
      publicUrl,
      appsBaseUrl,
      portProxyBaseUrl,
    }
  }

  function scanProjects() {
    const projects = []
    try {
      if (!existsSync(homeDir)) return projects
      const entries = readdirSync(homeDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !IGNORED_WORKSPACE_DIRS.has(d.name))
        .sort((a, b) => a.name.localeCompare(b.name))
      for (const dir of entries) {
        const fullPath = join(homeDir, dir.name)
        const stacks = detectProjectStacks(fullPath)
        projects.push({
          name: dir.name,
          path: fullPath,
          stacks,
        })
        if (projects.length >= MAX_PROJECTS) break
      }
    } catch {}
    return projects
  }

  async function scanServices() {
    const servicesDir = join(sandboxStateDir, 'services')
    const confDir = join(servicesDir, 'conf.d')
    const supConf = join(servicesDir, 'supervisord.conf')
    const supSock = join(servicesDir, 'supervisor.sock')
    const services = []

    try {
      if (existsSync(confDir)) {
        const files = readdirSync(confDir)
          .filter((f) => f.endsWith('.conf'))
          .sort()
        for (const f of files) {
          const parsed = parseSupervisorConf(readTextSafe(join(confDir, f)), basename(f, '.conf'))
          if (parsed.name) services.push(parsed)
        }
      }
    } catch {}

    if (services.length > 0 && existsSync(supConf) && existsSync(supSock)) {
      const res = await execCmd('supervisorctl', ['-c', supConf, 'status'], 1500)
      if (res.stdout) {
        const statusMap = parseSupervisorStatusOutput(res.stdout)
        for (const svc of services) {
          const live = statusMap.get(svc.name)
          if (live) svc.status = live
        }
      }
    }

    return services
  }

  function scanRoutes(publicOrigin) {
    const appsDir = join(sandboxStateDir, 'caddy', 'apps.d')
    const routes = []
    try {
      if (!existsSync(appsDir)) return routes
      const files = readdirSync(appsDir)
        .filter((f) => f.endsWith('.caddy') && f !== '00-empty.caddy')
        .sort()
      for (const f of files) {
        const parsed = parseCaddyAppSnippet(readTextSafe(join(appsDir, f)), f, publicOrigin)
        if (parsed) routes.push(parsed)
      }
    } catch {}
    return routes
  }

  function scanCron() {
    const cronFile = join(sandboxStateDir, 'crontab')
    const raw = readTextSafe(cronFile)
    if (!raw) return []
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .slice(0, 25)
  }

  async function refresh({ forceToolchains = false } = {}) {
    if (forceToolchains) cachedToolchains = null
    if (inflightScan) return inflightScan

    inflightScan = (async () => {
      const info = scanInfo()
      const [toolchains, services] = await Promise.all([
        detectToolchains(),
        scanServices(),
      ])
      const projects = scanProjects()
      const routes = scanRoutes(info.publicOrigin)
      const cron = scanCron()

      // Stable structural fingerprint (excludes scannedAt timestamp so cache stays warm)
      const fingerprint = JSON.stringify({ info, toolchains, projects, services, routes, cron })
      const changed = !cachedSnapshot || cachedSnapshot.fingerprint !== fingerprint

      cachedSnapshot = {
        info,
        toolchains,
        projects,
        services,
        routes,
        cron,
        fingerprint,
        scannedAt: Date.now(),
      }
      lastScanAt = cachedSnapshot.scannedAt
      if (changed && typeof onChange === 'function') {
        try { onChange(cachedSnapshot) } catch {}
      }
      return cachedSnapshot
    })().finally(() => {
      inflightScan = null
    })

    return inflightScan
  }

  function getCachedSnapshot() {
    if (cachedSnapshot) return cachedSnapshot
    // Fast synchronous baseline before first async scan finishes
    const info = scanInfo()
    const projects = scanProjects()
    const routes = scanRoutes(info.publicOrigin)
    const cron = scanCron()
    const servicesDir = join(sandboxStateDir, 'services', 'conf.d')
    const services = []
    try {
      if (existsSync(servicesDir)) {
        for (const f of readdirSync(servicesDir).filter((x) => x.endsWith('.conf')).sort()) {
          const parsed = parseSupervisorConf(readTextSafe(join(servicesDir, f)), basename(f, '.conf'))
          if (parsed.name) services.push(parsed)
        }
      }
    } catch {}
    const toolchains = cachedToolchains || []
    return {
      info,
      toolchains,
      projects,
      services,
      routes,
      cron,
      fingerprint: JSON.stringify({ info, toolchains, projects, services, routes, cron }),
      scannedAt: lastScanAt || Date.now(),
    }
  }

  function scheduleRefresh(delayMs = 1200) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void refresh()
    }, delayMs)
    debounceTimer.unref?.()
  }

  function startWatching() {
    if (config.disableWatchers === true) return
    const watchTargets = [
      join(sandboxStateDir, 'services', 'conf.d'),
      join(sandboxStateDir, 'caddy', 'apps.d'),
      sandboxStateDir,
    ]
    for (const dir of watchTargets) {
      if (!existsSync(dir)) continue
      try {
        const w = watch(dir, { persistent: false }, (_eventType, filename) => {
          const name = String(filename || '')
          if (dir === sandboxStateDir && name && !['crontab', 'info.json'].includes(name)) {
            return
          }
          scheduleRefresh(1000)
        })
        w.on('error', () => {})
        watchers.push(w)
      } catch {}
    }
  }

  function dispose() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    for (const w of watchers) {
      try { w.close() } catch {}
    }
    watchers = []
  }

  return {
    homeDir,
    sandboxStateDir,
    refresh,
    getCachedSnapshot,
    scheduleRefresh,
    startWatching,
    dispose,
  }
}
