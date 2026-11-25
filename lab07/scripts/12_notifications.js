// =====================================================================
// Лабораторна робота 7. 12_notifications.js
// Рівень 3, завдання 3. Сповіщення авторів про нові коментарі під їхніми
// постами (а також про відповіді й результати модерації).
// Сповіщення створює прикладний рівень у момент додавання коментаря
// (addComment / moderateComment), бо Change Streams на окремому сервері
// без набору реплік недоступні (перевірка в кінці скрипта).
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/blog.js');
db = db.getSiblingDB('blog_system');

const post = db.posts.findOne({ slug: 'indeksy-v-postgresql-b-tree-gin-i-brin' });
const author = db.users.findOne({ _id: post.author.user_id });
const admin = db.users.findOne({ username: 'olena.kovalenko' });
const reader = db.users.findOne({ username: 'sofiia.levchenko' });
const unread = id => db.notifications.countDocuments({ user_id: id, read: false });

h('1. Непрочитані сповіщення за користувачами');
table(db.notifications.aggregate([
  { $match: { read: false } },
  { $group: { _id: '$user_id', unread: { $sum: 1 }, types: { $addToSet: '$type' }, latest: { $max: '$created_at' } } },
  { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
  { $project: { _id: 0, username: { $first: '$u.username' }, role: { $first: '$u.role' }, unread: 1, types: 1, latest: 1 } },
  { $sort: { unread: -1, username: 1 } }, { $limit: 10 }
]).toArray(), ['username', 'role', 'unread', 'types', 'latest']);

h('2. Новий коментар під постом «' + post.title + '» (автор ' + author.username + ')');
print('  непрочитаних у автора до: ' + unread(author._id));
const c = addComment(post._id, reader, 'Дякую! А BRIN-індекс має сенс для таблиці журналу подій, що постійно росте?');
print('  ' + reader.username + ' залишила коментар (status: ' + c.status + ')');
print('  непрочитаних у автора після: ' + unread(author._id));
q('останнє сповіщення автора');
printjson(db.notifications.find({ user_id: author._id }, { _id: 0, type: 1, message: 1, read: 1, created_at: 1 }).sort({ created_at: -1 }).limit(1).toArray()[0]);

h('3. Модерація і відповідь автора -> сповіщення читачці');
print('  непрочитаних у ' + reader.username + ' до: ' + unread(reader._id));
moderateComment(c.comment_id, 'approved', admin);
addComment(post._id, author, 'Так, BRIN добре підходить, якщо дані вставляються в порядку зростання часу.', c.comment_id);
print('  непрочитаних у ' + reader.username + ' після: ' + unread(reader._id));
table(db.notifications.find({ user_id: reader._id }, { _id: 0, type: 1, message: 1, created_at: 1 }).sort({ created_at: -1 }).limit(2).toArray(),
      ['type', 'message']);

q('автор не отримує сповіщення про власну відповідь');
print('  сповіщень автору від самого себе: ' + db.notifications.countDocuments({ user_id: author._id, 'from.user_id': author._id }));

h('4. Стрічка сповіщень автора (останні 5) і позначення прочитаними');
table(db.notifications.find({ user_id: author._id }, { _id: 0, type: 1, from: '$from.username', post_title: 1, read: 1, created_at: 1 })
  .sort({ created_at: -1 }).limit(5).toArray(), ['created_at', 'type', 'from', 'post_title', 'read']);
q('db.notifications.updateMany({ user_id, read: false }, { $set: { read: true, read_at: new Date() } })');
res(db.notifications.updateMany({ user_id: author._id, read: false }, { $set: { read: true, read_at: new Date() } }));
print('  непрочитаних у автора: ' + unread(author._id));
q('план запиту стрічки (індекс user_id_1_read_1_created_at_-1)');
print('  ' + fmt(planSummary(db.notifications.find({ user_id: author._id, read: false }).sort({ created_at: -1 }).explain('executionStats'))));

h('5. Автоматичне очищення: TTL-індекс на read_at (30 днів, лише прочитані)');
const ttl = db.notifications.getIndexes().find(i => i.expireAfterSeconds !== undefined);
print('  ' + fmt({ name: ttl.name, key: ttl.key, expireAfterSeconds: ttl.expireAfterSeconds, partialFilterExpression: ttl.partialFilterExpression }));
table(db.notifications.aggregate([
  { $group: { _id: { type: '$type', read: '$read' }, n: { $sum: 1 } } }, { $sort: { '_id.type': 1, '_id.read': 1 } },
  { $project: { _id: 0, type: '$_id.type', read: '$_id.read', n: 1 } }
]).toArray(), ['type', 'read', 'n']);

h('6. Чому не Change Streams');
try {
  db.posts.watch([{ $match: { operationType: 'update' } }]).tryNext();
  print('  change stream відкрито');
} catch (e) {
  print('  db.posts.watch(): ' + cn(e) + ' - ' + e.message.split('\n')[0]);
  print('  на одиночному сервері change streams недоступні, тому сповіщення створюються в addComment()/moderateComment()');
}
