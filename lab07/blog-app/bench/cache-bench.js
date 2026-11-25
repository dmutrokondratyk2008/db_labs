// =====================================================================
// Лабораторна робота 7. bench/cache-bench.js
// Рівень 3, завдання 7. Вимірювання ефекту кешування популярних запитів.
// Для кожного маршруту 300 запитів без кешу (?nocache=1) і 300 з кешу.
// Запуск при працюючому сервері: node bench/cache-bench.js
// =====================================================================
const BASE = process.env.API || 'http://localhost:3000/api';
const N = Number(process.env.N) || 300;

const routes = [
  ['/posts?page=1&limit=9', 'Головна стрічка ($facet)'],
  ['/posts?q=mongodb', 'Повнотекстовий пошук'],
  ['/posts?tags=mongodb,nosql&tag_mode=all', 'Пошук за тегами ($all)'],
  ['/stats/overview', 'Загальна статистика'],
  ['/stats/top-authors', 'Топ-10 авторів'],
  ['/stats/categories', 'Популярні категорії ($lookup)'],
  ['/stats/comments', 'Статистика коментарів ($facet)'],
  ['/stats/views-daily?days=30', 'Перегляди за 30 днів (бакети)']
];

async function measure(url) {
  const t = [];
  for (let i = 0; i < N; i++) {
    const s = process.hrtime.bigint();
    const r = await fetch(BASE + url);
    await r.arrayBuffer();
    t.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  t.sort((a, b) => a - b);
  return { median: t[Math.floor(N / 2)], p95: t[Math.floor(N * 0.95)], rps: 1000 / (t.reduce((a, b) => a + b, 0) / N) };
}
const f = x => x.toFixed(2);

(async () => {
  await fetch(BASE + '/cache', { method: 'DELETE' });
  console.log(`Кешування: ${N} послідовних HTTP-запитів на маршрут, час від запиту до повного отримання відповіді (мс)\n`);
  const rows = [];
  for (const [url, name] of routes) {
    for (let i = 0; i < 20; i++) await (await fetch(BASE + url + (url.includes('?') ? '&' : '?') + 'nocache=1')).arrayBuffer(); // прогрів
    const miss = await measure(url + (url.includes('?') ? '&' : '?') + 'nocache=1');
    await (await fetch(BASE + url)).arrayBuffer();                 // заповнення кешу
    const hit = await measure(url);
    rows.push({ name, miss, hit });
  }
  const w = Math.max(...rows.map(r => r.name.length));
  console.log('Запит'.padEnd(w) + ' | без кешу: медіана  p95   зап/с | з кешу: медіана  p95   зап/с | прискорення');
  console.log('-'.repeat(w) + '-+-' + '-'.repeat(32) + '+-' + '-'.repeat(30) + '+------------');
  rows.forEach(({ name, miss, hit }) => console.log(
    name.padEnd(w) + ' | ' + f(miss.median).padStart(16) + f(miss.p95).padStart(6) + Math.round(miss.rps).toString().padStart(8) +
    ' | ' + f(hit.median).padStart(14) + f(hit.p95).padStart(6) + Math.round(hit.rps).toString().padStart(8) +
    ' | ' + (miss.median / hit.median).toFixed(1).padStart(6) + ' разів'));
  const c = await (await fetch(BASE + '/cache/stats')).json();
  console.log(`\nСтатистика кешу на сервері: записів ${c.entries}, hit ${c.hits}, miss ${c.misses}, hit ratio ${c.hit_ratio}%,`);
  console.log(`середній час обробки на сервері: з кешу ${c.avg_hit_ms} мс, із запитом до MongoDB ${c.avg_miss_ms} мс`);
})();
