"""REST API для інтеграції з іншими системами. Доступ за ключем у заголовку X-API-Key."""
from datetime import date
from decimal import Decimal
from functools import wraps

from flask import Blueprint, g, jsonify, request

import config
from database import DBError, execute, log_activity, query, query_one
from validators import STATUSES, validate_client

bp = Blueprint("api", __name__, url_prefix="/api")


def _json_value(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, date):
        return v.isoformat()
    return v


def _rows(rows):
    return [{k: _json_value(v) for k, v in r.items()} for r in rows]


def require_api_key(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if request.headers.get("X-API-Key") != config.API_KEY:
            return jsonify({"success": False, "error": "Invalid or missing API key"}), 401
        g.actor = "api"  # ім'я автора змін у журналі аудиту
        return view(*args, **kwargs)
    return wrapped


@bp.get("/orders")
@require_api_key
def orders():
    status = request.args.get("status")
    if status and status not in STATUSES:
        return jsonify({"success": False, "error": f"Unknown status: {status}"}), 400
    rows = query("""
        SELECT d.order_id, d.order_date, d.status, d.client_name, d.manager_name,
               d.car, d.vin, f.total_cost_usd, f.paid_usd, f.balance_usd
        FROM v_order_details d JOIN v_order_finance f USING (order_id)
        WHERE (%(s)s::text IS NULL OR d.status = %(s)s)
        ORDER BY d.order_id
    """, {"s": status})
    return jsonify({"success": True, "count": len(rows), "data": _rows(rows)})


@bp.get("/orders/<int:order_id>")
@require_api_key
def order_detail(order_id):
    row = query_one("SELECT * FROM v_order_details WHERE order_id = %s", (order_id,))
    if not row:
        return jsonify({"success": False, "error": "Order not found"}), 404
    cost = query("SELECT item, amount_usd FROM get_order_cost(%s)", (order_id,))
    history = query("""SELECT old_status, new_status, changed_at::date AS changed_at, changed_by
                       FROM order_status_history WHERE order_id = %s ORDER BY history_id""", (order_id,))
    data = {k: _json_value(v) for k, v in row.items() if k != "updated_at"}
    data["cost"] = {r["item"]: float(r["amount_usd"]) for r in cost}
    data["status_history"] = _rows(history)
    return jsonify({"success": True, "data": data})


@bp.patch("/orders/<int:order_id>/status")
@require_api_key
def order_status(order_id):
    payload = request.get_json(silent=True) or {}
    status = payload.get("status")
    if status not in STATUSES:
        return jsonify({"success": False, "error": "Field 'status' is required and must be valid"}), 400
    try:
        row = execute("SELECT change_order_status(%s, %s) AS message", (order_id, status))
    except DBError as e:
        return jsonify({"success": False, "error": str(e)}), 409
    return jsonify({"success": True, "message": row["message"]})


@bp.get("/cars")
@require_api_key
def cars():
    make = request.args.get("make", "")
    rows = query("""
        SELECT c.car_id, c.vin, c.make, c.model, c.model_year, c.fuel_type, c.mileage_mi,
               y.platform, c.purchase_price_usd, c.purchase_date
        FROM cars c JOIN auction_yards y ON y.yard_id = c.yard_id
        WHERE (c.make || ' ' || c.model) ILIKE %s
        ORDER BY c.purchase_date DESC
    """, (f"%{make}%",))
    return jsonify({"success": True, "count": len(rows), "data": _rows(rows)})


@bp.post("/clients")
@require_api_key
def create_client():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"success": False, "error": "JSON body expected"}), 400
    data, errors = validate_client(payload)
    if errors:
        return jsonify({"success": False, "errors": errors}), 422
    try:
        row = execute("""
            INSERT INTO clients (first_name, last_name, phone, email, city)
            VALUES (%(first_name)s, %(last_name)s, %(phone)s, %(email)s, %(city)s)
            RETURNING client_id
        """, data)
    except DBError as e:
        return jsonify({"success": False, "error": str(e)}), 409
    log_activity("API_CREATE", "clients", row["client_id"], "Клієнта створено через API")
    return jsonify({"success": True, "client_id": row["client_id"]}), 201


@bp.get("/stats")
@require_api_key
def stats():
    by_status = query("SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY status")
    totals = query_one("""
        SELECT COUNT(*) AS orders, SUM(total_cost_usd) AS turnover_usd,
               SUM(paid_usd) AS paid_usd, SUM(GREATEST(balance_usd, 0)) AS debt_usd
        FROM v_order_finance WHERE status <> 'cancelled'
    """)
    return jsonify({"success": True,
                    "orders_by_status": {r["status"]: r["count"] for r in by_status},
                    "totals": {k: _json_value(v) for k, v in totals.items()}})
