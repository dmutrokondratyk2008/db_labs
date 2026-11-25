# Лабораторна робота 7. Повний цикл розробки NoSQL застосунку з інтеграцією

Блог-система на MongoDB 9.0: документна схема з валідацією `$jsonSchema`, реалістичні дані
(20 користувачів, 10 категорій, 30 тегів, 60 постів, 355 коментарів), агрегації, індекси,
теги, повнотекстовий пошук, рейтинги, пагінація через `$facet`, перегляди (патерн Bucket),
модерація, версіонування, вкладені коментарі, сповіщення, геопошук, вебзастосунок на Express
з RESTful API, кешем і аналітичною панеллю, порівняння з PostgreSQL 17 на 20 000 постів.

**Звіт:** [lab07-report.md](lab07-report.md)

## Структура

```
lab07/
├── README.md
├── lab07-report.md            звіт
├── run-all.ps1                повний прогін усіх кроків, вивід -> results/
├── results/                   вивід кожного скрипта (текст)
├── scripts/                   скрипти mongosh у порядку виконання (01-15)
│   └── lib/                   common.js (вивід), seed_data.js (довідники), blog.js (операції блогу)
├── sql/                       реляційна модель PostgreSQL: схема, завантаження, запити
├── blog-app/                  вебзастосунок Node.js + Express
│   ├── server.js              REST API, статичні сторінки, кеш
│   ├── lib/blog.js            сервісний шар (логіка блогу)
│   ├── lib/cache.js           кеш запитів (TTL + LRU + теги інвалідації)
│   ├── public/                index.html, moderation.html, dashboard.html, api.html
│   ├── test/api-test.js       наскрізна перевірка API (67 перевірок)
│   └── bench/                 тест кешу і порівняння MongoDB / PostgreSQL
└── export/                    CSV для PostgreSQL (не в репозиторії, створює 14_bench_generate.js)
```

## Запуск

```powershell
# 1. база MongoDB: створення, індекси, дані
mongosh --quiet --file .\scripts\01_create_collections.js
mongosh --quiet --file .\scripts\02_indexes.js
mongosh --quiet --file .\scripts\03_seed.js
# далі 04 ... 13 за номерами

# 2. вебзастосунок: http://localhost:3000
cd blog-app
npm install
npm start

# 3. перевірки (в іншому вікні, сервер запущено)
node test/api-test.js
node bench/cache-bench.js

# 4. порівняння з PostgreSQL (контейнер car_import_db з ЛР4)
mongosh --quiet --file ..\scripts\14_bench_generate.js
# схема і дані: див. run-all.ps1 (кроки pg_*)
node bench/compare.js
mongosh --quiet --file ..\scripts\15_optimization.js

# або все одразу (сервер має бути запущений):
powershell -ExecutionPolicy Bypass -File .\run-all.ps1
```

Користувач, від імені якого працює вебінтерфейс, обирається у шапці сторінки або параметром
адреси `?as=username` (наприклад, `/?as=olena.kovalenko` для адміністратора). Паролі в базі
тестові (`test-<username>`), автентифікацію в застосунку спрощено до заголовка `X-User-Id`.
