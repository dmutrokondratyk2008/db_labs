// =====================================================================
// Лабораторна робота 6. 14_versioning.js
// Демонстрація системи версіонування (lib/versioning.js): зміни з
// історією, перегляд версій, конфлікт паралельних змін, відкат,
// видалення і відновлення книги.
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/versioning.js');
db = db.getSiblingDB('library');
db.books_history.drop();

h('Ініціалізація: version = 1 для всіх книг');
print('  книг: ' + Versioning.init());
print('  індекси books_history: ' + db.books_history.getIndexes().map(i => i.name).join(', '));

h('Три послідовні зміни книги "Земля"');
printjson(Versioning.update({ title: 'Земля' }, { pages: 320, publisher: { name: 'Віват', city: 'Харків' } },
                            'librarian_olha', 'нове видання'));
printjson(Versioning.update({ title: 'Земля' }, { available: false }, 'librarian_olha', 'видано читачу'));
printjson(Versioning.update({ title: 'Земля' }, { available: true, price_uah: 280 }, 'librarian_petro', 'повернено, додано ціну'));
printjson(Versioning.update({ title: 'Земля' }, { available: true }, 'librarian_petro', 'без змін'));

h('Поточний стан і історія змін');
printjson(db.books.findOne({ title: 'Земля' }, { _id: 0, title: 1, pages: 1, available: 1, price_uah: 1, publisher: 1,
                                                 version: 1, updated_by: 1 }));
Versioning.history('Земля').forEach(r =>
  print('  v' + r.version + ' -> v' + (r.version + 1) + '  ' + r.changed_by.padEnd(16) + r.comment.padEnd(24) +
        r.changes.map(c => c.field + ': ' + fmt(c.old) + ' -> ' + fmt(c.new)).join('; ')));

h('Стан на версію 1 (знімок з історії)');
const v1 = Versioning.getVersion('Земля', 1);
print('  pages=' + v1.pages + ', available=' + v1.available + ', publisher=' + fmt(v1.publisher) + ', price_uah=' + v1.price_uah);

h('Конфлікт: два бібліотекарі прочитали v4 і змінюють одночасно');
const seen = db.books.findOne({ title: 'Земля' }).version;
print('  обидва бачать version=' + seen);
printjson(Versioning.update({ title: 'Земля' }, { price_uah: 300 }, 'librarian_olha', 'нова ціна', seen));
try { Versioning.update({ title: 'Земля' }, { price_uah: 250 }, 'librarian_petro', 'знижка', seen); }
catch (e) { print('  librarian_petro: ' + e.message); }

h('Конфлікт на рівні бази: унікальний індекс (book_id, version)');
const b = db.books.findOne({ title: 'Земля' });
try { db.books_history.insertOne({ book_id: b._id, version: 1, op: 'update', snapshot: {} }); }
catch (e) { print('  ' + cn(e) + ' (' + e.code + ')'); }

h('Відкат до версії 1 (стає новою версією, історія зберігається)');
printjson(Versioning.rollback('Земля', 1, 'admin'));
printjson(db.books.findOne({ title: 'Земля' }, { _id: 0, pages: 1, available: 1, price_uah: 1, publisher: 1, version: 1 }));
print('  записів історії: ' + db.books_history.countDocuments({ book_id: b._id }));

h('Видалення з історією і відновлення');
print('  видалено: ' + Versioning.remove('Камінний хрест', 'admin', 'списано'));
print('  у books: ' + db.books.countDocuments({ title: 'Камінний хрест' }));
print('  відновлено як v' + Versioning.restore('Камінний хрест', 'admin'));
printjson(db.books.findOne({ title: 'Камінний хрест' }, { _id: 0, title: 1, author: 1, version: 1, updated_by: 1 }));

h('Журнал змін за всіма книгами');
rows(db.books_history.aggregate([
  { $group: { _id: '$changed_by', changes: { $sum: 1 }, ops: { $addToSet: '$op' } } },
  { $sort: { changes: -1 } }
]));
