-- Запит 6 (кілька JOIN): маршрут авто від аукціону до порту
SELECT o.order_id,
       c.make || ' ' || c.model || ' ' || c.model_year            AS car,
       y.platform || ' ' || y.yard_name || ' (' || y.state || ')' AS auction,
       cr.name                                                    AS carrier,
       s.port_from || ' -> ' || s.port_to                         AS route,
       s.departure_date, s.arrival_date,
       s.arrival_date - s.departure_date                          AS days_at_sea
FROM orders o
JOIN cars c          ON c.car_id = o.car_id
JOIN auction_yards y ON y.yard_id = c.yard_id
JOIN shipments s     ON s.order_id = o.order_id
JOIN carriers cr     ON cr.carrier_id = s.carrier_id
ORDER BY s.departure_date;

-- Запит 7 (корельований підзапит): найдорожче авто на кожній платформі
SELECT y.platform, c.make, c.model, c.purchase_price_usd
FROM cars c
JOIN auction_yards y ON y.yard_id = c.yard_id
WHERE c.purchase_price_usd = (
    SELECT MAX(c2.purchase_price_usd)
    FROM cars c2 JOIN auction_yards y2 ON y2.yard_id = c2.yard_id
    WHERE y2.platform = y.platform)
ORDER BY c.purchase_price_usd DESC;
