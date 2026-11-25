// =====================================================================
// Лабораторна робота 7. 02_indexes.js
// Рівень 1, крок 3 (і завдання 5). Індекси для всіх колекцій.
// Унікальні індекси створюються ДО наповнення, щоб уже під час
// вставки даних гарантувати відсутність дублікатів.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('blog_system');

function ix(coll, keys, opts) {
  opts = opts || {};
  const name = db.getCollection(coll).createIndex(keys, opts);
  const extra = Object.keys(opts).filter(k => k !== 'name').map(k => k + '=' + fmt(opts[k])).join(', ');
  print('  ' + coll.padEnd(14) + name.padEnd(48) + (extra ? ' ' + extra : ''));
}

h('users');
ix('users', { username: 1 }, { unique: true });
ix('users', { email: 1 }, { unique: true });
ix('users', { role: 1, status: 1 });
ix('users', { created_at: -1 });

h('categories (категорії та теги)');
ix('categories', { type: 1, slug: 1 }, { unique: true });              // slug унікальний у межах типу
ix('categories', { type: 1, name: 1 }, { unique: true, collation: { locale: 'uk', strength: 2 } });
ix('categories', { parent_id: 1 });

h('posts');
// унікальний URL посту
ix('posts', { slug: 1 }, { unique: true });
// пошук постів автора, новіші першими (сторінка автора, топ авторів)
ix('posts', { 'author.user_id': 1, created_at: -1 });
// пости категорії з фільтром за статусом, новіші першими
ix('posts', { 'category.category_id': 1, status: 1, published_at: -1 });
// головна стрічка і пагінація: статус + дата публікації (+ _id для стабільного порядку)
ix('posts', { status: 1, published_at: -1, _id: -1 });
// пошук за датою публікації лише серед опублікованих (частковий індекс)
ix('posts', { published_at: -1 }, { name: 'published_at_partial', partialFilterExpression: { status: 'published' } });
// теги (multikey-індекс за масивом) + сортування за датою
ix('posts', { tags: 1, published_at: -1 });
// повнотекстовий пошук: назва важливіша за опис, опис - за текст
ix('posts', { title: 'text', excerpt: 'text', content: 'text' },
   { name: 'posts_text', default_language: 'none', weights: { title: 10, excerpt: 4, content: 1 } });
// геолокація постів
ix('posts', { location: '2dsphere' });
// модерація: пошук коментаря за ідентифікатором і черга коментарів за статусом
ix('posts', { 'comments.comment_id': 1 });
ix('posts', { 'comments.status': 1 }, { name: 'comments_pending_partial',
   partialFilterExpression: { 'comments.status': 'pending' } });
// рейтинг постів
ix('posts', { 'statistics.rating': -1 }, { partialFilterExpression: { status: 'published' } });

h('reactions, post_views, post_versions, notifications');
ix('reactions', { post_id: 1, user_id: 1 }, { unique: true });      // одна реакція користувача на пост
ix('reactions', { user_id: 1, created_at: -1 });
ix('post_views', { post_id: 1, month: 1 }, { unique: true });       // один бакет на пост і місяць
ix('post_views', { month: 1 });
ix('post_versions', { post_id: 1, version: -1 }, { unique: true });
ix('notifications', { user_id: 1, read: 1, created_at: -1 });
// прочитані сповіщення автоматично видаляються через 30 днів (TTL)
ix('notifications', { read_at: 1 }, { expireAfterSeconds: 30 * 24 * 3600, partialFilterExpression: { read: true } });

h('Підсумок: кількість індексів у колекціях');
db.getCollectionNames().sort().forEach(c => {
  const list = db.getCollection(c).getIndexes();
  print('  ' + c.padEnd(14) + String(list.length).padStart(2) + ': ' + list.map(i => i.name).join(', '));
});
