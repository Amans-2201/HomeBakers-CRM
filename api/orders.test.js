import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderPayload } from './orders.js';
import { createSessionToken, passwordMatches, verifySessionToken } from './security.js';
import { createApp } from './server.js';

const basePayload = {
  orderRef: 'a5be222b-8bba-4707-bb84-d79d638f72ce',
  customer: { name: 'Aman Baker', phone: '+91 98765 43210' },
  order: {
    fulfillment: 'delivery',
    address: '71 Mohini Road',
    pincode: '248001',
    latitude: 30.31,
    longitude: 78.06,
    distanceKm: 6,
    subtotal: 999999,
    deliveryFee: 0,
    total: 999999
  },
  items: [{ name: 'Vanilla Butter Cookies', quantity: 3, unitPrice: 1 }]
};

test('validates the trusted cookie prices and computes order totals', () => {
  const result = validateOrderPayload(basePayload);
  assert.equal(result.value.order.subtotal, 660);
  assert.equal(result.value.order.deliveryFee, 200);
  assert.equal(result.value.order.total, 860);
  assert.equal(result.value.items[0].unitPrice, 220);
});

test('enforces the delivery minimum for routes over seven kilometres', () => {
  const result = validateOrderPayload({
    ...basePayload,
    order: { ...basePayload.order, distanceKm: 7.1 },
    items: [{ name: 'Vanilla Butter Cookies', quantity: 2 }]
  });
  assert.match(result.error, /minimum/i);
});

test('uses the lower minimum through seven kilometres and accepts exactly seven', () => {
  const result = validateOrderPayload({
    ...basePayload,
    order: { ...basePayload.order, distanceKm: 7 },
    items: [{ name: 'Vanilla Butter Cookies', quantity: 3 }]
  });
  assert.equal(result.value.order.subtotal, 660);
  assert.equal(result.value.order.deliveryFee, 200);
});

test('rejects delivery routes beyond ten kilometres', () => {
  const result = validateOrderPayload({
    ...basePayload,
    order: { ...basePayload.order, distanceKm: 10.01 }
  });
  assert.match(result.error, /within 10 km/i);
});

test('accepts delivery at the ten kilometre limit when the minimum is met', () => {
  const result = validateOrderPayload({
    ...basePayload,
    order: { ...basePayload.order, distanceKm: 10 },
    items: [
      { name: 'Vanilla Butter Cookies', quantity: 1 },
      { name: 'Choco Chip Cookies', quantity: 1 },
      { name: 'Almond Cashew Cookies', quantity: 1 },
      { name: 'Coconut Cookies', quantity: 1 }
    ]
  });
  assert.equal(result.value.order.subtotal, 1000);
  assert.equal(result.value.order.total, 1200);
});

test('allows pickup without delivery coordinates and charges no delivery fee', () => {
  const result = validateOrderPayload({
    ...basePayload,
    order: { fulfillment: 'pickup', address: '', pincode: '' }
  });
  assert.equal(result.value.order.deliveryFee, 0);
  assert.equal(result.value.order.total, 660);
});

test('rejects tampered products and invalid quantities', () => {
  assert.match(validateOrderPayload({
    ...basePayload,
    items: [{ name: 'Made-up Cookie', quantity: 1 }]
  }).error, /varieties are invalid/i);
  assert.match(validateOrderPayload({
    ...basePayload,
    items: [{ name: 'Vanilla Butter Cookies', quantity: 0 }]
  }).error, /quantities/i);
});

test('verifies expiring signed admin sessions and password comparison', () => {
  const secret = 'private-session-secret-string-for-test';
  const token = createSessionToken(secret, 5000);
  assert.equal(verifySessionToken(token, secret, 1000), true);
  assert.equal(verifySessionToken(token, secret, 5000), false);
  assert.equal(verifySessionToken(token, 'wrong-secret-value-for-test', 1000), false);
  assert.equal(passwordMatches('secret-password', 'secret-password'), true);
  assert.equal(passwordMatches('incorrect-password', 'secret-password'), false);
});

test('requires a valid admin session to read dashboard data', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ order_count: 0, sales_total: 0, customer_count: 0 }] };
      }
      return { rows: [] };
    }
  };
  const server = createApp({
    pool,
    adminPassword: 'a-private-password',
    sessionSecret: 'a-long-test-session-secret-at-least-32-chars'
  }).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const privateResponse = await fetch(`${baseUrl}/api/admin/summary`);
    assert.equal(privateResponse.status, 401);

    const failedLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' })
    });
    assert.equal(failedLogin.status, 401);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'a-private-password' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const dashboard = await fetch(`${baseUrl}/api/admin/summary`, { headers: { Cookie: cookie } });
    assert.equal(dashboard.status, 200);
    assert.deepEqual(await dashboard.json(), {
      order_count: 0,
      sales_total: 0,
      customer_count: 0,
      popularCookies: []
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
