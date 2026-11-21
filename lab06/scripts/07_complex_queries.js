// =====================================================================
// Лабораторна робота 6. 07_complex_queries.js
// Складні запити з $and, $or, $in, $nin, $regex, $all, $exists, $not.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');
const p = { _id: 0, title: 1, author: 1, publication_year: 1 };

h('$and + $or: доступні повісті АБО романи, видані після 1900 року');
rows(db.books.find({
  $and: [
    { available: true },
    { $or: [ { genres: 'повість' }, { genres: 'роман' } ] },
    { publication_year: { $gt: 1900 } }
  ]
}, p));

h('$or з умовами на різні поля: дуже старі (<1840) АБО великі (>=300 с.) книги');
rows(db.books.find({ $or: [ { publication_year: { $lt: 1840 } }, { pages: { $gte: 300 } } ] },
                   { _id: 0, title: 1, publication_year: 1, pages: 1 }));

h('$in і $nin: книги видавництв Харкова, крім жанрів "повість" і "новела"');
rows(db.books.find({ 'publisher.city': { $in: ['Харків'] }, genres: { $nin: ['повість', 'новела'] } },
                   { _id: 0, title: 1, genres: 1 }));

h('$regex: назва починається на "К" (з урахуванням регістру)');
rows(db.books.find({ title: { $regex: '^К' } }, { _id: 0, title: 1 }));

h('$regex з опцією i: слово "кохан" в описі в будь-якому регістрі');
rows(db.books.find({ description: { $regex: /кохан/i } }, { _id: 0, title: 1, description: 1 }));

h('$regex по вкладеному полю: читачі з вулиць "вул. В..." або "вул. Ш..."');
rows(db.users.find({ 'address.street': { $regex: /^вул\. [ВШ]/ } }, { _id: 0, username: 1, 'address.street': 1 }));

h('$all і $size: книги, що одночасно "повість" і "романтизм"; книги з рівно 3 жанрами');
rows(db.books.find({ genres: { $all: ['повість', 'романтизм'] } }, { _id: 0, title: 1, genres: 1 }));
rows(db.books.find({ genres: { $size: 3 } }, { _id: 0, title: 1, genres: 1 }));

h('$exists і $not: автори з псевдонімами; книги, де НЕ всі оцінки >= 5');
rows(db.authors.find({ pseudonyms: { $exists: true } }, { _id: 0, name: 1, pseudonyms: 1 }));
rows(db.books.find({ ratings: { $exists: true }, 'ratings.score': { $not: { $gte: 5 } } }, { _id: 0, title: 1, 'ratings.score': 1 }));

h('Комбінований запит: активні читачі з Луцька, що мають книги на руках, або з неоплаченими штрафами');
rows(db.users.find({
  $or: [
    { $and: [ { status: 'active' }, { 'address.city': 'Луцьк' }, { 'borrowed_books.0': { $exists: true } } ] },
    { fines: { $elemMatch: { paid: false } } }
  ]
}, { _id: 0, username: 1, status: 1, 'address.city': 1, borrowed_books: 1 }));
