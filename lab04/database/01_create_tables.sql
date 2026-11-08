-- =====================================================================
-- Лабораторна робота 4. База даних компанії з пригону авто зі США
-- 01_create_tables.sql: фізична структура (третя нормальна форма)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Довідники
-- ---------------------------------------------------------------------

-- Клієнти компанії
CREATE TABLE clients (
    client_id   SERIAL PRIMARY KEY,
    first_name  VARCHAR(50)  NOT NULL,
    last_name   VARCHAR(50)  NOT NULL,
    phone       VARCHAR(13)  NOT NULL UNIQUE
                CHECK (phone ~ '^\+380[0-9]{9}$'),
    email       VARCHAR(100) UNIQUE
                CHECK (email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'),
    city        VARCHAR(50)  NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Менеджери, що ведуть замовлення
CREATE TABLE managers (
    manager_id     SERIAL PRIMARY KEY,
    first_name     VARCHAR(50)  NOT NULL,
    last_name      VARCHAR(50)  NOT NULL,
    phone          VARCHAR(13)  NOT NULL UNIQUE
                   CHECK (phone ~ '^\+380[0-9]{9}$'),
    email          VARCHAR(100) NOT NULL UNIQUE
                   CHECK (email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'),
    hire_date      DATE         NOT NULL DEFAULT CURRENT_DATE,
    commission_pct NUMERIC(4,2) NOT NULL DEFAULT 10.00
                   CHECK (commission_pct BETWEEN 0 AND 30),
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE
);

-- Майданчики аукціонів у США (Copart, IAAI, Manheim)
CREATE TABLE auction_yards (
    yard_id    SERIAL PRIMARY KEY,
    platform   VARCHAR(20) NOT NULL
               CHECK (platform IN ('Copart', 'IAAI', 'Manheim')),
    yard_name  VARCHAR(80) NOT NULL,
    city       VARCHAR(50) NOT NULL,
    state      CHAR(2)     NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
    UNIQUE (platform, yard_name)
);

-- Морські перевізники (контейнерні лінії)
CREATE TABLE carriers (
    carrier_id        SERIAL PRIMARY KEY,
    name              VARCHAR(80)  NOT NULL UNIQUE,
    country           VARCHAR(50)  NOT NULL,
    transit_days_avg  SMALLINT     NOT NULL CHECK (transit_days_avg BETWEEN 7 AND 90),
    rating            NUMERIC(2,1) CHECK (rating BETWEEN 1 AND 5)
);

-- Додаткові послуги компанії
CREATE TABLE services (
    service_id      SERIAL PRIMARY KEY,
    name            VARCHAR(80)   NOT NULL UNIQUE,
    description     VARCHAR(255),
    base_price_usd  NUMERIC(8,2)  NOT NULL CHECK (base_price_usd >= 0)
);

-- ---------------------------------------------------------------------
-- Основні сутності
-- ---------------------------------------------------------------------

-- Авто, куплені на аукціоні
CREATE TABLE cars (
    car_id              SERIAL PRIMARY KEY,
    vin                 CHAR(17)      NOT NULL UNIQUE
                        CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
    make                VARCHAR(40)   NOT NULL,
    model               VARCHAR(40)   NOT NULL,
    model_year          SMALLINT      NOT NULL CHECK (model_year BETWEEN 1990 AND 2100),
    fuel_type           VARCHAR(10)   NOT NULL
                        CHECK (fuel_type IN ('petrol', 'diesel', 'hybrid', 'electric')),
    engine_volume       NUMERIC(3,1)  CHECK (engine_volume > 0 AND engine_volume <= 8.0),
    battery_kwh         NUMERIC(5,1)  CHECK (battery_kwh > 0),
    mileage_mi          INTEGER       NOT NULL CHECK (mileage_mi >= 0),
    damage              VARCHAR(100),
    yard_id             INTEGER       NOT NULL
                        REFERENCES auction_yards(yard_id) ON DELETE RESTRICT,
    lot_number          VARCHAR(12)   NOT NULL,
    purchase_price_usd  NUMERIC(10,2) NOT NULL CHECK (purchase_price_usd > 0),
    auction_fee_usd     NUMERIC(8,2)  NOT NULL DEFAULT 0 CHECK (auction_fee_usd >= 0),
    purchase_date       DATE          NOT NULL,
    UNIQUE (yard_id, lot_number),
    -- для електромобіля задається ємність батареї, для інших авто: об'єм двигуна
    CHECK ((fuel_type = 'electric' AND battery_kwh IS NOT NULL AND engine_volume IS NULL)
        OR (fuel_type <> 'electric' AND engine_volume IS NOT NULL AND battery_kwh IS NULL))
);

-- Замовлення клієнтів
CREATE TABLE orders (
    order_id          SERIAL PRIMARY KEY,
    client_id         INTEGER       NOT NULL REFERENCES clients(client_id)   ON DELETE RESTRICT,
    manager_id        INTEGER       NOT NULL REFERENCES managers(manager_id) ON DELETE RESTRICT,
    car_id            INTEGER       UNIQUE   REFERENCES cars(car_id)         ON DELETE SET NULL,
    order_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
    wanted_car        VARCHAR(100)  NOT NULL,
    budget_usd        NUMERIC(10,2) NOT NULL CHECK (budget_usd > 0),
    destination_city  VARCHAR(50)   NOT NULL,
    service_fee_usd   NUMERIC(8,2)  NOT NULL DEFAULT 600 CHECK (service_fee_usd >= 0),
    status            VARCHAR(20)   NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'bought', 'in_transit', 'in_port',
                                        'customs', 'delivered', 'cancelled')),
    created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- після купівлі в замовленні обов'язково має бути авто
    CHECK (status IN ('new', 'cancelled') OR car_id IS NOT NULL)
);

-- Морська доставка авто (одна доставка на замовлення)
CREATE TABLE shipments (
    shipment_id        SERIAL PRIMARY KEY,
    order_id           INTEGER      NOT NULL UNIQUE REFERENCES orders(order_id)     ON DELETE CASCADE,
    carrier_id         INTEGER      NOT NULL        REFERENCES carriers(carrier_id) ON DELETE RESTRICT,
    container_number   VARCHAR(11)  NOT NULL CHECK (container_number ~ '^[A-Z]{4}[0-9]{7}$'),
    port_from          VARCHAR(50)  NOT NULL,
    port_to            VARCHAR(30)  NOT NULL
                       CHECK (port_to IN ('Одеса', 'Клайпеда', 'Гдиня', 'Бремергафен', 'Констанца')),
    departure_date     DATE,
    arrival_date       DATE,
    shipping_cost_usd  NUMERIC(8,2) NOT NULL CHECK (shipping_cost_usd > 0),
    CHECK (arrival_date IS NULL OR (departure_date IS NOT NULL AND arrival_date > departure_date))
);

-- Митне оформлення (одна декларація на замовлення)
CREATE TABLE customs_declarations (
    order_id           INTEGER       PRIMARY KEY REFERENCES orders(order_id) ON DELETE CASCADE,
    customs_value_usd  NUMERIC(10,2) NOT NULL CHECK (customs_value_usd > 0),
    duty_usd           NUMERIC(10,2) NOT NULL CHECK (duty_usd >= 0),
    excise_usd         NUMERIC(10,2) NOT NULL CHECK (excise_usd >= 0),
    vat_usd            NUMERIC(10,2) NOT NULL CHECK (vat_usd >= 0),
    eur_usd_rate       NUMERIC(6,4)  NOT NULL CHECK (eur_usd_rate > 0),
    declared_at        DATE          NOT NULL DEFAULT CURRENT_DATE,
    cleared_at         DATE,
    CHECK (cleared_at IS NULL OR cleared_at >= declared_at)
);

-- Послуги в замовленні (зв'язок багато-до-багатьох)
CREATE TABLE order_services (
    order_id    INTEGER      NOT NULL REFERENCES orders(order_id)     ON DELETE CASCADE,
    service_id  INTEGER      NOT NULL REFERENCES services(service_id) ON DELETE RESTRICT,
    price_usd   NUMERIC(8,2) NOT NULL CHECK (price_usd >= 0),
    added_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (order_id, service_id)
);

-- Платежі клієнтів
CREATE TABLE payments (
    payment_id    SERIAL PRIMARY KEY,
    order_id      INTEGER       NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
    amount_usd    NUMERIC(10,2) NOT NULL CHECK (amount_usd > 0),
    payment_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
    method        VARCHAR(15)   NOT NULL
                  CHECK (method IN ('cash', 'card', 'bank_transfer')),
    purpose       VARCHAR(15)   NOT NULL
                  CHECK (purpose IN ('deposit', 'car', 'shipping', 'customs', 'services'))
);

-- ---------------------------------------------------------------------
-- Індекси на зовнішніх ключах і полях фільтрації
-- ---------------------------------------------------------------------
CREATE INDEX idx_cars_yard_id            ON cars(yard_id);
CREATE INDEX idx_orders_client_id        ON orders(client_id);
CREATE INDEX idx_orders_manager_id       ON orders(manager_id);
CREATE INDEX idx_orders_status           ON orders(status);
CREATE INDEX idx_shipments_carrier_id    ON shipments(carrier_id);
CREATE INDEX idx_order_services_service  ON order_services(service_id);
CREATE INDEX idx_payments_order_id       ON payments(order_id);
