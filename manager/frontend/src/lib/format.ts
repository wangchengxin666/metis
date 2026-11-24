import { apiFetch } from './client.ts'
import type { SandboxItem, SandboxStats } from '../types'

export function formatDiskSize(mb?: number | null): string {
  if (mb === null || mb === undefined || Number.isNaN(mb)) return '—'
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

export function computeDiskPercent(st?: SandboxStats | null, fallbackUsageMb?: number | null): number | null {
  if (!st) return null
  if (st.disk_fs_used_percent != null && !Number.isNaN(st.disk_fs_used_percent)) {
    return Math.max(0, Math.min(100, Math.round(st.disk_fs_used_percent)))
  }
  const usage = st.disk_usage_mb ?? fallbackUsageMb
  if (usage != null && st.disk_fs_total_mb && st.disk_fs_total_mb > 0) {
    return Math.max(0, Math.min(100, Math.round((usage / st.disk_fs_total_mb) * 100)))
  }
  return null
}

export async function fetchRunningStats(
  items: SandboxItem[],
  apiPrefix: '/api/sandboxes' | '/api/my/sandboxes',
  opts?: { includeDisk?: boolean },
): Promise<Record<string, SandboxStats>> {
  const running = items.filter((s) => s.status === 'running')
  if (running.length === 0) return {}
  const qs = opts?.includeDisk === false ? '?include_disk=false' : ''
  const entries = await Promise.all(
    running.map(async (s) => {
      try {
        const st = await apiFetch<SandboxStats>(`${apiPrefix}/${s.id}/stats${qs}`)
        return [s.id, st] as const
      } catch {
        return null
      }
    }),
  )
  const map: Record<string, SandboxStats> = {}
  for (const entry of entries) {
    if (entry) map[entry[0]] = entry[1]
  }
  return map
}

/** Merge newly fetched live stats with previous entries so disk fields survive fast CPU/RAM polls. */
export function mergeStatsMap(
  prev: Record<string, SandboxStats>,
  next: Record<string, SandboxStats>,
): Record<string, SandboxStats> {
  const merged: Record<string, SandboxStats> = {}
  for (const [id, st] of Object.entries(next)) {
    const old = prev[id]
    merged[id] = {
      ...st,
      disk_usage_bytes: st.disk_usage_bytes ?? old?.disk_usage_bytes ?? null,
      disk_usage_mb: st.disk_usage_mb ?? old?.disk_usage_mb ?? null,
      disk_fs_total_mb: st.disk_fs_total_mb ?? old?.disk_fs_total_mb ?? null,
      disk_fs_avail_mb: st.disk_fs_avail_mb ?? old?.disk_fs_avail_mb ?? null,
      disk_fs_used_percent: st.disk_fs_used_percent ?? old?.disk_fs_used_percent ?? null,
    }
  }
  return merged
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  if (typeof window !== 'undefined' && window.isSecureContext !== false && navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to execCommand fallback
    }
  }
  if (typeof document === 'undefined' || !document.createElement) return false
  const container = document.activeElement?.parentElement || document.body
  if (!container) return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.position = 'fixed'
  ta.style.top = '-9999px'
  ta.style.left = '-9999px'
  ta.style.opacity = '0'
  const prevFocus = document.activeElement as HTMLElement | null
  container.appendChild(ta)
  let ok = false
  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = Boolean(document.execCommand?.('copy'))
  } catch {
    ok = false
  } finally {
    ta.remove()
    try {
      prevFocus?.focus?.({ preventScroll: true })
    } catch {}
  }
  return ok
}

export function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}
