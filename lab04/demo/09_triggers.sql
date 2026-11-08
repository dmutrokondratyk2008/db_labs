-- Тригер 3 (trg_shipments_sync_status): оформлення доставки змінює статус замовлення
SELECT order_id, status, updated_at FROM orders WHERE order_id = 14;
INSERT INTO shipments (order_id, carrier_id, container_number, port_from, port_to, departure_date, shipping_cost_usd)
VALUES (14, 4, 'HLXU3520147', 'Savannah, GA', 'Клайпеда', '2026-11-06', 1500);
-- Тригер 2 (trg_orders_updated_at) оновив updated_at
SELECT order_id, status, updated_at FROM orders WHERE order_id = 14;

-- Контейнер замовлення 12 прибув у порт
UPDATE shipments SET arrival_date = '2026-11-07' WHERE order_id = 12;
SELECT order_id, status FROM orders WHERE order_id = 12;

-- Тригер 1 (trg_orders_status_history): журнал змін статусу
SELECT history_id, order_id, old_status, new_status, changed_at
FROM order_status_history WHERE order_id IN (12, 14) ORDER BY history_id;

-- Тригер 4 (trg_cars_validate): нормалізація марки і перевірка року
UPDATE cars SET make = '  mazda ' WHERE car_id = 12 RETURNING car_id, make, model;
UPDATE cars SET model_year = 2031 WHERE car_id = 2;

-- Тригер 5 (trg_payments_check): перевірка платежів
INSERT INTO payments (order_id, amount_usd, method, purpose) VALUES (18, 500, 'cash', 'deposit');
INSERT INTO payments (order_id, amount_usd, method, purpose) VALUES (20, 9000, 'card', 'car');
