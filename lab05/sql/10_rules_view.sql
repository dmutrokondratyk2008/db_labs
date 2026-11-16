-- =====================================================================
-- 10_rules_view.sql: складне представлення з оновленням через RULES
-- v_order_contacts поєднує три таблиці (orders, clients, managers), тому
-- PostgreSQL не може оновлювати його автоматично.
-- =====================================================================

CREATE VIEW v_order_contacts AS
SELECT o.order_id,
       o.status,
       o.order_date,
       o.destination_city,
       o.client_id,
       cl.last_name || ' ' || cl.first_name AS client,
       cl.phone,
       cl.email,
       m.last_name || ' ' || m.first_name   AS manager
FROM orders o
JOIN clients  cl ON cl.client_id = o.client_id
JOIN managers m  ON m.manager_id = o.manager_id;

-- Без правил оновлення неможливе
UPDATE v_order_contacts SET phone = '+380631115007' WHERE order_id = 12;

-- Правило UPDATE: контакти змінюються в clients, місто доставки в orders.
-- Інші стовпці (статус, менеджер, ПІБ) через представлення не змінюються.
CREATE RULE r_order_contacts_update AS
ON UPDATE TO v_order_contacts
DO INSTEAD (
    UPDATE clients
       SET phone = NEW.phone,
           email = NEW.email
     WHERE client_id = OLD.client_id;
    UPDATE orders
       SET destination_city = NEW.destination_city
     WHERE order_id = OLD.order_id;
);

-- Правило DELETE: "м'яке" видалення - замовлення не видаляється, а скасовується,
-- і лише якщо авто ще не відправлене (статус new або bought)
CREATE RULE r_order_contacts_delete AS
ON DELETE TO v_order_contacts
DO INSTEAD
    UPDATE orders
       SET status = 'cancelled'
     WHERE order_id = OLD.order_id
       AND status IN ('new', 'bought');

-- Вставка через представлення не має сенсу: забороняємо явно
CREATE RULE r_order_contacts_insert AS
ON INSERT TO v_order_contacts
DO INSTEAD NOTHING;

-- Перевірка
SELECT order_id, status, destination_city, client, phone, email
FROM v_order_contacts WHERE order_id IN (12, 15);

UPDATE v_order_contacts
   SET phone = '+380631115007', email = 'm.romaniuk@ukr.net', destination_city = 'Ковель'
 WHERE order_id = 12;

DELETE FROM v_order_contacts WHERE order_id IN (12, 15);

INSERT INTO v_order_contacts (order_id, client) VALUES (999999, 'Тест');

SELECT order_id, status, destination_city, client, phone, email
FROM v_order_contacts WHERE order_id IN (12, 15);

-- Зміни потрапили в базові таблиці
SELECT client_id, phone, email FROM clients WHERE client_id = (SELECT client_id FROM orders WHERE order_id = 12);
SELECT order_id, status, destination_city FROM orders WHERE order_id IN (12, 15);

SELECT rulename,
       CASE ev_type WHEN '1' THEN 'SELECT' WHEN '2' THEN 'UPDATE'
                    WHEN '3' THEN 'INSERT' WHEN '4' THEN 'DELETE' END AS event,
       is_instead
FROM pg_rewrite
WHERE ev_class = 'v_order_contacts'::regclass
ORDER BY ev_type;
