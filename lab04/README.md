# Лабораторна робота 4. База даних компанії з пригону авто зі США

Повний цикл розробки реляційної бази даних: концептуальна модель, логічна схема в 3НФ,
реалізація в PostgreSQL 17 (Docker), консольний застосунок і вебзастосунок на Flask
з аутентифікацією, журналом операцій, звітами PDF/Excel, графіками, REST API та резервним копіюванням.

**Звіт:** [lab04-report.md](lab04-report.md)

## Структура

```
lab04/
├── README.md
├── lab04-report.md            звіт
├── docker-compose.yml         PostgreSQL 17 (+ pgAdmin у профілі tools)
├── docs/
│   ├── conceptual_model.png   ER-діаграма
│   ├── conceptual_model.mmd   джерело ER-діаграми (Mermaid)
│   └── logical_schema.md      логічна схема
├── database/                  виконується автоматично при першому запуску контейнера
│   ├── 01_create_tables.sql   таблиці, обмеження, індекси на FK
│   ├── 02_insert_data.sql     тестові дані
│   ├── 03_create_procedures.sql
│   ├── 04_create_triggers.sql
│   ├── 05_create_views.sql
│   ├── 06_create_users.sql    користувачі і ролі (рівень 3)
│   ├── 07_create_audit.sql    журнал операцій (рівень 3)
│   ├── 08_create_indexes.sql  індекси для оптимізації (рівень 3)
│   └── queries.sql            SQL-запити рівнів 1-2
├── demo/                      сценарії демонстрації для звіту
├── backups/                   резервні копії (pg_dump)
├── console_app/               консольний застосунок (CRUD)
└── web_app/                   вебзастосунок Flask
```

## Запуск

```bash
cd lab04
docker compose up -d
docker compose ps
```

Підключення до бази: `docker exec -it car_import_db psql -U postgres -d car_import`.

Консольний застосунок:

```bash
cd console_app
pip install -r requirements.txt
python main.py
```

Вебзастосунок (http://localhost:5000):

```bash
cd web_app
pip install -r requirements.txt
python app.py
```

Тестові облікові записи: `admin / Admin2026!` (адміністратор), `hordiichuk / Manager2026!`
(менеджер), `accountant / Viewer2026!` (перегляд). Ключ API: `lab04-demo-api-key`.

Повне очищення бази: `docker compose down -v`.
