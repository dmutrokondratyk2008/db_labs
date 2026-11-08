-- =====================================================================
-- queries.sql: SQL-запити для отримання даних
-- (файл не змінює дані, тому безпечно виконується і при ініціалізації контейнера)
-- =====================================================================

-- ---------------------------------------------------------------------
-- РІВЕНЬ 1
-- ---------------------------------------------------------------------

-- Запит 1 (фільтрація і сортування): авто 2019 року і новіші,
-- куплені дешевше за 10 000 $, від найдешевшого
SELECT vin, make, model, model_year, mileage_mi, purchase_price_usd
FROM cars
WHERE model_year >= 2019 AND purchase_price_usd < 10000
ORDER BY purchase_price_usd;

-- Запит 2 (JOIN): активні замовлення з клієнтом, менеджером та авто
SELECT o.order_id,
       cl.last_name || ' ' || cl.first_name AS client,
       m.last_name                          AS manager,
       c.make || ' ' || c.model             AS car,
       o.status
FROM orders o
JOIN clients cl  ON cl.client_id = o.client_id
JOIN managers m  ON m.manager_id = o.manager_id
LEFT JOIN cars c ON c.car_id = o.car_id
WHERE o.status NOT IN ('delivered', 'cancelled')
ORDER BY o.order_date;

-- Запит 3 (агрегація): статистика покупок за марками (лише марки з 2+ авто)
SELECT make,
       COUNT(*)                          AS cars_count,
       ROUND(AVG(purchase_price_usd), 2) AS avg_price_usd,
       MIN(purchase_price_usd)           AS min_price_usd,
       MAX(purchase_price_usd)           AS max_price_usd
FROM cars
GROUP BY make
HAVING COUNT(*) >= 2
ORDER BY cars_count DESC, avg_price_usd DESC;

-- Запит 4 (підзапит): авто, куплені дорожче за середню ціну
SELECT make, model, model_year, purchase_price_usd,
       ROUND(purchase_price_usd - (SELECT AVG(purchase_price_usd) FROM cars), 2) AS above_avg_usd
FROM cars
WHERE purchase_price_usd > (SELECT AVG(purchase_price_usd) FROM cars)
ORDER BY purchase_price_usd DESC;

-- Запит 5 (підзапит з IN): постійні клієнти, що мають більше одного замовлення
SELECT client_id, last_name, first_name, city
FROM clients
WHERE client_id IN (
    SELECT client_id FROM orders
    WHERE status <> 'cancelled'
    GROUP BY client_id
    HAVING COUNT(*) > 1
)
ORDER BY last_name;

-- Запит 6 (кілька JOIN): повний маршрут авто від аукціону до порту
SELECT o.order_id,
       c.make || ' ' || c.model || ' ' || c.model_year AS car,
       y.platform || ' ' || y.yard_name || ' (' || y.state || ')' AS auction,
       cr.name                                  AS carrier,
       s.port_from || ' -> ' || s.port_to       AS route,
       s.departure_date,
       s.arrival_date,
       s.arrival_date - s.departure_date        AS days_at_sea
FROM orders o
JOIN cars c          ON c.car_id = o.car_id
JOIN auction_yards y ON y.yard_id = c.yard_id
JOIN shipments s     ON s.order_id = o.order_id
JOIN carriers cr     ON cr.carrier_id = s.carrier_id
ORDER BY s.departure_date;

-- Запит 7 (корельований підзапит): найдорожче авто на кожній аукціонній платформі
SELECT y.platform, c.make, c.model, c.purchase_price_usd
FROM cars c
JOIN auction_yards y ON y.yard_id = c.yard_id
WHERE c.purchase_price_usd = (
    SELECT MAX(c2.purchase_price_usd)
    FROM cars c2 JOIN auction_yards y2 ON y2.yard_id = c2.yard_id
    WHERE y2.platform = y.platform
)
ORDER BY c.purchase_price_usd DESC;

-- ---------------------------------------------------------------------
-- РІВЕНЬ 2: аналітичні запити з агрегацією
-- ---------------------------------------------------------------------

-- Аналітика 1: помісячна динаміка купівель і надходжень коштів
WITH purchases AS (
    SELECT date_trunc('month', purchase_date)::DATE AS month,
           COUNT(*)                                 AS cars_bought,
           SUM(purchase_price_usd + auction_fee_usd) AS spent_on_cars_usd
    FROM cars GROUP BY 1
), income AS (
    SELECT date_trunc('month', payment_date)::DATE AS month,
           SUM(amount_usd)                         AS received_usd
    FROM payments GROUP BY 1
)
SELECT to_char(COALESCE(p.month, i.month), 'YYYY-MM') AS month,
       COALESCE(p.cars_bought, 0)       AS cars_bought,
       COALESCE(p.spent_on_cars_usd, 0) AS spent_on_cars_usd,
       COALESCE(i.received_usd, 0)      AS received_usd,
       SUM(COALESCE(i.received_usd, 0)) OVER (ORDER BY COALESCE(p.month, i.month)) AS received_cumulative_usd
FROM purchases p
FULL JOIN income i ON i.month = p.month
ORDER BY 1;

-- Аналітика 2: перевізники - кількість доставок, середній час і вартість, рейтинг за швидкістю
SELECT cr.name                                           AS carrier,
       COUNT(s.shipment_id)                              AS shipments,
       COUNT(s.arrival_date)                             AS delivered,
       ROUND(AVG(s.arrival_date - s.departure_date), 1)  AS avg_days,
       ROUND(AVG(s.shipping_cost_usd), 2)                AS avg_cost_usd,
       RANK() OVER (ORDER BY AVG(s.arrival_date - s.departure_date)) AS speed_rank
FROM carriers cr
JOIN shipments s ON s.carrier_id = cr.carrier_id
GROUP BY cr.carrier_id, cr.name
ORDER BY speed_rank NULLS LAST, shipments DESC;

-- Аналітика 3: структура витрат клієнта по доставлених авто (частка кожної складової)
SELECT ROUND(AVG(total_cost_usd), 2)                              AS avg_total_usd,
       ROUND(100 * SUM(car_cost_usd)    / SUM(total_cost_usd), 1) AS car_pct,
       ROUND(100 * SUM(shipping_usd)    / SUM(total_cost_usd), 1) AS shipping_pct,
       ROUND(100 * SUM(taxes_usd)       / SUM(total_cost_usd), 1) AS taxes_pct,
       ROUND(100 * SUM(services_usd)    / SUM(total_cost_usd), 1) AS services_pct,
       ROUND(100 * SUM(service_fee_usd) / SUM(total_cost_usd), 1) AS fee_pct
FROM v_order_finance
WHERE status = 'delivered';

-- Аналітика 4: топ клієнтів за сумою платежів, частка в загальних надходженнях
SELECT cl.last_name || ' ' || cl.first_name                 AS client,
       cl.city,
       COUNT(DISTINCT o.order_id)                           AS orders,
       SUM(p.amount_usd)                                    AS paid_usd,
       ROUND(100 * SUM(p.amount_usd) / SUM(SUM(p.amount_usd)) OVER (), 1) AS share_pct,
       DENSE_RANK() OVER (ORDER BY SUM(p.amount_usd) DESC)  AS place
FROM clients cl
JOIN orders o   ON o.client_id = cl.client_id
JOIN payments p ON p.order_id = o.order_id
GROUP BY cl.client_id, cl.last_name, cl.first_name, cl.city
ORDER BY place
LIMIT 10;

-- Аналітика 5: середні митні платежі за типом пального і віком авто
SELECT c.fuel_type,
       CASE WHEN EXTRACT(YEAR FROM cd.declared_at) - c.model_year <= 5 THEN 'до 5 років'
            ELSE 'старше 5 років' END                      AS age_group,
       COUNT(*)                                           AS cars,
       ROUND(AVG(cd.duty_usd), 2)                         AS avg_duty_usd,
       ROUND(AVG(cd.excise_usd), 2)                       AS avg_excise_usd,
       ROUND(AVG(cd.vat_usd), 2)                          AS avg_vat_usd,
       ROUND(AVG(cd.duty_usd + cd.excise_usd + cd.vat_usd), 2) AS avg_total_usd
FROM customs_declarations cd
JOIN orders o ON o.order_id = cd.order_id
JOIN cars c   ON c.car_id = o.car_id
GROUP BY c.fuel_type, age_group
ORDER BY c.fuel_type, age_group;
