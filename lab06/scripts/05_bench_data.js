// =====================================================================
// Лабораторна робота 6. 05_bench_data.js
// Тестова колекція books_bench (300 000 документів зі структурою books)
// для порівняння швидкості запитів з індексами і без них.
// На 12 документах колекції books різниці не видно: повне сканування
// і так займає 0 мс.
// =====================================================================
load(__dirname + '/lib/common.js');
db = db.getSiblingDB('library');

const N = 300000, BATCH = 10000;
const first = ['Олександр','Андрій','Сергій','Дмитро','Максим','Іван','Богдан','Тарас','Юрій','Віктор',
               'Олена','Ірина','Наталія','Оксана','Юлія','Тетяна','Марія','Анна','Світлана','Катерина'];
const last  = ['Бондаренко','Мельничук','Ковальчук','Савчук','Гнатюк','Ткачук','Поліщук','Кравчук','Олійник','Шевчук',
               'Лисенко','Романюк','Мороз','Бойко','Коваленко','Марчук','Остапчук','Петрук','Семенюк','Федорук'];
const genres = ['роман','повість','новела','поезія','драма','реалізм','романтизм','модернізм','історична проза',
                'пригоди','фантастика','детектив','містика','мемуари','публіцистика'];
const cities = ['Київ','Харків','Львів','Луцьк','Тернопіль','Чернівці'];
const words = ['кохання','війна','село','місто','Карпати','степ','море','родина','пам\'ять','доля','воля','дорога'];

// Детермінований генератор псевдовипадкових чисел (mulberry32), щоб дані були відтворюваними
let seed = 2026;
function rnd() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick(a) { return a[Math.floor(rnd() * a.length)]; }

db.books_bench.drop();
h('Генерація ' + N + ' документів');
const t0 = Date.now();
for (let b = 0; b < N / BATCH; b++) {
  const docs = [];
  for (let i = 1; i <= BATCH; i++) {
    const n = b * BATCH + i;
    const g = [pick(genres)];
    if (rnd() < 0.6) g.push(pick(genres));
    if (rnd() < 0.3) g.push(pick(genres));
    docs.push({
      title: 'Книга ' + n + ': ' + pick(words) + ' і ' + pick(words),
      author: pick(first) + ' ' + pick(last) + '-' + (1 + Math.floor(rnd() * 25)),   // 10 000 авторів
      publication_year: 1800 + Math.floor(rnd() * 227),
      pages: 40 + Math.floor(rnd() * 900),
      isbn: '978-617-' + String(n).padStart(7, '0') + '-' + (n % 10),
      genres: [...new Set(g)],
      available: rnd() < 0.7,
      publisher: { name: 'Видавництво ' + (1 + Math.floor(rnd() * 40)), city: pick(cities) },
      rating: Math.round((1 + rnd() * 4) * 10) / 10
    });
  }
  db.books_bench.insertMany(docs, { ordered: false });
}
print('  вставлено ' + db.books_bench.countDocuments() + ' док. за ' + ((Date.now() - t0) / 1000).toFixed(1) + ' с');
print('  розмір даних (BSON): ' + (db.books_bench.stats().size / 1048576).toFixed(1) + ' МБ');
printjson(db.books_bench.findOne({}, { _id: 0 }));
