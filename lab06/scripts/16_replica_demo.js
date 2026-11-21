// =====================================================================
// Лабораторна робота 6. 16_replica_demo.js
// Робота з набором реплік rs0: копіювання даних, запис з
// writeConcern majority, читання з вторинних вузлів, заборона запису
// на SECONDARY, транзакція (версіонування + видача книги), change stream,
// журнал операцій oplog.
// Запуск: mongosh "mongodb://localhost:27018,localhost:27019,localhost:27020/library?replicaSet=rs0"
//                 --quiet --file scripts/16_replica_demo.js
// =====================================================================
load(__dirname + '/lib/common.js');
load(__dirname + '/lib/versioning.js');
db = db.getSiblingDB('library');

function status() {
  rs.status().members.forEach(m => print('  ' + m.name.padEnd(17) + m.stateStr.padEnd(11) +
    'optime=' + m.optimeDate.toTimeString().slice(0, 8) + (m.syncSourceHost ? '  sync from ' + m.syncSourceHost : '')));
}
function node(port) {
  return new Mongo('mongodb://localhost:' + port + '/?directConnection=true&readPreference=secondaryPreferred').getDB('library');
}

h('Стан набору реплік');
status();
print('  підключення до PRIMARY: ' + db.hello().primary + ', набір ' + db.hello().setName);

h('Дані library, відновлені з mongodump, на кожному вузлі');
[27018, 27019, 27020].forEach(p => {
  const d = node(p);
  print('  ' + p + ' ' + d.hello().isWritablePrimary.toString().padEnd(6) +
        ['authors', 'books', 'users', 'books_bench'].map(c => c + '=' + d[c].estimatedDocumentCount()).join(' '));
});

h('Запис з writeConcern majority (підтвердження від 2 з 3 вузлів)');
const t0 = Date.now();
res(db.users.insertOne({ username: 'replica_reader', full_name: 'Читач Репліки', email: 'replica@example.com',
                         status: 'active', registration_date: new Date(), borrowed_books: [] },
                       { writeConcern: { w: 'majority', wtimeout: 5000 } }));
print('  час підтвердження: ' + (Date.now() - t0) + ' мс');

h('Читання нового документа з кожного вторинного вузла');
[27019, 27020].forEach(p => {
  const d = node(p);
  const u = d.users.findOne({ username: 'replica_reader' }, { _id: 0, username: 1, email: 1 });
  print('  ' + p + ' (' + (d.hello().secondary ? 'SECONDARY' : 'PRIMARY') + '): ' + fmt(u));
});

h('Запис на SECONDARY заборонено');
try { node(27019).users.insertOne({ username: 'x', email: 'x@example.com', status: 'active', registration_date: new Date() }); }
catch (e) { print('  ' + cn(e) + ' (' + e.code + '): ' + e.message); }

h('readPreference: secondary для звітів');
const rep = new Mongo('mongodb://localhost:27018,localhost:27019,localhost:27020/?replicaSet=rs0&readPreference=secondary').getDB('library');
const ex = rep.books.find({ available: true }).explain();
print('  звіт виконано на вузлі ' + ex.serverInfo.host + ':' + ex.serverInfo.port +
      ', доступних книг ' + rep.books.countDocuments({ available: true }));

h('Транзакція: видача книги = зміна книги з версією + картка читача + історія');
const s = db.getMongo().startSession();
const sd = s.getDatabase('library');
s.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
try {
  const r = Versioning.update({ title: 'Тигролови' }, { available: false }, 'librarian_olha', 'видано replica_reader', undefined, s);
  sd.users.updateOne({ username: 'replica_reader' }, { $push: { borrowed_books: 'Тигролови' } });
  s.commitTransaction();
  print('  COMMIT: книга v' + r.version + ', у читача: ' + db.users.findOne({ username: 'replica_reader' }).borrowed_books);
} catch (e) { s.abortTransaction(); print('  ABORT: ' + e.message); }

h('Транзакція з помилкою відкочується повністю');
s.startTransaction();
try {
  sd.users.updateOne({ username: 'replica_reader' }, { $push: { borrowed_books: 'Земля' } });
  sd.books.updateOne({ title: 'Земля' }, { $set: { pages: -1 } });     // порушує JSON Schema
  s.commitTransaction();
} catch (e) {
  s.abortTransaction();
  print('  ABORT: ' + cn(e) + '; у читача: ' + db.users.findOne({ username: 'replica_reader' }).borrowed_books);
}
s.endSession();

h('Change stream: автоматичне оновлення search_terms при зміні книги');
load(__dirname + '/lib/uk_stemmer.js');
const cs = db.books.watch([{ $match: { operationType: { $in: ['insert', 'update'] },
                                       'updateDescription.updatedFields.search_terms': { $exists: false } } }],
                          { fullDocument: 'updateLookup' });
db.books.updateOne({ title: 'Царівна' }, { $set: { description: 'Роман про становлення жінки-письменниці на Буковині' } });
let ev = null;
for (let i = 0; i < 20 && !ev; i++) ev = cs.tryNext();
print('  подія: ' + ev.operationType + ' ' + ev.ns.coll + ' "' + ev.fullDocument.title + '", змінено: ' +
      Object.keys(ev.updateDescription.updatedFields).join(','));
db.books.updateOne({ _id: ev.documentKey._id }, { $set: { search_terms: UkStem.terms(ev.fullDocument.title,
  ev.fullDocument.author, ev.fullDocument.description, ev.fullDocument.genres) } });
cs.close();
print('  search_terms: ' + db.books.findOne({ title: 'Царівна' }).search_terms.join(' '));

h('Oplog: останні операції над library (вони реплікуються на SECONDARY)');
const ol = db.getSiblingDB('local').oplog.rs;
ol.find({ ns: /^library\.(books|users)$/ }).sort({ $natural: -1 }).limit(5).forEach(o =>
  print('  ' + o.wall.toTimeString().slice(0, 8) + ' op=' + o.op + ' ' + o.ns.padEnd(14) +
        '_id=' + fmt(o.o2 ? o.o2._id : o.o._id)));
const st = ol.stats();
print('  розмір oplog: ' + (st.maxSize / 1048576).toFixed(0) + ' МБ, записів ' + st.count);

h('Стан після операцій (вторинні вузли наздогнали PRIMARY)');
sleep(2500);
status();
