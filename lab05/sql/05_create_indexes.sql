-- =====================================================================
-- 03_create_indexes.sql: три індекси під повільні запити 1-3
-- =====================================================================
\timing on

-- Запит 1: фільтр clients.created_at >= ... (нові клієнти за період)
CREATE INDEX idx_clients_created_at ON clients (created_at);

-- Запит 2: рівність по port_to + діапазон по arrival_date.
-- Порядок стовпців: спочатку стовпець з умовою рівності, потім діапазон,
-- тоді рядки одного порту за місяць лежать в індексі поруч і вже відсортовані
CREATE INDEX idx_shipments_port_arrival ON shipments (port_to, arrival_date);

-- Запит 3: діапазон дат купівлі. INCLUDE додає в листки індексу стовпці,
-- які потрібні запиту, тому можливий Index Only Scan без читання таблиці
CREATE INDEX idx_cars_purchase_date ON cars (purchase_date)
    INCLUDE (make, purchase_price_usd, auction_fee_usd);

\timing off
ANALYZE clients;
ANALYZE shipments;
ANALYZE cars;

SELECT indexrelid::regclass AS index_name,
       indrelid::regclass   AS table_name,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
       pg_size_pretty(pg_relation_size(indrelid))   AS table_size
FROM pg_index
WHERE indexrelid::regclass::text IN ('idx_clients_created_at', 'idx_shipments_port_arrival', 'idx_cars_purchase_date');
