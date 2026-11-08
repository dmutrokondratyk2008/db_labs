-- Аналітика 3: структура витрат по доставлених авто, %
SELECT ROUND(AVG(total_cost_usd), 2) AS avg_total_usd,
       ROUND(100 * SUM(car_cost_usd)    / SUM(total_cost_usd), 1) AS car_pct,
       ROUND(100 * SUM(shipping_usd)    / SUM(total_cost_usd), 1) AS shipping_pct,
       ROUND(100 * SUM(taxes_usd)       / SUM(total_cost_usd), 1) AS taxes_pct,
       ROUND(100 * SUM(services_usd)    / SUM(total_cost_usd), 1) AS services_pct,
       ROUND(100 * SUM(service_fee_usd) / SUM(total_cost_usd), 1) AS fee_pct
FROM v_order_finance WHERE status = 'delivered';

-- Аналітика 4: топ клієнтів за платежами, частка в надходженнях
SELECT cl.last_name || ' ' || cl.first_name AS client, cl.city,
       COUNT(DISTINCT o.order_id) AS orders, SUM(p.amount_usd) AS paid_usd,
       ROUND(100 * SUM(p.amount_usd) / SUM(SUM(p.amount_usd)) OVER (), 1) AS share_pct,
       DENSE_RANK() OVER (ORDER BY SUM(p.amount_usd) DESC) AS place
FROM clients cl
JOIN orders o   ON o.client_id = cl.client_id
JOIN payments p ON p.order_id = o.order_id
GROUP BY cl.client_id, cl.last_name, cl.first_name, cl.city
ORDER BY place LIMIT 10;

-- Аналітика 5: середні митні платежі за типом пального і віком авто
SELECT c.fuel_type,
       CASE WHEN EXTRACT(YEAR FROM cd.declared_at) - c.model_year <= 5 THEN 'до 5 років'
            ELSE 'старше 5 років' END AS age_group,
       COUNT(*) AS cars, ROUND(AVG(cd.duty_usd), 2) AS avg_duty_usd,
       ROUND(AVG(cd.excise_usd), 2) AS avg_excise_usd, ROUND(AVG(cd.vat_usd), 2) AS avg_vat_usd,
       ROUND(AVG(cd.duty_usd + cd.excise_usd + cd.vat_usd), 2) AS avg_total_usd
FROM customs_declarations cd
JOIN orders o ON o.order_id = cd.order_id
JOIN cars c   ON c.car_id = o.car_id
GROUP BY c.fuel_type, age_group
ORDER BY c.fuel_type, age_group;
