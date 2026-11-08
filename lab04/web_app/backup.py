"""Резервне копіювання бази даних через pg_dump у контейнері PostgreSQL."""
import os
import re
import subprocess
from datetime import datetime

import config

NAME_RE = re.compile(r"^car_import_\d{8}_\d{6}\.dump$")


def create_backup():
    """Створює дамп у форматі custom (-Fc). Повертає (ім'я файлу, розмір у байтах)."""
    name = f"car_import_{datetime.now():%Y%m%d_%H%M%S}.dump"
    cmd = ["docker", "exec", config.DOCKER_CONTAINER, "pg_dump", "-U", config.DB["user"],
           "-d", config.DB["dbname"], "-Fc", "-f", f"{config.BACKUP_DIR_IN_CONTAINER}/{name}"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "pg_dump завершився з помилкою")
    path = os.path.join(config.BACKUP_DIR, name)
    return name, os.path.getsize(path)


def list_backups():
    if not os.path.isdir(config.BACKUP_DIR):
        return []
    items = []
    for name in sorted(os.listdir(config.BACKUP_DIR), reverse=True):
        if NAME_RE.match(name):
            path = os.path.join(config.BACKUP_DIR, name)
            items.append({"name": name, "size_kb": round(os.path.getsize(path) / 1024, 1),
                          "created": datetime.fromtimestamp(os.path.getmtime(path))})
    return items


def backup_path(name):
    if not NAME_RE.match(name):
        return None
    path = os.path.join(config.BACKUP_DIR, name)
    return path if os.path.isfile(path) else None
