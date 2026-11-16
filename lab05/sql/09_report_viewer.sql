-- =====================================================================
-- 09_report_viewer.sql: користувач з обмеженими правами (рівень 1)
-- report_viewer - аналітик: лише читання авто, доставок, частини стовпців
-- клієнтів і замовлень та двох представлень. Платежі, телефони, email,
-- бюджети клієнтів і журнали йому недоступні.
-- =====================================================================

CREATE ROLE report_viewer WITH LOGIN PASSWORD 'Viewer#Lab5-2026'
    CONNECTION LIMIT 3 VALID UNTIL '2027-07-01';

-- За замовчуванням право CONNECT має PUBLIC (усі ролі): забираємо його
REVOKE CONNECT ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT  CONNECT ON DATABASE :"DBNAME" TO report_viewer;
GRANT  USAGE   ON SCHEMA public TO report_viewer;

-- Таблиці повністю
GRANT SELECT ON cars, auction_yards, carriers, services, shipments TO report_viewer;
-- Таблиці частково: права на рівні стовпців
GRANT SELECT (client_id, first_name, last_name, city, created_at) ON clients TO report_viewer;
GRANT SELECT (order_id, client_id, manager_id, car_id, order_date, status, destination_city)
    ON orders TO report_viewer;
-- Представлення
GRANT SELECT ON v_active_orders, v_client_statistics TO report_viewer;

-- Підсумок прав
SELECT table_name, string_agg(DISTINCT privilege_type, ', ') AS privileges
FROM information_schema.role_table_grants
WHERE grantee = 'report_viewer'
GROUP BY table_name
UNION ALL
SELECT table_name || ' (стовпці)', string_agg(column_name, ', ' ORDER BY column_name)
FROM information_schema.column_privileges
WHERE grantee = 'report_viewer' AND table_name IN ('clients', 'orders')
GROUP BY table_name
ORDER BY 1;
