"""Итоги по валютам. Валюты никогда не смешиваются и не конвертируются."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.money import Currency
from app.models import PaymentOccurrence


@dataclass
class Total:
    amount_minor: int = 0
    count: int = 0


@dataclass
class CurrencyTotals:
    currency: Currency
    paid: Total = field(default_factory=Total)
    unpaid: Total = field(default_factory=Total)
    overdue: Total = field(default_factory=Total)


def _totals(db: Session, *conditions) -> dict[str, Total]:
    rows = db.execute(
        select(PaymentOccurrence.currency, func.sum(PaymentOccurrence.amount_minor), func.count())
        .where(*conditions)
        .group_by(PaymentOccurrence.currency)
    ).all()
    return {currency: Total(int(amount or 0), int(count)) for currency, amount, count in rows}


def summarize(db: Session, today: date, date_from: date | None, date_to: date | None) -> list[CurrencyTotals]:
    """paid — фактические оплаты (по дате оплаты); unpaid и overdue — неоплаченные периоды (по сроку)."""
    paid_conditions = [PaymentOccurrence.paid_at.is_not(None)]
    due_conditions = [PaymentOccurrence.paid_at.is_(None)]
    if date_from:
        paid_conditions.append(PaymentOccurrence.paid_at >= date_from)
        due_conditions.append(PaymentOccurrence.due_date >= date_from)
    if date_to:
        paid_conditions.append(PaymentOccurrence.paid_at <= date_to)
        due_conditions.append(PaymentOccurrence.due_date <= date_to)

    paid = _totals(db, *paid_conditions)
    unpaid = _totals(db, *due_conditions)
    overdue = _totals(db, *due_conditions, PaymentOccurrence.due_date < today)

    empty = Total()
    return [
        CurrencyTotals(
            currency=currency,
            paid=paid.get(currency.value, empty),
            unpaid=unpaid.get(currency.value, empty),
            overdue=overdue.get(currency.value, empty),
        )
        for currency in Currency
    ]
