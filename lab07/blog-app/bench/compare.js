// =====================================================================
// Лабораторна робота 7. bench/compare.js
// Рівень 3, завдання 8. Порівняльні тести продуктивності MongoDB
// (база blog_bench, документна модель) і PostgreSQL 17 (база blog_system,
// схема blog, нормалізована модель) на тих самих даних:
// 2 000 користувачів, 20 000 постів, ~109 000 коментарів.
// Обидві СУБД працюють локально, запити виконуються з одного Node.js-процесу
// через офіційні драйвери (mongodb, pg), послідовно, після прогріву.
// Запуск: node bench/compare.js
// =====================================================================
const { MongoClient } = require('mongodb');
const { Pool } = require('pg');

const mongo = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
const pg = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: process.env.PGPASSWORD || 'password', database: 'blog_system', max: 4 });

// детермінований генератор (однакові параметри для обох СУБД)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickInt = (r, min, max) => min + Math.floor(r() * (max - min + 1));

async function bench(n, fn) {
  const r = rng(42);
  for (let i = 0; i < Math.min(20, n); i++) await fn(r);         // прогрів
  const t = [];
  const r2 = rng(7);
  for (let i = 0; i < n; i++) { const s = process.hrtime.bigint(); await fn(r2); t.push(Number(process.hrtime.bigint() - s) / 1e6); }
  t.sort((a, b) => a - b);
  return { median: t[Math.floor(n / 2)], p95: t[Math.floor(n * 0.95)], n };
}

(async () => {
  await mongo.connect();
  const mdb = mongo.db('blog_bench');
  const posts = mdb.collection('posts'), users = mdb.collection('users'), cats = mdb.collection('categories');
  const q = (text, params) => pg.query({ text, values: params });
  const pgv = (await q('SHOW server_version')).rows[0].server_version;
  const mv = (await mdb.admin().serverInfo()).version;
  console.log(`MongoDB ${mv} (blog_bench)  vs  PostgreSQL ${pgv} (blog_system.blog)`);
  await q('SET search_path = blog');
  const pgc = await pg.connect(); await pgc.query('SET search_path = blog');
  const P = (text, params) => pgc.query(text, params);

  // довідкові відповідності: числові ключі n <-> ObjectId
  const catByN = Object.fromEntries((await cats.find({ type: 'category' }).toArray()).map(c => [c.n, c._id]));
  const userByN = Object.fromEntries((await users.find({}, { projection: { n: 1 } }).toArray()).map(u => [u.n, u._id]));
  const slugs = (await posts.find({}, { projection: { n: 1, slug: 1 } }).sort({ n: 1 }).toArray()).map(p => p.slug);
  const tagPairs = [['mongodb', 'nosql'], ['docker', 'linux'], ['machine-learning', 'python'], ['security', 'owasp'], ['testing', 'jest'],
                    ['react', 'javascript'], ['aws', 'azure'], ['patterns', 'microservices']];
  const words = ['docker', 'kubernetes', 'mongodb', 'тести', 'безпека', 'індекс', 'модель', 'хмара'];

  // ---------------------------------------------------------------
  console.log('\n=== 1. Перевірка еквівалентності результатів ===');
  const eq = [];
  const mTop = await posts.aggregate([{ $match: { status: 'published' } }, { $group: { _id: '$author.username', n: { $sum: 1 }, v: { $sum: '$statistics.views' } } },
    { $sort: { n: -1, v: -1 } }, { $limit: 5 }]).toArray();
  const pTop = (await P(`SELECT u.username, count(*)::int n, sum(p.views)::int v FROM posts p JOIN users u USING (user_id)
    WHERE p.status = 'published' GROUP BY u.username ORDER BY n DESC, v DESC LIMIT 5`)).rows;
  eq.push(['Топ-5 авторів (username, кількість)', mTop.map(x => x._id + ':' + x.n).join(' '), pTop.map(x => x.username + ':' + x.n).join(' ')]);
  const mAll = await posts.countDocuments({ status: 'published', tags: { $all: ['mongodb', 'nosql'] } });
  const pAll = (await P(`SELECT count(*)::int c FROM posts p WHERE status = 'published' AND post_id IN (SELECT pt.post_id FROM post_tags pt
    JOIN tags t USING (tag_id) WHERE t.slug IN ('mongodb','nosql') GROUP BY pt.post_id HAVING count(*) = 2)`)).rows[0].c;
  eq.push(['Пости з тегами mongodb і nosql', mAll, pAll]);
  const [mCs] = await posts.aggregate([{ $match: { status: 'published' } }, { $group: { _id: null, c: { $sum: { $size: '$comments' } }, p: { $sum: 1 } } }]).toArray();
  const pCs = (await P(`SELECT count(*)::int c FROM comments cm JOIN posts p USING (post_id) WHERE p.status = 'published'`)).rows[0].c;
  eq.push(['Коментарів до опублікованих постів', mCs.c, pCs]);
  const mTxt = await posts.countDocuments({ status: 'published', $text: { $search: 'docker' } });
  const pTxt = (await P(`SELECT count(*)::int c FROM posts WHERE status = 'published' AND tsv @@ to_tsquery('simple', 'docker')`)).rows[0].c;
  eq.push(['Повнотекстовий пошук "docker"', mTxt, pTxt]);
  eq.forEach(([n, a, b]) => console.log(`  ${String(a) === String(b) ? 'збігається' : 'РІЗНИЦЯ   '} | ${n}: MongoDB ${a} | PostgreSQL ${b}`));

  // ---------------------------------------------------------------
  console.log('\n=== 2. Читання (мс на запит: медіана / 95-й перцентиль) ===');
  const tests = [
    ['Q0 Порожній запит (мережа + драйвер): ping / SELECT 1', 300,
      () => mdb.command({ ping: 1 }),
      () => P('SELECT 1')],
    ['Q1 Сторінка посту з автором, категорією, тегами і коментарями', 300,
      r => posts.findOne({ slug: slugs[pickInt(r, 0, slugs.length - 1)] }),
      r => P(`SELECT p.post_id, p.title, p.content, u.username, c.name,
          (SELECT array_agg(t.slug) FROM post_tags pt JOIN tags t USING (tag_id) WHERE pt.post_id = p.post_id) tags,
          (SELECT json_agg(json_build_object('id', cm.comment_id, 'parent', cm.parent_id, 'author', cu.username, 'text', cm.text, 'at', cm.created_at) ORDER BY cm.created_at)
             FROM comments cm JOIN users cu ON cu.user_id = cm.user_id WHERE cm.post_id = p.post_id AND cm.status = 'approved') comments
        FROM posts p JOIN users u USING (user_id) JOIN categories c USING (category_id) WHERE p.slug = $1`, [slugs[pickInt(r, 0, slugs.length - 1)]])],
    ['Q2 Стрічка категорії: 10 нових з кількістю коментарів', 300,
      r => posts.find({ 'category.category_id': catByN[pickInt(r, 1, 10)], status: 'published' },
        { projection: { title: 1, slug: 1, 'author.username': 1, published_at: 1, 'statistics.comments_count': 1 } }).sort({ published_at: -1 }).limit(10).toArray(),
      r => P(`SELECT p.post_id, p.title, p.slug, u.username, p.published_at,
          (SELECT count(*) FROM comments cm WHERE cm.post_id = p.post_id AND cm.status = 'approved') comments
        FROM posts p JOIN users u USING (user_id) WHERE p.category_id = $1 AND p.status = 'published' ORDER BY p.published_at DESC LIMIT 10`, [pickInt(r, 1, 10)])],
    ['Q3 Сторінка автора: 10 останніх постів', 300,
      r => posts.find({ 'author.user_id': userByN[pickInt(r, 1, 400)] }, { projection: { title: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(10).toArray(),
      r => P(`SELECT post_id, title, created_at FROM posts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`, [pickInt(r, 1, 400)])],
    ['Q4 Пошук за двома тегами одночасно', 200,
      r => posts.find({ status: 'published', tags: { $all: tagPairs[pickInt(r, 0, tagPairs.length - 1)] } }, { projection: { title: 1 } }).sort({ published_at: -1 }).limit(20).toArray(),
      r => P(`SELECT p.post_id, p.title FROM posts p WHERE p.status = 'published' AND p.post_id IN (SELECT pt.post_id FROM post_tags pt
        JOIN tags t USING (tag_id) WHERE t.slug = ANY($1) GROUP BY pt.post_id HAVING count(*) = 2) ORDER BY p.published_at DESC LIMIT 20`, [tagPairs[pickInt(r, 0, tagPairs.length - 1)]])],
    ['Q5 Повнотекстовий пошук, 10 найрелевантніших', 100,
      r => posts.find({ status: 'published', $text: { $search: words[pickInt(r, 0, words.length - 1)] } }, { projection: { title: 1, score: { $meta: 'textScore' } } })
        .sort({ score: { $meta: 'textScore' } }).limit(10).toArray(),
      r => P(`SELECT post_id, title, ts_rank(tsv, q) rank FROM posts, to_tsquery('simple', $1) q WHERE status = 'published' AND tsv @@ q
        ORDER BY rank DESC LIMIT 10`, [words[pickInt(r, 0, words.length - 1)]])],
    ['Q6 Пагінація: випадкова сторінка 1-100 + загальна кількість', 200,
      r => { const page = pickInt(r, 1, 100); return posts.aggregate([{ $match: { status: 'published' } }, { $sort: { published_at: -1, _id: -1 } },
        { $facet: { items: [{ $skip: (page - 1) * 10 }, { $limit: 10 }, { $project: { title: 1, published_at: 1 } }], total: [{ $count: 'c' }] } }]).toArray(); },
      r => { const page = pickInt(r, 1, 100); return P(`SELECT post_id, title, published_at, count(*) OVER () total FROM posts WHERE status = 'published'
        ORDER BY published_at DESC, post_id DESC OFFSET $1 LIMIT 10`, [(page - 1) * 10]); }],
    ['Q7 Топ-10 авторів (агрегація всіх постів)', 40,
      () => posts.aggregate([{ $match: { status: 'published' } }, { $group: { _id: '$author.user_id', u: { $first: '$author.username' }, n: { $sum: 1 }, v: { $sum: '$statistics.views' } } },
        { $sort: { n: -1, v: -1 } }, { $limit: 10 }]).toArray(),
      () => P(`SELECT u.username, count(*) n, sum(p.views) v FROM posts p JOIN users u USING (user_id) WHERE p.status = 'published'
        GROUP BY u.user_id, u.username ORDER BY n DESC, v DESC LIMIT 10`)],
    ['Q8 Статистика коментарів (загальна, середня, максимум)', 40,
      () => posts.aggregate([{ $match: { status: 'published' } }, { $project: { n: { $size: '$comments' } } },
        { $group: { _id: null, posts: { $sum: 1 }, total: { $sum: '$n' }, avg: { $avg: '$n' }, max: { $max: '$n' } } }]).toArray(),
      () => P(`SELECT count(*) posts, sum(n) total, avg(n) avg, max(n) max FROM (SELECT p.post_id, count(cm.comment_id) n FROM posts p
        LEFT JOIN comments cm ON cm.post_id = p.post_id WHERE p.status = 'published' GROUP BY p.post_id) s`)],
    ['Q9 Популярні категорії', 40,
      () => posts.aggregate([{ $match: { status: 'published' } }, { $group: { _id: '$category.category_id', name: { $first: '$category.name' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
      () => P(`SELECT c.name, count(*) n FROM posts p JOIN categories c USING (category_id) WHERE p.status = 'published' GROUP BY c.name ORDER BY n DESC`)]
  ];
  const results = [];
  for (const [name, n, m, p] of tests) {
    const a = await bench(n, m), b = await bench(n, p);
    results.push({ name, a, b });
    console.log(`  ${name}\n      MongoDB ${a.median.toFixed(3)} / ${a.p95.toFixed(3)}   PostgreSQL ${b.median.toFixed(3)} / ${b.p95.toFixed(3)}   ` +
      (a.median < b.median ? `швидше MongoDB у ${(b.median / a.median).toFixed(1)} раза` : `швидше PostgreSQL у ${(a.median / b.median).toFixed(1)} раза`) + `  (n=${n})`);
  }

  // ---------------------------------------------------------------
  console.log('\n=== 3. Запис (мс на операцію: медіана / 95-й перцентиль) ===');
  const MARK = 'BENCH-коментар';
  const wtests = [
    ['W1 Додати коментар до посту', 300,
      r => posts.updateOne({ n: pickInt(r, 1, 20000) }, { $push: { comments: { comment_id: new (require('mongodb').ObjectId)(), parent_id: null, depth: 0,
        author: { user_id: userByN[5], username: 'user5' }, text: MARK, status: 'pending', likes: 0, created_at: new Date() } } }),
      r => P(`INSERT INTO comments (post_id, user_id, text, status) VALUES ($1, 5, $2, 'pending')`, [pickInt(r, 1, 20000), MARK])],
    ['W2 Лайк: інкремент лічильника посту', 300,
      r => posts.updateOne({ n: pickInt(r, 1, 20000) }, { $inc: { 'statistics.likes': 1, 'statistics.rating': 1 } }),
      r => P(`UPDATE posts SET likes = likes + 1 WHERE post_id = $1`, [pickInt(r, 1, 20000)])],
    ['W3 Перейменувати автора (денормалізоване ім\'я)', 20,
      r => { const un = pickInt(r, 11, 400); return renameMongo(un, 'user' + un + '_x').then(() => renameMongo(un, 'user' + un)); },
      r => { const un = pickInt(r, 11, 400); return P(`UPDATE users SET username = $2 WHERE user_id = $1`, [un, 'user' + un + '_x'])
        .then(() => P(`UPDATE users SET username = $2 WHERE user_id = $1`, [un, 'user' + un])); }]
  ];
  let renamedDocs = 0;
  async function renameMongo(userN, name) {
    const id = userByN[userN];
    await users.updateOne({ _id: id }, { $set: { username: name } });
    const a = await posts.updateMany({ 'author.user_id': id }, { $set: { 'author.username': name } });
    const b = await posts.updateMany({ 'comments.author.user_id': id }, { $set: { 'comments.$[c].author.username': name } }, { arrayFilters: [{ 'c.author.user_id': id }] });
    renamedDocs = a.modifiedCount + b.modifiedCount;
  }
  for (const [name, n, m, p] of wtests) {
    const a = await bench(n, m), b = await bench(n, p);
    results.push({ name, a, b });
    console.log(`  ${name}\n      MongoDB ${a.median.toFixed(3)} / ${a.p95.toFixed(3)}   PostgreSQL ${b.median.toFixed(3)} / ${b.p95.toFixed(3)}   ` +
      (a.median < b.median ? `швидше MongoDB у ${(b.median / a.median).toFixed(1)} раза` : `швидше PostgreSQL у ${(a.median / b.median).toFixed(1)} раза`) + `  (n=${n})`);
  }
  console.log(`      (W3: у MongoDB перейменування змінює документ користувача і ${renamedDocs} документів постів з копіями імені; у PostgreSQL - 1 рядок)`);
  // прибирання результатів запису
  await posts.updateMany({ 'comments.text': MARK }, { $pull: { comments: { text: MARK } } });
  await P(`DELETE FROM comments WHERE text = $1`, [MARK]);

  // ---------------------------------------------------------------
  const sc = (await P(`SELECT current_setting('synchronous_commit') sc, current_setting('shared_buffers') sb`)).rows[0];
  console.log(`\n  Умови запису: PostgreSQL synchronous_commit=${sc.sc} (кожен COMMIT чекає запису WAL на диск), shared_buffers=${sc.sb};`);
  console.log(`  MongoDB (окремий сервер, не набір реплік): writeConcern {w: 1}, журнал скидається на диск пакетно (до 100 мс).`);

  console.log('\n=== 4. Обсяг зберігання ===');
  await mdb.admin().command({ fsync: 1 });
  const ms = await mdb.stats();
  const ps = (await P(`SELECT sum(pg_table_size(relid))::bigint data, sum(pg_indexes_size(relid))::bigint idx
    FROM pg_stat_user_tables WHERE schemaname = 'blog'`)).rows[0];
  const mb = x => (Number(x) / 1048576).toFixed(1);
  console.log(`  MongoDB:    дані (без стиснення) ${mb(ms.dataSize)} МБ, на диску (WiredTiger, snappy) ${mb(ms.storageSize)} МБ, індекси ${mb(ms.indexSize)} МБ`);
  console.log(`  PostgreSQL: таблиці (з TOAST) ${mb(ps.data)} МБ, індекси ${mb(ps.idx)} МБ`);

  console.log('\n=== Підсумкова таблиця (медіана, мс) ===');
  console.log('  Тест'.padEnd(62) + 'MongoDB  PostgreSQL  Переможець');
  results.forEach(({ name, a, b }) => console.log('  ' + name.padEnd(60) + a.median.toFixed(3).padStart(7) + b.median.toFixed(3).padStart(12) + '  ' +
    (a.median < b.median ? 'MongoDB x' + (b.median / a.median).toFixed(1) : 'PostgreSQL x' + (a.median / b.median).toFixed(1))));

  pgc.release(); await pg.end(); await mongo.close();
})().catch(async e => { console.error(e); process.exit(1); });
