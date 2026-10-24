from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request, Response, status

from app.api.deps import AdminUser, ContainerDep, CurrentUser, DbDep, actor_for
from app.domain.money import Currency
from app.errors import unprocessable
from app.schemas import (
    CurrencySummaryOut,
    ForecastItemOut,
    ForecastOut,
    ForecastTotalOut,
    OccurrenceOut,
    OccurrenceUpdate,
    Page,
    RecurringPaymentCreate,
    RecurringPaymentOut,
    RecurringPaymentUpdate,
    SummaryOut,
    TotalOut,
)
from app.domain.money import from_minor
from app.services import occurrences as occurrences_service
from app.services import recurring as recurring_service
from app.services import summary as summary_service
from app.services.forecast import forecast as build_forecast
from app.domain.occurrence_state import compute_state
from app.services.occurrences import OccurrenceFilter, SortOrder

recurring_router = APIRouter(prefix="/recurring-payments", tags=["Регулярные платежи"])
occurrences_router = APIRouter(prefix="/payment-occurrences", tags=["Платежи (периоды)"])
summary_router = APIRouter(prefix="/payments", tags=["Итоги"])


def _payment_out(db, container, payment) -> RecurringPaymentOut:
    today = container.clock.today()
    [item] = recurring_service.overview(db, [payment], today)
    return RecurringPaymentOut.build(item.payment, item.next_due_date, item.next_occurrence, item.overdue_count,
                                     today, container.settings.reminder_days_before)


def _refresh_periods(db, container) -> None:
    """Досоздать периоды на сегодня, не дожидаясь фонового цикла (например, сразу после полуночи)."""
    if occurrences_service.generate_all(db, container.clock.today(), container.settings.reminder_days_before):
        db.commit()


# --- регулярные платежи ------------------------------------------------------


@recurring_router.get("", response_model=list[RecurringPaymentOut], summary="Получение списка регулярных платежей")
def list_recurring(
    user: CurrentUser,
    db: DbDep,
    container: ContainerDep,
    include_deleted: Annotated[bool, Query(description="Включить прекращённые платежи")] = False,
):
    today = container.clock.today()
    _refresh_periods(db, container)
    payments = recurring_service.list_payments(db, include_deleted)
    return [
        RecurringPaymentOut.build(i.payment, i.next_due_date, i.next_occurrence, i.overdue_count, today,
                                  container.settings.reminder_days_before)
        for i in recurring_service.overview(db, payments, today)
    ]


@recurring_router.post(
    "",
    response_model=RecurringPaymentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создание регулярного платежа",
    description="Если до срока меньше дней, чем окно напоминания, напоминание уходит сразу.",
)
def create_recurring(payload: RecurringPaymentCreate, request: Request, admin: AdminUser, db: DbDep,
                     container: ContainerDep):
    payment = recurring_service.create_payment(
        db,
        actor_for(request, admin),
        name=payload.name,
        amount=payload.amount,
        currency=payload.currency.value,
        next_due_date=payload.next_due_date,
        frequency=payload.frequency.value,
        today=container.clock.today(),
        remind_days=container.settings.reminder_days_before,
    )
    db.commit()
    container.reminders.wake()
    return _payment_out(db, container, payment)


@recurring_router.get("/{payment_id}", response_model=RecurringPaymentOut, summary="Получение регулярного платежа")
def get_recurring(payment_id: int, user: CurrentUser, db: DbDep, container: ContainerDep):
    return _payment_out(db, container, recurring_service.get_payment(db, payment_id))


@recurring_router.patch(
    "/{payment_id}",
    response_model=RecurringPaymentOut,
    summary="Изменение регулярного платежа",
    description=(
        "Название, сумма и валюта меняются у шаблона и у неоплаченных периодов со сроком от сегодня; "
        "оплаченные и прошлые периоды не меняются. Смена даты или периодичности пересоздаёт будущие "
        "неоплаченные периоды по новому графику."
    ),
)
def update_recurring(payment_id: int, payload: RecurringPaymentUpdate, request: Request, admin: AdminUser,
                     db: DbDep, container: ContainerDep):
    payment = recurring_service.update_payment(
        db,
        actor_for(request, admin),
        payment_id,
        fields=set(payload.model_fields_set),
        name=payload.name,
        amount=payload.amount,
        currency=payload.currency.value if payload.currency else None,
        next_due_date=payload.next_due_date,
        frequency=payload.frequency.value if payload.frequency else None,
        today=container.clock.today(),
        remind_days=container.settings.reminder_days_before,
    )
    db.commit()
    container.reminders.wake()
    return _payment_out(db, container, payment)


@recurring_router.delete(
    "/{payment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Прекращение регулярного платежа и его напоминаний с сохранением истории",
)
def delete_recurring(payment_id: int, request: Request, admin: AdminUser, db: DbDep, container: ContainerDep):
    recurring_service.stop_payment(
        db, actor_for(request, admin), payment_id, today=container.clock.today(), now=container.clock.now()
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- периоды -------------------------------------------------------------------


@occurrences_router.get(
    "",
    response_model=Page[OccurrenceOut],
    summary="Получение списка платежей, оплаченные и просроченные",
)
def list_occurrences(
    user: CurrentUser,
    db: DbDep,
    container: ContainerDep,
    status_: Annotated[Literal["paid", "unpaid"] | None, Query(alias="status", description="paid / unpaid")] = None,
    overdue: Annotated[bool | None, Query(description="true — только с просрочкой")] = None,
    currency: Currency | None = None,
    recurring_payment_id: int | None = None,
    date_from: Annotated[date | None, Query(alias="from", description="Срок не раньше")] = None,
    date_to: Annotated[date | None, Query(alias="to", description="Срок не позже")] = None,
    include_inactive: Annotated[bool, Query(description="Включать периоды прекращённых платежей")] = True,
    sort: SortOrder = SortOrder.DUE_ASC,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    today = container.clock.today()
    _refresh_periods(db, container)
    flt = OccurrenceFilter(
        status=status_,
        overdue=overdue,
        currency=currency.value if currency else None,
        recurring_payment_id=recurring_payment_id,
        date_from=date_from,
        date_to=date_to,
        include_inactive=include_inactive,
    )
    items, total = occurrences_service.list_occurrences(db, flt, today, sort=sort, limit=limit, offset=offset)
    remind_days = container.settings.reminder_days_before
    return Page[OccurrenceOut](
        items=[OccurrenceOut.build(o, today, remind_days) for o in items], total=total, limit=limit, offset=offset
    )


@occurrences_router.get("/{occurrence_id}", response_model=OccurrenceOut, summary="Получение конкретного платежа")
def get_occurrence(occurrence_id: int, user: CurrentUser, db: DbDep, container: ContainerDep):
    occurrence = occurrences_service.get_occurrence(db, occurrence_id)
    return OccurrenceOut.build(occurrence, container.clock.today(), container.settings.reminder_days_before)


@occurrences_router.patch(
    "/{occurrence_id}",
    response_model=OccurrenceOut,
    summary="Подтверждение или отмена оплаты, исправление фактической даты оплаты",
)
def update_occurrence(occurrence_id: int, payload: OccurrenceUpdate, request: Request, user: CurrentUser,
                      db: DbDep, container: ContainerDep):
    today = container.clock.today()
    remind_days = container.settings.reminder_days_before
    occurrence = occurrences_service.update_occurrence(
        db,
        occurrence_id,
        fields=set(payload.model_fields_set),
        paid=payload.paid,
        paid_at=payload.paid_at,
        receipt_url=str(payload.receipt_url) if payload.receipt_url else None,
        today=today,
        now=container.clock.now(),
        remind_days=remind_days,
        actor=actor_for(request, user),
    )
    db.commit()
    container.reminders.wake()
    container.reminders.schedule_refresh(occurrence.id)
    db.refresh(occurrence)
    return OccurrenceOut.build(occurrence, today, remind_days)


# --- итоги ---------------------------------------------------------------------


@summary_router.get(
    "/summary",
    response_model=SummaryOut,
    summary="Получение итоговых сумм платежей по валютам",
    description=(
        "Суммы считаются отдельно по каждой валюте, без конвертации. "
        "paid — фактические оплаты (фильтр по дате оплаты), unpaid/overdue — неоплаченные периоды (фильтр по сроку)."
    ),
)
def get_summary(
    user: CurrentUser,
    db: DbDep,
    container: ContainerDep,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
):
    if date_from and date_to and date_from > date_to:
        raise unprocessable("invalid_range", "Дата «с» позже даты «по»")
    today = container.clock.today()
    totals = summary_service.summarize(db, today, date_from, date_to)

    def total(t) -> TotalOut:
        return TotalOut(amount=from_minor(t.amount_minor), count=t.count)

    return SummaryOut(
        today=today,
        date_from=date_from,
        date_to=date_to,
        currencies=[
            CurrencySummaryOut(currency=t.currency, paid=total(t.paid), unpaid=total(t.unpaid), overdue=total(t.overdue))
            for t in totals
        ],
    )


@summary_router.get(
    "/forecast",
    response_model=ForecastOut,
    summary="Календарь оплат и бюджет за период",
    description=(
        "Реальные периоды и плановые сроки по графикам активных платежей за выбранный диапазон "
        "(не более 400 дней). Итоги — отдельно по каждой валюте: план, оплачено, осталось."
    ),
)
def get_forecast(
    user: CurrentUser,
    db: DbDep,
    container: ContainerDep,
    date_from: Annotated[date, Query(alias="from")],
    date_to: Annotated[date, Query(alias="to")],
):
    if date_from > date_to:
        raise unprocessable("invalid_range", "Дата «с» позже даты «по»")
    if (date_to - date_from).days > 400:
        raise unprocessable("range_too_large", "Диапазон не может быть больше 400 дней")
    today = container.clock.today()
    remind_days = container.settings.reminder_days_before
    _refresh_periods(db, container)

    items: list[ForecastItemOut] = []
    totals = {c: {"planned": [0, 0], "paid": [0, 0], "remaining": [0, 0]} for c in Currency}
    for item in build_forecast(db, date_from, date_to, today):
        occ = item.occurrence
        if occ is None:
            status_value, state, paid_at = "planned", None, None
        else:
            paid_at = occ.paid_at
            status_value = "paid" if paid_at else "unpaid"
            state = compute_state(occ.due_date, paid_at, today, remind_days).state
        items.append(ForecastItemOut(
            recurring_payment_id=item.recurring_payment_id, name=item.name, due_date=item.due_date,
            amount=from_minor(item.amount_minor), currency=item.currency, status=status_value,
            occurrence_id=occ.id if occ else None, state=state, paid_at=paid_at,
        ))
        bucket = totals[Currency(item.currency)]
        for key in ("planned", "paid" if status_value == "paid" else "remaining"):
            bucket[key][0] += item.amount_minor
            bucket[key][1] += 1

    return ForecastOut(
        date_from=date_from,
        date_to=date_to,
        items=items,
        totals=[
            ForecastTotalOut(
                currency=currency,
                **{k: TotalOut(amount=from_minor(v[0]), count=v[1]) for k, v in buckets.items()},
            )
            for currency, buckets in totals.items()
        ],
    )
