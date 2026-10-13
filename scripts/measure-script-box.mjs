#!/usr/bin/env node
// Browser measurement of the script window: does ANY text line leave the box's content area, is the frame's rounded corner clipping text at any scroll
// position, does the status badge overlap the scrolling text, and what are the real line-height / direction. Manual tool (needs `playwright-core` and a
// running app: `npm run dev`); the pure geometry is unit-tested in tests/glyph-fit.test.js.
//   node scripts/measure-script-box.mjs [baseUrl=http://localhost:3000] [--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
// Exit code 1 when any glyph is outside, clipped or overlapped.
let pw;
try { pw = await import('playwright-core'); } catch { console.error('playwright-core is not installed (npm i -D playwright-core; npx playwright-core install webkit)'); process.exit(2); }
const { webkit, chromium, devices } = pw;
const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:3000';
const chromePath = process.argv.includes('--chrome') ? process.argv[process.argv.indexOf('--chrome') + 1] : null;
const { contentRect, findOutside } = await import('../utils/glyph-fit.js');

const HE_LINES = [
  'פנים. מטבח - בוקר', '',
  'דנה עומדת ליד החלון, כוס הקפה שלה כבר התקררה מזמן. היא נזכרת בשיחה של אתמול ומחייכת לעצמה.', '',
  'דנה', '(בלחש) "אני חייבת לספר לו עוד היום..."', '',
  'הַשָּׁמַיִם הָיוּ כְּחֻלִּים וְהָעִיר הָיְתָה שְׁקֵטָה, וְכָל מִלָּה נִשְׁמְעָה כְּמוֹ מוּזִיקָה עֲדִינָה.', '',
  'היא לוקחת את המפתחות מהשולחן, מציצה במראה האחרונה ויוצאת אל הרחוב המואר — ABC 123 test — וממשיכה ללכת.', '',
  'אֲנִי־חֲשׁוּב־לִי־מְאוֹד־שֶׁכֹּל־הַמִּלִּים־הַאֲרֻכּוֹת־הַלָּלוּ־יִתְאִימוּ־בְּלִי־לְהִחָתֵךְ־בַּקָּצֶה',
];
const HE = `${HE_LINES.join('\n')}\n\n${HE_LINES.join('\n')}\n\n[image: אישה ליד חלון]`;
const HE_SHORT = 'פנים. מטבח - בוקר\n\nדנה מחייכת.\n\n[image: אישה]';
const EN = `${'INT. KITCHEN - MORNING\n\nDANA stands by the window, her coffee gone cold. She remembers yesterday\'s call and smiles to herself, "I must tell him today..." — and keeps going.\n\n'.repeat(6)}[image: a woman at a window]`;
const CASES = [
  ['HE script + English UI', HE, 'en', 'he'], ['HE script + Hebrew UI', HE, 'he', 'he'], ['HE short + English UI', HE_SHORT, 'en', 'he'], ['EN script + English UI', EN, 'en', 'en'],
];

async function measure(page) {
  return page.evaluate(() => {
    const box = document.querySelector('[data-script-scroller]');
    const cs = getComputedStyle(box); const frame = box.parentElement; const rad = parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 0;
    const textDiv = box.querySelector('[data-script-text]');
    const br = box.getBoundingClientRect();
    const lines = []; const w = document.createTreeWalker(textDiv, NodeFilter.SHOW_TEXT); let n;
    // per GLYPH (whitespace skipped: a trailing space legitimately "hangs" past the edge under white-space: pre-wrap and is invisible)
    while ((n = w.nextNode())) {
      const t = n.nodeValue;
      for (let i = 0; i < t.length; i++) {
        if (/\s/.test(t[i])) continue;
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
        for (const q of r.getClientRects()) if (q.width > 0) lines.push({ left: q.left, right: q.right, top: q.top, bottom: q.bottom });
      }
    }
    const badge = frame.querySelector('img[src="/icon.png"]')?.closest('div');
    const fr = frame.getBoundingClientRect();
    const radiusHits = (scrollTop) => {
      box.scrollTop = scrollTop; const b = box.getBoundingClientRect();
      const corners = [[fr.left + rad, fr.top + rad, -1, -1], [fr.right - rad, fr.top + rad, 1, -1], [fr.left + rad, fr.bottom - rad, -1, 1], [fr.right - rad, fr.bottom - rad, 1, 1]];
      let hits = 0;
      const ls = []; const ww = document.createTreeWalker(textDiv, NodeFilter.SHOW_TEXT); let m;
      while ((m = ww.nextNode())) {
        const t = m.nodeValue;
        for (let i = 0; i < t.length; i++) { if (/\s/.test(t[i])) continue; const r = document.createRange(); r.setStart(m, i); r.setEnd(m, i + 1); for (const q of r.getClientRects()) ls.push(q); }
      }
      for (const q of ls) {
        if (q.width <= 0 || q.bottom < b.top || q.top > b.bottom) continue;
        const y1 = Math.max(q.top, b.top); const y2 = Math.min(q.bottom, b.bottom);
        for (const [x, y] of [[q.left, y1], [q.right, y1], [q.left, y2], [q.right, y2]]) {
          if (corners.some(([cx, cy, sx, sy]) => (x - cx) * sx > 0 && (y - cy) * sy > 0 && Math.hypot(x - cx, y - cy) > rad)) { hits += 1; break; }
        }
      }
      return hits;
    };
    const positions = [0, 300, Math.max(0, box.scrollHeight / 2 - box.clientHeight / 2), box.scrollHeight];
    const cornerHits = positions.map(radiusHits);
    box.scrollTop = 0;
    const bb = badge?.getBoundingClientRect();
    const badgeOverlapsBox = !!bb && bb.width > 0 && bb.top < br.bottom && bb.bottom > br.top;
    return {
      mode: box.dataset.scriptScroller, boxDir: cs.direction, textDir: getComputedStyle(textDiv).direction, align: getComputedStyle(textDiv).textAlign,
      lineHeight: getComputedStyle(textDiv).lineHeight, fontSize: getComputedStyle(textDiv).fontSize,
      m: { left: br.left, offsetWidth: box.offsetWidth, clientWidth: box.clientWidth, borderLeft: parseFloat(cs.borderLeftWidth) || 0, borderRight: parseFloat(cs.borderRightWidth) || 0, paddingLeft: parseFloat(cs.paddingLeft), paddingRight: parseFloat(cs.paddingRight), rtl: cs.direction === 'rtl' },
      lines, radius: rad, cornerHits, badgeOverlapsBox, scrollW: box.scrollWidth, clientW: box.clientWidth,
    };
  });
}

async function runCase(browser, ctxOpts, label, qs, script, ui, scriptLang) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(() => { localStorage.setItem('lifescript_cookie_v2', '{"analytics":false}'); localStorage.setItem('ls_tour_done_v1', '1'); localStorage.setItem('ls_tour_ch_v1', '{"done":[1],"off":true}'); });
  const page = await ctx.newPage();
  await page.route('**/api/generate-script', (r) => r.fulfill({ json: { success: true, script } }));
  await page.goto(`${base}/${qs}`, { waitUntil: 'load' }); await page.waitForTimeout(1500);
  if (ui === 'he') await page.click('nav button:has-text("Change language")');
  await page.locator('textarea').first().fill(scriptLang === 'he' ? 'הלכתי עם הכלב ופגשתי חבר.' : 'I walked the dog.');
  await page.locator('[data-tour=genre] button').first().click(); await page.locator('[data-tour=generate]').click();
  await page.waitForSelector('[data-script-scroller]', { timeout: 20000 });
  await page.waitForSelector('[data-tour=skip-typing]', { timeout: 20000 }).then(() => page.locator('[data-tour=skip-typing]').click()).catch(() => {});
  await page.waitForTimeout(900);
  const r = await measure(page);
  const outside = findOutside(r.lines, contentRect(r.m));
  const bad = outside.length + r.cornerHits.reduce((a, b) => a + b, 0) + (r.badgeOverlapsBox ? 1 : 0) + (r.scrollW > r.clientW + 1 ? 1 : 0);
  console.log(`${bad ? 'FAIL' : 'ok  '} ${label}: mode=${r.mode} dir=${r.textDir} align=${r.align} line-height=${r.lineHeight}/${r.fontSize} outside=${outside.length}${outside[0] ? ` (e.g. over ${Math.round(Math.max(outside[0].overLeft, outside[0].overRight))}px)` : ''} cornerClips=[${r.cornerHits}] badgeOverlap=${r.badgeOverlapsBox} hScroll=${r.scrollW > r.clientW + 1}`);
  await ctx.close();
  return bad;
}

const wk = await webkit.launch();
const ch = chromePath ? await chromium.launch({ executablePath: chromePath, headless: true }) : await chromium.launch({ headless: true }).catch(() => null);
let failures = 0;
for (const [name, b] of [['webkit(mac)', wk], ['chromium', ch]]) {
  if (!b) continue;
  for (const w of [1440, 1280, 1024, 820]) for (const [label, script, ui, lang] of CASES) failures += await runCase(b, { viewport: { width: w, height: 800 } }, `${name} ${w}px ${label}`, '', script, ui, lang);
}
for (const [label, script, ui, lang] of CASES) failures += await runCase(wk, { ...devices['iPhone 14'] }, `iPhone14 ${label}`, '', script, ui, lang);
await wk.close(); await ch?.close();
console.log(failures ? `\n${failures} problem(s)` : '\nno glyph outside the content area, no corner clipping, no badge overlap');
process.exit(failures ? 1 : 0);
