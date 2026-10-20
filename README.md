# Home Bakers Orders CRM

A small React dashboard and Express API that stores customers and orders in PostgreSQL. It is designed for a Render Free web service with a free Neon Postgres database. The dashboard is password-protected; public order submission accepts only the known cookie catalog and server-calculates prices and totals.

The Firebase Hosting deployment at `https://butterbitebakers-crm.web.app` provides a separate live view of storefront orders in the `butterbitebakers` Firestore database. It uses the same Firebase baker account as the storefront and listens to the `orders` collection in real time. Status changes made in either dashboard are shared with customers. Bakers can also add phone, WhatsApp, in-person, or other orders directly to the shared collection. The existing PostgreSQL-backed CRM remains available on its configured server deployment; PostgreSQL inventory and historical CRM records are not copied into Firestore.

## Local development

1. Create a PostgreSQL database (Neon works) and copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, `ADMIN_PASSWORD` (at least 12 characters), and `SESSION_SECRET` (at least 32 random characters).
3. Install and run:

   ```sh
   npm install
   npm run dev
   ```

   Vite serves the dashboard and proxies API calls to `http://localhost:3000`. In another terminal, start the API with `npm start`.

4. Run `npm test` for validation/security tests and `npm run build` for a production build.

The API creates its tables on startup using `api/schema.sql`.

## Deploy the live Firebase orders CRM

The Firebase CRM is a static React app hosted separately from the cookie storefront but uses the same Firebase project and Firestore collection.

1. In Firebase Authentication, enable **Email/Password** and add `butterbitebakers-crm.web.app` to Authorized domains if it is not already listed.
2. From this directory, run `npm run build`.
3. Deploy with `firebase deploy --only hosting --project butterbitebakers`.
4. Ensure the storefront Firestore rules have been deployed from `Web-App` with the baker-only manual-order creation permission, then sign in at `https://butterbitebakers-crm.web.app` with the authorized baker account (`amans66@gmail.com`). The same Firestore order records, timestamps, and status controls are shared with the storefront and customer tracking page.

Use **Add order** in the live orders CRM for orders received by phone, WhatsApp, in person, or another source. The form captures the customer contact, pickup/delivery details, PIN, optional map coordinates, catalog items and quantities, and order notes. Prices and totals are calculated from the storefront catalog. Delivery fees, distance limits, and minimums follow the storefront rules. New orders start as pending and are timestamped in the shared Firestore collection.

## Monthly database snapshots

The optional scripts in `sql/` create JSONB snapshots of customers, orders, order items, and inventory purchases inside the same Neon database:

1. Run `sql/backup_schema.sql` once in the Neon SQL Editor.
2. Run `sql/backup_monthly.sql` monthly in the Neon SQL Editor and verify the returned row counts.

The monthly script replaces the snapshot for the current month if run again during that month; snapshots from earlier months are retained. These in-database snapshots are for convenient history and are not a substitute for an external backup or Neon recovery features, since a database-level loss can affect both the live data and snapshots.

## Deploy on Render Free

1. Create a free PostgreSQL database on Neon. Copy its pooled or direct connection string, including `sslmode=require`.
2. In Render, create a Blueprint from this repository and select `orders_crm/render.yaml`, or create a free Node web service with `orders_crm` as its root directory.
3. Configure:
   - `DATABASE_URL`: Neon connection string.
   - `ADMIN_PASSWORD`: a unique, private password of at least 12 characters.
   - `SESSION_SECRET`: at least 32 unpredictable characters (Render generates this automatically in the Blueprint).
   - `ALLOWED_ORIGINS`: `https://butterbitebakers.web.app,https://butterbitebakers-crm.web.app`.
   - `FIREBASE_PROJECT_ID`: `butterbitebakers`.
   - `FIREBASE_WEB_API_KEY`: the Web API key from `Web-App/firebase-config.js` (public client config).
   - `MAILERSEND_API_TOKEN`: the private MailerSend API token. Add it only in Render's Environment settings; never put it in code or chat.
   - `MAILERSEND_FROM_EMAIL`: `orders@test-yxj6lj9mmoq4do2r.mlsender.net`.
4. Deploy. The service serves the dashboard at `/` and accepts storefront orders at `/api/orders`. Render Free may spin down when idle; the first request after inactivity can take longer. The Neon database, rather than Render's ephemeral filesystem, stores order data.

### Baker notifications for Firestore orders

The Render API sends order details to `amans66@gmail.com` after a storefront or Firebase CRM order is saved. It verifies the Firebase ID token and checks that the caller is permitted to read the Firestore order before sending. PostgreSQL records notification state to prevent duplicate messages. No Firebase Blaze upgrade is needed.

MailerSend's test domain allows up to 100 messages and two unique recipients, so it is suitable for testing only. Verify your MailerSend account email before testing. For ongoing use, configure a sender on a domain you control.

The notification endpoint is configured as the public `BAKERY_ORDER_NOTIFICATION_URL` in `Web-App/firebase-config.js` and `orders_crm/public/firebase-config.js`. Confirm the value matches the actual Render service URL from its dashboard. After setting the Render environment variables, deploy the `orders_crm` service. The app applies the PostgreSQL notification table automatically at startup. Place a test order and check the Render logs and baker inbox; the first request may take longer if the free service is waking from sleep.

## Connect the storefront

In `index.htm`, set `CRM_ORDER_ENDPOINT` to the deployed service's `https://<service>.onrender.com/api/orders` URL. The storefront sends a second, fire-and-forget request after checkout validation and still opens WhatsApp if the CRM is unavailable. Do not place the admin password or `SESSION_SECRET` in the storefront.

Public submissions are limited to the five products and current catalog prices, checked against delivery range and minimums, rate-limited, and restricted by the configured storefront origin. Admin routes require the HttpOnly signed session cookie.

## Data captured

- Customer name and phone number (customers are deduplicated by phone).
- Order reference, pickup/delivery, address, PIN, map coordinates and driving distance when applicable.
- Order fulfillment status (`Yes` or `No`), defaulting to `Yes`; this is separate from the pickup/delivery order type.
- Cookie varieties and quantities, subtotal, delivery fee, total, and order timestamp.
- Dashboard totals, top-selling cookies, recent orders, customer name/phone search, and a date-range filter. Sales include only orders marked fulfilled (`Yes`) within the selected dates.
- Admin order deletion and fulfillment-status updates from the dashboard.
- Manual call-order entry for existing catalog products, with trusted prices and pickup/delivery details.
- Inventory purchase records with item name, unit price in INR, quantity, and purchase date. The Profit card subtracts inventory purchase cost from fulfilled sales; when a date range is selected, it uses purchases from that same range.
- Interactive dashboard charts compare sales with inventory costs, show the sales trend, cookie varieties sold, and order counts by customer. Chart data follows the selected date range.
