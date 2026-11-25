// =====================================================================
// Лабораторна робота 7. 13_geo.js
// Рівень 3, завдання 4. Геолокація постів (GeoJSON Point, індекс 2dsphere)
// і пошук за координатами: $near, $geoWithin, $geoNear з відстанями.
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/seed_data.js');
db = db.getSiblingDB('blog_system');

const [, LNG, LAT] = CITIES.lutsk;              // Луцьк
const lutsk = { type: 'Point', coordinates: [LNG, LAT] };
const pub = { status: 'published' };

h('1. Пости з геолокацією');
print('  з location: ' + db.posts.countDocuments(Object.assign({ location: { $exists: true } }, pub)) +
      ', без location: ' + db.posts.countDocuments(Object.assign({ location: { $exists: false } }, pub)));
printjson(db.posts.findOne({ location: { $exists: true } }, { _id: 0, title: 1, location: 1 }));

h('2. $near: пости в радіусі 100 км від Луцька, найближчі першими');
print('  усього в радіусі: ' + db.posts.countDocuments(Object.assign({ location: { $geoWithin: { $centerSphere: [[LNG, LAT], 100 / 6378.1] } } }, pub)) + ', показано перші 8');
table(db.posts.find(Object.assign({ location: { $near: { $geometry: lutsk, $maxDistance: 100000 } } }, pub),
  { _id: 0, title: 1, place: '$location.place', author: '$author.username' }).limit(8).toArray(), ['place', 'author', 'title']);

h('3. $geoNear: відстань до кожного посту (км), групування за містами');
table(db.posts.aggregate([
  { $geoNear: { near: lutsk, distanceField: 'dist_m', spherical: true, query: pub } },
  { $group: { _id: '$location.place', posts: { $sum: 1 }, km: { $min: '$dist_m' } } },
  { $sort: { km: 1 } },
  { $project: { _id: 0, place: '$_id', posts: 1, km_from_lutsk: { $round: [{ $divide: ['$km', 1000] }, 0] } } }
]).toArray(), ['place', 'posts', 'km_from_lutsk']);

h('4. $geoWithin $centerSphere: у колі 200 км від Рівного');
const [, rLng, rLat] = CITIES.rivne;
table(db.posts.aggregate([
  { $match: Object.assign({ location: { $geoWithin: { $centerSphere: [[rLng, rLat], 200 / 6378.1] } } }, pub) },
  { $group: { _id: '$location.place', posts: { $sum: 1 } } }, { $sort: { posts: -1 } },
  { $project: { _id: 0, place: '$_id', posts: 1 } }
]).toArray(), ['place', 'posts']);

h('5. $geoWithin $polygon: прямокутник «Західна Україна» (довгота 22-27, широта 48-52)');
const west = { type: 'Polygon', coordinates: [[[22, 48], [27, 48], [27, 52], [22, 52], [22, 48]]] };
print('  постів: ' + db.posts.countDocuments(Object.assign({ location: { $geoWithin: { $geometry: west } } }, pub)));

h('6. Пошук «поруч зі мною» з фільтром за категорією: «Бази даних» у межах 400 км від Києва');
const cat = db.categories.findOne({ type: 'category', slug: 'databases' });
const [, kLng, kLat] = CITIES.kyiv;
table(db.posts.aggregate([
  { $geoNear: { near: { type: 'Point', coordinates: [kLng, kLat] }, distanceField: 'd', maxDistance: 400000, spherical: true,
                query: { status: 'published', 'category.category_id': cat._id } } },
  { $project: { _id: 0, title: 1, place: '$location.place', km: { $round: [{ $divide: ['$d', 1000] }, 1] } } }
]).toArray(), ['title', 'place', 'km']);

h('7. План запиту $near (індекс location_2dsphere)');
const gp = planSummary(db.posts.find({ location: { $near: { $geometry: lutsk, $maxDistance: 100000 } } }).explain('executionStats'));
// 2dsphere-пошук $near переглядає індекс кільцями, тому стадії FETCH <- IXSCAN повторюються - показуємо унікальні
gp.plan = [...new Set(gp.plan.split(' <- '))].join(' <- ');
print('  ' + fmt(gp));

h('8. Валідація: координати поза діапазоном відхиляються');
try {
  db.posts.updateOne({ slug: 'dyzain-systema-v-figma-z-nulia' }, { $set: { 'location.coordinates': [250, 50] } });
  print('  оновлено (помилка!)');
} catch (e) { print('  [250, 50] -> ' + cn(e)); }
