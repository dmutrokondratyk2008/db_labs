-- =====================================================================
-- 07_create_audit.sql: журнал усіх операцій з даними (рівень 3)
--
-- Два джерела записів:
--   1) тригер fn_audit_row() на основних таблицях фіксує кожну зміну
--      INSERT / UPDATE / DELETE зі старими і новими значеннями (JSONB);
--   2) застосунок викликає log_activity() для дій, що не змінюють таблиці:
--      вхід, вихід, реєстрація, формування звітів, резервне копіювання.
-- Застосунок на початку кожної транзакції виконує
--   SELECT set_config('app.user_id', '<id>', true), set_config('app.username', '<login>', true)
-- тому тригер знає, який користувач вебзастосунку виконав зміну.
-- =====================================================================

CREATE TABLE activity_log (
    log_id      BIGSERIAL PRIMARY KEY,
    user_id     INTEGER     REFERENCES users(user_id) ON DELETE SET NULL,
    username    VARCHAR(30),
    action      VARCHAR(30) NOT NULL,
    table_name  VARCHAR(50),
    record_id   INTEGER,
    details     TEXT,
    old_data    JSONB,
    new_data    JSONB,
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Функція для логування дій застосунку
CREATE OR REPLACE FUNCTION log_activity(
    p_user_id    INTEGER,
    p_action     VARCHAR,
    p_table_name VARCHAR DEFAULT NULL,
    p_record_id  INTEGER DEFAULT NULL,
    p_details    TEXT    DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO activity_log (user_id, username, action, table_name, record_id, details)
    VALUES (p_user_id,
            (SELECT username FROM users WHERE user_id = p_user_id),
            p_action, p_table_name, p_record_id, p_details);
END;
$$ LANGUAGE plpgsql;

-- Універсальна тригерна функція аудиту.
-- TG_ARGV[0] - назва стовпця з ідентифікатором запису.
CREATE OR REPLACE FUNCTION fn_audit_row()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id  INTEGER := NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER;
    v_username VARCHAR := COALESCE(NULLIF(current_setting('app.username', TRUE), ''), CURRENT_USER);
    v_old      JSONB;
    v_new      JSONB;
BEGIN
    -- хеш пароля і час останнього входу в журнал не потрапляють
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD) - 'password_hash' - 'last_login'; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW) - 'password_hash' - 'last_login'; END IF;

    -- UPDATE без фактичних змін не логуємо
    IF TG_OP = 'UPDATE' AND v_old = v_new THEN
        RETURN NULL;
    END IF;

    INSERT INTO activity_log (user_id, username, action, table_name, record_id, old_data, new_data)
    VALUES (v_user_id, v_username, TG_OP, TG_TABLE_NAME,
            (COALESCE(v_new, v_old) ->> TG_ARGV[0])::INTEGER, v_old, v_new);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_clients   AFTER INSERT OR UPDATE OR DELETE ON clients
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row('client_id');
CREATE TRIGGER trg_audit_managers  AFTER INSERT OR UPDATE OR DELETE ON managers
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row('manager_id');
CREATE TRIGGER trg_audit_cars      AFTER INSERT OR UPDATE OR DELETE ON cars
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row('car_id');
CREATE TRIGGER trg_audit_orders    AFTER INSERT OR UPDATE OR DELETE ON orders
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row('order_id');
CREATE TRIGGER trg_audit_shipments AFTER INSERT OR UPDATE OR DELETE ON shipments
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row('shipment_id');
CREATE TRIGGER trg_audit_customs   AFTER INSERT OR UPDATE OR DELETE ON customs_declarations
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row('order_id');
CREATE TRIGGER trg_audit_order_services AFTER INSERT OR UPDATE OR DELETE ON order_services
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row('order_id');
CREATE TRIGGER trg_audit_payments  AFTER INSERT OR UPDATE OR DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row('payment_id');
CREATE TRIGGER trg_audit_users     AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row('user_id');
