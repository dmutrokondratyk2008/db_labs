-- =====================================================================
-- 14_checksums.sql: контроль відновлення з резервної копії.
-- Виконується в оригінальній і відновленій базі; результати мають збігтися.
-- Контрольна сума таблиці - md5 від усіх рядків, упорядкованих за ключем.
-- =====================================================================
SELECT current_database()                                  AS database,
       (SELECT COUNT(*) FROM clients)                      AS clients,
       (SELECT COUNT(*) FROM orders)                       AS orders,
       (SELECT COUNT(*) FROM payments)                     AS payments,
       (SELECT COUNT(*) FROM audit_log)                    AS audit_log,
       (SELECT left(md5(string_agg(t::text, '|' ORDER BY client_id)), 10)  FROM clients t)  AS clients_md5,
       (SELECT left(md5(string_agg(t::text, '|' ORDER BY order_id)), 10)   FROM orders t)   AS orders_md5,
       (SELECT left(md5(string_agg(t::text, '|' ORDER BY payment_id)), 10) FROM payments t) AS payments_md5;

SELECT current_database() AS database,
       (SELECT COUNT(*) FROM pg_tables   WHERE schemaname = 'public') AS tables,
       (SELECT COUNT(*) FROM pg_views    WHERE schemaname = 'public') AS views,
       (SELECT COUNT(*) FROM pg_indexes  WHERE schemaname = 'public') AS indexes,
       (SELECT COUNT(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND NOT t.tgisinternal)            AS triggers,
       (SELECT COUNT(*) FROM pg_rules    WHERE schemaname = 'public') AS rules,
       (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public')                                  AS functions,
       pg_size_pretty(pg_database_size(current_database()))           AS size;
