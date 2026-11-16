-- 17_test_reader.sql: перевірка звичайного користувача (report_viewer, член car_reader)
SELECT session_user, pg_has_role('car_reader', 'MEMBER') AS is_reader,
       pg_has_role('car_moderator', 'MEMBER') AS is_moderator;
SELECT order_id, status, destination_city FROM orders ORDER BY order_id LIMIT 3;
SELECT month, revenue_usd FROM mv_monthly_revenue ORDER BY month DESC LIMIT 2;
SELECT client_id, last_name, loyalty_level FROM clients WHERE client_id = 1;
SELECT total_paid_usd FROM clients WHERE client_id = 1;
SELECT COUNT(*) FROM payments;
UPDATE cars SET mileage_mi = 0 WHERE car_id = 1;
