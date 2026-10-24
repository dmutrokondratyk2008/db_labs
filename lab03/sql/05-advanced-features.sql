-- Лабораторна робота 3. Модифікація даних та транзакції
-- Кондратюк Дмитро, ІПЗ-32
-- Файл 05: нові таблиці, складна транзакція, каскади, тригер аудиту, блокування (рівень 2, кроки 1, 2, 4, 5, 6)
-- Запуск: psql -U postgres -d library_lab3 -f sql/05-advanced-features.sql
-- Файли виконуються по порядку 01 → 06. Помилки ERROR у розділах про ROLLBACK, SAVEPOINT і права доступу очікувані (це демонстрація).

-- ===== Рівень 2. Крок 1. Додавання нових таблиць =====

CREATE TABLE reservations (
    reservation_id SERIAL PRIMARY KEY,
    book_id INTEGER NOT NULL,
    reader_id INTEGER NOT NULL,
    reservation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiration_date TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Fulfilled', 'Cancelled', 'Expired')),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE,
    FOREIGN KEY (reader_id) REFERENCES readers(reader_id) ON DELETE CASCADE
);

CREATE TABLE audit_log (
    log_id SERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    operation VARCHAR(10) NOT NULL,
    record_id INTEGER NOT NULL,
    old_data JSONB,
    new_data JSONB,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    changed_by VARCHAR(100) DEFAULT CURRENT_USER
);

-- ===== Рівень 2. Крок 2. Складні транзакції =====

INSERT INTO reservations (book_id, reader_id, expiration_date)
VALUES (1, 2, CURRENT_TIMESTAMP + INTERVAL '3 days')
RETURNING reservation_id;

BEGIN;

UPDATE lendings
SET return_date = CURRENT_DATE
WHERE lending_id = 1 AND return_date IS NULL
RETURNING lending_id, book_id, reader_id, return_date;

UPDATE books
SET available_copies = available_copies + 1
WHERE book_id = (SELECT book_id FROM lendings WHERE lending_id = 1)
RETURNING book_id, title, available_copies;

SELECT reservation_id, reader_id, reservation_date
FROM reservations
WHERE book_id = 1 AND status = 'Active'
ORDER BY reservation_date
LIMIT 1;

UPDATE reservations
SET status = 'Fulfilled'
WHERE reservation_id = 1
RETURNING reservation_id, status;

COMMIT;

SELECT l.lending_id, b.title,
       r1.first_name || ' ' || r1.last_name AS borrower,
       l.return_date,
       r2.first_name || ' ' || r2.last_name AS next_reader,
       res.status AS reservation_status
FROM lendings l
JOIN books b ON l.book_id = b.book_id
JOIN readers r1 ON l.reader_id = r1.reader_id
LEFT JOIN reservations res ON b.book_id = res.book_id AND res.reservation_id = 1
LEFT JOIN readers r2 ON res.reader_id = r2.reader_id
WHERE l.lending_id = 1;

-- ===== Рівень 2. Крок 4. Каскадні операції =====

BEGIN;

INSERT INTO authors (first_name, last_name, birth_year, country)
VALUES ('Тестовий', 'Автор', 1900, 'Україна')
RETURNING author_id;

INSERT INTO books (isbn, title, author_id, publication_year, genre, total_copies, available_copies)
VALUES ('978-966-00-0000-0', 'Тестова книга',
        (SELECT author_id FROM authors WHERE last_name = 'Автор'),
        2000, 'Тест', 1, 0)
RETURNING book_id;

INSERT INTO reservations (book_id, reader_id, expiration_date)
VALUES ((SELECT book_id FROM books WHERE isbn = '978-966-00-0000-0'), 1, CURRENT_TIMESTAMP + INTERVAL '7 days')
RETURNING reservation_id;

COMMIT;

SELECT b.book_id, b.title, b.isbn, r.reservation_id, r.status
FROM books b
LEFT JOIN reservations r ON b.book_id = r.book_id
WHERE b.isbn = '978-966-00-0000-0';

DELETE FROM books WHERE isbn = '978-966-00-0000-0' RETURNING book_id, title;

SELECT * FROM reservations WHERE reader_id = 1;

DELETE FROM authors WHERE last_name = 'Автор' RETURNING author_id;
DELETE FROM authors WHERE last_name = 'Кобилянська';

CREATE TABLE demo_publishers (publisher_id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL);
CREATE TABLE demo_categories (category_id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL);
CREATE TABLE demo_editions (
    edition_id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    publisher_id INTEGER REFERENCES demo_publishers(publisher_id) ON UPDATE CASCADE ON DELETE SET NULL,
    category_id INTEGER DEFAULT 1 REFERENCES demo_categories(category_id) ON DELETE SET DEFAULT
);

INSERT INTO demo_publishers VALUES (10, 'Видавництво А'), (20, 'Видавництво Б');
INSERT INTO demo_categories VALUES (1, 'Без категорії'), (2, 'Поезія');
INSERT INTO demo_editions (title, publisher_id, category_id) VALUES ('Видання 1', 10, 2), ('Видання 2', 20, 2);

UPDATE demo_publishers SET publisher_id = 11 WHERE publisher_id = 10;
SELECT * FROM demo_editions ORDER BY edition_id;

DELETE FROM demo_publishers WHERE publisher_id = 20;
SELECT * FROM demo_editions ORDER BY edition_id;

DELETE FROM demo_categories WHERE category_id = 2;
SELECT * FROM demo_editions ORDER BY edition_id;

DROP TABLE demo_editions, demo_publishers, demo_categories;

-- ===== Рівень 2. Крок 5. Тригери для аудиту =====

CREATE OR REPLACE FUNCTION log_books_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, operation, record_id, new_data)
        VALUES ('books', 'INSERT', NEW.book_id, row_to_json(NEW)::jsonb);
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, operation, record_id, old_data, new_data)
        VALUES ('books', 'UPDATE', NEW.book_id, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, operation, record_id, old_data)
        VALUES ('books', 'DELETE', OLD.book_id, row_to_json(OLD)::jsonb);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER books_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON books
FOR EACH ROW
EXECUTE FUNCTION log_books_changes();

INSERT INTO books (isbn, title, author_id, publication_year, genre, total_copies, available_copies)
VALUES ('978-966-03-9999-9', 'Нова книга', 2, 2024, 'Сучасна', 5, 5);

UPDATE books SET available_copies = available_copies - 1 WHERE isbn = '978-966-03-9999-9';

DELETE FROM books WHERE isbn = '978-966-03-9999-9';

SELECT log_id, operation, record_id,
       COALESCE(new_data->>'title', old_data->>'title') AS title,
       old_data->>'available_copies' AS old_copies,
       new_data->>'available_copies' AS new_copies,
       to_char(changed_at, 'YYYY-MM-DD HH24:MI:SS') AS changed_time,
       changed_by
FROM audit_log
WHERE table_name = 'books'
ORDER BY log_id DESC
LIMIT 10;

SELECT operation, COUNT(*) AS operations_count
FROM audit_log
WHERE table_name = 'books'
GROUP BY operation;

-- ===== Рівень 2. Крок 6. Блокування записів =====

-- Сесія 1 (T1)
BEGIN;
SELECT book_id, title, available_copies FROM books WHERE book_id = 1 FOR UPDATE;

-- Сесія 2 (T2) у ДРУГОМУ вікні psql, поки T1 не завершила транзакцію:
--   SELECT book_id, title FROM books WHERE book_id = 1 FOR UPDATE NOWAIT;   -- одразу помилка
--   BEGIN;
--   SELECT book_id, title, available_copies FROM books WHERE book_id = 1 FOR UPDATE;   -- очікує на T1

-- Сесія 1: стан сесій, зміна запису і завершення транзакції
SELECT pid, state, wait_event_type, wait_event, left(query, 60) AS query
FROM pg_stat_activity
WHERE datname = 'library_lab3' AND pid <> pg_backend_pid();

UPDATE books SET available_copies = available_copies + 1 WHERE book_id = 1 RETURNING book_id, available_copies;
COMMIT;

-- Сесія 2 після розблокування:
--   UPDATE books SET available_copies = available_copies - 1 WHERE book_id = 1 RETURNING book_id, available_copies;
--   COMMIT;
--   SELECT book_id, title, available_copies FROM books WHERE book_id = 1;

SELECT book_id, title, available_copies FROM books WHERE book_id = 1;
