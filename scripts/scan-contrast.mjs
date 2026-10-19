#!/usr/bin/env node
/**
 * RENDERED text-contrast scan (WCAG 1.4.3) — the check the class-name test in tests/contrast-and-notices.test.js cannot do: it looks at what the browser actually draws
 * (inline styles, inherited opacity, tailwind alpha colours, composited backgrounds), for ~26 page states x EN/HE (legal pages, sign-in, modals, history, script view,
 * cookie banner, age notice, phone width…). Text over a gradient/image background is reported as "indeterminate" (needs a manual look), never silently passed.
 *
 *   npm run build && npm start &              (or any running instance)
 *   node scripts/scan-contrast.mjs [http://localhost:3000]        needs playwright-core + an installed Chromium headless shell
 *   OUT=results.json node scripts/scan-contrast.mjs               also writes the failing elements as JSON
 *
 * Known false positive: the "COMIC" badge (black text on a translucent gold chip over a poster image; real contrast >= 6:1) is composited here over the page colour and is reported as failing.
 *
 * Needs a backend that answers /api quietly; against a throw-away Redis nothing is written to production. Exit code 1 when anything fails.
 */
import { chromium } from 'playwright-core';
import { readdirSync, writeFileSync } from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:3112';
const root = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64`;
const exe = `${root}/${readdirSync(root).find((f) => f.startsWith('chrome-headless-shell') && !f.includes('.'))}`;
const b = await chromium.launch({ executablePath: exe });
const SCRIPT = 'A walk\n\n**CHARACTERS:**\nDANA (30)\n\n**SCENE 1 - EXT - PARK - DAY**\n\n(Dana walks the dog.)\n\n**DANA:** Hi.\n\n**THE END**\n[image: a park]';

// ---- runs in the page: every visible text element, effective colours, WCAG ratio -------------------------------------------------
const scanFn = () => {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, bb) => { const x = L(a), y = L(bb); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const out = []; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (!t || !/[\p{L}\p{N}]/u.test(t)) continue;
    const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    if (el.closest('script,style,noscript,svg,[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // chain from root to element
    const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(e);
    let op = 1; let hiddenByOpacity = false; let imageBg = false;
    let bg = [3, 7, 18, 1];
    for (const e of chain) {
      const c = getComputedStyle(e); op *= parseFloat(c.opacity);
      const bgc = parse(c.backgroundColor); if (bgc && bgc[3] > 0) { if (bgc[3] < 1 && e.parentElement && e.parentElement.querySelector(':scope > img, :scope > picture, :scope > video')) imageBg = imageBg || 'translucent-over-image'; bg = over(bgc, bg); }
      if (c.backgroundImage && c.backgroundImage !== 'none' && e !== el) imageBg = /url\(/.test(c.backgroundImage) ? 'image' : (imageBg || 'gradient');
      else if (c.backgroundImage && c.backgroundImage !== 'none' && e === el) imageBg = imageBg || (/url\(/.test(c.backgroundImage) ? 'image' : 'gradient');
    }
    if (op < 0.02) continue;
    const fg = parse(cs.color) || [255, 255, 255, 1];
    const fgA = [fg[0], fg[1], fg[2], fg[3] * op];
    const eff = over(fgA, bg);
    const cr = ratio(eff, bg);
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const disabled = !!el.closest('[disabled],[aria-disabled="true"]');
    const sel = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.') : '');
    out.push({ text: t.slice(0, 48), sel: sel.slice(0, 110), cr: +cr.toFixed(2), need, size, fg: cs.color, op: +op.toFixed(2), bg: bg.slice(0, 3).map(Math.round).join(','), imageBg, disabled, fail: cr < need });
  }
  return out;
};

const results = []; // {state, items}
async function newPage(vp = { width: 1280, height: 900 }, flags = {}) {
  const ctx = await b.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await page.addInitScript(({ SCRIPT, flags }) => {
    localStorage.setItem('ls_tour_done_v1', '1'); localStorage.setItem('ls_tour_ch_v1', JSON.stringify({ done: [], off: true }));
    if (!flags.banner) localStorage.setItem('lifescript_cookie_v2', JSON.stringify({ analytics: false }));
    if (!flags.agegate) localStorage.setItem('ls_age_ok_v1', '1');
    localStorage.setItem('lifescript_history', JSON.stringify([{ id: 'ls_t', createdAt: Date.now(), genre: 'drama', lang: 'en', producerName: 'Guest', journalEntry: 'A walk', script: SCRIPT, title: 'A walk' }]));
  }, { SCRIPT, flags });
  return page;
}
async function visit(page, path, lang) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
  if (lang === 'he' && path === '/') await page.locator('button', { hasText: /עב/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
}
const record = async (page, state) => { await page.waitForTimeout(500); results.push({ state, items: await page.evaluate(scanFn) }); };

for (const lang of ['en', 'he']) {
  // static pages (legal pages open in Hebrew by default; switch to EN with the page toggle)
  for (const path of ['/privacy', '/terms', '/data-deletion', '/auth-success', '/auth-relay-start', '/auth-relay-complete', '/i/ABC123']) {
    const page = await newPage(); await visit(page, path, 'he');
    if (lang === 'en') await page.locator('button', { hasText: /^(EN|English)$/ }).first().click().catch(() => {});
    await record(page, `${path} [${lang}]`); await page.close();
  }
  // home states
  let page = await newPage({ width: 1280, height: 900 }, { banner: true, agegate: true }); await visit(page, '/', lang);
  await record(page, `home top + cookie banner [${lang}]`);
  await page.locator('textarea').first().scrollIntoViewIfNeeded(); await record(page, `home form (empty) [${lang}]`);
  await page.locator('textarea').first().fill('I walked the dog in the park this morning and met an old friend.'); await record(page, `home form (typed) [${lang}]`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await record(page, `home footer [${lang}]`);
  await page.locator('[data-tour="generate"]').click().catch(() => {}); await page.waitForTimeout(600); await record(page, `age notice [${lang}]`);
  await page.close();
  for (const [label, re] of [['About', /about|אודות/i], ['Support', /support|תמיכה/i], ['Terms', /terms|תנאי/i], ['Privacy', /privacy|פרטיות/i], ['Accessibility', /accessibility|נגישות/i]]) {
    page = await newPage(); await visit(page, '/', lang);
    await page.locator('footer button, footer a, button').filter({ hasText: re }).last().click({ timeout: 3000 }).catch(() => {});
    await record(page, `modal ${label} [${lang}]`); await page.close();
  }
  page = await newPage(); await visit(page, '/', lang);
  await page.getByRole('button', { name: /sign in|התחבר/i }).first().click().catch(() => {}); await page.waitForTimeout(700);
  await page.locator('input[type=email]').first().fill('x').catch(() => {}); await page.getByRole('button', { name: /magic|קישור/i }).first().click().catch(() => {});
  await record(page, `sign-in modal [${lang}]`); await page.close();
  page = await newPage(); await visit(page, '/', lang);
  await page.locator('nav button, header button').filter({ hasText: /Production archive|ארכיון/i }).first().click().catch(() => {}); await page.waitForTimeout(600);
  await record(page, `history panel [${lang}]`);
  await page.getByText('A walk').first().click().catch(() => {}); await page.waitForTimeout(1800);
  await record(page, `script open from history [${lang}]`);
  await page.close();
  for (const [label, sel] of [['Guide menu', /guide|מדריך/i], ['Invite / referral', /invite|הזמן/i], ['Offers (invite bonus)', /invite bonus|בונוס/i]]) {
    page = await newPage(); await visit(page, '/', lang);
    await page.locator('nav button, header button').filter({ hasText: sel }).first().click({ timeout: 3000 }).catch(() => {});
    await record(page, `${label} [${lang}]`); await page.close();
  }
  page = await newPage(); await visit(page, '/', lang);
  await page.locator('[class*="cursor-pointer"] img').first().click({ timeout: 3000 }).catch(() => {}); await record(page, `showcase poster lightbox [${lang}]`); await page.close();
  page = await newPage({ width: 390, height: 844 }, { banner: true }); await visit(page, '/', lang); await record(page, `home phone + banner [${lang}]`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await record(page, `home phone footer [${lang}]`); await page.close();
}
await b.close();
// aggregate by (sel,text) across states
const fails = new Map(); const indeterminate = new Map(); let total = 0;
for (const { state, items } of results) for (const it of items) { total++; if (it.fail && it.imageBg) { const k = `${it.sel} | ${it.text}`; indeterminate.set(k, it); continue; } if (it.fail && !it.disabled) { const k = `${it.sel} | ${it.text}`; const e = fails.get(k) || { ...it, states: new Set() }; e.states.add(state); fails.set(k, e); } }
console.log(`indeterminate (gradient/image behind the text, needs a manual look): ${indeterminate.size}`);
for (const e of indeterminate.values()) console.log(`  ? ${e.cr}:1 ${e.fg} on ${e.imageBg} "${e.text}"`);
writeFileSync(process.env.OUT || 'contrast-results.json', JSON.stringify([...fails.values()].map((e) => ({ ...e, states: [...e.states] })), null, 1));
console.log(`states scanned: ${results.length}, text elements checked: ${total}, distinct failing elements: ${fails.size}`);
const bySel = new Map(); for (const e of fails.values()) { const cls = e.sel; bySel.set(cls, (bySel.get(cls) || 0) + 1); }
console.log('worst 200:'); [...fails.values()].sort((a, c) => a.cr - c.cr).slice(0, 200).forEach((e) => console.log(`  ${e.cr}:1 (need ${e.need}) ${e.fg} op=${e.op} bg=${e.bg}${e.imageBg ? ' [' + e.imageBg + ']' : ''}  "${e.text}"  ${e.sel}  in ${e.states.size} state(s)`));
process.exit(fails.size ? 1 : 0);
