"""Налаштування вебзастосунку. Значення можна перевизначити змінними середовища."""
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DB = {
    "dbname": os.getenv("DB_NAME", "car_import"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "password"),
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 5432)),
}

SECRET_KEY = os.getenv("SECRET_KEY", "lab04-dev-secret-change-in-production")

# Ключ для доступу до REST API (заголовок X-API-Key)
API_KEY = os.getenv("API_KEY", "lab04-demo-api-key")

# Резервне копіювання: pg_dump виконується всередині контейнера PostgreSQL,
# файли потрапляють у змонтований каталог lab04/backups
DOCKER_CONTAINER = os.getenv("DOCKER_CONTAINER", "car_import_db")
BACKUP_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "backups"))
BACKUP_DIR_IN_CONTAINER = "/backups"

PAGE_SIZE = 10
