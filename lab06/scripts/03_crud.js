// =====================================================================
// Лабораторна робота 6. 03_crud.js
// Базові CRUD-операції: вставка одного і багатьох документів, пошук
// з різними умовами, оновлення полів, заміна і видалення документів.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');

// ---------------------------------------------------------------------
h('CREATE: вставка одного документа (insertOne)');
// ---------------------------------------------------------------------
res(db.books.insertOne({
  title: 'Тигролови', author: 'Іван Багряний', publication_year: 1944, pages: 416,
  isbn: '978-966-03-3527-6', genres: ['роман', 'пригоди', 'політична проза'], available: true,
  publisher: { name: 'Фоліо', city: 'Харків' },
  description: 'Пригодницький роман про втечу з таборів на Далекому Сході'
}));

h('CREATE: вставка багатьох документів (insertMany)');
res(db.books.insertMany([
  { title: 'Земля', author: 'Ольга Кобилянська', publication_year: 1902, pages: 304,
    isbn: '978-966-03-2214-6', genres: ['роман', 'реалізм'], available: true,
    publisher: { name: 'Знання', city: 'Київ' },
    description: 'Соціально-психологічний роман про боротьбу за землю в буковинському селі' },
  { title: 'Я (Романтика)', author: 'Микола Хвильовий', publication_year: 1924, pages: 40,
    isbn: '978-966-03-8810-4', genres: ['новела', 'модернізм'], available: true,
    publisher: { name: 'Фоліо', city: 'Харків' },
    description: 'Психологічна новела про внутрішній конфлікт людини і революції' }
]));
print('  books: ' + db.books.countDocuments() + ' документів');

// ---------------------------------------------------------------------
h('READ: пошук за рівністю (книги Івана Франка)');
rows(db.books.find({ author: 'Іван Франко' }, { _id: 0, title: 1, publication_year: 1, available: 1 }));

h('READ: порівняння $gt / $lte (від 100 до 300 сторінок)');
rows(db.books.find({ pages: { $gt: 100, $lte: 300 } }, { _id: 0, title: 1, pages: 1 }).sort({ pages: 1 }));

h('READ: $ne і $in (недоступні книги; читачі з Рівного або Ковеля)');
rows(db.books.find({ available: { $ne: true } }, { _id: 0, title: 1, available: 1 }));
rows(db.users.find({ 'address.city': { $in: ['Рівне', 'Ковель'] } }, { _id: 0, username: 1, 'address.city': 1 }));

h('READ: логічні оператори $or і $and');
rows(db.books.find({ $or: [ { author: 'Тарас Шевченко' }, { genres: 'романтизм' } ] },
                   { _id: 0, title: 1, author: 1 }));
rows(db.books.find({ $and: [ { publication_year: { $gte: 1900 } }, { available: true } ] },
                   { _id: 0, title: 1, publication_year: 1 }));

h('READ: поле вкладеного документа і елемент масиву');
rows(db.books.find({ 'publisher.city': 'Львів' }, { _id: 0, title: 1, publisher: 1 }));
rows(db.books.find({ genres: 'поезія' }, { _id: 0, title: 1, genres: 1 }));

h('READ: $elemMatch (книги з оцінкою 5 від ivan_petrov)');
rows(db.books.find({ ratings: { $elemMatch: { user: 'ivan_petrov', score: 5 } } }, { _id: 0, title: 1 }));

h('READ: findOne, сортування, обмеження, підрахунок');
printjson(db.books.findOne({ title: 'Кобзар' }, { _id: 0, title: 1, author: 1, isbn: 1 }));
rows(db.books.find({}, { _id: 0, title: 1, publication_year: 1 }).sort({ publication_year: -1 }).limit(3));
print('  romans: ' + db.books.countDocuments({ genres: 'роман' }) +
      ', active users: ' + db.users.countDocuments({ status: 'active' }));

// ---------------------------------------------------------------------
h('UPDATE: $set для одного документа');
res(db.books.updateOne({ title: 'Кобзар' }, { $set: { available: false } }));

h('UPDATE: $push - додавання оцінки в масив ratings');
res(db.books.updateOne({ title: 'Лісова пісня' },
  { $push: { ratings: { user: 'ivan_petrov', score: 5, date: new Date('2026-11-21') } } }));

h('UPDATE: updateMany - категорія для книг XIX століття');
res(db.books.updateMany({ publication_year: { $lt: 1900 } }, { $set: { category: 'класика XIX століття' } }));

h('UPDATE: $inc - лічильник видач (двічі)');
res(db.books.updateOne({ title: 'Тіні забутих предків' }, { $inc: { borrowed_count: 1 } }));
res(db.books.updateOne({ title: 'Тіні забутих предків' }, { $inc: { borrowed_count: 1 } }));

h('UPDATE: $addToSet (без дублікатів) і $pull для масиву borrowed_books');
res(db.users.updateOne({ username: 'iryna_savchuk' }, { $addToSet: { borrowed_books: 'Земля' } }));
res(db.users.updateOne({ username: 'iryna_savchuk' }, { $addToSet: { borrowed_books: 'Земля' } }));
res(db.users.updateOne({ username: 'ivan_petrov' }, { $pull: { borrowed_books: 'Кобзар' } }));

h('UPDATE: $unset - видалення поля');
db.books.updateOne({ title: 'Захар Беркут' }, { $set: { temporary_note: 'перевірити палітурку' } });
res(db.books.updateOne({ title: 'Захар Беркут' }, { $unset: { temporary_note: '' } }));

h('Результат оновлень');
rows(db.books.find({ title: { $in: ['Кобзар', 'Лісова пісня', 'Тіні забутих предків', 'Захар Беркут'] } },
                   { _id: 0, title: 1, available: 1, category: 1, borrowed_count: 1, 'ratings.user': 1, temporary_note: 1 }));
rows(db.users.find({ username: { $in: ['iryna_savchuk', 'ivan_petrov'] } }, { _id: 0, username: 1, borrowed_books: 1 }));

h('UPDATE: replaceOne - повна заміна документа (крім _id)');
printjson(db.users.findOne({ username: 'oleksandr_sydorov' }, { _id: 0 }));
res(db.users.replaceOne({ username: 'oleksandr_sydorov' }, {
  username: 'oleksandr_sydorov', full_name: 'Олександр Сидоров', email: 'o.sydorov@example.com',
  registration_date: new Date('2024-03-10'), status: 'active', borrowed_books: ['Тигролови']
}));
printjson(db.users.findOne({ username: 'oleksandr_sydorov' }, { _id: 0 }));
print('  поле address зникло, бо його немає в новому документі');

// ---------------------------------------------------------------------
h('DELETE: тимчасові документи і видалення за умовою');
res(db.books.insertMany([
  { title: 'Тимчасова книга 1', author: 'Тест', publication_year: 2000, available: false, temp: true },
  { title: 'Тимчасова книга 2', author: 'Тест', publication_year: 2001, available: false, temp: true },
  { title: 'Застарілий довідник', author: 'Тест', publication_year: 1990, available: false, temp: true }
]));
res(db.books.deleteOne({ title: 'Застарілий довідник' }));
res(db.books.deleteMany({ temp: true, available: false }));

db.users.insertOne({ username: 'old_user', email: 'old@example.com', status: 'suspended',
                     registration_date: new Date('2020-01-01'), borrowed_books: [] });
res(db.users.deleteOne({ status: 'suspended', username: 'old_user' }));

h('Підсумок');
['authors', 'books', 'users'].forEach(c => print('  ' + c.padEnd(8) + db[c].countDocuments()));
