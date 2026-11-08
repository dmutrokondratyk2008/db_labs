-- Запит 3 (агрегація): статистика покупок за марками (марки з 2+ авто)
SELECT make, COUNT(*) AS cars_count, ROUND(AVG(purchase_price_usd), 2) AS avg_price_usd,
       MIN(purchase_price_usd) AS min_price_usd, MAX(purchase_price_usd) AS max_price_usd
FROM cars
GROUP BY make
HAVING COUNT(*) >= 2
ORDER BY cars_count DESC, avg_price_usd DESC;

-- Запит 4 (підзапит): авто, куплені дорожче за середню ціну
SELECT make, model, model_year, purchase_price_usd,
       ROUND(purchase_price_usd - (SELECT AVG(purchase_price_usd) FROM cars), 2) AS above_avg_usd
FROM cars
WHERE purchase_price_usd > (SELECT AVG(purchase_price_usd) FROM cars)
ORDER BY purchase_price_usd DESC;

-- Запит 5 (підзапит з IN): постійні клієнти з кількома замовленнями
SELECT client_id, last_name, first_name, city
FROM clients
WHERE client_id IN (SELECT client_id FROM orders WHERE status <> 'cancelled'
                    GROUP BY client_id HAVING COUNT(*) > 1)
ORDER BY last_name;
