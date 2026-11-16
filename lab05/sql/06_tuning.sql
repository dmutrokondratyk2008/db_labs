-- =====================================================================
-- 06_tuning.sql: налаштування планувальника і покривний індекс
-- =====================================================================

-- 1. random_page_cost = 4 (за замовчуванням) розрахований на HDD, де випадкове
--    читання в 4 рази дорожче за послідовне. База (229 МБ) працює на SSD
--    і майже повністю в кеші, тому планувальник переоцінює Index Scan.
ALTER DATABASE :"DBNAME" SET random_page_cost = 1.1;
SET random_page_cost = 1.1;   -- для поточного сеансу

-- 2. У запиті 1 найдорожча частина - 4 892 звернення до payments по order_id,
--    кожне читає рядок таблиці заради amount_usd. Покривний індекс з INCLUDE
--    дає Index Only Scan. Він повністю замінює старий idx_payments_order_id,
--    тому старий індекс видаляємо: зайвий індекс лише сповільнює INSERT.
CREATE INDEX idx_payments_order_amount ON payments (order_id) INCLUDE (amount_usd);
DROP INDEX idx_payments_order_id;
VACUUM ANALYZE payments;

SELECT pg_size_pretty(pg_relation_size('idx_payments_order_amount')) AS covering_index_size;
