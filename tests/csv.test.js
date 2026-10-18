import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv, CSV_BOM } from '../lib/csv.js';

test('csvCell: null/undefined -> empty; plain values untouched; numbers stringified', () => {
  assert.equal(csvCell(null), ''); assert.equal(csvCell(undefined), ''); assert.equal(csvCell('abc'), 'abc'); assert.equal(csvCell(7), '7'); assert.equal(csvCell('2026-10-20T08:00:00.000Z'), '2026-10-20T08:00:00.000Z');
});

test('csvCell: quotes cells with comma, quote, CR or LF and doubles inner quotes; Hebrew passes through', () => {
  assert.equal(csvCell('a,b'), '"a,b"'); assert.equal(csvCell('say "hi"'), '"say ""hi"""'); assert.equal(csvCell('l1\nl2'), '"l1\nl2"'); assert.equal(csvCell('l1\r\nl2'), '"l1\r\nl2"');
  assert.equal(csvCell('שלום'), 'שלום');
});

test('csvCell: formula injection — = + - @ TAB CR (also after leading whitespace) get a single quote in front, then normal quoting', () => {
  for (const bad of ['=1+1', '+cmd', '-2+3', '@SUM(A1)', '\tx', '\rx', ' =1+1', '  @x']) {
    const out = csvCell(bad);
    assert.ok(out.replace(/^"/, '').startsWith("'"), `${JSON.stringify(bad)} -> ${JSON.stringify(out)}`);
  }
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);   // prefix AND quoting
  assert.equal(csvCell('+1,5'), `"'+1,5"`);
  for (const ok of ['a=b', 'a+b@c.com', 'x-y', '1=2', "'already", '#hash']) assert.equal(csvCell(ok), ok);
});

test('toCsv: BOM first, header row, CRLF line endings, trailing CRLF, column order, missing keys empty', () => {
  const out = toCsv(['email', 'createdAt', 'userId'], [{ email: 'a@b.com', createdAt: '2026-01-01', userId: null }, { email: '=x@y.com', userId: 'u:1' }]);
  assert.equal(out.charCodeAt(0), 0xFEFF); assert.equal(CSV_BOM, '﻿');
  assert.equal(out, "﻿email,createdAt,userId\r\na@b.com,2026-01-01,\r\n'=x@y.com,,u:1\r\n");
  assert.equal(toCsv(['a'], []), '﻿a\r\n');
});
