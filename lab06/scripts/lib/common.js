// =====================================================================
// Лабораторна робота 6. lib/common.js
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
