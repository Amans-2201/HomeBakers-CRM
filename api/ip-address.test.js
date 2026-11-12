import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicIp } from './ip-address.js';

test('accepts public IPv4 and IPv6 addresses', () => {
  assert.equal(normalizePublicIp('8.8.8.8'), '8.8.8.8');
  assert.equal(normalizePublicIp('2001:4860:4860::8888'), '2001:4860:4860::8888');
});

test('rejects private, reserved, and malformed IP addresses', () => {
  for (const address of [
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '198.51.100.8',
    '203.0.113.42',
    'fd00::1',
    'fe80::1',
    '2001:db8::1',
    'not-an-ip'
  ]) {
    assert.equal(normalizePublicIp(address), null, `${address} is not publicly routable`);
  }
});
