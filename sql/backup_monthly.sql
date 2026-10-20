BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;

DO $$
DECLARE
    snapshot_month DATE := date_trunc('month', CURRENT_DATE)::date;
    snapshot_time TIMESTAMPTZ := now();
BEGIN
    DELETE FROM crm_backup.customers WHERE backup_month = snapshot_month;
    DELETE FROM crm_backup.orders WHERE backup_month = snapshot_month;
    DELETE FROM crm_backup.order_items WHERE backup_month = snapshot_month;
    DELETE FROM crm_backup.inventory_purchases WHERE backup_month = snapshot_month;

    INSERT INTO crm_backup.customers (backup_month, backed_up_at, source_id, row_data)
    SELECT snapshot_month, snapshot_time, c.id::text, to_jsonb(c)
    FROM public.customers AS c;

    INSERT INTO crm_backup.orders (backup_month, backed_up_at, source_id, row_data)
    SELECT snapshot_month, snapshot_time, o.id::text, to_jsonb(o)
    FROM public.orders AS o;

    INSERT INTO crm_backup.order_items (backup_month, backed_up_at, source_id, row_data)
    SELECT snapshot_month, snapshot_time, oi.id::text, to_jsonb(oi)
    FROM public.order_items AS oi;

    INSERT INTO crm_backup.inventory_purchases (backup_month, backed_up_at, source_id, row_data)
    SELECT snapshot_month, snapshot_time, p.id::text, to_jsonb(p)
    FROM public.inventory_purchases AS p;
END $$;

COMMIT;

SELECT 'customers' AS table_name, backup_month, COUNT(*) AS rows_backed_up,
       MAX(backed_up_at) AS backed_up_at
FROM crm_backup.customers
GROUP BY backup_month
UNION ALL
SELECT 'orders', backup_month, COUNT(*), MAX(backed_up_at)
FROM crm_backup.orders
GROUP BY backup_month
UNION ALL
SELECT 'order_items', backup_month, COUNT(*), MAX(backed_up_at)
FROM crm_backup.order_items
GROUP BY backup_month
UNION ALL
SELECT 'inventory_purchases', backup_month, COUNT(*), MAX(backed_up_at)
FROM crm_backup.inventory_purchases
GROUP BY backup_month
ORDER BY backup_month DESC, table_name;
