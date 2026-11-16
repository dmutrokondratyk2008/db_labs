-- =====================================================================
-- Лабораторна робота 5. 01_generate_data.sql
-- Наповнення бази car_import (ЛР4) великим обсягом тестових даних:
-- 50 000 клієнтів, 150 000 авто, 180 000 замовлень, доставки, митниця, платежі.
-- Згенеровані записи впізнаються за VIN 'GEN...' і email '@gen.example.com'.
-- =====================================================================
\timing on
SELECT setseed(0.2026);

-- Під час масового завантаження тригери аудиту ЛР4 вимкнено: інакше кожен
-- рядок записувався б у activity_log (сотні тисяч зайвих записів)
SET session_replication_role = replica;

-- ---------------------------------------------------------------------
-- 1. Клієнти: 50 000, дата реєстрації за останні 3 роки
-- ---------------------------------------------------------------------
INSERT INTO clients (first_name, last_name, phone, email, city, created_at)
SELECT (ARRAY['Олександр','Андрій','Сергій','Дмитро','Максим','Іван','Богдан','Тарас','Юрій','Віктор',
              'Олена','Ірина','Наталія','Оксана','Юлія','Тетяна','Марія','Анна','Світлана','Катерина'])[1 + floor(random() * 20)::int],
       (ARRAY['Бондаренко','Мельничук','Ковальчук','Савчук','Гнатюк','Ткачук','Поліщук','Кравчук','Олійник','Шевчук',
              'Лисенко','Романюк','Мороз','Бойко','Коваленко','Марчук','Остапчук','Петрук','Семенюк','Федорук'])[1 + floor(random() * 20)::int],
       '+38098' || lpad(g::text, 7, '0'),
       'client' || g || '@gen.example.com',
       (ARRAY['Луцьк','Луцьк','Луцьк','Ковель','Володимир','Рівне','Рівне','Львів','Львів','Київ',
              'Київ','Київ','Житомир','Тернопіль','Хмельницький','Вінниця','Одеса','Дніпро','Харків','Ужгород'])[1 + floor(random() * 20)::int],
       TIMESTAMP '2023-11-16 08:00' + random() * (TIMESTAMP '2026-11-15 20:00' - TIMESTAMP '2023-11-16 08:00')
FROM generate_series(1, 50000) AS g;

-- ---------------------------------------------------------------------
-- 2. Авто: 150 000, куплені на аукціонах за останні 3 роки
-- ---------------------------------------------------------------------
INSERT INTO cars (vin, make, model, model_year, fuel_type, engine_volume, battery_kwh,
                  mileage_mi, damage, yard_id, lot_number, purchase_price_usd, auction_fee_usd, purchase_date)
SELECT 'GEN' || lpad(g::text, 14, '0'),
       split_part(m.spec, '|', 1),
       split_part(m.spec, '|', 2),
       2012 + floor(random() * (EXTRACT(YEAR FROM d.pdate) - 2011))::int,
       split_part(m.spec, '|', 3),
       CASE WHEN split_part(m.spec, '|', 3) <> 'electric' THEN split_part(m.spec, '|', 4)::numeric END,
       CASE WHEN split_part(m.spec, '|', 3) =  'electric' THEN split_part(m.spec, '|', 4)::numeric END,
       5000 + floor(random() * 140000)::int,
       (ARRAY['Front End','Rear End','Side','Hail','Water/Flood','Minor Dent','Mechanical',NULL])[1 + floor(random() * 8)::int],
       1 + floor(random() * 12)::int,
       'G' || g,
       round((3000 + random() * 27000)::numeric, -1),
       round((400 + random() * 1100)::numeric, 0),
       d.pdate
FROM generate_series(1, 150000) AS g
CROSS JOIN LATERAL (
    SELECT (ARRAY['Toyota|Camry|hybrid|2.5','Toyota|RAV4|petrol|2.5','Honda|Accord|petrol|1.5','Honda|CR-V|petrol|1.5',
                  'Ford|Escape|petrol|1.5','Ford|Fusion|hybrid|2.0','Chevrolet|Malibu|petrol|1.5','Nissan|Rogue|petrol|2.5',
                  'Hyundai|Tucson|petrol|2.0','Kia|Sportage|petrol|2.4','Volkswagen|Jetta|petrol|1.4','Volkswagen|Passat|diesel|2.0',
                  'Audi|Q5|petrol|2.0','BMW|X3|petrol|2.0','BMW|530e|hybrid|2.0','Mercedes-Benz|GLC|petrol|2.0',
                  'Jeep|Cherokee|petrol|2.4','Mazda|CX-5|petrol|2.5','Subaru|Outback|petrol|2.5','Tesla|Model 3|electric|75',
                  'Tesla|Model Y|electric|75','Nissan|Leaf|electric|40','Chevrolet|Bolt|electric|66','Ford|Mustang Mach-E|electric|88'])
           [1 + floor(random() * 24)::int] AS spec
    WHERE g > 0
) AS m
CROSS JOIN LATERAL (
    SELECT DATE '2023-11-16' + floor(random() * (DATE '2026-11-15' - DATE '2023-11-16'))::int AS pdate
    WHERE g > 0
) AS d;

-- ---------------------------------------------------------------------
-- 3. Замовлення на згенеровані авто. Статус залежить від давності купівлі:
--    до 15 днів - bought, до 45 - in_transit, до 55 - in_port, до 65 - customs,
--    старші - delivered
-- ---------------------------------------------------------------------
CREATE TEMP TABLE gen_cars AS
SELECT car_id, purchase_date, purchase_price_usd + auction_fee_usd AS car_cost,
       make || ' ' || model AS wanted
FROM cars WHERE vin LIKE 'GEN%';

CREATE TEMP TABLE gen_clients AS
SELECT row_number() OVER (ORDER BY client_id) AS rn, client_id, city
FROM clients WHERE email LIKE '%@gen.example.com';

INSERT INTO orders (client_id, manager_id, car_id, order_date, wanted_car, budget_usd,
                    destination_city, service_fee_usd, status, created_at, updated_at)
SELECT cl.client_id,
       1 + floor(random() * 10)::int,
       c.car_id,
       c.purchase_date - (1 + floor(random() * 20)::int),
       c.wanted,
       round((c.car_cost * (1.2 + random() * 0.4))::numeric, -2),
       cl.city,
       600,
       CASE WHEN CURRENT_DATE - c.purchase_date < 15 THEN 'bought'
            WHEN CURRENT_DATE - c.purchase_date < 45 THEN 'in_transit'
            WHEN CURRENT_DATE - c.purchase_date < 55 THEN 'in_port'
            WHEN CURRENT_DATE - c.purchase_date < 65 THEN 'customs'
            ELSE 'delivered' END,
       c.purchase_date - (1 + floor(random() * 20)::int),
       c.purchase_date
FROM (SELECT gc.*, 1 + floor(random() * 50000)::int AS rn FROM gen_cars gc) AS c
JOIN gen_clients cl ON cl.rn = c.rn;

-- Замовлення без авто: 8 000 нових (останні 60 днів) і 22 000 скасованих
INSERT INTO orders (client_id, manager_id, order_date, wanted_car, budget_usd,
                    destination_city, service_fee_usd, status, created_at, updated_at)
SELECT cl.client_id,
       1 + floor(random() * 10)::int,
       x.odate,
       (ARRAY['Toyota Camry','Honda CR-V','Tesla Model 3','Ford Escape','BMW X3','Kia Sportage'])[1 + floor(random() * 6)::int],
       round((8000 + random() * 30000)::numeric, -2),
       cl.city,
       600,
       x.status,
       x.odate, x.odate
FROM (
    SELECT g,
           CASE WHEN g <= 8000 THEN 'new' ELSE 'cancelled' END AS status,
           CASE WHEN g <= 8000 THEN CURRENT_DATE - floor(random() * 60)::int
                ELSE DATE '2023-11-16' + floor(random() * 1060)::int END AS odate,
           1 + floor(random() * 50000)::int AS rn
    FROM generate_series(1, 30000) AS g
) AS x
JOIN gen_clients cl ON cl.rn = x.rn;

-- ---------------------------------------------------------------------
-- 4. Морська доставка для відправлених авто
-- ---------------------------------------------------------------------
INSERT INTO shipments (order_id, carrier_id, container_number, port_from, port_to,
                       departure_date, arrival_date, shipping_cost_usd)
SELECT o.order_id,
       s.carrier_id,
       'GENU' || lpad(o.order_id::text, 7, '0'),
       (ARRAY['Newark','Savannah','Houston','Los Angeles','Miami'])[1 + floor(random() * 5)::int],
       (ARRAY['Одеса','Одеса','Клайпеда','Клайпеда','Клайпеда','Гдиня','Гдиня','Бремергафен','Констанца'])[1 + floor(random() * 9)::int],
       c.purchase_date + 10,
       CASE WHEN o.status <> 'in_transit' THEN c.purchase_date + 10 + cr.transit_days_avg - 3 + floor(random() * 6)::int END,
       round((1100 + random() * 900)::numeric, -1)
FROM orders o
JOIN cars c ON c.car_id = o.car_id
CROSS JOIN LATERAL (SELECT 1 + floor(random() * 10)::int AS carrier_id WHERE o.order_id > 0) AS s
JOIN carriers cr ON cr.carrier_id = s.carrier_id
WHERE c.vin LIKE 'GEN%' AND o.status IN ('in_transit', 'in_port', 'customs', 'delivered');

-- Дата прибуття не може бути в майбутньому: такі авто ще в дорозі
UPDATE shipments s SET arrival_date = NULL
FROM orders o
WHERE o.order_id = s.order_id AND s.arrival_date > CURRENT_DATE AND s.container_number LIKE 'GENU%';
UPDATE orders o SET status = 'in_transit'
FROM shipments s
WHERE s.order_id = o.order_id AND s.arrival_date IS NULL AND o.status <> 'in_transit'
  AND s.container_number LIKE 'GENU%';

-- ---------------------------------------------------------------------
-- 5. Митні декларації (спрощений розрахунок) для розмитнених авто
-- ---------------------------------------------------------------------
INSERT INTO customs_declarations (order_id, customs_value_usd, duty_usd, excise_usd, vat_usd,
                                  eur_usd_rate, declared_at, cleared_at)
SELECT o.order_id, v.cv, round(v.cv * 0.10, 2), v.ex, round((v.cv * 1.10 + v.ex) * 0.20, 2),
       1.16, s.arrival_date + 2,
       CASE WHEN o.status = 'delivered' THEN s.arrival_date + 5 END
FROM orders o
JOIN cars c      ON c.car_id = o.car_id
JOIN shipments s ON s.order_id = o.order_id
CROSS JOIN LATERAL (
    SELECT c.purchase_price_usd + c.auction_fee_usd + 1000 AS cv,
           round(CASE WHEN c.fuel_type = 'electric' THEN c.battery_kwh * 1.16
                      ELSE c.engine_volume * 75 * 1.16 * LEAST(15, GREATEST(1, EXTRACT(YEAR FROM c.purchase_date) - c.model_year)) END, 2) AS ex
) AS v
WHERE c.vin LIKE 'GEN%' AND o.status IN ('customs', 'delivered');

-- ---------------------------------------------------------------------
-- 6. Платежі: завдаток, авто, доставка, митниця
-- ---------------------------------------------------------------------
INSERT INTO payments (order_id, amount_usd, payment_date, method, purpose)
SELECT o.order_id, 1000, o.order_date,
       (ARRAY['cash','card','bank_transfer'])[1 + floor(random() * 3)::int], 'deposit'
FROM orders o
JOIN gen_clients cl ON cl.client_id = o.client_id
WHERE o.status <> 'cancelled';

INSERT INTO payments (order_id, amount_usd, payment_date, method, purpose)
SELECT o.order_id, c.car_cost - 1000, c.purchase_date, 'bank_transfer', 'car'
FROM orders o JOIN gen_cars c ON c.car_id = o.car_id;

INSERT INTO payments (order_id, amount_usd, payment_date, method, purpose)
SELECT s.order_id, s.shipping_cost_usd, s.departure_date,
       (ARRAY['card','bank_transfer'])[1 + floor(random() * 2)::int], 'shipping'
FROM shipments s WHERE s.container_number LIKE 'GENU%';

INSERT INTO payments (order_id, amount_usd, payment_date, method, purpose)
SELECT cd.order_id, cd.duty_usd + cd.excise_usd + cd.vat_usd, cd.declared_at, 'bank_transfer', 'customs'
FROM customs_declarations cd
JOIN orders o ON o.order_id = cd.order_id
JOIN gen_cars c ON c.car_id = o.car_id;

SET session_replication_role = origin;

-- Оновлення статистики і карти видимості
VACUUM ANALYZE;

-- Підсумок
SELECT 'clients' AS table_name, COUNT(*) AS row_count FROM clients
UNION ALL SELECT 'cars', COUNT(*) FROM cars
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'shipments', COUNT(*) FROM shipments
UNION ALL SELECT 'customs_declarations', COUNT(*) FROM customs_declarations
UNION ALL SELECT 'payments', COUNT(*) FROM payments
ORDER BY row_count DESC;

SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
