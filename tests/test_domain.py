from datetime import date

from app.domain.money import format_amount, from_minor, to_minor
from app.domain.occurrence_state import OccurrenceState, compute_state
from app.domain.schedule import Frequency, due_date, due_dates_to_ensure
from decimal import Decimal


def dues(anchor: date, frequency: Frequency, count: int) -> list[date]:
    return [due_date(anchor, frequency, n) for n in range(count)]


class TestSchedule:
    def test_monthly_31st_clamps_to_month_end_and_returns_to_31(self):
        assert dues(date(2027, 1, 31), Frequency.MONTHLY, 4) == [
            date(2027, 1, 31), date(2027, 2, 28), date(2027, 3, 31), date(2027, 4, 30),
        ]

    def test_monthly_leap_year(self):
        assert dues(date(2028, 1, 31), Frequency.MONTHLY, 2)[1] == date(2028, 2, 29)

    def test_monthly_30th_in_february(self):
        assert dues(date(2026, 1, 30), Frequency.MONTHLY, 3) == [date(2026, 1, 30), date(2026, 2, 28), date(2026, 3, 30)]

    def test_yearly_from_feb_29(self):
        assert dues(date(2028, 2, 29), Frequency.YEARLY, 5) == [
            date(2028, 2, 29), date(2029, 2, 28), date(2030, 2, 28), date(2031, 2, 28), date(2032, 2, 29),
        ]

    def test_quarterly_and_weekly(self):
        assert dues(date(2026, 11, 30), Frequency.QUARTERLY, 3) == [date(2026, 11, 30), date(2027, 2, 28), date(2027, 5, 30)]
        assert dues(date(2026, 12, 28), Frequency.WEEKLY, 2) == [date(2026, 12, 28), date(2027, 1, 4)]

    def test_generation_horizon_plus_one_next_period(self):
        # сегодня 24.10, окно 3 дня → горизонт 27.10
        wanted = due_dates_to_ensure(date(2026, 8, 25), Frequency.MONTHLY, date(2026, 10, 27), lambda d: False)
        assert wanted == [date(2026, 8, 25), date(2026, 9, 25), date(2026, 10, 25), date(2026, 11, 25)]

    def test_generation_skips_over_periods_paid_in_advance(self):
        paid = {date(2026, 11, 25)}
        wanted = due_dates_to_ensure(date(2026, 11, 25), Frequency.MONTHLY, date(2026, 10, 27), lambda d: d in paid)
        assert wanted == [date(2026, 11, 25), date(2026, 12, 25)]


class TestState:
    today = date(2026, 10, 24)

    def state(self, due, paid_at=None):
        return compute_state(due, paid_at, self.today, remind_days=3)

    def test_payment_on_due_date_is_on_time(self):
        info = self.state(date(2026, 10, 20), paid_at=date(2026, 10, 20))
        assert info.state is OccurrenceState.PAID_ON_TIME and not info.is_overdue

    def test_payment_next_day_is_late(self):
        info = self.state(date(2026, 10, 20), paid_at=date(2026, 10, 21))
        assert info.state is OccurrenceState.PAID_LATE and info.is_overdue and info.overdue_days == 1

    def test_unpaid_on_due_date_is_not_overdue(self):
        info = self.state(self.today)
        assert info.state is OccurrenceState.DUE_TODAY and not info.is_overdue

    def test_unpaid_day_after_due_is_overdue(self):
        info = self.state(date(2026, 10, 23))
        assert info.state is OccurrenceState.OVERDUE and info.overdue_days == 1

    def test_due_soon_and_upcoming(self):
        assert self.state(date(2026, 10, 27)).state is OccurrenceState.DUE_SOON
        assert self.state(date(2026, 10, 28)).state is OccurrenceState.UPCOMING


def test_money_roundtrip_and_format():
    assert to_minor(Decimal("49.90")) == 4990
    assert from_minor(8500000) == Decimal("85000.00")
    assert format_amount(8500050, "RUB") == "85 000,50 ₽"
    assert format_amount(1500, "EUR") == "15,00 €"
