// =====================================================================
// Лабораторна робота 7. 05_index_check.js
// Рівень 1, завдання 5. Перевірка, що пошук постів за автором,
// категорією та датою використовує індекси (explain executionStats).
// Для порівняння той самий запит виконується з hint({$natural: 1}),
// тобто повним переглядом колекції (COLLSCAN).
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('blog_system');

const author = db.users.findOne({ username: 'ivan.petrenko' });
const cat = db.categories.findOne({ type: 'category', slug: 'databases' });
const from = new Date('2026-10-01'), to = new Date('2026-11-01');

const cases = [
  ['Пости автора, новіші першими',
   { 'author.user_id': author._id }, { created_at: -1 }],
  ['Опубліковані пости категорії, новіші першими',
   { 'category.category_id': cat._id, status: 'published' }, { published_at: -1 }],
  ['Опубліковані за жовтень 2026 (діапазон дат)',
   { status: 'published', published_at: { $gte: from, $lt: to } }, { published_at: -1 }],
  ['Пости з тегом mongodb, новіші першими',
   { tags: 'mongodb' }, { published_at: -1 }],
  ['Головна стрічка: 10 останніх опублікованих',
   { status: 'published' }, { published_at: -1, _id: -1 }]
];

const rowsOut = [];
cases.forEach(([name, filter, sort]) => {
  h(name);
  q('db.posts.find(' + fmt(filter) + ').sort(' + fmt(sort) + ')');
  const withIx = planSummary(db.posts.find(filter).sort(sort).limit(10).explain('executionStats'));
  const noIx = planSummary(db.posts.find(filter).sort(sort).limit(10).hint({ $natural: 1 }).explain('executionStats'));
  print('  з індексом:  ' + fmt(withIx));
  print('  без індексу: ' + fmt(noIx));
  rowsOut.push({ query: name, plan: withIx.plan, returned: withIx.returned, keys: withIx.keysExamined,
                 docs_ix: withIx.docsExamined, docs_collscan: noIx.docsExamined });
});

h('Підсумок: переглянуто документів з індексом і без');
table(rowsOut, ['query', 'returned', 'keys', 'docs_ix', 'docs_collscan', 'plan']);

h('Розмір індексів колекції posts');
const st = db.posts.stats({ indexDetails: false });
table(Object.entries(st.indexSizes).map(([name, size]) => ({ index: name, size_kb: Math.round(size / 1024 * 10) / 10 })));
print('  дані: ' + Math.round(st.size / 1024) + ' КБ, документів: ' + st.count + ', середній розмір документа: ' + st.avgObjSize + ' Б');
