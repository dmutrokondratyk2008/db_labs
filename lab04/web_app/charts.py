"""Графіки статистики (matplotlib -> PNG у base64 для вставки в HTML)."""
import base64
import io

import matplotlib

matplotlib.use("Agg")  # backend без графічного інтерфейсу
import matplotlib.pyplot as plt  # noqa: E402

from database import query  # noqa: E402
from validators import STATUSES  # noqa: E402

COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#64748b"]
STATUS_COLORS = {"new": "#6366f1", "bought": "#f59e0b", "in_transit": "#06b6d4", "in_port": "#3b82f6",
                 "customs": "#c026d3", "delivered": "#16a34a", "cancelled": "#94a3b8"}
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                     "axes.spines.top": False, "axes.spines.right": False})


def _to_base64(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def orders_by_status_chart():
    rows = query("""
        SELECT status, COUNT(*) AS cnt FROM orders GROUP BY status
        ORDER BY array_position(ARRAY['new','bought','in_transit','in_port','customs','delivered','cancelled'], status)
    """)
    if not rows:
        return None
    labels = [STATUSES[r["status"]] for r in rows]
    values = [r["cnt"] for r in rows]
    colors = [STATUS_COLORS[r["status"]] for r in rows]
    fig, ax = plt.subplots(figsize=(6, 3.6))
    bars = ax.bar(labels, values, color=colors)
    ax.bar_label(bars, padding=2)
    ax.set_title("Замовлення за статусами", fontweight="bold")
    ax.set_ylabel("Кількість")
    plt.setp(ax.get_xticklabels(), rotation=20, ha="right")
    return _to_base64(fig)


def monthly_finance_chart():
    rows = query("""
        WITH months AS (
            SELECT generate_series(date_trunc('month', (SELECT MIN(payment_date) FROM payments)),
                                   date_trunc('month', CURRENT_DATE), interval '1 month')::date AS m
        )
        SELECT to_char(m, 'MM.YYYY') AS month,
               COALESCE((SELECT SUM(purchase_price_usd + auction_fee_usd) FROM cars
                         WHERE date_trunc('month', purchase_date) = m), 0) AS spent,
               COALESCE((SELECT SUM(amount_usd) FROM payments
                         WHERE date_trunc('month', payment_date) = m), 0) AS received
        FROM months ORDER BY m
    """)
    if not rows:
        return None
    months = [r["month"] for r in rows]
    spent = [float(r["spent"]) / 1000 for r in rows]
    received = [float(r["received"]) / 1000 for r in rows]
    x = range(len(months))
    fig, ax = plt.subplots(figsize=(7, 3.6))
    ax.bar([i - 0.2 for i in x], spent, width=0.4, label="Купівля авто", color=COLORS[0])
    ax.bar([i + 0.2 for i in x], received, width=0.4, label="Надходження від клієнтів", color=COLORS[1])
    ax.set_xticks(list(x), months, rotation=30, ha="right")
    ax.set_ylabel("тис. $")
    ax.set_title("Помісячна динаміка коштів", fontweight="bold")
    ax.legend(frameon=False)
    return _to_base64(fig)


def cost_structure_chart():
    row = query("""
        SELECT SUM(car_cost_usd) AS car, SUM(shipping_usd) AS shipping, SUM(taxes_usd) AS taxes,
               SUM(services_usd) AS services, SUM(service_fee_usd) AS fee
        FROM v_order_finance WHERE status = 'delivered'
    """)
    if not row or row[0]["car"] is None:
        return None
    r = row[0]
    labels = ["Авто і збір аукціону", "Морська доставка", "Митні платежі", "Послуги", "Комісія компанії"]
    values = [float(r[k]) for k in ("car", "shipping", "taxes", "services", "fee")]
    total = sum(values)
    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    wedges, _ = ax.pie(values, startangle=90, colors=COLORS, counterclock=False,
                       wedgeprops={"linewidth": 1.5, "edgecolor": "white", "width": 0.45})
    ax.legend(wedges, [f"{lbl}: {v / total * 100:.1f} %" for lbl, v in zip(labels, values)],
              loc="center left", bbox_to_anchor=(0.95, 0.5), frameon=False, fontsize=9)
    ax.text(0, 0, f"{total / 1000:,.0f}\nтис. $".replace(",", " "), ha="center", va="center",
            fontsize=11, fontweight="bold", color="#1e3a5f")
    ax.set_title("Структура вартості доставлених авто", fontweight="bold")
    return _to_base64(fig)


def makes_chart():
    rows = query("""
        SELECT make, COUNT(*) AS cnt, AVG(purchase_price_usd) AS avg_price
        FROM cars GROUP BY make ORDER BY cnt DESC, avg_price DESC LIMIT 10
    """)
    if not rows:
        return None
    makes = [r["make"] for r in rows][::-1]
    prices = [float(r["avg_price"]) for r in rows][::-1]
    counts = [r["cnt"] for r in rows][::-1]
    fig, ax = plt.subplots(figsize=(6, 3.6))
    bars = ax.barh(makes, prices, color=COLORS[4])
    ax.bar_label(bars, labels=[f"{p:,.0f} $ ({c} шт.)".replace(",", " ") for p, c in zip(prices, counts)],
                 padding=3, fontsize=8)
    ax.set_xlabel("Середня ціна лоту, $")
    ax.set_title("Марки: середня ціна покупки", fontweight="bold")
    ax.set_xlim(0, max(prices) * 1.35)
    return _to_base64(fig)
