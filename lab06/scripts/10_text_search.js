// =====================================================================
// Лабораторна робота 6. 10_text_search.js
// Текстовий пошук з індексом типу text. Української мови серед мов
// текстових індексів MongoDB немає, тому default_language: 'none'
// (лише розбиття на слова, без стемінгу і стоп-слів).
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');

h('Текстовий індекс за назвою і описом (назва має вагу 5)');
db.books.getIndexes().filter(i => i.textIndexVersion).forEach(i => db.books.dropIndex(i.name));
print('  ' + db.books.createIndex(
  { title: 'text', description: 'text' },
  { name: 'books_text', default_language: 'none', weights: { title: 5, description: 1 } }
));

h('Пошук за ключовими словами (будь-яке зі слів)');
q('$search: "кохання Карпатах"');
rows(db.books.find({ $text: { $search: 'кохання Карпатах' } }, { _id: 0, title: 1, description: 1 }));

h('Пошук з оцінкою релевантності textScore');
q('$search: "повість кохання"');
rows(db.books.find({ $text: { $search: 'повість кохання' } },
                   { _id: 0, title: 1, score: { $meta: 'textScore' } })
             .sort({ score: { $meta: 'textScore' } }));

h('Точна фраза і виключення слова');
q('$search: "\\"життя селян\\""');
rows(db.books.find({ $text: { $search: '"життя селян"' } }, { _id: 0, title: 1 }));
q('$search: "кохання -Карпатах"');
rows(db.books.find({ $text: { $search: 'кохання -Карпатах' } }, { _id: 0, title: 1, description: 1 }));

h('Регістр не враховується: "КОБЗАР" знаходить "Кобзар"');
rows(db.books.find({ $text: { $search: 'КОБЗАР' } }, { _id: 0, title: 1 }));

h('Текстовий пошук у pipeline: кількість збігів і середня релевантність за автором');
rows(db.books.aggregate([
  { $match: { $text: { $search: 'повість роман новел' } } },
  { $group: { _id: '$author', found: { $sum: 1 }, score: { $avg: { $meta: 'textScore' } } } },
  { $sort: { score: -1 } }
]));

h('Обмеження: без стемінгу інші словоформи не знаходяться');
['Карпати', 'Карпатах', 'селяни', 'селян', 'повісті'].forEach(w =>
  print('  ' + w.padEnd(10) + ' -> ' + db.books.countDocuments({ $text: { $search: w } }) + ' док.'));

h('План запиту: TEXT_MATCH через індекс books_text');
printjson(planSummary(db.books.find({ $text: { $search: 'кохання' } }).explain('executionStats')));
