// =====================================================================
// Лабораторна робота 7. lib/blog.js
// Операції блог-системи для скриптів mongosh: перерахунок статистики,
// реакції, перегляди, коментарі та модерація, версіонування, пагінація.
// Серверна частина (blog-app/lib/blog.js) реалізує ту саму логіку
// асинхронно через Node.js-драйвер.
// =====================================================================

// Повний вивід документа (на відміну від компактного printjson з common.js)
globalThis.printjsonFull = function (x) {
  print(EJSON.stringify(x, { relaxed: true }, 2)
    .replace(/\{\s*"\$oid":\s*"([0-9a-f]{24})"\s*\}/g, 'ObjectId("$1")')
    .replace(/\{\s*"\$date":\s*"([^"]+)"\s*\}/g, 'ISODate("$1")'));
};

const APPROVED_COUNT = { $size: { $filter: { input: '$comments', as: 'c', cond: { $eq: ['$$c.status', 'approved'] } } } };

// ---------------------------------------------------------------------
// Патерн Computed: денормалізовані лічильники перераховуються з первинних
// даних (reactions, post_views, comments) і записуються стадією $merge
// ---------------------------------------------------------------------
globalThis.recalcPostStats = function (filter) {
  db.posts.aggregate([
    { $match: filter || {} },
    { $lookup: { from: 'reactions', localField: '_id', foreignField: 'post_id', as: 'r', pipeline: [
      { $group: { _id: null, likes: { $sum: { $cond: [{ $eq: ['$value', 1] }, 1, 0] } },
                  dislikes: { $sum: { $cond: [{ $eq: ['$value', -1] }, 1, 0] } } } }] } },
    { $lookup: { from: 'post_views', localField: '_id', foreignField: 'post_id', as: 'v', pipeline: [
      { $group: { _id: null, total: { $sum: '$total' } } }] } },
    { $set: { likes: { $ifNull: [{ $first: '$r.likes' }, 0] }, dislikes: { $ifNull: [{ $first: '$r.dislikes' }, 0] } } },
    { $project: { statistics: {
      views: { $ifNull: [{ $first: '$v.total' }, 0] }, likes: '$likes', dislikes: '$dislikes',
      rating: { $subtract: ['$likes', '$dislikes'] }, comments_count: APPROVED_COUNT } } },
    { $merge: { into: 'posts', on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } }
  ]);
};

globalThis.recalcUserStats = function () {
  db.users.aggregate([
    { $lookup: { from: 'posts', localField: '_id', foreignField: 'author.user_id', as: 'p', pipeline: [
      { $match: { status: 'published' } },
      { $group: { _id: null, n: { $sum: 1 }, likes: { $sum: '$statistics.likes' } } }] } },
    { $lookup: { from: 'posts', localField: '_id', foreignField: 'comments.author.user_id', as: 'c', let: { uid: '$_id' }, pipeline: [
      { $project: { n: { $size: { $filter: { input: '$comments', as: 'x', cond: { $and: [
        { $eq: ['$$x.author.user_id', '$$uid'] }, { $eq: ['$$x.status', 'approved'] }] } } } } } },
      { $group: { _id: null, n: { $sum: '$n' } } }] } },
    { $project: { statistics: {
      posts_count: { $ifNull: [{ $first: '$p.n' }, 0] },
      comments_count: { $ifNull: [{ $first: '$c.n' }, 0] },
      likes_received: { $ifNull: [{ $first: '$p.likes' }, 0] } } } },
    { $merge: { into: 'users', on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } }
  ]);
};

globalThis.recalcCategoryStats = function () {
  db.categories.aggregate([
    { $match: { type: 'category' } },
    { $lookup: { from: 'posts', localField: '_id', foreignField: 'category.category_id', as: 'p', pipeline: [
      { $match: { status: 'published' } }, { $count: 'n' }] } },
    { $project: { statistics: { posts_count: { $ifNull: [{ $first: '$p.n' }, 0] } } } },
    { $merge: { into: 'categories', on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } }
  ]);
  db.categories.aggregate([
    { $match: { type: 'tag' } },
    { $lookup: { from: 'posts', localField: 'slug', foreignField: 'tags', as: 'p', pipeline: [
      { $match: { status: 'published' } }, { $count: 'n' }] } },
    { $project: { statistics: { posts_count: { $ifNull: [{ $first: '$p.n' }, 0] } } } },
    { $merge: { into: 'categories', on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } }
  ]);
};

// ---------------------------------------------------------------------
// Пагінація через агрегаційний pipeline ($facet: сторінка + загальна кількість)
// ---------------------------------------------------------------------
globalThis.paginate = function (filter, page, perPage, sort) {
  page = Math.max(1, page || 1); perPage = Math.min(50, perPage || 10);
  const r = db.posts.aggregate([
    { $match: Object.assign({ status: 'published' }, filter || {}) },
    { $sort: sort || { published_at: -1, _id: -1 } },
    { $facet: {
      items: [{ $skip: (page - 1) * perPage }, { $limit: perPage },
              { $project: { title: 1, 'author.username': 1, 'category.name': 1, published_at: 1, 'statistics.views': 1 } }],
      total: [{ $count: 'count' }] } },
    { $project: { items: 1, total: { $ifNull: [{ $first: '$total.count' }, 0] } } },
    { $set: { page: page, per_page: perPage, pages: { $ceil: { $divide: ['$total', perPage] } } } }
  ]).toArray()[0];
  return r;
};

// ---------------------------------------------------------------------
// Реакції: лайк / дизлайк / скасування (повторне натискання тієї ж кнопки)
// ---------------------------------------------------------------------
globalThis.react = function (postId, userId, value) {
  if (value !== 1 && value !== -1) throw new Error('value має бути 1 або -1');
  const prev = db.reactions.findOne({ post_id: postId, user_id: userId });
  let dl = 0, dd = 0, action;
  const now = new Date();
  if (!prev) {
    db.reactions.insertOne({ post_id: postId, user_id: userId, value, created_at: now });
    value === 1 ? dl++ : dd++; action = 'added';
  } else if (prev.value === value) {
    db.reactions.deleteOne({ _id: prev._id });
    value === 1 ? dl-- : dd--; action = 'removed';
  } else {
    db.reactions.updateOne({ _id: prev._id }, { $set: { value, updated_at: now } });
    if (value === 1) { dl++; dd--; } else { dl--; dd++; } action = 'switched';
  }
  // оновлення конвеєром: лічильники і рейтинг змінюються атомарно в одному документі
  const post = db.posts.findOneAndUpdate({ _id: postId }, [
    { $set: { 'statistics.likes': { $add: ['$statistics.likes', dl] }, 'statistics.dislikes': { $add: ['$statistics.dislikes', dd] } } },
    { $set: { 'statistics.rating': { $subtract: ['$statistics.likes', '$statistics.dislikes'] } } }
  ], { returnDocument: 'after', projection: { statistics: 1 } });
  return { action, likes: post.statistics.likes, dislikes: post.statistics.dislikes, rating: post.statistics.rating };
};

// ---------------------------------------------------------------------
// Перегляд посту: інкремент лічильника в пості + у денному бакеті місяця
// ---------------------------------------------------------------------
globalThis.addView = function (postId, at) {
  at = at || new Date();
  const month = at.toISOString().slice(0, 7), day = at.toISOString().slice(8, 10);
  db.posts.updateOne({ _id: postId }, { $inc: { 'statistics.views': 1 } });
  db.post_views.updateOne({ post_id: postId, month }, { $inc: { ['daily.' + day]: 1, total: 1 } }, { upsert: true });
};

// ---------------------------------------------------------------------
// Сповіщення
// ---------------------------------------------------------------------
globalThis.notify = function (userId, type, post, comment, from, message) {
  if (from && userId.equals(from.user_id)) return null;          // себе не сповіщаємо
  return db.notifications.insertOne({ user_id: userId, type, post_id: post._id, post_title: post.title,
    comment_id: comment.comment_id, from: from ? { user_id: from.user_id, username: from.username } : undefined,
    message, read: false, read_at: null, created_at: new Date() }).insertedId;
};

// ---------------------------------------------------------------------
// Коментарі: новий коментар або відповідь (parentId). Коментарі адміністраторів
// і автора посту схвалюються одразу, решта потрапляють у чергу модерації.
// ---------------------------------------------------------------------
globalThis.addComment = function (postId, user, text, parentId) {
  const post = db.posts.findOne({ _id: postId }, { title: 1, author: 1, status: 1, comments: 1 });
  if (!post || post.status !== 'published') throw new Error('Пост не знайдено або не опубліковано');
  let parent = null;
  if (parentId) {
    parent = post.comments.find(c => c.comment_id.equals(parentId));
    if (!parent) throw new Error('Батьківський коментар не знайдено');
    if (parent.depth >= 5) throw new Error('Досягнуто максимальної глибини вкладеності (5)');
  }
  const autoApprove = user.role === 'admin' || user._id.equals(post.author.user_id);
  const now = new Date();
  const c = { comment_id: new ObjectId(), parent_id: parent ? parent.comment_id : null,
              depth: parent ? parent.depth + 1 : 0, author: { user_id: user._id, username: user.username },
              text, status: autoApprove ? 'approved' : 'pending', likes: 0, created_at: now };
  if (autoApprove) c.moderation = { by: user._id, at: now };
  db.posts.updateOne({ _id: postId }, { $push: { comments: c },
    $inc: { 'statistics.comments_count': autoApprove ? 1 : 0 }, $set: { updated_at: now } });
  const from = c.author;
  notify(post.author.user_id, 'new_comment', post, c, from,
    user.username + ' прокоментував(-ла) ваш пост «' + post.title + '»' + (autoApprove ? '' : ' (очікує модерації)'));
  if (parent && autoApprove && !parent.author.user_id.equals(post.author.user_id)) {
    notify(parent.author.user_id, 'comment_reply', post, c, from, user.username + ' відповів(-ла) на ваш коментар до «' + post.title + '»');
  }
  return c;
};

// ---------------------------------------------------------------------
// Модерація: зміна статусу коментаря (arrayFilters) і перерахунок comments_count
// ---------------------------------------------------------------------
globalThis.moderateComment = function (commentId, status, moderator, reason) {
  if (!['approved', 'rejected', 'pending'].includes(status)) throw new Error('Невідомий статус');
  const moderation = { by: moderator._id, at: new Date() };
  if (reason) moderation.reason = reason;
  const post = db.posts.findOneAndUpdate({ 'comments.comment_id': commentId },
    { $set: { 'comments.$[c].status': status, 'comments.$[c].moderation': moderation } },
    { arrayFilters: [{ 'c.comment_id': commentId }], returnDocument: 'after', projection: { title: 1, author: 1, comments: 1 } });
  if (!post) throw new Error('Коментар не знайдено');
  db.posts.updateOne({ _id: post._id }, [{ $set: { 'statistics.comments_count': APPROVED_COUNT } }]);
  const c = post.comments.find(x => x.comment_id.equals(commentId));
  if (status !== 'pending') {
    notify(c.author.user_id, status === 'approved' ? 'comment_approved' : 'comment_rejected', post, c,
      { user_id: moderator._id, username: moderator.username },
      'Ваш коментар до «' + post.title + '» ' + (status === 'approved' ? 'схвалено' : 'відхилено' + (reason ? ': ' + reason : '')));
    if (status === 'approved' && c.parent_id) {
      const parent = post.comments.find(x => x.comment_id.equals(c.parent_id));
      notify(parent.author.user_id, 'comment_reply', post, c, c.author, c.author.username + ' відповів(-ла) на ваш коментар до «' + post.title + '»');
    }
  }
  return c;
};

// Дерево коментарів (рекурсивна побудова зі списку з посиланнями на батька)
globalThis.commentTree = function (comments, parentId, onlyApproved) {
  return comments
    .filter(c => (parentId ? c.parent_id && c.parent_id.equals(parentId) : c.parent_id === null))
    .filter(c => !onlyApproved || c.status === 'approved')
    .sort((a, b) => a.created_at - b.created_at)
    .map(c => Object.assign({}, c, { replies: commentTree(comments, c.comment_id, onlyApproved) }));
};
globalThis.printTree = function (nodes, indent) {
  indent = indent || '  ';
  nodes.forEach(n => {
    print(indent + (n.depth ? '└─ ' : '• ') + n.author.username + ' [' + n.status + ', ' + fmt(n.created_at) + ']: ' + n.text);
    printTree(n.replies, indent + '   ');
  });
};

// ---------------------------------------------------------------------
// Версіонування: перед зміною знімок поточного стану зберігається в
// post_versions; оптимістичне блокування за полем version.
// ---------------------------------------------------------------------
const VERSIONED = ['title', 'content', 'excerpt', 'tags', 'category', 'status'];
globalThis.editPost = function (postId, changes, editor, note, expectedVersion) {
  const post = db.posts.findOne({ _id: postId });
  if (!post) throw new Error('Пост не знайдено');
  if (expectedVersion !== undefined && expectedVersion !== post.version) {
    throw new Error('Конфлікт версій: очікувалась v' + expectedVersion + ', поточна v' + post.version);
  }
  const changed = VERSIONED.filter(f => changes[f] !== undefined && JSON.stringify(changes[f]) !== JSON.stringify(post[f]));
  if (!changed.length) return { version: post.version, changed: [] };
  const snapshot = {};
  VERSIONED.forEach(f => { if (post[f] !== undefined) snapshot[f] = post[f]; });
  const vId = db.post_versions.insertOne({ post_id: postId, version: post.version, snapshot, changed_fields: changed,
    change_note: note || '', edited_by: { user_id: editor._id, username: editor.username }, edited_at: new Date() }).insertedId;
  const set = { updated_at: new Date() };
  changed.forEach(f => { set[f] = changes[f]; });
  if (changes.status === 'published' && !post.published_at) set.published_at = new Date();
  let r;
  try {
    r = db.posts.updateOne({ _id: postId, version: post.version }, { $set: set, $inc: { version: 1 } });
  } catch (e) {                                     // зміни не пройшли $jsonSchema: знімок не має лишитися в історії
    db.post_versions.deleteOne({ _id: vId });
    throw e;
  }
  if (r.matchedCount === 0) {                       // хтось змінив пост паралельно
    db.post_versions.deleteOne({ _id: vId });
    throw new Error('Конфлікт версій: пост змінено іншим користувачем');
  }
  return { version: post.version + 1, changed };
};

globalThis.restoreVersion = function (postId, version, editor) {
  const v = db.post_versions.findOne({ post_id: postId, version });
  if (!v) throw new Error('Версію ' + version + ' не знайдено');
  return editPost(postId, v.snapshot, editor, 'Відновлено версію ' + version);
};
