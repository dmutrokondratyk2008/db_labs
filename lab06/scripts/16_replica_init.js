// =====================================================================
// Лабораторна робота 6. 16_replica_init.js
// Ініціалізація набору реплік rs0 з трьох вузлів.
// Запуск: mongosh --port 27018 --quiet --file scripts/16_replica_init.js
// =====================================================================
load(__dirname + '/lib/common.js');

h('rs.initiate: 3 вузли, вузол 27018 має вищий пріоритет');
let st;
try { st = rs.status(); } catch (e) { st = null; }
if (!st || !st.ok) {
  const r = (rs.initiate({
    _id: 'rs0',
    members: [
      { _id: 0, host: 'localhost:27018', priority: 2 },
      { _id: 1, host: 'localhost:27019', priority: 1 },
      { _id: 2, host: 'localhost:27020', priority: 1 }
    ]
  })); print('  ok: ' + r.ok);
} else print('  набір реплік уже ініціалізовано');

h('Очікування виборів PRIMARY');
for (let i = 0; i < 60; i++) {
  const s = rs.status();
  if (s.members.filter(m => m.stateStr === 'PRIMARY').length === 1 &&
      s.members.filter(m => m.stateStr === 'SECONDARY').length === 2) break;
  sleep(1000);
}
rs.status().members.forEach(m => print('  ' + m.name.padEnd(17) + m.stateStr.padEnd(10) + 'health=' + m.health));
const cfg = rs.conf();
print('  конфігурація v' + cfg.version + ', writeConcernMajorityJournalDefault=' + cfg.writeConcernMajorityJournalDefault);
