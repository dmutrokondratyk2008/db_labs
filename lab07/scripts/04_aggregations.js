// =====================================================================
// Лабораторна робота 7. 04_aggregations.js
// Рівень 1, крок 5. Агрегаційні запити для статистики блогу.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('blog_system');

// ---------------------------------------------------------------------
h('1. Топ 10 авторів за кількістю опублікованих постів');
// ---------------------------------------------------------------------
table(db.posts.aggregate([
  { $match: { status: 'published' } },
  { $group: {
      _id: '$author.user_id',
      username: { $first: '$author.username' },
      posts_count: { $sum: 1 },
      total_views: { $sum: '$statistics.views' },
      total_likes: { $sum: '$statistics.likes' },
      comments: { $sum: '$statistics.comments_count' },
      categories: { $addToSet: '$category.name' },
      last_post: { $max: '$published_at' } } },
  { $sort: { posts_count: -1, total_views: -1 } },
  { $limit: 10 },
  // повне ім'я і роль - з колекції users
  { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u',
               pipeline: [{ $project: { _id: 0, full_name: '$profile.full_name', role: 1 } }] } },
  { $project: {
      _id: 0, username: 1, full_name: { $first: '$u.full_name' }, role: { $first: '$u.role' },
      posts: '$posts_count', views: '$total_views', likes: '$total_likes', comments: 1,
      avg_views: { $round: [{ $divide: ['$total_views', '$posts_count'] }, 0] },
      categories: { $size: '$categories' }, last_post: 1 } }
]).toArray(), ['username', 'full_name', 'role', 'posts', 'views', 'avg_views', 'likes', 'comments', 'categories', 'last_post']);

// ---------------------------------------------------------------------
h('2. Популярні категорії за кількістю постів (включно з порожніми)');
// ---------------------------------------------------------------------
// Агрегація починається з categories, тому категорії без постів теж
// потрапляють у результат; частка рахується від усіх опублікованих постів.
const totalPublished = db.posts.countDocuments({ status: 'published' });
table(db.categories.aggregate([
  { $match: { type: 'category' } },
  { $lookup: { from: 'posts', localField: '_id', foreignField: 'category.category_id', as: 'p', pipeline: [
      { $match: { status: 'published' } },
      { $group: { _id: null, n: { $sum: 1 }, views: { $sum: '$statistics.views' },
                  avg_likes: { $avg: '$statistics.likes' }, comments: { $sum: '$statistics.comments_count' } } }] } },
  { $lookup: { from: 'categories', localField: 'parent_id', foreignField: '_id', as: 'parent' } },
  { $set: { s: { $ifNull: [{ $first: '$p' }, { n: 0, views: 0, avg_likes: 0, comments: 0 }] } } },
  { $project: {
      _id: 0, category: '$name', parent: { $ifNull: [{ $first: '$parent.name' }, '-'] },
      posts: '$s.n', share_pct: { $round: [{ $multiply: [{ $divide: ['$s.n', totalPublished] }, 100] }, 1] },
      views: '$s.views', avg_likes: { $round: ['$s.avg_likes', 2] }, comments: '$s.comments' } },
  { $sort: { posts: -1, views: -1 } }
]).toArray(), ['category', 'parent', 'posts', 'share_pct', 'views', 'avg_likes', 'comments']);

// ---------------------------------------------------------------------
h('3. Статистика коментарів: загальна і середня на пост');
// ---------------------------------------------------------------------
// $facet виконує кілька незалежних підконвеєрів над тим самим набором постів
const cs = db.posts.aggregate([
  { $match: { status: 'published' } },
  { $set: {
      all: { $size: '$comments' },
      approved: { $size: { $filter: { input: '$comments', as: 'c', cond: { $eq: ['$$c.status', 'approved'] } } } },
      replies: { $size: { $filter: { input: '$comments', as: 'c', cond: { $gt: ['$$c.depth', 0] } } } } } },
  { $facet: {
      overall: [{ $group: {
        _id: null, posts: { $sum: 1 }, total_comments: { $sum: '$all' }, approved: { $sum: '$approved' },
        replies: { $sum: '$replies' },
        avg_per_post: { $avg: '$all' }, avg_approved_per_post: { $avg: '$approved' },
        median_per_post: { $median: { input: '$all', method: 'approximate' } },
        min_per_post: { $min: '$all' }, max_per_post: { $max: '$all' },
        no_comments: { $sum: { $cond: [{ $eq: ['$approved', 0] }, 1, 0] } } } },
        { $project: { _id: 0, posts: 1, total_comments: 1, approved: 1, replies: 1,
                      avg_per_post: { $round: ['$avg_per_post', 2] }, avg_approved_per_post: { $round: ['$avg_approved_per_post', 2] },
                      median_per_post: 1, min_per_post: 1, max_per_post: 1, no_comments: 1 } }],
      by_status: [{ $unwind: '$comments' }, { $group: { _id: '$comments.status', count: { $sum: 1 } } },
                  { $sort: { count: -1 } }, { $project: { _id: 0, status: '$_id', count: 1 } }],
      top_posts: [{ $sort: { approved: -1, all: -1 } }, { $limit: 5 },
                  { $project: { _id: 0, title: 1, approved: 1, all: 1 } }],
      top_commenters: [{ $unwind: '$comments' }, { $match: { 'comments.status': 'approved' } },
                       { $group: { _id: '$comments.author.username', comments: { $sum: 1 }, likes: { $sum: '$comments.likes' } } },
                       { $sort: { comments: -1, likes: -1 } }, { $limit: 5 },
                       { $project: { _id: 0, username: '$_id', comments: 1, likes: 1 } }],
      by_month: [{ $unwind: '$comments' },
                 { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$comments.created_at' } }, count: { $sum: 1 } } },
                 { $sort: { _id: 1 } }, { $project: { _id: 0, month: '$_id', count: 1 } }]
  } }
]).toArray()[0];
q('загальна статистика');
table(cs.overall, ['posts', 'total_comments', 'approved', 'replies', 'avg_per_post', 'avg_approved_per_post', 'median_per_post', 'min_per_post', 'max_per_post', 'no_comments']);
q('за статусом модерації'); table(cs.by_status, ['status', 'count']);
q('5 постів з найбільшою кількістю схвалених коментарів'); table(cs.top_posts, ['title', 'approved', 'all']);
q('5 найактивніших коментаторів'); table(cs.top_commenters, ['username', 'comments', 'likes']);
q('коментарі за місяцями'); table(cs.by_month, ['month', 'count']);

// ---------------------------------------------------------------------
h('4. Розподіл постів за тегами (топ 10)');
// ---------------------------------------------------------------------
table(db.posts.aggregate([
  { $match: { status: 'published' } },
  { $unwind: '$tags' },
  { $group: { _id: '$tags', count: { $sum: 1 }, avg_views: { $avg: '$statistics.views' } } },
  { $sort: { count: -1, _id: 1 } },
  { $limit: 10 },
  { $lookup: { from: 'categories', let: { s: '$_id' }, as: 't',
               pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$type', 'tag'] }, { $eq: ['$slug', '$$s'] }] } } }] } },
  { $project: { _id: 0, tag: '$_id', name: { $first: '$t.name' }, posts_count: '$count', avg_views: { $round: ['$avg_views', 0] } } }
]).toArray());

// ---------------------------------------------------------------------
h('5. Публікації за місяцями');
// ---------------------------------------------------------------------
table(db.posts.aggregate([
  { $match: { status: 'published' } },
  { $group: { _id: { $dateTrunc: { date: '$published_at', unit: 'month' } }, posts: { $sum: 1 },
              authors: { $addToSet: '$author.username' } } },
  { $sort: { _id: 1 } },
  { $project: { _id: 0, month: { $dateToString: { format: '%Y-%m', date: '$_id' } }, posts: 1, authors: { $size: '$authors' } } }
]).toArray(), ['month', 'posts', 'authors']);
