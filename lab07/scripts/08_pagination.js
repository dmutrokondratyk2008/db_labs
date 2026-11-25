// =====================================================================
// Лабораторна робота 7. 08_pagination.js
// Рівень 2, завдання 4. Пагінація списку постів через агрегаційний
// pipeline ($facet: сторінка + загальна кількість одним запитом)
// і порівняння з курсорною (keyset) пагінацією.
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/blog.js');
db = db.getSiblingDB('blog_system');

const show = r => {
  print('  сторінка ' + r.page + ' з ' + r.pages + ', усього постів: ' + r.total + ', на сторінці: ' + r.items.length);
  table(r.items.map(p => ({ published_at: p.published_at, title: p.title, author: p.author.username, views: p.statistics.views })),
        ['published_at', 'title', 'author', 'views']);
};

h('1. Pipeline пагінації ($match -> $sort -> $facet { items, total })');
print(`  db.posts.aggregate([
    { $match: { status: 'published' } },
    { $sort: { published_at: -1, _id: -1 } },
    { $facet: {
        items: [ { $skip: (page - 1) * perPage }, { $limit: perPage }, { $project: {...} } ],
        total: [ { $count: 'count' } ] } },
    { $project: { items: 1, total: { $ifNull: [{ $first: '$total.count' }, 0] } } },
    { $set: { page, per_page: perPage, pages: { $ceil: { $divide: ['$total', perPage] } } } }
  ])`);

h('2. Сторінка 1 (по 10 постів)');
show(paginate({}, 1, 10));

h('3. Сторінка 3');
show(paginate({}, 3, 10));

h('4. Остання сторінка (6) - неповна');
show(paginate({}, 6, 10));

h('5. Пагінація з фільтром: тег "testing", по 3 на сторінку, сторінка 2');
show(paginate({ tags: 'testing' }, 2, 3));

h('6. Сортування за переглядами, сторінка 1 по 5');
show(paginate({}, 1, 5, { 'statistics.views': -1, _id: -1 }));

h('7. План: $match і $sort виконуються за індексом status_1_published_at_-1__id_-1');
const ex = db.posts.explain('executionStats').aggregate([
  { $match: { status: 'published' } }, { $sort: { published_at: -1, _id: -1 } },
  { $facet: { items: [{ $skip: 20 }, { $limit: 10 }], total: [{ $count: 'count' }] } }]);
const cursorStage = ex.stages ? ex.stages[0].$cursor : ex;
const plan = cursorStage.queryPlanner.winningPlan;
const names = [];
(function walk(p) { if (!p) return; names.push(p.stage + (p.indexName ? '(' + p.indexName + ')' : '')); walk(p.inputStage); })(plan.queryPlan || plan);
print('  ' + names.join(' <- ') + ', docsExamined: ' + cursorStage.executionStats.totalDocsExamined);

h('8. Курсорна (keyset) пагінація для порівняння');
// наступна сторінка - документи «після» останнього показаного (published_at, _id)
const page1 = db.posts.find({ status: 'published' }, { title: 1, published_at: 1 }).sort({ published_at: -1, _id: -1 }).limit(10).toArray();
const last = page1[page1.length - 1];
print('  остання на сторінці 1: ' + fmt(last.published_at) + ' ' + last.title);
const page2 = db.posts.find({ status: 'published', $or: [
    { published_at: { $lt: last.published_at } },
    { published_at: last.published_at, _id: { $lt: last._id } }] }, { title: 1, published_at: 1 })
  .sort({ published_at: -1, _id: -1 }).limit(10).toArray();
const viaFacet = paginate({}, 2, 10).items;
print('  сторінка 2 через keyset збігається зі сторінкою 2 через $facet: ' +
      (JSON.stringify(page2.map(p => p._id.toHexString())) === JSON.stringify(viaFacet.map(p => p._id.toHexString()))));

q('кількість переглянутих ключів індексу для сторінки 5 (по 10): $skip проти keyset');
const skipEx = db.posts.find({ status: 'published' }).sort({ published_at: -1, _id: -1 }).skip(40).limit(10).explain('executionStats');
const p4 = db.posts.find({ status: 'published' }).sort({ published_at: -1, _id: -1 }).skip(30).limit(10).toArray();
const l4 = p4[p4.length - 1];
const keyEx = db.posts.find({ status: 'published', $or: [{ published_at: { $lt: l4.published_at } },
    { published_at: l4.published_at, _id: { $lt: l4._id } }] }).sort({ published_at: -1, _id: -1 }).limit(10).explain('executionStats');
print('  skip(40).limit(10): keysExamined = ' + skipEx.executionStats.totalKeysExamined);
print('  keyset limit(10):   keysExamined = ' + keyEx.executionStats.totalKeysExamined);
