export const SCHEDULE_PRESETS = [
  { cron: '0 9 * * *', zh: '每天 09:00', en: 'Daily at 09:00' },
  { cron: '0 9 * * 1-5', zh: '每个工作日 09:00', en: 'Weekdays at 09:00' },
  { cron: '0 18 * * 1-5', zh: '每个工作日 18:00', en: 'Weekdays at 18:00' },
  { cron: '0 9 * * 1', zh: '每周一 09:00', en: 'Every Monday 09:00' },
  { cron: '0 17 * * 5', zh: '每周五 17:00', en: 'Every Friday 17:00' },
  { cron: '0 * * * *', zh: '每小时整点', en: 'Every hour' },
]

export const APP_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/
export const SERVICE_NAME_RE = /^[a-z0-9_-]{1,48}$/

export function formatScheduleHuman(cron, lang = 'zh') {
  const norm = String(cron || '').trim().replace(/\s+/g, ' ')
  const preset = SCHEDULE_PRESETS.find((p) => p.cron === norm)
  if (preset) return lang === 'en' ? preset.en : preset.zh
  const parts = norm.split(' ')
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts
    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*') {
      const hhmm = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
      if (dow === '*') return lang === 'en' ? `Daily at ${hhmm}` : `每天 ${hhmm}`
      if (dow === '1-5') return lang === 'en' ? `Weekdays at ${hhmm}` : `每个工作日 ${hhmm}`
    }
  }
  return norm || (lang === 'en' ? 'Custom schedule' : '自定义计划')
}

export function normalizeAppName(raw) {
  return String(raw || '').trim().toLowerCase()
}

export function normalizeServiceName(raw) {
  return String(raw || '').trim()
}

export function validateCronSchedule(raw) {
  const norm = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!norm || /[\r\n]/.test(norm)) return ''
  const parts = norm.split(' ')
  if (parts.length !== 5) return ''
  return norm
}

export function formatBytes(bytes) {
  const n = Number(bytes || 0)
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
