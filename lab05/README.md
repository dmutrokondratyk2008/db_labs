# Лабораторна робота 5. Керування БД, оптимізація продуктивності та автоматизація

Продовження ЛР4: база `car_import` (компанія з пригону авто зі США) у контейнері
`car_import_db` (PostgreSQL 17). Аналіз запитів через `EXPLAIN ANALYZE`, індекси
(звичайні, складені, покривні, часткові), представлення з правилами, тригери валідації,
аудиту та каскадної бізнес-логіки, матеріалізоване представлення, ієрархія ролей з RLS,
резервне копіювання, процедура обслуговування і моніторинг.

**Звіт:** [lab05-report.md](lab05-report.md)

## Структура

```
lab05/
├── README.md
├── lab05-report.md        звіт
├── sql/                   скрипти в порядку виконання (00-20)
├── maintenance.ps1        VACUUM + процедура maintain_database()
├── monitor.ps1            звіт моніторингу з попередженнями
├── reports/               збережені звіти моніторингу
└── backups/               резервні копії (не в репозиторії)
```

## Запуск

Потрібна база з ЛР4 (`cd ../lab04; docker compose up -d`).

```powershell
# pg_stat_statements (один раз, потрібен перезапуск сервера)
docker exec car_import_db psql -U postgres -c "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'"
docker restart car_import_db
docker exec car_import_db psql -U postgres -d car_import -c "CREATE EXTENSION pg_stat_statements"

# скрипти
docker cp .\sql car_import_db:/lab05
docker exec -it car_import_db psql -U postgres -d car_import -P pager=off -f /lab05/01_generate_data.sql
# ... далі за номерами; 04_measure.sql запускається з -v stage=before|indexes|tuned,
# *_test*.sql - під відповідними користувачами (див. звіт)

# обслуговування і моніторинг
powershell -ExecutionPolicy Bypass -File .\maintenance.ps1
powershell -ExecutionPolicy Bypass -File .\monitor.ps1 -Count 12 -IntervalSec 300
```

Тестові облікові записи СУБД: `report_viewer / Viewer#Lab5-2026` (car_reader),
`hordiichuk / Manager#Lab5-01`, `mazurets / Manager#Lab5-02` (car_moderator),
`dba_kondratiuk / Admin#Lab5-2026` (car_admin).
