import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_BRAND_THEME,
  THEME_PRESETS,
  contrastTextColor,
  formatScheduleHuman,
  mergeBrandTheme,
} from './theme.ts'

test('mergeBrandTheme validates tokens and falls back to defaults', () => {
  assert.deepEqual(mergeBrandTheme(null), DEFAULT_BRAND_THEME)
  assert.deepEqual(
    mergeBrandTheme({
      mode: 'light',
      primary: '#2563eb',
      accent: 'not-a-hex',
      radius: 'sharp',
      font_scale: 'large',
      layout_width: 'full',
    }),
    {
      mode: 'light',
      primary: '#2563eb',
      accent: DEFAULT_BRAND_THEME.accent,
      radius: 'sharp',
      font_scale: 'large',
      layout_width: 'full',
    },
  )
  assert.ok(THEME_PRESETS.length >= 5)
})

test('contrastTextColor chooses high-contrast foreground for light vs dark primary colors', () => {
  assert.equal(contrastTextColor('#1e293b'), '#ffffff')
  assert.equal(contrastTextColor('#6366f1'), '#ffffff')
  assert.equal(contrastTextColor('#fde047'), '#09090b')
  assert.equal(contrastTextColor('#ffffff'), '#09090b')
})

test('formatScheduleHuman renders readable Chinese and English schedule labels', () => {
  assert.equal(formatScheduleHuman('0 9 * * 1-5', 'zh-CN'), '每个工作日 09:00')
  assert.equal(formatScheduleHuman('0 9 * * 1-5', 'en'), 'Weekdays at 09:00')
  assert.equal(formatScheduleHuman('30 14 * * *', 'zh-CN'), '每天 14:30')
  assert.equal(formatScheduleHuman('30 14 * * *', 'en'), 'Daily at 14:30')
  assert.equal(formatScheduleHuman('*/15 * * * *', 'zh-CN'), '*/15 * * * *')
})
