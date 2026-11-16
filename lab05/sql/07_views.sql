-- =====================================================================
-- 07_views.sql: два представлення для часто використовуваних запитів
-- =====================================================================

-- 1. Активні замовлення (ще не видані і не скасовані): робочий список менеджера
CREATE VIEW v_active_orders AS
SELECT o.order_id,
       o.order_date,
       o.status,
       o.manager_id,
       m.last_name || ' ' || m.first_name                AS manager,
       cl.last_name || ' ' || cl.first_name              AS client,
       cl.city,
       c.make || ' ' || c.model || ' ' || c.model_year   AS car,
       o.budget_usd,
       CURRENT_DATE - o.order_date                       AS days_in_work
FROM orders o
JOIN clients  cl ON cl.client_id = o.client_id
JOIN managers m  ON m.manager_id = o.manager_id
LEFT JOIN cars c ON c.car_id     = o.car_id
WHERE o.status NOT IN ('delivered', 'cancelled');

-- 2. Статистика клієнта: замовлення за статусами, сплачено, останнє замовлення.
--    Платежі підсумовуються через LATERAL для кожного замовлення окремо,
--    тому рядки не множаться, а для одного клієнта читаються лише його платежі
CREATE VIEW v_client_statistics AS
SELECT cl.client_id,
       cl.last_name || ' ' || cl.first_name                                          AS client,
       cl.city,
       COUNT(o.order_id)                                                             AS orders_total,
       COUNT(o.order_id) FILTER (WHERE o.status = 'delivered')                       AS delivered,
       COUNT(o.order_id) FILTER (WHERE o.status NOT IN ('delivered', 'cancelled'))   AS active,
       COALESCE(SUM(p.paid_usd), 0)                                                  AS paid_usd,
       MAX(o.order_date)                                                             AS last_order_date
FROM clients cl
LEFT JOIN orders o ON o.client_id = cl.client_id
LEFT JOIN LATERAL (
    SELECT SUM(amount_usd) AS paid_usd FROM payments WHERE payments.order_id = o.order_id
) p ON TRUE
GROUP BY cl.client_id;

-- Перевірка роботи представлень
\timing on
SELECT order_id, order_date, status, manager, client, car, days_in_work
FROM v_active_orders
WHERE manager_id = 1
ORDER BY days_in_work DESC
LIMIT 6;

SELECT status, COUNT(*) AS orders, ROUND(AVG(days_in_work)) AS avg_days
FROM v_active_orders
GROUP BY status
ORDER BY avg_days;

SELECT * FROM v_client_statistics WHERE client_id IN (1, 3, 11);

SELECT client_id, client, city, orders_total, delivered, paid_usd, last_order_date
FROM v_client_statistics
WHERE city = 'Луцьк'
ORDER BY paid_usd DESC
LIMIT 5;
\timing off
