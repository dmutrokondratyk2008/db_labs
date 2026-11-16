-- =====================================================================
-- 13_partial_indexes_2.sql: другий частковий індекс і аналіз ефективності
-- ---------------------------------------------------------------------
-- 2. Контейнери в дорозі (arrival_date IS NULL): з цією умовою працює
--    представлення v_shipments_in_transit з ЛР4. Таких рядків близько 3 %.
-- =====================================================================

\set q_transit 'SELECT shipment_id, order_id, container_number, departure_date FROM shipments WHERE arrival_date IS NULL ORDER BY departure_date LIMIT 10'

EXPLAIN (ANALYZE, COSTS OFF) :q_transit;

CREATE INDEX idx_shipments_in_transit ON shipments (departure_date) WHERE arrival_date IS NULL;

EXPLAIN (ANALYZE, COSTS OFF) :q_transit;

-- Запит з іншою умовою частковий індекс використати не може
EXPLAIN (COSTS OFF)
SELECT shipment_id FROM shipments WHERE arrival_date = DATE '2026-10-15' ORDER BY departure_date;

-- Порівняння розмірів: частковий індекс проти повного аналога
CREATE INDEX tmp_full_shipments ON shipments (departure_date);
CREATE INDEX tmp_full_orders    ON orders (order_date, order_id);

SELECT i.relname                              AS index_name,
       CASE WHEN x.indpred IS NULL THEN 'повний' ELSE 'частковий' END AS kind,
       pg_get_expr(x.indpred, x.indrelid)     AS condition,
       c.reltuples::bigint                    AS entries,
       pg_size_pretty(pg_relation_size(i.oid)) AS size
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class c ON c.oid = x.indexrelid
WHERE i.relname IN ('idx_orders_new_queue', 'tmp_full_orders',
                    'idx_shipments_in_transit', 'tmp_full_shipments')
ORDER BY x.indrelid, kind;

DROP INDEX tmp_full_shipments;
DROP INDEX tmp_full_orders;
