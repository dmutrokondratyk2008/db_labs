-- =====================================================================
-- 04_create_triggers.sql: тригери для автоматизації процесів (рівень 2)
-- =====================================================================

-- Історія зміни статусів замовлень
CREATE TABLE order_status_history (
    history_id  SERIAL PRIMARY KEY,
    order_id    INTEGER     NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    old_status  VARCHAR(20),
    new_status  VARCHAR(20) NOT NULL,
    changed_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by  VARCHAR(100) NOT NULL DEFAULT CURRENT_USER,
    comment     TEXT
);
CREATE INDEX idx_status_history_order ON order_status_history(order_id);

-- ---------------------------------------------------------------------
-- Тригер 1. Журнал зміни статусів замовлення
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_log_order_status()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, comment)
        VALUES (NEW.order_id,
                CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
                NEW.status,
                COALESCE(NULLIF(current_setting('app.username', TRUE), ''), CURRENT_USER),
                NULLIF(current_setting('app.status_comment', TRUE), ''));
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_status_history
AFTER INSERT OR UPDATE OF status ON orders
FOR EACH ROW
EXECUTE FUNCTION fn_log_order_status();

-- ---------------------------------------------------------------------
-- Тригер 2. Автоматичне оновлення поля updated_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------
-- Тригер 3. Синхронізація статусу замовлення з доставкою:
--   вказано дату відправлення  -> 'in_transit'
--   вказано дату прибуття      -> 'in_port'
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_sync_order_with_shipment()
RETURNS TRIGGER AS $$
DECLARE
    v_status VARCHAR;
BEGIN
    SELECT status INTO v_status FROM orders WHERE order_id = NEW.order_id;

    IF v_status IN ('new', 'cancelled') THEN
        RAISE EXCEPTION 'Неможливо оформити доставку для замовлення в статусі "%"', v_status;
    END IF;

    IF NEW.arrival_date IS NOT NULL AND v_status IN ('bought', 'in_transit') THEN
        UPDATE orders SET status = 'in_port' WHERE order_id = NEW.order_id;
    ELSIF NEW.departure_date IS NOT NULL AND v_status = 'bought' THEN
        UPDATE orders SET status = 'in_transit' WHERE order_id = NEW.order_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shipments_sync_status
AFTER INSERT OR UPDATE OF departure_date, arrival_date ON shipments
FOR EACH ROW
EXECUTE FUNCTION fn_sync_order_with_shipment();

-- ---------------------------------------------------------------------
-- Тригер 4. Нормалізація і перевірка даних авто перед збереженням
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_car()
RETURNS TRIGGER AS $$
BEGIN
    NEW.vin   := UPPER(TRIM(NEW.vin));
    NEW.make  := INITCAP(TRIM(NEW.make));
    NEW.model := TRIM(NEW.model);

    IF NEW.model_year > EXTRACT(YEAR FROM CURRENT_DATE) + 1 THEN
        RAISE EXCEPTION 'Рік випуску % не може бути більшим за %',
            NEW.model_year, EXTRACT(YEAR FROM CURRENT_DATE) + 1;
    END IF;

    IF NEW.purchase_date > CURRENT_DATE THEN
        RAISE EXCEPTION 'Дата купівлі (%) не може бути в майбутньому', NEW.purchase_date;
    END IF;

    IF NEW.purchase_date < make_date(NEW.model_year - 1, 1, 1) THEN
        RAISE EXCEPTION 'Дата купівлі (%) раніша за рік випуску авто (%)', NEW.purchase_date, NEW.model_year;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cars_validate
BEFORE INSERT OR UPDATE ON cars
FOR EACH ROW
EXECUTE FUNCTION fn_validate_car();

-- ---------------------------------------------------------------------
-- Тригер 5. Перевірка платежу: не можна платити за скасоване замовлення,
--   а до купівлі авто приймається лише завдаток
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_check_payment()
RETURNS TRIGGER AS $$
DECLARE
    v_status VARCHAR;
BEGIN
    SELECT status INTO v_status FROM orders WHERE order_id = NEW.order_id;

    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'Замовлення % скасоване, платежі не приймаються', NEW.order_id;
    END IF;

    IF v_status = 'new' AND NEW.purpose <> 'deposit' THEN
        RAISE EXCEPTION 'До купівлі авто можна внести лише завдаток (deposit), а не "%"', NEW.purpose;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_check
BEFORE INSERT OR UPDATE ON payments
FOR EACH ROW
EXECUTE FUNCTION fn_check_payment();

-- Початкові записи історії для вже наявних замовлень
INSERT INTO order_status_history (order_id, old_status, new_status, changed_at, changed_by, comment)
SELECT order_id, NULL, status, created_at, 'postgres', 'Початкові дані'
FROM orders;
