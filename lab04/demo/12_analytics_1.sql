-- Аналітика 1: помісячна динаміка купівель і надходжень (FULL JOIN + віконна сума)
WITH purchases AS (
    SELECT date_trunc('month', purchase_date)::DATE AS month, COUNT(*) AS cars_bought,
           SUM(purchase_price_usd + auction_fee_usd) AS spent_on_cars_usd
    FROM cars GROUP BY 1
), income AS (
    SELECT date_trunc('month', payment_date)::DATE AS month, SUM(amount_usd) AS received_usd
    FROM payments GROUP BY 1
)
SELECT to_char(COALESCE(p.month, i.month), 'YYYY-MM') AS month,
       COALESCE(p.cars_bought, 0) AS cars_bought,
       COALESCE(p.spent_on_cars_usd, 0) AS spent_on_cars_usd,
       COALESCE(i.received_usd, 0) AS received_usd,
       SUM(COALESCE(i.received_usd, 0)) OVER (ORDER BY COALESCE(p.month, i.month)) AS received_cumulative_usd
FROM purchases p FULL JOIN income i ON i.month = p.month
ORDER BY 1;

-- Аналітика 2: перевізники, середній час і вартість, рейтинг швидкості (RANK)
SELECT cr.name AS carrier, COUNT(s.shipment_id) AS shipments, COUNT(s.arrival_date) AS delivered,
       ROUND(AVG(s.arrival_date - s.departure_date), 1) AS avg_days,
       ROUND(AVG(s.shipping_cost_usd), 2) AS avg_cost_usd,
       RANK() OVER (ORDER BY AVG(s.arrival_date - s.departure_date)) AS speed_rank
FROM carriers cr JOIN shipments s ON s.carrier_id = cr.carrier_id
GROUP BY cr.carrier_id, cr.name
ORDER BY speed_rank NULLS LAST, shipments DESC;
