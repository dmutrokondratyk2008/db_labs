// =====================================================================
// Лабораторна робота 7. 14_bench_generate.js
// Рівень 3, завдання 8 (підготовка). Генерація великого набору даних
// для тестів продуктивності: база blog_bench у MongoDB (документна
// модель з вбудованими коментарями) і ті самі дані у CSV для PostgreSQL
// (нормалізована модель, sql/02_load_bench.sql).
//   2 000 користувачів, 10 категорій, 30 тегів, 20 000 постів, ~110 000 коментарів
// Кожен документ має числовий ключ n, який стає первинним ключем у PostgreSQL.
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/seed_data.js');
const fs = require('fs');
const path = require('path');

const N_USERS = 2000, N_POSTS = 20000;
const OUT = path.join(__dirname, '..', 'export');
fs.mkdirSync(OUT, { recursive: true });
const bdb = db.getSiblingDB('blog_bench');
const rnd = makeRng(777);
const NOW = new Date('2026-11-25T09:00:00Z').getTime();
const DAY = 86400000;

h('Очищення blog_bench');
printjson(bdb.dropDatabase());

// CSV: поля в лапках, лапки подвоюються, null -> порожньо
const csv = v => v === null || v === undefined ? '' :
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? '"' + v.replace(/"/g, '""') + '"' : String(v);
const writer = (name, header) => {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, header.join(',') + '\n');
  let buf = [];
  return { add(row) { buf.push(row.map(csv).join(',')); if (buf.length >= 2000) this.flush(); },
           flush() { if (buf.length) fs.appendFileSync(file, buf.join('\n') + '\n'); buf = []; } };
};

const start = Date.now();
h('1. Користувачі: ' + N_USERS);
const firstNames = ['Іван', 'Марія', 'Андрій', 'Катерина', 'Тарас', 'Оксана', 'Дмитро', 'Юлія', 'Богдан', 'Наталія', 'Василь', 'Анна', 'Максим', 'Ірина', 'Олег', 'Софія', 'Роман', 'Вікторія', 'Олена', 'Сергій'];
const lastNames = ['Петренко', 'Шевчук', 'Бондар', 'Лисенко', 'Гнатюк', 'Кравець', 'Савчук', 'Мороз', 'Ткачук', 'Романюк', 'Олійник', 'Сидоренко', 'Поліщук', 'Кузьменко', 'Марчук', 'Левченко', 'Зайцев', 'Павлюк', 'Коваленко', 'Мельник'];
const wu = writer('users.csv', ['user_id', 'username', 'email', 'password_hash', 'role', 'full_name', 'city', 'created_at', 'status']);
const users = [];
for (let i = 1; i <= N_USERS; i++) {
  const role = i <= 10 ? 'admin' : i <= 400 ? 'author' : 'reader';
  const city = rnd.pick(Object.keys(CITIES));
  const u = { n: i, username: 'user' + i, email: 'user' + i + '@bench.blog.ua', password_hash: '$scrypt$' + 'x'.repeat(60), role,
              profile: { full_name: rnd.pick(firstNames) + ' ' + rnd.pick(lastNames), city: CITIES[city][0],
                         avatar_url: 'https://api.dicebear.com/9.x/initials/svg?seed=u' + i },
              statistics: { posts_count: 0, comments_count: 0 },
              created_at: new Date(NOW - rnd.int(200, 900) * DAY), status: 'active', _city: city };
  users.push(u);
  wu.add([u.n, u.username, u.email, u.password_hash, role, u.profile.full_name, u.profile.city, u.created_at, u.status]);
}
wu.flush();
bdb.users.insertMany(users.map(({ _city, ...u }) => u));
const userIds = bdb.users.find({}, { n: 1 }).toArray().reduce((m, u) => (m[u.n] = u._id, m), {});
const authors = users.filter(u => u.role !== 'reader');

h('2. Категорії і теги');
const wc = writer('categories.csv', ['category_id', 'name', 'slug', 'description', 'parent_id']);
CATEGORIES.forEach(([name, slug, desc, , parent], i) =>
  wc.add([i + 1, name, slug, desc, parent ? CATEGORIES.findIndex(c => c[1] === parent) + 1 : null]));
wc.flush();
bdb.categories.insertMany(CATEGORIES.map(([name, slug, description], i) => ({ n: i + 1, type: 'category', name, slug, description })));
const wt = writer('tags.csv', ['tag_id', 'slug', 'name']);
TAGS.forEach(([slug, name], i) => wt.add([i + 1, slug, name]));
wt.flush();
bdb.categories.insertMany(TAGS.map(([slug, name], i) => ({ n: i + 1, type: 'tag', name, slug })));
const catDocs = bdb.categories.find({ type: 'category' }).sort({ n: 1 }).toArray();
const tagN = Object.fromEntries(TAGS.map(([slug], i) => [slug, i + 1]));
const catSlugs = Object.keys(POST_TITLES);

h('3. Пости з коментарями: ' + N_POSTS);
const wp = writer('posts.csv', ['post_id', 'title', 'slug', 'content', 'excerpt', 'user_id', 'category_id', 'status',
  'views', 'likes', 'dislikes', 'lng', 'lat', 'created_at', 'published_at']);
const wpt = writer('post_tags.csv', ['post_id', 'tag_id']);
const wcm = writer('comments.csv', ['comment_id', 'post_id', 'user_id', 'parent_id', 'text', 'status', 'likes', 'created_at']);
let commentN = 0, batch = [];
for (let i = 1; i <= N_POSTS; i++) {
  const catSlug = rnd.pick(catSlugs);
  const [baseTitle, baseTags] = rnd.pick(POST_TITLES[catSlug]);
  const title = baseTitle + ' (частина ' + i + ')';
  const tags = [...new Set(baseTags.concat(rnd() < 0.5 ? [rnd.pick(TAGS)[0]] : []))];
  const pool = SENTENCES[catSlug];
  const sents = rnd.sample(pool, 6);
  const content = [rnd.pick(INTROS).replace('%s', baseTitle), sents.slice(0, 2).join(' '), sents.slice(2, 4).join(' '),
                   sents.slice(4).join(' '), rnd.pick(OUTROS)].join('\n\n');
  const a = rnd.pick(authors);
  const status = rnd() < 0.9 ? 'published' : rnd() < 0.5 ? 'draft' : 'archived';
  const created = new Date(NOW - rnd.int(1, 730) * DAY - rnd.int(0, 86399) * 1000);
  const published = status === 'draft' ? null : new Date(created.getTime() + rnd.int(1, 48) * 3600000);
  const cat = catDocs[CATEGORIES.findIndex(c => c[1] === catSlug)];
  const [place, lng0, lat0] = CITIES[a._city];
  const lng = Math.round((lng0 + (rnd() - 0.5) * 0.06) * 1e5) / 1e5, lat = Math.round((lat0 + (rnd() - 0.5) * 0.04) * 1e5) / 1e5;
  const views = rnd.int(10, 5000), likes = rnd.int(0, 120), dislikes = rnd.int(0, 10);
  // коментарі
  const comments = [];
  const nc = status === 'published' ? rnd.int(0, 12) : 0;
  for (let k = 0; k < nc; k++) {
    commentN++;
    const parent = comments.length && rnd() < 0.3 ? rnd.pick(comments) : null;
    const cu = rnd.pick(users);
    const st = rnd() < 0.9 ? 'approved' : rnd() < 0.6 ? 'pending' : 'rejected';
    const at = new Date(Math.min(published.getTime() + rnd.int(1, 2000) * 3600000, NOW));
    const c = { n: commentN, comment_id: new ObjectId(), parent_id: parent ? parent.comment_id : null, depth: parent ? Math.min(parent.depth + 1, 5) : 0,
                author: { user_id: userIds[cu.n], username: cu.username }, text: parent ? rnd.pick(REPLIES) : rnd.pick(COMMENTS),
                status: st, likes: rnd.int(0, 15), created_at: at, _pn: parent ? parent.n : null };
    comments.push(c);
    wcm.add([c.n, i, cu.n, c._pn, c.text, st, c.likes, at]);
  }
  const doc = { n: i, title, slug: slugify(baseTitle) + '-' + i, content, excerpt: sents[0],
    author: { user_id: userIds[a.n], username: a.username, avatar_url: a.profile.avatar_url },
    category: { category_id: cat._id, name: cat.name, slug: catSlug }, tags, status,
    comments: comments.map(({ _pn, n, ...c }) => c),
    statistics: { views, likes, dislikes, rating: likes - dislikes, comments_count: comments.filter(c => c.status === 'approved').length },
    location: { type: 'Point', coordinates: [lng, lat], place },
    version: 1, created_at: created, updated_at: published || created, published_at: published };
  batch.push(doc);
  wp.add([i, title, doc.slug, content, doc.excerpt, a.n, cat.n, status, views, likes, dislikes, lng, lat, created, published]);
  tags.forEach(t => wpt.add([i, tagN[t]]));
  if (batch.length === 1000) { bdb.posts.insertMany(batch); batch = []; }
}
if (batch.length) bdb.posts.insertMany(batch);
[wp, wpt, wcm].forEach(w => w.flush());
print('  постів: ' + bdb.posts.countDocuments() + ', коментарів: ' + commentN);

h('4. Індекси blog_bench (під тестові запити: як у blog_system, плюс n і comments.author.user_id)');
bdb.posts.createIndex({ slug: 1 }, { unique: true });
bdb.posts.createIndex({ n: 1 }, { unique: true });
bdb.posts.createIndex({ 'author.user_id': 1, created_at: -1 });
bdb.posts.createIndex({ 'category.category_id': 1, status: 1, published_at: -1 });
bdb.posts.createIndex({ status: 1, published_at: -1, _id: -1 });
bdb.posts.createIndex({ tags: 1, published_at: -1 });
bdb.posts.createIndex({ title: 'text', excerpt: 'text', content: 'text' }, { name: 'posts_text', default_language: 'none', weights: { title: 10, excerpt: 4, content: 1 } });
bdb.posts.createIndex({ location: '2dsphere' });
bdb.posts.createIndex({ 'comments.comment_id': 1 });
bdb.posts.createIndex({ 'comments.author.user_id': 1 });
bdb.users.createIndex({ username: 1 }, { unique: true });
bdb.users.createIndex({ n: 1 }, { unique: true });
print('  індексів posts: ' + bdb.posts.getIndexes().length);

h('5. Підсумок');
db.adminCommand({ fsync: 1 });                 // скинути дані на диск, щоб storageSize був актуальним
const s = bdb.stats();
table([{ users: bdb.users.countDocuments(), posts: bdb.posts.countDocuments(), comments: commentN,
         data_mb: Math.round(s.dataSize / 1048576 * 10) / 10, storage_mb: Math.round(s.storageSize / 1048576 * 10) / 10,
         index_mb: Math.round(s.indexSize / 1048576 * 10) / 10, seconds: Math.round((Date.now() - start) / 100) / 10 }]);
print('  CSV у ' + OUT + ':');
fs.readdirSync(OUT).filter(f => f.endsWith('.csv')).forEach(f =>
  print('    ' + f.padEnd(16) + Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' КБ'));
