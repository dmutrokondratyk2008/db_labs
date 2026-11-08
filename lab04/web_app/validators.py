"""Серверна валідація даних форм і JSON. Кожна функція повертає (data, errors)."""
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

PHONE_RE = re.compile(r"^\+380\d{9}$")
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
CONTAINER_RE = re.compile(r"^[A-Z]{4}\d{7}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,30}$")

FUEL_TYPES = {"petrol": "бензин", "diesel": "дизель", "hybrid": "гібрид", "electric": "електро"}
PAY_METHODS = {"cash": "готівка", "card": "картка", "bank_transfer": "банківський переказ"}
PAY_PURPOSES = {"deposit": "завдаток", "car": "оплата авто", "shipping": "доставка",
                "customs": "митні платежі", "services": "послуги"}
PORTS = ["Одеса", "Клайпеда", "Гдиня", "Бремергафен", "Констанца"]
STATUSES = {"new": "нове", "bought": "куплено", "in_transit": "в дорозі", "in_port": "у порту",
            "customs": "розмитнення", "delivered": "доставлено", "cancelled": "скасовано"}
ROLES = {"admin": "адміністратор", "manager": "менеджер", "viewer": "перегляд"}


class Form:
    """Допоміжний клас: читає поля і накопичує помилки."""

    def __init__(self, source):
        self.src = source or {}
        self.data = {}
        self.errors = {}

    def _raw(self, name):
        value = self.src.get(name)
        return value.strip() if isinstance(value, str) else value

    def text(self, name, label, required=True, max_len=100, pattern=None, msg=None, upper=False):
        value = self._raw(name)
        value = "" if value is None else str(value)
        if upper:
            value = value.upper()
        if not value:
            if required:
                self.errors[name] = f"Поле «{label}» обов'язкове"
            self.data[name] = None
            return None
        if len(value) > max_len:
            self.errors[name] = f"«{label}»: не більше {max_len} символів"
        elif pattern and not pattern.match(value):
            self.errors[name] = msg or f"«{label}»: некоректний формат"
        self.data[name] = value
        return value

    def integer(self, name, label, required=True, min_value=None, max_value=None):
        raw = self._raw(name)
        if raw in (None, ""):
            if required:
                self.errors[name] = f"Поле «{label}» обов'язкове"
            self.data[name] = None
            return None
        try:
            value = int(raw)
        except (TypeError, ValueError):
            self.errors[name] = f"«{label}»: потрібне ціле число"
            self.data[name] = None
            return None
        if min_value is not None and value < min_value:
            self.errors[name] = f"«{label}»: не менше {min_value}"
        if max_value is not None and value > max_value:
            self.errors[name] = f"«{label}»: не більше {max_value}"
        self.data[name] = value
        return value

    def money(self, name, label, required=True, allow_zero=False, max_value=1_000_000):
        raw = self._raw(name)
        if raw in (None, ""):
            if required:
                self.errors[name] = f"Поле «{label}» обов'язкове"
            self.data[name] = None
            return None
        try:
            value = Decimal(str(raw).replace(",", ".").replace(" ", ""))
        except InvalidOperation:
            self.errors[name] = f"«{label}»: потрібне число"
            self.data[name] = None
            return None
        if value < 0 or (value == 0 and not allow_zero):
            self.errors[name] = f"«{label}»: сума має бути додатною"
        elif value > max_value:
            self.errors[name] = f"«{label}»: занадто велика сума"
        self.data[name] = value.quantize(Decimal("0.01"))
        return value

    def date(self, name, label, required=True, not_future=False):
        raw = self._raw(name)
        if raw in (None, ""):
            if required:
                self.errors[name] = f"Поле «{label}» обов'язкове"
            self.data[name] = None
            return None
        try:
            value = datetime.strptime(str(raw), "%Y-%m-%d").date()
        except ValueError:
            self.errors[name] = f"«{label}»: дата у форматі РРРР-ММ-ДД"
            self.data[name] = None
            return None
        if not_future and value > date.today():
            self.errors[name] = f"«{label}»: дата не може бути в майбутньому"
        self.data[name] = value
        return value

    def choice(self, name, label, options, required=True):
        value = self._raw(name)
        if not value:
            if required:
                self.errors[name] = f"Оберіть значення поля «{label}»"
            self.data[name] = None
            return None
        if value not in options:
            self.errors[name] = f"«{label}»: недопустиме значення"
        self.data[name] = value
        return value


def validate_client(src):
    f = Form(src)
    f.text("first_name", "Ім'я", max_len=50)
    f.text("last_name", "Прізвище", max_len=50)
    f.text("phone", "Телефон", max_len=13, pattern=PHONE_RE, msg="Телефон у форматі +380XXXXXXXXX")
    f.text("email", "Email", required=False, pattern=EMAIL_RE, msg="Некоректний email")
    f.text("city", "Місто", max_len=50)
    return f.data, f.errors


def validate_car(src, require_order=False):
    f = Form(src)
    if require_order:
        f.integer("order_id", "Замовлення", min_value=1)
    f.text("vin", "VIN", max_len=17, pattern=VIN_RE, upper=True,
           msg="VIN: 17 символів, латинські літери (без I, O, Q) та цифри")
    f.text("make", "Марка", max_len=40)
    f.text("model", "Модель", max_len=40)
    f.integer("model_year", "Рік випуску", min_value=1990, max_value=date.today().year + 1)
    fuel = f.choice("fuel_type", "Тип пального", FUEL_TYPES)
    if fuel == "electric":
        f.money("battery_kwh", "Ємність батареї, кВт*год", max_value=300)
        f.data["engine_volume"] = None
    else:
        f.money("engine_volume", "Об'єм двигуна, л", max_value=8)
        f.data["battery_kwh"] = None
    f.integer("mileage_mi", "Пробіг, миль", min_value=0, max_value=1_000_000)
    f.text("damage", "Пошкодження", required=False, max_len=100)
    f.integer("yard_id", "Аукціонний майданчик", min_value=1)
    f.text("lot_number", "Номер лоту", max_len=12)
    f.money("purchase_price_usd", "Ціна лоту, $")
    f.money("auction_fee_usd", "Збір аукціону, $", required=False, allow_zero=True)
    if f.data.get("auction_fee_usd") is None:
        f.data["auction_fee_usd"] = Decimal("0")
    f.date("purchase_date", "Дата купівлі", not_future=True)
    return f.data, f.errors


def validate_order(src):
    f = Form(src)
    f.integer("client_id", "Клієнт", min_value=1)
    f.integer("manager_id", "Менеджер", min_value=1)
    f.text("wanted_car", "Бажане авто", max_len=100)
    f.money("budget_usd", "Бюджет, $", max_value=500_000)
    f.text("destination_city", "Місто доставки", max_len=50)
    f.money("service_fee_usd", "Комісія компанії, $", allow_zero=True, max_value=10_000)
    return f.data, f.errors


def validate_payment(src):
    f = Form(src)
    f.money("amount_usd", "Сума, $", max_value=200_000)
    f.date("payment_date", "Дата платежу", not_future=True)
    f.choice("method", "Спосіб оплати", PAY_METHODS)
    f.choice("purpose", "Призначення", PAY_PURPOSES)
    return f.data, f.errors


def validate_shipment(src):
    f = Form(src)
    f.integer("carrier_id", "Перевізник", min_value=1)
    f.text("container_number", "Номер контейнера", max_len=11, pattern=CONTAINER_RE, upper=True,
           msg="Контейнер: 4 латинські літери і 7 цифр, наприклад MSKU1234567")
    f.text("port_from", "Порт відправлення", max_len=50)
    f.choice("port_to", "Порт призначення", PORTS)
    dep = f.date("departure_date", "Дата відправлення", required=False, not_future=True)
    arr = f.date("arrival_date", "Дата прибуття", required=False, not_future=True)
    f.money("shipping_cost_usd", "Вартість доставки, $", max_value=20_000)
    if arr and not dep:
        f.errors["arrival_date"] = "Не можна вказати прибуття без дати відправлення"
    elif arr and dep and arr <= dep:
        f.errors["arrival_date"] = "Дата прибуття має бути пізнішою за дату відправлення"
    return f.data, f.errors


def validate_registration(src):
    f = Form(src)
    f.text("username", "Логін", max_len=30, pattern=USERNAME_RE,
           msg="Логін: 3-30 латинських літер, цифр або _")
    f.text("full_name", "Повне ім'я", max_len=100)
    f.text("email", "Email", pattern=EMAIL_RE, msg="Некоректний email")
    password = f.text("password", "Пароль", max_len=128)
    if password and (len(password) < 8 or not re.search(r"\d", password)
                     or not re.search(r"[A-Za-zА-Яа-яІіЇїЄєҐґ]", password)):
        f.errors["password"] = "Пароль: щонайменше 8 символів, літери та цифри"
    if password and src.get("password2") != password:
        f.errors["password2"] = "Паролі не збігаються"
    return f.data, f.errors
