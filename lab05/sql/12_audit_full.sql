-- =====================================================================
-- 12_audit_full.sql: повноцінна система логування змін (рівень 2)
-- Одна універсальна тригерна функція для всіх основних таблиць.
-- TG_ARGV[0] - назва стовпця з ідентифікатором запису.
-- =====================================================================

-- Тригер рівня 1 замінюється універсальним, інакше зміни clients
-- записувалися б двічі
DROP TRIGGER trg_clients_log ON clients;
DROP FUNCTION fn_log_client_changes();

CREATE OR REPLACE FUNCTION fn_audit_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER                 -- запис у журнал навіть для ролей без прав на audit_log
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old     JSONB;
    v_new     JSONB;
    v_changed TEXT[];
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;

    IF TG_OP = 'UPDATE' THEN
        -- список стовпців, значення яких реально змінилося;
        -- службове updated_at (його оновлює тригер ЛР4) не враховується
        SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
        FROM jsonb_each(v_new) AS n
        WHERE n.value IS DISTINCT FROM v_old -> n.key
          AND n.key <> 'updated_at';

        IF v_changed IS NULL THEN       -- UPDATE без змін не логуємо
            RETURN NULL;
        END IF;
    END IF;

    INSERT INTO audit_log (table_name, operation, record_id, old_values, new_values,
                           changed_fields, changed_by, app_user, trigger_depth)
    VALUES (TG_TABLE_NAME, TG_OP,
            (COALESCE(v_new, v_old) ->> TG_ARGV[0])::INTEGER,
            v_old, v_new, v_changed,
            SESSION_USER,                                   -- хто підключився до СУБД
            NULLIF(current_setting('app.username', TRUE), ''),
            pg_trigger_depth());
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_log_clients   AFTER INSERT OR UPDATE OR DELETE ON clients
    FOR EACH ROW EXECUTE FUNCTION fn_audit_changes('client_id');
CREATE TRIGGER trg_audit_log_orders    AFTER INSERT OR UPDATE OR DELETE ON orders
    FOR EACH ROW EXECUTE FUNCTION fn_audit_changes('order_id');
CREATE TRIGGER trg_audit_log_payments  AFTER INSERT OR UPDATE OR DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION fn_audit_changes('payment_id');
CREATE TRIGGER trg_audit_log_cars      AFTER INSERT OR UPDATE OR DELETE ON cars
    FOR EACH ROW EXECUTE FUNCTION fn_audit_changes('car_id');
CREATE TRIGGER trg_audit_log_shipments AFTER INSERT OR UPDATE OR DELETE ON shipments
    FOR EACH ROW EXECUTE FUNCTION fn_audit_changes('shipment_id');

-- Зручний перегляд: для UPDATE лише змінені поля у вигляді "старе -> нове"
CREATE VIEW v_audit_changes AS
SELECT a.log_id,
       to_char(a.changed_at, 'YYYY-MM-DD HH24:MI:SS') AS changed_at,
       a.changed_by,
       a.app_user,
       a.trigger_depth,
       a.operation,
       a.table_name,
       a.record_id,
       CASE a.operation
           WHEN 'UPDATE' THEN (SELECT string_agg(f || ': ' || COALESCE(a.old_values ->> f, 'NULL')
                                                 || ' -> ' || COALESCE(a.new_values ->> f, 'NULL'), '; ')
                               FROM unnest(a.changed_fields) AS f)
           WHEN 'INSERT' THEN 'новий запис'
           ELSE 'видалено запис'
       END AS changes
FROM audit_log a;

-- Перевірка всіх типів операцій
SELECT COALESCE(MAX(log_id), 0) AS last_log FROM audit_log \gset
\set order_id '(SELECT MIN(order_id) FROM orders WHERE client_id = (SELECT client_id FROM clients WHERE email = ''vira.labenko@ukr.net''))'

INSERT INTO payments (order_id, amount_usd, method, purpose)
VALUES (:order_id, 1000, 'card', 'deposit');

-- зміна через сеанс вебзастосунку ЛР4: застосунок передає логін у app.username
BEGIN;
SELECT set_config('app.username', 'mazurets', TRUE);
UPDATE orders SET budget_usd = 27000, wanted_car = 'Toyota RAV4 2022' WHERE order_id = :order_id;
COMMIT;

UPDATE orders SET budget_usd = 27000 WHERE order_id = :order_id;    -- без змін: не логується

UPDATE payments SET method = 'bank_transfer'
WHERE order_id = :order_id AND purpose = 'deposit';

DELETE FROM payments WHERE order_id = :order_id AND purpose = 'deposit';

SELECT log_id, changed_by, app_user, operation, table_name, record_id, changes
FROM v_audit_changes
WHERE log_id > :last_log
ORDER BY log_id;

-- Повні старі та нові значення для UPDATE
SELECT log_id, changed_fields, old_values ->> 'budget_usd' AS old_budget,
       new_values ->> 'budget_usd' AS new_budget, txid, application_name
FROM audit_log
WHERE table_name = 'orders' AND operation = 'UPDATE'
ORDER BY log_id DESC LIMIT 1;

SELECT table_name, operation, COUNT(*) AS records
FROM audit_log
GROUP BY table_name, operation
ORDER BY table_name, operation;
