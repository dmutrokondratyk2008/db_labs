"""Генерація звітів: PDF (reportlab) та Excel (openpyxl)."""
import io
import os
from datetime import datetime

import matplotlib
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from validators import STATUSES

# Шрифт з підтримкою кирилиці: DejaVu Sans постачається разом із matplotlib
_FONT_DIR = os.path.join(matplotlib.get_data_path(), "fonts", "ttf")
pdfmetrics.registerFont(TTFont("DejaVu", os.path.join(_FONT_DIR, "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("DejaVu-Bold", os.path.join(_FONT_DIR, "DejaVuSans-Bold.ttf")))

HEADER_BG = colors.HexColor("#1e3a5f")


def _money(value):
    return f"{float(value or 0):,.2f}".replace(",", " ")


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("t", parent=base["Title"], fontName="DejaVu-Bold", fontSize=16,
                                textColor=HEADER_BG, spaceAfter=6),
        "normal": ParagraphStyle("n", parent=base["Normal"], fontName="DejaVu", fontSize=9, leading=12),
        "bold": ParagraphStyle("b", parent=base["Normal"], fontName="DejaVu-Bold", fontSize=10, leading=13),
    }


def _table(data, col_widths, numeric_cols=(), total_row=False):
    table = Table(data, colWidths=col_widths, repeatRows=1)
    style = [
        ("FONTNAME", (0, 0), (-1, -1), "DejaVu"),
        ("FONTNAME", (0, 0), (-1, 0), "DejaVu-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#94a3b8")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    for col in numeric_cols:
        style.append(("ALIGN", (col, 1), (col, -1), "RIGHT"))
    if total_row:
        style += [("FONTNAME", (0, -1), (-1, -1), "DejaVu-Bold"),
                  ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#e2e8f0"))]
    table.setStyle(TableStyle(style))
    return table


def orders_pdf(rows, filters_text, author):
    """PDF-звіт за списком замовлень (рядки з v_order_finance + v_order_details)."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=1.5 * cm, rightMargin=1.5 * cm,
                            topMargin=1.2 * cm, bottomMargin=1.2 * cm,
                            title="Звіт про замовлення", author=author)
    st = _styles()
    elements = [
        Paragraph("Звіт про замовлення: пригін авто зі США", st["title"]),
        Paragraph(f"Сформовано: {datetime.now():%d.%m.%Y %H:%M}, користувач: {author}", st["normal"]),
        Paragraph(f"Фільтр: {filters_text}", st["normal"]),
        Spacer(1, 10),
    ]
    data = [["№", "Дата", "Клієнт", "Авто", "Менеджер", "Статус",
             "Вартість, $", "Сплачено, $", "Залишок, $"]]
    total = paid = 0
    for i, r in enumerate(rows, 1):
        data.append([i, r["order_date"].strftime("%d.%m.%Y"), r["client_name"],
                     (r["car"] or r["wanted_car"])[:32], r["manager_name"],
                     STATUSES.get(r["status"], r["status"]), _money(r["total_cost_usd"]),
                     _money(r["paid_usd"]), _money(r["balance_usd"])])
        total += float(r["total_cost_usd"])
        paid += float(r["paid_usd"])
    data.append(["", "", "РАЗОМ", f"замовлень: {len(rows)}", "", "", _money(total), _money(paid),
                 _money(total - paid)])
    widths = [1 * cm, 2.2 * cm, 4.2 * cm, 5.6 * cm, 3.6 * cm, 2.6 * cm, 2.6 * cm, 2.6 * cm, 2.4 * cm]
    elements.append(_table(data, widths, numeric_cols=(0, 6, 7, 8), total_row=True))
    doc.build(elements)
    return buf.getvalue()


def order_cost_pdf(order, cost_rows, payments, author):
    """PDF-кошторис одного замовлення."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm,
                            topMargin=1.5 * cm, bottomMargin=1.5 * cm,
                            title=f"Кошторис замовлення {order['order_id']}", author=author)
    st = _styles()
    info = [
        f"<b>Клієнт:</b> {order['client_name']}, {order['client_phone']}",
        f"<b>Менеджер:</b> {order['manager_name']}",
        f"<b>Авто:</b> {order['car'] or order['wanted_car']}" + (f", VIN {order['vin']}" if order['vin'] else ""),
        f"<b>Аукціон:</b> {order['auction_yard'] or '-'}",
        f"<b>Місто доставки:</b> {order['destination_city']}",
        f"<b>Статус:</b> {STATUSES.get(order['status'], order['status'])}",
    ]
    bold_info = ParagraphStyle("bi", parent=st["normal"], fontName="DejaVu")
    elements = [Paragraph(f"Кошторис замовлення № {order['order_id']}", st["title"]),
                Paragraph(f"Дата формування: {datetime.now():%d.%m.%Y %H:%M}", st["normal"]),
                Spacer(1, 8)]
    elements += [Paragraph(line.replace("<b>", "<font name='DejaVu-Bold'>").replace("</b>", "</font>"),
                           bold_info) for line in info]
    elements.append(Spacer(1, 10))
    data = [["Стаття", "Сума, $"]] + [[r["item"], _money(r["amount_usd"])] for r in cost_rows]
    t = _table(data, [10 * cm, 5 * cm], numeric_cols=(1,))
    t.setStyle(TableStyle([("FONTNAME", (0, 9), (-1, 9), "DejaVu-Bold"),
                           ("FONTNAME", (0, 11), (-1, 11), "DejaVu-Bold"),
                           ("BACKGROUND", (0, 9), (-1, 9), colors.HexColor("#e2e8f0"))]))
    elements.append(t)
    if payments:
        elements += [Spacer(1, 12), Paragraph("Платежі", st["bold"]), Spacer(1, 4)]
        pdata = [["Дата", "Призначення", "Спосіб", "Сума, $"]] + [
            [p["payment_date"].strftime("%d.%m.%Y"), p["purpose_ua"], p["method_ua"], _money(p["amount_usd"])]
            for p in payments]
        elements.append(_table(pdata, [3 * cm, 5 * cm, 4 * cm, 3 * cm], numeric_cols=(3,)))
    doc.build(elements)
    return buf.getvalue()


def _sheet(wb, title, columns, rows, money_cols=()):
    ws = wb.create_sheet(title)
    ws.append(columns)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1E3A5F")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for row in rows:
        ws.append([float(v) if hasattr(v, "quantize") else v for v in row])
    for col in money_cols:
        letter = get_column_letter(col)
        for cell in ws[letter][1:]:
            cell.number_format = '#,##0.00'
    for i, col in enumerate(columns, 1):
        width = max([len(str(col))] + [len(str(r[i - 1])) for r in rows if r[i - 1] is not None])
        ws.column_dimensions[get_column_letter(i)].width = min(max(width + 2, 8), 40)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    return ws


def finance_excel(orders, payments, managers):
    wb = Workbook()
    wb.remove(wb.active)
    _sheet(wb, "Замовлення",
           ["ID", "Клієнт", "Статус", "Авто, $", "Доставка, $", "Мита і податки, $", "Послуги, $",
            "Комісія, $", "Разом, $", "Сплачено, $", "Залишок, $"],
           [[o["order_id"], o["client_name"], STATUSES[o["status"]], o["car_cost_usd"], o["shipping_usd"],
             o["taxes_usd"], o["services_usd"], o["service_fee_usd"], o["total_cost_usd"], o["paid_usd"],
             o["balance_usd"]] for o in orders],
           money_cols=range(4, 12))
    _sheet(wb, "Платежі", ["ID", "Замовлення", "Клієнт", "Дата", "Призначення", "Спосіб", "Сума, $"],
           [[p["payment_id"], p["order_id"], p["client_name"], p["payment_date"], p["purpose"],
             p["method"], p["amount_usd"]] for p in payments], money_cols=(7,))
    _sheet(wb, "Менеджери", ["Менеджер", "Замовлень", "Активних", "Доставлено", "Комісія, $", "Бонус, $"],
           [[m["manager_name"], m["orders_total"], m["orders_active"], m["orders_delivered"],
             m["fee_income_usd"], m["bonus_usd"]] for m in managers], money_cols=(5, 6))
    for ws in wb.worksheets:
        for cell in ws["D"][1:] if ws.title == "Платежі" else []:
            cell.number_format = "DD.MM.YYYY"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
