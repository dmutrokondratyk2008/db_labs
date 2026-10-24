-- Лабораторна робота 3. Модифікація даних та транзакції
-- Кондратюк Дмитро, ІПЗ-32
-- Файл 06: версіонування, відкладені операції, бізнес-логіка, ролі, відновлення, історія змін (рівень 3)
-- Запуск: psql -U postgres -d library_lab3 -f sql/06-creative-extensions.sql
-- Файли виконуються по порядку 01 → 06. Помилки ERROR у розділах про ROLLBACK, SAVEPOINT і права доступу очікувані (це демонстрація).

-- ===== Рівень 3. Крок 1. Система версіонування =====

CREATE TABLE books_versions (
    version_id SERIAL PRIMARY KEY,
    book_id INTEGER NOT NULL,
    version_number INTEGER NOT NULL,
    data JSONB NOT NULL,
    valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    valid_to TIMESTAMP,
    created_by VARCHAR(100) DEFAULT CURRENT_USER,
    UNIQUE(book_id, version_number)
);

CREATE OR REPLACE FUNCTION create_book_version()
RETURNS TRIGGER AS $$
DECLARE
    v_version_number INTEGER;
BEGIN
    UPDATE books_versions
    SET valid_to = CURRENT_TIMESTAMP
    WHERE book_id = NEW.book_id AND valid_to IS NULL;

    SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_version_number
    FROM books_versions
    WHERE book_id = NEW.book_id;

    INSERT INTO books_versions (book_id, version_number, data)
    VALUES (NEW.book_id, v_version_number, row_to_json(NEW)::jsonb);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER book_versioning_trigger
AFTER INSERT OR UPDATE ON books
FOR EACH ROW
EXECUTE FUNCTION create_book_version();

CREATE OR REPLACE FUNCTION get_book_version(p_book_id INTEGER, p_date TIMESTAMP)
RETURNS JSONB AS $$
BEGIN
    RETURN (
        SELECT data
        FROM books_versions
        WHERE book_id = p_book_id
            AND valid_from <= p_date
            AND (valid_to IS NULL OR valid_to > p_date)
        LIMIT 1
    );
END;
$$ LANGUAGE plpgsql;

INSERT INTO books (isbn, title, author_id, publication_year, genre, total_copies, available_copies)
VALUES ('978-966-03-7777-7', 'Версійована книга', 3, 2020, 'Тест', 10, 10);

SELECT pg_sleep(1);

UPDATE books SET available_copies = 8 WHERE isbn = '978-966-03-7777-7';

SELECT pg_sleep(1);

UPDATE books SET available_copies = 5, genre = 'Оновлений жанр' WHERE isbn = '978-966-03-7777-7';

SELECT version_id, book_id, version_number,
       data->>'title' AS title,
       data->>'available_copies' AS copies,
       data->>'genre' AS genre,
       to_char(valid_from, 'YYYY-MM-DD HH24:MI:SS') AS valid_from,
       to_char(valid_to, 'YYYY-MM-DD HH24:MI:SS') AS valid_to
FROM books_versions
WHERE book_id = (SELECT book_id FROM books WHERE isbn = '978-966-03-7777-7')
ORDER BY version_number;

SELECT jsonb_pretty(get_book_version(
    (SELECT book_id FROM books WHERE isbn = '978-966-03-7777-7'),
    (SELECT valid_from FROM books_versions
     WHERE book_id = (SELECT book_id FROM books WHERE isbn = '978-966-03-7777-7')
       AND version_number = 2)
));

-- ===== Рівень 3. Крок 2. Відкладені операції =====

CREATE TABLE scheduled_operations (
    operation_id SERIAL PRIMARY KEY,
    operation_type VARCHAR(50) NOT NULL,
    target_table VARCHAR(50) NOT NULL,
    operation_data JSONB NOT NULL,
    scheduled_for TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Executed', 'Failed', 'Cancelled')),
    executed_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION execute_scheduled_operations()
RETURNS INTEGER AS $$
DECLARE
    v_operation RECORD;
    v_count INTEGER := 0;
BEGIN
    FOR v_operation IN
        SELECT * FROM scheduled_operations
        WHERE status = 'Pending' AND scheduled_for <= CURRENT_TIMESTAMP
        ORDER BY operation_id
    LOOP
        BEGIN
            CASE v_operation.operation_type
                WHEN 'UPDATE_BOOK_STATUS' THEN
                    UPDATE books
                    SET available_copies = (v_operation.operation_data->>'available_copies')::INTEGER
                    WHERE book_id = (v_operation.operation_data->>'book_id')::INTEGER;

                WHEN 'EXPIRE_RESERVATION' THEN
                    UPDATE reservations
                    SET status = 'Expired'
                    WHERE reservation_id = (v_operation.operation_data->>'reservation_id')::INTEGER;

                WHEN 'BLOCK_READER' THEN
                    UPDATE readers
                    SET status = 'Blocked'
                    WHERE reader_id = (v_operation.operation_data->>'reader_id')::INTEGER;

                WHEN 'CREATE_BACKUP' THEN
                    PERFORM create_backup_point(
                        COALESCE(v_operation.operation_data->>'name', 'scheduled_checkpoint'),
                        'Створено відкладеною операцією');
            END CASE;

            UPDATE scheduled_operations
            SET status = 'Executed', executed_at = CURRENT_TIMESTAMP
            WHERE operation_id = v_operation.operation_id;

            v_count := v_count + 1;
        EXCEPTION WHEN OTHERS THEN
            UPDATE scheduled_operations
            SET status = 'Failed',
                executed_at = CURRENT_TIMESTAMP,
                error_message = SQLERRM
            WHERE operation_id = v_operation.operation_id;
        END;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

INSERT INTO reservations (book_id, reader_id, expiration_date, status)
VALUES (2, 3, CURRENT_TIMESTAMP + INTERVAL '1 minute', 'Active')
RETURNING reservation_id;

INSERT INTO scheduled_operations (operation_type, target_table, operation_data, scheduled_for)
VALUES
    ('EXPIRE_RESERVATION', 'reservations',
     jsonb_build_object('reservation_id', (SELECT MAX(reservation_id) FROM reservations)),
     CURRENT_TIMESTAMP + INTERVAL '30 seconds'),
    ('BLOCK_READER', 'readers', jsonb_build_object('reader_id', 4), CURRENT_TIMESTAMP + INTERVAL '30 seconds'),
    ('UNKNOWN_OP', 'books', '{}'::jsonb, CURRENT_TIMESTAMP + INTERVAL '30 seconds')
RETURNING operation_id, operation_type, scheduled_for;

SELECT execute_scheduled_operations();

SELECT operation_id, operation_type, status, executed_at FROM scheduled_operations ORDER BY operation_id;

-- У лабораторній функцію запускали циклом: SELECT execute_scheduled_operations() AS executed \watch 10
-- У скрипті чекаємо 31 секунду замість \watch
SELECT pg_sleep(31);
SELECT execute_scheduled_operations() AS executed;

SELECT operation_id, operation_type, status, executed_at, error_message
FROM scheduled_operations ORDER BY operation_id;

SELECT reservation_id, status FROM reservations
WHERE reservation_id = (SELECT MAX(reservation_id) FROM reservations);

SELECT reader_id, status FROM readers WHERE reader_id = 4;

UPDATE readers SET status = 'Active' WHERE reader_id = 4;

-- ===== Рівень 3. Крок 3. Складна бізнес-логіка =====

CREATE OR REPLACE FUNCTION extend_lending(
    p_lending_id INTEGER,
    p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    new_due_date DATE
) AS $$
DECLARE
    v_reader_status VARCHAR(20);
    v_overdue_count INTEGER;
    v_current_due_date DATE;
    v_reader_id INTEGER;
BEGIN
    SELECT r.status, l.due_date, l.reader_id
    INTO v_reader_status, v_current_due_date, v_reader_id
    FROM lendings l
    JOIN readers r ON l.reader_id = r.reader_id
    WHERE l.lending_id = p_lending_id AND l.return_date IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Видача не знайдена або книга вже повернена'::TEXT, NULL::DATE;
        RETURN;
    END IF;

    IF v_reader_status = 'Blocked' THEN
        RETURN QUERY SELECT FALSE, 'Читач заблокований'::TEXT, NULL::DATE;
        RETURN;
    END IF;

    SELECT COUNT(*)
    INTO v_overdue_count
    FROM lendings
    WHERE reader_id = v_reader_id
        AND return_date IS NULL
        AND due_date < CURRENT_DATE;

    IF v_overdue_count > 0 THEN
        RETURN QUERY SELECT FALSE, 'У читача є прострочені книги'::TEXT, NULL::DATE;
        RETURN;
    END IF;

    UPDATE lendings
    SET due_date = due_date + p_days
    WHERE lending_id = p_lending_id;

    RETURN QUERY SELECT TRUE, 'Термін продовжено'::TEXT, (v_current_due_date + p_days)::DATE;
END;
$$ LANGUAGE plpgsql;

INSERT INTO lendings (book_id, reader_id, due_date)
VALUES (4, 3, CURRENT_DATE + 7)
RETURNING lending_id, due_date;

SELECT * FROM extend_lending(
    (SELECT lending_id FROM lendings WHERE book_id = 4 AND reader_id = 3 AND return_date IS NULL), 14);

INSERT INTO lendings (book_id, reader_id, due_date)
VALUES (2, 2, CURRENT_DATE + 7)
RETURNING lending_id, due_date;

-- 2. Заблокований читач
UPDATE readers SET status = 'Blocked' WHERE reader_id = 2;
SELECT * FROM extend_lending(
    (SELECT lending_id FROM lendings WHERE book_id = 2 AND reader_id = 2 AND return_date IS NULL), 7);

-- 3. У читача є прострочена видача
UPDATE readers SET status = 'Active' WHERE reader_id = 2;
INSERT INTO lendings (book_id, reader_id, lending_date, due_date)
VALUES (3, 2, CURRENT_DATE - 20, CURRENT_DATE - 5);
SELECT * FROM extend_lending(
    (SELECT lending_id FROM lendings WHERE book_id = 2 AND reader_id = 2 AND return_date IS NULL), 7);

-- 4. Видача вже повернена
SELECT * FROM extend_lending(1, 7);

SELECT lending_id, book_id, reader_id, lending_date, due_date, return_date FROM lendings ORDER BY lending_id;

-- ===== Рівень 3. Крок 4. Система прав доступу =====

CREATE ROLE librarian_read;
CREATE ROLE librarian_write;
CREATE ROLE library_admin;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO librarian_read;

GRANT SELECT, INSERT, UPDATE ON books, lendings, reservations TO librarian_write;
GRANT DELETE ON reservations TO librarian_write;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO librarian_write;
GRANT INSERT ON audit_log TO librarian_write;
GRANT SELECT, INSERT, UPDATE ON books_versions TO librarian_write;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO library_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO library_admin;

CREATE USER librarian1 WITH PASSWORD 'secure_password1';
CREATE USER librarian2 WITH PASSWORD 'secure_password2';
CREATE USER admin1 WITH PASSWORD 'admin_password';

GRANT librarian_read TO librarian1;
GRANT librarian_write TO librarian2;
GRANT library_admin TO admin1;

SET ROLE librarian1;
SELECT book_id, title, available_copies FROM books WHERE book_id = 1;
UPDATE books SET available_copies = 5 WHERE book_id = 1;
RESET ROLE;

SET ROLE librarian2;
UPDATE books SET available_copies = available_copies + 1 WHERE book_id = 1 RETURNING book_id, title, available_copies;
DELETE FROM authors WHERE author_id = 1;
RESET ROLE;

SET ROLE admin1;
INSERT INTO authors (first_name, last_name, birth_year, country) VALUES ('Адмін', 'Тест', 1990, 'Україна') RETURNING author_id;
DELETE FROM authors WHERE last_name = 'Тест' RETURNING author_id;
RESET ROLE;

SELECT log_id, operation, record_id, changed_by
FROM audit_log WHERE table_name = 'books' ORDER BY log_id DESC LIMIT 3;

-- ===== Рівень 3. Крок 5. Контрольні точки та відновлення даних =====

CREATE TABLE backup_points (
    backup_id SERIAL PRIMARY KEY,
    backup_name VARCHAR(100) NOT NULL,
    backup_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT,
    data_snapshot JSONB
);

CREATE OR REPLACE FUNCTION create_backup_point(p_name TEXT, p_description TEXT DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
    v_backup_id INTEGER;
BEGIN
    INSERT INTO backup_points (backup_name, description, data_snapshot)
    VALUES (p_name, p_description, jsonb_build_object(
        'authors',      COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM authors a), '[]'::jsonb),
        'books',        COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM books b), '[]'::jsonb),
        'readers',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM readers r), '[]'::jsonb),
        'lendings',     COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM lendings l), '[]'::jsonb),
        'reservations', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM reservations x), '[]'::jsonb)
    ))
    RETURNING backup_id INTO v_backup_id;

    RETURN v_backup_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION restore_from_backup(p_backup_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    v_snapshot JSONB;
BEGIN
    SELECT data_snapshot INTO v_snapshot FROM backup_points WHERE backup_id = p_backup_id;

    IF v_snapshot IS NULL THEN
        RAISE EXCEPTION 'Backup point % not found', p_backup_id;
    END IF;

    -- на час відновлення вимикаємо користувацькі тригери таблиці books (аудит, версії)
    ALTER TABLE books DISABLE TRIGGER USER;

    TRUNCATE TABLE lendings, reservations, books, readers, authors;

    INSERT INTO authors      SELECT * FROM jsonb_populate_recordset(NULL::authors, v_snapshot->'authors');
    INSERT INTO readers      SELECT * FROM jsonb_populate_recordset(NULL::readers, v_snapshot->'readers');
    INSERT INTO books        SELECT * FROM jsonb_populate_recordset(NULL::books, v_snapshot->'books');
    INSERT INTO lendings     SELECT * FROM jsonb_populate_recordset(NULL::lendings, v_snapshot->'lendings');
    INSERT INTO reservations SELECT * FROM jsonb_populate_recordset(NULL::reservations, v_snapshot->'reservations');

    ALTER TABLE books ENABLE TRIGGER USER;

    -- вирівнюємо лічильники SERIAL, щоб нові записи не конфліктували з відновленими
    PERFORM setval(pg_get_serial_sequence('authors', 'author_id'), COALESCE((SELECT MAX(author_id) FROM authors), 1));
    PERFORM setval(pg_get_serial_sequence('books', 'book_id'), COALESCE((SELECT MAX(book_id) FROM books), 1));
    PERFORM setval(pg_get_serial_sequence('readers', 'reader_id'), COALESCE((SELECT MAX(reader_id) FROM readers), 1));
    PERFORM setval(pg_get_serial_sequence('lendings', 'lending_id'), COALESCE((SELECT MAX(lending_id) FROM lendings), 1));
    PERFORM setval(pg_get_serial_sequence('reservations', 'reservation_id'), COALESCE((SELECT MAX(reservation_id) FROM reservations), 1));

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auto_backup_before_delete()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM create_backup_point('auto_before_delete_books',
        'Автоматична контрольна точка перед DELETE з books, користувач ' || CURRENT_USER);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER books_auto_backup_trigger
BEFORE DELETE ON books
FOR EACH STATEMENT
EXECUTE FUNCTION auto_backup_before_delete();

SELECT create_backup_point('Before major update', 'Backup before system upgrade') AS bid \gset

SELECT backup_id, backup_name, backup_timestamp,
       jsonb_array_length(data_snapshot->'books') AS books_in_snapshot,
       jsonb_array_length(data_snapshot->'lendings') AS lendings_in_snapshot
FROM backup_points;

SELECT (SELECT COUNT(*) FROM lendings) AS lendings,
       (SELECT COUNT(*) FROM readers WHERE status = 'Blocked') AS blocked_readers;

DELETE FROM lendings;
UPDATE readers SET status = 'Blocked';

SELECT (SELECT COUNT(*) FROM lendings) AS lendings,
       (SELECT COUNT(*) FROM readers WHERE status = 'Blocked') AS blocked_readers;

SELECT restore_from_backup(:bid);

SELECT (SELECT COUNT(*) FROM lendings) AS lendings,
       (SELECT COUNT(*) FROM readers WHERE status = 'Blocked') AS blocked_readers;

INSERT INTO books (isbn, title, author_id, publication_year, genre, total_copies, available_copies)
VALUES ('978-966-03-8888-8', 'Тимчасова книга', 2, 2024, 'Тест', 1, 1);

DELETE FROM books WHERE isbn = '978-966-03-8888-8';

SELECT backup_id, backup_name, description,
       to_char(backup_timestamp, 'YYYY-MM-DD HH24:MI:SS') AS created
FROM backup_points ORDER BY backup_id;

INSERT INTO scheduled_operations (operation_type, target_table, operation_data, scheduled_for)
VALUES ('CREATE_BACKUP', 'backup_points', jsonb_build_object('name', 'scheduled_checkpoint'), CURRENT_TIMESTAMP);

SELECT execute_scheduled_operations();

SELECT backup_id, backup_name, description FROM backup_points ORDER BY backup_id;

-- ===== Рівень 3. Крок 6. Інтерфейс перегляду та відкату змін =====

CREATE VIEW books_change_history AS
SELECT
    a.log_id,
    a.operation,
    a.record_id AS book_id,
    COALESCE(a.new_data->>'title', a.old_data->>'title') AS title,
    CASE
        WHEN a.operation = 'INSERT' THEN 'Додано нову книгу'
        WHEN a.operation = 'UPDATE' THEN
            'Оновлено: ' ||
            CASE
                WHEN (a.old_data->>'available_copies') <> (a.new_data->>'available_copies')
                THEN 'Доступні примірники: ' || (a.old_data->>'available_copies') || ' → ' || (a.new_data->>'available_copies')
                ELSE 'Інші поля'
            END
        WHEN a.operation = 'DELETE' THEN 'Видалено книгу'
    END AS change_description,
    a.changed_at,
    a.changed_by
FROM audit_log a
WHERE a.table_name = 'books';

GRANT SELECT ON books_change_history TO librarian_read;

CREATE OR REPLACE FUNCTION get_changes_report(
    p_start_date TIMESTAMP,
    p_end_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
RETURNS TABLE (
    change_date DATE,
    total_changes BIGINT,
    inserts BIGINT,
    updates BIGINT,
    deletes BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT DATE(al.changed_at),
           COUNT(*),
           COUNT(*) FILTER (WHERE al.operation = 'INSERT'),
           COUNT(*) FILTER (WHERE al.operation = 'UPDATE'),
           COUNT(*) FILTER (WHERE al.operation = 'DELETE')
    FROM audit_log al
    WHERE al.changed_at BETWEEN p_start_date AND p_end_date
    GROUP BY DATE(al.changed_at)
    ORDER BY DATE(al.changed_at) DESC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION rollback_book_changes(p_since TIMESTAMP)
RETURNS INTEGER AS $$
DECLARE
    r RECORD;
    v_max_log INTEGER;
    v_count INTEGER := 0;
BEGIN
    SELECT COALESCE(MAX(log_id), 0) INTO v_max_log FROM audit_log;

    FOR r IN
        SELECT * FROM audit_log
        WHERE table_name = 'books' AND changed_at >= p_since AND log_id <= v_max_log
        ORDER BY log_id DESC
    LOOP
        IF r.operation = 'INSERT' THEN
            DELETE FROM books WHERE book_id = r.record_id;
        ELSIF r.operation = 'UPDATE' THEN
            UPDATE books b
            SET isbn = o.isbn, title = o.title, author_id = o.author_id,
                publication_year = o.publication_year, genre = o.genre,
                total_copies = o.total_copies, available_copies = o.available_copies
            FROM jsonb_populate_record(NULL::books, r.old_data) o
            WHERE b.book_id = r.record_id;
        ELSIF r.operation = 'DELETE' THEN
            INSERT INTO books SELECT * FROM jsonb_populate_record(NULL::books, r.old_data);
        END IF;
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

SELECT log_id, operation, book_id, title, change_description, changed_by
FROM books_change_history
ORDER BY log_id DESC
LIMIT 10;

SELECT * FROM get_changes_report(CURRENT_DATE - INTERVAL '30 days');

SELECT CURRENT_TIMESTAMP::timestamp AS t0 \gset
SELECT pg_sleep(1);

SELECT book_id, title, available_copies FROM books WHERE book_id = 3;

UPDATE books SET available_copies = available_copies - 2 WHERE book_id = 3;

INSERT INTO books (isbn, title, author_id, publication_year, genre, total_copies, available_copies)
VALUES ('978-966-03-6666-6', 'Помилкова книга', 1, 2024, 'Тест', 2, 2);

SELECT log_id, operation, book_id, title, change_description
FROM books_change_history
WHERE changed_at >= :'t0'::timestamp
ORDER BY log_id;

SELECT rollback_book_changes(:'t0'::timestamp) AS reverted_operations;

SELECT book_id, title, available_copies FROM books WHERE book_id = 3;
SELECT COUNT(*) AS wrong_book FROM books WHERE isbn = '978-966-03-6666-6';

-- ===== Рівень 3. Додатково: рівні ізоляції транзакцій =====

-- T1
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT available_copies FROM books WHERE book_id = 3;

-- T2 (друге вікно psql):
--   UPDATE books SET available_copies = available_copies - 1 WHERE book_id = 3 RETURNING available_copies;

-- T1: друге читання в тій самій транзакції повертає те саме значення
SELECT available_copies FROM books WHERE book_id = 3;
COMMIT;
-- після COMMIT T1 бачить нове значення
SELECT available_copies FROM books WHERE book_id = 3;

-- ===== Рівень 3. Підсумковий огляд об'єктів бази =====

\dt
\dv
\df
