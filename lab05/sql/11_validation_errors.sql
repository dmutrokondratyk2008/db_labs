-- =====================================================================
-- 11_validation_errors.sql: обробка помилок валідації в застосунку
-- Пакетне завантаження заявок: некоректні заявки не зупиняють обробку,
-- кожна помилка перехоплюється, а її код, текст і підказка зберігаються.
-- =====================================================================

CREATE TEMP TABLE import_errors (
    row_no    INTEGER,
    sqlstate  TEXT,
    message   TEXT,
    hint      TEXT
);

DO $$
DECLARE
    r        RECORD;
    v_client INTEGER := (SELECT client_id FROM clients WHERE email = 'vira.labenko@ukr.net');
    v_ok     INTEGER := 0;
    v_state  TEXT;
    v_msg    TEXT;
    v_hint   TEXT;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            (1, 3,  'Kia Sportage',      22000,  'рівне'),
            (2, 4,  'BMW X3',            41000,  'Kyiv'),
            (3, 11, 'Ford Escape',       18000,  'Ковель'),
            (4, 5,  'Tesla Model Y',     900000, 'Львів'),
            (5, 6,  'Mazda CX-5',        24000,  'Володимир'),
            (6, 7,  'Honda Accord',      19000,  'Луцьк')
        ) AS t(row_no, manager_id, car, budget, city)
    LOOP
        BEGIN
            INSERT INTO orders (client_id, manager_id, wanted_car, budget_usd, destination_city)
            VALUES (v_client, r.manager_id, r.car, r.budget, r.city);
            v_ok := v_ok + 1;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE,
                                    v_msg   = MESSAGE_TEXT,
                                    v_hint  = PG_EXCEPTION_HINT;
            INSERT INTO import_errors VALUES (r.row_no, v_state, v_msg, v_hint);
        END;
    END LOOP;
    RAISE NOTICE 'Прийнято заявок: %, відхилено: %', v_ok, (SELECT COUNT(*) FROM import_errors);
END;
$$;

SELECT * FROM import_errors ORDER BY row_no;

SELECT order_id, manager_id, wanted_car, budget_usd, destination_city, status
FROM orders
WHERE client_id = (SELECT client_id FROM clients WHERE email = 'vira.labenko@ukr.net')
ORDER BY order_id;
