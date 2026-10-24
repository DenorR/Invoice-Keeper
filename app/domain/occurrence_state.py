"""Статус периода. Просрочка не хранится, а вычисляется из срока и фактической даты."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import StrEnum


class OccurrenceState(StrEnum):
    UPCOMING = "upcoming"
    DUE_SOON = "due_soon"
    DUE_TODAY = "due_today"
    OVERDUE = "overdue"
    PAID_ON_TIME = "paid_on_time"
    PAID_LATE = "paid_late"


@dataclass(frozen=True)
class StateInfo:
    state: OccurrenceState
    is_overdue: bool
    overdue_days: int
    days_until_due: int | None


def compute_state(due: date, paid_at: date | None, today: date, remind_days: int) -> StateInfo:
    """Просрочка — со следующего дня после срока; оплата в день срока — вовремя."""
    if paid_at is not None:
        late_days = (paid_at - due).days
        if late_days > 0:
            return StateInfo(OccurrenceState.PAID_LATE, True, late_days, None)
        return StateInfo(OccurrenceState.PAID_ON_TIME, False, 0, None)

    days_left = (due - today).days
    if days_left < 0:
        return StateInfo(OccurrenceState.OVERDUE, True, -days_left, days_left)
    if days_left == 0:
        return StateInfo(OccurrenceState.DUE_TODAY, False, 0, 0)
    if days_left <= remind_days:
        return StateInfo(OccurrenceState.DUE_SOON, False, 0, days_left)
    return StateInfo(OccurrenceState.UPCOMING, False, 0, days_left)
