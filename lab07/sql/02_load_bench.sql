-- =====================================================================
-- Лабораторна робота 7. sql/02_load_bench.sql
-- Завантаження того самого набору даних, що й у MongoDB blog_bench
-- (scripts/14_bench_generate.js -> export/*.csv), у нормалізовану схему.
-- CSV попередньо копіюються в контейнер: docker cp export car_import_db:/tmp/lab07
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off
SET search_path = blog;
TRUNCATE users, categories, tags, posts, post_tags, comments, reactions, post_views, post_versions, notifications RESTART IDENTITY CASCADE;

\timing on
\copy users (user_id, username, email, password_hash, role, full_name, city, created_at, status) FROM '/tmp/lab07/users.csv' WITH (FORMAT csv, HEADER true)
\copy categories (category_id, name, slug, description, parent_id) FROM '/tmp/lab07/categories.csv' WITH (FORMAT csv, HEADER true)
\copy tags (tag_id, slug, name) FROM '/tmp/lab07/tags.csv' WITH (FORMAT csv, HEADER true)
\copy posts (post_id, title, slug, content, excerpt, user_id, category_id, status, views, likes, dislikes, lng, lat, created_at, published_at) FROM '/tmp/lab07/posts.csv' WITH (FORMAT csv, HEADER true)
\copy post_tags (post_id, tag_id) FROM '/tmp/lab07/post_tags.csv' WITH (FORMAT csv, HEADER true)
\copy comments (comment_id, post_id, user_id, parent_id, text, status, likes, created_at) FROM '/tmp/lab07/comments.csv' WITH (FORMAT csv, HEADER true)
\timing off

-- узгодити лічильники IDENTITY з явно вставленими ключами
SELECT setval(pg_get_serial_sequence('blog.users', 'user_id'), (SELECT max(user_id) FROM users));
SELECT setval(pg_get_serial_sequence('blog.categories', 'category_id'), (SELECT max(category_id) FROM categories));
SELECT setval(pg_get_serial_sequence('blog.tags', 'tag_id'), (SELECT max(tag_id) FROM tags));
SELECT setval(pg_get_serial_sequence('blog.posts', 'post_id'), (SELECT max(post_id) FROM posts));
SELECT setval(pg_get_serial_sequence('blog.comments', 'comment_id'), (SELECT max(comment_id) FROM comments));
VACUUM ANALYZE;

\echo 'Кількість рядків і розмір таблиць (дані + індекси + TOAST):'
SELECT relname AS table_name, n_live_tup AS rows,
       pg_size_pretty(pg_table_size(relid)) AS data, pg_size_pretty(pg_indexes_size(relid)) AS indexes,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_stat_user_tables WHERE schemaname = 'blog' AND n_live_tup > 0 ORDER BY pg_total_relation_size(relid) DESC;

SELECT pg_size_pretty(sum(pg_table_size(relid))) AS data_total, pg_size_pretty(sum(pg_indexes_size(relid))) AS indexes_total,
       pg_size_pretty(sum(pg_total_relation_size(relid))) AS all_total
FROM pg_stat_user_tables WHERE schemaname = 'blog';

\echo 'Перевірка цілісності: зовнішній ключ не дозволяє коментар до неіснуючого посту'
\set ON_ERROR_STOP off
INSERT INTO comments (post_id, user_id, text) VALUES (999999, 1, 'Коментар до неіснуючого посту');
