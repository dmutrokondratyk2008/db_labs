-- Лабораторна робота 3. Модифікація даних та транзакції
-- Кондратюк Дмитро, ІПЗ-32
-- Файл 02: початкові дані (рівень 1, крок 2)
-- Запуск: psql -U postgres -d library_lab3 -f sql/02-insert-data.sql
-- Файли виконуються по порядку 01 → 06. Помилки ERROR у розділах про ROLLBACK, SAVEPOINT і права доступу очікувані (це демонстрація).

-- ===== Рівень 1. Крок 2. Додавання тестових даних =====

INSERT INTO authors (first_name, last_name, birth_year, country)
VALUES
    ('Тарас', 'Шевченко', 1814, 'Україна'),
    ('Іван', 'Франко', 1856, 'Україна'),
    ('Леся', 'Українка', 1871, 'Україна'),
    ('Михайло', 'Коцюбинський', 1864, 'Україна'),
    ('Панас', 'Мирний', 1849, 'Україна');

INSERT INTO books (isbn, title, author_id, publication_year, genre, total_copies, available_copies)
VALUES
    ('978-966-03-4561-2', 'Кобзар', 1, 1840, 'Поезія', 10, 8),
    ('978-966-03-4562-9', 'Захар Беркут', 2, 1883, 'Історична проза', 5, 4),
    ('978-966-03-4563-6', 'Лісова пісня', 3, 1911, 'Драма', 7, 7),
    ('978-966-03-4564-3', 'Тіні забутих предків', 4, 1911, 'Повість', 6, 5),
    ('978-966-03-4565-0', 'Хіба ревуть воли, як ясла повні', 5, 1880, 'Повість', 4, 4);

INSERT INTO readers (first_name, last_name, email, phone, library_card_number)
VALUES
    ('Олена', 'Петренко', 'olena.petrenko@email.com', '+380501234567', 'LIB-2024-001'),
    ('Андрій', 'Коваленко', 'andrii.kovalenko@email.com', '+380502345678', 'LIB-2024-002'),
    ('Марія', 'Сидоренко', 'maria.sydorenko@email.com', '+380503456789', 'LIB-2024-003'),
    ('Іван', 'Мельник', 'ivan.melnyk@email.com', '+380504567890', 'LIB-2024-004');

SELECT * FROM authors ORDER BY birth_year;
SELECT book_id, title, total_copies, available_copies FROM books ORDER BY book_id;
SELECT reader_id, first_name, last_name, status FROM readers ORDER BY reader_id;
