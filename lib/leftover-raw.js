/**
 * Pure helpers for scripts/list-leftover-raw-selfies.mjs (READ-ONLY): classify the keys under `characters/` and summarise the raw selfies that are
 * still in the public bucket — counts, sizes and ages only. The summary never contains a key, an owner segment, a user id, a stamp or a URL.
 *
 *   NEW_RAW     characters/<32 hex owner>/<uuid>-raw.<ext>        current format. Before this change the raw was kept whenever the sheet step failed;
 *                                                                 since it, a raw is deleted after every attempt — so a NEW_RAW found now is a failed delete.
 *   LEGACY_RAW  characters/<id>-raw-<stamp>.jpg                   pre-HMAC format (the key embeds a user id)
 * "with a sheet" = a sibling sheet object of the SAME upload exists in the listing (same uuid / same id+stamp). A raw WITHOUT a sheet was the user's only
 * reference (the old degraded path) or the orphan of a failed upload. Whether a Redis pointer still names it is NOT checked here (R2 only, no Redis).
 */
const NEW_RAW = /^characters\/([0-9a-f]{32})\/([0-9a-f-]{36})-raw\.(?:jpg|png|webp)$/;
const NEW_SHEET = /^characters\/([0-9a-f]{32})\/([0-9a-f-]{36})-sheet\.(?:jpg|png|webp)$/;
const LEGACY_RAW = /^characters\/([^/]+?)-raw-(\d+)\.jpg$/;
const LEGACY_SHEET = /^characters\/([^/]+?)-sheet-(\d+)\.jpg$/;

/** Legacy raw selfie key → { id, stamp, sheetKey } (the sheet of the SAME upload), or null for any other key. `id` is the identifier the key embeds (u:<user id>). */
export function parseLegacyRaw(key) {
  const m = typeof key === 'string' && key.length <= 300 && !key.includes('..') ? LEGACY_RAW.exec(key) : null;
  return m ? { id: m[1], stamp: m[2], sheetKey: `characters/${m[1]}-sheet-${m[2]}.jpg` } : null;
}

export const AGE_BUCKETS = [
  { label: 'under 1 day', maxDays: 1 }, { label: '1-7 days', maxDays: 7 }, { label: '7-30 days', maxDays: 30 },
  { label: '30-90 days', maxDays: 90 }, { label: 'over 90 days', maxDays: Infinity },
];

const bucketOf = (days) => AGE_BUCKETS.findIndex((b) => days < b.maxDays);

/**
 * @param {{ key: string, size?: number, lastModified?: Date|string|number }[]} objects  everything listed under `characters/`
 * @param {number} [nowMs]
 */
export function summariseLeftoverRaws(objects, nowMs = Date.now()) {
  const sheets = new Set();
  for (const o of objects) {
    const n = NEW_SHEET.exec(o.key); if (n) sheets.add(`n:${n[1]}/${n[2]}`);
    const l = LEGACY_SHEET.exec(o.key); if (l) sheets.add(`l:${l[1]}-${l[2]}`);
  }
  const mk = () => ({ count: 0, bytes: 0, withSheet: 0, withoutSheet: 0, ageBuckets: AGE_BUCKETS.map((b) => ({ label: b.label, count: 0 })), oldestDays: null });
  const out = { total: objects.length, other: 0, newRaw: mk(), legacyRaw: mk() };
  for (const o of objects) {
    let cls = null; let sheetKey = null; let m;
    if ((m = NEW_RAW.exec(o.key))) { cls = out.newRaw; sheetKey = `n:${m[1]}/${m[2]}`; }
    else if ((m = LEGACY_RAW.exec(o.key))) { cls = out.legacyRaw; sheetKey = `l:${m[1]}-${m[2]}`; }
    else { out.other += 1; continue; }
    cls.count += 1;
    cls.bytes += Number(o.size) || 0;
    if (sheets.has(sheetKey)) cls.withSheet += 1; else cls.withoutSheet += 1;
    const t = o.lastModified ? new Date(o.lastModified).getTime() : NaN;
    if (Number.isFinite(t)) {
      const days = Math.max(0, (nowMs - t) / 86_400_000);
      cls.ageBuckets[bucketOf(days)].count += 1;
      if (cls.oldestDays === null || days > cls.oldestDays) cls.oldestDays = days;
    }
  }
  return out;
}

/** printable report (counts / sizes / ages only) */
export function formatLeftoverReport(sum) {
  const mb = (b) => (b / 1048576).toFixed(1);
  const block = (title, c) => [
    `${title}: ${c.count} object(s), ${mb(c.bytes)} MB`,
    `  with a sheet of the same upload: ${c.withSheet} · without: ${c.withoutSheet}`,
    `  age: ${c.ageBuckets.map((b) => `${b.label} ${b.count}`).join(' · ')}`,
    `  oldest: ${c.oldestDays === null ? 'n/a' : `${Math.floor(c.oldestDays)} day(s)`}`,
  ].join('\n');
  return [
    `objects under characters/: ${sum.total} (not raw selfies: ${sum.other})`,
    block('current-format raw selfies (should be 0 — each is a failed delete)', sum.newRaw),
    block('legacy raw selfies (key embeds a user id)', sum.legacyRaw),
    'READ-ONLY: nothing was changed. No keys, owners or URLs are printed. A raw "without a sheet" may still be named by a live Redis pointer (not checked here).',
  ].join('\n');
}
