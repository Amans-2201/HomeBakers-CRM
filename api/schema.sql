CREATE TABLE IF NOT EXISTS customers (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    order_ref UUID NOT NULL UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    fulfillment TEXT NOT NULL CHECK (fulfillment IN ('delivery', 'pickup')),
    address TEXT NOT NULL DEFAULT '',
    pincode TEXT NOT NULL DEFAULT '',
    delivery_latitude DOUBLE PRECISION,
    delivery_longitude DOUBLE PRECISION,
    distance_km DOUBLE PRECISION,
    items_subtotal INTEGER NOT NULL CHECK (items_subtotal >= 0),
    delivery_fee INTEGER NOT NULL CHECK (delivery_fee >= 0),
    total INTEGER NOT NULL CHECK (total = items_subtotal + delivery_fee),
    status TEXT NOT NULL DEFAULT 'placed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    cookie_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    line_total INTEGER NOT NULL CHECK (line_total = unit_price * quantity)
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders (customer_id);
CREATE INDEX IF NOT EXISTS order_items_cookie_name_idx ON order_items (cookie_name);
