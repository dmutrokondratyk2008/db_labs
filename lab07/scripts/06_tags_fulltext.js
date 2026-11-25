// =====================================================================
// Лабораторна робота 7. 06_tags_fulltext.js
// Рівень 2, завдання 1-2. Система тегів (пошук за множинними тегами,
// хмара тегів, схожі пости) і повнотекстовий пошук за назвою та змістом.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('blog_system');
const pub = { status: 'published' };
const short = p => ({ title: p.title, tags: p.tags.join(','), views: p.statistics.views });

// ---------------------------------------------------------------------
h('1. Хмара тегів (лічильники з колекції categories, type = "tag")');
// ---------------------------------------------------------------------
table(db.categories.find({ type: 'tag', 'statistics.posts_count': { $gt: 0 } },
                         { _id: 0, slug: 1, name: 1, n: '$statistics.posts_count' })
        .sort({ 'statistics.posts_count': -1, slug: 1 }).limit(12).toArray(), ['slug', 'name', 'n']);

// ---------------------------------------------------------------------
h('2. Пошук за множинними тегами');
// ---------------------------------------------------------------------
q("усі теги одночасно: { tags: { $all: ['mongodb', 'nosql'] } }");
table(db.posts.find(Object.assign({ tags: { $all: ['mongodb', 'nosql'] } }, pub)).sort({ published_at: -1 }).toArray().map(short));

q("будь-який із тегів: { tags: { $in: ['docker', 'kubernetes'] } }");
table(db.posts.find(Object.assign({ tags: { $in: ['docker', 'kubernetes'] } }, pub)).sort({ published_at: -1 }).toArray().map(short));

q("комбінація: усі з ['javascript', 'testing'] і жодного з ['jest']");
table(db.posts.find(Object.assign({ tags: { $all: ['javascript', 'testing'], $nin: ['jest'] } }, pub)).toArray().map(short));

q('ранжування за кількістю збігів із набором [mongodb, nodejs, security, patterns] (щонайменше 2)');
const wanted = ['mongodb', 'nodejs', 'security', 'patterns'];
table(db.posts.aggregate([
  { $match: Object.assign({ tags: { $in: wanted } }, pub) },
  { $set: { matched: { $setIntersection: ['$tags', wanted] } } },
  { $set: { score: { $size: '$matched' } } },
  { $match: { score: { $gte: 2 } } },
  { $sort: { score: -1, 'statistics.views': -1 } },
  { $project: { _id: 0, title: 1, matched: 1, score: 1 } }
]).toArray(), ['title', 'matched', 'score']);

q("план запиту { tags: { $all: ['mongodb', 'nosql'] } }");
print('  ' + fmt(planSummary(db.posts.find({ tags: { $all: ['mongodb', 'nosql'] } }).explain('executionStats'))));

// ---------------------------------------------------------------------
h('3. Схожі пости (за спільними тегами і категорією)');
// ---------------------------------------------------------------------
const base = db.posts.findOne({ slug: 'proiektuvannia-dokumentnoi-skhemy-v-mongodb' });
print('  Базовий пост: ' + base.title + ' ' + fmt(base.tags) + ', категорія ' + base.category.name);
table(db.posts.aggregate([
  { $match: { status: 'published', _id: { $ne: base._id }, $or: [{ tags: { $in: base.tags } }, { 'category.category_id': base.category.category_id }] } },
  { $set: { common: { $size: { $setIntersection: ['$tags', base.tags] } },
            same_cat: { $cond: [{ $eq: ['$category.category_id', base.category.category_id] }, 1, 0] } } },
  { $set: { score: { $add: [{ $multiply: ['$common', 2] }, '$same_cat'] } } },
  { $sort: { score: -1, 'statistics.views': -1 } }, { $limit: 5 },
  { $project: { _id: 0, title: 1, tags: 1, common: 1, same_cat: 1, score: 1 } }
]).toArray(), ['title', 'tags', 'common', 'same_cat', 'score']);

// ---------------------------------------------------------------------
h('4. Повнотекстовий пошук (індекс posts_text: title x10, excerpt x4, content x1)');
// ---------------------------------------------------------------------
const ti = db.posts.getIndexes().find(i => i.name === 'posts_text');
print('  ' + fmt({ weights: ti.weights, default_language: ti.default_language }));

function search(text, extra) {
  const filter = Object.assign({ $text: { $search: text } }, pub, extra || {});
  return db.posts.find(filter, { _id: 0, title: 1, score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } }).limit(5).toArray();
}
q('слово: "MongoDB"');                     table(search('MongoDB'), ['title', 'score']);
q('кілька слів (АБО): "docker kubernetes"'); table(search('docker kubernetes'), ['title', 'score']);
q('фраза: "\\"агрегаційний конвеєр\\""');   table(search('"агрегаційний конвеєр"'), ['title', 'score']);
q('виключення слова: "тести -jest"');       table(search('тести -jest'), ['title', 'score']);
const sec = db.categories.findOne({ type: 'category', slug: 'security' });
q('пошук + фільтр за категорією «Безпека»: "паролі"');
table(search('паролі', { 'category.category_id': sec._id }), ['title', 'score']);

q('пошук у змісті: слово, якого немає в назвах ("токенізація")');
table(search('токенізація'), ['title', 'score']);

q('без стемінгу (default_language: none) форми слова розрізняються: "індекси" і "індексів"');
print('  "індекси":  ' + db.posts.countDocuments({ $text: { $search: 'індекси' } }) + ' док.');
print('  "індексів": ' + db.posts.countDocuments({ $text: { $search: 'індексів' } }) + ' док.');
print('  обидві форми одним запитом "індекси індексів індекс": ' +
      db.posts.countDocuments({ $text: { $search: 'індекси індексів індекс' } }) + ' док.');

q('план запиту $text');
print('  ' + fmt(planSummary(db.posts.find({ $text: { $search: 'MongoDB' } }).explain('executionStats'))));
