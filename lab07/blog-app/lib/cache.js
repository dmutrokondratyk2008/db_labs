// =====================================================================
// Лабораторна робота 7. blog-app/lib/cache.js
// Рівень 3, завдання 7. Кеш популярних запитів у пам'яті процесу:
//   - TTL (час життя запису) для кожного ключа;
//   - LRU-витіснення при перевищенні maxEntries;
//   - теги для інвалідації: запис стрічки має тег "posts", статистика - "stats";
//     після зміни даних інвалідуються всі записи з відповідним тегом;
//   - статистика hit/miss і середній час відповіді з кешу та без нього.
// Стратегія cache-aside: застосунок спершу шукає в кеші, а за промаху
// виконує запит до MongoDB і кладе результат у кеш.
// =====================================================================

class QueryCache {
  constructor({ maxEntries = 500, defaultTtlMs = 30000 } = {}) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.map = new Map();                  // key -> { value, expires, tags, hits }
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0, expired: 0, invalidations: 0,
                   hitTimeMs: 0, missTimeMs: 0 };
  }

  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires < Date.now()) { this.map.delete(key); this.stats.expired++; return undefined; }
    this.map.delete(key); this.map.set(key, e);  // оновлення позиції для LRU
    e.hits++;
    return e.value;
  }

  set(key, value, { ttlMs, tags = [] } = {}) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + (ttlMs || this.defaultTtlMs), tags, hits: 0, created: Date.now() });
    this.stats.sets++;
    while (this.map.size > this.maxEntries) {      // найдавніше використаний запис - перший у Map
      this.map.delete(this.map.keys().next().value);
      this.stats.evictions++;
    }
  }

  invalidate(...tags) {
    let n = 0;
    for (const [k, e] of this.map) if (e.tags.some(t => tags.includes(t))) { this.map.delete(k); n++; }
    this.stats.invalidations += n;
    return n;
  }

  clear() { const n = this.map.size; this.map.clear(); return n; }

  report() {
    const s = this.stats, total = s.hits + s.misses;
    const top = [...this.map.entries()].sort((a, b) => b[1].hits - a[1].hits).slice(0, 10)
      .map(([key, e]) => ({ key, hits: e.hits, ttl_left_s: Math.max(0, Math.round((e.expires - Date.now()) / 1000)), tags: e.tags }));
    return {
      entries: this.map.size, max_entries: this.maxEntries,
      hits: s.hits, misses: s.misses, hit_ratio: total ? Math.round(s.hits / total * 1000) / 10 : 0,
      sets: s.sets, evictions: s.evictions, expired: s.expired, invalidations: s.invalidations,
      avg_hit_ms: s.hits ? Math.round(s.hitTimeMs / s.hits * 1000) / 1000 : null,
      avg_miss_ms: s.misses ? Math.round(s.missTimeMs / s.misses * 1000) / 1000 : null,
      top_keys: top
    };
  }

  // Express-middleware: кешує JSON-відповідь GET-запиту за повним URL
  middleware({ ttlMs, tags }) {
    return (req, res, next) => {
      if (req.method !== 'GET' || req.query.nocache === '1') return next();
      const started = process.hrtime.bigint();
      const key = req.originalUrl.replace(/([?&])nocache=[^&]*/, '$1');
      const hit = this.get(key);
      if (hit !== undefined) {
        this.stats.hits++;
        this.stats.hitTimeMs += Number(process.hrtime.bigint() - started) / 1e6;
        res.set('X-Cache', 'HIT');
        return res.json(hit);
      }
      this.stats.misses++;
      res.set('X-Cache', 'MISS');
      const json = res.json.bind(res);
      res.json = body => {
        if (res.statusCode === 200) this.set(key, body, { ttlMs, tags: typeof tags === 'function' ? tags(req) : tags });
        this.stats.missTimeMs += Number(process.hrtime.bigint() - started) / 1e6;
        return json(body);
      };
      next();
    };
  }
}

module.exports = { QueryCache };
