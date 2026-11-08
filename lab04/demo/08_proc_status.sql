-- Процедура 3. change_order_status: недопустимий перехід
SELECT change_order_status(15, 'delivered');

-- Видача клієнту без завершеного розмитнення
SELECT change_order_status(8, 'delivered');

-- Розмитнення завершено, тепер перехід дозволено
UPDATE customs_declarations SET cleared_at = CURRENT_DATE WHERE order_id = 8;
SELECT change_order_status(8, 'delivered');

-- Процедура 4. cancel_order (CALL): скасування з причиною
CALL cancel_order(17, 'Клієнт знайшов авто в Україні');
CALL cancel_order(12, 'Передумав');

SELECT order_id, old_status, new_status, changed_by, comment
FROM order_status_history WHERE order_id IN (8, 17) ORDER BY history_id;
