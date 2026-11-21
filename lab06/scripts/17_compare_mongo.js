// =====================================================================
// Лабораторна робота 6. 17_compare_mongo.js
// Сторона MongoDB порівняльного аналізу: ті самі три запити, що й у
// sql/20_relational_bench.sql, на books_bench (300 000 документів)
// і розмір колекції. Середнє з 10 повторів (Q3 - з 5).
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');
const c = db.books_bench;

function avgMs(fn, n) {
  fn();
  const t0 = Date.now();
  for (let i = 0; i < n; i++) fn();
  return (Date.now() - t0) / n;
}
const Q = {
  'Q1 книги автора (1 колекція)': () =>
    c.find({ author: 'Тарас Шевчук-7' }, { _id: 0, title: 1, publication_year: 1, publisher: 1, genres: 1 }).toArray(),
  'Q2 жанр+наявність+рік, сорт': () =>
    c.find({ genres: 'детектив', available: true, publication_year: { $gte: 2000 } },
           { _id: 0, title: 1, rating: 1, publication_year: 1 }).sort({ rating: -1 }).limit(10).toArray(),
  'Q3 агрегація за жанрами': () => c.aggregate([
    { $match: { available: true } }, { $unwind: '$genres' },
    { $group: { _id: '$genres', n: { $sum: 1 }, r: { $avg: '$rating' }, p: { $avg: '$pages' } } },
    { $sort: { n: -1 } }, { $limit: 5 }]).toArray()
};

h('Результати запитів');
Object.entries(Q).forEach(([k, f]) => { print('  ' + k + ':'); rows(f(), 3); });

h('Середній час, мс');
Object.entries(Q).forEach(([k, f]) =>
  print('  ' + k.padEnd(30) + avgMs(f, k.startsWith('Q3') ? 5 : 10).toFixed(2).padStart(8)));

h('Розмір books_bench');
const s = c.stats();
print('  документів ' + s.count + ', середній розмір документа ' + s.avgObjSize + ' Б');
print('  дані (BSON) ' + (s.size / 1048576).toFixed(1) + ' МБ, на диску зі стисненням snappy ' +
      (s.storageSize / 1048576).toFixed(1) + ' МБ, індекси ' + (s.totalIndexSize / 1048576).toFixed(1) +
      ' МБ (' + s.nindexes + ' шт.)');
