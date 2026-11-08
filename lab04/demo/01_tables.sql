-- Перелік таблиць бази і кількість записів у кожній
\dt
SELECT 'clients' AS table_name, COUNT(*) AS rows FROM clients
UNION ALL SELECT 'managers', COUNT(*) FROM managers
UNION ALL SELECT 'auction_yards', COUNT(*) FROM auction_yards
UNION ALL SELECT 'carriers', COUNT(*) FROM carriers
UNION ALL SELECT 'services', COUNT(*) FROM services
UNION ALL SELECT 'cars', COUNT(*) FROM cars
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'shipments', COUNT(*) FROM shipments
UNION ALL SELECT 'customs_declarations', COUNT(*) FROM customs_declarations
UNION ALL SELECT 'order_services', COUNT(*) FROM order_services
UNION ALL SELECT 'payments', COUNT(*) FROM payments;
