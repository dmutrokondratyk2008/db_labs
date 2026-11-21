// =====================================================================
// Лабораторна робота 6. 11_lookup_views.js
// Об'єднання колекцій оператором $lookup (аналог JOIN) і представлення
// (view) для часто використовуваних запитів.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');

h('Посилання author_id у книгах (за іменем автора)');
let n = 0;
db.authors.find().forEach(a => {
  n += db.books.updateMany({ author: a.name }, { $set: { author_id: a._id } }).modifiedCount;
});
print('  оновлено книг: ' + n + ', без author_id: ' + db.books.countDocuments({ author_id: { $exists: false } }));
print('  ' + db.books.createIndex({ author_id: 1 }));

h('$lookup books -> authors (LEFT OUTER JOIN по author_id)');
rows(db.books.aggregate([
  { $lookup: { from: 'authors', localField: 'author_id', foreignField: '_id', as: 'author_details' } },
  { $unwind: '$author_details' },
  { $project: { _id: 0, title: 1, publication_year: 1, 'author_details.name': 1, 'author_details.birth_year': 1,
                age_at_publication: { $subtract: ['$publication_year', '$author_details.birth_year'] } } },
  { $sort: { age_at_publication: 1 } }
]), 6);

h('$lookup з pipeline: автори і кількість їхніх книг у фонді (з авторами без книг)');
rows(db.authors.aggregate([
  { $lookup: { from: 'books', let: { aid: '$_id' },
               pipeline: [ { $match: { $expr: { $eq: ['$author_id', '$$aid'] } } },
                           { $project: { _id: 0, title: 1, available: 1 } } ],
               as: 'books' } },
  { $project: { _id: 0, name: 1, books_in_library: { $size: '$books' },
                available_now: { $size: { $filter: { input: '$books', cond: '$$this.available' } } } } },
  { $sort: { books_in_library: -1, name: 1 } }
]));

h('$lookup за масивом: книги на руках у читачів + автор (два рівні об\'єднання)');
rows(db.users.aggregate([
  { $match: { 'borrowed_books.1': { $exists: true } } },
  { $lookup: { from: 'books', localField: 'borrowed_books', foreignField: 'title', as: 'loans',
               pipeline: [
                 { $lookup: { from: 'authors', localField: 'author_id', foreignField: '_id', as: 'a' } },
                 { $project: { _id: 0, title: 1, author: { $first: '$a.name' } } } ] } },
  { $project: { _id: 0, username: 1, loans: 1 } }
]));

h('Представлення (view)');
['available_books', 'books_with_authors', 'reader_cards'].forEach(v => db.getCollection(v).drop());

// 1. Каталог доступних книг
printjson(db.createView('available_books', 'books', [
  { $match: { available: true } },
  { $project: { _id: 0, title: 1, author: 1, publication_year: 1, pages: 1 } }
]));
// 2. Книги з даними автора (часто потрібний JOIN)
printjson(db.createView('books_with_authors', 'books', [
  { $lookup: { from: 'authors', localField: 'author_id', foreignField: '_id', as: 'a' } },
  { $unwind: '$a' },
  { $project: { _id: 0, title: 1, publication_year: 1, available: 1, genres: 1,
                author: '$a.name', author_years: { $concat: [ { $toString: '$a.birth_year' }, '-', { $toString: '$a.death_year' } ] },
                author_region: { $ifNull: ['$a.birthplace.region', '-'] } } }
]));
// 3. Картка читача: кількість книг, сума неоплачених штрафів
printjson(db.createView('reader_cards', 'users', [
  { $project: { _id: 0, username: 1, full_name: 1, status: 1, city: '$address.city',
                books_on_hand: { $size: '$borrowed_books' },
                unpaid_fines: { $sum: { $map: { input: { $ifNull: ['$fines', []] }, as: 'f',
                                                in: { $cond: ['$$f.paid', 0, '$$f.amount'] } } } } } }
]));

h('Список колекцій і представлень');
db.getCollectionInfos({ name: { $not: /^system\./ } }).forEach(ci =>
  print('  ' + ci.name.padEnd(20) + ci.type + (ci.options.viewOn ? ' on ' + ci.options.viewOn : '')));

h('Запити до представлень як до звичайних колекцій');
q('available_books.find({ publication_year: { $lt: 1900 } })');
rows(db.available_books.find({ publication_year: { $lt: 1900 } }).sort({ publication_year: 1 }));
q("books_with_authors.find({ author_region: 'Харківщина' })");
rows(db.books_with_authors.find({ author_region: 'Харківщина' }));
q('reader_cards.find({ $or: [ { unpaid_fines: { $gt: 0 } }, { books_on_hand: { $gte: 2 } } ] })');
rows(db.reader_cards.find({ $or: [ { unpaid_fines: { $gt: 0 } }, { books_on_hand: { $gte: 2 } } ] }).sort({ unpaid_fines: -1 }));

h('Представлення доступне лише для читання');
try { db.available_books.insertOne({ title: 'x' }); }
catch (e) { print('  ' + cn(e) + ': ' + e.message); }
