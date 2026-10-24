"""Напоминания о платежах.

Каждый неоплаченный период напоминается ровно один раз — не позже чем за
REMINDER_DAYS_BEFORE дней до срока (или сразу, если платёж добавили позже).
Защита от дублей — атомарный «захват» периода в БД до отправки:
UPDATE … SET reminder_sent_at = now WHERE reminder_sent_at IS NULL.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import groupby
from typing import Protocol

from sqlalchemy import select, update
from sqlalchemy.orm import Session, contains_eager, sessionmaker

from app.domain.dates import Clock
from app.models import PaymentOccurrence, RecurringPayment
from app.services import audit
from app.services.audit import Actor
from app.services.occurrences import generate_all

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ReminderItem:
    occurrence_id: int
    due_date: date
    amount_minor: int
    currency: str
    paid_at: date | None = None
    paid_by_label: str | None = None


@dataclass(frozen=True)
class Reminder:
    payment_id: int
    payment_name: str
    payment_active: bool
    items: list[ReminderItem]
    today: date


class Notifier(Protocol):
    @property
    def enabled(self) -> bool: ...

    async def send_reminder(self, reminder: Reminder) -> int | None: ...

    async def refresh_reminder(self, message_id: int, reminder: Reminder) -> None: ...


class NullNotifier:
    """Канал уведомлений не настроен: напоминания не отправляются и не помечаются отправленными."""

    enabled = False

    async def send_reminder(self, reminder: Reminder) -> int | None:  # pragma: no cover
        return None

    async def refresh_reminder(self, message_id: int, reminder: Reminder) -> None:  # pragma: no cover
        return None


def _item(occurrence: PaymentOccurrence) -> ReminderItem:
    return ReminderItem(
        occurrence_id=occurrence.id,
        due_date=occurrence.due_date,
        amount_minor=occurrence.amount_minor,
        currency=occurrence.currency,
        paid_at=occurrence.paid_at,
        paid_by_label=occurrence.paid_by_label,
    )


def load_reminder_by_message(db: Session, message_id: int, today: date) -> Reminder | None:
    """Восстанавливает содержимое отправленного сообщения по его id — чтобы обновить статусы в чате."""
    occurrences = db.scalars(
        select(PaymentOccurrence)
        .where(PaymentOccurrence.reminder_message_id == message_id)
        .order_by(PaymentOccurrence.due_date)
    ).all()
    if not occurrences:
        return None
    payment = occurrences[0].recurring_payment
    return Reminder(
        payment_id=payment.id,
        payment_name=payment.name,
        payment_active=payment.is_active,
        items=[_item(o) for o in occurrences],
        today=today,
    )


class ReminderService:
    def __init__(
        self,
        session_factory: sessionmaker,
        clock: Clock,
        notifier: Notifier,
        remind_days: int,
        interval_seconds: int,
    ):
        self.session_factory = session_factory
        self.clock = clock
        self.notifier = notifier
        self.remind_days = remind_days
        self.interval_seconds = interval_seconds
        self._lock = asyncio.Lock()
        self._wake = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None

    # --- фоновый цикл -------------------------------------------------

    async def run_forever(self) -> None:
        self._loop = asyncio.get_running_loop()
        log.info("Планировщик напоминаний запущен (интервал %s с)", self.interval_seconds)
        while True:
            try:
                await self.run_cycle()
            except Exception:  # цикл не должен умирать из-за одной ошибки
                log.exception("Ошибка цикла напоминаний")
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=self.interval_seconds)
            except TimeoutError:
                pass
            self._wake.clear()

    def wake(self) -> None:
        """Запустить проверку немедленно (потокобезопасно — вызывается из обработчиков API)."""
        if self._loop is not None and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._wake.set)

    def schedule_refresh(self, occurrence_id: int) -> None:
        """Обновить сообщение в чате после отметки оплаты в панели (потокобезопасно)."""
        if self._loop is not None and not self._loop.is_closed() and self.notifier.enabled:
            asyncio.run_coroutine_threadsafe(self.refresh_for_occurrence(occurrence_id), self._loop)

    # --- одна проверка ------------------------------------------------

    async def run_cycle(self) -> int:
        async with self._lock:
            today = self.clock.today()
            with self.session_factory() as db:
                generate_all(db, today, self.remind_days)
                db.commit()

            if not self.notifier.enabled:
                return 0

            sent = 0
            for payment_id, payment_name, occurrence_ids in self._candidates(today):
                claimed = self._claim(occurrence_ids)
                if not claimed:
                    continue
                with self.session_factory() as db:
                    items = [_item(o) for o in db.scalars(
                        select(PaymentOccurrence)
                        .where(PaymentOccurrence.id.in_(claimed))
                        .order_by(PaymentOccurrence.due_date)
                    ).all()]
                reminder = Reminder(payment_id, payment_name, True, items, today)
                try:
                    message_id = await self.notifier.send_reminder(reminder)
                except asyncio.CancelledError:
                    # остановка приложения во время отправки — не теряем напоминание
                    self._release(claimed)
                    raise
                except Exception:
                    log.exception("Не удалось отправить напоминание по платежу %s — повторим позже", payment_id)
                    self._release(claimed)
                    continue
                self._mark_sent(payment_id, claimed, items, message_id)
                sent += 1
            return sent

    def _candidates(self, today: date) -> list[tuple[int, str, list[int]]]:
        horizon = today + timedelta(days=self.remind_days)
        with self.session_factory() as db:
            rows = db.scalars(
                select(PaymentOccurrence)
                .join(PaymentOccurrence.recurring_payment)
                .options(contains_eager(PaymentOccurrence.recurring_payment))
                .where(
                    RecurringPayment.deleted_at.is_(None),
                    PaymentOccurrence.paid_at.is_(None),
                    PaymentOccurrence.reminder_sent_at.is_(None),
                    PaymentOccurrence.due_date <= horizon,
                )
                .order_by(PaymentOccurrence.recurring_payment_id, PaymentOccurrence.due_date)
            ).unique().all()
            # Несколько периодов одного платежа (например, заведён задним числом) — одним сообщением.
            return [
                (payment_id, group[0].recurring_payment.name, [o.id for o in group])
                for payment_id, group in ((pid, list(g)) for pid, g in groupby(rows, key=lambda o: o.recurring_payment_id))
            ]

    def _claim(self, occurrence_ids: list[int]) -> list[int]:
        claimed = []
        now = self.clock.now()
        with self.session_factory() as db:
            for occurrence_id in occurrence_ids:
                result = db.execute(
                    update(PaymentOccurrence)
                    .where(
                        PaymentOccurrence.id == occurrence_id,
                        PaymentOccurrence.reminder_sent_at.is_(None),
                        PaymentOccurrence.paid_at.is_(None),
                    )
                    .values(reminder_sent_at=now)
                )
                if result.rowcount == 1:
                    claimed.append(occurrence_id)
            db.commit()
        return claimed

    def _release(self, occurrence_ids: list[int]) -> None:
        with self.session_factory() as db:
            db.execute(
                update(PaymentOccurrence)
                .where(PaymentOccurrence.id.in_(occurrence_ids))
                .values(reminder_sent_at=None)
            )
            db.commit()

    def _mark_sent(self, payment_id: int, claimed: list[int], items: list[ReminderItem], message_id: int | None) -> None:
        with self.session_factory() as db:
            if message_id is not None:
                db.execute(
                    update(PaymentOccurrence)
                    .where(PaymentOccurrence.id.in_(claimed))
                    .values(reminder_message_id=message_id)
                )
            audit.record(
                db,
                Actor.system(),
                "reminder.sent",
                "recurring_payment",
                payment_id,
                {"occurrence_ids": claimed, "due_dates": [i.due_date.isoformat() for i in items]},
            )
            db.commit()

    # --- обновление уже отправленного сообщения -----------------------

    async def refresh_for_occurrence(self, occurrence_id: int) -> None:
        try:
            with self.session_factory() as db:
                message_id = db.scalar(
                    select(PaymentOccurrence.reminder_message_id).where(PaymentOccurrence.id == occurrence_id)
                )
                if message_id is None:
                    return
                reminder = load_reminder_by_message(db, message_id, self.clock.today())
            if reminder is not None:
                await self.notifier.refresh_reminder(message_id, reminder)
        except Exception:
            log.exception("Не удалось обновить сообщение в Telegram")
