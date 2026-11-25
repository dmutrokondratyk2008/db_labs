// =====================================================================
// Лабораторна робота 7. test/api-test.js
// Наскрізна перевірка RESTful API (сервер має бути запущений):
//   node test/api-test.js
// Кожен крок виводить HTTP-метод, шлях, статус і коротку суть відповіді;
// у кінці - підсумок пройдених перевірок.
// =====================================================================
const BASE = process.env.API || 'http://localhost:3000/api';
let passed = 0, failed = 0;

async function call(method, path, { user, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['X-User-Id'] = user;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, cache: res.headers.get('x-cache'), time: res.headers.get('x-response-time') };
}
function check(name, cond, info) {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${name}${info !== undefined ? ' -> ' + info : ''}`);
}
const h = t => console.log('\n=== ' + t + ' ===');

(async () => {
  h('Довідники');
  const users = (await call('GET', '/users')).data;
  const by = n => users.find(u => u.username === n)._id;
  const author = by('ivan.petrenko'), other = by('maria.shevchuk'), reader = by('anna.sydorenko'),
        reader2 = by('oleh.marchuk'), admin = by('olena.kovalenko'), blocked = users.find(u => u.status === 'suspended')._id;
  check('GET /users без email і password_hash', users.length === 20 && !('email' in users[0]) && !('password_hash' in users[0]), users.length + ' користувачів');
  const cats = (await call('GET', '/categories')).data;
  check('GET /categories', cats.length === 10, cats.length + ' категорій');
  const tags = (await call('GET', '/tags')).data;
  check('GET /tags', tags.length === 30, tags.length + ' тегів');

  h('Список постів, фільтри, пагінація');
  await call('DELETE', '/cache');
  let r = await call('GET', '/posts?limit=5&page=2');
  check('GET /posts?limit=5&page=2', r.status === 200 && r.data.items.length === 5 && r.data.page === 2, `total ${r.data.total}, pages ${r.data.pages}, X-Cache ${r.cache}`);
  r = await call('GET', '/posts?limit=5&page=2');
  check('повторний запит віддається з кешу', r.cache === 'HIT', 'X-Cache ' + r.cache + ', ' + r.time);
  r = await call('GET', '/posts?tags=mongodb,nosql&tag_mode=all');
  check('теги $all: mongodb + nosql', r.data.items.every(p => p.tags.includes('mongodb') && p.tags.includes('nosql')), r.data.total + ' постів');
  r = await call('GET', '/posts?tags=docker,kubernetes&tag_mode=any');
  check('теги $in: docker або kubernetes', r.data.items.every(p => p.tags.includes('docker') || p.tags.includes('kubernetes')), r.data.total + ' постів');
  r = await call('GET', '/posts?q=' + encodeURIComponent('MongoDB'));
  check('повнотекстовий пошук q=MongoDB (сортування за score)', r.data.total > 0 && r.data.items[0].score >= r.data.items[r.data.items.length - 1].score,
        r.data.items.map(p => p.title).slice(0, 2).join(' | '));
  r = await call('GET', '/posts?category=databases&sort=views');
  check('категорія + сортування за переглядами', r.data.items.every((p, i, a) => !i || a[i - 1].statistics.views >= p.statistics.views), r.data.total + ' постів');
  r = await call('GET', '/posts?lng=25.3254&lat=50.7472&km=100');
  check('геофільтр: 100 км від Луцька, відстань зростає', r.data.items.every((p, i, a) => !i || a[i - 1].distance_m <= p.distance_m), r.data.total + ' постів');
  r = await call('GET', '/posts?status=draft');
  check('гість не бачить чернеток (?status=draft)', r.status === 403, r.status + ' ' + r.data.error);
  r = await call('GET', '/posts?status=draft', { user: reader });
  check('читач не бачить чернеток', r.status === 403, String(r.status));
  r = await call('GET', '/posts?status=all&limit=50', { user: author });
  check('автор бачить лише власні чернетки й архівні', r.status === 200 && r.data.items.every(p => p.author.username === 'ivan.petrenko'),
        r.data.total + ' постів, статуси: ' + [...new Set(r.data.items.map(p => p.status))].join(','));
  r = await call('GET', '/posts?status=draft', { user: admin });
  check('адміністратор бачить усі чернетки', r.status === 200 && r.data.items.every(p => p.status === 'draft') && new Set(r.data.items.map(p => p.author.username)).size > 1,
        r.data.total + ' чернеток');

  h('Створення посту');
  r = await call('POST', '/posts', { user: reader, body: { title: 'Тест', content: 'x'.repeat(120), category: 'databases' } });
  check('читач не може створити пост', r.status === 403, r.status + ' ' + r.data.error);
  r = await call('POST', '/posts', { user: author, body: { title: 'Ко', content: 'коротко', category: 'databases' } });
  check('валідація: коротка назва', r.status === 400, r.status + ' ' + r.data.error);
  const content = 'Колекції з валідацією $jsonSchema дозволяють поєднати гнучкість документної моделі з контролем структури даних.\n\n' +
    'У цій статті показано, як описати обов’язкові поля, перелік допустимих значень і вкладені документи.';
  r = await call('POST', '/posts', { user: author, body: { title: 'Валідація схеми в MongoDB на практиці', content, category: 'databases',
    tags: 'mongodb, nosql, JSON Schema', place: 'Луцьк', lng: 25.3254, lat: 50.7472 } });
  check('POST /posts (автор)', r.status === 201, r.status + ' slug=' + (r.data && r.data.slug));
  const { _id: postId, slug } = r.data;
  r = await call('GET', '/posts/' + slug);
  check('новий пост доступний, теги нормалізовані в slug', r.status === 200 && r.data.tags.includes('json-schema'), JSON.stringify(r.data.tags));
  r = await call('POST', '/posts', { user: author, body: { title: 'Валідація схеми в MongoDB на практиці', content, category: 'databases' } });
  check('дубль назви -> унікальний slug', r.status === 201 && r.data.slug !== slug, r.data.slug);
  const dupId = r.data._id;

  h('Перегляди і реакції');
  r = await call('POST', `/posts/${postId}/view`);
  const v1 = r.data.views;
  r = await call('POST', `/posts/${postId}/view`);
  check('POST /view інкрементує лічильник', r.data.views === v1 + 1, `${v1} -> ${r.data.views}`);
  r = await call('POST', `/posts/${postId}/reactions`, { user: reader, body: { value: 1 } });
  check('лайк', r.data.action === 'added' && r.data.statistics.likes === 1, JSON.stringify(r.data.statistics));
  r = await call('POST', `/posts/${postId}/reactions`, { user: reader2, body: { value: -1 } });
  check('дизлайк іншого користувача', r.data.statistics.dislikes === 1 && r.data.statistics.rating === 0, JSON.stringify(r.data.statistics));
  r = await call('POST', `/posts/${postId}/reactions`, { user: reader2, body: { value: 1 } });
  check('зміна дизлайку на лайк', r.data.action === 'switched' && r.data.statistics.likes === 2 && r.data.statistics.dislikes === 0, JSON.stringify(r.data.statistics));
  r = await call('POST', `/posts/${postId}/reactions`, { user: reader, body: { value: 1 } });
  check('повторний лайк скасовує реакцію', r.data.action === 'removed' && r.data.statistics.likes === 1, JSON.stringify(r.data.statistics));
  r = await call('POST', `/posts/${postId}/reactions`, { user: reader, body: { value: 5 } });
  check('value = 5 відхиляється', r.status === 400, r.status + ' ' + r.data.error);

  h('Коментарі, модерація, сповіщення');
  const unreadBefore = (await call('GET', '/notifications?unread=1', { user: author })).data.unread;
  r = await call('POST', `/posts/${postId}/comments`, { user: reader, body: { text: 'Чи можна валідувати масиви вкладених документів?' } });
  check('коментар читача -> pending', r.status === 201 && r.data.status === 'pending', r.data.status);
  const c1 = r.data.comment_id;
  r = await call('GET', '/notifications?unread=1', { user: author });
  check('автор отримав сповіщення про новий коментар', r.data.unread === unreadBefore + 1, `${unreadBefore} -> ${r.data.unread}: ${r.data.items[0].message}`);
  r = await call('GET', '/posts/' + slug);
  check('гість не бачить коментар на модерації', r.data.comment_tree.length === 0, 'видимих: ' + r.data.comment_tree.length);
  r = await call('GET', '/posts/' + slug, { user: reader });
  check('автор коментаря бачить свій pending-коментар', r.data.comment_tree.length === 1);
  r = await call('GET', '/moderation/queue', { user: reader });
  check('черга модерації недоступна читачу', r.status === 403, r.status + ' ' + r.data.error);
  r = await call('GET', '/moderation/queue', { user: admin });
  check('адміністратор бачить коментар у черзі', r.status === 200 && r.data.some(x => x.comment.comment_id === c1), r.data.length + ' в черзі');
  r = await call('PATCH', `/comments/${c1}`, { user: reader2, body: { status: 'approved' } });
  check('читач не може модерувати', r.status === 403, r.status + ' ' + r.data.error);
  r = await call('PATCH', `/comments/${c1}`, { user: admin, body: { status: 'approved' } });
  check('адміністратор схвалює коментар', r.status === 200 && r.data.status === 'approved');
  r = await call('POST', `/posts/${postId}/comments`, { user: author, body: { text: 'Так, через items з bsonType object і required.', parent_id: c1 } });
  check('відповідь автора посту схвалюється автоматично', r.data.status === 'approved' && r.data.depth === 1, 'depth ' + r.data.depth);
  let parent = r.data.comment_id;
  for (let d = 2; d <= 5; d++) {
    r = await call('POST', `/posts/${postId}/comments`, { user: d % 2 ? author : admin, body: { text: 'Відповідь рівня ' + d, parent_id: parent } });
    parent = r.data.comment_id;
  }
  check('ланцюжок відповідей до глибини 5', r.data.depth === 5);
  r = await call('POST', `/posts/${postId}/comments`, { user: admin, body: { text: 'Рівень 6', parent_id: parent } });
  check('глибина 6 відхиляється', r.status === 400, r.data.error);
  r = await call('GET', '/notifications', { user: reader });
  check('читач отримав «схвалено» і «відповідь»', ['comment_approved', 'comment_reply'].every(t => r.data.items.some(n => n.type === t && n.post_id === postId)),
        r.data.items.slice(0, 2).map(n => n.type).join(', '));
  r = await call('GET', '/posts/' + slug);
  const depth = t => t.reduce((m, n) => Math.max(m, n.depth, depth(n.replies)), 0);
  check('дерево коментарів (рекурсивне) має глибину 5', depth(r.data.comment_tree) === 5, 'comments_count ' + r.data.statistics.comments_count);
  r = await call('PATCH', '/notifications/read', { user: author, body: {} });
  check('PATCH /notifications/read', r.status === 200, 'позначено ' + r.data.marked);
  r = await call('POST', `/posts/${postId}/comments`, { user: blocked, body: { text: 'Коментар заблокованого' } });
  check('заблокований користувач не може коментувати', r.status === 403, r.data.error);

  h('Версіонування');
  r = await call('PUT', `/posts/${postId}`, { user: other, body: { title: 'Чужа правка' } });
  check('інший автор не може редагувати', r.status === 403, r.data.error);
  r = await call('PUT', `/posts/${postId}`, { user: author, body: { title: 'Валідація схеми в MongoDB: практичний посібник', expected_version: 1, change_note: 'Нова назва' } });
  check('редагування v1 -> v2', r.data.version === 2 && r.data.changed.includes('title'), JSON.stringify(r.data));
  r = await call('PUT', `/posts/${postId}`, { user: admin, body: { tags: ['mongodb', 'nosql'], expected_version: 2 } });
  check('редагування адміністратором v2 -> v3', r.data.version === 3, JSON.stringify(r.data));
  r = await call('PUT', `/posts/${postId}`, { user: author, body: { title: 'Застаріла правка', expected_version: 2 } });
  check('конфлікт версій -> 409', r.status === 409, r.data.error);
  r = await call('GET', `/posts/${postId}/versions`);
  check('GET /versions', r.data.versions.length === 2 && r.data.current.version === 3, r.data.versions.map(v => 'v' + v.version + ':' + v.changed_fields).join(' '));
  r = await call('POST', `/posts/${postId}/versions/1/restore`, { user: author });
  check('відновлення v1 створює v4', r.data.version === 4, JSON.stringify(r.data));
  r = await call('GET', '/posts/' + slug);
  check('після відновлення назва з v1', r.data.title === 'Валідація схеми в MongoDB на практиці', r.data.title);
  r = await call('PUT', `/posts/${postId}`, { user: author, body: { title: 'Д'.repeat(250), expected_version: 4 } });
  check('назва 250 символів -> 400, версія не створюється', r.status === 400, r.status + ' ' + r.data.error);
  r = await call('PUT', `/posts/${postId}`, { user: author, body: { title: 'Валідація схеми в MongoDB: після помилки', expected_version: 4 } });
  check('після невдалої правки пост редагується далі (v4 -> v5)', r.status === 200 && r.data.version === 5, r.status + ' ' + JSON.stringify(r.data));

  h('Кеш: інвалідація після змін');
  await call('GET', '/stats/overview');
  r = await call('GET', '/stats/overview');
  check('статистика з кешу', r.cache === 'HIT');
  await call('DELETE', `/posts/${dupId}`, { user: author });
  r = await call('GET', '/stats/overview');
  check('після DELETE (архівування) кеш інвалідовано', r.cache === 'MISS');
  r = await call('GET', `/posts/${dupId}/versions`);
  check('архівований пост має нову версію', r.data.current.version === 2);

  h('Геопошук і аналітика');
  r = await call('GET', '/geo/near?lng=24.0297&lat=49.8397&km=150&limit=5');
  check('GET /geo/near (Львів, 150 км)', r.status === 200 && r.data.every(p => p.distance_km <= 150), r.data.map(p => p.location.place + ' ' + p.distance_km + 'км').join(', '));
  r = await call('GET', '/geo/near?lng=500&lat=1');
  check('некоректні координати -> 400', r.status === 400);
  for (const s of ['overview', 'top-authors', 'categories', 'tags', 'comments', 'views-daily?days=7', 'posts-by-month', 'top-posts', 'geo']) {
    r = await call('GET', '/stats/' + s);
    check('GET /stats/' + s, r.status === 200);
  }
  r = await call('GET', '/cache/stats');
  check('GET /cache/stats', r.status === 200, `hit_ratio ${r.data.hit_ratio}%, hit ${r.data.avg_hit_ms} мс, miss ${r.data.avg_miss_ms} мс`);

  h('Помилки');
  r = await call('GET', '/posts/neisnuiuchyi-post');
  check('неіснуючий пост -> 404', r.status === 404);
  r = await call('POST', `/posts/123/view`);
  check('некоректний ObjectId -> 400', r.status === 400, r.data.error);
  r = await call('GET', '/nema-takogo');
  check('невідомий маршрут -> 404', r.status === 404);

  // прибирання тестових даних
  const { MongoClient, ObjectId } = require('mongodb');
  const cl = await new MongoClient('mongodb://localhost:27017').connect();
  const db = cl.db(process.env.DB_NAME || 'blog_system');
  const ids = [new ObjectId(postId), new ObjectId(dupId)];
  await Promise.all([db.collection('posts').deleteMany({ _id: { $in: ids } }), db.collection('post_versions').deleteMany({ post_id: { $in: ids } }),
    db.collection('reactions').deleteMany({ post_id: { $in: ids } }), db.collection('post_views').deleteMany({ post_id: { $in: ids } }),
    db.collection('notifications').deleteMany({ post_id: { $in: ids } })]);
  await require('../lib/blog').makeBlog(db).recalcStats();     // лічильники users/categories після видалення
  await cl.close();
  await call('DELETE', '/cache');

  console.log(`\nПідсумок: ${passed} перевірок пройдено, ${failed} не пройдено (тестові пости видалено)`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
