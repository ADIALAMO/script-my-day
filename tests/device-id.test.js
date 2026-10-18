// The client no longer creates or sends a random device id (the server never used it — guests are keyed by IP); an old stored value is removed once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const walk = (dir) => readdirSync(path.join(ROOT, dir)).flatMap((f) => { const rel = `${dir}/${f}`; return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(jsx?|mjs)$/.test(f) ? [rel] : []; });

test('no client code creates, reads or sends a device id; pages/index.js only removes the legacy value', () => {
  const offenders = [];
  for (const rel of ['components', 'hooks', 'utils', 'pages', 'constants'].flatMap(walk)) {
    if (rel.startsWith('pages/api/')) continue;
    readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      if (/x-device-id|\bdeviceId\b|setItem\(\s*['"]lifescript_device_id|getItem\(\s*['"]lifescript_device_id|LS_DEVICE/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, []);
  assert.match(readFileSync(path.join(ROOT, 'pages/index.js'), 'utf8'), /localStorage\.removeItem\('lifescript_device_id'\)/);
});

test('the server still ignores any device id a stale client might send (guest identity = IP)', () => {
  const src = readFileSync(path.join(ROOT, 'lib/api-utils.js'), 'utf8');
  assert.match(src, /Deliberately ignores x-device-id and body\.deviceId/);
  const api = walk('pages/api').map((f) => readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.doesNotMatch(api, /x-device-id|\.deviceId\b/);
});
