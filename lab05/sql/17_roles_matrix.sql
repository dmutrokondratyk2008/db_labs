-- =====================================================================
-- 17_roles_matrix.sql: матриця прав ролей на таблиці
--   S - SELECT, I - INSERT, U - UPDATE, D - DELETE
--   s, u - право лише на частину стовпців; '-' - доступу немає
-- =====================================================================
SELECT t.table_name,
       r.role,
       CASE WHEN has_table_privilege(r.role, t.table_name, 'SELECT') THEN 'S'
            WHEN has_any_column_privilege(r.role, t.table_name, 'SELECT') THEN 's' ELSE '-' END ||
       CASE WHEN has_table_privilege(r.role, t.table_name, 'INSERT') THEN 'I' ELSE '-' END ||
       CASE WHEN has_table_privilege(r.role, t.table_name, 'UPDATE') THEN 'U'
            WHEN has_any_column_privilege(r.role, t.table_name, 'UPDATE') THEN 'u' ELSE '-' END ||
       CASE WHEN has_table_privilege(r.role, t.table_name, 'DELETE') THEN 'D' ELSE '-' END AS rights
FROM (VALUES ('clients'), ('orders'), ('payments'), ('cars'), ('shipments'), ('order_services'),
             ('managers'), ('audit_log'), ('activity_log'), ('users'), ('v_order_finance'),
             ('mv_monthly_revenue')) AS t(table_name)
CROSS JOIN (VALUES ('car_reader'), ('car_moderator'), ('car_admin')) AS r(role)
\crosstabview table_name role rights

-- Політики захисту на рівні рядків
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE tablename = 'orders' ORDER BY policyname;
