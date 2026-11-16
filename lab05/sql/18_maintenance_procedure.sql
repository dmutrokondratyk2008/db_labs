-- =====================================================================
-- 18_maintenance_procedure.sql: збережена процедура автоматизованого
-- обслуговування бази (рівень 3)
--   1) ANALYZE лише тих таблиць, де з останнього аналізу змінилося
--      більше p_analyze_ratio рядків;
--   2) REINDEX лише тих B-tree індексів, у яких щільність листкових
--      сторінок (pgstattuple) нижча за p_min_density %;
--   3) оновлення матеріалізованих представлень;
--   4) журнал усіх дій у maintenance_log.
-- Після кожної операції виконується COMMIT, щоб не тримати блокування.
-- VACUUM у процедурі виконати не можна (не працює в блоці транзакції),
-- тому він запускається окремо утилітою vacuumdb (див. maintenance.ps1).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgstattuple;

CREATE TABLE maintenance_log (
    log_id       SERIAL PRIMARY KEY,
    run_id       INTEGER       NOT NULL,
    operation    VARCHAR(20)   NOT NULL,
    object_name  TEXT,
    details      TEXT,
    duration_ms  NUMERIC(10,2),
    executed_by  VARCHAR(100)  NOT NULL DEFAULT SESSION_USER,
    executed_at  TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE PROCEDURE maintain_database(
    p_analyze_ratio NUMERIC DEFAULT 0.05,   -- частка змінених рядків для ANALYZE
    p_min_density   NUMERIC DEFAULT 70,     -- поріг щільності листків індексу, %
    p_min_index_mb  NUMERIC DEFAULT 1       -- менші індекси не перевіряються
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_run      INTEGER;
    r          RECORD;
    v_start    TIMESTAMPTZ;
    v_density  NUMERIC;
    v_analyzed INTEGER := 0;
    v_checked  INTEGER := 0;
    v_rebuilt  INTEGER := 0;
    v_freed    BIGINT  := 0;
    v_total    TIMESTAMPTZ := clock_timestamp();
BEGIN
    SELECT COALESCE(MAX(run_id), 0) + 1 INTO v_run FROM maintenance_log;

    -- 1. Оновлення статистики планувальника
    FOR r IN
        SELECT relname, n_live_tup, n_mod_since_analyze,
               COALESCE(last_analyze, last_autoanalyze) AS analyzed_at
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY relname
    LOOP
        IF r.analyzed_at IS NULL OR r.n_mod_since_analyze > GREATEST(r.n_live_tup, 1) * p_analyze_ratio THEN
            v_start := clock_timestamp();
            EXECUTE format('ANALYZE public.%I', r.relname);
            INSERT INTO maintenance_log (run_id, operation, object_name, details, duration_ms)
            VALUES (v_run, 'ANALYZE', r.relname,
                    format('змінено %s з %s рядків', r.n_mod_since_analyze, r.n_live_tup),
                    EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000);
            v_analyzed := v_analyzed + 1;
            COMMIT;
        END IF;
    END LOOP;

    -- 2. Перебудова фрагментованих B-tree індексів
    FOR r IN
        SELECT c.oid::regclass AS index_name, pg_relation_size(c.oid) AS size_before
        FROM pg_index i
        JOIN pg_class c     ON c.oid = i.indexrelid
        JOIN pg_am am       ON am.oid = c.relam
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND am.amname = 'btree'
          AND pg_relation_size(c.oid) >= p_min_index_mb * 1024 * 1024
        ORDER BY pg_relation_size(c.oid) DESC
    LOOP
        v_checked := v_checked + 1;
        SELECT avg_leaf_density INTO v_density FROM pgstatindex(r.index_name);
        IF v_density < p_min_density THEN
            v_start := clock_timestamp();
            EXECUTE format('REINDEX INDEX %s', r.index_name);
            v_freed := v_freed + r.size_before - pg_relation_size(r.index_name);
            INSERT INTO maintenance_log (run_id, operation, object_name, details, duration_ms)
            VALUES (v_run, 'REINDEX', r.index_name::TEXT,
                    format('щільність %s%%, розмір %s -> %s', v_density,
                           pg_size_pretty(r.size_before), pg_size_pretty(pg_relation_size(r.index_name))),
                    EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000);
            v_rebuilt := v_rebuilt + 1;
            COMMIT;
        END IF;
    END LOOP;

    -- 3. Матеріалізовані представлення
    FOR r IN SELECT matviewname FROM pg_matviews WHERE schemaname = 'public' LOOP
        v_start := clock_timestamp();
        EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', r.matviewname);
        INSERT INTO maintenance_log (run_id, operation, object_name, details, duration_ms)
        VALUES (v_run, 'REFRESH', r.matviewname, 'матеріалізоване представлення',
                EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000);
        COMMIT;
    END LOOP;

    INSERT INTO maintenance_log (run_id, operation, details, duration_ms)
    VALUES (v_run, 'SUMMARY',
            format('ANALYZE: %s табл.; перевірено індексів: %s, перебудовано: %s, звільнено %s',
                   v_analyzed, v_checked, v_rebuilt, pg_size_pretty(v_freed)),
            EXTRACT(EPOCH FROM clock_timestamp() - v_total) * 1000);
    COMMIT;

    RAISE NOTICE 'Обслуговування № % завершено: ANALYZE % табл., REINDEX % з % індексів, звільнено %',
        v_run, v_analyzed, v_rebuilt, v_checked, pg_size_pretty(v_freed);
END;
$$;

-- Запускати процедуру може лише адміністратор
REVOKE EXECUTE ON PROCEDURE maintain_database(NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON PROCEDURE maintain_database(NUMERIC, NUMERIC, NUMERIC) TO car_admin;
