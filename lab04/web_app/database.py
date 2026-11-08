"""Робота з PostgreSQL: пул з'єднань, транзакції, передача користувача в тригери аудиту."""
from contextlib import contextmanager

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool
from flask import g

import config

_pool = None


class DBError(Exception):
    """Помилка бази даних з повідомленням, придатним для показу користувачу."""


def get_pool():
    global _pool
    if _pool is None:
        _pool = ThreadedConnectionPool(1, 10, **config.DB)
    return _pool


def error_message(e):
    diag = getattr(e, "diag", None)
    code = getattr(e, "pgcode", None)
    if diag is not None and code == "23503":      # foreign_key_violation
        return (f"запис пов'язаний з іншими даними (обмеження {diag.constraint_name}, "
                f"таблиця {diag.table_name})")
    if diag is not None and code == "23505":      # unique_violation
        return f"таке значення вже існує ({diag.message_detail or diag.constraint_name})"
    if diag is not None and diag.message_primary:
        msg = diag.message_primary
        if diag.message_detail:
            msg += f" ({diag.message_detail})"
        return msg
    return str(e).strip()


@contextmanager
def transaction():
    """Транзакція з курсором-словником.

    На початку транзакції в змінні сесії app.user_id / app.username записується
    поточний користувач, тому тригер fn_audit_row() знає автора кожної зміни.
    """
    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            user = getattr(g, "user", None)
            username = user["username"] if user else getattr(g, "actor", "anonymous")
            cur.execute(
                "SELECT set_config('app.user_id', %s, true), set_config('app.username', %s, true)",
                (str(user["user_id"]) if user else "", username),
            )
            yield cur
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        raise DBError(error_message(e)) from e
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def query(sql, params=None):
    with transaction() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def query_one(sql, params=None):
    with transaction() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def execute(sql, params=None):
    """Виконує запит на зміну; повертає перший рядок RETURNING (якщо є) або rowcount."""
    with transaction() as cur:
        cur.execute(sql, params)
        if cur.description:
            return cur.fetchone()
        return cur.rowcount


def log_activity(action, table_name=None, record_id=None, details=None, user_id=None):
    """Запис у журнал дії, що не змінює таблиці (вхід, звіт, резервна копія тощо)."""
    if user_id is None and getattr(g, "user", None):
        user_id = g.user["user_id"]
    try:
        execute("SELECT log_activity(%s, %s, %s, %s, %s)",
                (user_id, action, table_name, record_id, details))
    except DBError:
        pass
