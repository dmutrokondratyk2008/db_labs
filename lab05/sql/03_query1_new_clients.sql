-- Запит 1. Нові клієнти за останні 30 днів: кількість замовлень, бюджет,
-- сума платежів (JOIN трьох таблиць, агрегація, сортування)
\o /dev/null
SELECT 1 FROM clients c LEFT JOIN orders o ON o.client_id = c.client_id
WHERE c.created_at >= CURRENT_DATE - 30;   -- прогрівання кешу
\o
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.client_id,
       c.last_name || ' ' || c.first_name AS client,
       c.city,
       c.created_at::date                 AS registered,
       COUNT(DISTINCT o.order_id)         AS orders,
       COALESCE(SUM(p.amount_usd), 0)     AS paid_usd
FROM clients c
LEFT JOIN orders   o ON o.client_id = c.client_id
LEFT JOIN payments p ON p.order_id  = o.order_id
WHERE c.created_at >= CURRENT_DATE - 30
GROUP BY c.client_id
ORDER BY paid_usd DESC, c.client_id;
