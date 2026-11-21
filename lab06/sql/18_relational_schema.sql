-- =====================================================================
-- Лабораторна робота 6. 18_relational_schema.sql
-- Реляційна модель тієї самої бібліотеки в PostgreSQL 17 (база
-- library_rel у контейнері car_import_db з ЛР4) і міграція даних з
-- MongoDB: документи, вивантажені mongoexport (NDJSON), читаються в
-- проміжні таблиці jsonb і розкладаються по нормалізованих таблицях.
-- Запуск: psql -U postgres -d library_rel -f /lab06/18_relational_schema.sql
-- =====================================================================
\set ON_ERROR_STOP on
\timing off
SET client_min_messages = warning;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- ---------------------------------------------------------------------
-- 1. Нормалізована схема (3НФ)
-- ---------------------------------------------------------------------
CREATE TABLE authors (
    author_id    serial PRIMARY KEY,
    name         varchar(100) NOT NULL UNIQUE,
    real_name    varchar(100),
    birth_year   int NOT NULL CHECK (birth_year BETWEEN 900 AND 2026),
    death_year   int CHECK (death_year >= birth_year),
    nationality  varchar(50) NOT NULL,
    birth_place  varchar(100),
    birth_region varchar(100),
    biography    text
);
CREATE TABLE author_pseudonyms (               -- масив pseudonyms
    author_id int REFERENCES authors ON DELETE CASCADE,
    pseudonym varchar(100),
    PRIMARY KEY (author_id, pseudonym)
);
CREATE TABLE publishers (                      -- вкладений документ publisher
    publisher_id serial PRIMARY KEY,
    name         varchar(100) NOT NULL,
    city         varchar(50),
    UNIQUE (name, city)
);
CREATE TABLE books (
    book_id          serial PRIMARY KEY,
    title            varchar(200) NOT NULL,
    author_id        int NOT NULL REFERENCES authors,
    publisher_id     int REFERENCES publishers,
    publication_year int NOT NULL CHECK (publication_year BETWEEN 1000 AND 2100),
    pages            int CHECK (pages BETWEEN 1 AND 10000),
    isbn             varchar(20) UNIQUE CHECK (isbn ~ '^978-\d{1,5}-\d{1,7}-\d{1,7}-\d$'),
    available        boolean NOT NULL DEFAULT true,
    description      text,
    rating           numeric(2,1),
    version          int NOT NULL DEFAULT 1
);
CREATE TABLE genres (
    genre_id   serial PRIMARY KEY,
    genre_name varchar(50) NOT NULL UNIQUE
);
CREATE TABLE book_genres (                     -- масив genres (M:N)
    book_id  int REFERENCES books ON DELETE CASCADE,
    genre_id int REFERENCES genres,
    PRIMARY KEY (book_id, genre_id)
);
CREATE TABLE users (
    user_id           serial PRIMARY KEY,
    username          varchar(32) NOT NULL UNIQUE CHECK (username ~ '^[a-z][a-z0-9_]{2,31}$'),
    full_name         varchar(100),
    email             varchar(100) NOT NULL UNIQUE,
    phone             varchar(20),
    status            varchar(10) NOT NULL CHECK (status IN ('active', 'suspended', 'blocked')),
    registration_date date NOT NULL,
    city              varchar(50),
    street            varchar(100)
);
CREATE TABLE loans (                           -- масив borrowed_books
    user_id   int REFERENCES users ON DELETE CASCADE,
    book_id   int REFERENCES books,
    PRIMARY KEY (user_id, book_id)
);
CREATE TABLE ratings (                         -- масив вкладених документів ratings
    book_id  int REFERENCES books ON DELETE CASCADE,
    username varchar(32) NOT NULL,
    score    int NOT NULL CHECK (score BETWEEN 1 AND 5),
    rated_at date
);
CREATE TABLE fines (                           -- масив вкладених документів fines
    fine_id serial PRIMARY KEY,
    user_id int REFERENCES users ON DELETE CASCADE,
    amount  numeric(8,2) NOT NULL CHECK (amount >= 0),
    reason  varchar(100),
    paid    boolean NOT NULL
);
CREATE INDEX ON books (author_id);
CREATE INDEX ON book_genres (genre_id);

-- ---------------------------------------------------------------------
-- 2. Міграція з MongoDB: NDJSON -> jsonb -> таблиці
-- (FORMAT csv з неможливими QUOTE/DELIMITER читає кожен рядок цілком,
--  не інтерпретуючи зворотні скісні риски в JSON)
-- ---------------------------------------------------------------------
CREATE TEMP TABLE s_authors (doc jsonb);
CREATE TEMP TABLE s_books   (doc jsonb);
CREATE TEMP TABLE s_users   (doc jsonb);
\copy s_authors FROM '/lab06/export/authors.json' WITH (FORMAT csv, QUOTE e'\x01', DELIMITER e'\x02')
\copy s_books   FROM '/lab06/export/books.json'   WITH (FORMAT csv, QUOTE e'\x01', DELIMITER e'\x02')
\copy s_users   FROM '/lab06/export/users.json'   WITH (FORMAT csv, QUOTE e'\x01', DELIMITER e'\x02')

INSERT INTO authors (name, real_name, birth_year, death_year, nationality, birth_place, birth_region, biography)
SELECT doc->>'name', doc->>'real_name', (doc->>'birth_year')::int, (doc->>'death_year')::int, doc->>'nationality',
       coalesce(doc->'birthplace'->>'city', doc->'birthplace'->>'village'), doc->'birthplace'->>'region', doc->>'biography'
FROM s_authors;

INSERT INTO author_pseudonyms
SELECT a.author_id, p FROM s_authors s JOIN authors a ON a.name = s.doc->>'name',
       jsonb_array_elements_text(s.doc->'pseudonyms') AS p;

INSERT INTO publishers (name, city)
SELECT DISTINCT doc->'publisher'->>'name', doc->'publisher'->>'city' FROM s_books WHERE doc ? 'publisher';

INSERT INTO books (title, author_id, publisher_id, publication_year, pages, isbn, available, description, version)
SELECT s.doc->>'title', a.author_id, p.publisher_id, (s.doc->>'publication_year')::int, (s.doc->>'pages')::int,
       s.doc->>'isbn', (s.doc->>'available')::boolean, s.doc->>'description', coalesce((s.doc->>'version')::int, 1)
FROM s_books s
JOIN authors a ON a.name = s.doc->>'author'
LEFT JOIN publishers p ON p.name = s.doc->'publisher'->>'name' AND p.city = s.doc->'publisher'->>'city';

INSERT INTO genres (genre_name)
SELECT DISTINCT jsonb_array_elements_text(doc->'genres') FROM s_books;

INSERT INTO book_genres
SELECT b.book_id, g.genre_id
FROM s_books s JOIN books b ON b.isbn = s.doc->>'isbn',
     jsonb_array_elements_text(s.doc->'genres') AS gn JOIN genres g ON g.genre_name = gn;

INSERT INTO ratings (book_id, username, score, rated_at)
SELECT b.book_id, r->>'user', (r->>'score')::int, (r->'date'->>'$date')::date
FROM s_books s JOIN books b ON b.isbn = s.doc->>'isbn', jsonb_array_elements(s.doc->'ratings') AS r;

INSERT INTO users (username, full_name, email, phone, status, registration_date, city, street)
SELECT doc->>'username', doc->>'full_name', doc->>'email', doc->>'phone', doc->>'status',
       (doc->'registration_date'->>'$date')::date, doc->'address'->>'city', doc->'address'->>'street'
FROM s_users;

INSERT INTO loans
SELECT u.user_id, b.book_id
FROM s_users s JOIN users u ON u.username = s.doc->>'username',
     jsonb_array_elements_text(s.doc->'borrowed_books') AS t JOIN books b ON b.title = t;

INSERT INTO fines (user_id, amount, reason, paid)
SELECT u.user_id, (f->>'amount')::numeric, f->>'reason', (f->>'paid')::boolean
FROM s_users s JOIN users u ON u.username = s.doc->>'username', jsonb_array_elements(s.doc->'fines') AS f;

-- ---------------------------------------------------------------------
-- 3. Результат міграції: 3 колекції MongoDB -> 11 таблиць
-- ---------------------------------------------------------------------
SELECT 'mongo: authors / books / users' AS source,
       (SELECT count(*) FROM s_authors) || ' / ' || (SELECT count(*) FROM s_books) || ' / ' ||
       (SELECT count(*) FROM s_users) AS documents;

SELECT t AS "таблиця", n AS "рядків" FROM (VALUES
    ('authors', (SELECT count(*) FROM authors)), ('author_pseudonyms', (SELECT count(*) FROM author_pseudonyms)),
    ('publishers', (SELECT count(*) FROM publishers)), ('books', (SELECT count(*) FROM books)),
    ('genres', (SELECT count(*) FROM genres)), ('book_genres', (SELECT count(*) FROM book_genres)),
    ('ratings', (SELECT count(*) FROM ratings)), ('users', (SELECT count(*) FROM users)),
    ('loans', (SELECT count(*) FROM loans)), ('fines', (SELECT count(*) FROM fines))) AS v(t, n);
