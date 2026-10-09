import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGuestIp, extractIdentifier } from '../lib/api-utils.js';

test('IPv4 is unchanged', () => {
  assert.equal(normalizeGuestIp('203.0.113.7'), '203.0.113.7');
  assert.equal(normalizeGuestIp('unknown'), 'unknown');
});

test('IPv6 addresses of one /64 share one key, in every notation', () => {
  const k = '2001:db8:1:1::/64';
  for (const ip of ['2001:db8:1:1::1', '2001:db8:1:1::2', '2001:db8:1:1:aaaa:bbbb:cccc:dddd',
    '2001:0db8:0001:0001:0000:0000:0000:0001', '2001:DB8:1:1:ffff:ffff:ffff:ffff', '[2001:db8:1:1::9]', '2001:db8:1:1::1%eth0']) {
    assert.equal(normalizeGuestIp(ip), k, ip);
  }
});

test('different /64s stay different', () => {
  assert.notEqual(normalizeGuestIp('2001:db8:1:1::1'), normalizeGuestIp('2001:db8:1:2::1'));
  assert.notEqual(normalizeGuestIp('2001:db8:1::1'), normalizeGuestIp('2001:db8:2::1'));
});

test('edge forms', () => {
  assert.equal(normalizeGuestIp('::1'), '0:0:0:0::/64');
  assert.equal(normalizeGuestIp('::ffff:198.51.100.4'), '198.51.100.4');   // IPv4-mapped is just IPv4
  assert.equal(normalizeGuestIp('2001:db8::'), '2001:db8:0:0::/64');
  assert.equal(normalizeGuestIp('not:an:ip'), 'not:an:ip');                 // unparseable → unchanged
});

test('extractIdentifier applies the /64 to the trusted IP only', () => {
  assert.equal(extractIdentifier({ headers: { 'x-real-ip': '2001:db8:1:1::5', 'x-forwarded-for': '9.9.9.9' } }), '2001:db8:1:1::/64');
  assert.equal(extractIdentifier({ headers: { 'x-forwarded-for': '9.9.9.9, 198.51.100.2' } }), '198.51.100.2');
});
