"""Календарь и бюджет: реальные периоды + плановые сроки по графикам активных платежей."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, contains_eager

from app.domain.schedule import Frequency, iter_due_dates
from app.models import PaymentOccurrence, RecurringPayment


@dataclass(frozen=True)
class ForecastItem:
    recurring_payment_id: int
    name: str
    due_date: date
    amount_minor: int
    currency: str
    occurrence: PaymentOccurrence | None  # None — плановый срок, период ещё не создан


def forecast(db: Session, date_from: date, date_to: date, today: date) -> list[ForecastItem]:
    occurrences = db.scalars(
        select(PaymentOccurrence)
        .join(PaymentOccurrence.recurring_payment)
        .options(contains_eager(PaymentOccurrence.recurring_payment))
        .where(PaymentOccurrence.due_date >= date_from, PaymentOccurrence.due_date <= date_to)
    ).unique().all()

    items = [
        ForecastItem(o.recurring_payment_id, o.recurring_payment.name, o.due_date, o.amount_minor, o.currency, o)
        for o in occurrences
    ]
    existing = {(o.recurring_payment_id, o.due_date) for o in occurrences}

    payments = db.scalars(select(RecurringPayment).where(RecurringPayment.deleted_at.is_(None))).all()
    for payment in payments:
        for due in iter_due_dates(payment.anchor_date, Frequency(payment.frequency)):
            if due > date_to:
                break
            # прошлые сроки без периода не выдумываем — только будущие плановые
            if due < date_from or due < today or (payment.id, due) in existing:
                continue
            items.append(ForecastItem(payment.id, payment.name, due, payment.amount_minor, payment.currency, None))

    items.sort(key=lambda i: (i.due_date, i.name))
    return items
