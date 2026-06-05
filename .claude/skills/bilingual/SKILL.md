---
name: bilingual
description: >-
  Convention guard for LIFESCRIPT's Hebrew/English bilingual + RTL UI. Use whenever
  adding or editing any user-facing string, building or modifying a React component
  in components/ or pages/, adding error/CODES messages (lib/messages.js), genre or
  modal copy (constants/), or anything that renders text to the user. Triggers on:
  new UI string, copy, label, placeholder, translation, Hebrew, RTL, dir, lang,
  i18n, font-heebo.
---

# LIFESCRIPT — Bilingual (HE/EN) + RTL Conventions

The product is Hebrew-first and fully bilingual. The #1 recurring bug is adding a
string in one language only, which breaks the other audience's UX. Every
user-facing string must exist in **both** `he` and `en`.

## The `lang` pattern (used everywhere)
Components receive `lang` (`'he' | 'en'`) and branch inline:
```jsx
{lang === 'he' ? 'טקסט בעברית' : 'English text'}
```
For data with many strings, store paired keys instead of inline ternaries — match
the existing shape in that file:
- `constants/genres.js`: `label: { en: 'Drama', he: 'דרמה' }`
- `constants/showcase.js`: `titleHe`/`titleEn`, `excerptHe`/`excerptEn`
- `constants/modalData.js`: top-level `he: {...}` / `en: {...}` blocks

When you add a field, add **both** variants in the same commit. A missing variant
renders `undefined` to half the users.

## RTL handling (don't forget the direction)
- Hebrew text containers need `dir={lang === 'he' ? 'rtl' : 'ltr'}` (see
  [pages/index.js](pages/index.js)).
- The Hebrew font class is `font-heebo`, applied on the root when `lang === 'he'`:
  `className={... ${lang === 'he' ? 'font-heebo' : ''}}`.
- Monospace/script blocks set `direction` explicitly via `style={{ direction: ... }}`.
- Be careful with directional Tailwind utilities (`left/right`, `ml/mr`,
  `text-left/right`) inside RTL — prefer logical placement or mirror them under RTL.
- Language detection for *generated content* is automatic: `detectLanguage` in
  [lib/agent.js](lib/agent.js) keys off `HEBREW_RANGE` (`constants/language.js`) and
  the script LLM is hard-locked to match the input language. UI chrome `lang` is
  separate from that — don't conflate them.

## Backend / API messages
- Don't hardcode user-facing English in API JSON. Return a **`CODES.*`** symbol
  (see [lib/messages.js](lib/messages.js)) and let the client render the localized
  string. When adding a new failure mode, add a code there and a HE+EN mapping on
  the client, not a raw English `message`.

## Checklist for any new user-facing text
1. Did you add **both** `he` and `en`? (inline ternary or paired keys to match the
   file).
2. Hebrew set correctly for RTL? (`dir`, `font-heebo`, mirrored directional classes).
3. API error → a `CODES.*` symbol with both localizations, not a raw English string.
4. Hebrew default where the product defaults to Hebrew (e.g. guest name 'אורח').
5. Re-read the Hebrew as a native would — no leftover English in a Hebrew string and
   vice versa (the script generator treats even one stray character of the wrong
   language as a failure; hold UI copy to the same bar).
