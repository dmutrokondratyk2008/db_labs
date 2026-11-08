"""Підключення до PostgreSQL для консольного застосунку."""
import os

import psycopg2


class DatabaseConnection:
    """Обгортка над з'єднанням psycopg2 з обробкою помилок і транзакцій."""

    def __init__(self, dbname=None, user=None, password=None, host=None, port=None):
        self.conn_params = {
            "dbname": dbname or os.getenv("DB_NAME", "car_import"),
            "user": user or os.getenv("DB_USER", "postgres"),
            "password": password or os.getenv("DB_PASSWORD", "password"),
            "host": host or os.getenv("DB_HOST", "localhost"),
            "port": int(port or os.getenv("DB_PORT", 5432)),
        }
        self.conn = None
        self.last_error = None

    def connect(self):
        try:
            self.conn = psycopg2.connect(**self.conn_params)
            with self.conn.cursor() as cur:
                cur.execute("SELECT current_database(), split_part(version(), ' ', 2)")
                db, version = cur.fetchone()
            self.conn.commit()
            print(f"Успішне підключення до бази даних {db} (PostgreSQL {version})")
            return True
        except psycopg2.Error as e:
            print(f"Помилка підключення: {e}")
            self.conn = None
            return False

    def disconnect(self):
        if self.conn:
            self.conn.close()
            print("З'єднання закрито")

    @staticmethod
    def _error_text(e):
        """Повідомлення PostgreSQL без технічних рядків CONTEXT."""
        diag = getattr(e, "diag", None)
        if diag is not None and e.pgcode == "23503":
            return (f"запис використовується в таблиці {diag.table_name} "
                    f"(обмеження {diag.constraint_name})")
        if diag is not None and e.pgcode == "23505":
            return f"таке значення вже існує: {diag.message_detail}"
        if diag is not None and diag.message_primary:
            return diag.message_primary
        return str(e).strip()

    def execute(self, query, params=None, fetch=True):
        """Виконує запит у транзакції. Повертає (columns, rows) або None при помилці."""
        self.last_error = None
        try:
            with self.conn.cursor() as cur:
                cur.execute(query, params)
                columns = [d[0] for d in cur.description] if cur.description else []
                rows = cur.fetchall() if (fetch and cur.description) else []
                rowcount = cur.rowcount
            self.conn.commit()
            return columns, rows, rowcount
        except psycopg2.Error as e:
            self.conn.rollback()
            self.last_error = self._error_text(e)
            return None
