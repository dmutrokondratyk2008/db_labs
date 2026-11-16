-- =====================================================================
-- 20_workload.sql: сценарій навантаження для pgbench (типові запити
-- вебзастосунку). Запуск:
--   pgbench -U postgres -n -c 4 -j 2 -T 20 -f /lab05/20_workload.sql car_import
-- =====================================================================
\set cid random(1, 50000)
\set mid random(1, 10)
\set phone random(1000, 9999)

-- картка клієнта
SELECT * FROM v_client_statistics WHERE client_id = :cid;
-- робочий список менеджера
SELECT order_id, status, client, days_in_work FROM v_active_orders
WHERE manager_id = :mid ORDER BY days_in_work DESC LIMIT 20;
-- черга нових замовлень
SELECT order_id, order_date, client_id, wanted_car FROM orders
WHERE status = 'new' ORDER BY order_date, order_id LIMIT 20;
-- пошук клієнта за останніми цифрами телефону
SELECT client_id, last_name, first_name, phone FROM clients WHERE phone LIKE '%' || :phone;
-- виручка за місяцями
SELECT month, revenue_usd FROM mv_monthly_revenue ORDER BY month DESC LIMIT 12;
-- рейтинг клієнтів міста
SELECT client_id, client, paid_usd FROM v_client_statistics
WHERE city = 'Рівне' ORDER BY paid_usd DESC LIMIT 10;
