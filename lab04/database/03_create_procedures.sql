-- =====================================================================
-- 03_create_procedures.sql: збережені функції та процедури (рівень 2)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Реєстрація купівлі авто на аукціоні для нового замовлення.
--    Додає авто, прив'язує його до замовлення і переводить замовлення в статус 'bought'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_car_purchase(
    p_order_id   INTEGER,
    p_vin        VARCHAR,
    p_make       VARCHAR,
    p_model      VARCHAR,
    p_year       INTEGER,
    p_fuel       VARCHAR,
    p_engine     NUMERIC,
    p_battery    NUMERIC,
    p_mileage    INTEGER,
    p_damage     VARCHAR,
    p_yard_id    INTEGER,
    p_lot        VARCHAR,
    p_price      NUMERIC,
    p_fee        NUMERIC,
    p_date       DATE DEFAULT CURRENT_DATE
) RETURNS INTEGER AS $$
DECLARE
    v_order  orders%ROWTYPE;
    v_car_id INTEGER;
BEGIN
    -- блокуємо замовлення, щоб два менеджери не прив'язали до нього різні авто
    SELECT * INTO v_order FROM orders WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Замовлення % не існує', p_order_id;
    END IF;

    IF v_order.status <> 'new' THEN
        RAISE EXCEPTION 'Замовлення % має статус "%": купівля можлива лише для нових замовлень',
            p_order_id, v_order.status;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM auction_yards WHERE yard_id = p_yard_id) THEN
        RAISE EXCEPTION 'Аукціонний майданчик % не існує', p_yard_id;
    END IF;

    IF p_price + COALESCE(p_fee, 0) > v_order.budget_usd THEN
        RAISE NOTICE 'Увага: ціна лоту зі збором (% $) перевищує бюджет клієнта (% $)',
            p_price + COALESCE(p_fee, 0), v_order.budget_usd;
    END IF;

    INSERT INTO cars (vin, make, model, model_year, fuel_type, engine_volume, battery_kwh,
                      mileage_mi, damage, yard_id, lot_number, purchase_price_usd,
                      auction_fee_usd, purchase_date)
    VALUES (UPPER(p_vin), p_make, p_model, p_year, p_fuel, p_engine, p_battery,
            p_mileage, p_damage, p_yard_id, p_lot, p_price, COALESCE(p_fee, 0), p_date)
    RETURNING car_id INTO v_car_id;

    UPDATE orders SET car_id = v_car_id, status = 'bought' WHERE order_id = p_order_id;

    RETURN v_car_id;
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Авто з VIN % або лот % на цьому майданчику вже є в базі', UPPER(p_vin), p_lot;
    WHEN check_violation THEN
        RAISE EXCEPTION 'Некоректні дані авто: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
-- 2. Розрахунок митних платежів для авто, що прибуло в порт.
--    Створює або оновлює митну декларацію і переводить замовлення в статус 'customs'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_customs(
    p_order_id INTEGER,
    p_eur_usd  NUMERIC DEFAULT 1.16
) RETURNS TABLE (
    customs_value_usd NUMERIC,
    age_coefficient   INTEGER,
    duty_usd          NUMERIC,
    excise_usd        NUMERIC,
    vat_usd           NUMERIC,
    total_taxes_usd   NUMERIC
) AS $$
#variable_conflict use_column
DECLARE
    v_status   VARCHAR;
    v_car      cars%ROWTYPE;
    v_shipping NUMERIC;
    v_arrival  DATE;
    v_value    NUMERIC;
    v_age      INTEGER;
    v_rate     NUMERIC;
    v_excise   NUMERIC;
    v_duty     NUMERIC;
    v_vat      NUMERIC;
BEGIN
    IF p_eur_usd IS NULL OR p_eur_usd <= 0 THEN
        RAISE EXCEPTION 'Курс EUR/USD має бути додатним числом';
    END IF;

    SELECT o.status INTO v_status FROM orders o WHERE o.order_id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Замовлення % не існує', p_order_id;
    END IF;
    IF v_status NOT IN ('in_port', 'customs') THEN
        RAISE EXCEPTION 'Розмитнення можливе лише після прибуття в порт (статус замовлення: %)', v_status;
    END IF;

    SELECT c.* INTO v_car
    FROM orders o JOIN cars c ON c.car_id = o.car_id
    WHERE o.order_id = p_order_id;

    SELECT s.shipping_cost_usd, s.arrival_date INTO v_shipping, v_arrival
    FROM shipments s WHERE s.order_id = p_order_id;
    IF v_arrival IS NULL THEN
        RAISE EXCEPTION 'Для замовлення % не вказано дату прибуття в порт', p_order_id;
    END IF;

    v_value := v_car.purchase_price_usd + v_car.auction_fee_usd + v_shipping;
    v_age   := GREATEST(1, LEAST(15, EXTRACT(YEAR FROM v_arrival)::INT - v_car.model_year - 1));

    IF v_car.fuel_type = 'electric' THEN
        v_excise := v_car.battery_kwh * 1;               -- 1 EUR за 1 кВт*год
    ELSIF v_car.fuel_type = 'diesel' THEN
        v_rate   := CASE WHEN v_car.engine_volume <= 3.5 THEN 75 ELSE 150 END;
        v_excise := v_rate * v_car.engine_volume * v_age;
    ELSE
        v_rate   := CASE WHEN v_car.engine_volume <= 3.0 THEN 50 ELSE 100 END;
        v_excise := v_rate * v_car.engine_volume * v_age;
    END IF;

    v_excise := ROUND(v_excise * p_eur_usd, 2);
    v_duty   := ROUND(v_value * 0.10, 2);
    v_vat    := ROUND((v_value + v_duty + v_excise) * 0.20, 2);

    INSERT INTO customs_declarations AS cd
           (order_id, customs_value_usd, duty_usd, excise_usd, vat_usd, eur_usd_rate, declared_at)
    VALUES (p_order_id, v_value, v_duty, v_excise, v_vat, p_eur_usd, CURRENT_DATE)
    ON CONFLICT (order_id) DO UPDATE
       SET customs_value_usd = EXCLUDED.customs_value_usd,
           duty_usd          = EXCLUDED.duty_usd,
           excise_usd        = EXCLUDED.excise_usd,
           vat_usd           = EXCLUDED.vat_usd,
           eur_usd_rate      = EXCLUDED.eur_usd_rate;

    IF v_status = 'in_port' THEN
        UPDATE orders SET status = 'customs' WHERE order_id = p_order_id;
    END IF;

    RETURN QUERY SELECT v_value, v_age, v_duty, v_excise, v_vat, v_duty + v_excise + v_vat;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
-- 3. Зміна статусу замовлення з перевіркою допустимих переходів
--    та передумов (доставка, прибуття, розмитнення).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION change_order_status(
    p_order_id   INTEGER,
    p_new_status VARCHAR
) RETURNS TEXT AS $$
DECLARE
    v_old VARCHAR;
    v_allowed TEXT[];
BEGIN
    SELECT status INTO v_old FROM orders WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Замовлення % не існує', p_order_id;
    END IF;

    v_allowed := CASE v_old
        WHEN 'new'        THEN ARRAY['bought', 'cancelled']
        WHEN 'bought'     THEN ARRAY['in_transit', 'cancelled']
        WHEN 'in_transit' THEN ARRAY['in_port']
        WHEN 'in_port'    THEN ARRAY['customs']
        WHEN 'customs'    THEN ARRAY['delivered']
        ELSE ARRAY[]::TEXT[]
    END;

    IF NOT (p_new_status = ANY (v_allowed)) THEN
        RAISE EXCEPTION 'Недопустимий перехід статусу: % -> % (дозволено: %)',
            v_old, p_new_status, COALESCE(NULLIF(array_to_string(v_allowed, ', '), ''), 'жодного');
    END IF;

    -- передумови для переходів
    IF p_new_status = 'in_transit' AND NOT EXISTS (
        SELECT 1 FROM shipments WHERE order_id = p_order_id AND departure_date IS NOT NULL) THEN
        RAISE EXCEPTION 'Немає відправленої доставки для замовлення %', p_order_id;
    ELSIF p_new_status = 'in_port' AND NOT EXISTS (
        SELECT 1 FROM shipments WHERE order_id = p_order_id AND arrival_date IS NOT NULL) THEN
        RAISE EXCEPTION 'Не вказано дату прибуття контейнера для замовлення %', p_order_id;
    ELSIF p_new_status = 'customs' AND NOT EXISTS (
        SELECT 1 FROM customs_declarations WHERE order_id = p_order_id) THEN
        RAISE EXCEPTION 'Спочатку розрахуйте митні платежі: SELECT * FROM calculate_customs(%)', p_order_id;
    ELSIF p_new_status = 'delivered' AND NOT EXISTS (
        SELECT 1 FROM customs_declarations WHERE order_id = p_order_id AND cleared_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Авто ще не розмитнене (cleared_at порожній)';
    END IF;

    UPDATE orders SET status = p_new_status WHERE order_id = p_order_id;
    RETURN format('Замовлення %s: %s -> %s', p_order_id, v_old, p_new_status);
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
-- 4. Процедура скасування замовлення з причиною (CALL cancel_order(...)).
--    Причина потрапляє в історію статусів через змінну сесії app.status_comment.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE cancel_order(
    p_order_id INTEGER,
    p_reason   TEXT
) AS $$
DECLARE
    v_status VARCHAR;
BEGIN
    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'Вкажіть причину скасування (не менше 5 символів)';
    END IF;

    SELECT status INTO v_status FROM orders WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Замовлення % не існує', p_order_id;
    END IF;
    IF v_status NOT IN ('new', 'bought') THEN
        RAISE EXCEPTION 'Замовлення в статусі "%" скасувати не можна: авто вже відправлене', v_status;
    END IF;

    PERFORM set_config('app.status_comment', p_reason, TRUE);
    UPDATE orders SET status = 'cancelled' WHERE order_id = p_order_id;
    PERFORM set_config('app.status_comment', '', TRUE);

    RAISE NOTICE 'Замовлення % скасовано. Причина: %', p_order_id, p_reason;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
-- 5. Кошторис замовлення: усі складові вартості, сплачена сума і залишок.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_order_cost(p_order_id INTEGER)
RETURNS TABLE (item TEXT, amount_usd NUMERIC) AS $$
DECLARE
    v_car      NUMERIC := 0;
    v_fee      NUMERIC := 0;
    v_ship     NUMERIC := 0;
    v_duty     NUMERIC := 0;
    v_excise   NUMERIC := 0;
    v_vat      NUMERIC := 0;
    v_services NUMERIC := 0;
    v_company  NUMERIC := 0;
    v_paid     NUMERIC := 0;
    v_total    NUMERIC;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM orders WHERE order_id = p_order_id) THEN
        RAISE EXCEPTION 'Замовлення % не існує', p_order_id;
    END IF;

    SELECT COALESCE(c.purchase_price_usd, 0), COALESCE(c.auction_fee_usd, 0),
           CASE WHEN o.status = 'cancelled' THEN 0 ELSE o.service_fee_usd END
      INTO v_car, v_fee, v_company
      FROM orders o LEFT JOIN cars c ON c.car_id = o.car_id
     WHERE o.order_id = p_order_id;

    SELECT COALESCE(SUM(shipping_cost_usd), 0) INTO v_ship
      FROM shipments WHERE order_id = p_order_id;

    SELECT COALESCE(SUM(cd.duty_usd), 0), COALESCE(SUM(cd.excise_usd), 0), COALESCE(SUM(cd.vat_usd), 0)
      INTO v_duty, v_excise, v_vat
      FROM customs_declarations cd WHERE cd.order_id = p_order_id;

    SELECT COALESCE(SUM(price_usd), 0) INTO v_services
      FROM order_services WHERE order_id = p_order_id;

    SELECT COALESCE(SUM(p.amount_usd), 0) INTO v_paid
      FROM payments p WHERE p.order_id = p_order_id;

    v_total := v_car + v_fee + v_ship + v_duty + v_excise + v_vat + v_services + v_company;

    RETURN QUERY VALUES
        ('Ціна лоту'::TEXT,        v_car),
        ('Збір аукціону',          v_fee),
        ('Морська доставка',       v_ship),
        ('Мито',                   v_duty),
        ('Акциз',                  v_excise),
        ('ПДВ',                    v_vat),
        ('Додаткові послуги',      v_services),
        ('Комісія компанії',       v_company),
        ('РАЗОМ',                  v_total),
        ('Сплачено',               v_paid),
        ('Залишок до сплати',      v_total - v_paid);
END;
$$ LANGUAGE plpgsql;
