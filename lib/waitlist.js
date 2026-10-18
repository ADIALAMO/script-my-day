/**
 * Pro waitlist records — ONE place for the shape, shared by pages/api/waitlist.js, scripts/migrate-waitlist-records.mjs and (later) the admin export.
 *
 * Redis key:   waitlist:<normalized e-mail>          (the key already existed; only the value changed, so delete-user-data.js keeps finding it)
 * Redis value: JSON string  { v, email, createdAt, locale, source, userId, consentVersion }
 *              LEGACY value (before this change): a bare number = signup time in unix-ms. readers must accept both.
 *
 * Never log a record or an address: logs and Telegram carry the masked form only (lib/telegram.js maskEmail).
 */

/** Bump when the purpose sentence in constants/waitlist-copy.js (or the Privacy waitlist sentence) changes in substance. */
export const WAITLIST_CONSENT_VERSION = 1;
export const WAITLIST_SOURCE = 'pro-modal';
export const WAITLIST_LEGACY_SOURCE = 'legacy-waitlist';
export const WAITLIST_KEY_PREFIX = 'waitlist:';
export const WAITLIST_RECORD_VERSION = 1;

/**
 * Honeypot input name. Deliberately NOT a word browsers or password managers autofill ("website", "url", "phone", "company", "address", …) — a real
 * signup must never be silently dropped because the browser filled a hidden field. tests/waitlist.test.js checks it is not a standard autofill token.
 */
export const HONEYPOT_FIELD = 'zq_ref7x';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;

/** trimmed + lowercased address, or null when it is not a plausible e-mail (non-string, empty, too long, inner whitespace, no @/dot). */
export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  if (!clean || clean.length > MAX_EMAIL || !EMAIL_RE.test(clean)) return null;
  return clean;
}

export const waitlistKey = (email) => `${WAITLIST_KEY_PREFIX}${email}`;

/** only 'he' | 'en' are stored; anything else is null */
export const normalizeLocale = (lang) => (lang === 'he' || lang === 'en' ? lang : null);

export function buildRecord({ email, lang, userId = null, now = new Date() }) {
  return {
    v: WAITLIST_RECORD_VERSION,
    email,
    createdAt: now.toISOString(),
    locale: normalizeLocale(lang),
    source: WAITLIST_SOURCE,
    userId: typeof userId === 'string' && userId ? userId : null,
    consentVersion: WAITLIST_CONSENT_VERSION,
  };
}

/** a legacy timestamp is accepted only inside a sane window (2020-01-01 .. one day from now); otherwise createdAt is null */
export function legacyCreatedAt(ms, nowMs = Date.now()) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < Date.UTC(2020, 0, 1) || n > nowMs + 86_400_000) return null;
  return new Date(n).toISOString();
}

export function buildLegacyRecord({ email, legacyValue, nowMs = Date.now() }) {
  return {
    v: WAITLIST_RECORD_VERSION,
    email,
    createdAt: legacyCreatedAt(legacyValue, nowMs),
    locale: null,
    source: WAITLIST_LEGACY_SOURCE,
    userId: null,
    consentVersion: null,
  };
}

/**
 * Raw Redis value -> { kind: 'v1', record } | { kind: 'legacy', value } | { kind: 'unreadable' }.
 * Upstash may hand back the JSON string or an already-parsed object, and a legacy number may arrive as number or numeric string.
 */
export function parseWaitlistValue(raw) {
  if (raw === null || raw === undefined) return { kind: 'unreadable' };
  if (typeof raw === 'number' && Number.isFinite(raw)) return { kind: 'legacy', value: raw };
  let v = raw;
  if (typeof raw === 'string') {
    if (/^\d{9,16}$/.test(raw.trim())) return { kind: 'legacy', value: Number(raw.trim()) };
    try { v = JSON.parse(raw); } catch { return { kind: 'unreadable' }; }
    if (typeof v === 'number' && Number.isFinite(v)) return { kind: 'legacy', value: v };
  }
  if (v && typeof v === 'object' && v.v === WAITLIST_RECORD_VERSION && typeof v.email === 'string') return { kind: 'v1', record: v };
  return { kind: 'unreadable' };
}

export const serializeRecord = (record) => JSON.stringify(record);

/**
 * Admin view of one stored value: the same row for a v1 record and for a legacy bare timestamp, or null when unreadable.
 * The e-mail comes from the KEY (the source of truth for uniqueness); the key itself is never exposed.
 */
export function rowFromValue(email, raw, nowMs = Date.now()) {
  const p = parseWaitlistValue(raw);
  if (p.kind === 'v1') {
    const r = p.record;
    const t = typeof r.createdAt === 'string' ? Date.parse(r.createdAt) : NaN;
    return {
      email,
      createdAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
      locale: normalizeLocale(r.locale),
      source: typeof r.source === 'string' ? r.source : null,
      userId: typeof r.userId === 'string' && r.userId ? r.userId : null,
      consentVersion: Number.isInteger(r.consentVersion) ? r.consentVersion : null,
    };
  }
  if (p.kind === 'legacy') {
    return { email, createdAt: legacyCreatedAt(p.value, nowMs), locale: null, source: WAITLIST_LEGACY_SOURCE, userId: null, consentVersion: null };
  }
  return null;
}

/** newest first; rows without a date (legacy with no usable timestamp) last; e-mail ascending as the tie-break */
export function compareRows(a, b) {
  const ta = a.createdAt ? Date.parse(a.createdAt) : null;
  const tb = b.createdAt ? Date.parse(b.createdAt) : null;
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  return a.email < b.email ? -1 : a.email > b.email ? 1 : 0;
}
