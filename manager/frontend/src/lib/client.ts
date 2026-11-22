export interface AuthSummary {
  authenticated: boolean
  admin: boolean
}

export type PortalView = 'admin' | 'my' | 'login'

/** Extract a human-readable message from FastAPI/Starlette error JSON payloads. */
export function parseApiErrorDetail(payload: unknown, fallbackStatus: number): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail
    if (typeof detail === 'string' && detail.trim()) {
      return detail
    }
    if (Array.isArray(detail)) {
      const joined = detail
        .map((item) => (item && typeof item === 'object' && 'msg' in item ? String((item as { msg: unknown }).msg) : ''))
        .filter(Boolean)
        .join('; ')
      if (joined) {
        return joined
      }
    }
  }
  return `HTTP ${fallbackStatus}`
}

/** Resolve a safe relative in-app redirect path from query string (e.g. `?next=/s/alice/`). */
export function resolveSafeNextPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null
  return trimmed
}

/** Suggest a URL-safe OIDC provider slug from a human display name. */
export function slugifyOidcName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 62)
  if (!slug || slug === 'start' || slug === 'callback') return ''
  return slug
}

/** Decide initial SPA view from auth state and current browser pathname. */
export function resolveInitialView(auth: AuthSummary, pathname: string): PortalView {
  if (!auth.authenticated) {
    return 'login'
  }
  if (pathname.startsWith('/my') || !auth.admin) {
    return 'my'
  }
  return 'admin'
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      msg = parseApiErrorDetail(data, res.status)
    } catch {
      // ignore invalid JSON error payloads
    }
    throw new Error(msg)
  }
  return res.json()
}
