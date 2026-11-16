-- =====================================================================
-- 15_materialized_view.sql: матеріалізоване представлення з агрегатами
-- і автоматичним оновленням через тригери (рівень 3)
-- =====================================================================

-- Щомісячна виручка компанії за призначенням платежів
CREATE MATERIALIZED VIEW mv_monthly_revenue AS
SELECT date_trunc('month', p.payment_date)::date                 AS month,
       COUNT(*)                                                  AS payments,
       COUNT(DISTINCT p.order_id)                                AS orders,
       SUM(p.amount_usd)                                         AS revenue_usd,
       SUM(p.amount_usd) FILTER (WHERE p.purpose = 'car')        AS cars_usd,
       SUM(p.amount_usd) FILTER (WHERE p.purpose = 'shipping')   AS shipping_usd,
       SUM(p.amount_usd) FILTER (WHERE p.purpose = 'customs')    AS customs_usd,
       SUM(p.amount_usd) FILTER (WHERE p.purpose IN ('deposit', 'services')) AS other_usd,
       ROUND(AVG(p.amount_usd), 2)                               AS avg_payment_usd
FROM payments p
GROUP BY 1;

-- Унікальний індекс обов'язковий для REFRESH ... CONCURRENTLY
CREATE UNIQUE INDEX ux_mv_monthly_revenue_month ON mv_monthly_revenue (month);

-- Порівняння швидкості: агрегування 600 тис. платежів проти готового результату
\timing on
SELECT month, payments, revenue_usd FROM (
    SELECT date_trunc('month', payment_date)::date AS month, COUNT(*) AS payments,
           SUM(amount_usd) AS revenue_usd
    FROM payments GROUP BY 1) t
WHERE month >= DATE '2026-08-01' ORDER BY month;

SELECT month, payments, revenue_usd FROM mv_monthly_revenue
WHERE month >= DATE '2026-08-01' ORDER BY month;
\timing off

-- ---------------------------------------------------------------------
-- Автоматичне оновлення.
-- Оновлення після кожного рядка надто дороге, а після кожного оператора
-- повторюється, якщо в транзакції кілька операторів. Тому використано
-- відкладений тригер обмеження (DEFERRABLE INITIALLY DEFERRED): він
-- спрацьовує під час COMMIT, а прапорець у налаштуваннях транзакції
-- гарантує одне оновлення на транзакцію.
-- ---------------------------------------------------------------------
CREATE TABLE mv_refresh_log (
    refresh_id    SERIAL PRIMARY KEY,
    view_name     TEXT        NOT NULL,
    txid          BIGINT      NOT NULL,
    duration_ms   NUMERIC(10,2) NOT NULL,
    refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION fn_refresh_monthly_revenue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_start TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF current_setting('lab5.mv_revenue_txid', TRUE) IS DISTINCT FROM txid_current()::TEXT THEN
        PERFORM set_config('lab5.mv_revenue_txid', txid_current()::TEXT, TRUE);
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_revenue;
        INSERT INTO mv_refresh_log (view_name, txid, duration_ms)
        VALUES ('mv_monthly_revenue', txid_current(),
                EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000);
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_payments_refresh_mv
AFTER INSERT OR UPDATE OR DELETE ON payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_refresh_monthly_revenue();

-- Перевірка: три платежі в одній транзакції -> одне оновлення
SELECT month, payments, revenue_usd, other_usd FROM mv_monthly_revenue WHERE month = date_trunc('month', CURRENT_DATE)::date;

BEGIN;
INSERT INTO payments (order_id, amount_usd, method, purpose)
SELECT order_id, 1000, 'card', 'deposit' FROM orders
WHERE status = 'new' ORDER BY order_id DESC LIMIT 3;
SELECT month, payments, revenue_usd FROM mv_monthly_revenue WHERE month = date_trunc('month', CURRENT_DATE)::date;
COMMIT;

SELECT month, payments, revenue_usd, other_usd FROM mv_monthly_revenue WHERE month = date_trunc('month', CURRENT_DATE)::date;

-- Видалення теж оновлює представлення
DELETE FROM payments WHERE payment_id = (SELECT MAX(payment_id) FROM payments);
SELECT month, payments, revenue_usd FROM mv_monthly_revenue WHERE month = date_trunc('month', CURRENT_DATE)::date;

SELECT refresh_id, view_name, txid, duration_ms, to_char(refreshed_at, 'HH24:MI:SS') AS at
FROM mv_refresh_log ORDER BY refresh_id;
