-- Процедура 2. calculate_customs: розмитнення електромобіля, що прибув у порт
SELECT order_id, status, car, fuel_type, port_to, arrival_date FROM v_order_details WHERE order_id = 11;

SELECT * FROM calculate_customs(11, 1.16);

SELECT order_id, status FROM orders WHERE order_id = 11;

-- Процедура 5. get_order_cost: кошторис замовлення
SELECT * FROM get_order_cost(11);

-- Помилка: замовлення 13 ще в дорозі
SELECT * FROM calculate_customs(13);
