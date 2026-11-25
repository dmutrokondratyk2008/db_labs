// =====================================================================
// Лабораторна робота 7. 03_seed.js
// Рівень 1, крок 4. Наповнення бази реалістичними даними:
//   20 користувачів (2 admin, 11 author, 7 reader), 10 категорій, 30 тегів,
//   60 постів (55 published, 3 draft, 2 archived), понад 200 коментарів
//   (з відповідями і статусами модерації), реакції, перегляди за днями,
//   сповіщення. Генератор псевдовипадкових чисел із фіксованим seed,
//   тому при кожному запуску дані однакові.
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/seed_data.js');
load(__dirname + '/lib/blog.js');
db = db.getSiblingDB('blog_system');
const crypto = require('crypto');

const rnd = makeRng(20261125);
const NOW = new Date('2026-11-25T09:00:00Z');
const DAY = 24 * 3600 * 1000;

['users', 'categories', 'posts', 'reactions', 'post_views', 'post_versions', 'notifications']
  .forEach(c => db.getCollection(c).deleteMany({}));

// ---------------------------------------------------------------------
// 1. Користувачі. Пароль хешується scrypt із випадковою сіллю
// (формат PHC: $scrypt$ln=14,r=8,p=1$<сіль>$<хеш>), паролі тестові.
// ---------------------------------------------------------------------
h('1. Користувачі');
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return '$scrypt$ln=14,r=8,p=1$' + salt.toString('base64') + '$' + hash.toString('base64');
}
const userDocs = USERS.map(([username, fullName, role, city], i) => {
  const created = new Date(NOW - rnd.int(200, 700) * DAY);
  return {
    username, email: username + '@blog.ua', password_hash: hashPassword('test-' + username), role,
    profile: { full_name: fullName, bio: BIOS[role],
               avatar_url: 'https://api.dicebear.com/9.x/initials/svg?seed=' + encodeURIComponent(fullName),
               website: role === 'author' && i % 3 === 0 ? 'https://' + username.replace('.', '-') + '.dev' : null,
               city: CITIES[city][0] },
    statistics: { posts_count: 0, comments_count: 0, likes_received: 0 },
    created_at: created,
    last_login: new Date(NOW - rnd.int(0, 20) * DAY - rnd.int(0, 86399) * 1000),
    status: i === 18 ? 'suspended' : 'active'           // один читач заблокований
  };
});
res(db.users.insertMany(userDocs));
const users = db.users.find().sort({ _id: 1 }).toArray();
const byName = Object.fromEntries(users.map(u => [u.username, u]));
const activeUsers = users.filter(u => u.status === 'active');
table(db.users.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }, { $sort: { _id: 1 } },
                          { $project: { _id: 0, role: '$_id', count: 1 } }]).toArray());

// ---------------------------------------------------------------------
// 2. Категорії та теги (одна колекція, дискримінатор type)
// ---------------------------------------------------------------------
h('2. Категорії та теги');
const catCreated = new Date('2025-09-01T08:00:00Z');
res(db.categories.insertMany(CATEGORIES.map(([name, slug, description, color]) => ({
  type: 'category', name, slug, description, color, parent_id: null,
  statistics: { posts_count: 0 }, created_at: catCreated }))));
// вкладена категорія: «Хмарні технології» - підкатегорія «DevOps»
CATEGORIES.filter(c => c[4]).forEach(([, slug, , , parent]) => {
  const p = db.categories.findOne({ type: 'category', slug: parent });
  db.categories.updateOne({ type: 'category', slug }, { $set: { parent_id: p._id } });
});
res(db.categories.insertMany(TAGS.map(([slug, name, description]) => ({
  type: 'tag', name, slug, description, statistics: { posts_count: 0 }, created_at: catCreated }))));
table(db.categories.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { _id: 1 } },
                               { $project: { _id: 0, type: '$_id', count: 1 } }]).toArray());
const cats = Object.fromEntries(db.categories.find({ type: 'category' }).toArray().map(c => [c.slug, c]));

// ---------------------------------------------------------------------
// 3. Пости. Автор обирається з урахуванням ваги (активніші автори пишуть більше),
// текст складається з речень тематичного пулу, геолокація - місто автора.
// ---------------------------------------------------------------------
h('3. Пости');
const writers = [];
USERS.forEach(([username, , , , w]) => { for (let i = 0; i < w; i++) writers.push(byName[username]); });
const cityOf = {};
USERS.forEach(([username, , , city]) => { cityOf[username] = city; });

function makeContent(title, catSlug) {
  const pool = SENTENCES[catSlug];
  const paragraphs = [rnd.pick(INTROS).replace('%s', title)];
  const used = rnd.sample(pool, 6);
  paragraphs.push(used.slice(0, 2).join(' '), used.slice(2, 4).join(' '), used.slice(4, 6).join(' '));
  paragraphs.push(rnd.pick(OUTROS));
  return paragraphs.join('\n\n');
}

const draftIdx = new Set([7, 33, 58]);       // чернетки
const archivedIdx = new Set([15, 44]);       // архівні
const postDocs = [];
let idx = 0;
Object.keys(POST_TITLES).forEach(catSlug => {
  POST_TITLES[catSlug].forEach(([title, tags]) => {
    const author = rnd.pick(writers);
    const status = draftIdx.has(idx) ? 'draft' : archivedIdx.has(idx) ? 'archived' : 'published';
    const created = new Date(NOW - rnd.int(3, 180) * DAY - rnd.int(0, 86399) * 1000);
    const published = status === 'draft' ? null : new Date(created.getTime() + rnd.int(1, 48) * 3600 * 1000);
    const content = makeContent(title, catSlug);
    const doc = {
      title, slug: slugify(title), content,
      excerpt: content.split('\n\n')[1].split('. ')[0] + '.',
      author: { user_id: author._id, username: author.username, avatar_url: author.profile.avatar_url },
      category: { category_id: cats[catSlug]._id, name: cats[catSlug].name, slug: catSlug },
      tags,
      featured_image: 'https://picsum.photos/seed/' + slugify(title).slice(0, 40) + '/800/400',
      status, comments: [],
      statistics: { views: 0, likes: 0, dislikes: 0, rating: 0, comments_count: 0 },
      version: 1, created_at: created, updated_at: published || created, published_at: published
    };
    if (rnd() < 0.85) {                       // 85% постів мають геолокацію
      const [place, lng, lat] = CITIES[cityOf[author.username]];
      doc.location = { type: 'Point', place,
        coordinates: [Math.round((lng + (rnd() - 0.5) * 0.06) * 1e5) / 1e5, Math.round((lat + (rnd() - 0.5) * 0.04) * 1e5) / 1e5] };
    }
    postDocs.push(doc);
    idx++;
  });
});
res(db.posts.insertMany(postDocs));
table(db.posts.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } },
                          { $project: { _id: 0, status: '$_id', count: 1 } }]).toArray());

// ---------------------------------------------------------------------
// 4. Коментарі: 3-6 коментарів першого рівня на опублікований пост,
// частина має відповіді (до 2 рівнів вкладеності).
// Статуси: ~85% approved, ~10% pending, ~5% rejected (спам).
// ---------------------------------------------------------------------
h('4. Коментарі (вбудовані в пости, з відповідями)');
const published = db.posts.find({ status: 'published' }).toArray();
const notifications = [];
let totalComments = 0;
published.forEach(post => {
  const comments = [];
  const pubTime = post.published_at.getTime();
  const span = Math.max(NOW - pubTime, DAY);
  const mk = (parent, author, text, at) => {
    const r = rnd();
    // коментарі адміністраторів і автора посту схвалюються автоматично;
    // решта свіжих коментарів (останні 7 днів) частково ще чекають модерації
    const auto = author.role === 'admin' || author._id.equals(post.author.user_id);
    const isSpam = !parent && !auto && r > 0.955;
    const status = isSpam ? 'rejected' : auto ? 'approved' : at > NOW - 7 * DAY && r > 0.35 ? 'pending' : 'approved';
    const c = { comment_id: new ObjectId(), parent_id: parent ? parent.comment_id : null,
                depth: parent ? parent.depth + 1 : 0,
                author: { user_id: author._id, username: author.username },
                text: isSpam ? rnd.pick(SPAM) : text, status, likes: status === 'approved' ? rnd.int(0, 15) : 0,
                created_at: new Date(at) };
    if (status !== 'pending') {
      c.moderation = { by: auto ? author._id : byName[rnd.pick(['olena.kovalenko', 'serhii.melnyk'])]._id,
                       at: auto ? new Date(at) : new Date(Math.min(at + rnd.int(1, 12) * 3600 * 1000, NOW)) };
      if (status === 'rejected') c.moderation.reason = 'Спам або реклама';
    }
    comments.push(c);
    // сповіщення за останні 21 день (старіші вже прочитані й видалені TTL-індексом)
    if (at > NOW - 21 * DAY) {
      const target = parent ? parent.author : post.author;
      if (!target.user_id.equals(author._id)) {
        const read = at < NOW - 5 * DAY;
        notifications.push({ user_id: target.user_id, type: parent ? 'comment_reply' : 'new_comment',
          post_id: post._id, post_title: post.title, comment_id: c.comment_id,
          from: { user_id: author._id, username: author.username },
          message: author.username + (parent ? ' відповів(-ла) на ваш коментар до «' : ' прокоментував(-ла) ваш пост «') + post.title + '»',
          read, read_at: read ? new Date(at + DAY) : null, created_at: new Date(at) });
      }
    }
    return c;
  };
  const topCount = rnd.int(3, 6);
  for (let i = 0; i < topCount; i++) {
    const at = pubTime + Math.floor(rnd() * span * 0.8);
    const top = mk(null, rnd.pick(activeUsers), rnd.pick(COMMENTS), at);
    if (top.status === 'approved' && rnd() < 0.45) {          // відповідь автора посту або іншого користувача
      let replier = rnd() < 0.6 ? byName[post.author.username] : rnd.pick(activeUsers);
      if (replier._id.equals(top.author.user_id)) replier = rnd.pick(activeUsers.filter(x => !x._id.equals(top.author.user_id)));
      const at2 = Math.min(at + rnd.int(1, 72) * 3600 * 1000, NOW.getTime() - 3600 * 1000);
      const reply = mk(top, replier, rnd.pick(REPLIES), at2);
      if (reply.status === 'approved' && rnd() < 0.35) {
        mk(reply, byName[top.author.username], rnd.pick(REPLIES), Math.min(at2 + rnd.int(1, 48) * 3600 * 1000, NOW.getTime() - 1800 * 1000));
      }
    }
  }
  comments.sort((a, b) => a.created_at - b.created_at);
  totalComments += comments.length;
  db.posts.updateOne({ _id: post._id }, { $set: {
    comments, 'statistics.comments_count': comments.filter(c => c.status === 'approved').length } });
});
print('  Усього коментарів: ' + totalComments);
table(db.posts.aggregate([{ $unwind: '$comments' },
  { $group: { _id: { status: '$comments.status', level: { $cond: [{ $eq: ['$comments.depth', 0] }, 'коментар', 'відповідь'] } }, count: { $sum: 1 } } },
  { $sort: { '_id.status': 1, '_id.level': 1 } },
  { $project: { _id: 0, status: '$_id.status', level: '$_id.level', count: 1 } }]).toArray());

// ---------------------------------------------------------------------
// 5. Реакції (лайк/дизлайк). Популярність посту випадкова,
// кожен активний користувач реагує з імовірністю, що залежить від неї.
// ---------------------------------------------------------------------
h('5. Реакції');
const reactions = [];
const popularity = {};
published.forEach(post => {
  const pop = 0.2 + rnd() * 0.8;
  popularity[post._id.toHexString()] = pop;
  activeUsers.forEach(u => {
    if (u._id.equals(post.author.user_id) || rnd() > pop * 0.7) return;
    const at = new Date(post.published_at.getTime() + rnd() * Math.max(NOW - post.published_at, DAY) * 0.9);
    reactions.push({ post_id: post._id, user_id: u._id, value: rnd() < 0.86 ? 1 : -1, created_at: at });
  });
});
res(db.reactions.insertMany(reactions));

// ---------------------------------------------------------------------
// 6. Перегляди за днями (патерн Bucket: документ на пост і місяць).
// Найбільше переглядів у перші дні після публікації, далі спад.
// ---------------------------------------------------------------------
h('6. Перегляди (post_views)');
const buckets = {};
published.forEach(post => {
  const pop = popularity[post._id.toHexString()];
  const base = 20 + pop * 120;
  for (let t = new Date(Date.UTC(post.published_at.getUTCFullYear(), post.published_at.getUTCMonth(), post.published_at.getUTCDate()));
       t <= NOW; t = new Date(t.getTime() + DAY)) {
    const age = (t - post.published_at) / DAY;
    const n = Math.round(base * Math.exp(-Math.max(age, 0) / 12) + pop * 4 + rnd() * 3);
    if (n <= 0) continue;
    const month = t.toISOString().slice(0, 7), day = t.toISOString().slice(8, 10);
    const key = post._id.toHexString() + month;
    if (!buckets[key]) buckets[key] = { post_id: post._id, month, daily: {}, total: 0 };
    buckets[key].daily[day] = n;
    buckets[key].total += n;
  }
});
res(db.post_views.insertMany(Object.values(buckets)));

h('7. Сповіщення');
res(db.notifications.insertMany(notifications));

// ---------------------------------------------------------------------
// 8. Перерахунок денормалізованих лічильників (патерн Computed)
// ---------------------------------------------------------------------
h('8. Перерахунок статистики (patterns Computed, $merge)');
recalcPostStats();
recalcUserStats();
recalcCategoryStats();
print('  statistics у posts, users, categories оновлено');

h('Підсумок наповнення');
const summary = {
  users: db.users.countDocuments(), categories: db.categories.countDocuments({ type: 'category' }),
  tags: db.categories.countDocuments({ type: 'tag' }), posts: db.posts.countDocuments(),
  published: db.posts.countDocuments({ status: 'published' }),
  comments: db.posts.aggregate([{ $project: { n: { $size: '$comments' } } }, { $group: { _id: null, n: { $sum: '$n' } } }]).toArray()[0].n,
  reactions: db.reactions.countDocuments(), view_buckets: db.post_views.countDocuments(),
  notifications: db.notifications.countDocuments()
};
table([summary]);

h('Приклад документа posts (скорочено)');
const sample = db.posts.findOne({ slug: 'proiektuvannia-dokumentnoi-skhemy-v-mongodb' },
  { title: 1, slug: 1, excerpt: 1, author: 1, category: 1, tags: 1, status: 1, statistics: 1, location: 1, version: 1,
    published_at: 1, comments: { $slice: 2 } });
printjsonFull(sample);
