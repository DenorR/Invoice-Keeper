"""Регулярные платежи: создание, редактирование, прекращение."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.domain.money import to_minor
from app.domain.schedule import Frequency, first_due_on_or_after
from app.errors import conflict, not_found, unprocessable
from app.models import PaymentOccurrence, RecurringPayment
from app.services import audit
from app.services.audit import Actor
from app.services.occurrences import generate_for_payment


@dataclass
class PaymentOverview:
    """Регулярный платёж + сводка по его периодам для списка."""

    payment: RecurringPayment
    next_due_date: date | None
    next_occurrence: PaymentOccurrence | None
    overdue_count: int


def get_payment(db: Session, payment_id: int) -> RecurringPayment:
    payment = db.get(RecurringPayment, payment_id)
    if payment is None:
        raise not_found("Регулярный платёж")
    return payment


def current_next_due(db: Session, payment: RecurringPayment, today: date) -> date | None:
    """Ближайший неоплаченный срок начиная с сегодняшнего дня («дата ближайшей оплаты»)."""
    if not payment.is_active:
        return None
    upcoming = db.scalar(
        select(PaymentOccurrence.due_date)
        .where(
            PaymentOccurrence.recurring_payment_id == payment.id,
            PaymentOccurrence.paid_at.is_(None),
            PaymentOccurrence.due_date >= today,
        )
        .order_by(PaymentOccurrence.due_date)
        .limit(1)
    )
    if upcoming is not None:
        return upcoming
    paid_dates = set(
        db.scalars(
            select(PaymentOccurrence.due_date).where(
                PaymentOccurrence.recurring_payment_id == payment.id,
                PaymentOccurrence.paid_at.is_not(None),
            )
        ).all()
    )
    due = first_due_on_or_after(payment.anchor_date, Frequency(payment.frequency), today)
    while due in paid_dates:
        due = first_due_on_or_after(payment.anchor_date, Frequency(payment.frequency), due + timedelta(days=1))
    return due


def overview(db: Session, payments: list[RecurringPayment], today: date) -> list[PaymentOverview]:
    ids = [payment.id for payment in payments]
    unpaid = db.scalars(
        select(PaymentOccurrence)
        .where(PaymentOccurrence.recurring_payment_id.in_(ids), PaymentOccurrence.paid_at.is_(None))
        .order_by(PaymentOccurrence.due_date)
    ).all() if ids else []
    by_payment: dict[int, list[PaymentOccurrence]] = {}
    for occurrence in unpaid:
        by_payment.setdefault(occurrence.recurring_payment_id, []).append(occurrence)

    result = []
    for payment in payments:
        items = by_payment.get(payment.id, [])
        result.append(
            PaymentOverview(
                payment=payment,
                next_due_date=current_next_due(db, payment, today),
                next_occurrence=items[0] if items else None,
                overdue_count=sum(1 for item in items if item.due_date < today),
            )
        )
    return result


def list_payments(db: Session, include_deleted: bool) -> list[RecurringPayment]:
    query = select(RecurringPayment)
    if not include_deleted:
        query = query.where(RecurringPayment.deleted_at.is_(None))
    return list(db.scalars(query.order_by(RecurringPayment.deleted_at.is_not(None), RecurringPayment.name)).all())


def create_payment(
    db: Session,
    actor: Actor,
    *,
    name: str,
    amount,
    currency: str,
    next_due_date: date,
    frequency: str,
    today: date,
    remind_days: int,
) -> RecurringPayment:
    payment = RecurringPayment(
        name=name,
        amount_minor=to_minor(amount),
        currency=currency,
        anchor_date=next_due_date,
        frequency=frequency,
        created_by=actor.user_id,
    )
    db.add(payment)
    db.flush()
    generate_for_payment(db, payment, today, remind_days)
    audit.record(
        db,
        actor,
        "recurring.create",
        "recurring_payment",
        payment.id,
        {"name": name, "amount": str(amount), "currency": currency,
         "next_due_date": next_due_date.isoformat(), "frequency": frequency},
    )
    db.flush()
    return payment


def update_payment(
    db: Session,
    actor: Actor,
    payment_id: int,
    *,
    fields: set[str],
    name: str | None,
    amount,
    currency: str | None,
    next_due_date: date | None,
    frequency: str | None,
    today: date,
    remind_days: int,
) -> RecurringPayment:
    payment = get_payment(db, payment_id)
    if not payment.is_active:
        raise conflict("payment_stopped", "Платёж прекращён — редактирование недоступно")
    if not fields:
        raise unprocessable("no_changes", "Не передано ни одного поля для изменения")

    changes: dict[str, object] = {}
    if "name" in fields and name is not None and name != payment.name:
        changes["name"] = {"from": payment.name, "to": name}
        payment.name = name

    new_amount = to_minor(amount) if "amount" in fields and amount is not None else payment.amount_minor
    new_currency = currency if "currency" in fields and currency is not None else payment.currency
    if (new_amount, new_currency) != (payment.amount_minor, payment.currency):
        changes["amount"] = {"from": f"{payment.amount_minor / 100:.2f} {payment.currency}",
                             "to": f"{new_amount / 100:.2f} {new_currency}"}
        payment.amount_minor, payment.currency = new_amount, new_currency
        # Оплаченные и прошлые периоды — история, их суммы не трогаем.
        db.execute(
            update(PaymentOccurrence)
            .where(
                PaymentOccurrence.recurring_payment_id == payment.id,
                PaymentOccurrence.paid_at.is_(None),
                PaymentOccurrence.due_date >= today,
            )
            .values(amount_minor=new_amount, currency=new_currency)
        )

    old_next = current_next_due(db, payment, today)
    new_frequency = frequency if "frequency" in fields and frequency is not None else payment.frequency
    new_anchor = next_due_date if "next_due_date" in fields and next_due_date is not None else old_next
    if new_frequency != payment.frequency or new_anchor != old_next:
        if new_anchor is None or new_anchor < today:
            raise unprocessable(
                "next_due_date_in_past", "При изменении графика дата ближайшей оплаты не может быть в прошлом"
            )
        changes["schedule"] = {
            "from": {"next_due_date": _iso(old_next), "frequency": payment.frequency},
            "to": {"next_due_date": new_anchor.isoformat(), "frequency": new_frequency},
        }
        # Будущие неоплаченные периоды пересоздаются по новому графику.
        db.execute(
            delete(PaymentOccurrence).where(
                PaymentOccurrence.recurring_payment_id == payment.id,
                PaymentOccurrence.paid_at.is_(None),
                PaymentOccurrence.due_date >= today,
            )
        )
        payment.anchor_date = new_anchor
        payment.frequency = new_frequency

    db.flush()
    generate_for_payment(db, payment, today, remind_days)
    if changes:
        audit.record(db, actor, "recurring.update", "recurring_payment", payment.id, changes)
    db.flush()
    db.expire_all()
    return get_payment(db, payment_id)


def stop_payment(db: Session, actor: Actor, payment_id: int, *, today: date, now: datetime) -> None:
    """Прекращает платёж: новых периодов и напоминаний больше нет, история остаётся."""
    payment = get_payment(db, payment_id)
    if not payment.is_active:
        return
    payment.deleted_at = now
    removed = db.execute(
        delete(PaymentOccurrence).where(
            PaymentOccurrence.recurring_payment_id == payment.id,
            PaymentOccurrence.paid_at.is_(None),
            PaymentOccurrence.due_date > today,
        )
    ).rowcount
    audit.record(db, actor, "recurring.delete", "recurring_payment", payment.id,
                 {"name": payment.name, "removed_future_periods": removed})
    db.flush()


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None
