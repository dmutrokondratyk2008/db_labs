-- 06_compare.sql: порівняння етапів оптимізації
SELECT pq.query_id AS q,
       pq.title,
       b.avg_ms AS before_ms,
       i.avg_ms AS indexes_ms,
       t.avg_ms AS tuned_ms,
       ROUND(100 * (b.avg_ms - i.avg_ms) / b.avg_ms, 1) AS idx_gain_pct,
       ROUND(100 * (b.avg_ms - t.avg_ms) / b.avg_ms, 1) AS total_gain_pct,
       ROUND(b.avg_ms / t.avg_ms, 1)                    AS speedup_x,
       b.buffers AS buf_before,
       t.buffers AS buf_after
FROM perf_queries pq
JOIN perf_results b ON b.query_id = pq.query_id AND b.stage = 'before'
JOIN perf_results i ON i.query_id = pq.query_id AND i.stage = 'indexes'
JOIN perf_results t ON t.query_id = pq.query_id AND t.stage = 'tuned'
ORDER BY pq.query_id;
