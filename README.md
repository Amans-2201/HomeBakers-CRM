# Home Bakers Orders CRM

A small React dashboard and Express API that stores customers and orders in PostgreSQL. It is designed for a Render Free web service with a free Neon Postgres database. The dashboard is password-protected; public order submission accepts only the known cookie catalog and server-calculates prices and totals.

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

## Deploy on Render Free

1. Create a free PostgreSQL database on Neon. Copy its pooled or direct connection string, including `sslmode=require`.
2. In Render, create a Blueprint from this repository and select `orders_crm/render.yaml`, or create a free Node web service with `orders_crm` as its root directory.
3. Configure:
   - `DATABASE_URL`: Neon connection string.
   - `ADMIN_PASSWORD`: a unique, private password of at least 12 characters.
   - `SESSION_SECRET`: at least 32 unpredictable characters (Render generates this automatically in the Blueprint).
   - `ALLOWED_ORIGINS`: the exact HTTPS origin of the storefront, without a trailing slash. For multiple origins, separate them with commas.
4. Deploy. The service serves the dashboard at `/` and accepts storefront orders at `/api/orders`. Render Free may spin down when idle; the first request after inactivity can take longer. The Neon database, rather than Render's ephemeral filesystem, stores order data.

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
