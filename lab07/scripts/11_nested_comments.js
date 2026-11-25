// =====================================================================
// Лабораторна робота 7. 11_nested_comments.js
// Рівень 3, завдання 2. Вкладені коментарі (відповіді на відповіді).
// Модель «дерево з посиланням на батька» (Parent References):
// коментарі вбудовані в пост одним масивом, кожен має parent_id і depth.
// Дерево будується рекурсивно; на рівні СУБД нащадків знаходить
// $graphLookup через представлення comments_flat.
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/blog.js');
db = db.getSiblingDB('blog_system');

const post = db.posts.findOne({ slug: 'mikroservisy-chy-modulnyi-monolit' });
const author = db.users.findOne({ _id: post.author.user_id });
const admin = db.users.findOne({ username: 'olena.kovalenko' });
const u = n => db.users.findOne({ username: n });
const [anna, maksym, iryna] = ['anna.sydorenko', 'maksym.polishchuk', 'iryna.kuzmenko'].map(u);

// повторний запуск: видаляємо гілку, створену попереднім запуском
const MARK = 'Чи варто команді з трьох розробників одразу починати з мікросервісів?';
const old = post.comments.find(c => c.text === MARK);
if (old) {
  const ids = [];
  (function collect(id) { ids.push(id); post.comments.filter(c => c.parent_id && c.parent_id.equals(id)).forEach(c => collect(c.comment_id)); })(old.comment_id);
  db.posts.updateOne({ _id: post._id }, { $pull: { comments: { comment_id: { $in: ids } } } });
  db.notifications.deleteMany({ comment_id: { $in: ids } });
  db.posts.updateOne({ _id: post._id }, [{ $set: { 'statistics.comments_count': { $size: { $filter: {
    input: '$comments', as: 'c', cond: { $eq: ['$$c.status', 'approved'] } } } } } }]);
}

h('1. Гілка обговорення під постом «' + post.title + '» (автор ' + author.username + ')');
const c0 = addComment(post._id, anna, MARK);
moderateComment(c0.comment_id, 'approved', admin);
const c1 = addComment(post._id, author, 'Для невеликої команди я б радив модульний моноліт із чіткими межами модулів.', c0.comment_id);
const c2 = addComment(post._id, maksym, 'А як тоді масштабувати окремі частини, якщо навантаження нерівномірне?', c1.comment_id);
moderateComment(c2.comment_id, 'approved', admin);
const c3 = addComment(post._id, author, 'Найнавантаженіший модуль можна винести в окремий сервіс пізніше - межі вже будуть готові.', c2.comment_id);
const c4 = addComment(post._id, iryna, 'Ми саме так і зробили з модулем звітів.', c3.comment_id);
moderateComment(c4.comment_id, 'approved', admin);
const c5 = addComment(post._id, anna, 'Дякую всім, дуже допомогло!', c4.comment_id);
moderateComment(c5.comment_id, 'approved', admin);
const c1b = addComment(post._id, iryna, 'Підтримую, мікросервіси додають багато операційних витрат.', c0.comment_id);
moderateComment(c1b.comment_id, 'approved', admin);
[c0, c1, c2, c3, c4, c5, c1b].forEach(c => print('  depth ' + c.depth + ': ' + c.author.username + ' -> ' + c.text.slice(0, 60)));

q('відповідь на коментар глибини 5 відхиляється (максимальна вкладеність 5)');
try { addComment(post._id, maksym, 'Ще глибше?', c5.comment_id); } catch (e) { print('  ' + e.message); }

h('2. Дерево коментарів (рекурсивна побудова, лише схвалені)');
const fresh = db.posts.findOne({ _id: post._id });
const tree = commentTree(fresh.comments, null, true);
printTree(tree);
const countNodes = ns => ns.reduce((s, n) => s + 1 + countNodes(n.replies), 0);
const maxDepth = ns => ns.reduce((m, n) => Math.max(m, n.depth, maxDepth(n.replies)), 0);
print('  вузлів у дереві: ' + countNodes(tree) + ', гілок першого рівня: ' + tree.length + ', максимальна глибина: ' + maxDepth(tree));

h('3. Рекурсивний пошук нащадків на рівні СУБД: $graphLookup');
if (!db.getCollectionNames().includes('comments_flat')) {
  // представлення: кожен коментар окремим документом з _id = comment_id
  db.createView('comments_flat', 'posts', [
    { $unwind: '$comments' },
    { $replaceWith: { $mergeObjects: ['$comments', { _id: '$comments.comment_id', post_id: '$_id', post_title: '$title' }] } }
  ]);
  print('  створено представлення comments_flat');
}
table(db.posts.aggregate([
  { $match: { _id: post._id } },
  { $unwind: '$comments' },
  { $match: { 'comments.depth': 0, 'comments.status': 'approved' } },
  { $graphLookup: { from: 'comments_flat', startWith: '$comments.comment_id', connectFromField: 'comment_id',
                    connectToField: 'parent_id', as: 'descendants', depthField: 'level',
                    restrictSearchWithMatch: { post_id: post._id, status: 'approved' } } },
  { $project: { _id: 0, author: '$comments.author.username', text: { $substrCP: ['$comments.text', 0, 45] },
                replies_total: { $size: '$descendants' },
                max_level: { $add: [{ $ifNull: [{ $max: '$descendants.level' }, -1] }, 1] },
                participants: { $size: { $setUnion: ['$descendants.author.username', []] } } } },
  { $sort: { replies_total: -1 } }
]).toArray(), ['author', 'text', 'replies_total', 'max_level', 'participants']);

q('шлях від найглибшої відповіді до кореня ($graphLookup у зворотному напрямку)');
const path = db.comments_flat.aggregate([
  { $match: { _id: c5.comment_id } },
  { $graphLookup: { from: 'comments_flat', startWith: '$parent_id', connectFromField: 'parent_id', connectToField: 'comment_id',
                    as: 'ancestors', depthField: 'up', restrictSearchWithMatch: { post_id: post._id } } },
  { $project: { _id: 0, chain: { $sortArray: { input: '$ancestors', sortBy: { up: -1 } } }, author: 1, text: 1 } }
]).toArray()[0];
path.chain.concat([path]).forEach((c, i) => print('  ' + '   '.repeat(i) + (i ? '└─ ' : '') + c.author.username + ': ' + c.text.slice(0, 50)));

h('4. Статистика вкладеності по всьому блогу');
table(db.comments_flat.aggregate([
  { $match: { status: 'approved' } },
  { $group: { _id: '$depth', n: { $sum: 1 } } }, { $sort: { _id: 1 } },
  { $project: { _id: 0, depth: '$_id', comments: '$n' } }
]).toArray(), ['depth', 'comments']);
