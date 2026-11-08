# Логічна схема бази даних `car_import`

Позначення: **PK** первинний ключ, **FK** зовнішній ключ, **UK** унікальне значення, **NN** обов'язкове поле.

## Довідники

| Таблиця | Атрибути | Ключі та обмеження |
|---|---|---|
| `clients` | client_id, first_name, last_name, phone, email, city, created_at | PK client_id; UK phone, email; CHECK формату телефону `+380XXXXXXXXX` і email |
| `managers` | manager_id, first_name, last_name, phone, email, hire_date, commission_pct, is_active | PK manager_id; UK phone, email; CHECK commission_pct 0..30 |
| `auction_yards` | yard_id, platform, yard_name, city, state | PK yard_id; UK (platform, yard_name); CHECK platform ∈ {Copart, IAAI, Manheim}, state — 2 великі літери |
| `carriers` | carrier_id, name, country, transit_days_avg, rating | PK carrier_id; UK name; CHECK transit_days_avg 7..90, rating 1..5 |
| `services` | service_id, name, description, base_price_usd | PK service_id; UK name; CHECK ціна ≥ 0 |

## Основні таблиці

| Таблиця | Атрибути | Ключі та обмеження |
|---|---|---|
| `cars` | car_id, vin, make, model, model_year, fuel_type, engine_volume, battery_kwh, mileage_mi, damage, yard_id, lot_number, purchase_price_usd, auction_fee_usd, purchase_date | PK car_id; UK vin, (yard_id, lot_number); FK yard_id → auction_yards (RESTRICT); CHECK VIN 17 символів без I/O/Q, рік 1990..2100, тип пального, «електро ⇒ battery_kwh, інакше engine_volume» |
| `orders` | order_id, client_id, manager_id, car_id, order_date, wanted_car, budget_usd, destination_city, service_fee_usd, status, created_at, updated_at | PK order_id; FK client_id → clients (RESTRICT), manager_id → managers (RESTRICT), car_id → cars (SET NULL); UK car_id (1:1); CHECK статус зі списку, «куплено і далі ⇒ car_id NOT NULL» |
| `shipments` | shipment_id, order_id, carrier_id, container_number, port_from, port_to, departure_date, arrival_date, shipping_cost_usd | PK shipment_id; FK order_id → orders (CASCADE), carrier_id → carriers (RESTRICT); UK order_id (1:1); CHECK номер контейнера ISO 6346, порт призначення зі списку, arrival > departure |
| `customs_declarations` | order_id, customs_value_usd, duty_usd, excise_usd, vat_usd, eur_usd_rate, declared_at, cleared_at | PK = FK order_id → orders (CASCADE) (1:1); CHECK суми ≥ 0, cleared_at ≥ declared_at |
| `order_services` | order_id, service_id, price_usd, added_at | PK (order_id, service_id); FK order_id → orders (CASCADE), service_id → services (RESTRICT) — таблиця зв'язку M:N |
| `payments` | payment_id, order_id, amount_usd, payment_date, method, purpose | PK payment_id; FK order_id → orders (RESTRICT); CHECK сума > 0, спосіб і призначення зі списку |

## Службові таблиці (рівні 2-3)

| Таблиця | Призначення | Ключі |
|---|---|---|
| `order_status_history` | історія змін статусу (тригер) | PK history_id; FK order_id → orders (CASCADE) |
| `users` | користувачі вебзастосунку, ролі admin / manager / viewer | PK user_id; UK username, email, manager_id; FK manager_id → managers (SET NULL) |
| `activity_log` | журнал усіх операцій з даними | PK log_id; FK user_id → users (SET NULL) |

## Зв'язки

| Зв'язок | Тип | Реалізація |
|---|---|---|
| Клієнт — замовлення | 1 : N | `orders.client_id` |
| Менеджер — замовлення | 1 : N | `orders.manager_id` |
| Майданчик аукціону — авто | 1 : N | `cars.yard_id` |
| Замовлення — авто | 1 : 0..1 | `orders.car_id` UNIQUE |
| Замовлення — доставка | 1 : 0..1 | `shipments.order_id` UNIQUE |
| Перевізник — доставка | 1 : N | `shipments.carrier_id` |
| Замовлення — митна декларація | 1 : 0..1 | `customs_declarations.order_id` PK |
| Замовлення — послуги | M : N | таблиця `order_services` |
| Замовлення — платежі | 1 : N | `payments.order_id` |
| Менеджер — користувач | 1 : 0..1 | `users.manager_id` UNIQUE |

## Відповідність 3НФ

- **1НФ:** усі атрибути атомарні; ім'я і прізвище, марка і модель, місто і штат зберігаються окремо; послуги замовлення винесено в окрему таблицю замість списку в одному полі.
- **2НФ:** складений ключ є лише в `order_services`, і її неключовий атрибут `price_usd` залежить від усієї пари (ціна конкретної послуги в конкретному замовленні).
- **3НФ:** транзитивних залежностей немає. Дані майданчика (місто, штат) не дублюються в `cars`, а беруться через `yard_id`; дані клієнта не дублюються в `orders`. Похідні величини (повна вартість, сплачено, борг, очікувана дата прибуття) не зберігаються, а обчислюються в представленнях `v_order_finance` і `v_shipments_in_transit`.
