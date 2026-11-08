-- Перевірка обмежень цілісності: кожна команда має завершитися помилкою
-- 1. CHECK: телефон не у форматі +380XXXXXXXXX
INSERT INTO clients (first_name, last_name, phone, city) VALUES ('Іван', 'Тестовий', '0671234567', 'Луцьк');
-- 2. CHECK: VIN з літерою O і довжиною 16 символів
INSERT INTO cars (vin, make, model, model_year, fuel_type, engine_volume, mileage_mi, yard_id, lot_number, purchase_price_usd, purchase_date)
VALUES ('1HGCM82633AO0435', 'Honda', 'Accord', 2018, 'petrol', 2.4, 50000, 1, '11111111', 5000, '2026-10-01');
-- 3. UNIQUE: авто з таким VIN уже є
INSERT INTO cars (vin, make, model, model_year, fuel_type, engine_volume, mileage_mi, yard_id, lot_number, purchase_price_usd, purchase_date)
VALUES ('2T3W1RFV8KW012345', 'Toyota', 'RAV4', 2019, 'petrol', 2.5, 41200, 2, '22222222', 9000, '2026-10-01');
-- 4. CHECK: для електромобіля задано об'єм двигуна замість батареї
INSERT INTO cars (vin, make, model, model_year, fuel_type, engine_volume, mileage_mi, yard_id, lot_number, purchase_price_usd, purchase_date)
VALUES ('5YJ3E1EA1PF000001', 'Tesla', 'Model 3', 2023, 'electric', 2.0, 10000, 5, '33333333', 19000, '2026-10-01');
-- 5. FOREIGN KEY: замовлення для неіснуючого клієнта
INSERT INTO orders (client_id, manager_id, wanted_car, budget_usd, destination_city) VALUES (999, 1, 'Audi A4', 10000, 'Луцьк');
-- 6. CHECK: статус «куплено» без прив'язаного авто
UPDATE orders SET status = 'bought' WHERE order_id = 16;
-- 7. ON DELETE RESTRICT: видалення клієнта, який має замовлення
DELETE FROM clients WHERE client_id = 1;
-- 8. CHECK: дата прибуття раніша за дату відправлення
UPDATE shipments SET arrival_date = '2026-10-01' WHERE order_id = 12;
