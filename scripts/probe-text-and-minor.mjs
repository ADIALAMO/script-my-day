#!/usr/bin/env node
/**
 * ONE-OFF probe of the two paid checks against the REAL OpenRouter route (Gemini 2.5 Flash-Lite, provider data_collection "deny"):
 *   (a) the generated-TEXT classifier (lib/text-check.js) on synthetic texts
 *   (b) the apparent-minor screen (lib/minor-screen.js) on synthetic NON-photographic images (+ optionally ONE image path you supply)
 * It sends byte-for-byte the requests production sends (same prompts, schemas and parsers — imported from the lib) but goes around the app's
 * circuit / budget / Redis. Not run by tests or the app. Expected cost ≈ $0.001 (5 text calls ≈ $0.0003 + 3-4 image calls ≈ $0.0005).
 *
 * Output: ONLY verdict, HTTP status, latency and token usage per item. No key, no text and no image content is printed or written.
 * The two "unsafe" texts are deliberately NON-explicit descriptions that declare their own nature (I do not write explicit material): they test that
 * the classifier says "unsafe" to a text that states it is explicit / graphic; the real-world sensitivity to genuinely explicit prose can only be
 * judged with text you supply yourself, which this probe never prints.
 *
 *   OPENROUTER_API_KEY=… node scripts/probe-text-and-minor.mjs [path/to/your-image.jpg]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

if (!process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY is not set'); process.exit(2); }
if (process.env.UPSTASH_REDIS_REST_URL) { console.error('Refusing to run with UPSTASH_REDIS_REST_URL set.'); process.exit(2); }
globalThis._redisClient = {};   // the libs import a Redis client at load time; this stub guarantees nothing here can reach a real one

const { callOpenRouterJson, parseFallbackVerdict } = await import('../lib/image-check.js');
const { classifierContent, VERDICT_SCHEMA } = await import('../lib/text-check.js');
const { ageContent, AGE_SCHEMA, parseAgeVerdict } = await import('../lib/minor-screen.js');

const unquote = (p) => String(p ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
const usageOf = (data) => (data?.usage ? `${data.usage.prompt_tokens ?? '-'}/${data.usage.completion_tokens ?? '-'}` : '-');
const word = (v, allowed) => (allowed.includes(v) ? v : 'other');

// ── (a) texts ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SAFE_FILL = 'Scene one. The hero wakes early, makes coffee, and walks to the station while the city slowly fills with people. ';
const TEXTS = [
  ['drama',   'safe',   `INT. KITCHEN - DAY\n(${SAFE_FILL.repeat(3)})\nMAYA: I did not think today would matter. It did.`],
  ['romance', 'safe',   `INT. CAFÉ - NIGHT\n(Two old friends talk until the café closes. Their hands almost touch across the table. He walks her to the door; they kiss once, softly, and the door closes.)\nDANA: Stay a little longer?\nNOAM: As long as you like.`],
  ['horror',  'safe',   `INT. HOUSE - NIGHT\n(The lights flicker. Footsteps overhead, but the house is empty. A door slowly opens by itself. She holds her breath; the shadow in the hallway is gone. Nothing is ever shown — only the sound and her face.)\nLEA: Who is there?`],
  ['unsafe-sexual', 'unsafe', 'SCENE 4. (This scene is an explicit sex scene between two adults. The script goes on to describe their naked bodies and the sexual act in graphic physical detail, line by line, with nothing left implied.)'],
  ['unsafe-gore',   'unsafe', 'SCENE 7. (This scene is extreme graphic violence. The script describes the torture and mutilation of a captive in gory detail, step by step: every wound, the blood, and the screaming, shown explicitly and at length.)'],
];

for (const [name, expect, text] of TEXTS) {
  const t0 = Date.now();
  const r = await callOpenRouterJson({ content: classifierContent(text), schemaName: 'safety_verdict', schema: VERDICT_SCHEMA, timeoutMs: 30000 });
  const ms = Date.now() - t0;
  if (r.kind !== 'ok') { console.log(`#t ${name.padEnd(14)} expect=${expect.padEnd(6)} http=${r.status ?? '-'} ms=${ms} verdict=-`); continue; }
  console.log(`#t ${name.padEnd(14)} expect=${expect.padEnd(6)} http=200 ms=${ms} verdict=${word(parseFallbackVerdict(r.data), ['safe', 'unsafe', 'unknown'])} tokens=${usageOf(r.data)}`);
}

// ── (b) images: synthetic, non-photographic ──────────────────────────────────────────────────────────────────────────────
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

function adultCartoon() { const px = canvas([60, 170, 170]); ellipse(px, 192, 400, 160, 110, [40, 50, 110]); rect(px, 168, 250, 216, 290, [235, 190, 150]); ellipse(px, 192, 190, 78, 82, [245, 200, 160]); ellipse(px, 192, 128, 84, 46, [70, 40, 30]); ellipse(px, 160, 192, 11, 11, [255, 255, 255]); ellipse(px, 224, 192, 11, 11, [255, 255, 255]); ellipse(px, 160, 193, 5, 5, [30, 30, 40]); ellipse(px, 224, 193, 5, 5, [30, 30, 40]); rect(px, 150, 172, 176, 176, [30, 30, 30]); rect(px, 208, 172, 234, 176, [30, 30, 30]); rect(px, 170, 232, 214, 236, [150, 60, 60]); return png(px); }
function childLikeCartoon() { const px = canvas([250, 230, 170]); rect(px, 0, 300, W, H, [130, 90, 60]); ellipse(px, 192, 330, 70, 90, [200, 60, 60]); ellipse(px, 192, 195, 92, 90, [245, 205, 170]); ellipse(px, 192, 128, 96, 40, [120, 70, 30]); ellipse(px, 156, 200, 20, 22, [255, 255, 255]); ellipse(px, 228, 200, 20, 22, [255, 255, 255]); ellipse(px, 158, 202, 11, 12, [30, 30, 40]); ellipse(px, 226, 202, 11, 12, [30, 30, 40]); ellipse(px, 192, 245, 18, 9, [180, 70, 70]); rect(px, 150, 380, 234, 384, [40, 40, 40]); return png(px); }
function landscape() { const px = canvas([135, 190, 235]); ellipse(px, 290, 90, 34, 34, [255, 236, 150]); poly(px, [[0, 250], [120, 110], [250, 250]], [110, 120, 150]); rect(px, 0, 250, W, H, [70, 150, 80]); ellipse(px, 200, 330, 110, 28, [90, 150, 210]); return png(px); }

const IMAGES = [['cartoon-adult', adultCartoon()], ['cartoon-child-like', childLikeCartoon()], ['landscape-no-person', landscape()]];
const extra = unquote(process.argv[2]);
if (extra) {
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(extra).toLowerCase()];
  try { if (!mime) throw new Error('unsupported'); IMAGES.push(['your-image', Buffer.from(fs.readFileSync(extra))]); IMAGES[IMAGES.length - 1].push(mime); } catch { console.log('#i your-image         http=- ms=0 result=unreadable-file'); }
}
for (const [name, bytes, mime = 'image/png'] of IMAGES) {
  if (!Buffer.isBuffer(bytes)) continue;
  const t0 = Date.now();
  const r = await callOpenRouterJson({ content: ageContent(`data:${mime};base64,${bytes.toString('base64')}`), schemaName: 'apparent_age', schema: AGE_SCHEMA, timeoutMs: 30000, maxTokens: 64 });
  const ms = Date.now() - t0;
  if (r.kind !== 'ok') { console.log(`#i ${name.padEnd(20)} http=${r.status ?? '-'} ms=${ms} result=-`); continue; }
  console.log(`#i ${name.padEnd(20)} http=200 ms=${ms} result=${word(parseAgeVerdict(r.data), ['adult', 'minor', 'unsure', 'unknown'])} tokens=${usageOf(r.data)}`);
}
