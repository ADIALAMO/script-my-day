/**
 * The creator credit ("DIRECTED BY …") is free text that ends up printed on the poster, the shared image and the print view. It goes through the same
 * keyword blocklist as every other user text (lib/content-blocklist.js — pure, no I/O, safe in the browser). A blocked name is never rendered: the default
 * guest credit is used instead and the form says why. Pure + unit tested (tests/ugc-media.test.js).
 */
import { checkContent } from '../lib/content-blocklist.js';

export const PRODUCER_NAME_MAX = 22;   // same cap as the input field

/** @returns {{ name: string, blocked: boolean }}  name is '' when empty or blocked */
export function cleanProducerName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, PRODUCER_NAME_MAX);
  if (!name) return { name: '', blocked: false };
  if (checkContent(name).blocked) return { name: '', blocked: true };
  return { name, blocked: false };
}

/** the credit to RENDER: the cleaned name, or the guest default (he: אורח / en: Guest) */
export function displayProducerName(raw, lang, guestEn = 'Guest') {
  return cleanProducerName(raw).name || (lang === 'he' ? 'אורח' : guestEn);
}
