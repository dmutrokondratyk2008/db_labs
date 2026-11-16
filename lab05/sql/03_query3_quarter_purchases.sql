-- Запит 3. Закупівлі на аукціонах за III квартал 2026 за марками:
-- кількість, сума, середня ціна, частка в загальній сумі (агрегація + віконна функція)
\o /dev/null
SELECT 1 FROM cars WHERE purchase_date BETWEEN '2026-07-01' AND '2026-09-30';
\o
EXPLAIN (ANALYZE, BUFFERS)
SELECT make,
       COUNT(*)                                                AS cars,
       SUM(purchase_price_usd + auction_fee_usd)               AS total_usd,
       ROUND(AVG(purchase_price_usd), 2)                       AS avg_price_usd,
       ROUND(100.0 * SUM(purchase_price_usd + auction_fee_usd)
             / SUM(SUM(purchase_price_usd + auction_fee_usd)) OVER (), 2) AS share_pct
FROM cars
WHERE purchase_date BETWEEN DATE '2026-07-01' AND DATE '2026-09-30'
GROUP BY make
ORDER BY total_usd DESC;
