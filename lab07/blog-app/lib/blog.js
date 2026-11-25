// =====================================================================
// Лабораторна робота 7. blog-app/lib/blog.js
// Сервісний шар блог-системи для Node.js-драйвера MongoDB.
// Логіка збігається з scripts/lib/blog.js (mongosh), але асинхронна.
// =====================================================================
const { ObjectId } = require('mongodb');

class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const oid = (v, name = 'id') => {
  if (v instanceof ObjectId) return v;
  if (typeof v !== 'string' || !ObjectId.isValid(v) || v.length !== 24) throw new ApiError(400, `Некоректний ${name}`);
  return new ObjectId(v);
};

function slugify(text) {
  const map = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ie', 'ж': 'zh', 'з': 'z',
    'и': 'y', 'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
    'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '',
    'ю': 'iu', 'я': 'ia', "'": '', '’': '' };
  const first = { 'є': 'ye', 'ї': 'yi', 'й': 'y', 'ю': 'yu', 'я': 'ya' };
  const lower = String(text).toLowerCase().replace(/зг/g, 'zgh');
  let out = '';
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    const start = i === 0 || !/[а-яґєії']/.test(lower[i - 1]);
    out += start && first[ch] ? first[ch] : map[ch] !== undefined ? map[ch] : ch;
  }
  return out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200);
}

const APPROVED_COUNT = { $size: { $filter: { input: '$comments', as: 'c', cond: { $eq: ['$$c.status', 'approved'] } } } };
const LIST_PROJECTION = { title: 1, slug: 1, excerpt: 1, author: 1, category: 1, tags: 1, featured_image: 1, status: 1,
  statistics: 1, location: 1, published_at: 1, created_at: 1, version: 1 };
const VERSIONED = ['title', 'content', 'excerpt', 'tags', 'category', 'status'];

function makeBlog(db) {
  const posts = db.collection('posts'), users = db.collection('users'), categories = db.collection('categories'),
        reactions = db.collection('reactions'), postViews = db.collection('post_views'),
        versions = db.collection('post_versions'), notifications = db.collection('notifications');

  async function getUser(id) {
    const u = await users.findOne({ _id: oid(id, 'user_id') });
    if (!u) throw new ApiError(404, 'Користувача не знайдено');
    if (u.status !== 'active') throw new ApiError(403, 'Обліковий запис заблоковано');
    return u;
  }
  async function getPostById(id, projection) {
    const p = await posts.findOne({ _id: oid(id, 'post_id') }, projection ? { projection } : undefined);
    if (!p) throw new ApiError(404, 'Пост не знайдено');
    return p;
  }
  const canEdit = (user, post) => user.role === 'admin' || user._id.equals(post.author.user_id);

  // ---------------------------------------------------------------
  // Список постів: фільтри + пагінація через $facet (рівень 2)
  // ---------------------------------------------------------------
  async function listPosts(q, viewerId) {
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(q.limit, 10) || 9));
    const match = { status: 'published' };
    if (q.status && q.status !== 'published') {
      if (!['draft', 'archived', 'all'].includes(q.status)) throw new ApiError(400, 'Невідомий статус посту');
      // чернетки й архівні пости бачать лише адміністратор (усі) та автор (лише власні)
      const viewer = viewerId ? await getUser(viewerId) : null;
      if (!viewer || viewer.role === 'reader') throw new ApiError(403, 'Чернетки й архівні пости доступні лише авторам і адміністраторам');
      match.status = q.status === 'all' ? { $in: ['published', 'draft', 'archived'] } : q.status;
      if (viewer.role !== 'admin') match['author.user_id'] = viewer._id;
    }
    const tags = String(q.tags || '').split(',').map(s => s.trim()).filter(Boolean);
    if (tags.length) match.tags = q.tag_mode === 'any' ? { $in: tags } : { $all: tags };
    if (q.category) {
      const c = await categories.findOne({ type: 'category', slug: String(q.category) });
      match['category.category_id'] = c ? c._id : null;
    }
    if (q.author) match['author.username'] = String(q.author);
    const sorts = { new: { published_at: -1, _id: -1 }, views: { 'statistics.views': -1, _id: -1 },
                    rating: { 'statistics.rating': -1, _id: -1 }, comments: { 'statistics.comments_count': -1, _id: -1 } };
    const pipeline = [];
    if (q.lng && q.lat) {                                  // пошук поруч: $geoNear має бути першою стадією
      const lng = Number(q.lng), lat = Number(q.lat), km = Number(q.km) || 100;
      if (!isFinite(lng) || !isFinite(lat)) throw new ApiError(400, 'Некоректні координати');
      pipeline.push({ $geoNear: { near: { type: 'Point', coordinates: [lng, lat] }, distanceField: 'distance_m',
                                  maxDistance: km * 1000, spherical: true, query: match } });
    } else if (q.q) {                                      // повнотекстовий пошук
      match.$text = { $search: String(q.q).slice(0, 200) };
      pipeline.push({ $match: match }, { $set: { score: { $meta: 'textScore' } } });
    } else pipeline.push({ $match: match });
    const sort = q.lng && q.lat ? { distance_m: 1 } : q.q && !q.sort ? { score: -1, _id: -1 } : sorts[q.sort] || sorts.new;
    pipeline.push(
      { $sort: sort },
      { $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit },
                { $project: Object.assign({}, LIST_PROJECTION, q.q ? { score: 1 } : {}, q.lng ? { distance_m: 1 } : {}) }],
        total: [{ $count: 'count' }] } },
      { $project: { items: 1, total: { $ifNull: [{ $first: '$total.count' }, 0] } } });
    const [r] = await posts.aggregate(pipeline).toArray();
    return { items: r.items, page, limit, total: r.total, pages: Math.ceil(r.total / limit) };
  }

  // дерево коментарів (рекурсивно, зі списку з parent_id)
  function buildTree(list, parentId = null) {
    return list.filter(c => (parentId ? c.parent_id && c.parent_id.equals(parentId) : !c.parent_id))
      .sort((a, b) => a.created_at - b.created_at)
      .map(c => ({ ...c, replies: buildTree(list, c.comment_id) }));
  }

  async function getPost(slug, viewerId) {
    const p = await posts.findOne({ slug: String(slug) });
    if (!p) throw new ApiError(404, 'Пост не знайдено');
    const viewer = viewerId && ObjectId.isValid(viewerId) ? await users.findOne({ _id: new ObjectId(viewerId) }) : null;
    // чернетки й архівні пости бачать лише їхній автор та адміністратори
    if (p.status !== 'published' && !(viewer && canEdit(viewer, p))) throw new ApiError(404, 'Пост не знайдено');
    // публічно показуємо схвалені; автор коментаря бачить і свої, що очікують модерації
    const visible = p.comments.filter(c => c.status === 'approved' ||
      (viewer && (viewer.role === 'admin' || c.author.user_id.equals(viewer._id)) && c.status === 'pending'));
    const myReaction = viewer ? await reactions.findOne({ post_id: p._id, user_id: viewer._id }) : null;
    const related = await posts.aggregate([
      { $match: { status: 'published', _id: { $ne: p._id }, tags: { $in: p.tags } } },
      { $set: { common: { $size: { $setIntersection: ['$tags', p.tags] } } } },
      { $sort: { common: -1, 'statistics.views': -1 } }, { $limit: 3 },
      { $project: { title: 1, slug: 1, common: 1 } }]).toArray();
    const { comments, ...rest } = p;
    return { ...rest, comments_total: comments.length, comment_tree: buildTree(visible),
             my_reaction: myReaction ? myReaction.value : 0, related };
  }

  // ---------------------------------------------------------------
  // Створення, редагування з версіонуванням, архівування
  // ---------------------------------------------------------------
  async function normalizeInput(body, partial) {
    const out = {};
    if (body.title !== undefined) out.title = String(body.title).trim();
    if (body.content !== undefined) out.content = String(body.content).replace(/\r\n/g, '\n').trim();
    if (body.excerpt !== undefined) out.excerpt = String(body.excerpt).trim().slice(0, 400);
    if (body.tags !== undefined) {
      const arr = Array.isArray(body.tags) ? body.tags : String(body.tags).split(',');
      out.tags = [...new Set(arr.map(t => slugify(t)).filter(Boolean))].slice(0, 10);
    }
    if (body.status !== undefined) out.status = String(body.status);
    if (body.category !== undefined) {
      const c = await categories.findOne({ type: 'category', slug: String(body.category) });
      if (!c) throw new ApiError(400, 'Невідома категорія');
      out.category = { category_id: c._id, name: c.name, slug: c.slug };
    }
    if (!partial) {
      if (!out.title || out.title.length < 3) throw new ApiError(400, 'Назва має містити щонайменше 3 символи');
      if (!out.content || out.content.length < 100) throw new ApiError(400, 'Текст статті має містити щонайменше 100 символів');
      if (!out.category) throw new ApiError(400, 'Оберіть категорію');
    }
    checkLengths(out);
    return out;
  }

  // ті самі межі, що в $jsonSchema колекції posts (01_create_collections.js)
  function checkLengths(d) {
    if (d.title !== undefined && (d.title.length < 3 || d.title.length > 200)) throw new ApiError(400, 'Назва має містити від 3 до 200 символів');
    if (d.content !== undefined && d.content.length < 100) throw new ApiError(400, 'Текст статті має містити щонайменше 100 символів');
  }

  async function createPost(userId, body) {
    const user = await getUser(userId);
    if (user.role === 'reader') throw new ApiError(403, 'Створювати пости можуть лише автори та адміністратори');
    const d = await normalizeInput(body, false);
    const status = d.status === 'draft' ? 'draft' : 'published';
    let slug = slugify(body.slug || d.title) || 'post';
    if (await posts.findOne({ slug }, { projection: { _id: 1 } })) slug += '-' + Date.now().toString(36);
    const now = new Date();
    const doc = {
      title: d.title, slug, content: d.content, excerpt: d.excerpt || d.content.split('\n')[0].slice(0, 200),
      author: { user_id: user._id, username: user.username, avatar_url: user.profile && user.profile.avatar_url },
      category: d.category, tags: d.tags || [],
      featured_image: 'https://picsum.photos/seed/' + slug.slice(0, 40) + '/800/400',
      status, comments: [], statistics: { views: 0, likes: 0, dislikes: 0, rating: 0, comments_count: 0 },
      version: 1, created_at: now, updated_at: now, published_at: status === 'published' ? now : null
    };
    const lng = Number(body.lng), lat = Number(body.lat);
    if (body.lng !== undefined && body.lng !== '' && isFinite(lng) && isFinite(lat)) {
      doc.location = { type: 'Point', coordinates: [lng, lat], place: String(body.place || '').slice(0, 50) || 'Без назви' };
    }
    if (!doc.author.avatar_url) delete doc.author.avatar_url;
    const r = await posts.insertOne(doc);
    if (status === 'published') await bumpCounters(doc, 1);
    return { _id: r.insertedId, slug };
  }

  async function bumpCounters(post, delta) {
    await users.updateOne({ _id: post.author.user_id }, { $inc: { 'statistics.posts_count': delta } });
    await categories.updateOne({ _id: post.category.category_id }, { $inc: { 'statistics.posts_count': delta } });
    if (post.tags.length) await categories.updateMany({ type: 'tag', slug: { $in: post.tags } }, { $inc: { 'statistics.posts_count': delta } });
  }

  async function editPost(postId, userId, body) {
    const user = await getUser(userId);
    const post = await getPostById(postId);
    if (!canEdit(user, post)) throw new ApiError(403, 'Редагувати пост може лише автор або адміністратор');
    const expected = body.expected_version !== undefined ? Number(body.expected_version) : undefined;
    if (expected !== undefined && expected !== post.version) {
      throw new ApiError(409, `Конфлікт версій: ви редагували v${expected}, а поточна v${post.version}`, { current_version: post.version });
    }
    const d = await normalizeInput(body, true);
    const changed = VERSIONED.filter(f => d[f] !== undefined && JSON.stringify(d[f]) !== JSON.stringify(post[f]));
    if (!changed.length) return { version: post.version, changed: [] };
    checkLengths(d);
    if (d.status !== undefined && !['draft', 'published', 'archived'].includes(d.status)) throw new ApiError(400, 'Невідомий статус посту');
    const snapshot = {};
    VERSIONED.forEach(f => { if (post[f] !== undefined) snapshot[f] = post[f]; });
    const now = new Date();
    const v = await versions.insertOne({ post_id: post._id, version: post.version, snapshot, changed_fields: changed,
      change_note: String(body.change_note || '').slice(0, 200), edited_by: { user_id: user._id, username: user.username }, edited_at: now });
    const set = { updated_at: now };
    changed.forEach(f => { set[f] = d[f]; });
    if (d.status === 'published' && !post.published_at) set.published_at = now;
    let r;
    try {
      r = await posts.updateOne({ _id: post._id, version: post.version }, { $set: set, $inc: { version: 1 } });
    } catch (e) {                     // оновлення не пройшло $jsonSchema тощо: знімок не має лишитися в історії
      await versions.deleteOne({ _id: v.insertedId });
      throw e;
    }
    if (r.matchedCount === 0) {
      await versions.deleteOne({ _id: v.insertedId });
      throw new ApiError(409, 'Конфлікт версій: пост щойно змінив інший користувач');
    }
    // лічильники категорій/тегів, якщо змінився статус публікації або теги
    const wasPub = post.status === 'published', isPub = (d.status || post.status) === 'published';
    if (wasPub) await bumpCounters(post, -1);
    if (isPub) await bumpCounters({ ...post, ...set }, 1);
    return { version: post.version + 1, changed };
  }

  async function listVersions(postId) {
    const post = await getPostById(postId, { title: 1, version: 1, updated_at: 1, author: 1 });
    const list = await versions.find({ post_id: post._id }, { projection: { 'snapshot.content': 0 } }).sort({ version: -1 }).toArray();
    return { current: post, versions: list };
  }
  async function getVersion(postId, version) {
    const v = await versions.findOne({ post_id: oid(postId, 'post_id'), version: Number(version) });
    if (!v) throw new ApiError(404, 'Версію не знайдено');
    return v;
  }
  async function restoreVersion(postId, version, userId) {
    const v = await getVersion(postId, version);
    return editPost(postId, userId, { ...v.snapshot, category: v.snapshot.category && v.snapshot.category.slug,
                                     change_note: 'Відновлено версію ' + version });
  }
  async function archivePost(postId, userId) {
    return editPost(postId, userId, { status: 'archived', change_note: 'Пост переміщено в архів' });
  }

  // ---------------------------------------------------------------
  // Реакції і перегляди (рівень 2)
  // ---------------------------------------------------------------
  async function react(postId, userId, value) {
    value = Number(value);
    if (value !== 1 && value !== -1) throw new ApiError(400, 'value має бути 1 або -1');
    const user = await getUser(userId);
    const post = await getPostById(postId, { status: 1 });
    if (post.status !== 'published') throw new ApiError(400, 'Реакції доступні лише для опублікованих постів');
    const prev = await reactions.findOne({ post_id: post._id, user_id: user._id });
    let dl = 0, dd = 0, action;
    if (!prev) {
      try { await reactions.insertOne({ post_id: post._id, user_id: user._id, value, created_at: new Date() }); }
      catch (e) { if (e.code === 11000) throw new ApiError(409, 'Реакцію вже зараховано, повторіть запит'); throw e; }
      value === 1 ? dl++ : dd++; action = 'added';
    } else if (prev.value === value) {
      await reactions.deleteOne({ _id: prev._id }); value === 1 ? dl-- : dd--; action = 'removed';
    } else {
      await reactions.updateOne({ _id: prev._id }, { $set: { value, updated_at: new Date() } });
      if (value === 1) { dl++; dd--; } else { dl--; dd++; } action = 'switched';
    }
    const p = await posts.findOneAndUpdate({ _id: post._id }, [
      { $set: { 'statistics.likes': { $add: ['$statistics.likes', dl] }, 'statistics.dislikes': { $add: ['$statistics.dislikes', dd] } } },
      { $set: { 'statistics.rating': { $subtract: ['$statistics.likes', '$statistics.dislikes'] } } }
    ], { returnDocument: 'after', projection: { statistics: 1 } });
    return { action, my_reaction: action === 'removed' ? 0 : value, statistics: p.statistics };
  }

  async function addView(postId) {
    const id = oid(postId, 'post_id');
    const now = new Date();
    const month = now.toISOString().slice(0, 7), day = now.toISOString().slice(8, 10);
    const p = await posts.findOneAndUpdate({ _id: id, status: 'published' }, { $inc: { 'statistics.views': 1 } },
                                          { returnDocument: 'after', projection: { 'statistics.views': 1 } });
    if (!p) throw new ApiError(404, 'Пост не знайдено');
    await postViews.updateOne({ post_id: id, month }, { $inc: { ['daily.' + day]: 1, total: 1 } }, { upsert: true });
    return { views: p.statistics.views };
  }

  // ---------------------------------------------------------------
  // Коментарі, модерація, сповіщення (рівні 2-3)
  // ---------------------------------------------------------------
  async function notify(userId, type, post, comment, from, message) {
    if (from && userId.equals(from.user_id)) return;
    await notifications.insertOne({ user_id: userId, type, post_id: post._id, post_title: post.title,
      comment_id: comment.comment_id, from: from ? { user_id: from.user_id, username: from.username } : undefined,
      message, read: false, read_at: null, created_at: new Date() });
  }

  async function addComment(postId, userId, text, parentId) {
    const user = await getUser(userId);
    text = String(text || '').trim();
    if (text.length < 2 || text.length > 2000) throw new ApiError(400, 'Коментар має містити від 2 до 2000 символів');
    const post = await getPostById(postId, { title: 1, author: 1, status: 1, comments: 1 });
    if (post.status !== 'published') throw new ApiError(400, 'Коментувати можна лише опубліковані пости');
    let parent = null;
    if (parentId) {
      const pid = oid(parentId, 'parent_id');
      parent = post.comments.find(c => c.comment_id.equals(pid));
      if (!parent) throw new ApiError(404, 'Батьківський коментар не знайдено');
      if (parent.depth >= 5) throw new ApiError(400, 'Досягнуто максимальної глибини вкладеності (5)');
    }
    const auto = user.role === 'admin' || user._id.equals(post.author.user_id);
    const now = new Date();
    const c = { comment_id: new ObjectId(), parent_id: parent ? parent.comment_id : null, depth: parent ? parent.depth + 1 : 0,
                author: { user_id: user._id, username: user.username }, text, status: auto ? 'approved' : 'pending',
                likes: 0, created_at: now };
    if (auto) c.moderation = { by: user._id, at: now };
    await posts.updateOne({ _id: post._id }, { $push: { comments: c }, $inc: { 'statistics.comments_count': auto ? 1 : 0 } });
    await users.updateOne({ _id: user._id }, { $inc: { 'statistics.comments_count': auto ? 1 : 0 } });
    await notify(post.author.user_id, 'new_comment', post, c, c.author,
      `${user.username} прокоментував(-ла) ваш пост «${post.title}»${auto ? '' : ' (очікує модерації)'}`);
    if (parent && auto && !parent.author.user_id.equals(post.author.user_id)) {
      await notify(parent.author.user_id, 'comment_reply', post, c, c.author, `${user.username} відповів(-ла) на ваш коментар до «${post.title}»`);
    }
    return c;
  }

  async function moderationQueue(viewerId) {
    const viewer = viewerId ? await getUser(viewerId) : null;
    if (!viewer || viewer.role !== 'admin') throw new ApiError(403, 'Черга модерації доступна лише адміністратору');
    return posts.aggregate([
      { $match: { 'comments.status': 'pending' } }, { $unwind: '$comments' }, { $match: { 'comments.status': 'pending' } },
      { $sort: { 'comments.created_at': 1 } },
      { $lookup: { from: 'posts', let: { pid: '$_id', par: '$comments.parent_id' }, as: 'parent', pipeline: [
        { $match: { $expr: { $eq: ['$_id', '$$pid'] } } }, { $unwind: '$comments' },
        { $match: { $expr: { $eq: ['$comments.comment_id', '$$par'] } } }, { $project: { _id: 0, text: '$comments.text', author: '$comments.author.username' } }] } },
      { $project: { _id: 0, post_id: '$_id', post_title: '$title', post_slug: '$slug', comment: '$comments', parent: { $first: '$parent' } } }
    ]).toArray();
  }

  async function moderate(commentId, moderatorId, status, reason) {
    const mod = await getUser(moderatorId);
    if (mod.role !== 'admin') throw new ApiError(403, 'Модерувати коментарі може лише адміністратор');
    if (!['approved', 'rejected', 'pending'].includes(status)) throw new ApiError(400, 'Невідомий статус');
    const cid = oid(commentId, 'comment_id');
    const before = await posts.findOne({ 'comments.comment_id': cid }, { projection: { comments: { $elemMatch: { comment_id: cid } } } });
    if (!before) throw new ApiError(404, 'Коментар не знайдено');
    const prevStatus = before.comments[0].status;
    const moderation = { by: mod._id, at: new Date() };
    if (reason) moderation.reason = String(reason).slice(0, 200);
    const post = await posts.findOneAndUpdate({ 'comments.comment_id': cid },
      { $set: { 'comments.$[c].status': status, 'comments.$[c].moderation': moderation } },
      { arrayFilters: [{ 'c.comment_id': cid }], returnDocument: 'after', projection: { title: 1, author: 1, comments: 1 } });
    await posts.updateOne({ _id: post._id }, [{ $set: { 'statistics.comments_count': APPROVED_COUNT } }]);
    const c = post.comments.find(x => x.comment_id.equals(cid));
    const delta = (status === 'approved') - (prevStatus === 'approved');
    if (delta) await users.updateOne({ _id: c.author.user_id }, { $inc: { 'statistics.comments_count': delta } });
    if (status !== 'pending' && status !== prevStatus) {
      await notify(c.author.user_id, status === 'approved' ? 'comment_approved' : 'comment_rejected', post, c,
        { user_id: mod._id, username: mod.username },
        `Ваш коментар до «${post.title}» ${status === 'approved' ? 'схвалено' : 'відхилено' + (reason ? ': ' + reason : '')}`);
      if (status === 'approved' && c.parent_id) {
        const parent = post.comments.find(x => x.comment_id.equals(c.parent_id));
        if (parent) await notify(parent.author.user_id, 'comment_reply', post, c, c.author, `${c.author.username} відповів(-ла) на ваш коментар до «${post.title}»`);
      }
    }
    return { comment_id: cid, status, post_id: post._id };
  }

  async function listNotifications(userId, unreadOnly, limit = 20) {
    const uid = oid(userId, 'user_id');
    const filter = { user_id: uid };
    if (unreadOnly) filter.read = false;
    const [items, unread] = await Promise.all([
      notifications.find(filter).sort({ created_at: -1 }).limit(Math.min(100, limit)).toArray(),
      notifications.countDocuments({ user_id: uid, read: false })]);
    return { unread, items };
  }
  async function markRead(userId, ids) {
    const filter = { user_id: oid(userId, 'user_id'), read: false };
    if (Array.isArray(ids) && ids.length) filter._id = { $in: ids.map(i => oid(i)) };
    const r = await notifications.updateMany(filter, { $set: { read: true, read_at: new Date() } });
    return { marked: r.modifiedCount };
  }

  // ---------------------------------------------------------------
  // Довідники
  // ---------------------------------------------------------------
  const listUsers = () => users.find({}, { projection: { password_hash: 0, email: 0 } }).sort({ role: 1, username: 1 }).toArray();
  const listCategories = () => categories.find({ type: 'category' }).sort({ name: 1 }).toArray();
  const listTags = () => categories.find({ type: 'tag' }).sort({ 'statistics.posts_count': -1, slug: 1 }).toArray();

  // ---------------------------------------------------------------
  // Аналітика (рівень 1 агрегації + дані для панелі, рівень 3)
  // ---------------------------------------------------------------
  const pub = { $match: { status: 'published' } };
  const stats = {
    async overview() {
      const [p] = await posts.aggregate([pub, { $group: { _id: null, posts: { $sum: 1 }, views: { $sum: '$statistics.views' },
        likes: { $sum: '$statistics.likes' }, dislikes: { $sum: '$statistics.dislikes' },
        comments: { $sum: { $size: '$comments' } }, approved: { $sum: '$statistics.comments_count' } } }]).toArray();
      const [pending] = await posts.aggregate([{ $unwind: '$comments' }, { $match: { 'comments.status': 'pending' } }, { $count: 'n' }]).toArray();
      return { ...p, _id: undefined, pending: pending ? pending.n : 0, users: await users.countDocuments(),
               authors: (await posts.distinct('author.user_id', { status: 'published' })).length,
               avg_comments_per_post: p ? Math.round(p.comments / p.posts * 100) / 100 : 0 };
    },
    topAuthors: (limit = 10) => posts.aggregate([pub,
      { $group: { _id: '$author.user_id', username: { $first: '$author.username' }, posts: { $sum: 1 },
                  views: { $sum: '$statistics.views' }, likes: { $sum: '$statistics.likes' } } },
      { $sort: { posts: -1, views: -1 } }, { $limit: limit },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $project: { _id: 0, username: 1, full_name: { $first: '$u.profile.full_name' }, posts: 1, views: 1, likes: 1,
                    avg_views: { $round: [{ $divide: ['$views', '$posts'] }, 0] } } }]).toArray(),
    categories: () => categories.aggregate([{ $match: { type: 'category' } },
      { $lookup: { from: 'posts', localField: '_id', foreignField: 'category.category_id', as: 'p', pipeline: [pub,
        { $group: { _id: null, n: { $sum: 1 }, views: { $sum: '$statistics.views' }, avg_likes: { $avg: '$statistics.likes' } } }] } },
      { $set: { s: { $ifNull: [{ $first: '$p' }, { n: 0, views: 0, avg_likes: 0 }] } } },
      { $project: { _id: 0, name: 1, slug: 1, color: 1, posts: '$s.n', views: '$s.views', avg_likes: { $round: ['$s.avg_likes', 2] } } },
      { $sort: { posts: -1, views: -1 } }]).toArray(),
    tags: (limit = 15) => posts.aggregate([pub, { $unwind: '$tags' },
      { $group: { _id: '$tags', posts: { $sum: 1 }, views: { $sum: '$statistics.views' } } },
      { $sort: { posts: -1, _id: 1 } }, { $limit: limit }, { $project: { _id: 0, tag: '$_id', posts: 1, views: 1 } }]).toArray(),
    comments: () => posts.aggregate([pub, { $facet: {
      by_status: [{ $unwind: '$comments' }, { $group: { _id: '$comments.status', n: { $sum: 1 } } }, { $project: { _id: 0, status: '$_id', n: 1 } }],
      by_depth: [{ $unwind: '$comments' }, { $group: { _id: '$comments.depth', n: { $sum: 1 } } }, { $sort: { _id: 1 } }, { $project: { _id: 0, depth: '$_id', n: 1 } }],
      by_month: [{ $unwind: '$comments' }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$comments.created_at' } }, n: { $sum: 1 } } },
                 { $sort: { _id: 1 } }, { $project: { _id: 0, month: '$_id', n: 1 } }],
      per_post: [{ $group: { _id: null, avg: { $avg: { $size: '$comments' } }, max: { $max: { $size: '$comments' } }, total: { $sum: { $size: '$comments' } } } },
                 { $project: { _id: 0, avg: { $round: ['$avg', 2] }, max: 1, total: 1 } }] } }]).toArray().then(r => r[0]),
    viewsDaily: (days = 30) => {
      const since = new Date(Date.now() - (days - 1) * 86400000);
      const sinceDay = since.toISOString().slice(0, 10);
      return postViews.aggregate([{ $match: { month: { $gte: sinceDay.slice(0, 7) } } },
        { $project: { month: 1, d: { $objectToArray: '$daily' } } }, { $unwind: '$d' },
        { $set: { day: { $concat: ['$month', '-', '$d.k'] } } }, { $match: { day: { $gte: sinceDay } } },
        { $group: { _id: '$day', views: { $sum: '$d.v' } } }, { $sort: { _id: 1 } }, { $project: { _id: 0, day: '$_id', views: 1 } }]).toArray();
    },
    postsByMonth: () => posts.aggregate([pub, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$published_at' } }, posts: { $sum: 1 } } },
      { $sort: { _id: 1 } }, { $project: { _id: 0, month: '$_id', posts: 1 } }]).toArray(),
    topPosts: (limit = 10) => posts.find({ status: 'published' }, { projection: { title: 1, slug: 1, statistics: 1, 'author.username': 1 } })
      .sort({ 'statistics.views': -1 }).limit(limit).toArray(),
    geo: () => posts.aggregate([pub, { $match: { location: { $exists: true } } },
      { $group: { _id: '$location.place', posts: { $sum: 1 }, lng: { $avg: { $arrayElemAt: ['$location.coordinates', 0] } },
                  lat: { $avg: { $arrayElemAt: ['$location.coordinates', 1] } } } },
      { $sort: { posts: -1 } }, { $project: { _id: 0, place: '$_id', posts: 1, lng: { $round: ['$lng', 3] }, lat: { $round: ['$lat', 3] } } }]).toArray()
  };

  async function geoNear(lng, lat, km = 100, limit = 20) {
    lng = Number(lng); lat = Number(lat); km = Math.min(2000, Number(km) || 100);
    if (!isFinite(lng) || !isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new ApiError(400, 'Некоректні координати');
    return posts.aggregate([
      { $geoNear: { near: { type: 'Point', coordinates: [lng, lat] }, distanceField: 'distance_m', maxDistance: km * 1000,
                    spherical: true, query: { status: 'published' } } },
      { $limit: Math.min(100, limit) },
      { $project: { title: 1, slug: 1, 'location.place': 1, 'author.username': 1, distance_km: { $round: [{ $divide: ['$distance_m', 1000] }, 1] } } }
    ]).toArray();
  }

  // Патерн Computed: повний перерахунок денормалізованих лічильників (як recalc* у scripts/lib/blog.js)
  async function recalcStats() {
    await users.aggregate([
      { $lookup: { from: 'posts', localField: '_id', foreignField: 'author.user_id', as: 'p', pipeline: [pub,
        { $group: { _id: null, n: { $sum: 1 }, likes: { $sum: '$statistics.likes' } } }] } },
      { $lookup: { from: 'posts', localField: '_id', foreignField: 'comments.author.user_id', as: 'c', let: { uid: '$_id' }, pipeline: [
        { $project: { n: { $size: { $filter: { input: '$comments', as: 'x', cond: { $and: [
          { $eq: ['$$x.author.user_id', '$$uid'] }, { $eq: ['$$x.status', 'approved'] }] } } } } } },
        { $group: { _id: null, n: { $sum: '$n' } } }] } },
      { $project: { statistics: { posts_count: { $ifNull: [{ $first: '$p.n' }, 0] }, comments_count: { $ifNull: [{ $first: '$c.n' }, 0] },
                                  likes_received: { $ifNull: [{ $first: '$p.likes' }, 0] } } } },
      { $merge: { into: 'users', on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } }]).toArray();
    await categories.aggregate([
      { $lookup: { from: 'posts', as: 'p', let: { id: '$_id', slug: '$slug', type: '$type' }, pipeline: [pub,
        { $match: { $expr: { $cond: [{ $eq: ['$$type', 'tag'] }, { $in: ['$$slug', '$tags'] }, { $eq: ['$category.category_id', '$$id'] }] } } },
        { $count: 'n' }] } },
      { $project: { statistics: { posts_count: { $ifNull: [{ $first: '$p.n' }, 0] } } } },
      { $merge: { into: 'categories', on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } }]).toArray();
  }

  return { ApiError, slugify, recalcStats, listPosts, getPost, createPost, editPost, listVersions, getVersion, restoreVersion, archivePost,
           react, addView, addComment, moderationQueue, moderate, listNotifications, markRead,
           listUsers, listCategories, listTags, stats, geoNear, getUser };
}

module.exports = { makeBlog, ApiError, slugify };
