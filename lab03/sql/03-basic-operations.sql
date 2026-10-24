-- Лабораторна робота 3. Модифікація даних та транзакції
-- Кондратюк Дмитро, ІПЗ-32
-- Файл 03: безпечні UPDATE та DELETE (рівень 1, кроки 3 і 6)
-- Запуск: psql -U postgres -d library_lab3 -f sql/03-basic-operations.sql
-- Файли виконуються по порядку 01 → 06. Помилки ERROR у розділах про ROLLBACK, SAVEPOINT і права доступу очікувані (це демонстрація).

-- ===== Рівень 1. Крок 3. Безпечне оновлення записів =====

SELECT book_id, title, total_copies, available_copies FROM books WHERE book_id = 1;

UPDATE books
SET available_copies = available_copies - 1
WHERE book_id = 1 AND available_copies > 0;

SELECT book_id, title, total_copies, available_copies FROM books WHERE book_id = 1;

SELECT COUNT(*) FROM books WHERE genre = 'Поезія';

UPDATE books
SET total_copies = total_copies + 2
WHERE genre = 'Поезія'
RETURNING book_id, title, total_copies, available_copies;

-- ===== Рівень 1. Крок 6. Безпечне видалення =====

SELECT r.reader_id, r.first_name, r.last_name, r.status, COUNT(l.lending_id) AS active_lendings
FROM readers r
LEFT JOIN lendings l ON r.reader_id = l.reader_id AND l.return_date IS NULL
GROUP BY r.reader_id, r.first_name, r.last_name, r.status
HAVING COUNT(l.lending_id) = 0 AND r.status = 'Inactive';

INSERT INTO readers (first_name, last_name, email, library_card_number, status)
VALUES ('Тестовий', 'Читач', 'test@example.com', 'LIB-TEST-001', 'Inactive')
RETURNING reader_id;

DELETE FROM readers
WHERE status = 'Inactive'
  AND reader_id NOT IN (
      SELECT DISTINCT reader_id FROM lendings WHERE return_date IS NULL
  )
RETURNING reader_id, first_name, last_name;

SELECT COUNT(*) FROM readers WHERE email = 'test@example.com';
