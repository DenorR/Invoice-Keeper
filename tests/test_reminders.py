import asyncio
from datetime import date

from fastapi.testclient import TestClient

from app.main import create_app
from app.telegram.messages import render_reminder
from tests.conftest import ADMIN, FakeNotifier, create_payment, login, occurrences


def test_reminder_sent_immediately_when_due_within_3_days(client, admin, notifier, run_reminders):
    create_payment(client, admin, name="VPS", currency="USD", amount="49.90", next_due_date="2026-10-26")
    assert run_reminders() == 1
    [reminder] = notifier.sent
    assert reminder.payment_name == "VPS"
    assert [(i.due_date, i.amount_minor, i.currency) for i in reminder.items] == [(date(2026, 10, 26), 4990, "USD")]


def test_no_duplicates_on_repeated_checks(client, admin, notifier, run_reminders):
    create_payment(client, admin, next_due_date="2026-10-27")
    run_reminders()
    run_reminders()
    run_reminders()
    assert len(notifier.sent) == 1


def test_reminder_exactly_3_days_before(client, admin, notifier, clock, run_reminders):
    create_payment(client, admin, next_due_date="2026-11-10")
    clock.set_today(date(2026, 11, 6))
    run_reminders()
    assert notifier.sent == []
    clock.set_today(date(2026, 11, 7))
    run_reminders()
    assert [r.items[0].due_date for r in notifier.sent] == [date(2026, 11, 10)]


def test_paid_period_is_not_reminded(client, admin, notifier, run_reminders):
    payment = create_payment(client, admin, next_due_date="2026-10-26")
    occ = occurrences(client, admin, recurring_payment_id=payment["id"])[0]
    client.patch(f"/api/v1/payment-occurrences/{occ['id']}", headers=admin, json={"paid": True})
    run_reminders()
    assert notifier.sent == []


def test_next_period_reminded_in_its_own_window(client, admin, notifier, clock, run_reminders):
    payment = create_payment(client, admin, next_due_date="2026-10-26")
    run_reminders()
    occ = occurrences(client, admin, recurring_payment_id=payment["id"])[0]
    client.patch(f"/api/v1/payment-occurrences/{occ['id']}", headers=admin, json={"paid": True})

    clock.set_today(date(2026, 11, 20))
    run_reminders()
    assert len(notifier.sent) == 1  # до окна следующего периода — тишина
    clock.set_today(date(2026, 11, 23))
    run_reminders()
    assert [r.items[0].due_date for r in notifier.sent] == [date(2026, 10, 26), date(2026, 11, 26)]


def test_deleted_payment_is_not_reminded(client, admin, notifier, run_reminders):
    payment = create_payment(client, admin, next_due_date="2026-10-26")
    client.delete(f"/api/v1/recurring-payments/{payment['id']}", headers=admin)
    run_reminders()
    assert notifier.sent == []


def test_backfilled_overdue_periods_grouped_into_one_message(client, admin, notifier, run_reminders):
    create_payment(client, admin, next_due_date="2026-08-05")
    run_reminders()
    assert len(notifier.sent) == 1
    assert [i.due_date for i in notifier.sent[0].items] == [date(2026, 8, 5), date(2026, 9, 5), date(2026, 10, 5)]
    text, buttons = render_reminder(notifier.sent[0])
    assert "Просроченный платёж" in text and len(buttons) == 3


def test_failed_send_is_retried(client, admin, notifier, run_reminders):
    create_payment(client, admin, next_due_date="2026-10-25")
    notifier.fail = True
    run_reminders()
    notifier.fail = False
    run_reminders()
    assert len(notifier.sent) == 1


def test_no_duplicates_after_restart(settings, clock):
    notifier = FakeNotifier()
    app = create_app(settings, clock=clock, notifier=notifier, start_background=False)
    with TestClient(app) as client:
        create_payment(client, login(client, *ADMIN), next_due_date="2026-10-26")
        asyncio.run(app.state.container.reminders.run_cycle())

    app = create_app(settings, clock=clock, notifier=notifier, start_background=False)
    with TestClient(app):
        asyncio.run(app.state.container.reminders.run_cycle())
    assert len(notifier.sent) == 1


def test_message_contains_required_fields(client, admin, notifier, run_reminders):
    create_payment(client, admin, name="Аренда офиса", amount="85000", currency="RUB", next_due_date="2026-10-27")
    run_reminders()
    text, buttons = render_reminder(notifier.sent[0])
    assert "Аренда офиса" in text and "85 000,00 ₽" in text and "RUB" in text and "27.10.2026" in text
    assert "через 3 дня" in text.lower()
    assert buttons and buttons[0][0] == "✅ Оплачено"


def test_cancelled_send_is_released(client, admin, notifier, app):
    import pytest

    async def hang(reminder):
        await asyncio.sleep(10)

    create_payment(client, admin, next_due_date="2026-10-25")
    notifier.send_reminder = hang

    async def scenario():
        task = asyncio.create_task(app.state.container.reminders.run_cycle())
        await asyncio.sleep(0.2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    notifier.send_reminder = FakeNotifier.send_reminder.__get__(notifier)
    asyncio.run(app.state.container.reminders.run_cycle())
    assert len(notifier.sent) == 1
