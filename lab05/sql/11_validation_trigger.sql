-- =====================================================================
-- 11_validation_trigger.sql: BEFORE-тригер валідації замовлень
-- Тригер нормалізує дані і відхиляє некоректні значення, яких не можна
-- описати простим CHECK (потрібні запити до інших таблиць).
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_validate_order()
RETURNS TRIGGER AS $$
DECLARE
    v_manager_active BOOLEAN;
    v_new_orders     INTEGER;
BEGIN
    -- 1. Нормалізація: зайві пробіли, велика перша літера міста
    NEW.wanted_car := btrim(regexp_replace(NEW.wanted_car, '\s+', ' ', 'g'));
    IF TG_OP = 'INSERT' OR NEW.destination_city IS DISTINCT FROM OLD.destination_city THEN
        NEW.destination_city := btrim(regexp_replace(NEW.destination_city, '\s+', ' ', 'g'));
        NEW.destination_city := upper(left(NEW.destination_city, 1)) || substr(NEW.destination_city, 2);

        IF NEW.destination_city !~ '^[А-ЩЬЮЯҐЄІЇ][А-ЩЬЮЯҐЄІЇа-щьюяґєії''ʼ -]+$' THEN
            RAISE EXCEPTION 'Некоректне місто доставки: "%"', NEW.destination_city
                USING ERRCODE = 'invalid_parameter_value',
                      HINT = 'Назва міста українською: літери, пробіл, дефіс, апостроф';
        END IF;
    END IF;

    -- 2. Бюджет у розумних межах
    IF TG_OP = 'INSERT' OR NEW.budget_usd IS DISTINCT FROM OLD.budget_usd THEN
        IF NEW.budget_usd NOT BETWEEN 1000 AND 500000 THEN
            RAISE EXCEPTION 'Бюджет % $ поза допустимими межами', NEW.budget_usd
                USING ERRCODE = 'numeric_value_out_of_range',
                      HINT = 'Допустимий бюджет: від 1 000 до 500 000 $';
        END IF;
    END IF;

    -- 3. Замовлення можна призначити лише працюючому менеджеру
    IF TG_OP = 'INSERT' OR NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
        SELECT is_active INTO v_manager_active FROM managers WHERE manager_id = NEW.manager_id;
        IF v_manager_active IS FALSE THEN
            RAISE EXCEPTION 'Менеджер % не працює в компанії', NEW.manager_id
                USING ERRCODE = 'check_violation',
                      HINT = 'Оберіть активного менеджера (managers.is_active = TRUE)';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- 4. Дата замовлення не в майбутньому
        IF NEW.order_date > CURRENT_DATE THEN
            RAISE EXCEPTION 'Дата замовлення % у майбутньому', NEW.order_date
                USING ERRCODE = 'invalid_datetime_format';
        END IF;

        -- 5. Захист від дублікатів: не більше трьох необроблених замовлень у клієнта
        SELECT COUNT(*) INTO v_new_orders
        FROM orders WHERE client_id = NEW.client_id AND status = 'new';
        IF v_new_orders >= 3 THEN
            RAISE EXCEPTION 'У клієнта % вже % нових замовлення', NEW.client_id, v_new_orders
                USING ERRCODE = 'unique_violation',
                      HINT = 'Спочатку обробіть або скасуйте наявні замовлення';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_validate
BEFORE INSERT OR UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION fn_validate_order();

-- Коректне замовлення: місто й модель нормалізуються
INSERT INTO orders (client_id, manager_id, wanted_car, budget_usd, destination_city)
SELECT client_id, 2, '  Toyota   RAV4  2021 ', 25000, '  луцьк '
FROM clients WHERE email = 'vira.labenko@ukr.net'
RETURNING order_id, client_id, wanted_car, destination_city, status;

-- Некоректні значення відхиляються
INSERT INTO orders (client_id, manager_id, wanted_car, budget_usd, destination_city)
VALUES (1, 2, 'Honda CR-V', 25000, 'Lutsk-2');

INSERT INTO orders (client_id, manager_id, wanted_car, budget_usd, destination_city)
VALUES (1, 2, 'Honda CR-V', 500, 'Луцьк');

INSERT INTO orders (client_id, manager_id, wanted_car, budget_usd, destination_city)
VALUES (1, 11, 'Honda CR-V', 25000, 'Луцьк');

UPDATE orders SET destination_city = 'Kyiv' WHERE order_id = 1;
