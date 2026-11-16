-- =====================================================================
-- 19_monitoring.sql: моніторинг продуктивності бази car_import
-- Запускається скриптом monitor.ps1, звіт зберігається в reports/.
-- =====================================================================
\pset footer off

\echo '=== 1. Загальний стан бази ==='
SELECT datname                                                          AS database,
       pg_size_pretty(pg_database_size(datname))                        AS size,
       numbackends                                                      AS sessions,
       xact_commit                                                      AS commits,
       xact_rollback                                                    AS rollbacks,
       ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2)     AS cache_hit_pct,
       deadlocks,
       temp_files,
       to_char(pg_postmaster_start_time(), 'YYYY-MM-DD HH24:MI')        AS server_started
FROM pg_stat_database
WHERE datname = current_database();

\echo '=== 2. Таблиці: розмір, способи читання, мертві рядки ==='
SELECT relname                                                          AS table_name,
       pg_size_pretty(pg_total_relation_size(relid))                    AS total_size,
       n_live_tup                                                       AS live_rows,
       n_dead_tup                                                       AS dead_rows,
       seq_scan,
       idx_scan,
       ROUND(100.0 * idx_scan / NULLIF(seq_scan + idx_scan, 0), 1)      AS idx_scan_pct,
       to_char(GREATEST(last_vacuum, last_autovacuum), 'MM-DD HH24:MI') AS vacuumed
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 8;

\echo '=== 3. Використання індексів (найактивніші) ==='
SELECT relname                                     AS table_name,
       indexrelname                                AS index_name,
       idx_scan                                    AS scans,
       idx_tup_read                                AS tuples_read,
       idx_tup_fetch                               AS tuples_fetched,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC
LIMIT 10;

\echo '=== 4. Індекси без жодного сканування (крім PK/UNIQUE) ==='
SELECT s.relname                                     AS table_name,
       s.indexrelname                                AS index_name,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0 AND NOT i.indisunique
ORDER BY pg_relation_size(s.indexrelid) DESC;

\echo '=== 5. Найповільніші повторювані запити (pg_stat_statements, середній час) ==='
SELECT left(regexp_replace(query, '\s+', ' ', 'g'), 75)                 AS query,
       calls,
       ROUND(total_exec_time::numeric, 1)                               AS total_ms,
       ROUND(mean_exec_time::numeric, 2)                                AS mean_ms,
       ROUND(max_exec_time::numeric, 2)                                 AS max_ms,
       rows,
       ROUND(100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0), 1) AS hit_pct
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND calls > 1
  AND query !~* '^\s*(EXPLAIN|VACUUM|ANALYZE|CREATE|ALTER|DROP|REINDEX|CALL|COPY|BEGIN|COMMIT|SET|SHOW|REFRESH)'
  AND query !~* 'pg_stat_|pg_catalog|pg_size_pretty'        -- без службових запитів моніторингу
ORDER BY mean_exec_time DESC
LIMIT 10;

\echo '=== 6. Активні сеанси та блокування ==='
SELECT pid, usename AS user_name, state, wait_event_type AS waits,
       pg_blocking_pids(pid) AS blocked_by,
       to_char(now() - query_start, 'MI:SS') AS duration,
       left(query, 45) AS query
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';

\echo '=== 7. Попередження ==='
SELECT * FROM (
    SELECT 'УВАГА: кеш-попадання ' || ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2)
           || '% (норма > 99%)' AS warning
    FROM pg_stat_database
    WHERE datname = current_database() AND 100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0) < 99
    UNION ALL
    SELECT 'УВАГА: ' || relname || ' має ' || n_dead_tup || ' мертвих рядків ('
           || ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup, 0), 1) || '%), потрібен VACUUM'
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 1000 AND n_dead_tup > 0.1 * n_live_tup
    UNION ALL
    SELECT 'УВАГА: невикористаний індекс ' || s.indexrelname || ' ('
           || pg_size_pretty(pg_relation_size(s.indexrelid)) || ')'
    FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid
    WHERE s.idx_scan = 0 AND NOT i.indisunique AND pg_relation_size(s.indexrelid) > 1024 * 1024
    UNION ALL
    SELECT 'УВАГА: повільний запит (' || ROUND(mean_exec_time::numeric) || ' мс, викликів '
           || calls || '): ' || left(regexp_replace(query, '\s+', ' ', 'g'), 60)
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND mean_exec_time > 50 AND calls > 1
      AND query !~* '^\s*(EXPLAIN|VACUUM|ANALYZE|CREATE|ALTER|DROP|REINDEX|CALL|COPY|REFRESH)'
    UNION ALL
    SELECT 'Сеанс ' || pid || ' заблоковано сеансом ' || (pg_blocking_pids(pid))[1]
    FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0
) w;
