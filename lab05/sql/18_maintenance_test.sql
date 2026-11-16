-- =====================================================================
-- 18_maintenance_test.sql: перевірка процедури обслуговування
-- Імітація масового виправлення даних: дата половини платежів
-- переписується, тому в індексах payments з'являються мертві записи.
-- (Тригери аудиту на час імітації вимкнено, щоб не роздувати журнали.)
-- =====================================================================
SET session_replication_role = replica;
UPDATE payments SET payment_date = payment_date WHERE payment_id % 2 = 0;
SET session_replication_role = origin;
VACUUM payments;      -- прибирає мертві записи, але порожні сторінки індексів лишаються

SELECT c.relname AS index_name, pg_size_pretty(pg_relation_size(c.oid)) AS size,
       s.avg_leaf_density AS leaf_density_pct, s.leaf_fragmentation AS fragmentation_pct
FROM pg_class c
CROSS JOIN LATERAL pgstatindex(c.oid::regclass) s
WHERE c.relname IN ('payments_pkey', 'idx_payments_order_amount', 'idx_payments_date', 'orders_pkey')
ORDER BY c.relname;
