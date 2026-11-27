import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  detectInitialLocale,
  localizeAction,
  localizeStatus,
  normalizeLocale,
  persistLocale,
  pickLocalizedText,
  translate,
  translations,
} from './i18n.ts'

test('normalizeLocale maps zh and en variants', () => {
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN')
  assert.equal(normalizeLocale('ZH-hans'), 'zh-CN')
  assert.equal(normalizeLocale('zh'), 'zh-CN')
  assert.equal(normalizeLocale('en'), 'en')
  assert.equal(normalizeLocale('en-US'), 'en')
  assert.equal(normalizeLocale('  EN-GB '), 'en')
  assert.equal(normalizeLocale('fr-FR'), null)
  assert.equal(normalizeLocale(''), null)
  assert.equal(normalizeLocale(null), null)
})

test('detectInitialLocale prefers persisted storage over navigator settings', () => {
  const storage = {
    getItem(key) {
      return key === LOCALE_STORAGE_KEY ? 'en' : null
    },
  }

  assert.equal(
    detectInitialLocale({
      storage,
      navigatorLanguages: ['zh-CN'],
      navigatorLanguage: 'zh-CN',
    }),
    'en',
  )
})

test('detectInitialLocale falls back to navigator languages then default', () => {
  const emptyStorage = { getItem: () => null }
  assert.equal(
    detectInitialLocale({
      storage: emptyStorage,
      navigatorLanguages: ['fr-FR', 'en-US'],
      navigatorLanguage: 'zh-CN',
    }),
    'en',
  )
  assert.equal(
    detectInitialLocale({
      storage: emptyStorage,
      navigatorLanguages: [],
      navigatorLanguage: 'ja-JP',
    }),
    DEFAULT_LOCALE,
  )

  const throwingStorage = {
    getItem() {
      throw new Error('blocked')
    },
  }
  assert.equal(
    detectInitialLocale({
      storage: throwingStorage,
      navigatorLanguages: ['en-GB'],
      navigatorLanguage: null,
    }),
    'en',
  )
})

test('persistLocale writes key safely and ignores storage errors', () => {
  const saved = new Map()
  persistLocale('en', {
    setItem(k, v) {
      saved.set(k, v)
    },
  })
  assert.equal(saved.get(LOCALE_STORAGE_KEY), 'en')

  assert.doesNotThrow(() => {
    persistLocale('zh-CN', {
      setItem() {
        throw new Error('quota exceeded')
      },
    })
  })
})

test('pickLocalizedText selects preferred language with fallback', () => {
  assert.equal(pickLocalizedText('zh-CN', '文件管理', 'File Manager'), '文件管理')
  assert.equal(pickLocalizedText('en', '文件管理', 'File Manager'), 'File Manager')
  assert.equal(pickLocalizedText('en', '仅中文', ''), '仅中文')
  assert.equal(pickLocalizedText('zh-CN', '', '', 'fallback'), 'fallback')
})

test('translate formats placeholders and preserves full key parity', () => {
  assert.equal(
    translate('zh-CN', 'admin.sandboxProvisioned', { email: 'alice@example.com' }),
    '数字员工已分配给 alice@example.com',
  )
  assert.equal(
    translate('en', 'admin.sandboxProvisioned', { email: 'alice@example.com' }),
    'Digital employee provisioned for alice@example.com',
  )
  assert.equal(
    translate('en', 'admin.users.sandboxCount', { count: 3 }),
    '3 employee(s)',
  )

  const zhKeys = Object.keys(translations['zh-CN']).sort()
  const enKeys = Object.keys(translations.en).sort()
  assert.deepEqual(enKeys, zhKeys)
})

test('localizeStatus and localizeAction localize known states and preserve unknown statuses', () => {
  assert.equal(localizeStatus('zh-CN', 'running'), '运行中')
  assert.equal(localizeStatus('en', 'running'), 'running')
  assert.equal(localizeStatus('zh-CN', 'custom-state'), 'custom-state')

  assert.equal(localizeAction('zh-CN', 'restart'), '重启')
  assert.equal(localizeAction('en', 'restart'), 'restart')
})
