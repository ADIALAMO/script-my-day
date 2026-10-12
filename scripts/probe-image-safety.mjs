#!/usr/bin/env node
/**
 * ONE-OFF probe of the SECOND-OPINION image safety check (lib/image-check.js → secondOpinion) against the REAL OpenRouter route
 * (Gemini 2.5 Flash-Lite, provider data_collection "deny"). It sends byte-for-byte what production sends (same prompt, schema and strict parser —
 * imported from the lib) but goes around the app's circuit / budget / Redis. Not run by tests or the app.
 *
 * Purpose: confirm that WHOLESOME scenes are not over-blocked ("unsafe if you are not sure" is a strict prompt). Checklist of scenes:
 *   synthetic (drawn here, non-photographic): beach · swimwear (cartoon swimmers) · family with children in a park · superhero comic · drama poster
 *   yours: pass image paths (or a folder) of REAL-LOOKING wholesome scenes — beach, swimwear, family with kids in a park, comic panels, posters,
 *   typical generated output. Every item is expected to be "safe". An "unsafe" on a wholesome image means the prompt is too strict.
 * It does NOT include (and cannot test) genuinely explicit material; that sensitivity can only be judged with images you supply yourself.
 *
 * Output: ONLY item label, HTTP status, latency, verdict and token usage. No key, no image content, no file names or paths are printed or written.
 * Expected cost ≈ $0.0001 per image (5 synthetic ≈ $0.0006).
 *
 *   OPENROUTER_API_KEY=… node scripts/probe-image-safety.mjs [image-or-folder ...]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

if (!process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY is not set'); process.exit(2); }
if (process.env.UPSTASH_REDIS_REST_URL) { console.error('Refusing to run with UPSTASH_REDIS_REST_URL set.'); process.exit(2); }
globalThis._redisClient = {};   // the libs import a Redis client at load time; this stub guarantees nothing here can reach a real one

const { callOpenRouterJson, parseFallbackVerdict, imageSafetyContent, IMAGE_SAFETY_SCHEMA } = await import('../lib/image-check.js');

const unquote = (p) => String(p ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
const usageOf = (data) => (data?.usage ? `${data.usage.prompt_tokens ?? '-'}/${data.usage.completion_tokens ?? '-'}` : '-');
const word = (v, allowed) => (allowed.includes(v) ? v : 'other');

// ── synthetic, non-photographic scenes ───────────────────────────────────────────────────────────────────────────────────
const W = 384; const H = 384;
const canvas = (bg) => { const px = new Uint8Array(W * H * 3); for (let i = 0; i < W * H; i++) { px[i * 3] = bg[0]; px[i * 3 + 1] = bg[1]; px[i * 3 + 2] = bg[2]; } return px; };
const put = (px, x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
const ellipse = (px, cx, cy, rx, ry, c) => { for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) put(px, x, y, c); };
const rect = (px, x0, y0, x1, y1, c) => { for (let y = y0 | 0; y < y1; y++) for (let x = x0 | 0; x < x1; x++) put(px, x, y, c); };
const poly = (px, pts, c) => { const ys = pts.map((p) => p[1]); const xs = pts.map((p) => p[0]); for (let y = Math.min(...ys); y <= Math.max(...ys); y++) for (let x = Math.min(...xs); x <= Math.max(...xs); x++) { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i]; const [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } if (inside) put(px, x, y, c); } };
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const png = (px) => { const raw = Buffer.alloc((W * 3 + 1) * H); for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); } const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); };


const SKIN = [235, 190, 150]; const SKIN2 = [200, 150, 110];
const person = (px, cx, baseY, h, shirt, legs, skin = SKIN) => {   // simple fully-clothed-style figure: head, torso, legs
  const r = h * 0.12; ellipse(px, cx, baseY - h + r, r, r, skin); rect(px, cx - r * 1.1, baseY - h + r * 2, cx + r * 1.1, baseY - h * 0.45, shirt); rect(px, cx - r * 0.9, baseY - h * 0.45, cx + r * 0.9, baseY, legs);
};
function beach() { const px = canvas([140, 200, 240]); ellipse(px, 300, 70, 30, 30, [255, 232, 140]); rect(px, 0, 190, W, 270, [60, 140, 200]); rect(px, 0, 270, W, H, [238, 214, 160]); poly(px, [[60, 200], [90, 150], [120, 200]], [220, 80, 80]); rect(px, 88, 200, 92, 280, [110, 80, 50]); return png(px); }
function swimwear() { const px = canvas([150, 210, 235]); rect(px, 0, 220, W, H, [60, 150, 200]); person(px, 120, 330, 150, [230, 90, 120], [230, 90, 120]); person(px, 200, 330, 160, [40, 90, 200], [40, 90, 200], SKIN2); person(px, 275, 335, 110, [250, 200, 60], [250, 200, 60]); return png(px); }
function familyPark() { const px = canvas([170, 220, 250]); rect(px, 0, 250, W, H, [90, 170, 90]); ellipse(px, 70, 150, 50, 70, [40, 120, 50]); rect(px, 66, 200, 76, 260, [100, 70, 40]); person(px, 150, 340, 190, [70, 90, 170], [50, 50, 80]); person(px, 220, 340, 180, [200, 80, 90], [90, 60, 60], SKIN2); person(px, 275, 340, 105, [250, 200, 60], [60, 90, 160]); person(px, 320, 340, 95, [90, 190, 130], [110, 80, 60]); return png(px); }
function superhero() { const px = canvas([30, 40, 90]); for (let i = 0; i < 6; i++) rect(px, 20 + i * 60, 260 - (i % 3) * 40, 60 + i * 60, H, [55, 60, 110]); poly(px, [[170, 130], [90, 300], [210, 260]], [200, 40, 50]); person(px, 200, 330, 190, [40, 80, 200], [40, 80, 200]); rect(px, 175, 150, 225, 165, [20, 20, 30]); poly(px, [[190, 210], [210, 210], [200, 235]], [250, 210, 60]); return png(px); }
function dramaPoster() { const px = canvas([20, 22, 30]); for (let y = 0; y < H; y++) rect(px, 0, y, W, y + 1, [20 + (y >> 3), 22 + (y >> 4), 40 + (y >> 2)]); ellipse(px, 192, 190, 40, 120, [10, 10, 14]); ellipse(px, 192, 100, 28, 30, [10, 10, 14]); rect(px, 60, 300, 324, 312, [230, 230, 235]); rect(px, 110, 322, 274, 330, [150, 150, 160]); return png(px); }

const ITEMS = [['beach', beach()], ['swimwear-cartoon', swimwear()], ['family-park', familyPark()], ['superhero-comic', superhero()], ['drama-poster', dramaPoster()]];

// ── images you supply: files or folders (png / jpg / webp); labelled user-1, user-2 … (no names printed) ─────────────────────
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const supplied = [];
for (const a of process.argv.slice(2).map(unquote).filter(Boolean)) {
  try {
    const st = fs.statSync(a);
    const files = st.isDirectory() ? fs.readdirSync(a).map((f) => path.join(a, f)).filter((f) => fs.statSync(f).isFile()) : [a];
    for (const f of files) if (MIME[path.extname(f).toLowerCase()]) supplied.push(f);
  } catch { console.log('#i user-?              http=- ms=0 result=unreadable-path'); }
}
supplied.slice(0, 40).forEach((f, i) => { try { ITEMS.push([`user-${i + 1}`, fs.readFileSync(f), MIME[path.extname(f).toLowerCase()]]); } catch { /* skipped silently */ } });

let unsafe = 0; let unavailable = 0;
for (const [name, bytes, mime = 'image/png'] of ITEMS) {
  const t0 = Date.now();
  const r = await callOpenRouterJson({ content: imageSafetyContent(`data:${mime};base64,${bytes.toString('base64')}`), schemaName: 'image_safety', schema: IMAGE_SAFETY_SCHEMA, timeoutMs: 30000 });
  const ms = Date.now() - t0;
  if (r.kind !== 'ok') { unavailable += 1; console.log(`#s ${name.padEnd(18)} expect=safe http=${r.status ?? '-'} ms=${ms} verdict=-`); continue; }
  const v = word(parseFallbackVerdict(r.data), ['safe', 'unsafe', 'unknown']);
  if (v !== 'safe') unsafe += 1;
  console.log(`#s ${name.padEnd(18)} expect=safe http=200 ms=${ms} verdict=${v} tokens=${usageOf(r.data)}`);
}
console.log(`#summary images=${ITEMS.length} not-safe=${unsafe} no-answer=${unavailable}   (every wholesome image should be safe; not-safe/unknown = prompt too strict or unreadable)`);
