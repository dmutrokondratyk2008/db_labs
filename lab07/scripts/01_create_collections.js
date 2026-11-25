// =====================================================================
// Лабораторна робота 7. 01_create_collections.js
// Рівень 1, кроки 1-2. Створення бази blog_system і колекцій
// з валідацією $jsonSchema (validationLevel: strict, validationAction: error).
//
// Основні колекції:      users, posts, categories (категорії та теги)
// Допоміжні колекції:    reactions      - лайки/дизлайки (рівень 2)
//                        post_views     - перегляди за днями, патерн Bucket (рівень 2)
//                        post_versions  - історія редагувань постів (рівень 3)
//                        notifications  - сповіщення авторів (рівень 3)
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('blog_system');

h('Видалення попередньої версії бази blog_system');
printjson(db.dropDatabase());

const STRICT = { validationLevel: 'strict', validationAction: 'error' };
const OID = { bsonType: 'objectId' };
const DATE = { bsonType: 'date' };
const NONNEG = { bsonType: ['int', 'long', 'double'], minimum: 0 };
const SLUG = { bsonType: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 220 };

// ---------------------------------------------------------------------
// users: автори, читачі, адміністратори
// ---------------------------------------------------------------------
h('Колекція users');
printjson(db.createCollection('users', Object.assign({
  validator: { $jsonSchema: {
    bsonType: 'object',
    title: 'Користувач блогу',
    required: ['username', 'email', 'password_hash', 'role', 'status', 'created_at'],
    additionalProperties: false,
    properties: {
      _id: OID,
      username: { bsonType: 'string', minLength: 3, maxLength: 30, pattern: '^[a-z0-9_.]+$',
                  description: "Ім'я користувача: 3-30 символів, латиниця, цифри, _ або ." },
      email: { bsonType: 'string', pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
               description: 'Email має відповідати стандартному формату' },
      password_hash: { bsonType: 'string', minLength: 60, description: 'Хеш пароля (не менше 60 символів)' },
      role: { enum: ['admin', 'author', 'reader'], description: 'Роль: admin, author або reader' },
      profile: { bsonType: 'object', additionalProperties: false,
        properties: {
          full_name: { bsonType: 'string', maxLength: 100 },
          bio: { bsonType: 'string', maxLength: 500 },
          avatar_url: { bsonType: 'string', pattern: '^https?://' },
          website: { bsonType: ['string', 'null'], pattern: '^https?://' },
          city: { bsonType: 'string' }
        } },
      statistics: { bsonType: 'object', additionalProperties: false,
        properties: { posts_count: NONNEG, comments_count: NONNEG, likes_received: NONNEG } },
      created_at: DATE,
      last_login: { bsonType: ['date', 'null'] },
      status: { enum: ['active', 'suspended', 'deleted'], description: 'Статус облікового запису' }
    }
  } }
}, STRICT)));

// ---------------------------------------------------------------------
// categories: поліморфна колекція (патерн Polymorphic) з дискримінатором type:
// type = "category" - рубрика (може мати батьківську категорію parent_id),
// type = "tag"      - тег; у постах теги зберігаються масивом slug-ів
// ---------------------------------------------------------------------
h('Колекція categories (категорії та теги)');
printjson(db.createCollection('categories', Object.assign({
  validator: { $jsonSchema: {
    bsonType: 'object',
    required: ['type', 'name', 'slug', 'created_at'],
    additionalProperties: false,
    properties: {
      _id: OID,
      type: { enum: ['category', 'tag'], description: 'Дискримінатор: category або tag' },
      name: { bsonType: 'string', minLength: 2, maxLength: 50 },
      slug: SLUG,
      description: { bsonType: 'string', maxLength: 300 },
      parent_id: { bsonType: ['objectId', 'null'], description: 'Батьківська категорія' },
      color: { bsonType: 'string', pattern: '^#[0-9a-f]{6}$' },
      statistics: { bsonType: 'object', additionalProperties: false,
        properties: { posts_count: NONNEG } },
      created_at: DATE
    }
  } }
}, STRICT)));

// ---------------------------------------------------------------------
// posts: статті з вбудованими коментарями, автором, категорією, тегами,
// статистикою, геолокацією і номером версії
// ---------------------------------------------------------------------
const commentSchema = {
  bsonType: 'object',
  required: ['comment_id', 'parent_id', 'depth', 'author', 'text', 'status', 'created_at'],
  additionalProperties: false,
  properties: {
    comment_id: OID,
    parent_id: { bsonType: ['objectId', 'null'], description: 'Батьківський коментар (null - коментар першого рівня)' },
    depth: { bsonType: 'int', minimum: 0, maximum: 5, description: 'Рівень вкладеності 0-5' },
    author: { bsonType: 'object', required: ['user_id', 'username'], additionalProperties: false,
      properties: { user_id: OID, username: { bsonType: 'string' } } },
    text: { bsonType: 'string', minLength: 2, maxLength: 2000 },
    status: { enum: ['pending', 'approved', 'rejected'], description: 'Статус модерації' },
    moderation: { bsonType: 'object', additionalProperties: false,
      properties: { by: OID, at: DATE, reason: { bsonType: 'string' } } },
    likes: NONNEG,
    created_at: DATE,
    updated_at: DATE
  }
};

h('Колекція posts');
printjson(db.createCollection('posts', Object.assign({
  validator: { $jsonSchema: {
    bsonType: 'object',
    required: ['title', 'slug', 'content', 'author', 'category', 'tags', 'status',
               'comments', 'statistics', 'version', 'created_at', 'updated_at'],
    additionalProperties: false,
    properties: {
      _id: OID,
      title: { bsonType: 'string', minLength: 3, maxLength: 200, description: 'Назва 3-200 символів' },
      slug: SLUG,
      content: { bsonType: 'string', minLength: 100, description: 'Текст статті, щонайменше 100 символів' },
      excerpt: { bsonType: 'string', maxLength: 400 },
      author: { bsonType: 'object', required: ['user_id', 'username'], additionalProperties: false,
        properties: { user_id: OID, username: { bsonType: 'string' }, avatar_url: { bsonType: 'string' } } },
      category: { bsonType: 'object', required: ['category_id', 'name'], additionalProperties: false,
        properties: { category_id: OID, name: { bsonType: 'string' }, slug: SLUG } },
      tags: { bsonType: 'array', maxItems: 10, uniqueItems: true,
              items: { bsonType: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' } },
      featured_image: { bsonType: 'string', pattern: '^https?://' },
      status: { enum: ['draft', 'published', 'archived'], description: 'Статус посту' },
      comments: { bsonType: 'array', items: commentSchema },
      statistics: { bsonType: 'object', required: ['views', 'likes', 'dislikes', 'comments_count'],
        additionalProperties: false,
        properties: { views: NONNEG, likes: NONNEG, dislikes: NONNEG, rating: { bsonType: ['int', 'long', 'double'] },
                      comments_count: NONNEG } },
      location: { bsonType: 'object', required: ['type', 'coordinates'], additionalProperties: false,
        description: 'Точка GeoJSON: [довгота, широта]',
        properties: {
          type: { enum: ['Point'] },
          coordinates: { bsonType: 'array', minItems: 2, maxItems: 2,
            items: [ { bsonType: ['double', 'int'], minimum: -180, maximum: 180 },
                     { bsonType: ['double', 'int'], minimum: -90, maximum: 90 } ] },
          place: { bsonType: 'string' }
        } },
      version: { bsonType: 'int', minimum: 1, description: 'Номер поточної версії' },
      created_at: DATE,
      updated_at: DATE,
      published_at: { bsonType: ['date', 'null'] }
    }
  } }
}, STRICT)));

// ---------------------------------------------------------------------
// reactions: один документ на пару (пост, користувач), value = 1 (лайк) або -1 (дизлайк)
// ---------------------------------------------------------------------
h('Колекція reactions');
printjson(db.createCollection('reactions', Object.assign({
  validator: { $jsonSchema: {
    bsonType: 'object', required: ['post_id', 'user_id', 'value', 'created_at'], additionalProperties: false,
    properties: { _id: OID, post_id: OID, user_id: OID, value: { enum: [1, -1] }, created_at: DATE, updated_at: DATE }
  } }
}, STRICT)));

// ---------------------------------------------------------------------
// post_views: патерн Bucket - один документ на пост і місяць,
// daily - лічильники за днями місяця ("01".."31")
// ---------------------------------------------------------------------
h('Колекція post_views (патерн Bucket)');
printjson(db.createCollection('post_views', Object.assign({
  validator: { $jsonSchema: {
    bsonType: 'object', required: ['post_id', 'month', 'daily', 'total'], additionalProperties: false,
    properties: { _id: OID, post_id: OID, month: { bsonType: 'string', pattern: '^[0-9]{4}-[0-9]{2}$' },
                  daily: { bsonType: 'object', patternProperties: { '^[0-3][0-9]$': NONNEG }, additionalProperties: false },
                  total: NONNEG }
  } }
}, STRICT)));

// ---------------------------------------------------------------------
// post_versions: знімки попередніх версій посту (рівень 3)
// ---------------------------------------------------------------------
h('Колекція post_versions');
printjson(db.createCollection('post_versions', Object.assign({
  validator: { $jsonSchema: {
    bsonType: 'object', required: ['post_id', 'version', 'snapshot', 'edited_by', 'edited_at'], additionalProperties: false,
    properties: {
      _id: OID, post_id: OID, version: { bsonType: 'int', minimum: 1 },
      snapshot: { bsonType: 'object', required: ['title', 'content'],
        properties: { title: { bsonType: 'string' }, content: { bsonType: 'string' }, excerpt: { bsonType: 'string' },
                      tags: { bsonType: 'array' }, category: { bsonType: 'object' }, status: { bsonType: 'string' } } },
      changed_fields: { bsonType: 'array', items: { bsonType: 'string' } },
      change_note: { bsonType: 'string' },
      edited_by: { bsonType: 'object', required: ['user_id', 'username'],
                   properties: { user_id: OID, username: { bsonType: 'string' } } },
      edited_at: DATE
    }
  } }
}, STRICT)));

// ---------------------------------------------------------------------
// notifications: сповіщення авторам про нові коментарі та відповіді (рівень 3)
// ---------------------------------------------------------------------
h('Колекція notifications');
printjson(db.createCollection('notifications', Object.assign({
  validator: { $jsonSchema: {
    bsonType: 'object', required: ['user_id', 'type', 'post_id', 'message', 'read', 'created_at'], additionalProperties: false,
    properties: {
      _id: OID, user_id: OID,
      type: { enum: ['new_comment', 'comment_reply', 'comment_approved', 'comment_rejected'] },
      post_id: OID, post_title: { bsonType: 'string' }, comment_id: OID,
      from: { bsonType: 'object', properties: { user_id: OID, username: { bsonType: 'string' } } },
      message: { bsonType: 'string' },
      read: { bsonType: 'bool' }, read_at: { bsonType: ['date', 'null'] }, created_at: DATE
    }
  } }
}, STRICT)));

h('Колекції бази blog_system і їхні правила валідації');
db.getCollectionInfos().forEach(c => {
  const s = c.options.validator.$jsonSchema;
  print('  ' + c.name.padEnd(14) + ' required: [' + s.required.join(', ') + '], ' +
        c.options.validationLevel + '/' + c.options.validationAction);
});

// ---------------------------------------------------------------------
// Перевірка валідації: некоректні документи відхиляються
// ---------------------------------------------------------------------
h('Перевірка валідації: некоректні документи');
const now = new Date();
const bad = [
  ['users', 'роль "moderator" не з переліку',
   { username: 'test_user', email: 'test@blog.ua', password_hash: 'x'.repeat(60), role: 'moderator', status: 'active', created_at: now }],
  ['users', 'некоректний email',
   { username: 'test_user', email: 'test-at-blog.ua', password_hash: 'x'.repeat(60), role: 'reader', status: 'active', created_at: now }],
  ['posts', 'контент коротший за 100 символів',
   { title: 'Тест', slug: 'test', content: 'Закоротко', author: { user_id: new ObjectId(), username: 'a' },
     category: { category_id: new ObjectId(), name: 'Тест' }, tags: [], status: 'published', comments: [],
     statistics: { views: 0, likes: 0, dislikes: 0, comments_count: 0 }, version: 1, created_at: now, updated_at: now }],
  ['posts', 'slug з великими літерами і пробілом',
   { title: 'Тест', slug: 'Bad Slug', content: 'x'.repeat(120), author: { user_id: new ObjectId(), username: 'a' },
     category: { category_id: new ObjectId(), name: 'Тест' }, tags: [], status: 'published', comments: [],
     statistics: { views: 0, likes: 0, dislikes: 0, comments_count: 0 }, version: 1, created_at: now, updated_at: now }],
  ['posts', 'коментар зі статусом "spam"',
   { title: 'Тест', slug: 'test', content: 'x'.repeat(120), author: { user_id: new ObjectId(), username: 'a' },
     category: { category_id: new ObjectId(), name: 'Тест' }, tags: [], status: 'published',
     comments: [{ comment_id: new ObjectId(), parent_id: null, depth: NumberInt(0), author: { user_id: new ObjectId(), username: 'b' },
                  text: 'Привіт', status: 'spam', created_at: now }],
     statistics: { views: 0, likes: 0, dislikes: 0, comments_count: 0 }, version: 1, created_at: now, updated_at: now }],
  ['categories', 'type "rubric" не з переліку',
   { type: 'rubric', name: 'Тест', slug: 'test', created_at: now }],
  ['reactions', 'value = 5 (дозволено лише 1 або -1)',
   { post_id: new ObjectId(), user_id: new ObjectId(), value: 5, created_at: now }]
];
bad.forEach(([coll, what, doc]) => {
  try {
    db.getCollection(coll).insertOne(doc);
    print('  ' + coll + ': ' + what + ' -> ВСТАВЛЕНО (помилка!)');
  } catch (e) {
    print('  ' + coll.padEnd(10) + ' ' + what.padEnd(36) + ' -> відхилено: ' + cn(e));
  }
});
