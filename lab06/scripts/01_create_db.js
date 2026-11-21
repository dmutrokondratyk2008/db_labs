// =====================================================================
// Лабораторна робота 6. 01_create_db.js
// Створення бази library і трьох колекцій: books (з базовою валідацією),
// authors, users. Скрипт можна запускати повторно: база створюється заново.
// Запуск: mongosh --quiet --file scripts/01_create_db.js
// =====================================================================
load(__dirname + '/lib/common.js');

db = db.getSiblingDB('library');

h('Видалення попередньої версії бази library');
printjson(db.dropDatabase());

h('Створення колекції books з базовою валідацією $jsonSchema');
printjson(db.createCollection('books', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['title', 'author', 'publication_year'],
      properties: {
        title:            { bsonType: 'string' },
        author:           { bsonType: 'string' },
        publication_year: { bsonType: 'int', minimum: 1000 },
        pages:            { bsonType: 'int', minimum: 1 },
        genres:           { bsonType: 'array', items: { bsonType: 'string' } },
        available:        { bsonType: 'bool' }
      }
    }
  }
}));

h('Створення колекцій authors і users');
printjson(db.createCollection('authors'));
printjson(db.createCollection('users'));

h('Колекції бази library');
db.getCollectionInfos().forEach(c =>
  print('  ' + c.name.padEnd(10) + ' type=' + c.type +
        '  validator=' + (c.options.validator ? 'так' : 'ні')));
