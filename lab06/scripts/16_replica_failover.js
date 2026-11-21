// =====================================================================
// Лабораторна робота 6. 16_replica_failover.js
// Перевірка автоматичного перемикання (failover). Запускається двічі:
//   stage = 'down'   - після аварійного завершення PRIMARY (27018):
//                      вибори нового PRIMARY, запис без втрат;
//   stage = 'rejoin' - після повторного запуску вузла 27018: він
//                      наздоганяє зміни і, маючи priority 2, знову
//                      стає PRIMARY.
// Запуск: mongosh "<URI набору>" --quiet --eval "var stage='down'" --file ...
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');

function status() {
  rs.status().members.forEach(m => print('  ' + m.name.padEnd(17) + m.stateStr.padEnd(25) +
    (m.health ? 'optime=' + m.optimeDate.toTimeString().slice(0, 8) : 'недоступний') +
    (m.electionDate && m.stateStr === 'PRIMARY' ? '  обрано ' + m.electionDate.toTimeString().slice(0, 8) : '')));
}
function waitPrimary(expectHost, sec) {
  const t0 = Date.now();
  while (Date.now() - t0 < sec * 1000) {
    try {
      const p = rs.status().members.find(m => m.stateStr === 'PRIMARY');
      if (p && (!expectHost || p.name === expectHost)) return { host: p.name, waited: Date.now() - t0 };
    } catch (e) {}
    sleep(500);
  }
  return null;
}

if (stage === 'down') {
  h('Після збою вузла localhost:27018');
  const p = waitPrimary(null, 60);
  print('  новий PRIMARY: ' + p.host);
  status();

  h('Запис під час недоступності вузла (w: majority = 2 з 3 вузлів, доступні 2)');
  for (let i = 1; i <= 3; i++) {
    res(db.users.insertOne({ username: 'failover_reader_' + i, email: 'failover' + i + '@example.com', status: 'active',
                             registration_date: new Date(), borrowed_books: [] }, { writeConcern: { w: 'majority' } }));
  }
  print('  users: ' + db.users.countDocuments());
} else {
  h('Після повторного запуску вузла localhost:27018');
  const p = waitPrimary('localhost:27018', 90);
  print('  PRIMARY: ' + (p ? p.host + ' (через ' + p.waited + ' мс, priority 2 повертає лідерство)' : 'не змінився'));
  status();

  h('Вузол 27018 отримав зміни, зроблені без нього');
  const d = new Mongo('mongodb://localhost:27018/?directConnection=true').getDB('library');
  rows(d.users.find({ username: /^failover_reader_/ }, { _id: 0, username: 1, registration_date: 1 }).sort({ username: 1 }));
  print('  users на 27018: ' + d.users.countDocuments() + ', на PRIMARY: ' + db.users.countDocuments());
}
