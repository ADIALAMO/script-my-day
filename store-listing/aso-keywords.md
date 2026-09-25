# ASO Keywords / Tags

Google Play doesn't have a dedicated "keywords" field like the App Store — ranking is driven by the **app title**, **short description**, and **full description** (repetition and placement matter, especially in the first ~160 characters of the full description and in the title itself). This list is for:
- Confirming the title/short-description choices above actually cover the highest-value terms.
- Seeding any future ASO tooling (Play Console's own "Store listing experiments," third-party ASO trackers).
- A reference for full-description word choice (each of these should appear naturally at least once across the listing — checked against `copy-en.md`/`copy-he.md` below).

## Primary keywords (English) — high intent, directly describes the product
- ai movie poster
- ai poster maker
- movie poster generator
- ai comic generator
- comic book maker ai
- turn photo into movie poster
- journal to story
- ai journal app
- cinematic ai
- screenplay generator
- ai screenwriter
- star in your own movie
- face swap poster (borderline — LifeScript is reference-based character generation, not a face-swap app; avoid over-claiming, but the search intent overlaps)
- daily journal app
- ai storyboard generator

## Secondary / long-tail (English)
- turn your day into a movie
- ai movie maker from text
- create comic from story
- personalized movie poster
- ai reel generator
- movie poster app free
- comic strip creator ai

## Primary keywords (Hebrew)
- פוסטר קולנועי AI
- יצירת פוסטר עם AI
- אפליקציית יומן
- הפוך תמונה לפוסטר
- יוצר קומיקס
- תסריט קולנועי AI
- יומן אישי דיגיטלי
- הפקת סרט מהטלפון
- כתיבת תסריט AI
- לככב בסרט שלי

## Secondary / long-tail (Hebrew)
- הפוך את היום שלך לסרט
- יומן שהופך לתסריט
- אפליקציית AI לעברית
- יצירת קומיקס מהסיפור שלי

## Coverage check
Confirmed present in `copy-en.md`'s full description: movie poster, comic book, screenplay, journal, AI, star yourself/star in your own movie, reel, cinematic, storyboard (implied via "5-7 panel comic").
Confirmed present in `copy-he.md`: פוסטר קולנועי, קומיקס, תסריט, יומן, AI, לככב בסיפור, רילז.

## Notes / things NOT to claim
- Don't use "face swap" as a headline term in the actual listing copy — it overpromises a different technical capability (LifeScript builds a consistent character from a reference photo via image-generation models, not real-time face-swapping) and could draw a misleading-claims flag in review. Fine to have in mind for search-intent overlap only.
- Don't claim "unlimited free" anywhere — free tier has real daily limits (5 scripts/2 posters/1 comic at time of writing, per `lib/quota.js`). Keep "free to start" framing, not "free forever" or "unlimited free."
