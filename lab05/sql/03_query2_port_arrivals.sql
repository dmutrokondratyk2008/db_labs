-- Запит 2. Авто, що прибули в порт Одеса за жовтень 2026:
-- контейнер, перевізник, клієнт (JOIN п'яти таблиць, фільтр, сортування)
\o /dev/null
SELECT 1 FROM shipments WHERE port_to = 'Одеса' AND arrival_date BETWEEN '2026-10-01' AND '2026-10-31';
\o
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.arrival_date,
       s.container_number,
       cr.name                              AS carrier,
       c.vin,
       c.make || ' ' || c.model             AS car,
       cl.last_name || ' ' || cl.first_name AS client,
       o.status
FROM shipments s
JOIN orders   o  ON o.order_id    = s.order_id
JOIN cars     c  ON c.car_id      = o.car_id
JOIN carriers cr ON cr.carrier_id = s.carrier_id
JOIN clients  cl ON cl.client_id  = o.client_id
WHERE s.port_to = 'Одеса'
  AND s.arrival_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-31'
ORDER BY s.arrival_date, s.container_number;
