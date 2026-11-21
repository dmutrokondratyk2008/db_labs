// =====================================================================
// Лабораторна робота 6. 06_index_benchmark.js
// Порівняння швидкості трьох запитів до books_bench (300 000 док.)
// без індексів (COLLSCAN) і з індексами (IXSCAN).
// Для кожного запиту: план, кількість переглянутих ключів і документів,
// executionTimeMillis з explain і середній час 5 повторів з клієнта.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');
const c = db.books_bench;

const queries = [
  { name: 'Q1 автор = ...',      run: () => c.find({ author: 'Тарас Шевчук-7' }) },
  { name: 'Q2 isbn = ...',       run: () => c.find({ isbn: '978-617-0150000-0' }) },
  { name: 'Q3 рік>=2020, сорт.', run: () => c.find({ publication_year: { $gte: 2020 } }).sort({ publication_year: -1, pages: -1 }).limit(20) }
];

function measure(stage) {
  h('Етап: ' + stage);
  return queries.map(qr => {
    qr.run().toArray();                                  // прогрів кешу
    const ex = planSummary(qr.run().explain('executionStats'));
    const runs = 5, t0 = Date.now();
    for (let i = 0; i < runs; i++) qr.run().toArray();
    const avg = (Date.now() - t0) / runs;
    print('  ' + qr.name.padEnd(20) + ' ' + ex.plan);
    print('  ' + ''.padEnd(20) + ' returned=' + ex.returned + ' keys=' + ex.keysExamined +
          ' docs=' + ex.docsExamined + ' explain=' + ex.timeMs + ' мс, середнє=' + avg.toFixed(1) + ' мс');
    return { name: qr.name, docs: ex.docsExamined, ms: avg };
  });
}

h('Видалення індексів books_bench (крім _id)');
c.dropIndexes();
print('  індекси: ' + c.getIndexes().map(i => i.name).join(', '));
const before = measure('без індексів');

h('Створення індексів');
let t0 = Date.now();
print('  ' + c.createIndex({ author: 1 }) + '  ' + (Date.now() - t0) + ' мс');
t0 = Date.now();
print('  ' + c.createIndex({ isbn: 1 }, { unique: true }) + '  ' + (Date.now() - t0) + ' мс');
t0 = Date.now();
print('  ' + c.createIndex({ publication_year: -1, pages: -1 }) + '  ' + (Date.now() - t0) + ' мс');
const after = measure('з індексами');

h('Порівняння');
print('  запит                 docs до -> після      час до -> після     прискорення');
before.forEach((b, i) => {
  const a = after[i];
  print('  ' + b.name.padEnd(20) + String(b.docs).padStart(8) + ' -> ' + String(a.docs).padEnd(6) +
        String(b.ms.toFixed(1)).padStart(10) + ' -> ' + (a.ms.toFixed(1) + ' мс').padEnd(9) +
        ('x' + (b.ms / Math.max(a.ms, 0.1)).toFixed(0)).padStart(8));
});
const s = c.stats({ indexDetails: false });
h('Розмір індексів');
Object.entries(s.indexSizes).forEach(([k, v]) => print('  ' + k.padEnd(30) + (v / 1048576).toFixed(1) + ' МБ'));
