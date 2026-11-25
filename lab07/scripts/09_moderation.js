// =====================================================================
// Лабораторна робота 7. 09_moderation.js
// Рівень 2, завдання 6. Модерація коментарів зі статусами
// pending (очікує перевірки), approved (схвалено), rejected (відхилено).
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/blog.js');
db = db.getSiblingDB('blog_system');

const admin = db.users.findOne({ username: 'olena.kovalenko' });
const reader = db.users.findOne({ username: 'roman.zaitsev' });

const queue = () => db.posts.aggregate([
  { $match: { 'comments.status': 'pending' } },               // частковий індекс comments_pending_partial
  { $unwind: '$comments' },
  { $match: { 'comments.status': 'pending' } },
  { $sort: { 'comments.created_at': 1 } },
  { $project: { _id: 0, comment_id: '$comments.comment_id', post: '$title', author: '$comments.author.username',
                text: '$comments.text', created_at: '$comments.created_at', depth: '$comments.depth' } }
]).toArray();

h('1. Черга модерації (найстаріші першими)');
const q0 = queue();
print('  коментарів в очікуванні: ' + q0.length);
table(q0.slice(0, 8), ['created_at', 'author', 'post', 'text', 'depth']);

h('2. Новий коментар читача потрапляє в чергу, коментар адміністратора - одразу схвалено');
const post = db.posts.findOne({ slug: 'nosql-iniektsii-ta-yak-vid-nykh-zakhystytysia' });
const before = db.posts.findOne({ _id: post._id }).statistics.comments_count;
const c1 = addComment(post._id, reader, 'Чи достатньо використовувати лише валідацію схеми, щоб захиститися від операторних ін’єкцій?');
const c2 = addComment(post._id, admin, 'Нагадую: посилання на сторонні ресурси в коментарях проходять модерацію.');
print('  ' + reader.username + ' -> status: ' + c1.status);
print('  ' + admin.username + ' (admin) -> status: ' + c2.status);
print('  comments_count посту: ' + before + ' -> ' + db.posts.findOne({ _id: post._id }).statistics.comments_count + ' (рахуються лише схвалені)');

h('3. Модерація: схвалити, відхилити з причиною');
const q1 = queue();
const toApprove = q1.filter(c => c.comment_id.equals(c1.comment_id)).concat(q1.filter(c => !c.comment_id.equals(c1.comment_id)).slice(0, 2));
toApprove.forEach(c => {
  moderateComment(c.comment_id, 'approved', admin);
  print('  схвалено:  ' + c.author + ': "' + c.text + '"');
});
const spamPost = db.posts.findOne({ slug: 'react-server-components-prostymy-slovamy' });
const spam = addComment(spamPost._id, reader, 'Найкращі курси програмування зі знижкою 90%, переходьте за посиланням у профілі!');
moderateComment(spam.comment_id, 'rejected', admin, 'Реклама');
print('  відхилено: ' + reader.username + ': "' + spam.text + '" (причина: Реклама)');
print('  comments_count посту «' + post.title + '»: ' + db.posts.findOne({ _id: post._id }).statistics.comments_count);

q('оновлений коментар у документі посту (позиційний оператор $[c] з arrayFilters)');
const upd = db.posts.findOne({ 'comments.comment_id': c1.comment_id }, { _id: 0, comments: { $elemMatch: { comment_id: c1.comment_id } } });
printjsonFull(upd.comments[0]);

h('4. Публічний вигляд: показуються лише схвалені коментарі ($filter)');
const pv = db.posts.aggregate([
  { $match: { _id: post._id } },
  { $project: { _id: 0, title: 1, all: { $size: '$comments' },
      visible: { $filter: { input: '$comments', as: 'c', cond: { $eq: ['$$c.status', 'approved'] } } } } },
  { $project: { title: 1, all: 1, visible: { $size: '$visible' } } }
]).toArray()[0];
print('  ' + fmt(pv));

h('5. Статистика модерації');
q('за статусами');
table(db.posts.aggregate([{ $unwind: '$comments' }, { $group: { _id: '$comments.status', n: { $sum: 1 } } },
  { $sort: { n: -1 } }, { $project: { _id: 0, status: '$_id', n: 1 } }]).toArray(), ['status', 'n']);
q('за модераторами (автоматичне схвалення коментарів автора посту й адміністраторів - окремим рядком)');
table(db.posts.aggregate([
  { $unwind: '$comments' }, { $match: { 'comments.moderation.by': { $exists: true }, 'comments.status': { $ne: 'pending' } } },
  { $set: { auto: { $eq: ['$comments.moderation.by', '$comments.author.user_id'] } } },
  { $group: { _id: { by: { $cond: ['$auto', null, '$comments.moderation.by'] }, status: '$comments.status' }, n: { $sum: 1 },
              avg_min: { $avg: { $dateDiff: { startDate: '$comments.created_at', endDate: '$comments.moderation.at', unit: 'minute' } } } } },
  { $lookup: { from: 'users', localField: '_id.by', foreignField: '_id', as: 'u' } },
  { $project: { _id: 0, moderator: { $ifNull: [{ $first: '$u.username' }, '(автоматично)'] }, status: '$_id.status', n: 1,
                avg_reaction_h: { $round: [{ $divide: ['$avg_min', 60] }, 1] } } },
  { $sort: { moderator: 1, status: 1 } }
]).toArray(), ['moderator', 'status', 'n', 'avg_reaction_h']);

q('сповіщення, створені модерацією (останні 4)');
table(db.notifications.find({ type: { $in: ['comment_approved', 'comment_rejected', 'new_comment'] } },
  { _id: 0, type: 1, message: 1, read: 1 }).sort({ created_at: -1 }).limit(4).toArray(), ['type', 'read', 'message']);
