-- 17_test_admin.sql: перевірка адміністратора (dba_kondratiuk, член car_admin)
SELECT session_user, pg_has_role('car_moderator', 'MEMBER') AS is_moderator,
       pg_has_role('car_reader', 'MEMBER') AS is_reader;
SELECT COUNT(*) AS audit_records FROM audit_log;
-- адміністратор змінює будь-яке замовлення (політика p_orders_admin)
UPDATE orders SET wanted_car = 'Toyota Camry 2023 (перевірено)'
WHERE order_id = (SELECT MIN(order_id) FROM orders WHERE manager_id = 2 AND status = 'new');
-- може керувати ролями (CREATEROLE)
CREATE ROLE temp_intern LOGIN PASSWORD 'Intern#2026' IN ROLE car_reader;
DROP ROLE temp_intern;
-- але не є суперкористувачем: змінювати конфігурацію сервера не може
ALTER SYSTEM SET work_mem = '64MB';
