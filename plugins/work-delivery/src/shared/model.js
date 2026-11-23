export const APP_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/
export const SERVICE_NAME_RE = /^[a-z0-9_-]{1,48}$/

export function normalizeAppName(raw) {
  return String(raw || '').trim().toLowerCase()
}

export function normalizeServiceName(raw) {
  return String(raw || '').trim()
}

export function formatBytes(bytes) {
  const n = Number(bytes || 0)
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
