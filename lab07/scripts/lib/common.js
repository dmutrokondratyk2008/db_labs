// =====================================================================
// Лабораторна робота 7. lib/common.js
// Допоміжні функції виведення для скриптів mongosh: заголовки кроків
// і компактний вивід документів (один документ - один рядок).
// =====================================================================

// Заголовок розділу
globalThis.h = function (title) {
  print('\n=== ' + title + ' ===');
};

// Підзаголовок з текстом команди
globalThis.q = function (text) {
  print('\n> ' + text);
};

// Перетворення значення в короткий рядок: ObjectId -> останні 6 символів,
// дати -> YYYY-MM-DD, рядки без лапок усередині масивів не змінюємо
function fmt(v) {
  if (v === null || v === undefined) return String(v);
  if (v instanceof ObjectId) return 'oid..' + v.toHexString().slice(-6);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return '[' + v.map(fmt).join(', ') + ']';
  if (typeof v === 'object') {
    if (v._bsontype === 'Decimal128' || v._bsontype === 'Long' || v._bsontype === 'Int32' || v._bsontype === 'Double') return v.toString();
    return '{' + Object.keys(v).map(k => k + ': ' + fmt(v[k])).join(', ') + '}';
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return String(v);
}
globalThis.fmt = fmt;

// Виведення курсора або масиву: кожен документ одним рядком
globalThis.rows = function (data, limit) {
  const arr = Array.isArray(data) ? data : data.toArray();
  const shown = limit ? arr.slice(0, limit) : arr;
  shown.forEach(d => print('  ' + fmt(d)));
  print('  (' + arr.length + ' док.' + (limit && arr.length > limit ? ', показано ' + limit : '') + ')');
  return arr.length;
};

// Виведення результату операції запису без зайвих полів
globalThis.res = function (r) {
  const o = {};
  ['acknowledged', 'insertedId', 'insertedIds', 'matchedCount', 'modifiedCount', 'deletedCount', 'upsertedId']
    .forEach(k => { if (r[k] !== undefined && r[k] !== null) o[k] = r[k]; });
  if (o.insertedIds) o.insertedIds = Object.keys(o.insertedIds).length + ' шт.';
  print('  ' + fmt(o));
  return r;
};

// Короткий підсумок explain("executionStats") для find або aggregate
globalThis.planSummary = function (explain) {
  const qp = explain.queryPlanner || (explain.stages && explain.stages[0].$cursor.queryPlanner);
  const es = explain.executionStats || (explain.stages && explain.stages[0].$cursor.executionStats);
  const stages = [];
  (function walk(p) {
    if (!p) return;
    let s = p.stage;
    if (p.indexName) s += '(' + p.indexName + ')';
    stages.push(s);
    walk(p.inputStage);
    (p.inputStages || []).forEach(walk);
  })(qp.winningPlan.queryPlan || qp.winningPlan);
  return {
    plan: stages.join(' <- '),
    returned: es.nReturned,
    keysExamined: es.totalKeysExamined,
    docsExamined: es.totalDocsExamined,
    timeMs: es.executionTimeMillis
  };
};

// Компактний printjson: результат команди одним рядком ({ok: 1} тощо)
globalThis.printjson = function (x) { print('  ' + fmt(x)); };

// Назва коду помилки сервера (для WriteError mongosh не завжди заповнює codeName)
globalThis.cn = function (e) {
  const known = { 121: 'DocumentValidationFailure', 11000: 'DuplicateKey', 166: 'CommandNotSupportedOnView',
                  10107: 'NotWritablePrimary', 112: 'WriteConflict' };
  return e.codeName || (e.errorResponse && e.errorResponse.codeName) || known[e.code] || e.name;
};

// ---------------------------------------------------------------------
// Додаткові функції ЛР7
// ---------------------------------------------------------------------

// Детермінований генератор псевдовипадкових чисел (mulberry32):
// однаковий seed дає однакові дані при кожному запуску скрипта
globalThis.makeRng = function (seed) {
  let a = seed >>> 0;
  const rnd = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rnd.int = (min, max) => min + Math.floor(rnd() * (max - min + 1)); // [min, max]
  rnd.pick = arr => arr[Math.floor(rnd() * arr.length)];
  rnd.sample = (arr, k) => {                                          // k різних елементів
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, k);
  };
  return rnd;
};

// Транслітерація українського тексту латиницею (за постановою КМУ № 55 від 2010 р.)
// і перетворення на slug: малі латинські літери, цифри, дефіси
globalThis.slugify = function (text) {
  const map = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ie', 'ж': 'zh',
    'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh',
    'щ': 'shch', 'ь': '', 'ю': 'iu', 'я': 'ia', "'": '', '’': '' };
  const first = { 'є': 'ye', 'ї': 'yi', 'й': 'y', 'ю': 'yu', 'я': 'ya' };   // на початку слова
  const lower = text.toLowerCase().replace(/зг/g, 'zgh');
  let out = '';
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    const startOfWord = i === 0 || !/[а-яґєії']/.test(lower[i - 1]);
    if (startOfWord && first[ch]) out += first[ch];
    else if (map[ch] !== undefined) out += map[ch];
    else out += ch;
  }
  return out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
};

// Час виконання функції в мілісекундах (медіана з n запусків)
globalThis.timeIt = function (fn, n) {
  n = n || 20;
  const t = [];
  for (let i = 0; i < n; i++) { const s = Date.now(); fn(); t.push(Date.now() - s); }
  t.sort((a, b) => a - b);
  return t[Math.floor(n / 2)];
};

// Таблиця з масиву об'єктів: заголовок і вирівняні колонки
globalThis.table = function (arr, cols) {
  if (!arr.length) { print('  (порожньо)'); return 0; }
  cols = cols || Object.keys(arr[0]);
  const cell = v => (typeof v === 'string' ? v : fmt(v));
  const w = cols.map(c => Math.max(c.length, ...arr.map(r => cell(r[c]).length)));
  const line = vals => '  ' + vals.map((v, i) => v.padEnd(w[i])).join(' | ');
  print(line(cols));
  print('  ' + w.map(x => '-'.repeat(x)).join('-+-'));
  arr.forEach(r => print(line(cols.map(c => cell(r[c])))));
  print('  (' + arr.length + ' рядк.)');
  return arr.length;
};
