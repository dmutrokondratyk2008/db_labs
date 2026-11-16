-- 18_maintenance_run.sql: запуск обслуговування адміністратором (dba_kondratiuk)
SELECT session_user;
\timing on
CALL maintain_database();
\timing off

SELECT log_id, operation, object_name, details, duration_ms
FROM maintenance_log
WHERE run_id = (SELECT MAX(run_id) FROM maintenance_log)
ORDER BY log_id;

SELECT c.relname AS index_name, pg_size_pretty(pg_relation_size(c.oid)) AS size,
       s.avg_leaf_density AS leaf_density_pct
FROM pg_class c
CROSS JOIN LATERAL pgstatindex(c.oid::regclass) s
WHERE c.relname IN ('payments_pkey', 'idx_payments_order_amount', 'idx_payments_date', 'orders_pkey')
ORDER BY c.relname;
