// =====================================================================
// Лабораторна робота 6. 08_aggregation.js
// Агрегаційні запити (pipeline): підрахунок за категоріями, середні
// значення, групування і сортування, $bucket, $facet.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');

h('1. Кількість книг за жанрами ($unwind + $group + $sort)');
rows(db.books.aggregate([
  { $unwind: '$genres' },
  { $group: { _id: '$genres', count: { $sum: 1 } } },
  { $sort: { count: -1, _id: 1 } }
]));

h('2. Середня кількість сторінок і кількість книг за автором');
rows(db.books.aggregate([
  { $group: { _id: '$author', total_books: { $sum: 1 }, avg_pages: { $avg: '$pages' },
              first_year: { $min: '$publication_year' } } },
  { $project: { total_books: 1, first_year: 1, avg_pages: { $round: ['$avg_pages', 1] } } },
  { $sort: { avg_pages: -1 } }
]));

h('3. Статистика за століттями ($project з обчисленням + $addToSet)');
rows(db.books.aggregate([
  { $project: { title: 1, author: 1, century: { $ceil: { $divide: ['$publication_year', 100] } } } },
  { $group: { _id: '$century', books_count: { $sum: 1 }, authors: { $addToSet: '$author' } } },
  { $sort: { _id: 1 } }
]));

h('4. Топ-5 читачів за кількістю книг на руках');
rows(db.users.aggregate([
  { $project: { _id: 0, username: 1, status: 1, borrowed_count: { $size: '$borrowed_books' } } },
  { $sort: { borrowed_count: -1, username: 1 } },
  { $limit: 5 }
]));

h('5. Середня оцінка книг за масивом ratings');
rows(db.books.aggregate([
  { $unwind: '$ratings' },
  { $group: { _id: '$title', votes: { $sum: 1 }, avg_score: { $avg: '$ratings.score' } } },
  { $project: { votes: 1, avg_score: { $round: ['$avg_score', 2] } } },
  { $sort: { avg_score: -1, votes: -1 } }
]));

h('6. Групування за містом видавництва з доступністю ($cond)');
rows(db.books.aggregate([
  { $group: { _id: '$publisher.city', books: { $sum: 1 },
              available: { $sum: { $cond: ['$available', 1, 0] } }, pages_total: { $sum: '$pages' } } },
  { $sort: { books: -1 } }
]));

h('7. Розподіл за обсягом ($bucket)');
rows(db.books.aggregate([
  { $bucket: { groupBy: '$pages', boundaries: [0, 100, 200, 300, 1000], default: 'інше',
               output: { count: { $sum: 1 }, titles: { $push: '$title' } } } }
]));

h('8. Читачі за статусом і містом одним запитом ($facet)');
printjson(db.users.aggregate([
  { $facet: {
      by_status: [ { $group: { _id: '$status', n: { $sum: 1 } } }, { $sort: { n: -1 } } ],
      by_city:   [ { $group: { _id: '$address.city', n: { $sum: 1 } } }, { $sort: { n: -1 } } ],
      unpaid_fines: [ { $unwind: '$fines' }, { $match: { 'fines.paid': false } },
                      { $group: { _id: null, total: { $sum: '$fines.amount' }, users: { $addToSet: '$username' } } } ]
  } }
]).toArray()[0]);

h('9. Великий обсяг: жанри books_bench із середнім рейтингом (300 000 док.)');
const t0 = Date.now();
rows(db.books_bench.aggregate([
  { $match: { available: true } },
  { $unwind: '$genres' },
  { $group: { _id: '$genres', books: { $sum: 1 }, avg_rating: { $avg: '$rating' }, avg_pages: { $avg: '$pages' } } },
  { $project: { books: 1, avg_rating: { $round: ['$avg_rating', 2] }, avg_pages: { $round: ['$avg_pages', 0] } } },
  { $sort: { books: -1 } },
  { $limit: 5 }
]));
print('  час: ' + (Date.now() - t0) + ' мс');
