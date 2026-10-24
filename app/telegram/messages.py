"""Тексты сообщений бота (HTML-разметка Telegram). Все пользовательские данные экранируются."""

from __future__ import annotations

from datetime import date
from html import escape

from app.domain.money import format_amount
from app.services.reminders import Reminder, ReminderItem

WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]


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


def fmt_date_wd(value: date) -> str:
    return f"{fmt_date(value)} ({WEEKDAYS[value.weekday()]})"


def relative_due(due: date, today: date) -> str:
    days = (due - today).days
    if days < 0:
        return f"просрочено на {plural_days(-days)}"
    if days == 0:
        return "сегодня"
    if days == 1:
        return "завтра"
    return f"через {plural_days(days)}"


def money(item: ReminderItem) -> str:
    """Сумма и код валюты — валюта всегда указана явно."""
    return f"{format_amount(item.amount_minor, item.currency)} ({item.currency})"


def _paid_note(item: ReminderItem) -> str:
    late = (item.paid_at - item.due_date).days
    timing = "вовремя" if late <= 0 else f"с опозданием на {plural_days(late)}"
    who = f" · {escape(item.paid_by_label)}" if item.paid_by_label else ""
    return f"оплачено {fmt_date(item.paid_at)}, {timing}{who}"


def _header(unpaid: list[ReminderItem], today: date) -> str:
    if not unpaid:
        return "✅ <b>Оплачено</b>"
    overdue = [i for i in unpaid if i.due_date < today]
    if len(unpaid) > 1:
        if overdue:
            return f"⚠️ <b>Просрочено платежей: {len(overdue)}</b>"
        return f"🔔 <b>Скоро оплата: {len(unpaid)}</b>"
    days = (unpaid[0].due_date - today).days
    if days < 0:
        return f"⚠️ <b>Платёж просрочен на {plural_days(-days)}</b>"
    if days == 0:
        return "⏰ <b>Срок оплаты — сегодня</b>"
    if days == 1:
        return "🔔 <b>Скоро оплата — завтра</b>"
    return f"🔔 <b>Скоро оплата — через {plural_days(days)}</b>"


def render_reminder(reminder: Reminder) -> tuple[str, list[tuple[str, int]]]:
    """Текст напоминания и кнопки «Оплачено» для ещё неоплаченных периодов."""
    items, today = reminder.items, reminder.today
    unpaid = [i for i in items if i.paid_at is None]

    lines = [_header(unpaid, today), "", f"<b>{escape(reminder.payment_name)}</b>"]
    if len(items) == 1:
        item = items[0]
        lines.append(f"💰 <b>{money(item)}</b>")
        lines.append(f"📅 Срок: <b>{fmt_date_wd(item.due_date)}</b>")
        if item.paid_at:
            lines.append(f"✔️ {_paid_note(item)}")
    else:
        for item in items:
            status = f"✔️ {_paid_note(item)}" if item.paid_at else relative_due(item.due_date, today)
            if item.paid_at is None and item.due_date < today:
                status = f"⚠️ {status}"
            lines.append(f"• {fmt_date(item.due_date)} — {money(item)} — {status}")

    if not reminder.payment_active and unpaid:
        lines += ["", "<i>Регулярный платёж прекращён — новых напоминаний по нему не будет.</i>"]
    elif unpaid:
        hint = "Оплатили? Нажмите «Оплачено» — отметим сегодняшней датой."
        if len(unpaid) > 1:
            hint = "Оплатили? Нажмите кнопку с нужным сроком — отметим сегодняшней датой."
        lines += ["", f"<i>{hint} Другую дату можно указать в панели.</i>"]

    if len(items) == 1:
        buttons = [("✅ Оплачено", unpaid[0].occurrence_id)] if unpaid else []
    else:
        buttons = [(f"✅ Оплачено за {i.due_date:%d.%m}", i.occurrence_id) for i in unpaid]
    return "\n".join(lines), buttons
