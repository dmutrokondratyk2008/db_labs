// =====================================================================
// Лабораторна робота 6. 04_indexes.js
// Три різні індекси колекції books: простий, складений і унікальний.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');

h('Індекси до створення');
db.books.getIndexes().forEach(i => print('  ' + i.name + '  ' + fmt(i.key)));

h('План пошуку за автором БЕЗ індексу');
printjson(planSummary(db.books.find({ author: 'Тарас Шевченко' }).explain('executionStats')));

h('1. Простий індекс за назвою');
print('  ' + db.books.createIndex({ title: 1 }));
h('2. Складений індекс: автор + рік видання (спадання)');
print('  ' + db.books.createIndex({ author: 1, publication_year: -1 }));
h('3. Унікальний індекс за ISBN');
print('  ' + db.books.createIndex({ isbn: 1 }, { unique: true, name: 'isbn_unique' }));

h('Список індексів');
db.books.getIndexes().forEach(i =>
  print('  ' + i.name.padEnd(30) + fmt(i.key) + (i.unique ? '  unique' : '')));

h('Унікальний індекс не дозволяє дубль ISBN');
try {
  db.books.insertOne({ title: 'Кобзар (копія)', author: 'Тарас Шевченко', publication_year: 1840,
                       isbn: '978-966-03-4421-6' });
} catch (e) { print('  ' + cn(e) + ' (' + e.code + '): ' + e.message.slice(0, 110)); }

h('Плани запитів З індексами');
q("find({ author: 'Тарас Шевченко' })");
printjson(planSummary(db.books.find({ author: 'Тарас Шевченко' }).explain('executionStats')));
q("find({ author: 'Іван Франко' }).sort({ publication_year: -1 })");
printjson(planSummary(db.books.find({ author: 'Іван Франко' }).sort({ publication_year: -1 }).explain('executionStats')));
q("find({ title: 'Кобзар' })");
printjson(planSummary(db.books.find({ title: 'Кобзар' }).explain('executionStats')));
q("find({ isbn: '978-966-03-5214-3' })");
printjson(planSummary(db.books.find({ isbn: '978-966-03-5214-3' }).explain('executionStats')));
