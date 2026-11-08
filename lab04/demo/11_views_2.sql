-- Представлення 3. v_manager_performance: ефективність менеджерів
SELECT * FROM v_manager_performance ORDER BY fee_income_usd DESC;

-- Представлення 4. v_shipments_in_transit: авто в морі та очікувана дата прибуття
SELECT * FROM v_shipments_in_transit;

-- Перелік представлень бази
\dv
-- Власні функції та процедури (без функцій розширення pg_trgm)
SELECT p.proname AS routine,
       CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS kind,
       COALESCE(pg_get_function_result(p.oid), '-') AS returns
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
ORDER BY kind DESC, routine;
