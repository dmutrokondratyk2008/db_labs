// =====================================================================
// Лабораторна робота 7. 07_ratings_views.js
// Рівень 2, завдання 3 і 5. Рейтинги (лайки/дизлайки) і статистика
// переглядів з інкрементацією лічильників.
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/blog.js');
db = db.getSiblingDB('blog_system');

const post = db.posts.findOne({ slug: 'docker-dlia-rozrobnyka-vid-dockerfile-do-compose' });
const anna = db.users.findOne({ username: 'anna.sydorenko' });
const oleh = db.users.findOne({ username: 'oleh.marchuk' });

// повторний запуск скрипта: прибираємо реакції цих двох користувачів і перераховуємо лічильники
db.reactions.deleteMany({ post_id: post._id, user_id: { $in: [anna._id, oleh._id] } });
recalcPostStats({ _id: post._id });

// ---------------------------------------------------------------------
h('1. Лайки і дизлайки: «' + post.title + '»');
// ---------------------------------------------------------------------
const st = () => db.posts.findOne({ _id: post._id }).statistics;
print('  початковий стан: ' + fmt(st()));
q('anna.sydorenko ставить лайк');                   print('  ' + fmt(react(post._id, anna._id, 1)));
q('oleh.marchuk ставить дизлайк');                  print('  ' + fmt(react(post._id, oleh._id, -1)));
q('oleh.marchuk змінює дизлайк на лайк');           print('  ' + fmt(react(post._id, oleh._id, 1)));
q('anna.sydorenko натискає лайк повторно (скасування)'); print('  ' + fmt(react(post._id, anna._id, 1)));
q('anna.sydorenko ставить лайк знову');              print('  ' + fmt(react(post._id, anna._id, 1)));

q('спроба вставити другу реакцію того самого користувача напряму');
try {
  db.reactions.insertOne({ post_id: post._id, user_id: anna._id, value: -1, created_at: new Date() });
} catch (e) { print('  відхилено: ' + cn(e) + ' (унікальний індекс post_id_1_user_id_1)'); }

q('реакції на пост у колекції reactions');
table(db.reactions.aggregate([
  { $match: { post_id: post._id } },
  { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'u' } },
  { $project: { _id: 0, username: { $first: '$u.username' }, value: 1, created_at: 1 } },
  { $sort: { created_at: -1 } }, { $limit: 6 }
]).toArray(), ['username', 'value', 'created_at']);

q('перевірка узгодженості: лічильники в posts дорівнюють підрахунку в reactions для всіх постів');
const mismatch = db.posts.aggregate([
  { $lookup: { from: 'reactions', localField: '_id', foreignField: 'post_id', as: 'r' } },
  { $project: { title: 1, likes: '$statistics.likes', dislikes: '$statistics.dislikes',
      real_likes: { $size: { $filter: { input: '$r', as: 'x', cond: { $eq: ['$$x.value', 1] } } } },
      real_dislikes: { $size: { $filter: { input: '$r', as: 'x', cond: { $eq: ['$$x.value', -1] } } } } } },
  { $match: { $expr: { $or: [{ $ne: ['$likes', '$real_likes'] }, { $ne: ['$dislikes', '$real_dislikes'] }] } } }
]).toArray();
print('  постів із розбіжностями: ' + mismatch.length);

// ---------------------------------------------------------------------
h('2. Рейтинг постів');
// ---------------------------------------------------------------------
// Оцінка Вільсона (нижня межа 95% довірчого інтервалу частки лайків)
// не дає посту з 1 лайком обігнати пост із 20 лайками і 1 дизлайком
table(db.posts.aggregate([
  { $match: { status: 'published' } },
  { $set: { n: { $add: ['$statistics.likes', '$statistics.dislikes'] } } },
  { $match: { n: { $gte: 3 } } },
  { $set: { p: { $divide: ['$statistics.likes', '$n'] }, z: 1.96 } },
  { $set: { wilson: { $divide: [
      { $subtract: [
        { $add: ['$p', { $divide: [{ $multiply: ['$z', '$z'] }, { $multiply: [2, '$n'] }] }] },
        { $multiply: ['$z', { $sqrt: { $divide: [
          { $add: [{ $multiply: ['$p', { $subtract: [1, '$p'] }] }, { $divide: [{ $multiply: ['$z', '$z'] }, { $multiply: [4, '$n'] }] }] },
          '$n'] } }] }] },
      { $add: [1, { $divide: [{ $multiply: ['$z', '$z'] }, '$n'] }] }] } } },
  { $sort: { wilson: -1 } }, { $limit: 8 },
  { $project: { _id: 0, title: 1, likes: '$statistics.likes', dislikes: '$statistics.dislikes',
                rating: '$statistics.rating', like_pct: { $round: [{ $multiply: ['$p', 100] }, 0] },
                wilson: { $round: ['$wilson', 3] } } }
]).toArray(), ['title', 'likes', 'dislikes', 'rating', 'like_pct', 'wilson']);

// ---------------------------------------------------------------------
h('3. Перегляди з інкрементацією лічильників');
// ---------------------------------------------------------------------
const today = new Date();
const month = today.toISOString().slice(0, 7), day = today.toISOString().slice(8, 10);
const bucket = () => db.post_views.findOne({ post_id: post._id, month });
print('  до: statistics.views = ' + st().views + ', бакет ' + month + ': total = ' +
      (bucket() ? bucket().total : 0) + ', daily.' + day + ' = ' + ((bucket() && bucket().daily[day]) || 0));
q('5 переглядів: $inc statistics.views у posts і $inc daily.' + day + ' + total у post_views (upsert)');
for (let i = 0; i < 5; i++) addView(post._id, today);
const b = bucket();
print('  після: statistics.views = ' + st().views + ', бакет ' + month + ': total = ' + b.total + ', daily.' + day + ' = ' + b.daily[day]);
q('документ-бакет post_views (останні дні місяця)');
const days = Object.keys(b.daily).sort().slice(-6);
print('  ' + fmt({ post_id: b.post_id, month: b.month, daily: Object.fromEntries(days.map(d => [d, b.daily[d]])), total: b.total }));

q('перегляди всього блогу за останні 10 днів (розгортання бакетів $objectToArray)');
const since = new Date(Date.now() - 9 * 24 * 3600 * 1000);   // 10 днів разом із сьогоднішнім
table(db.post_views.aggregate([
  { $match: { month: { $gte: since.toISOString().slice(0, 7) } } },
  { $project: { month: 1, d: { $objectToArray: '$daily' } } },
  { $unwind: '$d' },
  { $set: { date: { $dateFromString: { dateString: { $concat: ['$month', '-', '$d.k'] } } } } },
  { $match: { date: { $gte: new Date(since.toISOString().slice(0, 10)) } } },
  { $group: { _id: '$date', views: { $sum: '$d.v' }, posts: { $sum: 1 } } },
  { $sort: { _id: 1 } },
  { $project: { _id: 0, date: '$_id', views: 1, posts: 1 } }
]).toArray(), ['date', 'views', 'posts']);

q('найпопулярніші пости за останні 7 днів');
const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);
table(db.post_views.aggregate([
  { $match: { month: { $gte: since7.toISOString().slice(0, 7) } } },
  { $project: { post_id: 1, month: 1, d: { $objectToArray: '$daily' } } },
  { $unwind: '$d' },
  { $match: { $expr: { $gte: [{ $concat: ['$month', '-', '$d.k'] }, since7.toISOString().slice(0, 10)] } } },
  { $group: { _id: '$post_id', views_7d: { $sum: '$d.v' } } },
  { $sort: { views_7d: -1 } }, { $limit: 5 },
  { $lookup: { from: 'posts', localField: '_id', foreignField: '_id', as: 'p' } },
  { $project: { _id: 0, title: { $first: '$p.title' }, views_7d: 1, views_total: { $first: '$p.statistics.views' } } }
]).toArray(), ['title', 'views_7d', 'views_total']);
