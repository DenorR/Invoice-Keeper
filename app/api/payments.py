from __future__ import annotations

from datetime import date
from typing import Annotated, Literal
from urllib.parse import quote, unquote

from fastapi import APIRouter, Header, Query, Request, Response, status
from starlette.concurrency import run_in_threadpool

from app.api.deps import AdminUser, ContainerDep, CurrentUser, DbDep, actor_for
from app.domain.money import Currency
from app.errors import ApiError, not_found, unprocessable
from app.schemas import (
    BulkCategory,
    BulkIds,
    BulkResultOut,
    CurrencySummaryOut,
    ErrorResponse,
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
from app.services import app_settings
from app.services import categories as categories_service
from app.services import occurrences as occurrences_service
from app.services import receipts as receipts_service
from app.services import recurring as recurring_service
from app.services import summary as summary_service
from app.services.forecast import forecast as build_forecast
from app.domain.occurrence_state import compute_state
from app.services.occurrences import OccurrenceFilter, SortOrder

recurring_router = APIRouter(prefix="/recurring-payments", tags=["Регулярные платежи"])
occurrences_router = APIRouter(prefix="/payment-occurrences", tags=["Платежи (периоды)"])
summary_router = APIRouter(prefix="/payments", tags=["Итоги"])


def _remind_days(db, container) -> int:
    """Общее окно напоминания: из «Настроек» панели, по умолчанию — REMINDER_DAYS_BEFORE из .env."""
    return app_settings.reminder_days(db, container.settings.reminder_days_before)


def _payment_out(db, container, payment) -> RecurringPaymentOut:
    today = container.clock.today()
    [item] = recurring_service.overview(db, [payment], today)
    return RecurringPaymentOut.build(item.payment, item.next_due_date, item.next_occurrence, item.overdue_count,
                                     today, _remind_days(db, container))


def _refresh_periods(db, container) -> None:
    """Досоздать периоды на сегодня, не дожидаясь фонового цикла (например, сразу после полуночи)."""
    if occurrences_service.generate_all(db, container.clock.today(), _remind_days(db, container)):
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
                                  _remind_days(db, container))
        for i in recurring_service.overview(db, payments, today)
    ]


@recurring_router.post(
    "",
    response_model=RecurringPaymentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создание регулярного платежа",
    description=(
        "Если до срока меньше дней, чем окно напоминания, напоминание уходит сразу. "
        "remind_days — своё окно для этого платежа; не задано — действует общая настройка."
    ),
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
        remind_days=_remind_days(db, container),
        payment_remind_days=payload.remind_days,
        category_id=payload.category_id,
    )
    db.commit()
    container.reminders.wake()
    return _payment_out(db, container, payment)


# Групповые действия объявлены раньше «/{payment_id}/…», иначе «bulk» попал бы в payment_id.
@recurring_router.post(
    "/bulk/stop",
    response_model=BulkResultOut,
    summary="Прекращение нескольких регулярных платежей",
    description="Все или ничего: если хотя бы одного платежа нет, ничего не меняется (404 со списком missing_ids).",
)
def bulk_stop_recurring(payload: BulkIds, request: Request, admin: AdminUser, db: DbDep, container: ContainerDep):
    actor = actor_for(request, admin)
    today, now = container.clock.today(), container.clock.now()
    changed, unchanged = [], []
    for payment in recurring_service.get_payments(db, payload.ids):
        stopped = recurring_service.stop_payment(db, actor, payment.id, today=today, now=now)
        (changed if stopped else unchanged).append(payment.id)
    db.commit()
    return BulkResultOut(changed=changed, unchanged=unchanged)


@recurring_router.post(
    "/bulk/restore",
    response_model=BulkResultOut,
    summary="Возобновление нескольких регулярных платежей",
    description="График продолжается с сегодняшнего дня: сроки за время прекращения задним числом не создаются.",
)
def bulk_restore_recurring(payload: BulkIds, request: Request, admin: AdminUser, db: DbDep,
                           container: ContainerDep):
    actor = actor_for(request, admin)
    today, remind_days = container.clock.today(), _remind_days(db, container)
    changed, unchanged = [], []
    for payment in recurring_service.get_payments(db, payload.ids):
        restored = recurring_service.restore_payment(db, actor, payment.id, today=today, remind_days=remind_days)
        (changed if restored else unchanged).append(payment.id)
    db.commit()
    container.reminders.wake()
    return BulkResultOut(changed=changed, unchanged=unchanged)


@recurring_router.post(
    "/bulk/category",
    response_model=BulkResultOut,
    summary="Перенос нескольких регулярных платежей в категорию",
    description="category_id: null — убрать из категории. Все или ничего, как и другие групповые действия.",
)
def bulk_category_recurring(payload: BulkCategory, request: Request, admin: AdminUser, db: DbDep):
    categories_service.ensure_exists(db, payload.category_id)
    actor = actor_for(request, admin)
    changed, unchanged = [], []
    for payment in recurring_service.get_payments(db, payload.ids):
        moved = recurring_service.set_category(db, actor, payment, payload.category_id)
        (changed if moved else unchanged).append(payment.id)
    db.commit()
    return BulkResultOut(changed=changed, unchanged=unchanged)


@recurring_router.post(
    "/{payment_id}/restore",
    response_model=RecurringPaymentOut,
    summary="Возобновление прекращённого регулярного платежа",
    description=(
        "График продолжается с сегодняшнего дня: сроки, пришедшиеся на время прекращения, "
        "задним числом не создаются. Для активного платежа ничего не меняется."
    ),
)
def restore_recurring(payment_id: int, request: Request, admin: AdminUser, db: DbDep, container: ContainerDep):
    recurring_service.restore_payment(
        db, actor_for(request, admin), payment_id, today=container.clock.today(),
        remind_days=_remind_days(db, container),
    )
    db.commit()
    container.reminders.wake()
    return _payment_out(db, container, recurring_service.get_payment(db, payment_id))


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
        remind_days=_remind_days(db, container),
        payment_remind_days=payload.remind_days,
        category_id=payload.category_id,
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
    category_id: Annotated[int | None, Query(ge=0, description="Категория; 0 — без категории")] = None,
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
        category_id=category_id,
    )
    items, total = occurrences_service.list_occurrences(db, flt, today, sort=sort, limit=limit, offset=offset)
    remind_days = _remind_days(db, container)
    return Page[OccurrenceOut](
        items=[OccurrenceOut.build(o, today, remind_days) for o in items], total=total, limit=limit, offset=offset
    )


@occurrences_router.get("/{occurrence_id}", response_model=OccurrenceOut, summary="Получение конкретного платежа")
def get_occurrence(occurrence_id: int, user: CurrentUser, db: DbDep, container: ContainerDep):
    occurrence = occurrences_service.get_occurrence(db, occurrence_id)
    return OccurrenceOut.build(occurrence, container.clock.today(), _remind_days(db, container))


@occurrences_router.patch(
    "/{occurrence_id}",
    response_model=OccurrenceOut,
    summary="Подтверждение или отмена оплаты, исправление фактической даты оплаты",
)
def update_occurrence(occurrence_id: int, payload: OccurrenceUpdate, request: Request, user: CurrentUser,
                      db: DbDep, container: ContainerDep):
    today = container.clock.today()
    remind_days = _remind_days(db, container)
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
        comment=payload.comment,
    )
    db.commit()
    container.reminders.wake()
    container.reminders.schedule_refresh(occurrence.id)
    db.refresh(occurrence)
    return OccurrenceOut.build(occurrence, today, remind_days)


# --- файл чека ------------------------------------------------------------------

# Картинка открывается в «песочнице»: без скриптов, форм и сторонних запросов.
IMAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox"
# Встроенному просмотрщику PDF нужен object-src 'self'; PDF с активным содержимым не принимается при загрузке.
PDF_CSP = "default-src 'none'; object-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'none'"
RECEIPT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"]


def _check_can_attach(container, occurrence_id: int) -> None:
    """Проверки до чтения тела запроса — чтобы не принимать мегабайты, которые всё равно не сохраним."""
    with container.session_factory() as db:
        if not app_settings.uploads_enabled(db):
            raise ApiError(403, "uploads_disabled", "Загрузка файлов отключена администратором")
        if occurrences_service.get_occurrence(db, occurrence_id).paid_at is None:
            raise ApiError(409, "not_paid", "Чек прикрепляется к оплате — сначала отметьте платёж оплаченным")


def _attach(container, actor, occurrence_id: int, filename: str, data: bytes) -> OccurrenceOut:
    with container.session_factory() as db:
        occurrence = occurrences_service.get_occurrence(db, occurrence_id)
        receipts_service.attach(db, actor, occurrence, filename, data, container.clock.now())
        db.commit()
        return OccurrenceOut.build(occurrence, container.clock.today(), _remind_days(db, container))


@occurrences_router.put(
    "/{occurrence_id}/receipt-file",
    response_model=OccurrenceOut,
    summary="Прикрепление файла чека к оплате",
    description=(
        "Тело запроса — сам файл (не multipart), имя — в заголовке X-File-Name (UTF-8, percent-encoding), "
        "чтобы оно не попадало в журналы запросов. Только PDF, PNG, JPG, WebP: "
        "тип определяется по содержимому, расширение должно ему соответствовать; PDF со скриптами, "
        "вложениями и запуском программ отклоняется. Размер — не больше UPLOAD_MAX_MB (по умолчанию 10 МБ). "
        "Новый файл заменяет прежний. Администратор может отключить загрузку в настройках."
    ),
    openapi_extra={"requestBody": {"required": True, "content": {
        t: {"schema": {"type": "string", "format": "binary"}} for t in ["application/octet-stream", *RECEIPT_TYPES]
    }}},
    responses={413: {"model": ErrorResponse, "description": "Файл слишком большой"},
               415: {"model": ErrorResponse, "description": "Формат не разрешён"}},
)
async def upload_receipt_file(
    occurrence_id: int,
    request: Request,
    user: CurrentUser,
    container: ContainerDep,
    x_file_name: Annotated[str, Header(min_length=1, max_length=1024, description="Имя файла с расширением, percent-encoded")],
):
    filename = unquote(x_file_name)[:255]
    await run_in_threadpool(_check_can_attach, container, occurrence_id)
    max_mb = container.settings.upload_max_mb
    limit = max_mb * 1024 * 1024
    too_large = ApiError(413, "file_too_large", f"Файл больше {max_mb} МБ")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise too_large
    body = bytearray()
    async for chunk in request.stream():  # читаем частями и обрываем, как только превышен предел
        body.extend(chunk)
        if len(body) > limit:
            raise too_large
    return await run_in_threadpool(_attach, container, actor_for(request, user), occurrence_id, filename, bytes(body))


@occurrences_router.get(
    "/{occurrence_id}/receipt-file",
    response_class=Response,
    summary="Файл чека",
    description="Открывается в браузере (inline) с запрещающей политикой CSP; тип — тот, что определён при загрузке.",
    responses={200: {"content": {t: {} for t in RECEIPT_TYPES}, "description": "Файл"}},
)
def download_receipt_file(occurrence_id: int, user: CurrentUser, db: DbDep):
    receipt = occurrences_service.get_occurrence(db, occurrence_id).receipt_file
    if receipt is None:
        raise not_found("Файл чека")
    ext = receipt.filename.rsplit(".", 1)[-1].lower()
    ascii_name = "".join(ch for ch in receipt.filename if ch.isascii() and (ch.isalnum() or ch in "._-")) or f"receipt.{ext}"
    return Response(
        content=receipt.data,
        media_type=receipt.content_type,
        headers={
            "Content-Disposition": f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(receipt.filename)}",
            "Content-Security-Policy": PDF_CSP if receipt.content_type == "application/pdf" else IMAGE_CSP,
            "Cross-Origin-Resource-Policy": "same-origin",
            "Cache-Control": "private, no-store",
        },
    )


@occurrences_router.delete(
    "/{occurrence_id}/receipt-file", status_code=status.HTTP_204_NO_CONTENT, summary="Удаление файла чека"
)
def delete_receipt_file(occurrence_id: int, request: Request, user: CurrentUser, db: DbDep):
    occurrence = occurrences_service.get_occurrence(db, occurrence_id)
    receipts_service.detach(db, actor_for(request, user), occurrence)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
    remind_days = _remind_days(db, container)
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
            state = compute_state(occ.due_date, paid_at, today, occ.recurring_payment.remind_days_or(remind_days)).state
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
