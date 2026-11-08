-- =====================================================================
-- 08_create_indexes.sql: індекси для оптимізації запитів (рівень 3)
-- Базові індекси на зовнішніх ключах створено в 01_create_tables.sql.
-- =====================================================================

-- Триграмний пошук за підрядком (ILIKE '%...%') по марці/моделі та клієнтах
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_cars_make_model_trgm
    ON cars USING GIN ((make || ' ' || model) gin_trgm_ops);

CREATE INDEX idx_clients_name_trgm
    ON clients USING GIN ((last_name || ' ' || first_name) gin_trgm_ops);

-- Складений індекс для фільтрації авто за маркою і роком
CREATE INDEX idx_cars_make_year ON cars (make, model_year);

-- Частковий індекс: лише активні замовлення (найчастіший фільтр у роботі менеджера)
CREATE INDEX idx_orders_active
    ON orders (manager_id, order_date)
    WHERE status NOT IN ('delivered', 'cancelled');

-- Звіти за періодом
CREATE INDEX idx_orders_order_date    ON orders (order_date);
CREATE INDEX idx_payments_date        ON payments (payment_date);

-- Журнал операцій: перегляд останніх записів і фільтр за користувачем
CREATE INDEX idx_activity_log_created ON activity_log (created_at DESC);
CREATE INDEX idx_activity_log_user    ON activity_log (user_id, created_at DESC);

ANALYZE;
