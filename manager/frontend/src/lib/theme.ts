import type { BrandThemeTokens } from '../types'

export const DEFAULT_BRAND_THEME: BrandThemeTokens = {
  mode: 'dark',
  primary: '#6366f1',
  accent: '#06b6d4',
  radius: 'rounded',
  font_scale: 'comfortable',
  layout_width: 'wide',
}

export interface ThemePresetItem {
  id: string
  label_zh: string
  label_en: string
  theme: BrandThemeTokens
}

export const THEME_PRESETS: ThemePresetItem[] = [
  {
    id: 'metis-dark',
    label_zh: 'Metis 暗夜流光',
    label_en: 'Metis Obsidian',
    theme: {
      mode: 'dark',
      primary: '#6366f1',
      accent: '#06b6d4',
      radius: 'rounded',
      font_scale: 'comfortable',
      layout_width: 'wide',
    },
  },
  {
    id: 'enterprise-light',
    label_zh: '企业明净白',
    label_en: 'Enterprise Light',
    theme: {
      mode: 'light',
      primary: '#2563eb',
      accent: '#0891b2',
      radius: 'rounded',
      font_scale: 'comfortable',
      layout_width: 'wide',
    },
  },
  {
    id: 'midnight-slate',
    label_zh: '深海商务蓝',
    label_en: 'Midnight Slate',
    theme: {
      mode: 'slate',
      primary: '#3b82f6',
      accent: '#38bdf8',
      radius: 'md',
      font_scale: 'comfortable',
      layout_width: 'wide',
    },
  },
  {
    id: 'emerald-dark',
    label_zh: '翡翠科技绿',
    label_en: 'Emerald Dark',
    theme: {
      mode: 'dark',
      primary: '#10b981',
      accent: '#14b8a6',
      radius: 'rounded',
      font_scale: 'comfortable',
      layout_width: 'wide',
    },
  },
  {
    id: 'warm-light',
    label_zh: '琥珀暖白',
    label_en: 'Warm Amber Light',
    theme: {
      mode: 'light',
      primary: '#d97706',
      accent: '#ea580c',
      radius: 'md',
      font_scale: 'comfortable',
      layout_width: 'wide',
    },
  },
]

const USER_MODE_STORAGE_KEY = 'metis_theme_mode_override'

export function getStoredThemeModeOverride(): 'dark' | 'light' | null {
  try {
    const val = window.localStorage.getItem(USER_MODE_STORAGE_KEY)
    if (val === 'dark' || val === 'light') return val
  } catch {}
  return null
}

export function setStoredThemeModeOverride(mode: 'dark' | 'light' | null): void {
  try {
    if (!mode) {
      window.localStorage.removeItem(USER_MODE_STORAGE_KEY)
    } else {
      window.localStorage.setItem(USER_MODE_STORAGE_KEY, mode)
    }
  } catch {}
}

export function contrastTextColor(hex: string): string {
  const clean = (hex || '').replace('#', '')
  if (clean.length !== 6) return '#ffffff'
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return '#ffffff'
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.64 ? '#09090b' : '#ffffff'
}

export function mergeBrandTheme(raw?: Partial<BrandThemeTokens> | null): BrandThemeTokens {
  return {
    mode: raw?.mode && ['dark', 'light', 'slate'].includes(raw.mode) ? raw.mode : DEFAULT_BRAND_THEME.mode,
    primary: raw?.primary && /^#[0-9a-fA-F]{6}$/.test(raw.primary) ? raw.primary : DEFAULT_BRAND_THEME.primary,
    accent: raw?.accent && /^#[0-9a-fA-F]{6}$/.test(raw.accent) ? raw.accent : DEFAULT_BRAND_THEME.accent,
    radius: raw?.radius && ['sharp', 'md', 'rounded', 'pill'].includes(raw.radius) ? raw.radius : DEFAULT_BRAND_THEME.radius,
    font_scale:
      raw?.font_scale && ['normal', 'comfortable', 'large'].includes(raw.font_scale)
        ? raw.font_scale
        : DEFAULT_BRAND_THEME.font_scale,
    layout_width:
      raw?.layout_width && ['standard', 'wide', 'full'].includes(raw.layout_width)
        ? raw.layout_width
        : DEFAULT_BRAND_THEME.layout_width,
  }
}

export function applyBrandTheme(
  rawTheme?: Partial<BrandThemeTokens> | null,
  userModeOverride?: 'dark' | 'light' | null,
): void {
  if (typeof document === 'undefined') return
  const theme = mergeBrandTheme(rawTheme)
  const effectiveMode = userModeOverride || theme.mode
  const root = document.documentElement

  root.setAttribute('data-theme', effectiveMode)

  const radiusMap = {
    sharp: ['4px', '6px', '8px'],
    md: ['6px', '8px', '12px'],
    rounded: ['8px', '10px', '16px'],
    pill: ['10px', '14px', '20px'],
  } as const
  const [rSm, rMd, rLg] = radiusMap[theme.radius]

  const widthMap = {
    standard: '1360px',
    wide: '1680px',
    full: '100%',
  } as const

  const fontSizeMap = {
    normal: '15px',
    comfortable: '16px',
    large: '17px',
  } as const

  root.style.setProperty('--brand-primary', theme.primary)
  root.style.setProperty('--brand-primary-fg', contrastTextColor(theme.primary))
  root.style.setProperty('--brand-accent', theme.accent)
  root.style.setProperty('--brand-radius-sm', rSm)
  root.style.setProperty('--brand-radius-md', rMd)
  root.style.setProperty('--brand-radius-lg', rLg)
  root.style.setProperty('--brand-max-width', widthMap[theme.layout_width])
  root.style.fontSize = fontSizeMap[theme.font_scale]
}

export interface SchedulePreset {
  cron: string
  label_zh: string
  label_en: string
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { cron: '0 9 * * *', label_zh: '每天 09:00', label_en: 'Daily at 09:00' },
  { cron: '0 9 * * 1-5', label_zh: '每个工作日 09:00', label_en: 'Weekdays at 09:00' },
  { cron: '0 18 * * 1-5', label_zh: '每个工作日 18:00', label_en: 'Weekdays at 18:00' },
  { cron: '0 9 * * 1', label_zh: '每周一 09:00', label_en: 'Every Monday 09:00' },
  { cron: '0 17 * * 5', label_zh: '每周五 17:00', label_en: 'Every Friday 17:00' },
  { cron: '0 * * * *', label_zh: '每小时整点', label_en: 'Every hour' },
]

export function formatScheduleHuman(cron: string, locale: 'zh-CN' | 'en'): string {
  const norm = (cron || '').trim().replace(/\s+/g, ' ')
  const preset = SCHEDULE_PRESETS.find((p) => p.cron === norm)
  if (preset) return locale === 'en' ? preset.label_en : preset.label_zh
  const parts = norm.split(' ')
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts
    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*') {
      const hhmm = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
      if (dow === '*') return locale === 'en' ? `Daily at ${hhmm}` : `每天 ${hhmm}`
      if (dow === '1-5') return locale === 'en' ? `Weekdays at ${hhmm}` : `每个工作日 ${hhmm}`
    }
  }
  return norm || (locale === 'en' ? 'Custom schedule' : '自定义计划')
}
