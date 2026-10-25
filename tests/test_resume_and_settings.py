"""Возобновление прекращённых платежей, групповые действия и окно напоминания."""

from datetime import date

from tests.conftest import ADMIN, create_payment, login, occurrences


def recurring(client, headers, payment_id):
    return client.get(f"/api/v1/recurring-payments/{payment_id}", headers=headers).json()


def test_restore_continues_schedule_without_backfill(client, admin, clock):
    payment = create_payment(client, admin, next_due_date="2026-10-26")
    assert client.delete(f"/api/v1/recurring-payments/{payment['id']}", headers=admin).status_code == 204

    clock.set_today(date(2027, 1, 10))
    admin = login(client, *ADMIN)
    response = client.post(f"/api/v1/recurring-payments/{payment['id']}/restore", headers=admin)
    assert response.status_code == 200, response.text
    restored = response.json()
    assert restored["is_active"] is True and restored["deleted_at"] is None
    assert restored["resumed_on"] == "2027-01-10" and restored["next_due_date"] == "2027-01-26"
    # ноябрь и декабрь пришлись на время прекращения — просрочками они не становятся
    assert [o["due_date"] for o in occurrences(client, admin, recurring_payment_id=payment["id"])] == ["2027-01-26"]

    again = client.post(f"/api/v1/recurring-payments/{payment['id']}/restore", headers=admin)
    assert again.status_code == 200 and again.json()["resumed_on"] == "2027-01-10"
    actions = [e["action"] for e in client.get("/api/v1/audit-log", headers=admin).json()["items"]]
    assert actions.count("recurring.restore") == 1


def test_restored_payment_is_reminded_again(client, admin, notifier, run_reminders):
    payment = create_payment(client, admin, next_due_date="2026-11-24")
    client.delete(f"/api/v1/recurring-payments/{payment['id']}", headers=admin)
    client.post(f"/api/v1/recurring-payments/{payment['id']}/restore", headers=admin)
    client.patch(f"/api/v1/recurring-payments/{payment['id']}", headers=admin, json={"next_due_date": "2026-10-26"})
    assert run_reminders() == 1


def test_bulk_stop_and_restore(client, admin):
    a, b, c = (create_payment(client, admin, name=name)["id"] for name in ("A", "B", "C"))

    response = client.post("/api/v1/recurring-payments/bulk/stop", headers=admin, json={"ids": [a, b, a]})
    assert response.status_code == 200, response.text
    assert response.json() == {"changed": [a, b], "unchanged": []}
    assert client.post("/api/v1/recurring-payments/bulk/stop", headers=admin, json={"ids": [a]}).json() == {
        "changed": [], "unchanged": [a]}

    # все или ничего: неизвестный id — ничего не меняется
    missing = client.post("/api/v1/recurring-payments/bulk/stop", headers=admin, json={"ids": [c, 9999]})
    assert missing.status_code == 404 and missing.json()["error"]["details"] == {"missing_ids": [9999]}
    assert recurring(client, admin, c)["is_active"] is True

    response = client.post("/api/v1/recurring-payments/bulk/restore", headers=admin, json={"ids": [a, b, c]})
    assert response.json() == {"changed": [a, b], "unchanged": [c]}
    assert all(recurring(client, admin, i)["is_active"] for i in (a, b, c))

    assert client.post("/api/v1/recurring-payments/bulk/stop", headers=admin, json={"ids": []}).status_code == 422


def test_global_reminder_window(client, admin, user, notifier, run_reminders):
    settings = client.get("/api/v1/settings", headers=user).json()
    assert settings["reminder_days_before"] == 3 and settings["reminder_days_default"] == 3

    payment = create_payment(client, admin, next_due_date="2026-10-31")
    run_reminders()
    assert notifier.sent == []
    assert occurrences(client, admin, recurring_payment_id=payment["id"])[0]["state"] == "upcoming"

    response = client.patch("/api/v1/settings", headers=admin, json={"reminder_days_before": 7})
    assert response.status_code == 200 and response.json()["reminder_days_before"] == 7
    assert client.get("/api/v1/meta", headers=user).json()["reminder_days_before"] == 7
    assert occurrences(client, admin, recurring_payment_id=payment["id"])[0]["state"] == "due_soon"
    assert run_reminders() == 1

    for bad in (0, 2, 366, "x"):  # меньше 3 дней нельзя — требование кейса
        assert client.patch("/api/v1/settings", headers=admin, json={"reminder_days_before": bad}).status_code == 422
    entry = client.get("/api/v1/audit-log", headers=admin, params={"action": "settings.update"}).json()["items"][0]
    assert entry["details"] == {"reminder_days_before": {"from": 3, "to": 7}}


def test_per_payment_reminder_window(client, admin, notifier, run_reminders):
    own = create_payment(client, admin, name="Аренда", next_due_date="2026-11-03", remind_days=10)
    assert own["remind_days"] == 10 and own["remind_days_effective"] == 10
    common = create_payment(client, admin, name="Сервер", next_due_date="2026-11-03")
    assert common["remind_days"] is None and common["remind_days_effective"] == 3

    run_reminders()
    assert [r.payment_name for r in notifier.sent] == ["Аренда"]

    url = f"/api/v1/recurring-payments/{common['id']}"
    assert client.patch(url, headers=admin, json={"remind_days": 14}).json()["remind_days_effective"] == 14
    run_reminders()
    assert [r.payment_name for r in notifier.sent] == ["Аренда", "Сервер"]

    reset = client.patch(url, headers=admin, json={"remind_days": None}).json()
    assert reset["remind_days"] is None and reset["remind_days_effective"] == 3
    bad = client.post("/api/v1/recurring-payments", headers=admin, json={
        "name": "X", "amount": "1.00", "currency": "RUB", "next_due_date": "2026-11-01", "remind_days": 2})
    assert bad.status_code == 422
