// =====================================================================
// Лабораторна робота 7. 15_optimization.js
// Рівень 3, завдання 8 (аналіз). Оптимізація агрегаційних запитів, які
// в порівняльному тесті (bench/compare.js) програли PostgreSQL.
// Причина: $group по всій колекції змушує MongoDB читати повні документи
// (~3.5 КБ з текстом і вбудованими коментарями). Покривний (covered)
// індекс дозволяє обчислити результат лише з ключів індексу.
// База: blog_bench (20 000 постів).
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('blog_bench');

function stageInfo(ex) {
  // для aggregate: план першої стадії ($cursor) або весь план при повному pushdown у SBE
  const c = ex.stages ? ex.stages[0].$cursor : ex;
  const es = c.executionStats || {};
  const names = [];
  (function walk(p) { if (!p) return; names.push(p.stage + (p.indexName ? '(' + p.indexName + ')' : '')); walk(p.inputStage); })
    ((c.queryPlanner.winningPlan.queryPlan || c.queryPlanner.winningPlan));
  return { plan: [...new Set(names)].join(' <- '), keys: es.totalKeysExamined, docs: es.totalDocsExamined };
}
function run(name, pipelineFn) {
  const ms = timeIt(() => db.posts.aggregate(pipelineFn()).toArray(), 15);
  const info = stageInfo(db.posts.explain('executionStats').aggregate(pipelineFn()));
  return Object.assign({ variant: name, median_ms: ms }, info);
}

['status_1_category.category_id_1', 'status_1_author.user_id_1_statistics.views_1', 'status_1_published_at_-1__id_-1_cover']
  .forEach(n => { try { db.posts.dropIndex(n); } catch (e) { /* індексу ще немає */ } });

// ---------------------------------------------------------------------
h('1. Популярні категорії');
// ---------------------------------------------------------------------
const catBefore = () => [{ $match: { status: 'published' } },
  { $group: { _id: '$category.category_id', name: { $first: '$category.name' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }];
// після: групування лише за полем з індексу, назви - $lookup для 10 результатів
const catAfter = () => [{ $match: { status: 'published' } }, { $project: { _id: 0, c: '$category.category_id' } },
  { $group: { _id: '$c', n: { $sum: 1 } } }, { $sort: { n: -1 } },
  { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'cat', pipeline: [{ $project: { _id: 0, name: 1 } }] } },
  { $project: { name: { $first: '$cat.name' }, n: 1 } }];
const r1 = [run('до оптимізації', catBefore)];
db.posts.createIndex({ status: 1, 'category.category_id': 1 });
r1.push(run('індекс {status, category.category_id}', catAfter));
table(r1, ['variant', 'median_ms', 'keys', 'docs', 'plan']);
q('результати однакові: ' + (JSON.stringify(db.posts.aggregate(catBefore()).toArray().map(x => x.name + x.n)) ===
                               JSON.stringify(db.posts.aggregate(catAfter()).toArray().map(x => x.name + x.n))));

// ---------------------------------------------------------------------
h('2. Топ-10 авторів (кількість постів і сума переглядів)');
// ---------------------------------------------------------------------
const topBefore = () => [{ $match: { status: 'published' } },
  { $group: { _id: '$author.user_id', u: { $first: '$author.username' }, n: { $sum: 1 }, v: { $sum: '$statistics.views' } } },
  { $sort: { n: -1, v: -1 } }, { $limit: 10 }];
const topAfter = () => [{ $match: { status: 'published' } }, { $project: { _id: 0, a: '$author.user_id', v: '$statistics.views' } },
  { $group: { _id: '$a', n: { $sum: 1 }, v: { $sum: '$v' } } }, { $sort: { n: -1, v: -1 } }, { $limit: 10 },
  { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u', pipeline: [{ $project: { _id: 0, username: 1 } }] } },
  { $project: { u: { $first: '$u.username' }, n: 1, v: 1 } }];
const r2 = [run('до оптимізації', topBefore)];
db.posts.createIndex({ status: 1, 'author.user_id': 1, 'statistics.views': 1 });
r2.push(run('індекс {status, author.user_id, views}', topAfter));
table(r2, ['variant', 'median_ms', 'keys', 'docs', 'plan']);
q('результати однакові: ' + (JSON.stringify(db.posts.aggregate(topBefore()).toArray().map(x => x.u + x.n + '/' + x.v)) ===
                               JSON.stringify(db.posts.aggregate(topAfter()).toArray().map(x => x.u + x.n + '/' + x.v))));

// ---------------------------------------------------------------------
h('3. Пагінація: сторінка 50 + загальна кількість');
// ---------------------------------------------------------------------
// $facet рахує total, проходячи всі 18 000 документів; окремий countDocuments
// рахує за індексом (COUNT_SCAN), а сторінка читає лише 10 документів
const page = 50;
const facetMs = timeIt(() => db.posts.aggregate([{ $match: { status: 'published' } }, { $sort: { published_at: -1, _id: -1 } },
  { $facet: { items: [{ $skip: (page - 1) * 10 }, { $limit: 10 }, { $project: { title: 1 } }], total: [{ $count: 'c' }] } }]).toArray(), 15);
const splitMs = timeIt(() => {
  db.posts.find({ status: 'published' }, { title: 1 }).sort({ published_at: -1, _id: -1 }).skip((page - 1) * 10).limit(10).toArray();
  db.posts.countDocuments({ status: 'published' });
}, 15);
const cnt = db.posts.explain('executionStats').count({ status: 'published' });
const cntStage = cnt.queryPlanner.winningPlan.queryPlan ? cnt.queryPlanner.winningPlan.queryPlan : cnt.queryPlanner.winningPlan;
table([
  { variant: 'один $facet (items + total)', median_ms: facetMs, plan: '$facet рахує total по всіх документах' },
  { variant: 'find().skip().limit() + countDocuments()', median_ms: splitMs, plan: cntStage.stage + ' <- ' + (cntStage.inputStage ? cntStage.inputStage.stage : '') }
], ['variant', 'median_ms', 'plan']);

// ---------------------------------------------------------------------
h('4. Патерн Computed: попередньо обчислені лічильники');
// ---------------------------------------------------------------------
// лічильники постів зберігаються в документах категорій і оновлюються при публікації ($inc)
// або періодично перераховуються $merge; читання - 10 маленьких документів
const recalcMs = timeIt(() => db.posts.aggregate([{ $match: { status: 'published' } }, { $project: { _id: 0, c: '$category.category_id' } },
  { $group: { _id: '$c', n: { $sum: 1 } } }, { $project: { statistics: { posts_count: '$n' } } },
  { $merge: { into: 'categories', on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } }]).toArray(), 5);
const readMs = timeIt(() => db.categories.find({ type: 'category' }, { name: 1, 'statistics.posts_count': 1 }).sort({ 'statistics.posts_count': -1 }).toArray(), 50);
table([
  { variant: 'агрегація при кожному запиті (до оптимізації)', median_ms: r1[0].median_ms },
  { variant: 'покривний індекс', median_ms: r1[1].median_ms },
  { variant: 'Computed: читання готових лічильників', median_ms: readMs },
  { variant: 'Computed: повний перерахунок ($merge), рідко', median_ms: recalcMs }
], ['variant', 'median_ms']);
table(db.categories.find({ type: 'category' }, { _id: 0, name: 1, posts: '$statistics.posts_count' }).sort({ 'statistics.posts_count': -1 }).limit(3).toArray(), ['name', 'posts']);

h('5. Висновок');
print('  1) Покривні індекси прибирають читання повних документів (docs = 0), але групування 18 000 ключів лишається,');
print('     тому виграш невеликий і залежить від запиту; для агрегацій по всій таблиці PostgreSQL усе одно швидший.');
print('  2) Пагінацію варто розділити: сторінку брати find().skip().limit() (або keyset), total - countDocuments() за індексом.');
print('  3) Для статистики в документній моделі ефективніший патерн Computed: лічильник у документі категорії');
print('     читається за частки мілісекунди, а перерахунок виконується рідко або інкрементом ($inc) при публікації.');
print('  Ціна - додаткові індекси й дубльовані дані: ' + db.posts.getIndexes().length + ' індексів у posts, кожен уповільнює запис.');
const st = db.posts.stats();
print('  Розмір нових індексів, КБ: ' + fmt(Object.fromEntries(Object.entries(st.indexSizes)
  .filter(([k]) => k.startsWith('status_1_category') || k.startsWith('status_1_author')).map(([k, v]) => [k, Math.round(v / 1024)]))));
