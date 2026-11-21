-- =====================================================================
-- Лабораторна робота 6. 19_relational_queries.sql
-- Ті самі запити, що й у MongoDB, на реляційній моделі library_rel:
-- "документ" книги збирається з 6 таблиць, агрегація за жанрами,
-- картки читачів. Порівняння з запитами MongoDB - у звіті.
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off

\echo '=== 1. Доступні книги з автором і жанрами (MongoDB: db.books.find({available: true}) - 1 колекція) ==='
SELECT b.title, a.name AS author, b.publication_year AS year,
       string_agg(g.genre_name, ', ' ORDER BY g.genre_name) AS genres, p.city
FROM books b
JOIN authors a          ON a.author_id = b.author_id
LEFT JOIN publishers p  ON p.publisher_id = b.publisher_id
JOIN book_genres bg     ON bg.book_id = b.book_id
JOIN genres g           ON g.genre_id = bg.genre_id
WHERE b.available
GROUP BY b.book_id, a.name, p.city
ORDER BY b.publication_year
LIMIT 8;

\echo '=== 2. Повний "документ" книги як JSON (аналог findOne з вкладеними полями) ==='
SELECT jsonb_pretty(jsonb_build_object(
    'title', b.title, 'author', a.name, 'year', b.publication_year,
    'publisher', jsonb_build_object('name', p.name, 'city', p.city),
    'genres', (SELECT jsonb_agg(g.genre_name) FROM book_genres bg JOIN genres g USING (genre_id) WHERE bg.book_id = b.book_id),
    'ratings', (SELECT jsonb_agg(jsonb_build_object('user', r.username, 'score', r.score)) FROM ratings r WHERE r.book_id = b.book_id)))
FROM books b JOIN authors a USING (author_id) LEFT JOIN publishers p USING (publisher_id)
WHERE b.title = 'Тіні забутих предків';

\echo '=== 3. Кількість книг за жанрами (MongoDB: $unwind + $group) ==='
SELECT g.genre_name, count(*) AS count
FROM book_genres bg JOIN genres g USING (genre_id)
GROUP BY g.genre_name ORDER BY count DESC, g.genre_name LIMIT 6;

\echo '=== 4. Картки читачів: книги на руках і неоплачені штрафи (MongoDB: view reader_cards) ==='
SELECT u.username, u.status, u.city,
       (SELECT count(*) FROM loans l WHERE l.user_id = u.user_id) AS books_on_hand,
       coalesce((SELECT sum(amount) FROM fines f WHERE f.user_id = u.user_id AND NOT f.paid), 0) AS unpaid_fines
FROM users u
WHERE EXISTS (SELECT 1 FROM fines f WHERE f.user_id = u.user_id AND NOT f.paid)
   OR (SELECT count(*) FROM loans l WHERE l.user_id = u.user_id) >= 2
ORDER BY unpaid_fines DESC, u.username;

\echo '=== 5. Цілісність: видалити автора, на якого посилаються книги, неможливо ==='
\set ON_ERROR_STOP off
DELETE FROM authors WHERE name = 'Іван Франко';
\set ON_ERROR_STOP on
\echo '    (у MongoDB db.authors.deleteOne() виконається, а books.author_id стане "висячим" посиланням)'
