CREATE SCHEMA IF NOT EXISTS crm_backup;

CREATE TABLE IF NOT EXISTS crm_backup.customers (
    backup_month DATE NOT NULL,
    backed_up_at TIMESTAMPTZ NOT NULL,
    source_id TEXT NOT NULL,
    row_data JSONB NOT NULL,
    PRIMARY KEY (backup_month, source_id)
);

CREATE TABLE IF NOT EXISTS crm_backup.orders (
    backup_month DATE NOT NULL,
    backed_up_at TIMESTAMPTZ NOT NULL,
    source_id TEXT NOT NULL,
    row_data JSONB NOT NULL,
    PRIMARY KEY (backup_month, source_id)
);

CREATE TABLE IF NOT EXISTS crm_backup.order_items (
    backup_month DATE NOT NULL,
    backed_up_at TIMESTAMPTZ NOT NULL,
    source_id TEXT NOT NULL,
    row_data JSONB NOT NULL,
    PRIMARY KEY (backup_month, source_id)
);

CREATE TABLE IF NOT EXISTS crm_backup.inventory_purchases (
    backup_month DATE NOT NULL,
    backed_up_at TIMESTAMPTZ NOT NULL,
    source_id TEXT NOT NULL,
    row_data JSONB NOT NULL,
    PRIMARY KEY (backup_month, source_id)
);

CREATE INDEX IF NOT EXISTS crm_backup_customers_month_idx
    ON crm_backup.customers (backup_month);
CREATE INDEX IF NOT EXISTS crm_backup_orders_month_idx
    ON crm_backup.orders (backup_month);
CREATE INDEX IF NOT EXISTS crm_backup_order_items_month_idx
    ON crm_backup.order_items (backup_month);
CREATE INDEX IF NOT EXISTS crm_backup_inventory_purchases_month_idx
    ON crm_backup.inventory_purchases (backup_month);
