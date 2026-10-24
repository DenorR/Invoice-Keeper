"""График регулярного платежа.

Срок n-го периода считается от исходной даты (якоря), а не от предыдущего срока:
якорь 31 января → 28/29 февраля → 31 марта. Если такого числа в месяце нет,
берётся последний день месяца (relativedelta делает это сам).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import date, timedelta
from enum import StrEnum

from dateutil.relativedelta import relativedelta

MAX_PERIODS = 5000


class Frequency(StrEnum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"


_MONTHS_PER_STEP = {
    Frequency.MONTHLY: 1,
    Frequency.QUARTERLY: 3,
    Frequency.YEARLY: 12,
}


def due_date(anchor: date, frequency: Frequency, n: int) -> date:
    if frequency is Frequency.WEEKLY:
        return anchor + timedelta(weeks=n)
    return anchor + relativedelta(months=_MONTHS_PER_STEP[frequency] * n)


def iter_due_dates(anchor: date, frequency: Frequency) -> Iterator[date]:
    for n in range(MAX_PERIODS):
        yield due_date(anchor, frequency, n)


def first_due_on_or_after(anchor: date, frequency: Frequency, day: date) -> date:
    for due in iter_due_dates(anchor, frequency):
        if due >= day:
            return due
    raise ValueError("слишком длинный график")


def due_dates_to_ensure(
    anchor: date,
    frequency: Frequency,
    horizon: date,
    is_paid: Callable[[date], bool],
) -> list[date]:
    """Какие периоды должны существовать на текущий момент.

    Все периоды со сроком не позже горизонта (сегодня + окно напоминания)
    плюс один следующий. Если следующий уже оплачен заранее — ещё один,
    чтобы в списке всегда был виден ближайший неоплаченный период.
    """
    result: list[date] = []
    for due in iter_due_dates(anchor, frequency):
        result.append(due)
        if due > horizon and not is_paid(due):
            break
    return result
