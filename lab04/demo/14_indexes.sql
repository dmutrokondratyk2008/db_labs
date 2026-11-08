-- Індекси бази даних (01_create_tables.sql і 08_create_indexes.sql)
SELECT tablename, indexname, regexp_replace(indexdef, '^.* USING ', 'USING ') AS definition
FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- Пошук за підрядком у реальній таблиці cars використовує триграмний індекс
SET enable_seqscan = off;   -- таблиця мала, тому вимикаємо seq scan лише для показу плану
EXPLAIN (COSTS OFF)
SELECT car_id, make, model FROM cars WHERE (make || ' ' || model) ILIKE '%cherok%';
RESET enable_seqscan;
