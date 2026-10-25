from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTime
from app.domain.reminders import clamp_days


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role IN ('admin', 'user')", name="ck_users_role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str | None] = mapped_column(String(128))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="user")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


class AuthSession(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))

    user: Mapped[User] = relationship(lazy="joined")


class Category(Base):
    """Категория (группа) регулярных платежей: «Офис», «Серверы», «Подписки»…"""

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class RecurringPayment(Base):
    __tablename__ = "recurring_payments"
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="ck_recurring_amount_positive"),
        CheckConstraint("currency IN ('RUB', 'USD', 'EUR')", name="ck_recurring_currency"),
        CheckConstraint(
            "frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')", name="ck_recurring_frequency"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    anchor_date: Mapped[date] = mapped_column(Date)
    frequency: Mapped[str] = mapped_column(String(16), default="monthly")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # За сколько дней до срока напоминать именно об этом платеже; None — общая настройка
    remind_days: Mapped[int | None] = mapped_column(Integer)
    # Когда платёж возобновили после прекращения: сроки по графику раньше этой даты не создаются
    resumed_on: Mapped[date | None] = mapped_column(Date)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))

    category: Mapped[Category | None] = relationship(lazy="joined")

    @property
    def is_active(self) -> bool:
        return self.deleted_at is None

    def remind_days_or(self, default: int) -> int:
        """Окно напоминания платежа: своё, если задано, иначе общее."""
        return clamp_days(self.remind_days) if self.remind_days is not None else default


class PaymentOccurrence(Base):
    """Период регулярного платежа: свой срок, своя отметка об оплате, своё напоминание."""

    __tablename__ = "payment_occurrences"
    __table_args__ = (
        UniqueConstraint("recurring_payment_id", "due_date", name="uq_occurrence_payment_due"),
        CheckConstraint("amount_minor > 0", name="ck_occurrence_amount_positive"),
        CheckConstraint("currency IN ('RUB', 'USD', 'EUR')", name="ck_occurrence_currency"),
        Index("ix_occurrences_due_date", "due_date"),
        Index("ix_occurrences_paid_at", "paid_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    recurring_payment_id: Mapped[int] = mapped_column(ForeignKey("recurring_payments.id", ondelete="CASCADE"))
    due_date: Mapped[date] = mapped_column(Date)
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    paid_at: Mapped[date | None] = mapped_column(Date)
    paid_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    paid_via: Mapped[str | None] = mapped_column(String(16))
    paid_by_label: Mapped[str | None] = mapped_column(String(128))
    paid_marked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    receipt_url: Mapped[str | None] = mapped_column(Text)
    reminder_sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    reminder_message_id: Mapped[int | None] = mapped_column(BigInteger)
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    recurring_payment: Mapped[RecurringPayment] = relationship(lazy="joined")
    payer: Mapped[User | None] = relationship(lazy="joined")
    receipt_file: Mapped[ReceiptFile | None] = relationship(
        lazy="joined", back_populates="occurrence", cascade="all, delete-orphan", passive_deletes=True
    )


class ReceiptFile(Base):
    """Файл чека к оплате. Хранится в самой базе: попадает в резервные копии и переносится вместе с ней,
    а на диске сервера нет пользовательских файлов, которые можно было бы запустить или подменить."""

    __tablename__ = "receipt_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    occurrence_id: Mapped[int] = mapped_column(
        ForeignKey("payment_occurrences.id", ondelete="CASCADE"), unique=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    # содержимое читается только при скачивании, в списках платежей не загружается
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    uploaded_by_label: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    occurrence: Mapped[PaymentOccurrence] = relationship(back_populates="receipt_file")


class AppSetting(Base):
    """Настройки, которые администратор меняет в панели. Если записи нет — действует значение из .env."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[int | str | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_label: Mapped[str] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity: Mapped[str | None] = mapped_column(String(64))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    details: Mapped[dict | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(64))
