"""Тексты сообщений бота (HTML-разметка Telegram)."""

from __future__ import annotations

from datetime import date
from html import escape

from app.domain.money import format_amount
from app.services.reminders import Reminder, ReminderItem


def plural_days(n: int) -> str:
    n = abs(n)
    if n % 10 == 1 and n % 100 != 11:
        word = "день"
    elif 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        word = "дня"
    else:
        word = "дней"
    return f"{n} {word}"


def fmt_date(value: date) -> str:
    return value.strftime("%d.%m.%Y")


def relative_due(due: date, today: date) -> str:
    days = (due - today).days
    if days < 0:
        return f"⚠️ просрочено на {plural_days(-days)}"
    if days == 0:
        return "сегодня"
    if days == 1:
        return "завтра"
    return f"через {plural_days(days)}"


def _upper_first(text: str) -> str:
    return text[:1].upper() + text[1:]


def _paid_line(item: ReminderItem) -> str:
    who = f" ({escape(item.paid_by_label)})" if item.paid_by_label else ""
    return f"✅ оплачено {fmt_date(item.paid_at)}{who}"


def render_reminder(reminder: Reminder) -> tuple[str, list[tuple[str, int]]]:
    """Текст сообщения и кнопки «Оплачено» для ещё неоплаченных периодов."""
    items = reminder.items
    today = reminder.today
    unpaid = [i for i in items if i.paid_at is None]

    if not unpaid:
        header = "✅ <b>Оплачено</b>"
    elif any(i.due_date < today for i in unpaid):
        header = "⚠️ <b>Просроченный платёж</b>"
    else:
        header = "🔔 <b>Напоминание об оплате</b>"

    lines = [header, "", f"<b>{escape(reminder.payment_name)}</b>"]
    if len(items) == 1:
        item = items[0]
        lines.append(f"Сумма: <b>{format_amount(item.amount_minor, item.currency)}</b> ({item.currency})")
        lines.append(f"Срок оплаты: <b>{fmt_date(item.due_date)}</b>")
        lines.append(_paid_line(item) if item.paid_at else _upper_first(relative_due(item.due_date, today)))
    else:
        lines.append(f"Неоплаченных периодов: {len(unpaid)}" if unpaid else "Все периоды оплачены")
        for item in items:
            status = _paid_line(item) if item.paid_at else relative_due(item.due_date, today)
            lines.append(
                f"• {fmt_date(item.due_date)} — {format_amount(item.amount_minor, item.currency)} "
                f"({item.currency}) — {status}"
            )

    if not reminder.payment_active and unpaid:
        lines += ["", "<i>Регулярный платёж прекращён</i>"]

    if len(items) == 1:
        buttons = [("✅ Оплачено", unpaid[0].occurrence_id)] if unpaid else []
    else:
        buttons = [(f"✅ Оплачено {i.due_date:%d.%m}", i.occurrence_id) for i in unpaid]
    return "\n".join(lines), buttons
