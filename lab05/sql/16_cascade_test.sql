-- =====================================================================
-- 16_cascade_test.sql: перевірка каскаду на реальному замовленні.
-- Обирається замовлення на розмитненні, після оплати якого клієнт
-- переходить з рівня silver на gold.
-- =====================================================================
SELECT o.order_id, o.client_id
FROM orders o
JOIN clients c         ON c.client_id = o.client_id
JOIN v_order_finance f ON f.order_id  = o.order_id
WHERE o.status = 'customs' AND c.loyalty_level = 'silver'
  AND c.total_paid_usd + f.balance_usd >= 150000
ORDER BY o.order_id
LIMIT 1 \gset

SELECT COALESCE(MAX(log_id), 0) AS last_log FROM audit_log \gset

-- Стан до оплати
SELECT o.order_id, o.status, o.paid_usd, f.total_cost_usd, f.balance_usd,
       c.client_id, c.total_paid_usd, c.loyalty_level
FROM orders o JOIN clients c USING (client_id) JOIN v_order_finance f USING (order_id)
WHERE o.order_id = :order_id;

-- Спроба видати авто з боргом
UPDATE orders SET status = 'delivered' WHERE order_id = :order_id;

-- Клієнт сплачує залишок: один INSERT запускає весь ланцюжок
INSERT INTO payments (order_id, amount_usd, method, purpose)
SELECT :order_id, balance_usd, 'bank_transfer', 'services'
FROM v_order_finance WHERE order_id = :order_id
RETURNING payment_id, order_id, amount_usd;

-- Стан після оплати
SELECT o.order_id, o.status, o.paid_usd, f.total_cost_usd, f.balance_usd,
       c.client_id, c.total_paid_usd, c.loyalty_level
FROM orders o JOIN clients c USING (client_id) JOIN v_order_finance f USING (order_id)
WHERE o.order_id = :order_id;

SELECT notification_id, client_id, message FROM client_notifications ORDER BY notification_id DESC LIMIT 1;

-- Ланцюжок у журналі: глибина вкладеності тригерів
SELECT log_id, trigger_depth AS depth, table_name, operation, record_id, changes
FROM v_audit_changes
WHERE log_id > :last_log
ORDER BY log_id;

-- Тепер видача дозволена
UPDATE orders SET status = 'delivered' WHERE order_id = :order_id;

-- Видалення платежу відкочує суми каскадом у зворотному напрямку
BEGIN;
DELETE FROM payments WHERE order_id = :order_id AND purpose = 'services';
SELECT o.paid_usd, c.total_paid_usd, c.loyalty_level
FROM orders o JOIN clients c USING (client_id) WHERE o.order_id = :order_id;
ROLLBACK;

-- Узгодженість агрегатів з первинними даними
SELECT (SELECT COUNT(*) FROM orders o
         WHERE o.paid_usd <> COALESCE((SELECT SUM(amount_usd) FROM payments p WHERE p.order_id = o.order_id), 0))
           AS orders_mismatch,
       (SELECT COUNT(*) FROM clients c
         WHERE c.total_paid_usd <> COALESCE((SELECT SUM(paid_usd) FROM orders o WHERE o.client_id = c.client_id), 0))
           AS clients_mismatch;
