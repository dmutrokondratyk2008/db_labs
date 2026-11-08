"""Вебзастосунок «Пригін авто зі США» (Flask + PostgreSQL).

Запуск:  python app.py   ->   http://localhost:5000
"""
import math
from datetime import date, datetime
from decimal import Decimal

from flask import (Flask, abort, flash, g, redirect, render_template, request, send_file,
                   url_for)
import io

import auth
import backup
import charts
import config
import reports
from api import bp as api_bp
from auth import can, login_required, role_required
from database import DBError, execute, log_activity, query, query_one
from validators import (FUEL_TYPES, PAY_METHODS, PAY_PURPOSES, PORTS, ROLES, STATUSES,
                        validate_car, validate_client, validate_order, validate_payment,
                        validate_shipment)

app = Flask(__name__)
app.secret_key = config.SECRET_KEY
app.json.ensure_ascii = False  # кирилиця у JSON без \u-послідовностей
app.register_blueprint(auth.bp)
app.register_blueprint(api_bp)
app.before_request(auth.load_current_user)

STAFF = ("admin", "manager")
NEXT_STATUS = {"new": ["bought"], "bought": ["in_transit"], "in_transit": ["in_port"],
               "in_port": ["customs"], "customs": ["delivered"]}


# ---------------------------------------------------------------------
# Фільтри шаблонів і спільний контекст
# ---------------------------------------------------------------------
@app.template_filter("money")
def money_filter(value):
    if value is None:
        return "—"
    return f"{float(value):,.2f}".replace(",", " ")


@app.template_filter("d")
def date_filter(value):
    if isinstance(value, datetime):
        return value.strftime("%d.%m.%Y %H:%M")
    if isinstance(value, date):
        return value.strftime("%d.%m.%Y")
    return value or "—"


@app.context_processor
def inject_globals():
    return {"STATUSES": STATUSES, "FUEL_TYPES": FUEL_TYPES, "PAY_METHODS": PAY_METHODS,
            "PAY_PURPOSES": PAY_PURPOSES, "PORTS": PORTS, "ROLES": ROLES, "can": can,
            "today": date.today().isoformat()}


@app.errorhandler(403)
def forbidden(_):
    return render_template("error.html", code=403,
                           message="Недостатньо прав для цієї дії. Зверніться до адміністратора."), 403


@app.errorhandler(404)
def not_found(_):
    return render_template("error.html", code=404, message="Сторінку або запис не знайдено."), 404


def paginate(total, page):
    pages = max(1, math.ceil(total / config.PAGE_SIZE))
    return {"page": page, "pages": pages, "total": total}


def page_arg():
    try:
        return max(1, int(request.args.get("page", 1)))
    except ValueError:
        return 1


def sort_clause(allowed, default):
    """ORDER BY лише з дозволених стовпців (захист від SQL-ін'єкцій через параметр sort)."""
    sort = request.args.get("sort", default)
    direction = "DESC" if request.args.get("dir") == "desc" else "ASC"
    if sort not in allowed:
        sort = default
    return f"{allowed[sort]} {direction} NULLS LAST", sort, direction.lower()


# ---------------------------------------------------------------------
# Головна сторінка
# ---------------------------------------------------------------------
@app.route("/")
@login_required
def index():
    stats = query_one("""
        SELECT COUNT(*) FILTER (WHERE status NOT IN ('delivered','cancelled')) AS active,
               COUNT(*) FILTER (WHERE status = 'delivered')                    AS delivered,
               COUNT(*) FILTER (WHERE status IN ('in_transit','in_port'))      AS on_the_way,
               (SELECT COUNT(*) FROM clients)                                  AS clients
        FROM orders
    """)
    finance = query_one("""
        SELECT COALESCE(SUM(paid_usd), 0) AS paid,
               COALESCE(SUM(GREATEST(balance_usd, 0)), 0) AS debt
        FROM v_order_finance WHERE status <> 'cancelled'
    """)
    transit = query("SELECT * FROM v_shipments_in_transit ORDER BY expected_arrival")
    history = query("""
        SELECT h.order_id, h.old_status, h.new_status, h.changed_at, h.changed_by, h.comment
        FROM order_status_history h ORDER BY h.history_id DESC LIMIT 8
    """)
    my_orders = []
    if g.user["manager_id"]:
        my_orders = query("""SELECT order_id, client_name, COALESCE(car, wanted_car) AS car, status
                             FROM v_order_details WHERE manager_id = %s
                               AND status NOT IN ('delivered','cancelled') ORDER BY order_id""",
                          (g.user["manager_id"],))
    return render_template("index.html", stats=stats, finance=finance, transit=transit,
                           history=history, my_orders=my_orders)


# ---------------------------------------------------------------------
# Клієнти
# ---------------------------------------------------------------------
@app.route("/clients")
@login_required
def clients():
    q = request.args.get("q", "").strip()
    city = request.args.get("city", "").strip()
    order_by, sort, direction = sort_clause(
        {"name": "c.last_name", "city": "c.city", "orders": "orders_count",
         "created": "c.created_at", "id": "c.client_id"}, "name")
    page = page_arg()
    rows = query(f"""
        SELECT c.*, COUNT(o.order_id) AS orders_count, COUNT(*) OVER () AS total_rows
        FROM clients c LEFT JOIN orders o ON o.client_id = c.client_id
        WHERE (%(q)s = '' OR (c.last_name || ' ' || c.first_name) ILIKE %(like)s
               OR c.phone LIKE %(like)s OR c.email ILIKE %(like)s)
          AND (%(city)s = '' OR c.city = %(city)s)
        GROUP BY c.client_id
        ORDER BY {order_by}
        LIMIT %(limit)s OFFSET %(offset)s
    """, {"q": q, "like": f"%{q}%", "city": city, "limit": config.PAGE_SIZE,
          "offset": (page - 1) * config.PAGE_SIZE})
    cities = [r["city"] for r in query("SELECT DISTINCT city FROM clients ORDER BY city")]
    total = rows[0]["total_rows"] if rows else 0
    return render_template("clients.html", rows=rows, q=q, city=city, cities=cities, sort=sort,
                           dir=direction, pager=paginate(total, page))


@app.route("/clients/add", methods=["GET", "POST"])
@app.route("/clients/<int:client_id>/edit", methods=["GET", "POST"])
@role_required(*STAFF)
def client_form(client_id=None):
    client = None
    if client_id:
        client = query_one("SELECT * FROM clients WHERE client_id = %s", (client_id,))
        if not client:
            abort(404)
    data, errors = (dict(client) if client else {}), {}
    if request.method == "POST":
        data, errors = validate_client(request.form)
        if not errors:
            try:
                if client_id:
                    data["client_id"] = client_id
                    execute("""UPDATE clients SET first_name=%(first_name)s, last_name=%(last_name)s,
                               phone=%(phone)s, email=%(email)s, city=%(city)s
                               WHERE client_id=%(client_id)s""", data)
                    flash("Дані клієнта оновлено", "success")
                else:
                    row = execute("""INSERT INTO clients (first_name, last_name, phone, email, city)
                                     VALUES (%(first_name)s, %(last_name)s, %(phone)s, %(email)s, %(city)s)
                                     RETURNING client_id""", data)
                    flash(f"Клієнта додано (ID {row['client_id']})", "success")
                return redirect(url_for("clients"))
            except DBError as e:
                if "phone" in str(e):
                    errors["phone"] = "Клієнт з таким телефоном уже існує"
                elif "email" in str(e):
                    errors["email"] = "Клієнт з таким email уже існує"
                else:
                    flash(f"Помилка збереження: {e}", "error")
    return render_template("client_form.html", data=data, errors=errors, client_id=client_id)


@app.post("/clients/<int:client_id>/delete")
@role_required("admin")
def client_delete(client_id):
    try:
        if execute("DELETE FROM clients WHERE client_id = %s", (client_id,)):
            flash(f"Клієнта ID {client_id} видалено", "success")
        else:
            flash("Клієнта не знайдено", "error")
    except DBError as e:
        flash(f"Неможливо видалити клієнта: {e}", "error")
    return redirect(url_for("clients"))


# ---------------------------------------------------------------------
# Авто
# ---------------------------------------------------------------------
@app.route("/cars")
@login_required
def cars():
    f = {k: request.args.get(k, "").strip() for k in ("q", "fuel", "platform", "year_from", "year_to")}
    order_by, sort, direction = sort_clause(
        {"car": "c.make, c.model", "year": "c.model_year", "price": "c.purchase_price_usd",
         "mileage": "c.mileage_mi", "date": "c.purchase_date"}, "date")
    page = page_arg()
    params = {"q": f["q"], "like": f"%{f['q']}%", "fuel": f["fuel"], "platform": f["platform"],
              "yf": int(f["year_from"]) if f["year_from"].isdigit() else None,
              "yt": int(f["year_to"]) if f["year_to"].isdigit() else None,
              "limit": config.PAGE_SIZE, "offset": (page - 1) * config.PAGE_SIZE}
    rows = query(f"""
        SELECT c.*, y.platform, y.yard_name, y.state, o.order_id, o.status,
               COUNT(*) OVER () AS total_rows
        FROM cars c
        JOIN auction_yards y ON y.yard_id = c.yard_id
        LEFT JOIN orders o   ON o.car_id = c.car_id
        WHERE (%(q)s = '' OR (c.make || ' ' || c.model) ILIKE %(like)s OR c.vin ILIKE %(like)s)
          AND (%(fuel)s = '' OR c.fuel_type = %(fuel)s)
          AND (%(platform)s = '' OR y.platform = %(platform)s)
          AND (%(yf)s::int IS NULL OR c.model_year >= %(yf)s)
          AND (%(yt)s::int IS NULL OR c.model_year <= %(yt)s)
        ORDER BY {order_by}
        LIMIT %(limit)s OFFSET %(offset)s
    """, params)
    total = rows[0]["total_rows"] if rows else 0
    return render_template("cars.html", rows=rows, f=f, sort=sort, dir=direction,
                           pager=paginate(total, page))


@app.route("/cars/<int:car_id>/edit", methods=["GET", "POST"])
@role_required(*STAFF)
def car_form(car_id):
    car = query_one("SELECT * FROM cars WHERE car_id = %s", (car_id,))
    if not car:
        abort(404)
    data, errors = dict(car), {}
    if request.method == "POST":
        data, errors = validate_car(request.form)
        if not errors:
            data["car_id"] = car_id
            try:
                execute("""UPDATE cars SET vin=%(vin)s, make=%(make)s, model=%(model)s,
                           model_year=%(model_year)s, fuel_type=%(fuel_type)s,
                           engine_volume=%(engine_volume)s, battery_kwh=%(battery_kwh)s,
                           mileage_mi=%(mileage_mi)s, damage=%(damage)s, yard_id=%(yard_id)s,
                           lot_number=%(lot_number)s, purchase_price_usd=%(purchase_price_usd)s,
                           auction_fee_usd=%(auction_fee_usd)s, purchase_date=%(purchase_date)s
                           WHERE car_id=%(car_id)s""", data)
                flash("Дані авто оновлено", "success")
                return redirect(url_for("cars"))
            except DBError as e:
                flash(f"Помилка збереження: {e}", "error")
    yards = query("SELECT yard_id, platform || ' / ' || yard_name || ', ' || state AS name FROM auction_yards ORDER BY platform, yard_name")
    return render_template("car_form.html", data=data, errors=errors, car_id=car_id, yards=yards)


@app.post("/cars/<int:car_id>/delete")
@role_required("admin")
def car_delete(car_id):
    try:
        if execute("DELETE FROM cars WHERE car_id = %s", (car_id,)):
            flash(f"Авто ID {car_id} видалено", "success")
    except DBError as e:
        flash(f"Неможливо видалити авто: {e}", "error")
    return redirect(url_for("cars"))


# ---------------------------------------------------------------------
# Замовлення: список, пошук, фільтри, сортування
# ---------------------------------------------------------------------
ORDER_SORT = {"id": "d.order_id", "date": "d.order_date", "client": "d.client_name",
              "status": "array_position(ARRAY['new','bought','in_transit','in_port','customs','delivered','cancelled']::varchar[], d.status)",
              "total": "f.total_cost_usd", "balance": "f.balance_usd", "manager": "d.manager_name"}


def order_filters():
    f = {k: request.args.get(k, "").strip()
         for k in ("q", "status", "manager", "date_from", "date_to", "debt")}
    params = {"q": f["q"], "like": f"%{f['q']}%", "status": f["status"],
              "manager": int(f["manager"]) if f["manager"].isdigit() else None,
              "df": f["date_from"] or None, "dt": f["date_to"] or None, "debt": f["debt"] == "1"}
    where = """
        (%(q)s = '' OR d.client_name ILIKE %(like)s OR d.car ILIKE %(like)s
                    OR d.wanted_car ILIKE %(like)s OR d.vin ILIKE %(like)s)
        AND (%(status)s = '' OR d.status = %(status)s)
        AND (%(manager)s::int IS NULL OR d.manager_id = %(manager)s)
        AND (%(df)s::date IS NULL OR d.order_date >= %(df)s::date)
        AND (%(dt)s::date IS NULL OR d.order_date <= %(dt)s::date)
        AND (NOT %(debt)s OR f.balance_usd > 0)
    """
    return f, params, where


@app.route("/orders")
@login_required
def orders():
    f, params, where = order_filters()
    order_by, sort, direction = sort_clause(ORDER_SORT, "id")
    page = page_arg()
    params.update(limit=config.PAGE_SIZE, offset=(page - 1) * config.PAGE_SIZE)
    try:
        rows = query(f"""
            SELECT d.*, f.total_cost_usd, f.paid_usd, f.balance_usd, COUNT(*) OVER () AS total_rows
            FROM v_order_details d JOIN v_order_finance f USING (order_id)
            WHERE {where}
            ORDER BY {order_by}
            LIMIT %(limit)s OFFSET %(offset)s
        """, params)
    except DBError as e:
        flash(f"Помилка фільтра: {e}", "error")
        rows = []
    managers = query("SELECT manager_id, last_name || ' ' || first_name AS name FROM managers ORDER BY last_name")
    total = rows[0]["total_rows"] if rows else 0
    return render_template("orders.html", rows=rows, f=f, managers=managers, sort=sort,
                           dir=direction, pager=paginate(total, page))


@app.route("/orders/add", methods=["GET", "POST"])
@app.route("/orders/<int:order_id>/edit", methods=["GET", "POST"])
@role_required(*STAFF)
def order_form(order_id=None):
    order = None
    if order_id:
        order = query_one("SELECT * FROM orders WHERE order_id = %s", (order_id,))
        if not order:
            abort(404)
    data = dict(order) if order else {"manager_id": g.user["manager_id"], "service_fee_usd": 600}
    errors = {}
    if request.method == "POST":
        data, errors = validate_order(request.form)
        if not errors:
            try:
                if order_id:
                    data["order_id"] = order_id
                    execute("""UPDATE orders SET client_id=%(client_id)s, manager_id=%(manager_id)s,
                               wanted_car=%(wanted_car)s, budget_usd=%(budget_usd)s,
                               destination_city=%(destination_city)s, service_fee_usd=%(service_fee_usd)s
                               WHERE order_id=%(order_id)s""", data)
                    flash("Замовлення оновлено", "success")
                else:
                    row = execute("""INSERT INTO orders (client_id, manager_id, wanted_car, budget_usd,
                                         destination_city, service_fee_usd)
                                     VALUES (%(client_id)s, %(manager_id)s, %(wanted_car)s, %(budget_usd)s,
                                             %(destination_city)s, %(service_fee_usd)s)
                                     RETURNING order_id""", data)
                    order_id = row["order_id"]
                    flash(f"Замовлення № {order_id} створено", "success")
                return redirect(url_for("order_detail", order_id=order_id))
            except DBError as e:
                flash(f"Помилка збереження: {e}", "error")
    clients_list = query("SELECT client_id, last_name || ' ' || first_name || ' (' || phone || ')' AS name FROM clients ORDER BY last_name")
    managers = query("SELECT manager_id, last_name || ' ' || first_name AS name FROM managers WHERE is_active ORDER BY last_name")
    return render_template("order_form.html", data=data, errors=errors, order_id=order_id,
                           clients=clients_list, managers=managers)


@app.route("/orders/<int:order_id>")
@login_required
def order_detail(order_id):
    order = query_one("SELECT d.*, o.service_fee_usd FROM v_order_details d JOIN orders o USING (order_id) WHERE order_id = %s", (order_id,))
    if not order:
        abort(404)
    ctx = {
        "order": order,
        "cost": query("SELECT * FROM get_order_cost(%s)", (order_id,)),
        "history": query("SELECT * FROM order_status_history WHERE order_id = %s ORDER BY history_id", (order_id,)),
        "services": query("""SELECT os.*, s.name FROM order_services os JOIN services s USING (service_id)
                             WHERE os.order_id = %s ORDER BY os.added_at""", (order_id,)),
        "all_services": query("SELECT * FROM services ORDER BY name"),
        "payments": query("SELECT * FROM payments WHERE order_id = %s ORDER BY payment_date, payment_id", (order_id,)),
        "shipment": query_one("SELECT * FROM shipments WHERE order_id = %s", (order_id,)),
        "customs": query_one("SELECT * FROM customs_declarations WHERE order_id = %s", (order_id,)),
        "carriers": query("SELECT carrier_id, name FROM carriers ORDER BY name"),
        "yards": query("SELECT yard_id, platform || ' / ' || yard_name || ', ' || state AS name FROM auction_yards ORDER BY platform, yard_name"),
        "next_status": NEXT_STATUS.get(order["status"], []),
    }
    return render_template("order_detail.html", **ctx)


def _order_action(order_id, sql, params, success):
    try:
        row = execute(sql, params)
        flash(success(row) if callable(success) else success, "success")
    except DBError as e:
        flash(f"Помилка: {e}", "error")
    return redirect(url_for("order_detail", order_id=order_id))


@app.post("/orders/<int:order_id>/purchase")
@role_required(*STAFF)
def order_purchase(order_id):
    data, errors = validate_car(request.form)
    if errors:
        for msg in errors.values():
            flash(msg, "error")
        return redirect(url_for("order_detail", order_id=order_id))
    data["order_id"] = order_id
    return _order_action(order_id, """
        SELECT register_car_purchase(%(order_id)s, %(vin)s, %(make)s, %(model)s, %(model_year)s,
               %(fuel_type)s, %(engine_volume)s, %(battery_kwh)s, %(mileage_mi)s, %(damage)s,
               %(yard_id)s, %(lot_number)s, %(purchase_price_usd)s, %(auction_fee_usd)s,
               %(purchase_date)s) AS car_id""", data,
        lambda r: f"Авто зареєстровано (car_id {r['car_id']}), замовлення переведено в статус «куплено»")


@app.post("/orders/<int:order_id>/status")
@role_required(*STAFF)
def order_status(order_id):
    return _order_action(order_id, "SELECT change_order_status(%s, %s) AS msg",
                         (order_id, request.form.get("status", "")), lambda r: r["msg"])


@app.post("/orders/<int:order_id>/cancel")
@role_required(*STAFF)
def order_cancel(order_id):
    return _order_action(order_id, "CALL cancel_order(%s, %s)",
                         (order_id, request.form.get("reason", "").strip()), "Замовлення скасовано")


@app.post("/orders/<int:order_id>/services")
@role_required(*STAFF)
def order_service_add(order_id):
    service_id = request.form.get("service_id", "")
    price = request.form.get("price_usd", "").replace(",", ".")
    try:
        price_value = Decimal(price) if price else None
    except ArithmeticError:
        price_value = Decimal(-1)
    if not service_id.isdigit() or (price_value is not None and price_value < 0):
        flash("Оберіть послугу і вкажіть невід'ємну ціну", "error")
        return redirect(url_for("order_detail", order_id=order_id))
    return _order_action(order_id, """
        INSERT INTO order_services (order_id, service_id, price_usd)
        SELECT %s, service_id, COALESCE(%s, base_price_usd) FROM services WHERE service_id = %s
        ON CONFLICT (order_id, service_id) DO UPDATE SET price_usd = EXCLUDED.price_usd
    """, (order_id, price_value, int(service_id)), "Послугу додано до замовлення")


@app.post("/orders/<int:order_id>/services/<int:service_id>/delete")
@role_required(*STAFF)
def order_service_delete(order_id, service_id):
    return _order_action(order_id, "DELETE FROM order_services WHERE order_id = %s AND service_id = %s",
                         (order_id, service_id), "Послугу видалено із замовлення")


@app.post("/orders/<int:order_id>/payments")
@role_required(*STAFF)
def order_payment_add(order_id):
    data, errors = validate_payment(request.form)
    if errors:
        for msg in errors.values():
            flash(msg, "error")
        return redirect(url_for("order_detail", order_id=order_id))
    data["order_id"] = order_id
    return _order_action(order_id, """
        INSERT INTO payments (order_id, amount_usd, payment_date, method, purpose)
        VALUES (%(order_id)s, %(amount_usd)s, %(payment_date)s, %(method)s, %(purpose)s)
        RETURNING payment_id""", data, lambda r: f"Платіж № {r['payment_id']} зараховано")


@app.post("/orders/<int:order_id>/shipment")
@role_required(*STAFF)
def order_shipment(order_id):
    data, errors = validate_shipment(request.form)
    if errors:
        for msg in errors.values():
            flash(msg, "error")
        return redirect(url_for("order_detail", order_id=order_id))
    data["order_id"] = order_id
    return _order_action(order_id, """
        INSERT INTO shipments (order_id, carrier_id, container_number, port_from, port_to,
                               departure_date, arrival_date, shipping_cost_usd)
        VALUES (%(order_id)s, %(carrier_id)s, %(container_number)s, %(port_from)s, %(port_to)s,
                %(departure_date)s, %(arrival_date)s, %(shipping_cost_usd)s)
        ON CONFLICT (order_id) DO UPDATE SET
            carrier_id = EXCLUDED.carrier_id, container_number = EXCLUDED.container_number,
            port_from = EXCLUDED.port_from, port_to = EXCLUDED.port_to,
            departure_date = EXCLUDED.departure_date, arrival_date = EXCLUDED.arrival_date,
            shipping_cost_usd = EXCLUDED.shipping_cost_usd""", data, "Дані доставки збережено")


@app.post("/orders/<int:order_id>/customs")
@role_required(*STAFF)
def order_customs(order_id):
    rate = request.form.get("eur_usd", "1.16").replace(",", ".")
    try:
        rate_value = Decimal(rate)
    except ArithmeticError:
        flash("Некоректний курс EUR/USD", "error")
        return redirect(url_for("order_detail", order_id=order_id))
    return _order_action(order_id, "SELECT * FROM calculate_customs(%s, %s)", (order_id, rate_value),
                         lambda r: f"Митні платежі розраховано: разом {money_filter(r['total_taxes_usd'])} $")


@app.post("/orders/<int:order_id>/customs/clear")
@role_required(*STAFF)
def order_customs_clear(order_id):
    return _order_action(order_id, """UPDATE customs_declarations SET cleared_at = CURRENT_DATE
                                      WHERE order_id = %s AND cleared_at IS NULL""",
                         (order_id,), "Авто розмитнено")


@app.post("/orders/<int:order_id>/delete")
@role_required("admin")
def order_delete(order_id):
    try:
        if execute("DELETE FROM orders WHERE order_id = %s", (order_id,)):
            flash(f"Замовлення № {order_id} видалено", "success")
            return redirect(url_for("orders"))
        flash("Замовлення не знайдено", "error")
    except DBError as e:
        flash(f"Неможливо видалити замовлення: {e}", "error")
    return redirect(url_for("order_detail", order_id=order_id))


# ---------------------------------------------------------------------
# Звіти PDF / Excel
# ---------------------------------------------------------------------
@app.route("/reports/orders.pdf")
@login_required
def report_orders_pdf():
    f, params, where = order_filters()
    order_by, _, _ = sort_clause(ORDER_SORT, "id")
    rows = query(f"""
        SELECT d.*, f.total_cost_usd, f.paid_usd, f.balance_usd
        FROM v_order_details d JOIN v_order_finance f USING (order_id)
        WHERE {where} ORDER BY {order_by}
    """, params)
    parts = []
    if f["q"]:
        parts.append(f"пошук «{f['q']}»")
    if f["status"]:
        parts.append(f"статус «{STATUSES.get(f['status'], f['status'])}»")
    if f["date_from"] or f["date_to"]:
        parts.append(f"період {f['date_from'] or '...'} — {f['date_to'] or '...'}")
    if f["debt"] == "1":
        parts.append("лише з боргом")
    filters_text = ", ".join(parts) or "усі замовлення"
    pdf = reports.orders_pdf(rows, filters_text, g.user["full_name"])
    log_activity("REPORT_PDF", "orders", details=f"Звіт про замовлення: {filters_text}, рядків {len(rows)}")
    return send_file(io.BytesIO(pdf), mimetype="application/pdf", as_attachment=False,
                     download_name=f"orders_report_{date.today():%Y%m%d}.pdf")


@app.route("/orders/<int:order_id>/cost.pdf")
@login_required
def report_order_cost_pdf(order_id):
    order = query_one("SELECT * FROM v_order_details WHERE order_id = %s", (order_id,))
    if not order:
        abort(404)
    cost = query("SELECT * FROM get_order_cost(%s)", (order_id,))
    payments = query("SELECT * FROM payments WHERE order_id = %s ORDER BY payment_date", (order_id,))
    for p in payments:
        p["purpose_ua"] = PAY_PURPOSES[p["purpose"]]
        p["method_ua"] = PAY_METHODS[p["method"]]
    pdf = reports.order_cost_pdf(order, cost, payments, g.user["full_name"])
    log_activity("REPORT_PDF", "orders", order_id, "Кошторис замовлення")
    return send_file(io.BytesIO(pdf), mimetype="application/pdf",
                     download_name=f"order_{order_id}_cost.pdf")


@app.route("/reports/finance.xlsx")
@login_required
def report_finance_xlsx():
    orders_rows = query("SELECT * FROM v_order_finance ORDER BY order_id")
    payments = query("""SELECT p.*, f.client_name FROM payments p JOIN v_order_finance f USING (order_id)
                        ORDER BY p.payment_date, p.payment_id""")
    for p in payments:
        p["purpose"] = PAY_PURPOSES[p["purpose"]]
        p["method"] = PAY_METHODS[p["method"]]
    managers = query("SELECT * FROM v_manager_performance ORDER BY fee_income_usd DESC")
    data = reports.finance_excel(orders_rows, payments, managers)
    log_activity("REPORT_EXCEL", "orders", details="Фінансовий звіт Excel")
    return send_file(io.BytesIO(data), as_attachment=True,
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                     download_name=f"finance_{date.today():%Y%m%d}.xlsx")


# ---------------------------------------------------------------------
# Аналітика і візуалізація
# ---------------------------------------------------------------------
@app.route("/analytics")
@login_required
def analytics():
    ctx = {
        "chart_status": charts.orders_by_status_chart(),
        "chart_monthly": charts.monthly_finance_chart(),
        "chart_structure": charts.cost_structure_chart(),
        "chart_makes": charts.makes_chart(),
        "managers": query("SELECT * FROM v_manager_performance WHERE orders_total > 0 ORDER BY fee_income_usd DESC"),
        "carriers": query("""
            SELECT cr.name AS carrier, COUNT(s.shipment_id) AS shipments, COUNT(s.arrival_date) AS delivered,
                   ROUND(AVG(s.arrival_date - s.departure_date), 1) AS avg_days,
                   ROUND(AVG(s.shipping_cost_usd), 2) AS avg_cost,
                   RANK() OVER (ORDER BY AVG(s.arrival_date - s.departure_date)) AS speed_rank
            FROM carriers cr JOIN shipments s ON s.carrier_id = cr.carrier_id
            GROUP BY cr.carrier_id, cr.name ORDER BY speed_rank NULLS LAST, shipments DESC"""),
        "customs": query("""
            SELECT c.fuel_type,
                   CASE WHEN EXTRACT(YEAR FROM cd.declared_at) - c.model_year <= 5 THEN 'до 5 років'
                        ELSE 'старше 5 років' END AS age_group,
                   COUNT(*) AS cars, ROUND(AVG(cd.duty_usd + cd.excise_usd + cd.vat_usd), 2) AS avg_total
            FROM customs_declarations cd JOIN orders o USING (order_id) JOIN cars c ON c.car_id = o.car_id
            GROUP BY 1, 2 ORDER BY 1, 2"""),
        "top_clients": query("""
            SELECT cl.last_name || ' ' || cl.first_name AS client, cl.city, COUNT(DISTINCT o.order_id) AS orders,
                   SUM(p.amount_usd) AS paid,
                   ROUND(100 * SUM(p.amount_usd) / SUM(SUM(p.amount_usd)) OVER (), 1) AS share
            FROM clients cl JOIN orders o ON o.client_id = cl.client_id JOIN payments p ON p.order_id = o.order_id
            GROUP BY cl.client_id ORDER BY paid DESC LIMIT 5"""),
    }
    return render_template("analytics.html", **ctx)


# ---------------------------------------------------------------------
# Адміністрування: журнал, користувачі, резервні копії
# ---------------------------------------------------------------------
@app.route("/admin/logs")
@role_required("admin")
def admin_logs():
    f = {k: request.args.get(k, "").strip() for k in ("user", "action", "table")}
    page = page_arg()
    rows = query("""
        SELECT l.*, COUNT(*) OVER () AS total_rows FROM activity_log l
        WHERE (%(user)s = '' OR l.username = %(user)s)
          AND (%(action)s = '' OR l.action = %(action)s)
          AND (%(table)s = '' OR l.table_name = %(table)s)
        ORDER BY l.created_at DESC, l.log_id DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """, {**f, "limit": 15, "offset": (page - 1) * 15})
    options = {
        "users": [r["username"] for r in query("SELECT DISTINCT username FROM activity_log WHERE username IS NOT NULL ORDER BY 1")],
        "actions": [r["action"] for r in query("SELECT DISTINCT action FROM activity_log ORDER BY 1")],
        "tables": [r["table_name"] for r in query("SELECT DISTINCT table_name FROM activity_log WHERE table_name IS NOT NULL ORDER BY 1")],
    }
    total = rows[0]["total_rows"] if rows else 0
    pager = {"page": page, "pages": max(1, math.ceil(total / 15)), "total": total}
    return render_template("logs.html", rows=rows, f=f, options=options, pager=pager)


@app.route("/admin/users", methods=["GET", "POST"])
@role_required("admin")
def admin_users():
    if request.method == "POST":
        user_id = int(request.form["user_id"])
        role = request.form.get("role")
        active = request.form.get("is_active") == "1"
        if user_id == g.user["user_id"] and (role != "admin" or not active):
            flash("Не можна знизити роль або заблокувати власний обліковий запис", "error")
        elif role not in ROLES:
            flash("Невідома роль", "error")
        else:
            try:
                execute("UPDATE users SET role = %s, is_active = %s WHERE user_id = %s", (role, active, user_id))
                flash("Права користувача оновлено", "success")
            except DBError as e:
                flash(f"Помилка: {e}", "error")
        return redirect(url_for("admin_users"))
    users = query("""SELECT u.*, m.last_name || ' ' || m.first_name AS manager_name
                     FROM users u LEFT JOIN managers m USING (manager_id) ORDER BY u.user_id""")
    return render_template("users.html", users=users)


@app.route("/admin/backups", methods=["GET", "POST"])
@role_required("admin")
def admin_backups():
    if request.method == "POST":
        try:
            name, size = backup.create_backup()
            log_activity("BACKUP", details=f"Створено резервну копію {name} ({size} байт)")
            flash(f"Резервну копію {name} створено ({size / 1024:.1f} КБ)", "success")
        except Exception as e:  # noqa: BLE001 - показуємо будь-яку помилку pg_dump/docker
            flash(f"Помилка резервного копіювання: {e}", "error")
        return redirect(url_for("admin_backups"))
    return render_template("backups.html", backups=backup.list_backups(), container=config.DOCKER_CONTAINER)


@app.route("/admin/backups/<name>")
@role_required("admin")
def admin_backup_download(name):
    path = backup.backup_path(name)
    if not path:
        abort(404)
    log_activity("BACKUP_DOWNLOAD", details=name)
    return send_file(path, as_attachment=True, download_name=name)


@app.route("/api-docs")
@login_required
def api_docs():
    return render_template("api_docs.html", api_key=config.API_KEY if can("admin") else None)


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
