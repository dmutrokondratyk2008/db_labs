-- Оцінка ефекту індексів на згенерованих даних (200 000 авто і замовлень)
\timing on
DROP TABLE IF EXISTS perf_cars;
CREATE TABLE perf_cars AS
SELECT g AS car_id,
       (ARRAY['Toyota','Ford','Honda','BMW','Audi','Nissan','Kia','Hyundai','Mazda','Jeep'])[1 + g % 10] AS make,
       'Model-' || (g % 997) AS model,
       2010 + g % 15 AS model_year,
       (ARRAY['new','bought','in_transit','in_port','customs','delivered','delivered','delivered','delivered','cancelled'])[1 + (g * 7) % 10] AS status,
       1 + g % 11 AS manager_id,
       DATE '2024-01-01' + (g % 1000) AS order_date
FROM generate_series(1, 200000) AS g;
ANALYZE perf_cars;

-- 1) Пошук за підрядком без індексу
EXPLAIN (ANALYZE, COSTS OFF, BUFFERS OFF)
SELECT * FROM perf_cars WHERE (make || ' ' || model) ILIKE '%da model-77%';

CREATE INDEX idx_perf_cars_trgm ON perf_cars USING GIN ((make || ' ' || model) gin_trgm_ops);

EXPLAIN (ANALYZE, COSTS OFF, BUFFERS OFF)
SELECT * FROM perf_cars WHERE (make || ' ' || model) ILIKE '%da model-77%';
