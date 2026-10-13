#!/usr/bin/env node
/**
 * READ-ONLY: how many raw "Star Yourself" selfies are still in the PUBLIC R2 bucket, and how old they are. Counts, sizes and ages only —
 * no key, owner, user id or URL is ever printed. It issues ListObjectsV2 and nothing else (no Get, Head, Put, Copy or Delete) and never touches Redis.
 *
 *   node scripts/list-leftover-raw-selfies.mjs
 *
 * Environment (names only): CLOUDFLARE_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY. This script does NOT read .env files. Any of the four that is
 * not already in the shell is asked for at a prompt (the two key values with the typing hidden); with no terminal it stops at stage=config.
 * An "Object Read only" R2 token scoped to the one bucket is enough (ListObjectsV2 is the only call).
 * A failure prints ONLY: stage (config | list) + an allowlisted reason (+ class / http status) — never a message, key, bucket, account id or URL. Deciding what to clean up is a separate, manual step
 * (docs-private/legacy-raw-selfie-cleanup-plan.md); this script deletes nothing.
 */
import { pathToFileURL } from 'node:url';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { summariseLeftoverRaws, formatLeftoverReport } from '../lib/leftover-raw.js';
import { safeErrInfo, formatSafeErr } from '../lib/safe-error.js';

export const ENV_NAMES = ['CLOUDFLARE_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
const HIDDEN = new Set(['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);

/** names (from the fixed list above) that are unset or blank */
export const missingEnv = (env) => ENV_NAMES.filter((k) => !String(env[k] ?? '').trim());

/** A failure with a stage and a reason taken from a FIXED set of strings (never from an error message). */
export class StageError extends Error {
  constructor(stage, reason, info = {}) { super(reason); this.stage = stage; this.reason = reason; this.info = info; }
}

const REASONS = {
  AccessDenied: 'access denied: the token needs "Object Read only" on THIS bucket',
  NoSuchBucket: 'bucket not found: check R2_BUCKET_NAME and the account id',
  InvalidAccessKeyId: 'credentials rejected: use the Access Key ID + Secret Access Key of an R2 API token (not the token value)',
  SignatureDoesNotMatch: 'credentials rejected: use the Access Key ID + Secret Access Key of an R2 API token (not the token value)',
  ExpiredToken: 'the token has expired: create a new one',
  InvalidToken: 'the token is invalid: create a new one',
  TimeoutError: 'timed out reaching R2',
  NetworkingError: 'network error reaching R2',
  TypeError: 'network error reaching R2 (check the account id)',
};

/** one printable line: stage + allowlisted reason (+ class/http). Nothing from the error's own message. */
export function describeFailure(e) {
  if (e instanceof StageError) return `stage=${e.stage} reason=${e.reason}${e.info.cls ? ` ${formatSafeErr(e.info)}` : ''}`;
  const info = safeErrInfo(e);
  return `stage=list reason=${REASONS[info.cls] ?? 'unexpected error'} ${formatSafeErr(info)}`;
}

/** asks for one value; secrets are not echoed. Resolves '' when there is no terminal. */
async function ask(name) {
  if (!process.stdin.isTTY) return '';
  const hidden = HIDDEN.has(name);
  const out = hidden ? new Writable({ write(_c, _e, cb) { cb(); } }) : process.stderr;
  const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
  process.stderr.write(`${name}${hidden ? ' (hidden)' : ''}: `);
  try { return (await rl.question('')).trim(); } finally { rl.close(); if (hidden) process.stderr.write('\n'); }
}

/** @param {{ list: (prefix: string) => Promise<{key:string,size?:number,lastModified?:Date}[]> }} r2 */
export async function run({ r2, log = console.log, now = Date.now }) {
  let objects;
  try { objects = await r2.list('characters/'); }
  catch (e) { throw e instanceof StageError ? e : Object.assign(new StageError('list', REASONS[safeErrInfo(e).cls] ?? 'unexpected error', safeErrInfo(e))); }
  log(formatLeftoverReport(summariseLeftoverRaws(objects, now())));
  return { code: 0 };
}

async function main() {
  for (const name of missingEnv(process.env)) { const v = await ask(name); if (v) process.env[name] = v; }
  const missing = missingEnv(process.env);
  if (missing.length) throw new StageError('config', `missing env ${missing.join(', ')} (set them in the shell, or run in a terminal to be prompted)`);
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim() } });
  const r2 = {
    async list(Prefix) {
      const out = []; let ContinuationToken;
      do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME.trim(), Prefix, ContinuationToken }));
        for (const o of res.Contents || []) out.push({ key: o.Key, size: o.Size, lastModified: o.LastModified });
        ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return out;
    },
  };
  const { code } = await run({ r2 });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`list-leftover-raw-selfies: ${describeFailure(e)}`); process.exit(1); });
}
