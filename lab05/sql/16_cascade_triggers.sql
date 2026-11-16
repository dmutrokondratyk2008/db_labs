-- =====================================================================
-- 16_cascade_triggers.sql: каскадні тригери бізнес-логіки (рівень 3)
--
--   payments --(1)--> orders.paid_usd --(2)--> clients.total_paid_usd
--        --(3)--> clients.loyalty_level --(4)--> client_notifications
--
--   + правило: авто видається клієнту (status = 'delivered') лише після
--     повної оплати замовлення
-- =====================================================================

-- Нові поля і таблиця повідомлень
ALTER TABLE orders  ADD COLUMN paid_usd NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN total_paid_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
                    ADD COLUMN loyalty_level  VARCHAR(10)   NOT NULL DEFAULT 'standard'
                        CHECK (loyalty_level IN ('standard', 'silver', 'gold'));

CREATE TABLE client_notifications (
    notification_id  SERIAL PRIMARY KEY,
    client_id        INTEGER NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
    message          TEXT    NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Рівень лояльності за сумою всіх оплат клієнта
CREATE OR REPLACE FUNCTION loyalty_level_for(p_total NUMERIC)
RETURNS VARCHAR LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p_total >= 150000 THEN 'gold'
                WHEN p_total >=  50000 THEN 'silver'
                ELSE 'standard' END;
$$;

-- Початкове заповнення нових полів (тригери вимкнено, щоб не було каскаду
-- і записів у журнали для 180 тис. рядків)
SET session_replication_role = replica;
UPDATE orders o SET paid_usd = p.total
FROM (SELECT order_id, SUM(amount_usd) AS total FROM payments GROUP BY order_id) p
WHERE p.order_id = o.order_id;
UPDATE clients c SET total_paid_usd = x.total, loyalty_level = loyalty_level_for(x.total)
FROM (SELECT client_id, SUM(paid_usd) AS total FROM orders GROUP BY client_id) x
WHERE x.client_id = c.client_id;
SET session_replication_role = origin;
VACUUM ANALYZE orders;
VACUUM ANALYZE clients;

-- (1) payments -> orders: сума оплат замовлення змінюється на різницю
CREATE OR REPLACE FUNCTION fn_cascade_payment_to_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        UPDATE orders SET paid_usd = paid_usd - OLD.amount_usd WHERE order_id = OLD.order_id;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        UPDATE orders SET paid_usd = paid_usd + NEW.amount_usd WHERE order_id = NEW.order_id;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_payments_cascade
AFTER INSERT OR DELETE OR UPDATE OF amount_usd, order_id ON payments
FOR EACH ROW EXECUTE FUNCTION fn_cascade_payment_to_order();

-- (2) orders -> clients: загальна сума оплат клієнта
CREATE OR REPLACE FUNCTION fn_cascade_order_to_client()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE clients
       SET total_paid_usd = total_paid_usd + (NEW.paid_usd - OLD.paid_usd)
     WHERE client_id = NEW.client_id;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_orders_cascade
AFTER UPDATE OF paid_usd ON orders
FOR EACH ROW
WHEN (NEW.paid_usd IS DISTINCT FROM OLD.paid_usd)
EXECUTE FUNCTION fn_cascade_order_to_client();

-- (3) clients: перерахунок рівня лояльності перед збереженням
CREATE OR REPLACE FUNCTION fn_client_loyalty()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.loyalty_level := loyalty_level_for(NEW.total_paid_usd);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clients_loyalty
BEFORE UPDATE OF total_paid_usd ON clients
FOR EACH ROW EXECUTE FUNCTION fn_client_loyalty();

-- (4) clients -> client_notifications: повідомлення про новий рівень
CREATE OR REPLACE FUNCTION fn_client_notify_level()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    INSERT INTO client_notifications (client_id, message)
    VALUES (NEW.client_id,
            format('%s %s, ваш рівень змінено: %s -> %s. Сума оплат: %s $',
                   NEW.first_name, NEW.last_name, OLD.loyalty_level, NEW.loyalty_level,
                   NEW.total_paid_usd));
    RETURN NULL;
END;
$$;

-- Увага: тригер UPDATE OF loyalty_level тут не спрацював би, бо стовпець
-- змінює BEFORE-тригер, а не список SET оператора UPDATE
CREATE TRIGGER trg_clients_notify
AFTER UPDATE OF total_paid_usd ON clients
FOR EACH ROW
WHEN (NEW.loyalty_level IS DISTINCT FROM OLD.loyalty_level)
EXECUTE FUNCTION fn_client_notify_level();

-- Бізнес-правило: видача авто лише після повної оплати
CREATE OR REPLACE FUNCTION fn_check_delivery_paid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_balance NUMERIC;
BEGIN
    SELECT balance_usd INTO v_balance FROM v_order_finance WHERE order_id = NEW.order_id;
    IF v_balance > 0 THEN
        RAISE EXCEPTION 'Замовлення % не можна видати: заборгованість % $', NEW.order_id, v_balance
            USING ERRCODE = 'check_violation',
                  HINT = 'Спочатку клієнт має сплатити повну вартість';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_check_delivery
BEFORE UPDATE OF status ON orders
FOR EACH ROW
WHEN (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered')
EXECUTE FUNCTION fn_check_delivery_paid();

SELECT loyalty_level, COUNT(*) AS clients, MIN(total_paid_usd), MAX(total_paid_usd)
FROM clients GROUP BY loyalty_level ORDER BY 3;
