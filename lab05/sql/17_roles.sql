-- =====================================================================
-- 17_roles.sql: ієрархія ролей з детальною системою прав (рівень 3)
--
--   car_admin      (адміністратор)  - усе, журнали, керування ролями
--      └─ car_moderator (модератор = менеджер) - робота з клієнтами,
--            │                    замовленнями, платежами; змінює лише СВОЇ замовлення
--            └─ car_reader (звичайний користувач) - лише читання без
--                                 персональних і фінансових даних
-- Права успадковуються: кожна вища роль є членом нижчої.
-- =====================================================================

CREATE ROLE car_reader    NOLOGIN;
CREATE ROLE car_moderator NOLOGIN IN ROLE car_reader;
CREATE ROLE car_admin     NOLOGIN IN ROLE car_moderator;

-- ---------------- car_reader ----------------
GRANT CONNECT ON DATABASE :"DBNAME" TO car_reader;
GRANT USAGE   ON SCHEMA public TO car_reader;
GRANT SELECT  ON auction_yards, carriers, services, cars, shipments,
                 v_active_orders, v_client_statistics, v_shipments_in_transit,
                 mv_monthly_revenue
              TO car_reader;
GRANT SELECT (client_id, first_name, last_name, city, created_at, loyalty_level) ON clients TO car_reader;
GRANT SELECT (order_id, client_id, manager_id, car_id, order_date, status, destination_city)
    ON orders TO car_reader;

-- ---------------- car_moderator ----------------
GRANT SELECT ON clients, orders, payments, managers, customs_declarations, order_services,
                order_status_history, client_notifications, v_order_details, v_order_finance
             TO car_moderator;
GRANT INSERT ON clients, orders, cars, shipments, customs_declarations, order_services, payments
             TO car_moderator;
-- змінювати можна лише контактні дані клієнта, але не суми і рівень лояльності
GRANT UPDATE (first_name, last_name, phone, email, city) ON clients TO car_moderator;
GRANT UPDATE ON orders, cars, shipments, customs_declarations TO car_moderator;
GRANT DELETE ON order_services TO car_moderator;              -- платежі не видаляються
GRANT USAGE  ON ALL SEQUENCES IN SCHEMA public TO car_moderator;
-- тригери ЛР4 пишуть журнали з правами користувача: лише вставка, без читання
GRANT INSERT ON activity_log, order_status_history TO car_moderator;

-- ---------------- car_admin ----------------
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO car_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO car_admin;
-- таблиці, створені пізніше, теж отримають права
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL    ON TABLES TO car_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL    ON SEQUENCES TO car_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO car_moderator;

-- ---------------- Захист на рівні рядків (RLS) для orders ----------------
-- Менеджер визначається через таблицю users вебзастосунку ЛР4 (username -> manager_id)
CREATE OR REPLACE FUNCTION current_manager_id()
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT manager_id FROM users WHERE username = SESSION_USER;
$$;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_orders_read ON orders FOR SELECT TO car_reader USING (TRUE);
CREATE POLICY p_orders_moderator_insert ON orders FOR INSERT TO car_moderator
    WITH CHECK (manager_id = current_manager_id());
CREATE POLICY p_orders_moderator_update ON orders FOR UPDATE TO car_moderator
    USING (manager_id = current_manager_id())
    WITH CHECK (manager_id = current_manager_id());
CREATE POLICY p_orders_admin ON orders FOR ALL TO car_admin USING (TRUE) WITH CHECK (TRUE);

-- ---------------- Користувачі ----------------
CREATE ROLE hordiichuk     LOGIN PASSWORD 'Manager#Lab5-01' IN ROLE car_moderator;
CREATE ROLE mazurets       LOGIN PASSWORD 'Manager#Lab5-02' IN ROLE car_moderator;
CREATE ROLE dba_kondratiuk LOGIN PASSWORD 'Admin#Lab5-2026' CREATEROLE IN ROLE car_admin;
-- з PostgreSQL 16 атрибута CREATEROLE недостатньо: видавати групові ролі
-- можна лише з ADMIN OPTION на них
GRANT car_reader, car_moderator TO dba_kondratiuk WITH ADMIN OPTION;
-- вбудовані ролі PostgreSQL 17: обслуговування (VACUUM, ANALYZE, REINDEX,
-- REFRESH) і перегляд статистики без прав суперкористувача
GRANT pg_maintain, pg_monitor, pg_stat_scan_tables TO car_admin;

-- report_viewer з рівня 1 переводиться на групову роль: прямі права забираються
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM report_viewer;
GRANT car_reader TO report_viewer;

-- Ієрархія ролей
SELECT r.rolname AS role,
       r.rolcanlogin AS login,
       r.rolcreaterole AS createrole,
       ARRAY(SELECT b.rolname FROM pg_auth_members m JOIN pg_roles b ON b.oid = m.roleid
             WHERE m.member = r.oid ORDER BY 1) AS member_of
FROM pg_roles r
WHERE r.rolname IN ('car_reader', 'car_moderator', 'car_admin',
                    'report_viewer', 'hordiichuk', 'mazurets', 'dba_kondratiuk')
ORDER BY r.rolcanlogin, r.rolname;
