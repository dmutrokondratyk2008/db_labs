-- 09_report_viewer_test.sql: виконується під користувачем report_viewer
SELECT current_user, session_user, current_database();

-- Дозволено
SELECT client_id, last_name, first_name, city FROM clients ORDER BY client_id LIMIT 3;
SELECT order_id, status, order_date FROM orders WHERE order_id = 1;
SELECT order_id, status, client, days_in_work FROM v_active_orders ORDER BY days_in_work DESC LIMIT 3;

-- Заборонено
SELECT phone FROM clients LIMIT 1;
SELECT * FROM orders LIMIT 1;
SELECT COUNT(*) FROM payments;
SELECT COUNT(*) FROM audit_log;
INSERT INTO cars (vin) VALUES ('1HGCM82633A004352');
UPDATE shipments SET arrival_date = CURRENT_DATE WHERE shipment_id = 1;
DELETE FROM orders WHERE order_id = 1;
CREATE TABLE my_table (id INT);
