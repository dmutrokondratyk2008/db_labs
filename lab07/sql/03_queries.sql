-- =====================================================================
-- Лабораторна робота 7. sql/03_queries.sql
-- Рівень 3, завдання 8. Запити, еквівалентні запитам MongoDB
-- (scripts/15_compare_mongo.js), з EXPLAIN ANALYZE.
-- Номери Q1-Q8 збігаються з тестами bench/compare.js.
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off
SET search_path = blog;

\echo '=== Q1. Сторінка посту: пост + автор + категорія + теги + схвалені коментарі (5 JOIN) ==='
EXPLAIN (ANALYZE, COSTS OFF, TIMING ON, SUMMARY ON)
SELECT p.post_id, p.title, p.content, u.username AS author, c.name AS category,
       (SELECT array_agg(t.slug ORDER BY t.slug) FROM post_tags pt JOIN tags t USING (tag_id) WHERE pt.post_id = p.post_id) AS tags,
       (SELECT json_agg(json_build_object('id', cm.comment_id, 'parent', cm.parent_id, 'author', cu.username, 'text', cm.text) ORDER BY cm.created_at)
          FROM comments cm JOIN users cu ON cu.user_id = cm.user_id
         WHERE cm.post_id = p.post_id AND cm.status = 'approved') AS comments
FROM posts p JOIN users u USING (user_id) JOIN categories c USING (category_id)
WHERE p.slug = 'yuzabiliti-testuvannia-na-piaty-korystuvachakh-1234';

\echo '=== Q2. Стрічка категорії: 10 останніх опублікованих з автором і кількістю коментарів ==='
EXPLAIN (ANALYZE, COSTS OFF, SUMMARY ON)
SELECT p.post_id, p.title, u.username, p.published_at,
       (SELECT count(*) FROM comments cm WHERE cm.post_id = p.post_id AND cm.status = 'approved') AS comments
FROM posts p JOIN users u USING (user_id)
WHERE p.category_id = 3 AND p.status = 'published'
ORDER BY p.published_at DESC LIMIT 10;

\echo '=== Q3. Топ-10 авторів за кількістю опублікованих постів ==='
SELECT u.username, count(*) AS posts, sum(p.views) AS views
FROM posts p JOIN users u USING (user_id)
WHERE p.status = 'published'
GROUP BY u.user_id, u.username ORDER BY posts DESC, views DESC LIMIT 10;
EXPLAIN (ANALYZE, COSTS OFF, SUMMARY ON)
SELECT u.username, count(*) AS posts, sum(p.views) AS views
FROM posts p JOIN users u USING (user_id)
WHERE p.status = 'published'
GROUP BY u.user_id, u.username ORDER BY posts DESC, views DESC LIMIT 10;

\echo '=== Q4. Пости з усіма тегами mongodb і nosql (аналог $all) ==='
EXPLAIN (ANALYZE, COSTS OFF, SUMMARY ON)
SELECT p.post_id, p.title FROM posts p
WHERE p.status = 'published' AND p.post_id IN (
  SELECT pt.post_id FROM post_tags pt JOIN tags t USING (tag_id)
  WHERE t.slug IN ('mongodb', 'nosql') GROUP BY pt.post_id HAVING count(*) = 2)
ORDER BY p.published_at DESC LIMIT 20;

\echo '=== Q5. Повнотекстовий пошук "docker kubernetes" з ранжуванням (аналог $text) ==='
EXPLAIN (ANALYZE, COSTS OFF, SUMMARY ON)
SELECT post_id, title, ts_rank(tsv, q) AS rank
FROM posts, to_tsquery('simple', 'docker | kubernetes') q
WHERE status = 'published' AND tsv @@ q
ORDER BY rank DESC LIMIT 10;

\echo '=== Q6. Пагінація: сторінка 50 по 10 + загальна кількість (аналог $facet) ==='
EXPLAIN (ANALYZE, COSTS OFF, SUMMARY ON)
SELECT post_id, title, published_at, count(*) OVER () AS total
FROM posts WHERE status = 'published'
ORDER BY published_at DESC, post_id DESC OFFSET 490 LIMIT 10;

\echo '=== Q7. Статистика коментарів: загальна і середня на пост ==='
SELECT count(*) AS posts, sum(n) AS comments, round(avg(n), 2) AS avg_per_post, max(n) AS max_per_post
FROM (SELECT p.post_id, count(cm.comment_id) AS n FROM posts p
      LEFT JOIN comments cm ON cm.post_id = p.post_id WHERE p.status = 'published' GROUP BY p.post_id) s;
EXPLAIN (ANALYZE, COSTS OFF, SUMMARY ON)
SELECT count(*) AS posts, sum(n) AS comments, round(avg(n), 2) AS avg_per_post, max(n) AS max_per_post
FROM (SELECT p.post_id, count(cm.comment_id) AS n FROM posts p
      LEFT JOIN comments cm ON cm.post_id = p.post_id WHERE p.status = 'published' GROUP BY p.post_id) s;

\echo '=== Q8. Перейменування користувача: в реляційній моделі змінюється 1 рядок ==='
BEGIN;
EXPLAIN (ANALYZE, COSTS OFF, SUMMARY ON) UPDATE users SET username = 'user7_renamed' WHERE user_id = 7;
ROLLBACK;

\echo '=== Q9. Рекурсивний запит: дерево відповідей на коментар (аналог $graphLookup) ==='
WITH RECURSIVE tree AS (
  SELECT comment_id, parent_id, text, 0 AS level FROM comments WHERE parent_id IS NULL AND post_id = (
    SELECT post_id FROM comments WHERE parent_id IS NOT NULL GROUP BY post_id ORDER BY count(*) DESC, post_id LIMIT 1)
  UNION ALL
  SELECT c.comment_id, c.parent_id, c.text, t.level + 1 FROM comments c JOIN tree t ON c.parent_id = t.comment_id)
SELECT level, count(*) AS comments FROM tree GROUP BY level ORDER BY level;
