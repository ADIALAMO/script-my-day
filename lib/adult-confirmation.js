/**
 * "I am 18 or older" for Star Yourself — stored PER ACCOUNT (never per device), with the time it was given.
 *
 *   Redis  user:adult:<userId> = {"at":"<ISO time>","v":1}   (no TTL: it is the account's record, removed with the account by
 *          scripts/delete-user-data.js, which deletes every key that embeds the user id)
 *
 * It is a self-declaration, NOT age verification — nothing here can check a person's age. The apparent-minor image screen
 * (lib/minor-screen.js) is a separate layer and is untouched.
 */
import redis from './redis.js';

export const ADULT_CONFIRMATION_VERSION = 1;
export const adultKey = (userId) => `user:adult:${userId}`;

/** @returns {Promise<{ confirmed: boolean, at: string|null }>} THROWS when Redis cannot answer (callers decide: the upload route fails CLOSED) */
export async function readAdultConfirmation(userId) {
  if (!userId) return { confirmed: false, at: null };
  const raw = await redis.get(adultKey(userId));
  if (!raw) return { confirmed: false, at: null };
  try {
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return d && typeof d === 'object' && d.at ? { confirmed: true, at: String(d.at) } : { confirmed: false, at: null };
  } catch { return { confirmed: false, at: null }; }
}

/** Records the confirmation once; a repeat keeps the FIRST timestamp (NX). THROWS on a Redis failure. */
export async function writeAdultConfirmation(userId) {
  const at = new Date().toISOString();
  await redis.set(adultKey(userId), JSON.stringify({ at, v: ADULT_CONFIRMATION_VERSION }), { nx: true });
  return readAdultConfirmation(userId);
}
