// =====================================================================
// Лабораторна робота 6. 12_validation.js
// Валідація схеми документів JSON Schema ($jsonSchema) для books,
// authors і users. Для authors додано міжпольове правило через $expr
// (рік смерті не раніше року народження), якого JSON Schema не вміє.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');

// Короткий опис причин відхилення з errInfo.details
function why(e) {
  const out = [];
  (function walk(o, path) {
    if (!o || typeof o !== 'object') return;
    if (o.propertyName) path = path ? path + '.' + o.propertyName : o.propertyName;
    if (o.missingProperties) out.push('відсутні ' + o.missingProperties.join(','));
    if (o.reason && path) out.push(path + ': ' + (o.description || o.reason));
    else if (o.description && path && !o.details) out.push(path + ': ' + o.description);
    if (o.operatorName === '$expr' && o.specifiedAs) out.push('$expr: правило не виконано');
    Object.values(o).forEach(v => walk(v, path));
  })(e.errInfo && e.errInfo.details, '');
  return [...new Set(out)].join('; ');
}
function tryInsert(coll, doc, label) {
  try { db[coll].insertOne(doc); print('  [OK ] ' + label); }
  catch (e) { print('  [ERR] ' + label + ' -> ' + cn(e) + ' (' + e.code + '): ' + why(e)); }
}

h('books: розширена схема (strict)');
printjson(db.runCommand({
  collMod: 'books',
  validator: { $jsonSchema: {
    bsonType: 'object',
    required: ['title', 'author', 'publication_year', 'available'],
    properties: {
      title:            { bsonType: 'string', minLength: 1, maxLength: 200, description: 'Назва обов\'язкова, 1-200 символів' },
      author:           { bsonType: 'string', minLength: 1, description: 'Автор обов\'язковий' },
      author_id:        { bsonType: 'objectId', description: 'Посилання на authors._id' },
      publication_year: { bsonType: 'int', minimum: 1000, maximum: 2100, description: 'Рік видання 1000-2100' },
      pages:            { bsonType: 'int', minimum: 1, maximum: 10000, description: 'Сторінок 1-10000' },
      isbn:             { bsonType: 'string', pattern: '^978-\\d{1,5}-\\d{1,7}-\\d{1,7}-\\d{1}$', description: 'ISBN у форматі 978-X-X-X-X' },
      genres:           { bsonType: 'array', minItems: 1, uniqueItems: true, items: { bsonType: 'string' }, description: 'Непорожній масив унікальних жанрів' },
      available:        { bsonType: 'bool', description: 'Доступність обов\'язкова' },
      publisher:        { bsonType: 'object', required: ['name'],
                          properties: { name: { bsonType: 'string' }, city: { bsonType: 'string' } } },
      ratings:          { bsonType: 'array', items: { bsonType: 'object', required: ['user', 'score'],
                          properties: { user: { bsonType: 'string' },
                                        score: { bsonType: 'int', minimum: 1, maximum: 5, description: 'Оцінка 1-5' },
                                        date: { bsonType: 'date' } } } }
    }
  } },
  validationLevel: 'strict',
  validationAction: 'error'
}));

h('authors: $jsonSchema + $expr');
printjson(db.runCommand({
  collMod: 'authors',
  validator: { $and: [
    { $jsonSchema: {
      bsonType: 'object', required: ['name', 'birth_year', 'nationality'],
      properties: {
        name:        { bsonType: 'string', minLength: 3 },
        birth_year:  { bsonType: 'int', minimum: 900, maximum: 2026 },
        death_year:  { bsonType: ['int', 'null'] },
        nationality: { bsonType: 'string' },
        pseudonyms:  { bsonType: 'array', items: { bsonType: 'string' } },
        birthplace:  { bsonType: 'object', properties: { city: { bsonType: 'string' }, village: { bsonType: 'string' },
                                                        region: { bsonType: 'string' } } }
      } } },
    { $expr: { $or: [ { $eq: [ { $ifNull: ['$death_year', null] }, null ] },
                      { $gte: ['$death_year', '$birth_year'] } ] } }
  ] },
  validationLevel: 'strict'
}));

h('users: email, username, статус і штрафи');
printjson(db.runCommand({
  collMod: 'users',
  validator: { $jsonSchema: {
    bsonType: 'object', required: ['username', 'email', 'status', 'registration_date'],
    properties: {
      username:          { bsonType: 'string', pattern: '^[a-z][a-z0-9_]{2,31}$', description: 'Латиниця, цифри, _, 3-32 символи' },
      email:             { bsonType: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$', description: 'Коректний email' },
      status:            { enum: ['active', 'suspended', 'blocked'], description: 'active | suspended | blocked' },
      registration_date: { bsonType: 'date' },
      borrowed_books:    { bsonType: 'array', maxItems: 5, items: { bsonType: 'string' }, description: 'Не більше 5 книг на руках' },
      fines:             { bsonType: 'array', items: { bsonType: 'object', required: ['amount', 'paid'],
                           properties: { amount: { bsonType: ['int', 'double'], minimum: 0 }, paid: { bsonType: 'bool' } } } }
    }
  } }
}));

h('Наявні документи відповідають схемам (кількість порушників)');
['books', 'authors', 'users'].forEach(cn => {
  const v = db.getCollectionInfos({ name: cn })[0].options.validator;
  print('  ' + cn.padEnd(8) + db[cn].countDocuments({ $nor: [v] }));
});

h('Спроби вставити некоректні документи');
tryInsert('books', { title: 'Тестова книга', author: 'Тестовий автор', publication_year: 3000, available: true }, 'рік 3000');
tryInsert('books', { title: 'Без доступності', author: 'Автор', publication_year: 2020 }, 'немає available');
tryInsert('books', { title: 'Поганий ISBN', author: 'Автор', publication_year: 2020, available: true, isbn: '12345' }, 'ISBN 12345');
tryInsert('books', { title: 'Рік рядком', author: 'Автор', publication_year: '2020', available: 'так' }, 'типи string замість int/bool');
tryInsert('books', { title: 'Оцінка 7', author: 'Автор', publication_year: 2020, available: true,
                     ratings: [ { user: 'ivan_petrov', score: 7 } ] }, 'оцінка 7 у ratings');
tryInsert('books', { title: 'Дубль жанрів', author: 'Автор', publication_year: 2020, available: true,
                     genres: ['роман', 'роман'] }, 'жанри, що повторюються');
tryInsert('authors', { name: 'Помилковий автор', birth_year: 1900, death_year: 1850, nationality: 'український' }, 'death_year < birth_year');
tryInsert('users', { username: 'Bad User', email: 'not-an-email', status: 'vip', registration_date: new Date() }, 'username, email, status');
tryInsert('users', { username: 'reader_many', email: 'many@example.com', status: 'active', registration_date: new Date(),
                     borrowed_books: ['a', 'b', 'c', 'd', 'e', 'f'] }, '6 книг на руках');

h('Оновлення теж перевіряється');
try { db.books.updateOne({ title: 'Кобзар' }, { $set: { pages: -5 } }); }
catch (e) { print('  [ERR] pages=-5 -> ' + cn(e) + ': ' + why(e)); }

h('Коректний документ проходить валідацію');
tryInsert('books', { title: 'Сад Гетсиманський', author: 'Іван Багряний', publication_year: 1950, pages: 512,
                     isbn: '978-966-03-9050-3', genres: ['роман', 'автобіографічна проза'], available: true,
                     author_id: db.authors.findOne({ name: 'Іван Багряний' })._id,
                     publisher: { name: 'Фоліо', city: 'Харків' },
                     description: 'Автобіографічний роман про ув\'язнення в тюрмах НКВС' }, 'Сад Гетсиманський');
