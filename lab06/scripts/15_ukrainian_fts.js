// =====================================================================
// Лабораторна робота 6. 15_ukrainian_fts.js
// Повнотекстовий пошук з підтримкою української мови.
// Основи слів (lib/uk_stemmer.js) зберігаються в полі search_terms,
// текстовий індекс будується за назвою, автором, описом і основами;
// запит користувача теж зводиться до основ.
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/uk_stemmer.js');
db = db.getSiblingDB('library');

h('Робота стемера');
['Карпати Карпатах карпатських', 'кохання коханням коханий', 'повість повісті повістей',
 'селяни селян селянами', "пам'ять пам'яті"].forEach(t =>
  print('  ' + t.padEnd(32) + ' -> ' + UkStem.tokens(t).map(UkStem.stem).join(' ')));
print('  стоп-слова відкидаються: "' + 'повість про кохання в Карпатах' + '" -> ' + UkStem.query('повість про кохання в Карпатах'));

// Функція оновлення search_terms (викликається після вставки або зміни книги)
globalThis.refreshSearchTerms = function (filter) {
  let n = 0;
  db.books.find(filter || {}).forEach(b => {
    db.books.updateOne({ _id: b._id }, { $set: { search_terms: UkStem.terms(b.title, b.author, b.description, b.genres || []) } });
    n++;
  });
  return n;
};

h('Обчислення search_terms для всіх книг');
print('  оновлено: ' + refreshSearchTerms());
rows(db.books.find({ title: { $in: ['Тіні забутих предків', 'Захар Беркут'] } }, { _id: 0, title: 1, search_terms: 1 }));

h('Новий текстовий індекс (у колекції може бути лише один text-індекс)');
const save = {};
['Карпати', 'селяни', 'повісті', 'коханий', 'боротьбу горян', 'українських новел'].forEach(w =>
  save[w] = db.books.countDocuments({ $text: { $search: w } }));
db.books.dropIndex('books_text');
print('  ' + db.books.createIndex(
  { title: 'text', author: 'text', search_terms: 'text', description: 'text' },
  { name: 'books_text_uk', default_language: 'none',
    weights: { title: 10, author: 5, search_terms: 3, description: 1 } }
));

// Пошук: слова запиту зводяться до основ
globalThis.searchUk = function (text, limit) {
  return db.books.find({ $text: { $search: UkStem.query(text) } },
                       { _id: 0, title: 1, author: 1, score: { $meta: 'textScore' } })
                 .sort({ score: { $meta: 'textScore' } }).limit(limit || 10).toArray();
};

h('Порівняння: старий індекс (без стемінгу) і пошук з основами');
print('  запит                старий  новий   основи запиту');
Object.keys(save).forEach(w =>
  print('  ' + w.padEnd(20) + String(save[w]).padStart(6) + String(searchUk(w).length).padStart(7) + '   ' + UkStem.query(w)));

h('Пошук "Карпати" (в описі є лише "Карпатах" і "карпатських")');
rows(searchUk('Карпати'));

h('Пошук "кохана повість" з ранжуванням за релевантністю');
rows(searchUk('кохана повість'));

h('Пошук за автором у будь-якому відмінку: "Франка", "Коцюбинського"');
rows(searchUk('Франка'));
rows(searchUk('Коцюбинського'));

h('Пошук з фільтром і агрегацією: доступні книги на тему "життя селян"');
rows(db.books.aggregate([
  { $match: { $text: { $search: UkStem.query('життя селян') }, available: true } },
  { $project: { _id: 0, title: 1, score: { $round: [{ $meta: 'textScore' }, 2] } } },
  { $sort: { score: -1 } }
]));

h('Нова книга: search_terms обчислюється при вставці');
db.books.insertOne({ title: 'Царівна', author: 'Ольга Кобилянська', publication_year: 1896, pages: 352,
                     isbn: '978-966-03-1896-2', genres: ['роман', 'модернізм'], available: true,
                     author_id: db.authors.findOne({ name: 'Ольга Кобилянська' })._id,
                     description: 'Роман про духовне становлення освіченої жінки',
                     version: 1, updated_at: new Date(), updated_by: 'librarian_olha' });
refreshSearchTerms({ title: 'Царівна' });
rows(searchUk('жінки романи'));
