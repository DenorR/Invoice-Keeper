"""Регулярные платежи: создание, редактирование, прекращение и возобновление."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.domain.money import to_minor
from app.domain.schedule import Frequency, first_due_on_or_after
from app.errors import ApiError, conflict, not_found, unprocessable
from app.models import PaymentOccurrence, RecurringPayment
from app.services import audit
from app.services import categories as categories_service
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


def get_payments(db: Session, payment_ids: list[int]) -> list[RecurringPayment]:
    """Платежи в порядке переданных id; если какого-то нет — 404 со списком недостающих."""
    found = {p.id: p for p in db.scalars(select(RecurringPayment).where(RecurringPayment.id.in_(payment_ids))).all()}
    missing = [payment_id for payment_id in payment_ids if payment_id not in found]
    if missing:
        raise ApiError(404, "not_found", "Регулярный платёж не найден", {"missing_ids": missing})
    return [found[payment_id] for payment_id in payment_ids]


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
    payment_remind_days: int | None = None,
    category_id: int | None = None,
) -> RecurringPayment:
    categories_service.ensure_exists(db, category_id)
    payment = RecurringPayment(
        name=name,
        amount_minor=to_minor(amount),
        currency=currency,
        anchor_date=next_due_date,
        frequency=frequency,
        remind_days=payment_remind_days,
        category_id=category_id,
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
         "next_due_date": next_due_date.isoformat(), "frequency": frequency,
         **({"remind_days": payment_remind_days} if payment_remind_days is not None else {}),
         **({"category_id": category_id} if category_id is not None else {})},
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
    payment_remind_days: int | None = None,
    category_id: int | None = None,
) -> RecurringPayment:
    payment = get_payment(db, payment_id)
    if not fields:
        raise unprocessable("no_changes", "Не передано ни одного поля для изменения")
    # категорию можно менять и у прекращённого платежа — это только группировка, график не затрагивается
    if not payment.is_active and fields - {"category_id"}:
        raise conflict("payment_stopped", "Платёж прекращён — редактирование недоступно")

    changes: dict[str, object] = {}
    if "category_id" in fields and category_id != payment.category_id:
        categories_service.ensure_exists(db, category_id)
        changes["category_id"] = {"from": payment.category_id, "to": category_id}
        payment.category_id = category_id
    if not payment.is_active:
        if changes:
            audit.record(db, actor, "recurring.update", "recurring_payment", payment.id, changes)
        db.flush()
        db.expire_all()
        return get_payment(db, payment_id)

    if "name" in fields and name is not None and name != payment.name:
        changes["name"] = {"from": payment.name, "to": name}
        payment.name = name

    # null — вернуть общую настройку
    if "remind_days" in fields and payment_remind_days != payment.remind_days:
        changes["remind_days"] = {"from": payment.remind_days, "to": payment_remind_days}
        payment.remind_days = payment_remind_days

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


def set_category(db: Session, actor: Actor, payment: RecurringPayment, category_id: int | None) -> bool:
    """Переносит платёж в категорию (None — без категории). Возвращает False, если он уже там."""
    if payment.category_id == category_id:
        return False
    audit.record(db, actor, "recurring.update", "recurring_payment", payment.id,
                 {"category_id": {"from": payment.category_id, "to": category_id}})
    payment.category_id = category_id
    db.flush()
    return True


def stop_payment(db: Session, actor: Actor, payment_id: int, *, today: date, now: datetime) -> bool:
    """Прекращает платёж: новых периодов и напоминаний больше нет, история остаётся.

    Возвращает False, если платёж уже был прекращён.
    """
    payment = get_payment(db, payment_id)
    if not payment.is_active:
        return False
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
    return True


def restore_payment(db: Session, actor: Actor, payment_id: int, *, today: date, remind_days: int) -> bool:
    """Возобновляет прекращённый платёж: график продолжается с сегодняшнего дня.

    Сроки, которые пришлись на время, пока платёж был прекращён, не создаются задним числом —
    иначе возобновление сразу дало бы пачку «просрочек». Возвращает False, если платёж уже активен.
    """
    payment = get_payment(db, payment_id)
    if payment.is_active:
        return False
    stopped_at = payment.deleted_at
    payment.deleted_at = None
    payment.resumed_on = today
    db.flush()
    created = generate_for_payment(db, payment, today, remind_days)
    audit.record(db, actor, "recurring.restore", "recurring_payment", payment.id,
                 {"name": payment.name, "stopped_at": stopped_at.isoformat() if stopped_at else None,
                  "created_periods": created})
    db.flush()
    return True


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None
