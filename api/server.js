import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createOrderNotificationHandler } from './order-notifications.js';
import { getFirestoreOrder } from './firebase-firestore.js';
import { buildOrderEmail } from './order-email.js';
import { validateManualOrderPayload, validateOrderPayload } from './orders.js';
import { createSessionToken, passwordMatches, verifySessionToken } from './security.js';

const { Pool } = pg;
const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticDirectory = path.resolve(appDirectory, '../dist');
const sessionCookieName = 'hb_admin_session';
const sessionDurationMs = 8 * 60 * 60 * 1000;

function createRateLimiter({ limit, windowMs }) {
  const requests = new Map();
  return (request, response, next) => {
    const now = Date.now();
    const key = request.ip;
    let entry = requests.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      requests.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      response.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return response.status(429).json({ error: 'Too many requests. Please wait and try again.' });
    }
    if (requests.size > 1000) {
      for (const [address, item] of requests) {
        if (now >= item.resetAt) requests.delete(address);
      }
    }
    return next();
  };
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    const key = part.slice(0, separator).trim();
    try {
      return [key, decodeURIComponent(part.slice(separator + 1).trim())];
    } catch {
      return [key, ''];
    }
  }).filter(([key]) => key));
}

function sameOrigin(request, origin) {
  const protocol = request.get('x-forwarded-proto')?.split(',')[0]?.trim() || request.protocol;
  return origin === `${protocol}://${request.get('host')}`;
}

function createOriginMiddleware(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return (request, response, next) => {
    const origin = request.get('Origin');
    if (origin && !allowed.has(origin) && !sameOrigin(request, origin)) {
      return response.status(403).json({ error: 'This website is not allowed to submit orders.' });
    }
    if (origin && allowed.has(origin)) {
      response.set('Access-Control-Allow-Origin', origin);
      response.vary('Origin');
    }
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return response.sendStatus(204);
    }
    return next();
  };
}

function ensureSameOrigin(request, response, next) {
  const origin = request.get('Origin');
  if (origin && !sameOrigin(request, origin)) {
    return response.status(403).json({ error: 'Invalid request origin.' });
  }
  return next();
}

function parsePositiveLimit(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) ? Math.max(1, Math.min(number, 100)) : 50;
}

function parseDateRange(query) {
  const { startDate, endDate } = query;
  const validDate = value => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value.slice(0, 4) !== '0000'
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

  if (startDate !== undefined && !validDate(startDate)) {
    return { error: 'Start date must be a valid date in YYYY-MM-DD format.' };
  }
  if (endDate !== undefined && !validDate(endDate)) {
    return { error: 'End date must be a valid date in YYYY-MM-DD format.' };
  }
  if (startDate && endDate && startDate > endDate) {
    return { error: 'Start date must be on or before the end date.' };
  }
  return { value: { startDate, endDate } };
}

function appendDateConditions(dateRange, parameters, timestampColumn) {
  const conditions = [];
  if (dateRange.startDate) {
    parameters.push(dateRange.startDate);
    conditions.push(`${timestampColumn} >= ($${parameters.length}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`);
  }
  if (dateRange.endDate) {
    parameters.push(dateRange.endDate);
    conditions.push(`${timestampColumn} < (($${parameters.length}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata')`);
  }
  return conditions.length ? `AND ${conditions.join(' AND ')}` : '';
}

function isValidOrderId(value) {
  return typeof value === 'string'
    && value.length <= 19
    && /^[1-9]\d*$/.test(value)
    && BigInt(value) <= 9223372036854775807n;
}

function appendPurchaseDateConditions(dateRange, parameters, dateColumn) {
  const conditions = [];
  if (dateRange.startDate) {
    parameters.push(dateRange.startDate);
    conditions.push(`${dateColumn} >= $${parameters.length}::date`);
  }
  if (dateRange.endDate) {
    parameters.push(dateRange.endDate);
    conditions.push(`${dateColumn} <= $${parameters.length}::date`);
  }
  return conditions.length ? `AND ${conditions.join(' AND ')}` : '';
}

function dateRangeParameters(dateRange) {
  return [dateRange.startDate, dateRange.endDate].filter(value => value !== undefined);
}

function analyticsGranularity(dateRange) {
  if (!dateRange.startDate || !dateRange.endDate) return 'month';
  const days = (Date.parse(`${dateRange.endDate}T00:00:00Z`) - Date.parse(`${dateRange.startDate}T00:00:00Z`))
    / 86400000;
  return days <= 90 ? 'day' : 'month';
}

export function createApp({
  pool,
  adminPassword,
  sessionSecret,
  allowedOrigins = [],
  verifyFirebaseIdToken,
  getFirebaseOrder,
  sendBakerOrderEmail
}) {
  if (!pool) throw new Error('A PostgreSQL connection pool is required.');
  if (!adminPassword || adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
  if (!sessionSecret || sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((request, response, next) => {
    response.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    });
    next();
  });
  app.use(createOriginMiddleware(allowedOrigins));
  app.use(express.json({ limit: '24kb', type: 'application/json' }));

  app.get('/healthz', async (request, response) => {
    try {
      await pool.query('SELECT 1');
      response.json({ status: 'ok' });
    } catch (error) {
      request.log?.error?.(error);
      console.error('CRM database health check failed:', error);
      response.status(503).json({ status: 'unavailable' });
    }
  });

  app.post('/api/orders', createRateLimiter({ limit: 20, windowMs: 15 * 60 * 1000 }), async (request, response) => {
    const validated = validateOrderPayload(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });

    const { orderRef, customer, order, items } = validated.value;
    let connection;
    let transactionStarted = false;
    try {
      connection = await pool.connect();
      await connection.query('BEGIN');
      transactionStarted = true;
      const customerResult = await connection.query(
        `INSERT INTO customers (name, phone)
         VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE
         SET name = EXCLUDED.name, updated_at = NOW()
         RETURNING id`,
        [customer.name, customer.phone]
      );
      const orderResult = await connection.query(
        `INSERT INTO orders (
           order_ref, customer_id, fulfillment, address, pincode,
           delivery_latitude, delivery_longitude, distance_km,
           items_subtotal, delivery_fee, total
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (order_ref) DO NOTHING
         RETURNING id`,
        [
          orderRef, customerResult.rows[0].id, order.fulfillment, order.address, order.pincode,
          order.latitude, order.longitude, order.distanceKm, order.subtotal,
          order.deliveryFee, order.total
        ]
      );

      if (orderResult.rowCount === 0) {
        const existing = await connection.query('SELECT id FROM orders WHERE order_ref = $1', [orderRef]);
        await connection.query('COMMIT');
        transactionStarted = false;
        return response.status(200).json({ saved: true, duplicate: true, orderId: existing.rows[0].id });
      }

      const orderId = orderResult.rows[0].id;
      for (const item of items) {
        await connection.query(
          `INSERT INTO order_items (order_id, cookie_name, unit_price, quantity, line_total)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, item.name, item.unitPrice, item.quantity, item.lineTotal]
        );
      }

      await connection.query('COMMIT');
      transactionStarted = false;
      return response.status(201).json({ saved: true, orderId });
    } catch (error) {
      if (connection && transactionStarted) {
        try {
          await connection.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('Could not roll back failed CRM order transaction:', rollbackError);
        }
      }
      console.error('Could not save storefront order to CRM:', error);
      return response.status(500).json({ error: 'The order could not be saved to the CRM.' });
    } finally {
      connection?.release();
    }
  });

  app.post(
    '/api/order-notifications',
    createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 }),
    async (request, response, next) => {
      if (!verifyFirebaseIdToken || !getFirebaseOrder || !sendBakerOrderEmail) {
        return response.status(503).json({ error: 'Order email notifications are not configured.' });
      }

      const authorization = request.get('Authorization') || '';
      const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
      if (!tokenMatch) return response.status(401).json({ error: 'Sign in before requesting an order notification.' });

      try {
        request.firebaseUser = await verifyFirebaseIdToken(tokenMatch[1]);
        request.firebaseToken = tokenMatch[1];
        next();
      } catch {
        return response.status(401).json({ error: 'Your sign-in has expired. Sign in again and retry.' });
      }
    },
    (request, response, next) => {
      if (!request.firebaseUser) return next();
      return createOrderNotificationHandler({
        pool,
        getOrder: (orderId, token) => getFirebaseOrder(orderId, token),
        sendEmail: (order, orderId, recipient) => sendBakerOrderEmail(order, orderId, recipient)
      })(request, response).catch(next);
    }
  );

  const loginLimiter = createRateLimiter({ limit: 8, windowMs: 15 * 60 * 1000 });
  app.post('/api/admin/login', ensureSameOrigin, loginLimiter, (request, response) => {
    const candidate = typeof request.body?.password === 'string' ? request.body.password : '';
    if (candidate.length > 512 || !passwordMatches(candidate, adminPassword)) {
      return response.status(401).json({ error: 'The password is incorrect.' });
    }
    const expiresAt = Date.now() + sessionDurationMs;
    const token = createSessionToken(sessionSecret, expiresAt);
    response.cookie(sessionCookieName, token, {
      httpOnly: true,
      secure: request.secure || request.get('x-forwarded-proto') === 'https',
      sameSite: 'strict',
      path: '/',
      maxAge: sessionDurationMs
    });
    return response.json({ authenticated: true });
  });

  app.post('/api/admin/logout', ensureSameOrigin, (request, response) => {
    response.clearCookie(sessionCookieName, {
      httpOnly: true,
      secure: request.secure || request.get('x-forwarded-proto') === 'https',
      sameSite: 'strict',
      path: '/'
    });
    return response.json({ authenticated: false });
  });

  const requireAdmin = (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    const token = parseCookies(request.get('Cookie'))[sessionCookieName];
    if (!verifySessionToken(token, sessionSecret)) {
      return response.status(401).json({ error: 'Please sign in to view the order dashboard.' });
    }
    return next();
  };

  app.get('/api/admin/session', requireAdmin, (request, response) => {
    response.json({ authenticated: true });
  });

  app.get('/api/admin/summary', requireAdmin, async (request, response) => {
    const dateRange = parseDateRange(request.query);
    if (dateRange.error) return response.status(400).json({ error: dateRange.error });
    const parameters = [];
    const dateConditions = appendDateConditions(dateRange.value, parameters, 'o.created_at');
    const purchaseDateConditions = appendPurchaseDateConditions(
      dateRange.value,
      [],
      'p.purchased_on'
    );
    try {
      const [totals, popularCookies] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS order_count,
                  COALESCE((
                    SELECT SUM(o.total)::int
                    FROM orders o
                    WHERE o.order_fulfillment = 'Yes' ${dateConditions}
                  ), 0)::int AS sales_total,
                  COALESCE((
                    SELECT SUM(p.unit_price * p.quantity)
                    FROM inventory_purchases p
                    WHERE TRUE ${purchaseDateConditions}
                  ), 0)::numeric AS inventory_cost,
                  ROUND((COALESCE((
                    SELECT SUM(o.total)::numeric
                    FROM orders o
                    WHERE o.order_fulfillment = 'Yes' ${dateConditions}
                  ), 0) - COALESCE((
                    SELECT SUM(p.unit_price * p.quantity)
                    FROM inventory_purchases p
                    WHERE TRUE ${purchaseDateConditions}
                  ), 0)), 2) AS profit_total,
                  COUNT(DISTINCT customer_id)::int AS customer_count
           FROM orders`,
          parameters
        ),
        pool.query(
          `SELECT cookie_name, SUM(quantity)::int AS quantity
           FROM order_items
           GROUP BY cookie_name
           ORDER BY quantity DESC, cookie_name ASC
           LIMIT 5`
        )
      ]);
      response.json({ ...totals.rows[0], popularCookies: popularCookies.rows });
    } catch (error) {
      console.error('Could not load CRM summary:', error);
      response.status(500).json({ error: 'Could not load dashboard summary.' });
    }
  });

  app.get('/api/admin/analytics', requireAdmin, async (request, response) => {
    const dateRange = parseDateRange(request.query);
    if (dateRange.error) return response.status(400).json({ error: dateRange.error });
    const orderDateParameters = [];
    const purchaseDateParameters = [];
    const orderDateConditions = appendDateConditions(dateRange.value, orderDateParameters, 'o.created_at');
    const customerDateConditions = appendDateConditions(dateRange.value, [], 'o.created_at');
    const cookieDateConditions = appendDateConditions(dateRange.value, [], 'o.created_at');
    const purchaseDateConditions = appendPurchaseDateConditions(
      dateRange.value,
      purchaseDateParameters,
      'p.purchased_on'
    );
    const parameters = dateRangeParameters(dateRange.value);
    const granularity = analyticsGranularity(dateRange.value);

    try {
      const [salesRows, purchaseRows, cookieRows, customerRows] = await Promise.all([
        pool.query(
          `SELECT DATE_TRUNC('${granularity}', o.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS period,
                  SUM(o.total)::int AS sales
           FROM orders o
           WHERE o.order_fulfillment = 'Yes' ${orderDateConditions}
           GROUP BY 1
           ORDER BY 1`,
          parameters
        ),
        pool.query(
          `SELECT p.purchased_on::text AS period,
                  SUM(p.unit_price * p.quantity)::numeric(14, 2) AS cost
           FROM inventory_purchases p
           WHERE TRUE ${purchaseDateConditions}
           GROUP BY 1
           ORDER BY 1`,
          parameters
        ),
        pool.query(
          `SELECT oi.cookie_name, SUM(oi.quantity)::int AS quantity
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           WHERE o.order_fulfillment = 'Yes' ${cookieDateConditions}
           GROUP BY oi.cookie_name
           ORDER BY quantity DESC, oi.cookie_name`,
          parameters
        ),
        pool.query(
          `SELECT c.id, c.name AS customer_name, COUNT(o.id)::int AS order_count
           FROM orders o
           JOIN customers c ON c.id = o.customer_id
           WHERE TRUE ${customerDateConditions}
           GROUP BY c.id, c.name
           ORDER BY order_count DESC, c.name ASC
           LIMIT 40`,
          parameters
        )
      ]);

      const periods = new Map();
      for (const row of salesRows.rows) periods.set(row.period, { period: row.period, sales: row.sales, cost: 0 });
      for (const row of purchaseRows.rows) {
        const period = granularity === 'month' ? row.period.slice(0, 7) : row.period;
        const current = periods.get(period) || { period, sales: 0, cost: 0 };
        current.cost = Number(row.cost);
        periods.set(period, current);
      }
      return response.json({
        salesCosts: [...periods.values()].sort((a, b) => a.period.localeCompare(b.period)),
        cookieSales: cookieRows.rows,
        customerOrders: customerRows.rows
      });
    } catch (error) {
      console.error('Could not load CRM analytics:', error);
      return response.status(500).json({ error: 'Could not load dashboard charts.' });
    }
  });

  app.get('/api/admin/orders', requireAdmin, async (request, response) => {
    const dateRange = parseDateRange(request.query);
    if (dateRange.error) return response.status(400).json({ error: dateRange.error });
    const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 100) : '';
    const limit = parsePositiveLimit(request.query.limit);
    const parameters = [];
    const conditions = [];
    const dateConditions = appendDateConditions(dateRange.value, parameters, 'o.created_at');
    if (dateConditions) conditions.push(dateConditions.slice(4));
    if (search) {
      parameters.push(`%${search}%`);
      conditions.push(`(c.name ILIKE $${parameters.length} OR c.phone ILIKE $${parameters.length})`);
    }
    parameters.push(limit);
    try {
      const result = await pool.query(
        `SELECT o.id, o.order_ref, o.fulfillment, o.address, o.pincode,
                o.delivery_latitude, o.delivery_longitude, o.distance_km,
                o.items_subtotal, o.delivery_fee, o.total, o.status, o.created_at,
                c.name AS customer_name, c.phone AS customer_phone,
                o.order_fulfillment,
                COALESCE(
                  JSON_AGG(
                    JSON_BUILD_OBJECT(
                      'name', oi.cookie_name,
                      'quantity', oi.quantity,
                      'unitPrice', oi.unit_price,
                      'lineTotal', oi.line_total
                    )
                  ) FILTER (WHERE oi.id IS NOT NULL),
                  '[]'::json
                ) AS items
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         LEFT JOIN order_items oi ON oi.order_id = o.id
         ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
         GROUP BY o.id, c.name, c.phone
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT $${parameters.length}`,
        parameters
      );
      response.json({ orders: result.rows });
    } catch (error) {
      console.error('Could not load CRM orders:', error);
      response.status(500).json({ error: 'Could not load orders.' });
    }
  });

  app.post('/api/admin/orders', ensureSameOrigin, requireAdmin, async (request, response) => {
    const validated = validateManualOrderPayload(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });

    const { customer, order, items } = validated.value;
    let connection;
    let transactionStarted = false;
    try {
      connection = await pool.connect();
      await connection.query('BEGIN');
      transactionStarted = true;
      const customerResult = await connection.query(
        `INSERT INTO customers (name, phone)
         VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE
         SET name = EXCLUDED.name, updated_at = NOW()
         RETURNING id`,
        [customer.name, customer.phone]
      );
      const orderResult = await connection.query(
        `INSERT INTO orders (
           order_ref, customer_id, fulfillment, address, pincode,
           items_subtotal, delivery_fee, total
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          randomUUID(), customerResult.rows[0].id, order.fulfillment, order.address,
          order.pincode, order.subtotal, order.deliveryFee, order.total
        ]
      );

      const orderId = orderResult.rows[0].id;
      for (const item of items) {
        await connection.query(
          `INSERT INTO order_items (order_id, cookie_name, unit_price, quantity, line_total)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, item.name, item.unitPrice, item.quantity, item.lineTotal]
        );
      }
      await connection.query('COMMIT');
      transactionStarted = false;
      return response.status(201).json({ saved: true, orderId });
    } catch (error) {
      if (connection && transactionStarted) {
        try {
          await connection.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('Could not roll back failed manual CRM order:', rollbackError);
        }
      }
      console.error('Could not save manual CRM order:', error);
      return response.status(500).json({ error: 'The manual order could not be saved.' });
    } finally {
      connection?.release();
    }
  });

  app.get('/api/admin/inventory', requireAdmin, async (request, response) => {
    const dateRange = parseDateRange(request.query);
    if (dateRange.error) return response.status(400).json({ error: dateRange.error });
    const parameters = [];
    const dateConditions = appendPurchaseDateConditions(dateRange.value, parameters, 'p.purchased_on');
    parameters.push(parsePositiveLimit(request.query.limit));
    try {
      const result = await pool.query(
        `SELECT p.id, p.item_name, p.unit_price, p.quantity, p.purchased_on,
                ROUND(p.unit_price * p.quantity, 2) AS total_cost
         FROM inventory_purchases p
         WHERE TRUE ${dateConditions}
         ORDER BY p.purchased_on DESC, p.id DESC
         LIMIT $${parameters.length}`,
        parameters
      );
      return response.json({ purchases: result.rows });
    } catch (error) {
      console.error('Could not load CRM inventory purchases:', error);
      return response.status(500).json({ error: 'Could not load inventory purchases.' });
    }
  });

  app.post('/api/admin/inventory', ensureSameOrigin, requireAdmin, async (request, response) => {
    const { itemName, unitPrice, quantity, purchaseDate } = request.body || {};
    const normalizedName = typeof itemName === 'string' ? itemName.trim() : '';
    const priceInCents = typeof unitPrice === 'number' && Number.isFinite(unitPrice)
      ? Math.round(unitPrice * 100)
      : 0;
    const hasValidPricePrecision = typeof unitPrice === 'number'
      && Math.abs(unitPrice * 100 - priceInCents) < 0.000001;
    if (!normalizedName || normalizedName.length > 120) {
      return response.status(400).json({ error: 'Item name must be between 1 and 120 characters.' });
    }
    if (!hasValidPricePrecision || priceInCents < 1 || priceInCents > 999999999999) {
      return response.status(400).json({ error: 'Unit price must be a positive INR amount.' });
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
      return response.status(400).json({ error: 'Quantity must be a whole number between 1 and 1,000,000.' });
    }
    if (typeof purchaseDate !== 'string' || !parseDateRange({ startDate: purchaseDate }).value) {
      return response.status(400).json({ error: 'Purchase date must be a valid date in YYYY-MM-DD format.' });
    }
    try {
      const result = await pool.query(
        `INSERT INTO inventory_purchases (item_name, unit_price, quantity, purchased_on)
         VALUES ($1, $2, $3, $4)
         RETURNING id, item_name, unit_price, quantity, purchased_on,
                   ROUND(unit_price * quantity, 2) AS total_cost`,
        [normalizedName, (priceInCents / 100).toFixed(2), quantity, purchaseDate]
      );
      return response.status(201).json({ purchase: result.rows[0] });
    } catch (error) {
      console.error('Could not record CRM inventory purchase:', error);
      return response.status(500).json({ error: 'Could not record inventory purchase.' });
    }
  });

  app.delete('/api/admin/inventory/:id', ensureSameOrigin, requireAdmin, async (request, response) => {
    const { id } = request.params;
    if (!isValidOrderId(id)) return response.status(400).json({ error: 'Purchase ID is invalid.' });
    try {
      const result = await pool.query('DELETE FROM inventory_purchases WHERE id = $1 RETURNING id', [id]);
      if (!result.rowCount) return response.status(404).json({ error: 'Inventory purchase not found.' });
      return response.json({ deleted: true, purchaseId: result.rows[0].id });
    } catch (error) {
      console.error('Could not delete CRM inventory purchase:', error);
      return response.status(500).json({ error: 'Could not delete inventory purchase.' });
    }
  });

  app.patch('/api/admin/orders/:id', ensureSameOrigin, requireAdmin, async (request, response) => {
    const { id } = request.params;
    if (!isValidOrderId(id)) return response.status(400).json({ error: 'Order ID is invalid.' });
    const { order_fulfillment: orderFulfillment } = request.body || {};
    if (!['Yes', 'No'].includes(orderFulfillment)) {
      return response.status(400).json({ error: 'Fulfillment must be Yes or No.' });
    }
    try {
      const result = await pool.query(
        'UPDATE orders SET order_fulfillment = $1 WHERE id = $2 RETURNING id, order_fulfillment',
        [orderFulfillment, id]
      );
      if (!result.rowCount) return response.status(404).json({ error: 'Order not found.' });
      return response.json({ order: result.rows[0] });
    } catch (error) {
      console.error('Could not update CRM order fulfillment:', error);
      return response.status(500).json({ error: 'Could not update order fulfillment.' });
    }
  });

  app.delete('/api/admin/orders/:id', ensureSameOrigin, requireAdmin, async (request, response) => {
    const { id } = request.params;
    if (!isValidOrderId(id)) return response.status(400).json({ error: 'Order ID is invalid.' });
    try {
      const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING id', [id]);
      if (!result.rowCount) return response.status(404).json({ error: 'Order not found.' });
      return response.json({ deleted: true, orderId: result.rows[0].id });
    } catch (error) {
      console.error('Could not delete CRM order:', error);
      return response.status(500).json({ error: 'Could not delete order.' });
    }
  });

  app.use('/api', (request, response) => {
    response.status(404).json({ error: 'API route not found.' });
  });

  app.use(express.static(staticDirectory, { index: false, maxAge: '1h' }));
  app.get('*', async (request, response, next) => {
    try {
      response.sendFile(path.join(staticDirectory, 'index.html'));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error.type === 'entity.too.large') {
      return response.status(413).json({ error: 'Request is too large.' });
    }
    console.error('Unhandled CRM request error:', error);
    return response.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  return app;
}

async function start() {
  const { DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET } = process.env;
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    throw new Error('Set ADMIN_PASSWORD to a private password of at least 12 characters.');
  }
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters.');
  }

  const pool = new Pool({ connectionString: DATABASE_URL, max: 4, idleTimeoutMillis: 30_000 });
  pool.on('error', error => console.error('Unexpected idle PostgreSQL connection error:', error));
  await pool.query(await readFile(path.join(appDirectory, 'schema.sql'), 'utf8'));
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || 'butterbitebakers';
  const firebaseAuthApp = initializeApp({ projectId: firebaseProjectId });
  const firebaseAuth = getAuth(firebaseAuthApp);
  const firebaseApiKey = process.env.FIREBASE_WEB_API_KEY;
  const mailerSendToken = process.env.MAILERSEND_API_TOKEN;
  const mailerSendFromEmail = process.env.MAILERSEND_FROM_EMAIL;
  const sendBakerOrderEmail = async (order, orderId, recipient) => {
    if (!mailerSendToken || !mailerSendFromEmail) {
      throw new Error('MailerSend API token and sender address must be configured.');
    }
    const { subject, text, html } = buildOrderEmail(order, orderId);
    const result = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mailerSendToken}`,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({
        from: { email: mailerSendFromEmail, name: 'Butter Bite Bakers Orders' },
        to: [{ email: recipient, name: 'Butter Bite Bakers' }],
        subject,
        text,
        html
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!result.ok) {
      const responseDetails = (await result.text()).slice(0, 1000);
      throw new Error(`MailerSend returned HTTP ${result.status}: ${responseDetails}`);
    }
    return result.headers.get('x-message-id');
  };
  const app = createApp({
    pool,
    adminPassword: ADMIN_PASSWORD,
    sessionSecret: SESSION_SECRET,
    allowedOrigins,
    verifyFirebaseIdToken: token => firebaseAuth.verifyIdToken(token),
    getFirebaseOrder: (orderId, idToken) => {
      if (!firebaseApiKey) throw new Error('FIREBASE_WEB_API_KEY is not configured.');
      return getFirestoreOrder({
        orderId,
        idToken,
        apiKey: firebaseApiKey,
        projectId: firebaseProjectId
      });
    },
    sendBakerOrderEmail
  });
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  const server = createServer(app);
  server.listen(port, '0.0.0.0', () => console.log(`Home Bakers Orders CRM listening on ${port}`));

  const shutdown = signal => {
    console.log(`Received ${signal}; closing CRM server.`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch(error => {
    console.error('CRM startup failed:', error);
    process.exitCode = 1;
  });
}
