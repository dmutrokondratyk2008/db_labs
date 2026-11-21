// =====================================================================
// Лабораторна робота 6. 09_compound_indexes.js
// Складені (compound) індекси для складних запитів до books_bench.
// Порядок полів за правилом ESR: Equality -> Sort -> Range.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');
const c = db.books_bench;

// Складний запит 1: доступні детективи після 2000 року, найкращі за рейтингом
const q1 = () => c.find({ genres: 'детектив', available: true, publication_year: { $gte: 2000 } },
                        { _id: 0, title: 1, rating: 1, publication_year: 1 })
                  .sort({ rating: -1 }).limit(10);
// Складний запит 2: книги львівських видавництв 2010-2015 рр. за роком
const q2 = () => c.find({ 'publisher.city': 'Львів', publication_year: { $gte: 2010, $lte: 2015 } })
                  .sort({ publication_year: -1 }).limit(50);

function show(label, fn) {
  fn().toArray();
  const t0 = Date.now(); for (let i = 0; i < 5; i++) fn().toArray();
  const s = planSummary(fn().explain('executionStats'));
  print('  ' + label.padEnd(30) + s.plan);
  print('  ' + ''.padEnd(30) + 'keys=' + s.keysExamined + ' docs=' + s.docsExamined +
        ' returned=' + s.returned + ' середнє=' + ((Date.now() - t0) / 5).toFixed(1) + ' мс');
}

h('Видалення складених індексів з попереднього запуску');
['genres_available_rating_year', 'city_year'].forEach(n => { try { c.dropIndex(n); } catch (e) {} });
print('  індекси: ' + c.getIndexes().map(i => i.name).join(', '));

h('До створення складених індексів');
show('Q1 жанр+наявність+рік, сорт', q1);
show('Q2 місто+рік, сорт', q2);

h('Створення складених індексів (ESR)');
print('  ' + c.createIndex({ genres: 1, available: 1, rating: -1, publication_year: 1 },
                           { name: 'genres_available_rating_year' }));
print('  ' + c.createIndex({ 'publisher.city': 1, publication_year: -1 }, { name: 'city_year' }));

h('Після створення складених індексів');
show('Q1 жанр+наявність+рік, сорт', q1);
show('Q2 місто+рік, сорт', q2);
rows(q1(), 3);

h('Префікс складеного індексу: запит лише за genres теж використовує індекс');
printjson(planSummary(c.find({ genres: 'мемуари' }).explain('executionStats')));

h('Покривний запит: усі поля є в індексі, документи не читаються (docs=0)');
printjson(planSummary(c.find({ 'publisher.city': 'Луцьк', publication_year: 2025 },
                             { _id: 0, 'publisher.city': 1, publication_year: 1 }).explain('executionStats')));

h('Складений індекс на колекції books для каталогу доступних книг за жанром');
print('  ' + db.books.createIndex({ available: 1, genres: 1, publication_year: -1 }));
printjson(planSummary(db.books.find({ available: true, genres: 'повість' }).sort({ publication_year: -1 }).explain('executionStats')));
