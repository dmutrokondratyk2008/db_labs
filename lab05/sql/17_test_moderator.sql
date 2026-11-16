-- 17_test_moderator.sql: перевірка прав модератора (виконується під hordiichuk)
SELECT session_user, current_manager_id() AS my_manager_id,
       pg_has_role('car_reader', 'MEMBER') AS is_reader;

-- Бачить усі замовлення (успадковано від car_reader)
SELECT manager_id, COUNT(*) AS orders FROM orders WHERE manager_id IN (1, 2) GROUP BY manager_id;

-- Своє замовлення змінює, чуже - ні (RLS відфільтровує рядок)
UPDATE orders SET wanted_car = 'Toyota Camry 2023'
WHERE order_id = (SELECT MIN(order_id) FROM orders WHERE manager_id = 1 AND status = 'new');
UPDATE orders SET wanted_car = 'Toyota Camry 2023'
WHERE order_id = (SELECT MIN(order_id) FROM orders WHERE manager_id = 2 AND status = 'new');

-- Створити замовлення від імені іншого менеджера не можна
INSERT INTO orders (client_id, manager_id, wanted_car, budget_usd, destination_city)
VALUES (1, 2, 'Kia Sportage', 20000, 'Луцьк');

-- Контакти клієнта змінює, суму оплат - ні
UPDATE clients SET city = 'Ковель' WHERE client_id = 1;
UPDATE clients SET total_paid_usd = 0 WHERE client_id = 1;

-- Платіж додає (з усім каскадом тригерів), видалити не може
INSERT INTO payments (order_id, amount_usd, method, purpose)
SELECT MIN(order_id), 500, 'cash', 'deposit' FROM orders WHERE manager_id = 1 AND status = 'new'
RETURNING payment_id, order_id, amount_usd;
DELETE FROM payments WHERE payment_id = 1;

-- Журнали аудиту й облікові записи недоступні
SELECT COUNT(*) FROM audit_log;
SELECT username, password_hash FROM users LIMIT 1;
