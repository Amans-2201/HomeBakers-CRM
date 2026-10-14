import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManualOrderPayload, validateOrderPayload } from './orders.js';
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

test('validates manual call orders and calculates trusted catalog totals', () => {
  const result = validateManualOrderPayload({
    customer: { name: '  Call customer ', phone: '+91 98765 43210' },
    fulfillment: 'delivery',
    address: '31 Baker Street',
    pincode: '248001',
    deliveryFee: 75,
    items: [
      { name: 'Vanilla Butter Cookies', quantity: 2, unitPrice: 1 },
      { name: 'Choco Chip Cookies', quantity: 1 }
    ]
  });
  assert.deepEqual(result.value.customer, { name: 'Call customer', phone: '+91 98765 43210' });
  assert.equal(result.value.order.subtotal, 700);
  assert.equal(result.value.order.total, 775);
  assert.deepEqual(result.value.items[0], {
    name: 'Vanilla Butter Cookies',
    unitPrice: 220,
    quantity: 2,
    lineTotal: 440
  });
});

test('rejects call orders with missing delivery address, invalid item, or invalid pickup fee', () => {
  const details = {
    customer: { name: 'Call customer', phone: '9876543210' },
    fulfillment: 'delivery',
    address: '',
    deliveryFee: 100,
    items: [{ name: 'Vanilla Butter Cookies', quantity: 1 }]
  };
  assert.match(validateManualOrderPayload(details).error, /address is required/i);
  assert.match(validateManualOrderPayload({
    ...details,
    fulfillment: 'pickup',
    address: '',
    deliveryFee: 1
  }).error, /pickup orders/i);
  assert.match(validateManualOrderPayload({
    ...details,
    address: 'Valid address',
    items: [{ name: 'Unknown item', quantity: 1 }]
  }).error, /varieties are invalid/i);
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
  const statements = [];
  const pool = {
    async query(sql, parameters = []) {
      statements.push({ sql, parameters });
      if (sql.includes('COUNT(*)')) {
        return {
          rows: [{
            order_count: 0,
            sales_total: 0,
            inventory_cost: '0.00',
            profit_total: '0.00',
            customer_count: 0
          }]
        };
      }
      if (sql.includes('DATE_TRUNC(')) {
        return { rows: [{ period: '2026-10-01', sales: 440 }] };
      }
      if (sql.includes('SELECT p.purchased_on::text')) {
        return { rows: [{ period: '2026-10-01', cost: '125.50' }] };
      }
      if (sql.includes('SELECT oi.cookie_name')) {
        return { rows: [{ cookie_name: 'Vanilla Butter Cookies', quantity: 2 }] };
      }
      if (sql.includes('COUNT(o.id)::int AS order_count')) {
        return { rows: [{ id: '7', customer_name: 'Aman Baker', order_count: 2 }] };
      }
      if (sql.includes('SELECT p.id')) return { rows: [] };
      if (sql.includes('INSERT INTO inventory_purchases')) {
        return {
          rowCount: 1,
          rows: [{
            id: '8',
            item_name: parameters[0],
            unit_price: parameters[1],
            quantity: parameters[2],
            purchased_on: parameters[3],
            total_cost: '13.00'
          }]
        };
      }
      if (sql.includes('DELETE FROM inventory_purchases')) {
        return { rowCount: 1, rows: [{ id: '8' }] };
      }
      if (sql.includes('UPDATE orders')) {
        return { rowCount: 1, rows: [{ id: '1', order_fulfillment: parameters[0] }] };
      }
      if (sql.includes('DELETE FROM orders')) {
        return { rowCount: 1, rows: [{ id: '1' }] };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, parameters = []) {
          statements.push({ sql, parameters });
          if (sql.includes('INSERT INTO customers')) return { rows: [{ id: '7' }] };
          if (sql.includes('INSERT INTO orders')) return { rows: [{ id: '42' }] };
          return { rows: [] };
        },
        release() {}
      };
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
      inventory_cost: '0.00',
      profit_total: '0.00',
      customer_count: 0,
      popularCookies: []
    });

    const invalidDate = await fetch(`${baseUrl}/api/admin/summary?startDate=2026-02-30`, {
      headers: { Cookie: cookie }
    });
    assert.equal(invalidDate.status, 400);

    const filteredSummary = await fetch(
      `${baseUrl}/api/admin/summary?startDate=2026-10-01&endDate=2026-10-14`,
      { headers: { Cookie: cookie } }
    );
    assert.equal(filteredSummary.status, 200);
    const salesQuery = statements.find(
      statement => statement.sql.includes('SUM(o.total)') && statement.sql.includes('Asia/Kolkata')
    );
    assert.match(salesQuery.sql, /o\.order_fulfillment = 'Yes'/);
    assert.deepEqual(salesQuery.parameters, ['2026-10-01', '2026-10-14']);
    assert.match(salesQuery.sql, /p\.purchased_on >= \$1::date/);
    assert.match(salesQuery.sql, /p\.purchased_on <= \$2::date/);

    const analyticsResponse = await fetch(
      `${baseUrl}/api/admin/analytics?startDate=2026-10-01&endDate=2026-10-14`,
      { headers: { Cookie: cookie } }
    );
    assert.equal(analyticsResponse.status, 200);
    assert.deepEqual(await analyticsResponse.json(), {
      salesCosts: [{ period: '2026-10-01', sales: 440, cost: 125.5 }],
      cookieSales: [{ cookie_name: 'Vanilla Butter Cookies', quantity: 2 }],
      customerOrders: [{ id: '7', customer_name: 'Aman Baker', order_count: 2 }]
    });
    const analyticsQueries = statements.filter(statement =>
      statement.sql.includes('DATE_TRUNC(')
      || statement.sql.includes('SELECT p.purchased_on::text')
      || statement.sql.includes('SELECT oi.cookie_name')
      || statement.sql.includes('COUNT(o.id)::int AS order_count')
    );
    assert.equal(analyticsQueries.length, 4);
    assert.ok(analyticsQueries.every(statement =>
      JSON.stringify(statement.parameters) === JSON.stringify(['2026-10-01', '2026-10-14'])
    ));

    const filteredOrders = await fetch(
      `${baseUrl}/api/admin/orders?limit=10&search=Aman&startDate=2026-10-01&endDate=2026-10-14`,
      { headers: { Cookie: cookie } }
    );
    assert.equal(filteredOrders.status, 200);
    const ordersQuery = statements.find(statement => statement.sql.includes('SELECT o.id'));
    assert.match(ordersQuery.sql, /o\.created_at >=/);
    assert.match(ordersQuery.sql, /o\.created_at </);
    assert.deepEqual(ordersQuery.parameters, ['2026-10-01', '2026-10-14', '%Aman%', 10]);

    const invalidFulfillment = await fetch(`${baseUrl}/api/admin/orders/1`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_fulfillment: 'delivery' })
    });
    assert.equal(invalidFulfillment.status, 400);

    const updatedOrder = await fetch(`${baseUrl}/api/admin/orders/1`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_fulfillment: 'No' })
    });
    assert.equal(updatedOrder.status, 200);
    assert.deepEqual(await updatedOrder.json(), {
      order: { id: '1', order_fulfillment: 'No' }
    });

    const deletedOrder = await fetch(`${baseUrl}/api/admin/orders/1`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    });
    assert.equal(deletedOrder.status, 200);
    assert.deepEqual(await deletedOrder.json(), { deleted: true, orderId: '1' });

    const invalidManualOrder = await fetch(`${baseUrl}/api/admin/orders`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: { name: 'Call customer', phone: '9876543210' },
        fulfillment: 'delivery',
        deliveryFee: 100,
        items: [{ name: 'Vanilla Butter Cookies', quantity: 1 }]
      })
    });
    assert.equal(invalidManualOrder.status, 400);

    const manualOrder = await fetch(`${baseUrl}/api/admin/orders`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: { name: 'Call customer', phone: '9876543210' },
        fulfillment: 'pickup',
        deliveryFee: 0,
        items: [{ name: 'Vanilla Butter Cookies', quantity: 2, unitPrice: 1 }]
      })
    });
    assert.equal(manualOrder.status, 201);
    assert.deepEqual(await manualOrder.json(), { saved: true, orderId: '42' });
    const manualOrderInsert = statements.find(statement => statement.sql.includes('INSERT INTO orders'));
    assert.equal(manualOrderInsert.parameters[5], 440);
    assert.equal(manualOrderInsert.parameters[7], 440);
    const itemInsert = statements.find(statement => statement.sql.includes('INSERT INTO order_items'));
    assert.deepEqual(itemInsert.parameters.slice(1), ['Vanilla Butter Cookies', 220, 2, 440]);

    const filteredInventory = await fetch(
      `${baseUrl}/api/admin/inventory?startDate=2026-10-01&endDate=2026-10-14`,
      { headers: { Cookie: cookie } }
    );
    assert.equal(filteredInventory.status, 200);
    const inventoryQuery = statements.find(statement => statement.sql.includes('SELECT p.id'));
    assert.match(inventoryQuery.sql, /p\.purchased_on >= \$1::date/);
    assert.match(inventoryQuery.sql, /p\.purchased_on <= \$2::date/);
    assert.deepEqual(inventoryQuery.parameters, ['2026-10-01', '2026-10-14', 50]);

    const invalidPurchaseDate = await fetch(`${baseUrl}/api/admin/inventory`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemName: 'Flour', unitPrice: 3.25, quantity: 4, purchaseDate: '2026-02-30' })
    });
    assert.equal(invalidPurchaseDate.status, 400);

    const purchase = await fetch(`${baseUrl}/api/admin/inventory`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemName: 'Flour', unitPrice: 3.25, quantity: 4, purchaseDate: '2026-10-14' })
    });
    assert.equal(purchase.status, 201);
    assert.deepEqual((await purchase.json()).purchase, {
      id: '8',
      item_name: 'Flour',
      unit_price: '3.25',
      quantity: 4,
      purchased_on: '2026-10-14',
      total_cost: '13.00'
    });

    const deletedPurchase = await fetch(`${baseUrl}/api/admin/inventory/8`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    });
    assert.equal(deletedPurchase.status, 200);
    assert.deepEqual(await deletedPurchase.json(), { deleted: true, purchaseId: '8' });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
