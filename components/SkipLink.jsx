import React, { useEffect, useState } from 'react';

/**
 * "Skip to content" (WCAG 2.4.1): the first tab stop on every page, visible only while focused. It moves focus to #main-content (the home page's <main>) or,
 * on pages without one, to the first <main>. The label follows <html lang>.
 */
export default function SkipLink() {
  const [he, setHe] = useState(false);
  // the label follows <html lang> at ALL times (it was only read on focus, so the text a screen reader / reader mode sees stayed English after a switch)
  useEffect(() => {
    const read = () => setHe(document.documentElement.lang === 'he');
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    return () => mo.disconnect();
  }, []);
  const go = (e) => {
    e.preventDefault();
    const target = document.getElementById('main-content') || document.querySelector('main main') || document.querySelector('main');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
  };
  return (
    <a
      href="#main-content" onClick={go}
      dir={he ? 'rtl' : 'ltr'}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[10000] focus:px-4 focus:py-3 focus:rounded-xl focus:bg-[#d4a373] focus:text-black focus:text-sm focus:font-black focus:outline-none focus:ring-2 focus:ring-white"
    >
      {he ? 'דלג לתוכן' : 'Skip to content'}
    </a>
  );
}
