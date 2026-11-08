-- Процедура 1. register_car_purchase: купівля авто для нового замовлення 16
SELECT order_id, wanted_car, budget_usd, status, car_id FROM orders WHERE order_id = 16;

SELECT register_car_purchase(16, '2hgfc2f59jh512345', 'honda', 'Civic', 2018, 'petrol', 2.0, NULL,
       48200, 'Передня частина', 2, '63120044', 8600, 640, '2026-11-05') AS car_id;

SELECT o.order_id, o.status, c.car_id, c.vin, c.make, c.model, c.purchase_price_usd
FROM orders o JOIN cars c USING (car_id) WHERE o.order_id = 16;

-- Помилка: замовлення 16 уже не нове
SELECT register_car_purchase(16, '2HGFC2F59JH599999', 'Honda', 'Civic', 2019, 'petrol', 2.0, NULL,
       30000, NULL, 2, '63120099', 9000, 600, '2026-11-06');

-- Помилка: VIN уже є в базі (обробка unique_violation у блоці EXCEPTION)
SELECT register_car_purchase(17, '5YJ3E1EA7MF034567', 'Tesla', 'Model Y', 2022, 'electric', NULL, 75,
       30000, NULL, 5, '61999999', 21000, 900, '2026-11-06');
