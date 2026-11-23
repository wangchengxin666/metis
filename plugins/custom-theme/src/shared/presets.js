export const DEFAULT_PRESET_ID = 'aurora-blue'

export const CORE_TOKEN_DEFS = [
  { name: '--dsw-alias-bg-base', group: 'surface', labelKey: 'tokBgBase' },
  { name: '--dsw-specific-sidebar-fill', group: 'surface', labelKey: 'tokSidebarFill' },
  { name: '--dsw-alias-bg-layer-1', group: 'surface', labelKey: 'tokBgLayer1' },
  { name: '--dsw-alias-bg-layer-2', group: 'surface', labelKey: 'tokBgLayer2' },
  { name: '--dsw-specific-input-major', group: 'surface', labelKey: 'tokInputMajor' },
  { name: '--dsw-specific-bubble', group: 'surface', labelKey: 'tokBubble' },
  { name: '--dsw-specific-sidebar-nav-item-active', group: 'surface', labelKey: 'tokNavActive' },
  { name: '--dsw-alias-border-l2', group: 'surface', labelKey: 'tokBorderL2' },
  { name: '--dsw-alias-brand-primary', group: 'accent', labelKey: 'tokBrandPrimary' },
  { name: '--dsw-alias-link', group: 'accent', labelKey: 'tokLinkAccent' },
  { name: '--dsw-alias-state-business-primary', group: 'accent', labelKey: 'tokBusinessPrimary' },
  { name: '--dsw-alias-label-primary', group: 'text', labelKey: 'tokLabelPrimary' },
  { name: '--dsw-alias-label-secondary', group: 'text', labelKey: 'tokLabelSecondary' },
  { name: '--dsw-alias-markdown-code-block', group: 'text', labelKey: 'tokCodeBlock' },
]

export const THEME_PRESETS = [
  {
    id: 'aurora-blue',
    nameKey: 'presetAurora',
    preview: {
      light: { bg: '#f8fafc', sidebar: '#f1f5f9', accent: '#2563eb' },
      dark: { bg: '#0f1420', sidebar: '#0b101b', accent: '#60a5fa' },
    },
    tokens: {
      '--dsw-alias-bg-base': { light: '#f8fafc', dark: '#0f1420' },
      '--dsw-specific-sidebar-fill': { light: '#f1f5f9', dark: '#0b101b' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#161c2c' },
      '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#1b2336' },
      '--dsw-specific-input-major': { light: '#ffffff', dark: '#161c2c' },
      '--dsw-specific-bubble': { light: '#e0ecff', dark: '#1e3a5f' },
      '--dsw-specific-sidebar-nav-item-active': { light: '#dbeafe', dark: '#1e293b' },
      '--dsw-alias-border-l2': { light: '#cbd5e1', dark: '#2a344a' },
      '--dsw-alias-brand-primary': { light: '#1d4ed8', dark: '#bfdbfe' },
      '--dsw-alias-link': { light: '#2563eb', dark: '#60a5fa' },
      '--dsw-alias-state-business-primary': { light: '#2563eb', dark: '#60a5fa' },
      '--dsw-alias-label-primary': { light: '#0f172a', dark: '#f1f5f9' },
      '--dsw-alias-label-secondary': { light: '#475569', dark: '#94a3b8' },
      '--dsw-alias-markdown-code-block': { light: '#f1f5f9', dark: '#131926' },
    },
  },
  {
    id: 'emerald-forest',
    nameKey: 'presetEmerald',
    preview: {
      light: { bg: '#f7faf8', sidebar: '#eef5f0', accent: '#059669' },
      dark: { bg: '#0c1613', sidebar: '#08110e', accent: '#34d399' },
    },
    tokens: {
      '--dsw-alias-bg-base': { light: '#f7faf8', dark: '#0c1613' },
      '--dsw-specific-sidebar-fill': { light: '#eef5f0', dark: '#08110e' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#12211c' },
      '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#162923' },
      '--dsw-specific-input-major': { light: '#ffffff', dark: '#12211c' },
      '--dsw-specific-bubble': { light: '#d1fae5', dark: '#134e3a' },
      '--dsw-specific-sidebar-nav-item-active': { light: '#d1fae5', dark: '#17362b' },
      '--dsw-alias-border-l2': { light: '#cbd9d0', dark: '#223d33' },
      '--dsw-alias-brand-primary': { light: '#047857', dark: '#a7f3d0' },
      '--dsw-alias-link': { light: '#059669', dark: '#34d399' },
      '--dsw-alias-state-business-primary': { light: '#059669', dark: '#34d399' },
      '--dsw-alias-label-primary': { light: '#0f241c', dark: '#ecfdf5' },
      '--dsw-alias-label-secondary': { light: '#466155', dark: '#8fb3a2' },
      '--dsw-alias-markdown-code-block': { light: '#eef5f0', dark: '#0f1c18' },
    },
  },
  {
    id: 'sunset-amber',
    nameKey: 'presetAmber',
    preview: {
      light: { bg: '#fdfaf6', sidebar: '#f7f1e7', accent: '#d97706' },
      dark: { bg: '#171311', sidebar: '#110e0c', accent: '#f59e0b' },
    },
    tokens: {
      '--dsw-alias-bg-base': { light: '#fdfaf6', dark: '#171311' },
      '--dsw-specific-sidebar-fill': { light: '#f7f1e7', dark: '#110e0c' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#211b17' },
      '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#29211c' },
      '--dsw-specific-input-major': { light: '#ffffff', dark: '#211b17' },
      '--dsw-specific-bubble': { light: '#fef3c7', dark: '#4c3214' },
      '--dsw-specific-sidebar-nav-item-active': { light: '#fde68a', dark: '#36271b' },
      '--dsw-alias-border-l2': { light: '#e5d9c6', dark: '#3d3027' },
      '--dsw-alias-brand-primary': { light: '#b45309', dark: '#fde68a' },
      '--dsw-alias-link': { light: '#d97706', dark: '#f59e0b' },
      '--dsw-alias-state-business-primary': { light: '#d97706', dark: '#f59e0b' },
      '--dsw-alias-label-primary': { light: '#231b15', dark: '#faf3eb' },
      '--dsw-alias-label-secondary': { light: '#6e5c4c', dark: '#b5a392' },
      '--dsw-alias-markdown-code-block': { light: '#f7f1e7', dark: '#1c1714' },
    },
  },
  {
    id: 'midnight-purple',
    nameKey: 'presetPurple',
    preview: {
      light: { bg: '#faf8ff', sidebar: '#f3effd', accent: '#7c3aed' },
      dark: { bg: '#13111c', sidebar: '#0e0c15', accent: '#a78bfa' },
    },
    tokens: {
      '--dsw-alias-bg-base': { light: '#faf8ff', dark: '#13111c' },
      '--dsw-specific-sidebar-fill': { light: '#f3effd', dark: '#0e0c15' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#1b1829' },
      '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#231f35' },
      '--dsw-specific-input-major': { light: '#ffffff', dark: '#1b1829' },
      '--dsw-specific-bubble': { light: '#ede9fe', dark: '#3b2c68' },
      '--dsw-specific-sidebar-nav-item-active': { light: '#e4ddfe', dark: '#2d2647' },
      '--dsw-alias-border-l2': { light: '#ddd6f3', dark: '#342e4f' },
      '--dsw-alias-brand-primary': { light: '#6d28d9', dark: '#ddd6fe' },
      '--dsw-alias-link': { light: '#7c3aed', dark: '#a78bfa' },
      '--dsw-alias-state-business-primary': { light: '#7c3aed', dark: '#a78bfa' },
      '--dsw-alias-label-primary': { light: '#1a1529', dark: '#f3effd' },
      '--dsw-alias-label-secondary': { light: '#5c527a', dark: '#a398c4' },
      '--dsw-alias-markdown-code-block': { light: '#f3effd', dark: '#171424' },
    },
  },
  {
    id: 'monochrome-pro',
    nameKey: 'presetMono',
    preview: {
      light: { bg: '#ffffff', sidebar: '#f4f4f5', accent: '#18181b' },
      dark: { bg: '#09090b', sidebar: '#0e0e11', accent: '#e4e4e7' },
    },
    tokens: {
      '--dsw-alias-bg-base': { light: '#ffffff', dark: '#09090b' },
      '--dsw-specific-sidebar-fill': { light: '#f4f4f5', dark: '#0e0e11' },
      '--dsw-alias-bg-layer-1': { light: '#fafafa', dark: '#141417' },
      '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#1b1b1f' },
      '--dsw-specific-input-major': { light: '#ffffff', dark: '#141417' },
      '--dsw-specific-bubble': { light: '#f4f4f5', dark: '#27272a' },
      '--dsw-specific-sidebar-nav-item-active': { light: '#e4e4e7', dark: '#27272a' },
      '--dsw-alias-border-l2': { light: '#d4d4d8', dark: '#27272a' },
      '--dsw-alias-brand-primary': { light: '#18181b', dark: '#f4f4f5' },
      '--dsw-alias-link': { light: '#27272a', dark: '#d4d4d8' },
      '--dsw-alias-state-business-primary': { light: '#18181b', dark: '#e4e4e7' },
      '--dsw-alias-label-primary': { light: '#09090b', dark: '#fafafa' },
      '--dsw-alias-label-secondary': { light: '#52525b', dark: '#a1a1aa' },
      '--dsw-alias-markdown-code-block': { light: '#f4f4f5', dark: '#121215' },
    },
  },
]

export const BRAND_SVG_PRESETS = [
  {
    id: 'none',
    labelKey: 'brandSvgDefault',
    svg: '',
  },
  {
    id: 'spark',
    labelKey: 'brandSvgSpark',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="6" fill="#2563EB"/><path d="M12 5.5L13.8 10.2L18.5 12L13.8 13.8L12 18.5L10.2 13.8L5.5 12L10.2 10.2L12 5.5Z" fill="#FFFFFF"/></svg>',
  },
  {
    id: 'terminal',
    labelKey: 'brandSvgTerminal',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="6" fill="#0F172A"/><path d="M7.5 9L11 12L7.5 15" stroke="#38BDF8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 15H16.5" stroke="#E2E8F0" stroke-width="2" stroke-linecap="round"/></svg>',
  },
  {
    id: 'hexagon',
    labelKey: 'brandSvgHex',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path d="M12 2.5L20 7.1V16.9L12 21.5L4 16.9V7.1L12 2.5Z" fill="#7C3AED"/><circle cx="12" cy="12" r="3.2" fill="#FFFFFF"/></svg>',
  },
]

const CSS_VAR_RE = /^--[A-Za-z0-9_-]{1,80}$/
const DISALLOWED_CSS_VAL_RE = /[;{}\r\n]|<\/style|url\s*\(|expression\s*\(/i
const DISALLOWED_SVG_RE = /<(script|foreignObject|style|iframe|object|embed)\b|javascript:|\bon[a-z]+\s*=/i

export function findPreset(presetId) {
  return THEME_PRESETS.find((item) => item.id === presetId) || THEME_PRESETS[0]
}

export function clonePresetTokens(presetId) {
  const preset = findPreset(presetId)
  const out = {}
  for (const [token, pair] of Object.entries(preset.tokens)) {
    out[token] = { light: pair.light, dark: pair.dark }
  }
  return out
}

export function isValidCssVarName(name) {
  return typeof name === 'string' && CSS_VAR_RE.test(name.trim())
}

export function sanitizeCssValue(value) {
  if (typeof value !== 'string') return ''
  const cleaned = value.trim()
  if (!cleaned || cleaned.length > 120) return ''
  if (DISALLOWED_CSS_VAL_RE.test(cleaned)) return ''
  return cleaned
}

export function sanitizeBrandSvg(svgText) {
  if (typeof svgText !== 'string') return ''
  const trimmed = svgText.trim()
  if (!trimmed || trimmed.length > 16384) return ''
  if (!/^<svg\b/i.test(trimmed) || !trimmed.toLowerCase().includes('</svg>')) return ''
  if (!/\bviewBox\s*=/i.test(trimmed)) return ''
  if (DISALLOWED_SVG_RE.test(trimmed)) return ''
  return trimmed
}

export function buildDefaultThemeState() {
  return {
    version: 1,
    enabled: true,
    presetId: DEFAULT_PRESET_ID,
    tokens: clonePresetTokens(DEFAULT_PRESET_ID),
    customTokens: [],
    brand: {
      enabled: false,
      name: '',
      iconSvg: '',
    },
  }
}

export function applyManagedBrandToState(baseState, managedBrand) {
  const next = normalizeThemeState(baseState || buildDefaultThemeState())
  if (!managedBrand || typeof managedBrand !== 'object') {
    return next
  }
  const primary = sanitizeCssValue(managedBrand.primary)
  const accent = sanitizeCssValue(managedBrand.accent)
  if (primary) {
    next.tokens['--dsw-alias-brand-primary'] = {
      light: primary,
      dark: accent || primary,
    }
    next.tokens['--dsw-alias-state-business-primary'] = {
      light: primary,
      dark: accent || primary,
    }
  }
  if (accent || primary) {
    next.tokens['--dsw-alias-link'] = {
      light: primary || accent,
      dark: accent || primary,
    }
  }
  const brandTitle = typeof managedBrand.brandTitle === 'string'
    ? managedBrand.brandTitle.trim().slice(0, 48)
    : ''
  const brandLogoSvg = sanitizeBrandSvg(managedBrand.brandLogoSvg)
  if (brandTitle || brandLogoSvg) {
    next.brand = {
      enabled: true,
      name: brandTitle,
      iconSvg: brandLogoSvg,
    }
  }
  return next
}

export function normalizeThemeState(input) {
  const defaults = buildDefaultThemeState()
  if (!input || typeof input !== 'object') {
    return defaults
  }

  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true
  const preset = THEME_PRESETS.find((p) => p.id === input.presetId)
    ? input.presetId
    : (input.presetId === 'custom' ? 'custom' : DEFAULT_PRESET_ID)

  const baseTokens = clonePresetTokens(preset === 'custom' ? DEFAULT_PRESET_ID : preset)
  const tokens = { ...baseTokens }

  if (input.tokens && typeof input.tokens === 'object') {
    for (const def of CORE_TOKEN_DEFS) {
      const candidate = input.tokens[def.name]
      if (!candidate || typeof candidate !== 'object') continue
      const light = sanitizeCssValue(candidate.light) || tokens[def.name].light
      const dark = sanitizeCssValue(candidate.dark) || tokens[def.name].dark
      tokens[def.name] = { light, dark }
    }
  }

  const seenCustom = new Set(Object.keys(tokens))
  const customTokens = []
  if (Array.isArray(input.customTokens)) {
    for (const row of input.customTokens) {
      if (!row || typeof row !== 'object') continue
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      if (!isValidCssVarName(name) || seenCustom.has(name)) continue
      const light = sanitizeCssValue(row.light)
      const dark = sanitizeCssValue(row.dark)
      if (!light && !dark) continue
      seenCustom.add(name)
      customTokens.push({
        name,
        light: light || dark,
        dark: dark || light,
      })
    }
  }

  const rawBrand = input.brand && typeof input.brand === 'object' ? input.brand : {}
  const brand = {
    enabled: Boolean(rawBrand.enabled),
    name: typeof rawBrand.name === 'string' ? rawBrand.name.trim().slice(0, 48) : '',
    iconSvg: sanitizeBrandSvg(rawBrand.iconSvg),
  }

  return {
    version: 1,
    enabled,
    presetId: preset,
    tokens,
    customTokens,
    brand,
  }
}

export function compileTokenOverrides(state) {
  if (!state || !state.enabled) return {}
  const out = {}
  if (state.tokens && typeof state.tokens === 'object') {
    for (const [name, pair] of Object.entries(state.tokens)) {
      if (!isValidCssVarName(name) || !pair) continue
      const light = sanitizeCssValue(pair.light)
      const dark = sanitizeCssValue(pair.dark)
      if (!light || !dark) continue
      out[name] = { light, dark }
    }
  }
  if (Array.isArray(state.customTokens)) {
    for (const row of state.customTokens) {
      if (!row || !isValidCssVarName(row.name)) continue
      const light = sanitizeCssValue(row.light)
      const dark = sanitizeCssValue(row.dark)
      if (!light || !dark) continue
      out[row.name.trim()] = { light, dark }
    }
  }
  return out
}

export function buildFirstPaintCss(state) {
  const overrides = compileTokenOverrides(state)
  const entries = Object.entries(overrides)
  if (entries.length === 0) return ''
  const lightDecls = entries.map(([k, v]) => `  ${k}: ${v.light};`).join('\n')
  const darkDecls = entries.map(([k, v]) => `  ${k}: ${v.dark};`).join('\n')
  return [
    'html body {',
    lightDecls,
    '}',
    'html body[data-ds-dark-theme] {',
    darkDecls,
    '}',
  ].join('\n')
}
