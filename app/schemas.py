"""Схемы запросов и ответов API (они же — OpenAPI-спецификация)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, ValidationInfo, field_validator, model_validator

from app.domain.money import Currency, from_minor
from app.domain.occurrence_state import OccurrenceState, compute_state
from app.domain.schedule import Frequency
from app.models import AuditLog, PaymentOccurrence, RecurringPayment, User

T = TypeVar("T")

Amount = Annotated[
    Decimal,
    Field(gt=0, le=Decimal("1000000000000"), decimal_places=2, examples=["85000.00"],
          description="Сумма, больше нуля, не более двух знаков после запятой"),
]
Login = Annotated[str, Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.\-]+$", examples=["ivan"])]
Password = Annotated[str, Field(min_length=6, max_length=128, examples=["secret123"])]
PaymentName = Annotated[str, Field(min_length=1, max_length=200, examples=["Аренда офиса"])]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def _strip_strings(cls, value: Any, info: ValidationInfo) -> Any:
        if isinstance(value, str) and info.field_name != "password":
            return value.strip()
        return value


# --- общие --------------------------------------------------------------


class ErrorBody(BaseModel):
    code: str = Field(examples=["forbidden"])
    message: str = Field(examples=["Действие доступно только администратору"])
    details: Any | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


# --- пользователи и вход -------------------------------------------------


class UserOut(BaseModel):
    id: int
    login: str
    name: str | None
    role: Literal["admin", "user"]
    managed_by_env: bool = Field(description="Администратор задаётся в .env и не изменяется через API")
    created_at: datetime

    @classmethod
    def build(cls, user: User) -> UserOut:
        return cls(id=user.id, login=user.login, name=user.name, role=user.role,
                   managed_by_env=user.is_admin, created_at=user.created_at)


class LoginRequest(StrictModel):
    login: str = Field(min_length=1, max_length=64, examples=["admin"])
    password: str = Field(min_length=1, max_length=128, examples=["change-me"])


class LoginResponse(BaseModel):
    token: str = Field(description="Передавайте в заголовке Authorization: Bearer <token>")
    token_type: Literal["bearer"] = "bearer"
    expires_at: datetime
    user: UserOut


class UserCreate(StrictModel):
    login: Login
    password: Password
    name: str | None = Field(default=None, max_length=128, examples=["Иван Петров"])


class UserUpdate(StrictModel):
    login: Login | None = None
    password: Password | None = None
    name: str | None = Field(default=None, max_length=128)


# --- периоды -------------------------------------------------------------


class PayerOut(BaseModel):
    user_id: int | None
    label: str | None = Field(description="Логин пользователя или tg:@username, если отмечено в Telegram")


class OccurrenceBrief(BaseModel):
    id: int
    due_date: date
    state: OccurrenceState
    is_overdue: bool
    overdue_days: int
    days_until_due: int | None


class OccurrenceOut(BaseModel):
    id: int
    recurring_payment_id: int
    name: str
    frequency: Frequency
    amount: Decimal = Field(examples=["85000.00"])
    currency: Currency
    due_date: date = Field(description="Срок оплаты периода")
    status: Literal["paid", "unpaid"]
    paid_at: date | None = Field(description="Фактическая дата оплаты")
    paid_by: PayerOut | None
    paid_via: Literal["web", "telegram"] | None
    is_overdue: bool = Field(description="Не оплачено после срока или оплачено позже срока")
    overdue_days: int
    days_until_due: int | None
    state: OccurrenceState
    reminder_sent_at: datetime | None
    receipt_url: str | None
    payment_active: bool = Field(description="false — регулярный платёж прекращён (период остаётся в истории)")
    created_at: datetime
    updated_at: datetime

    @classmethod
    def build(cls, occ: PaymentOccurrence, today: date, remind_days: int) -> OccurrenceOut:
        info = compute_state(occ.due_date, occ.paid_at, today, remind_days)
        payment = occ.recurring_payment
        return cls(
            id=occ.id,
            recurring_payment_id=occ.recurring_payment_id,
            name=payment.name,
            frequency=payment.frequency,
            amount=from_minor(occ.amount_minor),
            currency=occ.currency,
            due_date=occ.due_date,
            status="paid" if occ.paid_at else "unpaid",
            paid_at=occ.paid_at,
            paid_by=PayerOut(user_id=occ.paid_by, label=occ.paid_by_label) if occ.paid_at else None,
            paid_via=occ.paid_via,
            is_overdue=info.is_overdue,
            overdue_days=info.overdue_days,
            days_until_due=info.days_until_due,
            state=info.state,
            reminder_sent_at=occ.reminder_sent_at,
            receipt_url=occ.receipt_url,
            payment_active=payment.is_active,
            created_at=occ.created_at,
            updated_at=occ.updated_at,
        )


class OccurrenceUpdate(StrictModel):
    """Отметить оплату, отменить отметку или исправить фактическую дату.

    - `{"paid": true}` — оплачено сегодня; `{"paid": true, "paid_at": "2026-10-20"}` — с указанной датой;
    - `{"paid": false}` — отменить оплату (фактическая дата очищается);
    - `{"paid_at": "2026-10-20"}` — исправить фактическую дату (срок не меняется).
    """

    paid: bool | None = None
    paid_at: date | None = Field(default=None, description="Фактическая дата оплаты, не позже сегодняшнего дня")
    receipt_url: HttpUrl | None = Field(default=None, description="Ссылка на чек или платёжку")


# --- регулярные платежи ---------------------------------------------------


class RecurringPaymentCreate(StrictModel):
    name: PaymentName
    amount: Amount
    currency: Currency
    next_due_date: date = Field(description="Дата ближайшей оплаты — от неё строится график")
    frequency: Frequency = Frequency.MONTHLY


class RecurringPaymentUpdate(StrictModel):
    name: PaymentName | None = None
    amount: Amount | None = None
    currency: Currency | None = None
    next_due_date: date | None = Field(default=None, description="Новая дата ближайшей оплаты (не в прошлом)")
    frequency: Frequency | None = None

    @model_validator(mode="after")
    def _not_null(self) -> RecurringPaymentUpdate:
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"поле {name} не может быть null")
        return self


class RecurringPaymentOut(BaseModel):
    id: int
    name: str
    amount: Decimal = Field(examples=["85000.00"])
    currency: Currency
    frequency: Frequency
    anchor_date: date = Field(description="Исходная дата графика")
    next_due_date: date | None = Field(description="Ближайший неоплаченный срок начиная с сегодня")
    next_occurrence: OccurrenceBrief | None = Field(description="Самый ранний неоплаченный период (может быть просрочен)")
    overdue_count: int
    is_active: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def build(cls, payment: RecurringPayment, next_due_date: date | None, next_occurrence: PaymentOccurrence | None,
              overdue_count: int, today: date, remind_days: int) -> RecurringPaymentOut:
        brief = None
        if next_occurrence is not None:
            info = compute_state(next_occurrence.due_date, None, today, remind_days)
            brief = OccurrenceBrief(id=next_occurrence.id, due_date=next_occurrence.due_date, state=info.state,
                                    is_overdue=info.is_overdue, overdue_days=info.overdue_days,
                                    days_until_due=info.days_until_due)
        return cls(
            id=payment.id, name=payment.name, amount=from_minor(payment.amount_minor), currency=payment.currency,
            frequency=payment.frequency, anchor_date=payment.anchor_date, next_due_date=next_due_date,
            next_occurrence=brief, overdue_count=overdue_count, is_active=payment.is_active,
            deleted_at=payment.deleted_at, created_at=payment.created_at, updated_at=payment.updated_at,
        )


# --- итоги -----------------------------------------------------------------


class TotalOut(BaseModel):
    amount: Decimal = Field(examples=["170000.00"])
    count: int


class CurrencySummaryOut(BaseModel):
    currency: Currency
    paid: TotalOut = Field(description="Фактически оплачено (по дате оплаты)")
    unpaid: TotalOut = Field(description="Не оплачено (по сроку)")
    overdue: TotalOut = Field(description="Не оплачено и срок прошёл")


class SummaryOut(BaseModel):
    today: date
    date_from: date | None
    date_to: date | None
    currencies: list[CurrencySummaryOut]


class ForecastItemOut(BaseModel):
    recurring_payment_id: int
    name: str
    due_date: date
    amount: Decimal
    currency: Currency
    status: Literal["paid", "unpaid", "planned"] = Field(
        description="planned — плановый срок по графику, период ещё не создан"
    )
    occurrence_id: int | None
    state: OccurrenceState | None
    paid_at: date | None


class ForecastTotalOut(BaseModel):
    currency: Currency
    planned: TotalOut = Field(description="Плановые расходы за период (бюджет)")
    paid: TotalOut = Field(description="Из них оплачено")
    remaining: TotalOut = Field(description="Осталось оплатить")


class ForecastOut(BaseModel):
    date_from: date
    date_to: date
    items: list[ForecastItemOut]
    totals: list[ForecastTotalOut]


# --- журнал и служебное -----------------------------------------------------


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    at: datetime
    actor_user_id: int | None
    actor_label: str
    action: str
    entity: str | None
    entity_id: int | None
    details: dict | None
    ip: str | None

    @classmethod
    def build(cls, entry: AuditLog) -> AuditOut:
        return cls.model_validate(entry)


class TelegramStatus(BaseModel):
    bot_configured: bool
    chat_configured: bool


class MetaOut(BaseModel):
    today: date = Field(description="Сегодняшняя дата в часовом поясе приложения")
    timezone: str
    reminder_days_before: int
    currencies: list[Currency]
    frequencies: list[Frequency]
    telegram: TelegramStatus
