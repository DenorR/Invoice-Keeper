"""Демо-данные. Даты считаются от «сегодня», поэтому сценарий защиты работает в любой день.

Тестовые учётные записи (обычные пользователи):
    user / user12345, accountant / accountant123 — пароли по умолчанию для локального запуска;
    на сервере задаются через DEMO_USER_PASSWORD / DEMO_ACCOUNTANT_PASSWORD в .env.
Администратор задаётся в .env (ADMIN_LOGIN / ADMIN_PASSWORD).
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.domain.dates import Clock
from app.domain.schedule import Frequency, due_date
from app.models import PaymentOccurrence, RecurringPayment, User
from app.services import occurrences as occurrences_service
from app.services import recurring as recurring_service
from app.services.audit import Actor
from app.services.security import hash_password

def demo_users(settings: Settings) -> list[tuple[str, str, str]]:
    return [
        ("user", settings.demo_user_password.get_secret_value(), "Иван Петров"),
        ("accountant", settings.demo_accountant_password.get_secret_value(), "Мария Соколова"),
    ]


def _anchor_with_previous(target: date) -> date:
    """Якорь за месяц до target, чтобы у платежа был прошлый период и текущий со сроком target."""
    anchor = target - relativedelta(months=1)
    return anchor if due_date(anchor, Frequency.MONTHLY, 1) == target else target


def _month_end_31(today: date) -> date:
    """Ближайшее 31-е число не позже чем два месяца назад — чтобы показать «31 → 30»."""
    month = today - relativedelta(months=2)
    for _ in range(3):
        last = month + relativedelta(day=31)
        if last.day == 31:
            return last
        month -= relativedelta(months=1)
    return month + relativedelta(day=31)


def seed_if_empty(db: Session, clock: Clock, settings: Settings) -> bool:
    if db.scalar(select(func.count()).select_from(RecurringPayment)):
        return False
    seed(db, clock, settings)
    return True


def seed(db: Session, clock: Clock, settings: Settings) -> None:
    today, now = clock.today(), clock.now()
    remind = settings.reminder_days_before
    system = Actor.system()

    users: dict[str, User] = {}
    for login, password, name in demo_users(settings):
        user = db.scalar(select(User).where(User.login == login))
        if user is None:
            user = User(login=login, name=name, role="user", password_hash=hash_password(password))
            db.add(user)
            db.flush()
        users[login] = user
    ivan, maria = Actor.from_user(users["user"]), Actor.from_user(users["accountant"])

    def create(name: str, amount: str, currency: str, anchor: date, frequency: Frequency = Frequency.MONTHLY):
        return recurring_service.create_payment(
            db, system, name=name, amount=Decimal(amount), currency=currency, next_due_date=anchor,
            frequency=frequency.value, today=today, remind_days=remind,
        )

    def periods(payment: RecurringPayment) -> list[PaymentOccurrence]:
        return list(db.scalars(
            select(PaymentOccurrence)
            .where(PaymentOccurrence.recurring_payment_id == payment.id)
            .order_by(PaymentOccurrence.due_date)
        ).all())

    def pay(occurrence: PaymentOccurrence, paid_at: date, actor: Actor) -> None:
        occurrences_service.set_paid(db, occurrence, min(paid_at, today), today=today, now=now, actor=actor)

    # 1. Аренда в рублях: срок 31-го числа → в 30-дневных месяцах последний день месяца.
    rent = create("Аренда офиса", "85000.00", "RUB", _month_end_31(today))
    for index, occurrence in enumerate(p for p in periods(rent) if p.due_date < today):
        # первый период оплачен заранее, следующие — ровно в день срока (это не просрочка)
        pay(occurrence, occurrence.due_date - timedelta(days=2) if index == 0 else occurrence.due_date, maria)

    # 2. Сервер в долларах: срок через 2 дня → напоминание уходит сразу после запуска.
    server = create("VPS-сервер (Hetzner)", "49.90", "USD", _anchor_with_previous(today + timedelta(days=2)))
    for occurrence in periods(server):
        if occurrence.due_date < today:
            pay(occurrence, occurrence.due_date - timedelta(days=1), ivan)

    # 3. Подписка в евро: текущий период просрочен, прошлый оплачен с опозданием на 2 дня.
    figma = create("Подписка Figma", "15.00", "EUR", _anchor_with_previous(today - timedelta(days=5)))
    past = [p for p in periods(figma) if p.due_date < today - timedelta(days=5)]
    for occurrence in past:
        pay(occurrence, occurrence.due_date + timedelta(days=2), ivan)

    # 4. Годовой платёж.
    create("Домен invoice-keeper.ru", "1990.00", "RUB", today + timedelta(days=40), Frequency.YEARLY)

    # 5. Прекращённый платёж: история оплат сохраняется, напоминаний больше нет.
    old = create("Старый хостинг", "5.00", "USD", today - relativedelta(months=3) + timedelta(days=3))
    for occurrence in periods(old):
        if occurrence.due_date < today:
            pay(occurrence, occurrence.due_date, maria)
    recurring_service.stop_payment(db, system, old.id, today=today, now=now)

    db.flush()
