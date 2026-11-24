export interface AuthSummary {
  authenticated: boolean
  admin: boolean
  is_team_lead?: boolean
}

export type AdminSection = 'workforce' | 'llm' | 'access' | 'ops'

export type AppRoute =
  | 'login'
  | 'projects'
  | 'inbox'
  | 'workforce'
  | 'analytics'
  | 'admin-workforce'
  | 'admin-llm'
  | 'admin-access'
  | 'admin-ops'

export type PortalView = 'admin' | 'my' | 'login'

const ADMIN_PATH_TO_ROUTE: Record<string, AppRoute> = {
  '/admin': 'admin-workforce',
  '/admin/workforce': 'admin-workforce',
  '/admin/llm': 'admin-llm',
  '/admin/access': 'admin-access',
  '/admin/ops': 'admin-ops',
}

export const ROUTE_TO_PATH: Record<AppRoute, string> = {
  login: '/login',
  projects: '/projects',
  inbox: '/inbox',
  workforce: '/workforce',
  analytics: '/analytics',
  'admin-workforce': '/admin/workforce',
  'admin-llm': '/admin/llm',
  'admin-access': '/admin/access',
  'admin-ops': '/admin/ops',
}

export function isAdminRoute(route: AppRoute): boolean {
  return route.startsWith('admin-')
}

export function adminSectionFromRoute(route: AppRoute): AdminSection {
  if (route === 'admin-llm') return 'llm'
  if (route === 'admin-access') return 'access'
  if (route === 'admin-ops') return 'ops'
  return 'workforce'
}

export function routeFromAdminSection(section: AdminSection): AppRoute {
  return `admin-${section}` as AppRoute
}

/** Extract `/projects/<id>` identifier if the current URL targets a specific Project workspace. */
export function extractProjectIdFromPath(pathname: string): string | null {
  const cleanPath = (pathname || '/').replace(/\/+$/, '') || '/'
  if (!cleanPath.startsWith('/projects/')) return null
  const seg = cleanPath.slice('/projects/'.length).split('/')[0]?.trim()
  return seg ? decodeURIComponent(seg) : null
}

/** Extract a human-readable message from FastAPI/Starlette error JSON payloads. */
export function parseApiErrorDetail(payload: unknown, fallbackStatus: number): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail
    if (typeof detail === 'string' && detail.trim()) {
      return detail
    }
    if (Array.isArray(detail)) {
      const joined = detail
        .map((item) =>
          item && typeof item === 'object' && 'msg' in item
            ? String((item as { msg: unknown }).msg)
            : '',
        )
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

/** Decide initial unified RBAC route from auth state and current browser pathname. */
export function resolveInitialRoute(auth: AuthSummary, pathname: string): AppRoute {
  if (!auth.authenticated) {
    return 'login'
  }
  const cleanPath = (pathname || '/').replace(/\/+$/, '') || '/'
  if (cleanPath.startsWith('/inbox')) {
    return 'inbox'
  }
  if (cleanPath.startsWith('/workforce')) {
    return 'workforce'
  }
  if (cleanPath.startsWith('/analytics')) {
    return auth.admin || auth.is_team_lead ? 'analytics' : 'projects'
  }
  if (cleanPath.startsWith('/admin')) {
    if (!auth.admin) {
      return 'projects'
    }
    return ADMIN_PATH_TO_ROUTE[cleanPath] || 'admin-workforce'
  }
  return 'projects'
}

export function resolveInitialView(auth: AuthSummary, pathname: string): PortalView {
  const route = resolveInitialRoute(auth, pathname)
  if (route === 'login') return 'login'
  if (isAdminRoute(route)) return 'admin'
  return 'my'
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
