import { createContext, useContext } from 'react'
import { Globe } from 'lucide-react'
import { cn } from '../components/ui'
import { DEFAULT_LOCALE, Locale, MessageKey, translate } from './i18n.ts'

export interface I18nContextValue {
  locale: Locale
  setLocale: (next: Locale) => void
  t: (key: MessageKey, vars?: Record<string, string | number | null | undefined>) => string
}

export const LocaleContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
})

export function useI18n() {
  return useContext(LocaleContext)
}

export function LocaleToggle() {
  const { locale, setLocale, t } = useI18n()
  return (
    <div
      className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5"
      role="group"
      aria-label={t('app.localeToggleLabel')}
      title={t('app.localeToggleLabel')}
    >
      <Globe className="mx-1.5 h-3.5 w-3.5 text-zinc-400" />
      <button
        type="button"
        onClick={() => setLocale('zh-CN')}
        className={cn(
          'rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
          locale === 'zh-CN'
            ? 'bg-zinc-100 text-zinc-950 shadow-xs'
            : 'text-zinc-400 hover:text-zinc-100',
        )}
      >
        中文
      </button>
      <button
        type="button"
        onClick={() => setLocale('en')}
        className={cn(
          'rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
          locale === 'en'
            ? 'bg-zinc-100 text-zinc-950 shadow-xs'
            : 'text-zinc-400 hover:text-zinc-100',
        )}
      >
        EN
      </button>
    </div>
  )
}
