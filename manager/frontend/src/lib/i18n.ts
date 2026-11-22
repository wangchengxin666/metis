import { en } from './locales/en.ts'
import { zhCN } from './locales/zh-CN.ts'
import type { MessageKey } from './locales/zh-CN.ts'

export type { MessageKey }

export type Locale = 'zh-CN' | 'en'

export const LOCALE_STORAGE_KEY = 'dsh_manager_locale'
export const DEFAULT_LOCALE: Locale = 'zh-CN'

export interface StorageReader {
  getItem(key: string): string | null
}

export interface StorageWriter {
  setItem(key: string, value: string): void
}

export interface DetectLocaleOptions {
  storage?: StorageReader | null
  navigatorLanguage?: string | null
  navigatorLanguages?: readonly string[] | null
}

/**
 * Normalize raw locale identifiers (e.g. "zh", "zh-Hans", "en-US") into supported locales.
 */
export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  return null
}

/**
 * Resolve the initial UI locale from persisted storage first, then browser preferences.
 */
export function detectInitialLocale(options: DetectLocaleOptions = {}): Locale {
  let storage = options.storage
  if (storage === undefined) {
    try {
      storage = typeof globalThis !== 'undefined' ? (globalThis.localStorage ?? null) : null
    } catch {
      storage = null
    }
  }

  if (storage) {
    try {
      const saved = normalizeLocale(storage.getItem(LOCALE_STORAGE_KEY))
      if (saved) return saved
    } catch {
      // Ignore storage access errors in restricted browser contexts.
    }
  }

  const candidates: string[] = []
  if (options.navigatorLanguages !== undefined) {
    if (options.navigatorLanguages) {
      candidates.push(...options.navigatorLanguages)
    }
  } else if (typeof globalThis !== 'undefined' && globalThis.navigator?.languages) {
    candidates.push(...globalThis.navigator.languages)
  }

  if (options.navigatorLanguage !== undefined) {
    if (options.navigatorLanguage) {
      candidates.push(options.navigatorLanguage)
    }
  } else if (typeof globalThis !== 'undefined' && globalThis.navigator?.language) {
    candidates.push(globalThis.navigator.language)
  }

  for (const candidate of candidates) {
    const matched = normalizeLocale(candidate)
    if (matched) return matched
  }

  return DEFAULT_LOCALE
}

/**
 * Persist the selected locale in browser storage when available.
 */
export function persistLocale(locale: Locale, storage?: StorageWriter | null): void {
  let target = storage
  if (target === undefined) {
    try {
      target = typeof globalThis !== 'undefined' ? (globalThis.localStorage ?? null) : null
    } catch {
      target = null
    }
  }
  if (!target) return
  try {
    target.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Ignore storage quota / privacy mode errors.
  }
}

/**
 * Pick localized API text fields such as plugin display names and descriptions.
 */
export function pickLocalizedText(
  locale: Locale,
  zhText?: string | null,
  enText?: string | null,
  fallback = '',
): string {
  if (locale === 'en') {
    return enText || zhText || fallback
  }
  return zhText || enText || fallback
}


export const translations: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  en,
}

/**
 * Translate a container status code when known, falling back to the raw value.
 */
export function localizeStatus(locale: Locale, status: string): string {
  const key = `status.${status}`
  const dict = translations[locale] ?? translations[DEFAULT_LOCALE]
  if (Object.prototype.hasOwnProperty.call(dict, key)) {
    return dict[key as MessageKey]
  }
  return status
}

/**
 * Translate a container lifecycle action name.
 */
export function localizeAction(
  locale: Locale,
  action: 'start' | 'stop' | 'restart' | 'recreate',
): string {
  return translate(locale, `action.${action}` as MessageKey)
}

/**
 * Translate a message key for the active locale with optional `{name}` interpolation.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number | null | undefined>,
): string {
  const dict = translations[locale] ?? translations[DEFAULT_LOCALE]
  const template = dict[key] ?? translations[DEFAULT_LOCALE][key] ?? key
  if (!vars) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name] ?? '')
    }
    return match
  })
}
