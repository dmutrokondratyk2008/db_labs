-- =====================================================================
-- Лабораторна робота 6. 20_relational_bench.sql
-- Ті самі 300 000 книг (books_bench з MongoDB, вивантажені mongoexport)
-- у нормалізованій схемі bench і порівняння трьох запитів, розміру
-- і часу завантаження з MongoDB (17_compare_mongo.js).
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off
SET client_min_messages = warning;
DROP SCHEMA IF EXISTS bench CASCADE;
CREATE SCHEMA bench;
SET search_path = bench, public;

CREATE TABLE authors    (author_id serial PRIMARY KEY, name varchar(100) NOT NULL UNIQUE);
CREATE TABLE publishers (publisher_id serial PRIMARY KEY, name varchar(100), city varchar(50), UNIQUE (name, city));
CREATE TABLE genres     (genre_id serial PRIMARY KEY, genre_name varchar(50) UNIQUE);
CREATE TABLE books (
    book_id serial PRIMARY KEY, title varchar(200) NOT NULL, author_id int NOT NULL REFERENCES authors,
    publisher_id int REFERENCES publishers, publication_year int NOT NULL, pages int, isbn varchar(20) UNIQUE,
    available boolean NOT NULL, rating numeric(2,1));
CREATE TABLE book_genres (book_id int REFERENCES books, genre_id int REFERENCES genres, PRIMARY KEY (book_id, genre_id));

\echo '=== Завантаження і нормалізація 300 000 документів ==='
\timing on
CREATE TEMP TABLE s (doc jsonb);
\copy s FROM '/lab06/export/books_bench.json' WITH (FORMAT csv, QUOTE e'\x01', DELIMITER e'\x02')
INSERT INTO authors (name) SELECT DISTINCT doc->>'author' FROM s;
INSERT INTO publishers (name, city) SELECT DISTINCT doc->'publisher'->>'name', doc->'publisher'->>'city' FROM s;
INSERT INTO genres (genre_name) SELECT DISTINCT jsonb_array_elements_text(doc->'genres') FROM s;
INSERT INTO books (title, author_id, publisher_id, publication_year, pages, isbn, available, rating)
SELECT s.doc->>'title', a.author_id, p.publisher_id, (s.doc->>'publication_year')::int, (s.doc->>'pages')::int,
       s.doc->>'isbn', (s.doc->>'available')::boolean, (s.doc->>'rating')::numeric
FROM s JOIN authors a ON a.name = s.doc->>'author'
       JOIN publishers p ON p.name = s.doc->'publisher'->>'name' AND p.city = s.doc->'publisher'->>'city';
INSERT INTO book_genres
SELECT b.book_id, g.genre_id FROM s JOIN books b ON b.isbn = s.doc->>'isbn',
       jsonb_array_elements_text(s.doc->'genres') AS gn JOIN genres g ON g.genre_name = gn;
-- індекси, аналогічні індексам books_bench у MongoDB
CREATE INDEX ON books (author_id);
CREATE INDEX ON books (publication_year DESC, pages DESC);
CREATE INDEX ON book_genres (genre_id, book_id);
CREATE INDEX ON books (rating DESC) INCLUDE (available, publication_year);
VACUUM ANALYZE authors; VACUUM ANALYZE publishers; VACUUM ANALYZE books; VACUUM ANALYZE book_genres;
\timing off

SELECT (SELECT count(*) FROM authors) AS authors, (SELECT count(*) FROM publishers) AS publishers,
       (SELECT count(*) FROM genres) AS genres, (SELECT count(*) FROM books) AS books,
       (SELECT count(*) FROM book_genres) AS book_genres;

-- Середній час виконання запиту за n повторів (мс)
CREATE OR REPLACE FUNCTION bench.avg_ms(q text, n int DEFAULT 10) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE t timestamptz; total interval := '0'; r record;
BEGIN
  FOR r IN EXECUTE q LOOP END LOOP;                     -- прогрів кешу
  FOR i IN 1..n LOOP
    t := clock_timestamp();
    FOR r IN EXECUTE q LOOP END LOOP;
    total := total + (clock_timestamp() - t);
  END LOOP;
  RETURN round((extract(epoch FROM total) * 1000 / n)::numeric, 2);
END $$;

\echo '=== Q1: книги автора з видавництвом і жанрами (MongoDB: find({author}) без JOIN) ==='
\set q1 'SELECT b.title, b.publication_year, p.name, p.city, array_agg(g.genre_name) FROM bench.books b JOIN bench.authors a USING (author_id) JOIN bench.publishers p USING (publisher_id) JOIN bench.book_genres bg USING (book_id) JOIN bench.genres g USING (genre_id) WHERE a.name = ''Тарас Шевчук-7'' GROUP BY b.book_id, p.name, p.city'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON) :q1;

\echo '=== Q2: топ-10 доступних детективів після 2000 р. за рейтингом ==='
\set q2 'SELECT b.title, b.rating, b.publication_year FROM bench.books b JOIN bench.book_genres bg USING (book_id) JOIN bench.genres g USING (genre_id) WHERE g.genre_name = ''детектив'' AND b.available AND b.publication_year >= 2000 ORDER BY b.rating DESC LIMIT 10'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON) :q2;

\echo '=== Q3: доступні книги за жанрами з середнім рейтингом (агрегація) ==='
\set q3 'SELECT g.genre_name, count(*), round(avg(b.rating), 2), round(avg(b.pages)) FROM bench.books b JOIN bench.book_genres bg USING (book_id) JOIN bench.genres g USING (genre_id) WHERE b.available GROUP BY g.genre_name ORDER BY count(*) DESC LIMIT 5'
:q3;

\echo '=== Середній час 10 повторів, мс ==='
SELECT 'Q1 книги автора + JOIN' AS query, bench.avg_ms(:'q1') AS pg_ms
UNION ALL SELECT 'Q2 жанр+наявність+рік, сорт', bench.avg_ms(:'q2')
UNION ALL SELECT 'Q3 агрегація за жанрами', bench.avg_ms(:'q3', 5);

\echo '=== Розмір: таблиці + індекси ==='
SELECT relname AS "таблиця", pg_size_pretty(pg_table_size(c.oid)) AS "дані",
       pg_size_pretty(pg_indexes_size(c.oid)) AS "індекси"
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'bench' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC;
SELECT pg_size_pretty(sum(pg_table_size(c.oid))) AS "дані разом", pg_size_pretty(sum(pg_indexes_size(c.oid))) AS "індекси разом"
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'bench' AND c.relkind = 'r';
