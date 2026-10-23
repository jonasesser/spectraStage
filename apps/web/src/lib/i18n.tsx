import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Locale, LocalizedText } from '@spectrastage/shared';
import { KEYS, storage } from './storage.ts';

export type Tr = ((en: string, de: string) => string) & {
  locale: Locale;
  text: (t: LocalizedText) => string;
};

interface LangCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

const Ctx = createContext<LangCtx>({ locale: 'de', setLocale: () => {} });

export function initialLocale(): Locale {
  const stored = storage.get(KEYS.locale);
  if (stored === 'de' || stored === 'en') return stored;
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [locale, set] = useState<Locale>(initialLocale);
  const setLocale = useCallback((l: Locale) => {
    storage.set(KEYS.locale, l);
    document.documentElement.lang = l;
    set(l);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  return useContext(Ctx);
}

/** Inline translations: L('Save', 'Speichern'). */
export function useT(): Tr {
  const { locale } = useContext(Ctx);
  return useMemo(() => {
    const fn = ((en: string, de: string) => (locale === 'de' ? de : en)) as Tr;
    fn.locale = locale;
    fn.text = (t: LocalizedText) => t[locale] || t.en;
    return fn;
  }, [locale]);
}
