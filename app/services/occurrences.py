"""Периоды регулярных платежей: генерация, отметка оплаты, выборки."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import StrEnum

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, contains_eager

from app.domain.schedule import Frequency, due_dates_to_ensure
from app.errors import not_found, unprocessable
from app.models import PaymentOccurrence, RecurringPayment
from app.services import audit
from app.services.audit import Actor


def _insert_ignore(db: Session, rows: list[dict]) -> None:
    """Вставка периодов, пропускающая уже существующие (уникальность платёж+срок)."""
    if not rows:
        return
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    stmt = insert(PaymentOccurrence).values(rows)
    db.execute(stmt.on_conflict_do_nothing(index_elements=["recurring_payment_id", "due_date"]))


def generate_for_payment(db: Session, payment: RecurringPayment, today: date, remind_days: int) -> int:
    """Создаёт недостающие периоды платежа. Идемпотентно. Возвращает число новых периодов.

    remind_days — общее окно напоминания; если у платежа задано своё, берётся оно.
    """
    if not payment.is_active:
        return 0
    rows = db.execute(
        select(PaymentOccurrence.due_date, PaymentOccurrence.paid_at).where(
            PaymentOccurrence.recurring_payment_id == payment.id
        )
    ).all()
    existing = {due: paid_at for due, paid_at in rows}
    horizon = today + timedelta(days=payment.remind_days_or(remind_days))
    wanted = due_dates_to_ensure(
        payment.anchor_date,
        Frequency(payment.frequency),
        horizon,
        is_paid=lambda due: existing.get(due) is not None,
    )
    # Пока платёж был прекращён, сроки не наступали — после возобновления график идёт с даты возобновления.
    missing = [due for due in wanted if due not in existing and (payment.resumed_on is None or due >= payment.resumed_on)]
    _insert_ignore(
        db,
        [
            {
                "recurring_payment_id": payment.id,
                "due_date": due,
                "amount_minor": payment.amount_minor,
                "currency": payment.currency,
            }
            for due in missing
        ],
    )
    return len(missing)


def generate_all(db: Session, today: date, remind_days: int) -> int:
    payments = db.scalars(select(RecurringPayment).where(RecurringPayment.deleted_at.is_(None))).all()
    return sum(generate_for_payment(db, payment, today, remind_days) for payment in payments)


def get_occurrence(db: Session, occurrence_id: int) -> PaymentOccurrence:
    occurrence = db.get(PaymentOccurrence, occurrence_id)
    if occurrence is None:
        raise not_found("Платёж")
    return occurrence


class SortOrder(StrEnum):
    DUE_ASC = "due_date"
    DUE_DESC = "-due_date"


@dataclass(frozen=True)
class OccurrenceFilter:
    status: str | None = None  # "paid" | "unpaid"
    overdue: bool | None = None
    currency: str | None = None
    recurring_payment_id: int | None = None
    date_from: date | None = None
    date_to: date | None = None
    include_inactive: bool = True
    category_id: int | None = None  # 0 — без категории


def overdue_condition(today: date):
    return or_(
        and_(PaymentOccurrence.paid_at.is_(None), PaymentOccurrence.due_date < today),
        PaymentOccurrence.paid_at > PaymentOccurrence.due_date,
    )


def list_occurrences(
    db: Session,
    flt: OccurrenceFilter,
    today: date,
    *,
    sort: SortOrder = SortOrder.DUE_ASC,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[PaymentOccurrence], int]:
    query = (
        select(PaymentOccurrence)
        .join(PaymentOccurrence.recurring_payment)
        .options(contains_eager(PaymentOccurrence.recurring_payment))
    )
    if flt.status == "paid":
        query = query.where(PaymentOccurrence.paid_at.is_not(None))
    elif flt.status == "unpaid":
        query = query.where(PaymentOccurrence.paid_at.is_(None))
    if flt.overdue is True:
        query = query.where(overdue_condition(today))
    elif flt.overdue is False:
        query = query.where(~overdue_condition(today))
    if flt.currency:
        query = query.where(PaymentOccurrence.currency == flt.currency)
    if flt.category_id == 0:
        query = query.where(RecurringPayment.category_id.is_(None))
    elif flt.category_id is not None:
        query = query.where(RecurringPayment.category_id == flt.category_id)
    if flt.recurring_payment_id is not None:
        query = query.where(PaymentOccurrence.recurring_payment_id == flt.recurring_payment_id)
    if flt.date_from:
        query = query.where(PaymentOccurrence.due_date >= flt.date_from)
    if flt.date_to:
        query = query.where(PaymentOccurrence.due_date <= flt.date_to)
    if not flt.include_inactive:
        query = query.where(RecurringPayment.deleted_at.is_(None))

    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
    if sort is SortOrder.DUE_DESC:
        query = query.order_by(PaymentOccurrence.due_date.desc(), RecurringPayment.name)
    else:
        query = query.order_by(PaymentOccurrence.due_date, RecurringPayment.name)
    items = db.scalars(query.limit(limit).offset(offset)).unique().all()
    return list(items), total


def set_paid(
    db: Session,
    occurrence: PaymentOccurrence,
    paid_at: date | None,
    *,
    today: date,
    now: datetime,
    actor: Actor,
    via: str = "web",
) -> bool:
    """Ставит/снимает/исправляет фактическую дату оплаты. Возвращает True, если что-то изменилось."""
    if paid_at is not None and paid_at > today:
        raise unprocessable("paid_at_in_future", "Фактическая дата оплаты не может быть в будущем")

    previous = occurrence.paid_at
    if paid_at == previous:
        return False

    details = {"due_date": occurrence.due_date.isoformat(), "from": _iso(previous), "to": _iso(paid_at)}
    if paid_at is None:
        action = "occurrence.unpay"
        occurrence.paid_at = None
        occurrence.paid_by = None
        occurrence.paid_via = None
        occurrence.paid_by_label = None
        occurrence.paid_marked_at = None
    elif previous is None:
        action = "occurrence.pay"
        occurrence.paid_at = paid_at
        occurrence.paid_by = actor.user_id
        occurrence.paid_via = via
        occurrence.paid_by_label = actor.label
        occurrence.paid_marked_at = now
        details["via"] = via
    else:
        action = "occurrence.correct_date"
        occurrence.paid_at = paid_at

    audit.record(db, actor, action, "payment_occurrence", occurrence.id, details)
    db.flush()
    # Оплата заранее может потребовать показать следующий период.
    return True


def update_occurrence(
    db: Session,
    occurrence_id: int,
    *,
    fields: set[str],
    paid: bool | None,
    paid_at: date | None,
    receipt_url: str | None,
    today: date,
    now: datetime,
    remind_days: int,
    actor: Actor,
    comment: str | None = None,
) -> PaymentOccurrence:
    occurrence = get_occurrence(db, occurrence_id)
    if not fields:
        raise unprocessable("no_changes", "Не передано ни одного поля для изменения")

    target = occurrence.paid_at
    if "paid" in fields and paid is not None:
        if paid is False:
            if paid_at is not None:
                raise unprocessable("paid_at_with_unpaid", "При отмене оплаты фактическую дату указывать нельзя")
            target = None
        else:
            target = paid_at or today
    elif "paid_at" in fields:
        target = paid_at

    set_paid(db, occurrence, target, today=today, now=now, actor=actor)

    if "receipt_url" in fields and receipt_url != occurrence.receipt_url:
        occurrence.receipt_url = receipt_url
        audit.record(db, actor, "occurrence.receipt", "payment_occurrence", occurrence.id, {"url": receipt_url})

    if "comment" in fields:
        comment = comment or None  # пустая строка — убрать комментарий
        if comment != occurrence.comment:
            occurrence.comment = comment
            audit.record(db, actor, "occurrence.comment", "payment_occurrence", occurrence.id,
                         {"due_date": occurrence.due_date.isoformat(), "comment": comment})

    generate_for_payment(db, occurrence.recurring_payment, today, remind_days)
    db.flush()
    return occurrence


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None
