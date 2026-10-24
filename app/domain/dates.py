from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo


class Clock:
    """Источник текущего времени. «Сегодня» считается в часовом поясе приложения."""

    def __init__(self, tz: ZoneInfo):
        self.tz = tz

    def now(self) -> datetime:
        return datetime.now(timezone.utc)

    def today(self) -> date:
        return self.now().astimezone(self.tz).date()


class FixedClock(Clock):
    """Часы с ручным управлением — для тестов."""

    def __init__(self, tz: ZoneInfo, current: datetime):
        super().__init__(tz)
        self.current = current

    def now(self) -> datetime:
        return self.current

    def set_today(self, day: date, hour: int = 12) -> None:
        self.current = datetime(day.year, day.month, day.day, hour, tzinfo=self.tz).astimezone(timezone.utc)
