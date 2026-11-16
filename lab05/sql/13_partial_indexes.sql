-- =====================================================================
-- 13_partial_indexes.sql: часткові індекси для запитів з умовою WHERE
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Черга нових замовлень: менеджер бере в роботу найстаріші заявки.
--    Нових замовлень близько 4 % від усіх.
-- ---------------------------------------------------------------------
SELECT status, COUNT(*), ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM orders GROUP BY status ORDER BY 2 DESC;

\set q_queue 'SELECT order_id, order_date, client_id, wanted_car FROM orders WHERE status = ''new'' ORDER BY order_date, order_id LIMIT 20'

-- а) без спеціального індексу (є лише idx_orders_status з ЛР4)
EXPLAIN (ANALYZE, COSTS OFF) :q_queue;

-- б) повний складений індекс (для порівняння)
CREATE INDEX idx_orders_status_date_full ON orders (status, order_date, order_id);
EXPLAIN (ANALYZE, COSTS OFF) :q_queue;

-- в) частковий індекс: лише рядки зі status = 'new'
DROP INDEX idx_orders_status_date_full;
CREATE INDEX idx_orders_new_queue ON orders (order_date, order_id) WHERE status = 'new';
EXPLAIN (ANALYZE, COSTS OFF) :q_queue;
