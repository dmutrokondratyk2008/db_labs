-- Представлення 1. v_order_details: повна інформація про замовлення
SELECT order_id, client_name, manager_name, car, auction_yard, port_to, status
FROM v_order_details ORDER BY order_id;

-- Представлення 2. v_order_finance: фінанси замовлень (від'ємний залишок = аванс)
SELECT order_id, client_name, status, car_cost_usd, shipping_usd, taxes_usd,
       services_usd, service_fee_usd, total_cost_usd, paid_usd, balance_usd
FROM v_order_finance WHERE balance_usd <> 0 ORDER BY balance_usd DESC;
