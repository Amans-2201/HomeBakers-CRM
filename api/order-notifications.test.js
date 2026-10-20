import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrderNotificationHandler } from './order-notifications.js';

const orderId = '9bf5c2d2-b218-4ca7-9d57-f24762e6db28';

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('rejects invalid order references without looking up or sending email', async () => {
  let lookupCalled = false;
  const handler = createOrderNotificationHandler({
    pool: {},
    getOrder: async () => { lookupCalled = true; },
    sendEmail: async () => { throw new Error('Should not send'); }
  });
  const response = responseRecorder();

  await handler({ body: { orderId: 'bad-id' }, firebaseUser: { uid: 'customer-1' } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(lookupCalled, false);
});

test('only sends for a stored order owned by the caller or baker', async () => {
  let queryCalled = false;
  const handler = createOrderNotificationHandler({
    pool: { query: async () => { queryCalled = true; } },
    getOrder: async () => ({ customerUid: 'another-customer' }),
    sendEmail: async () => { throw new Error('Should not send'); }
  });
  const response = responseRecorder();

  await handler({
    body: { orderId },
    firebaseToken: 'verified-token',
    firebaseUser: { uid: 'customer-1', email: 'customer@example.com' }
  }, response);

  assert.equal(response.statusCode, 403);
  assert.equal(queryCalled, false);
});

test('sends a verified order notification once and records success', async () => {
  const queries = [];
  let recipient;
  const handler = createOrderNotificationHandler({
    pool: {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('INSERT INTO order_email_notifications')) {
          return { rowCount: 1, rows: [{ order_ref: orderId }] };
        }
        return { rowCount: 1, rows: [] };
      }
    },
    getOrder: async (requestedId, token) => {
      assert.equal(requestedId, orderId);
      assert.equal(token, 'verified-token');
      return {
        customerUid: 'customer-1',
        customer: { name: 'Customer' },
        fulfillment: 'pickup',
        items: [{ name: 'Vanilla Butter Cookies', quantity: 1, unitPrice: 220 }],
        subtotal: 220,
        deliveryFee: 0,
        total: 220
      };
    },
    sendEmail: async (_order, requestedId, email) => {
      assert.equal(requestedId, orderId);
      recipient = email;
      return 'mailer-message-id';
    }
  });
  const response = responseRecorder();

  await handler({
    body: { orderId },
    firebaseToken: 'verified-token',
    firebaseUser: { uid: 'customer-1', email: 'customer@example.com' }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { sent: true });
  assert.equal(recipient, 'amans66@gmail.com');
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /ON CONFLICT \(order_ref\)/);
  assert.match(queries[1].sql, /status = 'sent'/);
  assert.equal(queries[1].params[1], 'mailer-message-id');
});

test('does not send a duplicate notification for an already-sent order', async () => {
  let sendCalled = false;
  let queryCount = 0;
  const handler = createOrderNotificationHandler({
    pool: {
      async query() {
        queryCount += 1;
        return queryCount === 1
          ? { rowCount: 0, rows: [] }
          : { rowCount: 1, rows: [{ status: 'sent' }] };
      }
    },
    getOrder: async () => ({ customerUid: 'customer-1' }),
    sendEmail: async () => { sendCalled = true; }
  });
  const response = responseRecorder();

  await handler({
    body: { orderId },
    firebaseToken: 'verified-token',
    firebaseUser: { uid: 'customer-1', email: 'customer@example.com' }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { sent: true, duplicate: true });
  assert.equal(sendCalled, false);
});
