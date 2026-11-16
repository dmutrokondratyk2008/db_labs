-- =====================================================================
-- 08_audit_trigger.sql: таблиця audit_log і тригер логування INSERT/UPDATE
-- (рівень 1). Структура таблиці одразу розрахована на рівень 2.
-- =====================================================================

CREATE TABLE audit_log (
    log_id            BIGSERIAL    PRIMARY KEY,
    table_name        VARCHAR(50)  NOT NULL,
    operation         VARCHAR(10)  NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    record_id         INTEGER,
    old_values        JSONB,
    new_values        JSONB,
    changed_fields    TEXT[],                                      -- лише для UPDATE
    changed_by        VARCHAR(100) NOT NULL DEFAULT SESSION_USER,  -- користувач СУБД
    app_user          VARCHAR(30),                                 -- користувач вебзастосунку ЛР4
    client_addr       INET         DEFAULT inet_client_addr(),
    application_name  TEXT         DEFAULT current_setting('application_name'),
    txid              BIGINT       NOT NULL DEFAULT txid_current(),
    trigger_depth     SMALLINT,
    changed_at        TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_audit_log_record     ON audit_log (table_name, record_id);
CREATE INDEX idx_audit_log_changed_at ON audit_log (changed_at DESC);

-- Тригерна функція для таблиці clients: логує вставку та оновлення
CREATE OR REPLACE FUNCTION fn_log_client_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, operation, record_id, new_values)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.client_id, to_jsonb(NEW));
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, operation, record_id, old_values, new_values)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.client_id, to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NULL;   -- для AFTER-тригера значення ігнорується
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clients_log
AFTER INSERT OR UPDATE ON clients
FOR EACH ROW
EXECUTE FUNCTION fn_log_client_changes();

-- Перевірка
INSERT INTO clients (first_name, last_name, phone, email, city)
VALUES ('Віра', 'Лабенко', '+380631115005', 'vira.labenko@ukr.net', 'Луцьк')
RETURNING client_id, last_name, city;

UPDATE clients SET city = 'Ковель', phone = '+380631115006'
WHERE email = 'vira.labenko@ukr.net';

SELECT log_id, operation, table_name, record_id,
       old_values ->> 'city'  AS old_city,  new_values ->> 'city'  AS new_city,
       old_values ->> 'phone' AS old_phone, new_values ->> 'phone' AS new_phone,
       changed_by, to_char(changed_at, 'YYYY-MM-DD HH24:MI:SS') AS changed_at
FROM audit_log
ORDER BY log_id;

SELECT jsonb_pretty(new_values) AS new_values FROM audit_log WHERE log_id = 2;
