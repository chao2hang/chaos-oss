import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export type Lang = 'zh' | 'en'

const KEY = 'chaos-lang'

/**
 * Minimal i18n: the source string (Chinese) IS the key.
 * t('上传文件') → 'Upload File' when lang is en, '上传文件' when zh.
 * Untranslated keys fall back to the original text, so partial
 * dictionaries degrade gracefully.
 */

// en dictionary — keyed by the Chinese source string
import { EN } from './en'

const DICTS: Partial<Record<Lang, Record<string, string>>> = {
  zh: {}, // identity
  en: EN,
}

interface I18nValue {
  lang: Lang
  setLang: (l: Lang) => void
  /** Translate a source (Chinese) string; `{x}` placeholders get substituted from params. */
  t: (s: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue>({
  lang: 'zh',
  setLang: () => {},
  t: (s) => s,
})

export function readLang(): Lang {
  return localStorage.getItem(KEY) === 'en' ? 'en' : 'zh'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang)

  useEffect(() => {
    localStorage.setItem(KEY, lang)
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  }, [lang])

  const t = useCallback(
    (s: string, params?: Record<string, string | number>) => {
      let out = DICTS[lang]?.[s] ?? s
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          out = out.replaceAll(`{${k}}`, String(v))
        }
      }
      return out
    },
    [lang],
  )

  return (
    <I18nContext.Provider value={{ lang, setLang: setLangState, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
