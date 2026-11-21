# Лабораторна робота 6. Робота з СУБД MongoDB та реалізація операцій

База `library` (книги, автори, читачі) у MongoDB Community Server 9.0 на Windows 11:
CRUD-операції, індекси і порівняння продуктивності, складні запити, агрегаційні pipeline,
`$lookup`, представлення, текстовий пошук, валідація JSON Schema, геопросторові й TTL-індекси,
версіонування документів, повнотекстовий пошук з українським стемером, набір реплік із трьох
вузлів, автоматизоване резервне копіювання `mongodump` і порівняння з реляційною моделлю
в PostgreSQL 17 (контейнер `car_import_db` з ЛР4).

**Звіт:** [lab06-report.md](lab06-report.md)

## Структура

```
lab06/
├── README.md
├── lab06-report.md          звіт
├── scripts/                 скрипти mongosh у порядку виконання (01-17)
│   └── lib/                 спільні функції: вивід, версіонування, стемер
├── sql/                     реляційна модель і порівняльні запити (18-20)
├── replica/                 запуск і зупинка набору реплік rs0
├── backup.ps1               резервне копіювання з перевіркою і ротацією
├── restore.ps1              відновлення в library_restore і звірка
├── export/                  mongoexport для міграції в PostgreSQL (не в репозиторії)
└── backups/                 архіви mongodump (не в репозиторії)
```

## Запуск

```powershell
mongosh --quiet --file .\scripts\01_create_db.js      # далі 02 ... 15 за номерами

# набір реплік (порти 27018-27020)
powershell -ExecutionPolicy Bypass -File .\replica\start-replica.ps1
mongosh --port 27018 --quiet --file .\scripts\16_replica_init.js

# резервне копіювання і відновлення
powershell -ExecutionPolicy Bypass -File .\backup.ps1 -Keep 7
powershell -ExecutionPolicy Bypass -File .\restore.ps1
```
