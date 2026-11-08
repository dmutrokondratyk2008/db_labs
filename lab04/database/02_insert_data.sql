-- =====================================================================
-- 02_insert_data.sql: тестові дані (не менше 10 записів у кожній таблиці)
-- =====================================================================

INSERT INTO clients (first_name, last_name, phone, email, city, created_at) VALUES
('Олександр', 'Бондаренко', '+380671234501', 'o.bondarenko@ukr.net',   'Луцьк',     '2026-02-18 10:15'),
('Ірина',     'Мельничук',  '+380501234502', 'iryna.m@gmail.com',      'Рівне',     '2026-02-25 12:40'),
('Андрій',    'Ковальчук',  '+380931234503', 'kovalchuk.a@gmail.com',  'Київ',      '2026-03-03 09:05'),
('Наталія',   'Савчук',     '+380661234504', NULL,                     'Львів',     '2026-03-10 16:20'),
('Віталій',   'Гнатюк',     '+380971234505', 'gnatiuk.v@ukr.net',      'Ковель',    '2026-03-18 11:30'),
('Сергій',    'Ткачук',     '+380681234506', 'tkachuk.serhii@gmail.com','Тернопіль', '2026-03-25 14:10'),
('Оксана',    'Поліщук',    '+380991234507', 'o.polishchuk@meta.ua',   'Луцьк',     '2026-04-06 10:00'),
('Дмитро',    'Кравчук',    '+380631234508', 'd.kravchuk@gmail.com',   'Київ',      '2026-04-21 13:45'),
('Юлія',      'Олійник',    '+380951234509', 'yulia.oliinyk@gmail.com','Житомир',   '2026-05-03 15:25'),
('Роман',     'Шевчук',     '+380731234510', 'roman.shevchuk@ukr.net', 'Рівне',     '2026-05-20 09:50'),
('Тетяна',    'Лисенко',    '+380671234511', 't.lysenko@gmail.com',    'Луцьк',     '2026-08-18 17:05'),
('Максим',    'Романюк',    '+380501234512', 'max.romaniuk@gmail.com', 'Володимир', '2026-09-08 11:15');

INSERT INTO managers (first_name, last_name, phone, email, hire_date, commission_pct, is_active) VALUES
('Василь',   'Гордійчук', '+380672000001', 'v.hordiichuk@usacars.ua', '2023-02-01', 12.00, TRUE),
('Світлана', 'Мазурець',  '+380672000002', 's.mazurets@usacars.ua',   '2023-06-15', 10.00, TRUE),
('Богдан',   'Павлюк',    '+380672000003', 'b.pavliuk@usacars.ua',    '2023-09-01', 10.00, TRUE),
('Ольга',    'Кирилюк',   '+380672000004', 'o.kyryliuk@usacars.ua',   '2024-01-10', 10.00, TRUE),
('Тарас',    'Юхимчук',   '+380672000005', 't.yukhymchuk@usacars.ua', '2024-03-04', 8.00,  TRUE),
('Марина',   'Дмитрук',   '+380672000006', 'm.dmytruk@usacars.ua',    '2024-07-22', 8.00,  TRUE),
('Ігор',     'Сидорук',   '+380672000007', 'i.sydoruk@usacars.ua',    '2025-01-13', 8.00,  TRUE),
('Анна',     'Климчук',   '+380672000008', 'a.klymchuk@usacars.ua',   '2025-04-01', 7.50,  TRUE),
('Павло',    'Остапчук',  '+380672000009', 'p.ostapchuk@usacars.ua',  '2025-09-15', 7.50,  TRUE),
('Леся',     'Демчук',    '+380672000010', 'l.demchuk@usacars.ua',    '2026-02-02', 7.00,  TRUE),
('Микола',   'Вознюк',    '+380672000011', 'm.vozniuk@usacars.ua',    '2022-05-16', 10.00, FALSE);

INSERT INTO auction_yards (platform, yard_name, city, state) VALUES
('Copart',  'Trenton',       'Trenton',      'NJ'),
('Copart',  'Philadelphia',  'Philadelphia', 'PA'),
('Copart',  'Atlanta East',  'Atlanta',      'GA'),
('Copart',  'Houston',       'Houston',      'TX'),
('Copart',  'Los Angeles',   'Los Angeles',  'CA'),
('IAAI',    'Newburgh',      'Newburgh',     'NY'),
('IAAI',    'Savannah',      'Savannah',     'GA'),
('IAAI',    'Dallas',        'Dallas',       'TX'),
('IAAI',    'Chicago-North', 'Chicago',      'IL'),
('IAAI',    'Miami-North',   'Miami',        'FL'),
('Manheim', 'New Jersey',    'Bordentown',   'NJ'),
('Manheim', 'Orlando',       'Orlando',      'FL');

INSERT INTO carriers (name, country, transit_days_avg, rating) VALUES
('Maersk Line',                 'Данія',      24, 4.6),
('MSC',                         'Швейцарія',  25, 4.3),
('CMA CGM',                     'Франція',    28, 4.4),
('Hapag-Lloyd',                 'Німеччина',  23, 4.7),
('Ocean Network Express',       'Японія',     29, 4.1),
('Evergreen Line',              'Тайвань',    32, 4.0),
('ZIM',                         'Ізраїль',    34, 3.9),
('Grimaldi Lines',              'Італія',     36, 4.2),
('Turkon Line',                 'Туреччина',  38, 3.8),
('Atlantic Container Line',     'США',        21, 4.5);

INSERT INTO services (name, description, base_price_usd) VALUES
('Брокерські послуги',      'Підготовка документів і митне оформлення авто',        350.00),
('Сертифікація',            'Сертифікат відповідності для першої реєстрації',      250.00),
('Реєстрація в ТСЦ',        'Постановка на облік і отримання номерних знаків',      150.00),
('Кузовний ремонт',         'Відновлення кузова після аукціонних пошкоджень',      1200.00),
('Ремонт ходової',          'Заміна деталей підвіски та рульового керування',       600.00),
('Комп''ютерна діагностика','Діагностика електроніки та двигуна',                    80.00),
('Доставка автовозом',      'Доставка авто з порту до міста клієнта',               450.00),
('Страхування вантажу',     'Страхування авто на час морського перевезення',        200.00),
('Хімчистка салону',        'Глибоке чищення салону після транспортування',         120.00),
('Адаптація світла під ЄС', 'Переобладнання фар і поворотників під норми ЄС',       180.00);

INSERT INTO cars (vin, make, model, model_year, fuel_type, engine_volume, battery_kwh, mileage_mi,
                  damage, yard_id, lot_number, purchase_price_usd, auction_fee_usd, purchase_date) VALUES
('2T3W1RFV8KW012345', 'Toyota',     'RAV4',           2019, 'petrol',   2.5, NULL, 41200, 'Передня частина',       1,  '58213467', 9800.00,  750.00, '2026-03-04'),
('1FMCU9GD3LUA23456', 'Ford',       'Escape',         2020, 'petrol',   1.5, NULL, 38500, 'Задня частина',         6,  '35721984', 7200.00,  690.00, '2026-03-11'),
('5YJ3E1EA7MF034567', 'Tesla',      'Model 3',        2021, 'electric', NULL, 75.0, 52000, 'Бічний удар',          5,  '61034528', 14500.00, 820.00, '2026-03-18'),
('2HKRW2H85JH045678', 'Honda',      'CR-V',           2018, 'petrol',   1.5, NULL, 67300, 'Град',                  7,  '35890412', 8900.00,  720.00, '2026-03-25'),
('3VV2B7AX5KM056789', 'Volkswagen', 'Tiguan',         2019, 'petrol',   2.0, NULL, 55800, 'Передня частина',       2,  '59102376', 8100.00,  700.00, '2026-04-02'),
('5UXKR2C34H0067890', 'BMW',        'X5',             2017, 'diesel',   3.0, NULL, 88400, 'Затоплення',            10, '36011245', 11300.00, 860.00, '2026-04-09'),
('5NMJB3AE1MH078901', 'Hyundai',    'Tucson',         2021, 'petrol',   2.0, NULL, 29700, 'Задня частина',         3,  '60451893', 9600.00,  740.00, '2026-04-21'),
('WA1BNAFY6K2089012', 'Audi',       'Q5',             2019, 'petrol',   2.0, NULL, 47100, 'Передня частина',       8,  '36257731', 13200.00, 840.00, '2026-05-06'),
('4T1B21HK2LU090123', 'Toyota',     'Camry Hybrid',   2020, 'hybrid',   2.5, NULL, 61800, 'Бічний удар',           4,  '61578204', 10400.00, 760.00, '2026-05-19'),
('JN8AT2MV4LW101234', 'Nissan',     'Rogue',          2020, 'petrol',   2.5, NULL, 44500, 'Механічні пошкодження', 9,  '36489015', 7600.00,  690.00, '2026-06-03'),
('1G1FY6S05N4112345', 'Chevrolet',  'Bolt EV',        2022, 'electric', NULL, 65.0, 18900, 'Передня частина',      11, 'M2208713', 9900.00,  650.00, '2026-09-02'),
('JM3KFBDM5M0123456', 'Mazda',      'CX-5',           2021, 'petrol',   2.5, NULL, 33600, 'Град',                  12, 'M1904452', 12100.00, 690.00, '2026-09-24'),
('1C4RJFAG8JC134567', 'Jeep',       'Grand Cherokee', 2018, 'petrol',   3.6, NULL, 79200, 'Задня частина',         1,  '62034417', 9300.00,  780.00, '2026-10-02'),
('4S4BSANC2K3145678', 'Subaru',     'Outback',        2019, 'petrol',   2.5, NULL, 58900, 'Передня частина',       7,  '37102258', 8400.00,  710.00, '2026-10-14'),
('KNDPM3AC7N7156789', 'Kia',        'Sportage',       2022, 'petrol',   2.4, NULL, 21400, 'Бічний удар',           3,  '62811539', 11800.00, 760.00, '2026-10-22');

INSERT INTO orders (client_id, manager_id, car_id, order_date, wanted_car, budget_usd,
                    destination_city, service_fee_usd, status) VALUES
(1,  1,  1,    '2026-02-20', 'Toyota RAV4 2018-2020',            14000, 'Луцьк',     600, 'delivered'),
(2,  2,  2,    '2026-02-27', 'Ford Escape 2019-2021',            11000, 'Рівне',     550, 'delivered'),
(3,  3,  3,    '2026-03-05', 'Tesla Model 3 2020-2022',          22000, 'Київ',      800, 'delivered'),
(4,  1,  4,    '2026-03-12', 'Honda CR-V 2017-2019',             13500, 'Львів',     600, 'delivered'),
(5,  4,  5,    '2026-03-20', 'Volkswagen Tiguan 2018-2020',      13000, 'Ковель',    600, 'delivered'),
(6,  5,  6,    '2026-03-27', 'BMW X5 дизель 2016-2018',          19000, 'Тернопіль', 900, 'delivered'),
(7,  2,  7,    '2026-04-08', 'Hyundai Tucson 2020-2022',         14500, 'Луцьк',     600, 'delivered'),
(8,  6,  8,    '2026-04-23', 'Audi Q5 2018-2020',                20000, 'Київ',      850, 'customs'),
(9,  3,  9,    '2026-05-05', 'Toyota Camry Hybrid 2019-2021',    16000, 'Житомир',   650, 'customs'),
(10, 7,  10,   '2026-05-22', 'Nissan Rogue 2019-2021',           12500, 'Рівне',     550, 'customs'),
(11, 4,  11,   '2026-08-20', 'Chevrolet Bolt 2021-2023',         16000, 'Луцьк',     600, 'in_port'),
(12, 8,  12,   '2026-09-10', 'Mazda CX-5 2020-2022',             17500, 'Володимир', 600, 'in_transit'),
(1,  1,  13,   '2026-09-20', 'Jeep Grand Cherokee 2017-2019',    15000, 'Луцьк',     700, 'in_transit'),
(3,  9,  14,   '2026-10-01', 'Subaru Outback 2018-2020',         13000, 'Київ',      600, 'bought'),
(5,  10, 15,   '2026-10-09', 'Kia Sportage 2021-2023',           17000, 'Ковель',    600, 'bought'),
(2,  6,  NULL, '2026-10-25', 'Honda Civic 2018-2020',            9000,  'Рівне',     500, 'new'),
(9,  7,  NULL, '2026-11-02', 'Tesla Model Y 2021-2022',          25000, 'Житомир',   800, 'new'),
(4,  5,  NULL, '2026-07-10', 'Mazda 3 2019-2020',                10000, 'Львів',     500, 'cancelled');

INSERT INTO shipments (order_id, carrier_id, container_number, port_from, port_to,
                       departure_date, arrival_date, shipping_cost_usd) VALUES
(1,  1,  'MSKU7023451', 'Newark, NJ',       'Клайпеда',    '2026-03-16', '2026-04-09', 1450.00),
(2,  2,  'MSCU5183402', 'New York, NY',     'Клайпеда',    '2026-03-23', '2026-04-15', 1400.00),
(3,  3,  'CMAU4471209', 'Los Angeles, CA',  'Одеса',       '2026-04-02', '2026-05-14', 2350.00),
(4,  4,  'HLXU3390218', 'Savannah, GA',     'Бремергафен', '2026-04-06', '2026-05-02', 1500.00),
(5,  1,  'MSKU7099134', 'Newark, NJ',       'Гдиня',       '2026-04-14', '2026-05-06', 1450.00),
(6,  5,  'ONEU2258761', 'Miami, FL',        'Клайпеда',    '2026-04-22', '2026-05-20', 1650.00),
(7,  2,  'MSCU5291187', 'Savannah, GA',     'Одеса',       '2026-05-04', '2026-06-08', 1700.00),
(8,  6,  'EGHU8812054', 'Houston, TX',      'Клайпеда',    '2026-05-20', '2026-06-24', 1800.00),
(9,  7,  'ZIMU6630925', 'Houston, TX',      'Констанца',   '2026-06-01', '2026-07-06', 1750.00),
(10, 8,  'GRIU1048836', 'Baltimore, MD',    'Клайпеда',    '2026-06-16', '2026-07-22', 1900.00),
(11, 3,  'CMAU4502277', 'Newark, NJ',       'Клайпеда',    '2026-09-29', '2026-10-30', 1500.00),
(12, 4,  'HLXU3415590', 'Jacksonville, FL', 'Гдиня',       '2026-10-12', NULL,         1550.00),
(13, 9,  'TRKU9907316', 'Newark, NJ',       'Одеса',       '2026-10-20', NULL,         1600.00);

-- Митні декларації для замовлень 1-10.
-- Спрощений розрахунок для легкових авто (той самий, що й у функції calculate_customs):
--   митна вартість = ціна лоту + збір аукціону + доставка;
--   мито 10 %; акциз (EUR) = ставка x об'єм (л) x коефіцієнт віку (1..15),
--   ставка: бензин/гібрид 50 (до 3 л) або 100, дизель 75 (до 3,5 л) або 150,
--   електромобіль: 1 EUR за 1 кВт*год батареї; ПДВ 20 % від (вартість + мито + акциз).
WITH base AS (
    SELECT o.order_id,
           c.purchase_price_usd + c.auction_fee_usd + s.shipping_cost_usd AS customs_value,
           s.arrival_date + 3 AS declared_at,
           CASE WHEN o.order_id <= 7 THEN s.arrival_date + 7 END AS cleared_at,
           CASE c.fuel_type
               WHEN 'electric' THEN c.battery_kwh
               WHEN 'diesel' THEN (CASE WHEN c.engine_volume <= 3.5 THEN 75 ELSE 150 END) * c.engine_volume
                                  * GREATEST(1, LEAST(15, EXTRACT(YEAR FROM s.arrival_date)::INT - c.model_year - 1))
               ELSE (CASE WHEN c.engine_volume <= 3.0 THEN 50 ELSE 100 END) * c.engine_volume
                    * GREATEST(1, LEAST(15, EXTRACT(YEAR FROM s.arrival_date)::INT - c.model_year - 1))
           END AS excise_eur
    FROM orders o
    JOIN cars c      ON c.car_id = o.car_id
    JOIN shipments s ON s.order_id = o.order_id
    WHERE o.order_id <= 10
), calc AS (
    SELECT order_id, customs_value, declared_at, cleared_at,
           ROUND(customs_value * 0.10, 2)  AS duty,
           ROUND(excise_eur * 1.16, 2)     AS excise
    FROM base
)
INSERT INTO customs_declarations (order_id, customs_value_usd, duty_usd, excise_usd, vat_usd,
                                  eur_usd_rate, declared_at, cleared_at)
SELECT order_id, customs_value, duty, excise,
       ROUND((customs_value + duty + excise) * 0.20, 2), 1.16, declared_at, cleared_at
FROM calc;

INSERT INTO order_services (order_id, service_id, price_usd, added_at) VALUES
(1, 1, 350, '2026-04-10'), (1, 2, 250, '2026-04-12'), (1, 3, 150, '2026-04-18'), (1, 4, 1200, '2026-04-14'), (1, 7, 450, '2026-04-17'),
(2, 1, 350, '2026-04-16'), (2, 2, 250, '2026-04-18'), (2, 3, 150, '2026-04-24'), (2, 5, 500, '2026-04-20'),
(3, 1, 350, '2026-05-15'), (3, 3, 150, '2026-05-24'), (3, 4, 2100, '2026-05-19'), (3, 7, 550, '2026-05-22'),
(4, 1, 350, '2026-05-03'), (4, 2, 250, '2026-05-05'), (4, 3, 150, '2026-05-11'), (4, 10, 180, '2026-05-08'),
(5, 1, 350, '2026-05-07'), (5, 2, 250, '2026-05-09'), (5, 3, 150, '2026-05-15'), (5, 4, 900, '2026-05-11'),
(6, 1, 350, '2026-05-21'), (6, 2, 300, '2026-05-23'), (6, 3, 150, '2026-05-30'), (6, 5, 800, '2026-05-26'), (6, 6, 80, '2026-05-24'),
(7, 1, 350, '2026-06-09'), (7, 2, 250, '2026-06-11'), (7, 3, 150, '2026-06-17'), (7, 9, 120, '2026-06-15'),
(8, 1, 350, '2026-06-25'), (8, 8, 220, '2026-05-20'),
(9, 1, 350, '2026-07-07'),
(10, 1, 350, '2026-07-23'),
(11, 8, 200, '2026-09-29'), (12, 8, 200, '2026-10-12'), (13, 8, 200, '2026-10-20');

-- Платежі формуються за етапами замовлення:
-- завдаток, оплата авто, оплата доставки, оплата митних платежів, оплата послуг і комісії.
INSERT INTO payments (order_id, amount_usd, payment_date, method, purpose)
SELECT order_id, 1000, order_date + 1,
       (ARRAY['bank_transfer', 'card', 'cash'])[order_id % 3 + 1], 'deposit'
FROM orders
WHERE status <> 'cancelled' AND order_id <> 17;

INSERT INTO payments (order_id, amount_usd, payment_date, method, purpose)
SELECT o.order_id, c.purchase_price_usd + c.auction_fee_usd - 1000, c.purchase_date + 1,
       'bank_transfer', 'car'
FROM orders o JOIN cars c ON c.car_id = o.car_id;

INSERT INTO payments (order_id, amount_usd, payment_date, method, purpose)
SELECT order_id, shipping_cost_usd, departure_date - 2,
       (ARRAY['bank_transfer', 'card'])[order_id % 2 + 1], 'shipping'
FROM shipments;

INSERT INTO payments (order_id, amount_usd, payment_date, method, purpose)
SELECT order_id, duty_usd + excise_usd + vat_usd, declared_at, 'bank_transfer', 'customs'
FROM customs_declarations;

-- Замовлення 7 доставлене, але послуги ще не оплачені (приклад заборгованості)
INSERT INTO payments (order_id, amount_usd, payment_date, method, purpose)
SELECT o.order_id, SUM(os.price_usd) + o.service_fee_usd, MAX(cd.cleared_at) + 5,
       (ARRAY['card', 'cash'])[o.order_id % 2 + 1], 'services'
FROM orders o
JOIN order_services os       ON os.order_id = o.order_id
JOIN customs_declarations cd ON cd.order_id = o.order_id
WHERE o.order_id <= 6
GROUP BY o.order_id, o.service_fee_usd;
