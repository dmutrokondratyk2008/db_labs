"""Консольний застосунок «Пригін авто зі США»: CRUD-операції та SQL-запити.

Запуск:  python main.py
Параметри підключення беруться зі змінних середовища DB_HOST, DB_PORT,
DB_NAME, DB_USER, DB_PASSWORD (за замовчуванням: localhost:5432/car_import).
"""
import re
import sys
from datetime import date
from decimal import Decimal

from database import DatabaseConnection

STATUSES = {
    "new": "нове",
    "bought": "куплено",
    "in_transit": "в дорозі",
    "in_port": "у порту",
    "customs": "розмитнення",
    "delivered": "доставлено",
    "cancelled": "скасовано",
}
PHONE_RE = re.compile(r"^\+380\d{9}$")
EMAIL_RE = re.compile(r"^[\w.%+-]+@[\w.-]+\.[a-zA-Z]{2,}$")


# ---------------------------------------------------------------------
# Введення / виведення
# ---------------------------------------------------------------------
def ask(prompt):
    """input(), який повторює введене значення, якщо дані подаються з файлу."""
    value = input(prompt).lstrip("﻿")
    if not sys.stdin.isatty():
        print(value)
    return value.strip()


def ask_int(prompt, allow_empty=False):
    while True:
        value = ask(prompt)
        if allow_empty and value == "":
            return None
        if value.isdigit():
            return int(value)
        print("  Потрібно ввести ціле додатне число")


def ask_money(prompt):
    while True:
        value = ask(prompt).replace(",", ".")
        try:
            amount = Decimal(value)
            if amount > 0:
                return amount
        except ArithmeticError:
            pass
        print("  Потрібно ввести додатну суму, наприклад 12500 або 12500.50")


def ask_required(prompt, max_len=50):
    while True:
        value = ask(prompt)
        if value and len(value) <= max_len:
            return value
        print(f"  Поле обов'язкове (до {max_len} символів)")


def fmt(value):
    if value is None:
        return ""
    if isinstance(value, Decimal):
        return f"{value:,.2f}".replace(",", " ")
    if isinstance(value, date):
        return value.strftime("%d.%m.%Y")
    if isinstance(value, str) and value in STATUSES:
        return STATUSES[value]
    return str(value)


def print_table(columns, rows, title=None):
    if title:
        print(f"\n{title}")
    if not rows:
        print("  (немає даних)")
        return
    data = [[fmt(v) for v in row] for row in rows]
    widths = [max(len(str(c)), *(len(r[i]) for r in data)) for i, c in enumerate(columns)]
    line = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    print(line)
    print("| " + " | ".join(str(c).ljust(w) for c, w in zip(columns, widths)) + " |")
    print(line)
    for r, raw_row in zip(data, rows):
        cells = []
        for v, w, raw in zip(r, widths, raw_row):
            numeric = isinstance(raw, (int, Decimal)) and not isinstance(raw, bool)
            cells.append(v.rjust(w) if numeric else v.ljust(w))
        print("| " + " | ".join(cells) + " |")
    print(line)
    print(f"  Рядків: {len(rows)}")


def show(db, query, params=None, title=None, columns=None):
    result = db.execute(query, params)
    if result is None:
        print(f"Помилка: {db.last_error}")
        return
    cols, rows, _ = result
    print_table(columns or cols, rows, title)


# ---------------------------------------------------------------------
# Клієнти (CRUD)
# ---------------------------------------------------------------------
def list_clients(db):
    show(db, """
        SELECT c.client_id, c.last_name || ' ' || c.first_name, c.phone,
               COALESCE(c.email, ''), c.city, COUNT(o.order_id)
        FROM clients c LEFT JOIN orders o ON o.client_id = c.client_id
        GROUP BY c.client_id ORDER BY c.client_id
    """, title="КЛІЄНТИ", columns=["ID", "Клієнт", "Телефон", "Email", "Місто", "Замовлень"])


def add_client(db):
    print("\n--- Новий клієнт ---")
    first = ask_required("Ім'я: ")
    last = ask_required("Прізвище: ")
    while True:
        phone = ask("Телефон (+380XXXXXXXXX): ")
        if PHONE_RE.match(phone):
            break
        print("  Телефон має бути у форматі +380XXXXXXXXX")
    while True:
        email = ask("Email (Enter - пропустити): ")
        if email == "" or EMAIL_RE.match(email):
            break
        print("  Некоректний email")
    city = ask_required("Місто: ")
    result = db.execute("""
        INSERT INTO clients (first_name, last_name, phone, email, city)
        VALUES (%s, %s, %s, %s, %s) RETURNING client_id
    """, (first, last, phone, email or None, city))
    if result:
        print(f"Клієнта додано з ID: {result[1][0][0]}")
    else:
        print(f"Помилка додавання: {db.last_error}")


def update_client(db):
    client_id = ask_int("\nID клієнта для оновлення: ")
    result = db.execute("SELECT first_name, last_name, phone, city FROM clients WHERE client_id = %s",
                        (client_id,))
    if not result or not result[1]:
        print("Клієнта не знайдено")
        return
    first, last, phone, city = result[1][0]
    print(f"Поточні дані: {last} {first}, {phone}, {city}")
    new_phone = ask(f"Новий телефон [{phone}]: ") or phone
    if not PHONE_RE.match(new_phone):
        print("Телефон має бути у форматі +380XXXXXXXXX, оновлення скасовано")
        return
    new_city = ask(f"Нове місто [{city}]: ") or city
    result = db.execute("UPDATE clients SET phone = %s, city = %s WHERE client_id = %s",
                        (new_phone, new_city, client_id))
    if result:
        print(f"Дані клієнта ID {client_id} оновлено (рядків: {result[2]})")
    else:
        print(f"Помилка оновлення: {db.last_error}")


def delete_client(db):
    client_id = ask_int("\nID клієнта для видалення: ")
    confirm = ask(f"Видалити клієнта ID {client_id}? (так/ні): ")
    if confirm.lower() != "так":
        print("Видалення скасовано")
        return
    result = db.execute("DELETE FROM clients WHERE client_id = %s", (client_id,))
    if result is None:
        print(f"Неможливо видалити: {db.last_error}")
    elif result[2] == 0:
        print("Клієнта не знайдено")
    else:
        print(f"Клієнта ID {client_id} видалено")


# ---------------------------------------------------------------------
# Авто та замовлення
# ---------------------------------------------------------------------
def list_cars(db):
    show(db, """
        SELECT c.car_id, c.vin, c.make || ' ' || c.model, c.model_year, c.fuel_type,
               c.mileage_mi, y.platform, c.purchase_price_usd
        FROM cars c JOIN auction_yards y ON y.yard_id = c.yard_id
        ORDER BY c.car_id
    """, title="АВТО", columns=["ID", "VIN", "Авто", "Рік", "Пальне", "Пробіг, миль", "Аукціон", "Ціна, $"])


def search_cars(db):
    term = ask("\nМарка або модель (частина назви): ")
    show(db, """
        SELECT c.car_id, c.make || ' ' || c.model, c.model_year, c.purchase_price_usd,
               COALESCE(o.status, '-')
        FROM cars c LEFT JOIN orders o ON o.car_id = c.car_id
        WHERE (c.make || ' ' || c.model) ILIKE %s
        ORDER BY c.make, c.model
    """, (f"%{term}%",), title=f"Результати пошуку «{term}»",
         columns=["ID", "Авто", "Рік", "Ціна, $", "Статус"])


def list_orders(db):
    show(db, """
        SELECT order_id, order_date, client_name, manager_name, COALESCE(car, wanted_car),
               budget_usd, status
        FROM v_order_details ORDER BY order_id
    """, title="ЗАМОВЛЕННЯ",
         columns=["ID", "Дата", "Клієнт", "Менеджер", "Авто / запит", "Бюджет, $", "Статус"])


def add_order(db):
    print("\n--- Нове замовлення ---")
    client_id = ask_int("ID клієнта: ")
    show(db, "SELECT manager_id, last_name || ' ' || first_name FROM managers WHERE is_active ORDER BY 1",
         columns=["ID", "Менеджер"])
    manager_id = ask_int("ID менеджера: ")
    wanted = ask_required("Бажане авто (марка, модель, роки): ", 100)
    budget = ask_money("Бюджет, $: ")
    city = ask_required("Місто доставки: ")
    result = db.execute("""
        INSERT INTO orders (client_id, manager_id, wanted_car, budget_usd, destination_city)
        VALUES (%s, %s, %s, %s, %s) RETURNING order_id, status
    """, (client_id, manager_id, wanted, budget, city))
    if result:
        order_id, status = result[1][0]
        print(f"Замовлення створено з ID: {order_id}, статус: {fmt(status)}")
    else:
        print(f"Помилка створення: {db.last_error}")


def change_status(db):
    order_id = ask_int("\nID замовлення: ")
    print("Статуси: " + ", ".join(f"{k} ({v})" for k, v in STATUSES.items()))
    status = ask("Новий статус: ")
    result = db.execute("SELECT change_order_status(%s, %s)", (order_id, status))
    if result:
        print(result[1][0][0])
    else:
        print(f"Помилка: {db.last_error}")


def order_cost(db):
    order_id = ask_int("\nID замовлення: ")
    show(db, "SELECT * FROM get_order_cost(%s)", (order_id,),
         title=f"Кошторис замовлення {order_id}", columns=["Стаття", "Сума, $"])


def delete_order(db):
    order_id = ask_int("\nID замовлення для видалення: ")
    confirm = ask(f"Видалити замовлення ID {order_id}? (так/ні): ")
    if confirm.lower() != "так":
        print("Видалення скасовано")
        return
    result = db.execute("DELETE FROM orders WHERE order_id = %s", (order_id,))
    if result is None:
        print(f"Неможливо видалити: {db.last_error}")
    elif result[2] == 0:
        print("Замовлення не знайдено")
    else:
        print(f"Замовлення ID {order_id} видалено")


# ---------------------------------------------------------------------
# Звіти (SQL-запити)
# ---------------------------------------------------------------------
REPORTS = {
    "1": ("Авто 2019+ дешевше 10 000 $", """
        SELECT make, model, model_year, mileage_mi, purchase_price_usd FROM cars
        WHERE model_year >= 2019 AND purchase_price_usd < 10000 ORDER BY purchase_price_usd""",
          ["Марка", "Модель", "Рік", "Пробіг, миль", "Ціна, $"]),
    "2": ("Статистика за марками", """
        SELECT make, COUNT(*) AS cars, ROUND(AVG(purchase_price_usd), 2) AS avg_price
        FROM cars GROUP BY make ORDER BY cars DESC, avg_price DESC""",
          ["Марка", "Авто", "Середня ціна, $"]),
    "3": ("Фінанси замовлень (борги та аванси)", """
        SELECT order_id, client_name, status, total_cost_usd, paid_usd, balance_usd
        FROM v_order_finance WHERE balance_usd <> 0 ORDER BY balance_usd DESC""",
          ["№", "Клієнт", "Статус", "Вартість, $", "Сплачено, $", "Залишок, $"]),
    "4": ("Ефективність менеджерів", """
        SELECT manager_name, orders_total, orders_active, orders_delivered, fee_income_usd, bonus_usd
        FROM v_manager_performance WHERE orders_total > 0 ORDER BY fee_income_usd DESC""",
          ["Менеджер", "Усього", "Активних", "Доставлено", "Комісія, $", "Бонус, $"]),
    "5": ("Авто в дорозі", """
        SELECT order_id, car, carrier, route, departure_date, expected_arrival, days_at_sea
        FROM v_shipments_in_transit ORDER BY departure_date""",
          ["№", "Авто", "Перевізник", "Маршрут", "Відправлено", "Очікується", "Днів у морі"]),
}


def reports_menu(db):
    print()
    for key, (title, _, _) in REPORTS.items():
        print(f"  {key}. {title}")
    choice = ask("Оберіть звіт: ")
    if choice in REPORTS:
        title, query, columns = REPORTS[choice]
        show(db, query, title=title.upper(), columns=columns)
    else:
        print("Невірний номер звіту")


# ---------------------------------------------------------------------
MENU = [
    ("1", "Переглянути клієнтів", list_clients),
    ("2", "Додати клієнта", add_client),
    ("3", "Оновити дані клієнта", update_client),
    ("4", "Видалити клієнта", delete_client),
    ("5", "Переглянути авто", list_cars),
    ("6", "Пошук авто", search_cars),
    ("7", "Переглянути замовлення", list_orders),
    ("8", "Створити замовлення", add_order),
    ("9", "Змінити статус замовлення", change_status),
    ("10", "Кошторис замовлення", order_cost),
    ("11", "Видалити замовлення", delete_order),
    ("12", "Звіти", reports_menu),
]


def main_menu():
    half = (len(MENU) + 1) // 2
    print("\n" + "=" * 26 + " ПРИГІН АВТО ЗІ США " + "=" * 26)
    for left, right in zip(MENU[:half], MENU[half:] + [None]):
        line = f"{left[0]:>3}. {left[1]:<30}"
        if right:
            line += f"{right[0]:>3}. {right[1]}"
        print(line)
    print("  0. Вихід")
    print("=" * 72)
    return ask("Оберіть опцію: ")


def main():
    for stream in (sys.stdin, sys.stdout):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    db = DatabaseConnection()
    if not db.connect():
        print("Не вдалося підключитися до бази даних")
        return
    actions = {key: func for key, _, func in MENU}
    try:
        while True:
            try:
                choice = main_menu()
            except EOFError:
                break
            if choice == "0":
                print("\nРоботу завершено.")
                break
            action = actions.get(choice)
            if action:
                action(db)
            else:
                print("Невірна опція, спробуйте ще раз")
    finally:
        db.disconnect()


if __name__ == "__main__":
    main()
