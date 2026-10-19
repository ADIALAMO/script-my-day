/**
 * Keeps <html lang> equal to the language the page is actually shown in (WCAG 3.1.1): screen readers pick their voice from it.
 * pages/_document.js renders lang="en" (the home page default); each page that has a language switch calls useDocumentLang(lang).
 */
import { useEffect } from 'react';

export const toHtmlLang = (lang) => (lang === 'he' ? 'he' : 'en');

export function useDocumentLang(lang) {
  useEffect(() => {
    try { document.documentElement.lang = toHtmlLang(lang); } catch { /* no document (SSR) */ }
  }, [lang]);
}
