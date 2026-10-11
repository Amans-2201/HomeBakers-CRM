import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import pg from 'pg';
import { validateOrderPayload } from './orders.js';
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
      response.set('Access-Control-Allow-Headers', 'Content-Type');
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

export function createApp({ pool, adminPassword, sessionSecret, allowedOrigins = [] }) {
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
    try {
      const [totals, popularCookies] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS order_count,
                  COALESCE(SUM(total), 0)::int AS sales_total,
                  COUNT(DISTINCT customer_id)::int AS customer_count
           FROM orders`
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

  app.get('/api/admin/orders', requireAdmin, async (request, response) => {
    const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 100) : '';
    const limit = parsePositiveLimit(request.query.limit);
    const parameters = [];
    let searchClause = '';
    if (search) {
      parameters.push(`%${search}%`);
      searchClause = 'WHERE c.name ILIKE $1 OR c.phone ILIKE $1';
    }
    parameters.push(limit);
    try {
      const result = await pool.query(
        `SELECT o.id, o.order_ref, o.fulfillment, o.address, o.pincode,
                o.delivery_latitude, o.delivery_longitude, o.distance_km,
                o.items_subtotal, o.delivery_fee, o.total, o.status, o.created_at,
                c.name AS customer_name, c.phone AS customer_phone,
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
         ${searchClause}
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
  const app = createApp({ pool, adminPassword: ADMIN_PASSWORD, sessionSecret: SESSION_SECRET, allowedOrigins });
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
