-- =====================================================================
-- 02_perf_tools.sql: інструменти для вимірювання продуктивності
--   perf_queries   - три досліджувані запити
--   perf_results   - результати вимірювань на кожному етапі оптимізації
--   perf_measure() - виконує EXPLAIN (ANALYZE, FORMAT JSON) кілька разів
--                    і зберігає середній/мінімальний час та типи сканувань
-- =====================================================================

CREATE TABLE perf_queries (
    query_id    SMALLINT PRIMARY KEY,
    title       VARCHAR(100) NOT NULL,
    sql_text    TEXT NOT NULL
);

CREATE TABLE perf_results (
    result_id    SERIAL PRIMARY KEY,
    stage        VARCHAR(30) NOT NULL,
    query_id     SMALLINT NOT NULL REFERENCES perf_queries(query_id),
    runs         SMALLINT NOT NULL,
    avg_ms       NUMERIC(10,3) NOT NULL,
    min_ms       NUMERIC(10,3) NOT NULL,
    buffers      BIGINT NOT NULL,
    scans        TEXT,
    measured_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO perf_queries VALUES
(1, 'Нові клієнти за 30 днів і їхні платежі', $q$
SELECT c.client_id, c.last_name || ' ' || c.first_name AS client, c.city,
       c.created_at::date AS registered, COUNT(DISTINCT o.order_id) AS orders,
       COALESCE(SUM(p.amount_usd), 0) AS paid_usd
FROM clients c
LEFT JOIN orders   o ON o.client_id = c.client_id
LEFT JOIN payments p ON p.order_id  = o.order_id
WHERE c.created_at >= CURRENT_DATE - 30
GROUP BY c.client_id
ORDER BY paid_usd DESC, c.client_id$q$),
(2, 'Прибуття в порт Одеса за жовтень', $q$
SELECT s.arrival_date, s.container_number, cr.name AS carrier, c.vin,
       c.make || ' ' || c.model AS car, cl.last_name || ' ' || cl.first_name AS client, o.status
FROM shipments s
JOIN orders   o  ON o.order_id    = s.order_id
JOIN cars     c  ON c.car_id      = o.car_id
JOIN carriers cr ON cr.carrier_id = s.carrier_id
JOIN clients  cl ON cl.client_id  = o.client_id
WHERE s.port_to = 'Одеса'
  AND s.arrival_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-31'
ORDER BY s.arrival_date, s.container_number$q$),
(3, 'Закупівлі за III квартал за марками', $q$
SELECT make, COUNT(*) AS cars, SUM(purchase_price_usd + auction_fee_usd) AS total_usd,
       ROUND(AVG(purchase_price_usd), 2) AS avg_price_usd,
       ROUND(100.0 * SUM(purchase_price_usd + auction_fee_usd)
             / SUM(SUM(purchase_price_usd + auction_fee_usd)) OVER (), 2) AS share_pct
FROM cars
WHERE purchase_date BETWEEN DATE '2026-07-01' AND DATE '2026-09-30'
GROUP BY make
ORDER BY total_usd DESC$q$);

-- Вимірювання: перший запуск прогріває кеш і не враховується
CREATE OR REPLACE FUNCTION perf_measure(p_stage VARCHAR, p_runs INTEGER DEFAULT 5)
RETURNS TABLE (query_id SMALLINT, title VARCHAR, avg_ms NUMERIC, min_ms NUMERIC, buffers BIGINT, scans TEXT)
LANGUAGE plpgsql AS $$
DECLARE
    q       RECORD;
    v_plan  JSONB;
    v_times NUMERIC[];
    v_buf   BIGINT;
    v_scans TEXT;
BEGIN
    FOR q IN SELECT * FROM perf_queries ORDER BY perf_queries.query_id LOOP
        EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || q.sql_text INTO v_plan;
        v_times := '{}';
        FOR i IN 1..p_runs LOOP
            EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || q.sql_text INTO v_plan;
            v_times := v_times || (v_plan -> 0 ->> 'Execution Time')::NUMERIC;
        END LOOP;

        v_buf := (v_plan -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::BIGINT
               + (v_plan -> 0 -> 'Plan' ->> 'Shared Read Blocks')::BIGINT;

        -- усі вузли сканування плану: тип + таблиця або індекс
        SELECT string_agg(DISTINCT n ->> 'Node Type' || ' ' ||
                          COALESCE(n ->> 'Index Name', n ->> 'Relation Name'), ', ')
        INTO v_scans
        FROM jsonb_path_query(v_plan, 'strict $.**') AS n
        WHERE jsonb_typeof(n) = 'object' AND n ->> 'Node Type' LIKE '%Scan'
          AND n ->> 'Node Type' <> 'Bitmap Heap Scan';

        INSERT INTO perf_results (stage, query_id, runs, avg_ms, min_ms, buffers, scans)
        VALUES (p_stage, q.query_id, p_runs,
                (SELECT AVG(t) FROM unnest(v_times) t), (SELECT MIN(t) FROM unnest(v_times) t),
                v_buf, v_scans);
    END LOOP;

    RETURN QUERY
    SELECT r.query_id, pq.title, r.avg_ms, r.min_ms, r.buffers, r.scans
    FROM perf_results r JOIN perf_queries pq ON pq.query_id = r.query_id
    WHERE r.stage = p_stage
    ORDER BY r.query_id;
END;
$$;
