// =====================================================================
// Лабораторна робота 7. blog-app/server.js
// Express-сервер блог-системи: статичний вебінтерфейс (public/),
// RESTful API /api/... (рівень 3, завдання 6) і кеш популярних запитів
// (рівень 3, завдання 7).
// Запуск: npm install && node server.js  ->  http://localhost:3000
// =====================================================================
const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const { makeBlog, ApiError } = require('./lib/blog');
const { QueryCache } = require('./lib/cache');

const PORT = Number(process.env.PORT) || 3000;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'blog_system';

const client = new MongoClient(MONGO_URL, { maxPoolSize: 20 });   // одне підключення з пулом на весь застосунок
const cache = new QueryCache({ maxEntries: 500, defaultTtlMs: 30000 });
const app = express();
let blog;

app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));

// час обробки кожного запиту в заголовку X-Response-Time
app.use((req, res, next) => {
  const t = process.hrtime.bigint();
  const writeHead = res.writeHead;
  res.writeHead = function (...args) {      // заголовок додається в останній момент перед відправленням
    if (!res.headersSent) res.setHeader('X-Response-Time', (Number(process.hrtime.bigint() - t) / 1e6).toFixed(2) + 'ms');
    return writeHead.apply(this, args);
  };
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
// Chart.js для аналітичної панелі віддається з node_modules (без зовнішнього CDN)
app.get('/vendor/chart.umd.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js')));

// поточний користувач (спрощення: без автентифікації, ідентифікатор у заголовку X-User-Id)
const uid = req => req.get('X-User-Id') || (req.body && req.body.user_id);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
// після змін даних - інвалідація залежних записів кешу
const invalidate = (...tags) => (req, res, next) => { res.on('finish', () => { if (res.statusCode < 400) cache.invalidate(...tags); }); next(); };

const api = express.Router();

api.get('/health', wrap(async (req, res) => {
  const ping = await client.db(DB_NAME).command({ ping: 1 });
  res.json({ status: 'ok', mongo: ping.ok === 1, db: DB_NAME, uptime_s: Math.round(process.uptime()) });
}));

// ---------- пости ----------
// стрічка опублікованих постів кешується; запити чернеток (?status=draft|archived|all) залежать від користувача - без кешу
const postsCache = cache.middleware({ ttlMs: 30000, tags: ['posts'] });
api.get('/posts', (req, res, next) => (req.query.status && req.query.status !== 'published' ? next() : postsCache(req, res, next)),
  wrap(async (req, res) => res.json(await blog.listPosts(req.query, req.get('X-User-Id')))));
api.get('/posts/:slug', wrap(async (req, res) => res.json(await blog.getPost(req.params.slug, req.get('X-User-Id')))));
api.post('/posts', invalidate('posts', 'stats'), wrap(async (req, res) => res.status(201).json(await blog.createPost(uid(req), req.body))));
api.put('/posts/:id', invalidate('posts', 'stats'), wrap(async (req, res) => res.json(await blog.editPost(req.params.id, uid(req), req.body))));
api.delete('/posts/:id', invalidate('posts', 'stats'), wrap(async (req, res) => res.json(await blog.archivePost(req.params.id, uid(req)))));
api.post('/posts/:id/view', wrap(async (req, res) => res.json(await blog.addView(req.params.id))));
api.post('/posts/:id/reactions', invalidate('posts', 'stats'), wrap(async (req, res) => res.json(await blog.react(req.params.id, uid(req), req.body.value))));

// ---------- версії ----------
api.get('/posts/:id/versions', wrap(async (req, res) => res.json(await blog.listVersions(req.params.id))));
api.get('/posts/:id/versions/:v', wrap(async (req, res) => res.json(await blog.getVersion(req.params.id, req.params.v))));
api.post('/posts/:id/versions/:v/restore', invalidate('posts', 'stats'),
  wrap(async (req, res) => res.json(await blog.restoreVersion(req.params.id, req.params.v, uid(req)))));

// ---------- коментарі та модерація ----------
api.post('/posts/:id/comments', invalidate('posts', 'stats'),
  wrap(async (req, res) => res.status(201).json(await blog.addComment(req.params.id, uid(req), req.body.text, req.body.parent_id))));
api.get('/moderation/queue', wrap(async (req, res) => res.json(await blog.moderationQueue(req.get('X-User-Id')))));
api.patch('/comments/:id', invalidate('posts', 'stats'),
  wrap(async (req, res) => res.json(await blog.moderate(req.params.id, uid(req), req.body.status, req.body.reason))));

// ---------- сповіщення ----------
api.get('/notifications', wrap(async (req, res) =>
  res.json(await blog.listNotifications(req.get('X-User-Id') || req.query.user_id, req.query.unread === '1', Number(req.query.limit) || 20))));
api.patch('/notifications/read', wrap(async (req, res) => res.json(await blog.markRead(uid(req), req.body.ids))));

// ---------- довідники ----------
api.get('/users', cache.middleware({ ttlMs: 60000, tags: ['users'] }), wrap(async (req, res) => res.json(await blog.listUsers())));
api.get('/categories', cache.middleware({ ttlMs: 60000, tags: ['stats'] }), wrap(async (req, res) => res.json(await blog.listCategories())));
api.get('/tags', cache.middleware({ ttlMs: 60000, tags: ['stats'] }), wrap(async (req, res) => res.json(await blog.listTags())));

// ---------- геопошук ----------
api.get('/geo/near', cache.middleware({ ttlMs: 30000, tags: ['posts'] }),
  wrap(async (req, res) => res.json(await blog.geoNear(req.query.lng, req.query.lat, req.query.km, Number(req.query.limit) || 20))));

// ---------- аналітика (кешується на 60 с) ----------
const statsCache = cache.middleware({ ttlMs: 60000, tags: ['stats'] });
api.get('/stats/overview', statsCache, wrap(async (req, res) => res.json(await blog.stats.overview())));
api.get('/stats/top-authors', statsCache, wrap(async (req, res) => res.json(await blog.stats.topAuthors(Number(req.query.limit) || 10))));
api.get('/stats/categories', statsCache, wrap(async (req, res) => res.json(await blog.stats.categories())));
api.get('/stats/tags', statsCache, wrap(async (req, res) => res.json(await blog.stats.tags(Number(req.query.limit) || 15))));
api.get('/stats/comments', statsCache, wrap(async (req, res) => res.json(await blog.stats.comments())));
api.get('/stats/views-daily', statsCache, wrap(async (req, res) => res.json(await blog.stats.viewsDaily(Math.min(180, Number(req.query.days) || 30)))));
api.get('/stats/posts-by-month', statsCache, wrap(async (req, res) => res.json(await blog.stats.postsByMonth())));
api.get('/stats/top-posts', statsCache, wrap(async (req, res) => res.json(await blog.stats.topPosts(Number(req.query.limit) || 10))));
api.get('/stats/geo', statsCache, wrap(async (req, res) => res.json(await blog.stats.geo())));

// ---------- кеш ----------
api.get('/cache/stats', (req, res) => res.json(cache.report()));
api.delete('/cache', (req, res) => res.json({ cleared: cache.clear() }));

api.use((req, res) => res.status(404).json({ error: 'Маршрут не знайдено', path: req.originalUrl }));
app.use('/api', api);

// ---------- обробка помилок: валідація MongoDB -> 400, дублікат -> 409 ----------
app.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некоректний JSON' });
  if (err.code === 121) return res.status(400).json({ error: 'Документ не пройшов валідацію схеми', details: err.errInfo && err.errInfo.details });
  if (err.code === 11000) return res.status(409).json({ error: 'Порушення унікальності', key: err.keyValue });
  console.error(err);
  res.status(500).json({ error: 'Внутрішня помилка сервера' });
});

client.connect().then(() => {
  blog = makeBlog(client.db(DB_NAME));
  app.listen(PORT, () => console.log(`Сервер працює: http://localhost:${PORT} (MongoDB ${MONGO_URL}/${DB_NAME})`));
}).catch(err => { console.error('Не вдалося підключитися до MongoDB:', err.message); process.exit(1); });

process.on('SIGINT', async () => { await client.close(); process.exit(0); });
