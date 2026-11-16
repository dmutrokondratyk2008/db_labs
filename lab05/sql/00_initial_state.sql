-- 00_initial_state.sql: стан бази car_import після ЛР4
SELECT version();

SELECT 'clients' AS table_name, COUNT(*) AS row_count FROM clients
UNION ALL SELECT 'cars',      COUNT(*) FROM cars
UNION ALL SELECT 'orders',    COUNT(*) FROM orders
UNION ALL SELECT 'shipments', COUNT(*) FROM shipments
UNION ALL SELECT 'payments',  COUNT(*) FROM payments
UNION ALL SELECT 'activity_log', COUNT(*) FROM activity_log;

SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
       current_setting('shared_preload_libraries') AS preload_libraries,
       current_setting('random_page_cost') AS random_page_cost;
