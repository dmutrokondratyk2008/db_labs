-- Оцінка ефекту часткового індексу на згенерованій таблиці perf_cars (200 000 рядків)
\timing on
-- 2) Активні замовлення менеджера: без індексу, потім частковий індекс
EXPLAIN (ANALYZE, COSTS OFF, BUFFERS OFF)
SELECT * FROM perf_cars WHERE manager_id = 3 AND status NOT IN ('delivered', 'cancelled') AND order_date >= '2026-06-01';

CREATE INDEX idx_perf_active ON perf_cars (manager_id, order_date) WHERE status NOT IN ('delivered', 'cancelled');

EXPLAIN (ANALYZE, COSTS OFF, BUFFERS OFF)
SELECT * FROM perf_cars WHERE manager_id = 3 AND status NOT IN ('delivered', 'cancelled') AND order_date >= '2026-06-01';

SELECT pg_size_pretty(pg_relation_size('perf_cars')) AS table_size,
       pg_size_pretty(pg_relation_size('idx_perf_cars_trgm')) AS trgm_index,
       pg_size_pretty(pg_relation_size('idx_perf_active')) AS partial_index;
DROP TABLE perf_cars;
