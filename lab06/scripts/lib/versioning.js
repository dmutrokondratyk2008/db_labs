// =====================================================================
// Лабораторна робота 6. lib/versioning.js
// Система версіонування документів books зі збереженням історії змін.
//
// Схема:
//   books.version            - номер поточної версії (int)
//   books.updated_at / _by   - час і автор останньої зміни
//   books_history            - знімок документа ДО кожної зміни:
//     { book_id, version, op, snapshot, changes[{field, old, new}],
//       changed_at, changed_by, comment }
//   Унікальний індекс (book_id, version) у books_history гарантує, що
//   два клієнти не зможуть зберегти зміну однієї й тієї самої версії:
//   другий отримає помилку E11000 (оптимістичне блокування).
//
// Функції приймають необов'язковий параметр session: у replica set їх
// можна виконати в транзакції, тоді запис історії і зміна документа
// атомарні (див. 15_replica_set.js).
// =====================================================================

globalThis.Versioning = (function () {
  function dbOf(session) { return session ? session.getDatabase('library') : db.getSiblingDB('library'); }
  const SKIP = ['_id', 'version', 'updated_at', 'updated_by'];

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // Ініціалізація: версія 1 для всіх книг, індекси історії
  function init() {
    const d = dbOf();
    const r = d.books.updateMany({ version: { $exists: false } },
      { $set: { version: 1, updated_at: new Date(), updated_by: 'init' } });
    d.books_history.createIndex({ book_id: 1, version: 1 }, { unique: true, name: 'book_version_unique' });
    d.books_history.createIndex({ changed_at: -1 });
    return r.modifiedCount;
  }

  // Зміна полів книги з записом попередньої версії в історію.
  // expectedVersion - версія, яку бачив клієнт (для перевірки конфлікту)
  function update(filter, setFields, user, comment, expectedVersion, session) {
    const d = dbOf(session);
    const cur = d.books.findOne(filter);
    if (!cur) throw new Error('Книгу не знайдено: ' + JSON.stringify(filter));
    const v = expectedVersion === undefined ? cur.version : expectedVersion;
    if (cur.version !== v) throw new Error('Конфлікт версій: очікувалась v' + v + ', у базі v' + cur.version);

    // значення undefined означає видалення поля ($unset)
    const changes = Object.keys(setFields)
      .filter(k => !same(cur[k], setFields[k]))
      .map(k => ({ field: k, old: cur[k] === undefined ? null : cur[k],
                   new: setFields[k] === undefined ? null : setFields[k] }));
    if (changes.length === 0) return { version: cur.version, changed: 0 };

    const snapshot = Object.assign({}, cur); delete snapshot._id;
    // 1) знімок попередньої версії; дубль (book_id, version) = хтось уже змінив цю версію
    d.books_history.insertOne({ book_id: cur._id, version: cur.version, op: 'update', snapshot,
                                changes, changed_at: new Date(), changed_by: user, comment });
    // 2) зміна документа лише якщо версія не змінилася з моменту читання
    const $set = { updated_at: new Date(), updated_by: user }, $unset = {};
    changes.forEach(c => { if (setFields[c.field] === undefined) $unset[c.field] = ''; else $set[c.field] = setFields[c.field]; });
    const upd = { $set, $inc: { version: 1 } };
    if (Object.keys($unset).length) upd.$unset = $unset;
    const r = d.books.updateOne({ _id: cur._id, version: cur.version }, upd);
    if (r.modifiedCount !== 1) {
      d.books_history.deleteOne({ book_id: cur._id, version: cur.version });   // компенсація
      throw new Error('Конфлікт версій під час запису');
    }
    return { version: cur.version + 1, changed: changes.length };
  }

  // Історія змін книги
  function history(title) {
    const d = dbOf();
    const b = d.books.findOne({ title }) || d.books_history.findOne({ 'snapshot.title': title }, { book_id: 1 });
    const id = b.book_id || b._id;
    return d.books_history.find({ book_id: id }, { _id: 0, version: 1, op: 1, changed_at: 1, changed_by: 1, comment: 1, changes: 1 })
            .sort({ version: 1 }).toArray();
  }

  // Стан книги на момент версії v (поточна версія береться з books)
  function getVersion(title, v) {
    const d = dbOf();
    const cur = d.books.findOne({ title });
    if (cur && cur.version === v) return cur;
    const h = d.books_history.findOne({ book_id: cur._id, version: v });
    return h ? h.snapshot : null;
  }

  // Відкат до версії v: старий стан записується як НОВА версія,
  // тобто історія не втрачається
  function rollback(title, v, user) {
    const d = dbOf();
    const old = getVersion(title, v);
    if (!old) throw new Error('Версії v' + v + ' немає');
    const cur = d.books.findOne({ title });
    const fields = {};
    Object.keys(Object.assign({}, old, cur)).filter(k => !SKIP.includes(k)).forEach(k => {
      if (!same(old[k], cur[k])) fields[k] = old[k];
    });
    return update({ _id: cur._id }, fields, user, 'відкат до v' + v, cur.version);
  }

  // Видалення з повним знімком в історії і відновлення видаленої книги
  function remove(title, user, comment) {
    const d = dbOf();
    const cur = d.books.findOne({ title });
    const snapshot = Object.assign({}, cur); delete snapshot._id;
    d.books_history.insertOne({ book_id: cur._id, version: cur.version, op: 'delete', snapshot,
                                changes: [], changed_at: new Date(), changed_by: user, comment });
    return d.books.deleteOne({ _id: cur._id, version: cur.version }).deletedCount;
  }
  function restore(title, user) {
    const d = dbOf();
    const h = d.books_history.find({ 'snapshot.title': title, op: 'delete' }).sort({ changed_at: -1 }).limit(1).toArray()[0];
    const doc = Object.assign({ _id: h.book_id }, h.snapshot,
                              { version: h.version + 1, updated_at: new Date(), updated_by: user });
    d.books.insertOne(doc);
    d.books_history.updateOne({ _id: h._id }, { $set: { restored_at: new Date(), restored_by: user } });
    return doc.version;
  }

  return { init, update, history, getVersion, rollback, remove, restore };
})();
