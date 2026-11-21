// =====================================================================
// Лабораторна робота 6. 13_geo_ttl.js
// Геопросторовий індекс 2dsphere (філії бібліотеки в Луцьку і запити
// за координатами) та TTL-індекси для автоматичного видалення сесій.
// Координати GeoJSON задаються як [довгота, широта].
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');

h('Колекція branches: філії бібліотеки (GeoJSON Point)');
db.branches.drop();
res(db.branches.insertMany([
  { name: 'Центральна бібліотека',    address: 'вул. Лесі Українки, 20',  open_hours: '09-19', location: { type: 'Point', coordinates: [25.3245, 50.7393] }, services: ['абонемент', 'читальна зала', 'коворкінг'] },
  { name: 'Філія №1 (Старе місто)',    address: 'вул. Драгоманова, 8',     open_hours: '10-18', location: { type: 'Point', coordinates: [25.3168, 50.7366] }, services: ['абонемент', 'краєзнавчий фонд'] },
  { name: 'Філія №2 (33-й мікрорайон)', address: 'просп. Відродження, 30', open_hours: '10-18', location: { type: 'Point', coordinates: [25.3720, 50.7520] }, services: ['абонемент', 'дитяча зала'] },
  { name: 'Філія №3 (Вишків)',         address: 'вул. Рівненська, 105',    open_hours: '10-17', location: { type: 'Point', coordinates: [25.3815, 50.7290] }, services: ['абонемент'] },
  { name: 'Філія №4 (Гнідава)',        address: 'вул. Гордіюк, 25',        open_hours: '11-18', location: { type: 'Point', coordinates: [25.3040, 50.7475] }, services: ['абонемент', 'дитяча зала'] },
  { name: 'Філія №5 (Ківерці)',        address: 'Ківерці, вул. Грушевського, 2', open_hours: '10-16', location: { type: 'Point', coordinates: [25.4930, 50.8340] }, services: ['абонемент', 'читальна зала'] }
]));
print('  branches: ' + db.branches.createIndex({ location: '2dsphere' }));

// Точка читача ivan_petrov (вул. Лесі Українки, 12) записуємо в users.location
db.users.updateOne({ username: 'ivan_petrov' }, { $set: { location: { type: 'Point', coordinates: [25.3260, 50.7410] } } });
db.users.updateOne({ username: 'iryna_savchuk' }, { $set: { location: { type: 'Point', coordinates: [25.3600, 50.7480] } } });
print('  users:    ' + db.users.createIndex({ location: '2dsphere' }, { sparse: true }));
const me = db.users.findOne({ username: 'ivan_petrov' }).location;

h('$near: філії в радіусі 2 км від читача ivan_petrov (від найближчої)');
rows(db.branches.find({ location: { $near: { $geometry: me, $maxDistance: 2000 } } },
                      { _id: 0, name: 1, address: 1 }));

h('$geoNear: відстань до кожної філії в км, лише з дитячою залою');
rows(db.branches.aggregate([
  { $geoNear: { near: me, distanceField: 'dist_m', spherical: true, query: { services: 'дитяча зала' } } },
  { $project: { _id: 0, name: 1, km: { $round: [{ $divide: ['$dist_m', 1000] }, 2] } } }
]));

h('$geoWithin $centerSphere: філії в межах 5 км від центру Луцька');
rows(db.branches.find({ location: { $geoWithin: { $centerSphere: [[25.3254, 50.7472], 5 / 6378.1] } } },
                      { _id: 0, name: 1 }));

h('$geoWithin $polygon: філії в зоні "центр міста"');
const center = { type: 'Polygon', coordinates: [[ [25.300, 50.730], [25.345, 50.730], [25.345, 50.755],
                                                  [25.300, 50.755], [25.300, 50.730] ]] };
rows(db.branches.find({ location: { $geoWithin: { $geometry: center } } }, { _id: 0, name: 1 }));

h('$geoIntersects: якою зоною обслуговування покрито точку читача iryna_savchuk');
db.zones.drop();
db.zones.insertMany([
  { zone: 'Захід', area: { type: 'Polygon', coordinates: [[ [25.28, 50.71], [25.345, 50.71], [25.345, 50.77], [25.28, 50.77], [25.28, 50.71] ]] } },
  { zone: 'Схід',  area: { type: 'Polygon', coordinates: [[ [25.345, 50.71], [25.41, 50.71], [25.41, 50.77], [25.345, 50.77], [25.345, 50.71] ]] } }
]);
db.zones.createIndex({ area: '2dsphere' });
rows(db.zones.find({ area: { $geoIntersects: { $geometry: db.users.findOne({ username: 'iryna_savchuk' }).location } } },
                   { _id: 0, zone: 1 }));

h('План $near: GEO_NEAR_2DSPHERE через індекс');
printjson(planSummary(db.branches.find({ location: { $near: { $geometry: me, $maxDistance: 2000 } } }).explain('executionStats')));

// ---------------------------------------------------------------------
h('TTL-індекси: сесії читачів живуть 60 с, бронювання - до expire_at');
db.sessions.drop(); db.reservations.drop();
print('  ' + db.sessions.createIndex({ created_at: 1 }, { expireAfterSeconds: 60 }));
print('  ' + db.reservations.createIndex({ expire_at: 1 }, { expireAfterSeconds: 0 }));
const now = new Date();
db.sessions.insertMany([
  { user: 'ivan_petrov',   created_at: new Date(now - 2 * 3600 * 1000) },   // стара, має бути видалена
  { user: 'anna_melnyk',   created_at: new Date(now - 10 * 60 * 1000) },    // стара
  { user: 'iryna_savchuk', created_at: new Date(now.getTime() + 3600 * 1000) } // "майбутня" - залишиться
]);
db.reservations.insertMany([
  { user: 'olena_tkachuk', book: 'Земля',    expire_at: new Date(now - 1000) },
  { user: 'taras_hnatiuk', book: 'Тигролови', expire_at: new Date(now.getTime() + 3 * 24 * 3600 * 1000) }
]);
print('  ' + now.toTimeString().slice(0, 8) + ' sessions=' + db.sessions.countDocuments() +
      ', reservations=' + db.reservations.countDocuments());
print('  очікування фонового процесу TTL (запускається раз на 60 с)...');
let waited = 0;
while (waited < 130 && (db.sessions.countDocuments() > 1 || db.reservations.countDocuments() > 1)) { sleep(5000); waited += 5; }
print('  ' + new Date().toTimeString().slice(0, 8) + ' sessions=' + db.sessions.countDocuments() +
      ', reservations=' + db.reservations.countDocuments() + ' (через ' + waited + ' с)');
rows(db.sessions.find({}, { _id: 0 }));
rows(db.reservations.find({}, { _id: 0 }));
