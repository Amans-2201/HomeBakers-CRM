import test from 'node:test';
import assert from 'node:assert/strict';
import { getStorefrontOrderMetrics } from './analytics.js';

const now = new Date('2026-11-11T12:00:00.000+05:30');

test('counts current storefront orders in the selected India-local date range', () => {
  const orders = [
    { id: 'today', createdAt: new Date('2026-11-11T04:00:00.000Z') },
    { id: 'first-day', createdAt: new Date('2026-11-05T18:31:00.000Z') },
    { id: 'outside-range', createdAt: new Date('2026-11-04T18:29:00.000Z') },
    { id: 'future', createdAt: new Date('2026-11-11T07:00:00.000Z') }
  ];

  const result = getStorefrontOrderMetrics(orders, '7', now);

  assert.equal(result.conversions, 2);
  assert.deepEqual(result.dailyCounts, {
    '2026-11-06': 1,
    '2026-11-11': 1
  });
  assert.deepEqual(result.recentEvents.map(event => event.event_type), ['order_placed', 'order_placed']);
});

test('updates the conversion count when a Firestore order is deleted', () => {
  const firstOrder = { id: 'first', createdAt: new Date('2026-11-11T04:00:00.000Z') };
  const secondOrder = { id: 'second', createdAt: new Date('2026-11-11T05:00:00.000Z') };

  assert.equal(getStorefrontOrderMetrics([firstOrder, secondOrder], '30', now).conversions, 2);
  assert.equal(getStorefrontOrderMetrics([secondOrder], '30', now).conversions, 1);
});

test('does not count manually entered orders as storefront conversions', () => {
  const orders = [
    { id: 'phone', source: 'phone', createdBy: 'baker', createdAt: now },
    { id: 'whatsapp', source: 'whatsapp', createdAt: now },
    { id: 'storefront', customerUid: 'customer', createdAt: now }
  ];

  assert.equal(getStorefrontOrderMetrics(orders, '30', now).conversions, 1);
});

test('accepts Firestore timestamp values and counts the realtime day', () => {
  const order = { id: 'timestamp', createdAt: { toDate: () => new Date('2026-11-10T20:00:00.000Z') } };

  const result = getStorefrontOrderMetrics([order], '1', now);

  assert.equal(result.conversions, 1);
  assert.deepEqual(result.dailyCounts, { '2026-11-11': 1 });
});
