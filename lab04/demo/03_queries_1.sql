-- Запит 1 (фільтрація і сортування): авто 2019+ дешевше 10 000 $
SELECT vin, make, model, model_year, mileage_mi, purchase_price_usd
FROM cars
WHERE model_year >= 2019 AND purchase_price_usd < 10000
ORDER BY purchase_price_usd;

-- Запит 2 (JOIN): активні замовлення з клієнтом, менеджером і авто
SELECT o.order_id,
       cl.last_name || ' ' || cl.first_name AS client,
       m.last_name                          AS manager,
       c.make || ' ' || c.model             AS car,
       o.status
FROM orders o
JOIN clients cl  ON cl.client_id = o.client_id
JOIN managers m  ON m.manager_id = o.manager_id
LEFT JOIN cars c ON c.car_id = o.car_id
WHERE o.status NOT IN ('delivered', 'cancelled')
ORDER BY o.order_date;
