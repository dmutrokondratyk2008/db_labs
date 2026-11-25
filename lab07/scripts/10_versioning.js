// =====================================================================
// Лабораторна робота 7. 10_versioning.js
// Рівень 3, завдання 1. Версіонування постів зі збереженням історії
// редагувань (колекція post_versions) і оптимістичним блокуванням.
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/blog.js');
db = db.getSiblingDB('blog_system');

const slug = 'node-js-i-express-pershyi-api-za-hodynu';
let post = db.posts.findOne({ slug });
const author = db.users.findOne({ _id: post.author.user_id });
const admin = db.users.findOne({ username: 'olena.kovalenko' });

// повторний запуск: повертаємо пост до першої версії й очищаємо історію
const v1 = db.post_versions.findOne({ post_id: post._id, version: 1 });
if (v1) {
  db.posts.updateOne({ _id: post._id }, { $set: Object.assign({}, v1.snapshot, { version: 1 }) });
  db.post_versions.deleteMany({ post_id: post._id });
  post = db.posts.findOne({ slug });
}

const cur = () => db.posts.findOne({ _id: post._id }, { title: 1, tags: 1, version: 1, content: 1, updated_at: 1 });
const brief = p => ({ version: p.version, title: p.title, tags: p.tags, content_len: p.content.length });

h('1. Початковий стан');
print('  ' + fmt(brief(cur())));

h('2. Три редагування (перед кожним знімок попередньої версії -> post_versions)');
q('редагування 1: уточнення назви (автор)');
print('  ' + fmt(editPost(post._id, { title: 'Node.js і Express: перший REST API за годину' }, author, 'Уточнено назву')));
q('редагування 2: доповнення тексту і новий тег (автор)');
const c = cur();
print('  ' + fmt(editPost(post._id, {
  content: c.content + '\n\nДоповнення: для валідації вхідних даних у маршрутах Express зручно використовувати схеми, а помилки повертати у єдиному форматі JSON з HTTP-кодом 400.',
  tags: c.tags.concat(['patterns']) }, author, 'Додано розділ про валідацію', c.version)));
q('редагування 3: виправлення помилки в назві (адміністратор)');
print('  ' + fmt(editPost(post._id, { title: 'Node.js та Express: перший REST API за годину' }, admin, 'Редакторська правка', cur().version)));
q('повторне збереження без змін - нова версія не створюється');
print('  ' + fmt(editPost(post._id, { title: cur().title }, author, 'Без змін')));
print('  поточний стан: ' + fmt(brief(cur())));

h('3. Історія редагувань');
table(db.post_versions.aggregate([
  { $match: { post_id: post._id } }, { $sort: { version: 1 } },
  { $project: { _id: 0, version: 1, title: '$snapshot.title', content_len: { $strLenCP: '$snapshot.content' },
                tags: { $size: '$snapshot.tags' }, changed: '$changed_fields', note: '$change_note',
                by: '$edited_by.username' } }
]).toArray(), ['version', 'title', 'content_len', 'tags', 'changed', 'note', 'by']);
print('  (у кожному рядку - стан ДО редагування; поточна версія v' + cur().version + ' зберігається в самому пості)');

h('4. Отримання конкретної версії');
const v2 = db.post_versions.findOne({ post_id: post._id, version: 2 }, { _id: 0, version: 1, 'snapshot.title': 1, 'snapshot.tags': 1, edited_at: 1 });
print('  ' + fmt(v2));

h('5. Оптимістичне блокування: два редактори відкрили версію одночасно');
const opened = cur().version;
print('  обидва редактори відкрили v' + opened);
print('  редактор А зберіг: ' + fmt(editPost(post._id, { tags: cur().tags.filter(t => t !== 'patterns') }, author, 'Прибрано зайвий тег', opened)));
try {
  editPost(post._id, { title: 'Інша назва від редактора Б' }, admin, 'Спроба Б', opened);
} catch (e) { print('  редактор Б: ' + e.message); }

h('6. Відновлення першої версії (теж створює нову версію - історія не втрачається)');
print('  ' + fmt(restoreVersion(post._id, 1, admin)));
print('  поточний стан: ' + fmt(brief(cur())));
table(db.post_versions.find({ post_id: post._id }, { _id: 0, version: 1, note: '$change_note', by: '$edited_by.username', edited_at: 1 })
  .sort({ version: 1 }).toArray(), ['version', 'note', 'by', 'edited_at']);

h('7. Зміни між версіями 1 і поточною (порівняння полів)');
const first = db.post_versions.findOne({ post_id: post._id, version: 1 }).snapshot;
const now = db.posts.findOne({ _id: post._id });
['title', 'excerpt', 'tags', 'status'].forEach(f => print('  ' + f.padEnd(8) + (JSON.stringify(first[f]) === JSON.stringify(now[f]) ? 'однакові' : 'різні')));
print('  ' + 'content'.padEnd(8) + (first.content === now.content ? 'однакові' : 'різні') + ' (' + first.content.length + ' / ' + now.content.length + ' символів)');
