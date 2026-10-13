#!/usr/bin/env node
/**
 * READ-ONLY: how many raw "Star Yourself" selfies are still in the PUBLIC R2 bucket, and how old they are. Counts, sizes and ages only —
 * no key, owner, user id or URL is ever printed. It issues ListObjectsV2 and nothing else (no Get, Head, Put, Copy or Delete) and never touches Redis.
 *
 *   node scripts/list-leftover-raw-selfies.mjs
 *
 * Environment (names only; typed into the shell, never into a file): CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.
 * An "Object Read only" R2 token scoped to the one bucket is enough. Deciding what to clean up is a separate, manual step
 * (docs-private/legacy-raw-selfie-cleanup-plan.md); this script deletes nothing.
 */
import { pathToFileURL } from 'node:url';
import { summariseLeftoverRaws, formatLeftoverReport } from '../lib/leftover-raw.js';
import { printableError } from '../lib/safe-error.js';

/** @param {{ list: (prefix: string) => Promise<{key:string,size?:number,lastModified?:Date}[]> }} r2 */
export async function run({ r2, log = console.log, now = Date.now }) {
  const objects = await r2.list('characters/');
  log(formatLeftoverReport(summariseLeftoverRaws(objects, now())));
  return { code: 0 };
}

async function main() {
  const need = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`missing environment: ${missing.join(', ')}`);
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  const r2 = {
    async list(Prefix) {
      const out = []; let ContinuationToken;
      do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME, Prefix, ContinuationToken }));
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
  main().catch((e) => { console.error(`list-leftover-raw-selfies: ${printableError(e)}`); process.exit(1); });
}
