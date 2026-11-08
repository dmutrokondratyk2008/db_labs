-- =====================================================================
-- 05_create_views.sql: представлення (рівень 2)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Повна інформація про замовлення: клієнт, менеджер, авто, аукціон, доставка
-- ---------------------------------------------------------------------
CREATE VIEW v_order_details AS
SELECT
    o.order_id,
    o.order_date,
    o.status,
    cl.client_id,
    cl.last_name || ' ' || cl.first_name       AS client_name,
    cl.phone                                   AS client_phone,
    m.manager_id,
    m.last_name || ' ' || m.first_name         AS manager_name,
    o.wanted_car,
    o.budget_usd,
    o.destination_city,
    c.car_id,
    c.vin,
    c.make || ' ' || c.model || ' ' || c.model_year AS car,
    c.fuel_type,
    y.platform || ' / ' || y.yard_name || ', ' || y.state AS auction_yard,
    c.purchase_price_usd,
    s.port_to,
    s.departure_date,
    s.arrival_date,
    o.updated_at
FROM orders o
JOIN clients  cl ON cl.client_id = o.client_id
JOIN managers m  ON m.manager_id = o.manager_id
LEFT JOIN cars c           ON c.car_id = o.car_id
LEFT JOIN auction_yards y  ON y.yard_id = c.yard_id
LEFT JOIN shipments s      ON s.order_id = o.order_id;

-- ---------------------------------------------------------------------
-- 2. Фінанси замовлення: повна вартість, сплачено, залишок
--    (від'ємний залишок означає аванс клієнта)
-- ---------------------------------------------------------------------
CREATE VIEW v_order_finance AS
WITH svc AS (
    SELECT order_id, SUM(price_usd) AS services_usd
    FROM order_services GROUP BY order_id
), paid AS (
    SELECT order_id, SUM(amount_usd) AS paid_usd
    FROM payments GROUP BY order_id
), costs AS (
    SELECT
        o.order_id,
        cl.last_name || ' ' || cl.first_name                            AS client_name,
        o.status,
        COALESCE(c.purchase_price_usd + c.auction_fee_usd, 0)           AS car_cost_usd,
        COALESCE(s.shipping_cost_usd, 0)                                AS shipping_usd,
        COALESCE(cd.duty_usd + cd.excise_usd + cd.vat_usd, 0)           AS taxes_usd,
        COALESCE(svc.services_usd, 0)                                   AS services_usd,
        CASE WHEN o.status = 'cancelled' THEN 0 ELSE o.service_fee_usd END AS service_fee_usd,
        COALESCE(paid.paid_usd, 0)                                      AS paid_usd
    FROM orders o
    JOIN clients cl                   ON cl.client_id = o.client_id
    LEFT JOIN cars c                  ON c.car_id = o.car_id
    LEFT JOIN shipments s             ON s.order_id = o.order_id
    LEFT JOIN customs_declarations cd ON cd.order_id = o.order_id
    LEFT JOIN svc                     ON svc.order_id = o.order_id
    LEFT JOIN paid                    ON paid.order_id = o.order_id
)
SELECT
    order_id, client_name, status,
    car_cost_usd, shipping_usd, taxes_usd, services_usd, service_fee_usd,
    car_cost_usd + shipping_usd + taxes_usd + services_usd + service_fee_usd AS total_cost_usd,
    paid_usd,
    car_cost_usd + shipping_usd + taxes_usd + services_usd + service_fee_usd - paid_usd AS balance_usd
FROM costs;

-- ---------------------------------------------------------------------
-- 3. Ефективність менеджерів: кількість замовлень, дохід компанії, бонус
-- ---------------------------------------------------------------------
CREATE VIEW v_manager_performance AS
SELECT
    m.manager_id,
    m.last_name || ' ' || m.first_name                                   AS manager_name,
    m.is_active,
    COUNT(o.order_id)                                                    AS orders_total,
    COUNT(o.order_id) FILTER (WHERE o.status NOT IN ('delivered', 'cancelled')) AS orders_active,
    COUNT(o.order_id) FILTER (WHERE o.status = 'delivered')             AS orders_delivered,
    COALESCE(SUM(o.service_fee_usd) FILTER (WHERE o.status <> 'cancelled'), 0) AS fee_income_usd,
    ROUND(COALESCE(SUM(o.service_fee_usd) FILTER (WHERE o.status = 'delivered'), 0)
          * m.commission_pct / 100, 2)                                   AS bonus_usd
FROM managers m
LEFT JOIN orders o ON o.manager_id = m.manager_id
GROUP BY m.manager_id, m.last_name, m.first_name, m.is_active, m.commission_pct;

-- ---------------------------------------------------------------------
-- 4. Авто в дорозі: контейнери без дати прибуття і очікувана дата прибуття
-- ---------------------------------------------------------------------
CREATE VIEW v_shipments_in_transit AS
SELECT
    s.shipment_id,
    s.order_id,
    c.make || ' ' || c.model || ' ' || c.model_year      AS car,
    cr.name                                              AS carrier,
    s.container_number,
    s.port_from || ' -> ' || s.port_to                   AS route,
    s.departure_date,
    s.departure_date + cr.transit_days_avg               AS expected_arrival,
    CURRENT_DATE - s.departure_date                      AS days_at_sea
FROM shipments s
JOIN orders o    ON o.order_id = s.order_id
JOIN cars c      ON c.car_id = o.car_id
JOIN carriers cr ON cr.carrier_id = s.carrier_id
WHERE s.departure_date IS NOT NULL AND s.arrival_date IS NULL;
