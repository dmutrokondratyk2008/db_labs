-- Лабораторна робота 3. Модифікація даних та транзакції
-- Кондратюк Дмитро, ІПЗ-32
-- Файл 04: транзакції, ROLLBACK, SAVEPOINT (рівень 1, кроки 4–5; рівень 2, крок 3)
-- Запуск: psql -U postgres -d library_lab3 -f sql/04-transactions.sql
-- Файли виконуються по порядку 01 → 06. Помилки ERROR у розділах про ROLLBACK, SAVEPOINT і права доступу очікувані (це демонстрація).

-- ===== Рівень 1. Крок 4. Операції з транзакціями =====

BEGIN;

INSERT INTO lendings (book_id, reader_id, due_date)
VALUES (1, 1, CURRENT_DATE + INTERVAL '14 days')
RETURNING lending_id, book_id, reader_id, due_date;

UPDATE books
SET available_copies = available_copies - 1
WHERE book_id = 1 AND available_copies > 0
RETURNING book_id, title, available_copies;

SELECT l.lending_id, b.title, r.first_name, r.last_name, l.due_date
FROM lendings l
JOIN books b ON l.book_id = b.book_id
JOIN readers r ON l.reader_id = r.reader_id
WHERE l.lending_id = 1;

COMMIT;

-- ===== Рівень 1. Крок 5. Демонстрація ROLLBACK =====

BEGIN;
SELECT book_id, title FROM books WHERE author_id = 1;
DELETE FROM authors WHERE author_id = 1;

SELECT 1;

ROLLBACK;
SELECT * FROM authors WHERE author_id = 1;

BEGIN;

INSERT INTO lendings (book_id, reader_id, due_date)
VALUES (5, 2, CURRENT_DATE + INTERVAL '7 days');

SELECT COUNT(*) AS lendings_in_transaction FROM lendings WHERE book_id = 5;

UPDATE books SET available_copies = available_copies - 5 WHERE book_id = 5;

ROLLBACK;

SELECT COUNT(*) AS lendings_after_rollback FROM lendings WHERE book_id = 5;
SELECT book_id, title, available_copies FROM books WHERE book_id = 5;

-- ===== Рівень 2. Крок 3. Використання SAVEPOINT =====

BEGIN;

INSERT INTO authors (first_name, last_name, birth_year, country)
VALUES ('Ольга', 'Кобилянська', 1863, 'Україна')
RETURNING author_id;

SAVEPOINT after_author;

INSERT INTO books (isbn, title, author_id, publication_year, genre, total_copies, available_copies)
VALUES ('978-966-03-4566-7', 'Земля',
        (SELECT author_id FROM authors WHERE last_name = 'Кобилянська'),
        1902, 'Роман', 3, 3)
RETURNING book_id, title;

SAVEPOINT after_first_book;

INSERT INTO books (isbn, title, author_id, publication_year, genre)
VALUES ('978-966-03-4566-7', 'Інша книга',
        (SELECT author_id FROM authors WHERE last_name = 'Кобилянська'),
        1905, 'Роман');

ROLLBACK TO SAVEPOINT after_first_book;

INSERT INTO books (isbn, title, author_id, publication_year, genre, total_copies, available_copies)
VALUES ('978-966-03-4567-4', 'Царівна',
        (SELECT author_id FROM authors WHERE last_name = 'Кобилянська'),
        1896, 'Повість', 2, 2)
RETURNING book_id, title;

COMMIT;

SELECT a.first_name, a.last_name, b.book_id, b.title, b.isbn
FROM authors a
JOIN books b ON a.author_id = b.author_id
WHERE a.last_name = 'Кобилянська'
ORDER BY b.book_id;
