-- 04_measure.sql: вимірювання трьох запитів на поточному етапі
-- запуск: psql ... -v stage=<назва етапу> -f 04_measure.sql
SHOW random_page_cost;
SELECT query_id AS q, avg_ms, min_ms, buffers, scans
FROM perf_measure(:'stage', 5);
