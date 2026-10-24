from datetime import date

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import ADMIN, create_payment, login, occurrences


def test_create_generates_current_and_next_period(client, admin):
    payment = create_payment(client, admin, next_due_date="2026-10-31")
    items = occurrences(client, admin, recurring_payment_id=payment["id"])
    assert [o["due_date"] for o in items] == ["2026-10-31"]
    assert payment["next_due_date"] == "2026-10-31"

    payment = create_payment(client, admin, name="Сервер", currency="USD", amount="49.9", next_due_date="2026-10-26")
    items = occurrences(client, admin, recurring_payment_id=payment["id"])
    # срок в окне напоминания + следующий период
    assert [o["due_date"] for o in items] == ["2026-10-26", "2026-11-26"]
    assert items[0]["amount"] == "49.90" and items[0]["state"] == "due_soon"


def test_validation(client, admin):
    base = {"name": "X", "amount": "10.00", "currency": "RUB", "next_due_date": "2026-11-01"}
    for bad in ({"currency": "GBP"}, {"amount": "0"}, {"amount": "-5"}, {"amount": "1.234"}, {"name": ""}):
        response = client.post("/api/v1/recurring-payments", headers=admin, json={**base, **bad})
        assert response.status_code == 422, bad
        assert response.json()["error"]["code"] == "validation_error"


def test_mark_unmark_and_correct_date(client, admin, user, clock):
    payment = create_payment(client, admin, next_due_date="2026-10-20")  # уже просрочен на 4 дня
    [occ] = [o for o in occurrences(client, user, recurring_payment_id=payment["id"]) if o["due_date"] == "2026-10-20"]
    assert occ["state"] == "overdue" and occ["overdue_days"] == 4
    url = f"/api/v1/payment-occurrences/{occ['id']}"

    paid = client.patch(url, headers=user, json={"paid": True}).json()
    assert paid["status"] == "paid" and paid["paid_at"] == "2026-10-24"
    assert paid["state"] == "paid_late" and paid["overdue_days"] == 4
    assert paid["paid_by"]["label"] == "ivan"

    # исправили фактическую дату на день срока — просрочка исчезла, срок не изменился
    fixed = client.patch(url, headers=user, json={"paid_at": "2026-10-20"}).json()
    assert fixed["is_overdue"] is False and fixed["state"] == "paid_on_time" and fixed["due_date"] == "2026-10-20"

    # отмена оплаты очищает дату
    unpaid = client.patch(url, headers=user, json={"paid": False}).json()
    assert unpaid["status"] == "unpaid" and unpaid["paid_at"] is None and unpaid["paid_by"] is None
    assert unpaid["state"] == "overdue"


def test_paid_at_cannot_be_in_future(client, admin):
    payment = create_payment(client, admin, next_due_date="2026-10-30")
    occ = occurrences(client, admin, recurring_payment_id=payment["id"])[0]
    response = client.patch(f"/api/v1/payment-occurrences/{occ['id']}", headers=admin,
                            json={"paid": True, "paid_at": "2026-10-25"})
    assert response.status_code == 422 and response.json()["error"]["code"] == "paid_at_in_future"
    response = client.patch(f"/api/v1/payment-occurrences/{occ['id']}", headers=admin,
                            json={"paid": False, "paid_at": "2026-10-20"})
    assert response.status_code == 422


def test_next_period_has_its_own_status_and_history_is_kept(client, admin, clock):
    payment = create_payment(client, admin, next_due_date="2026-10-25")
    first, second = occurrences(client, admin, recurring_payment_id=payment["id"])
    client.patch(f"/api/v1/payment-occurrences/{first['id']}", headers=admin, json={"paid": True})

    # прошёл месяц: появился ещё один период, прошлые оплаты на месте
    clock.set_today(date(2026, 11, 24))
    admin = login(client, *ADMIN)  # прежняя сессия истекла (TTL 7 дней)
    items = occurrences(client, admin, recurring_payment_id=payment["id"])
    assert [o["due_date"] for o in items[:2]] == ["2026-10-25", "2026-11-25"]
    assert items[0]["status"] == "paid" and items[1]["status"] == "unpaid"


def test_paying_in_advance_shows_following_period(client, admin):
    payment = create_payment(client, admin, next_due_date="2026-12-10")
    [only] = occurrences(client, admin, recurring_payment_id=payment["id"])
    client.patch(f"/api/v1/payment-occurrences/{only['id']}", headers=admin, json={"paid": True})
    dates = [o["due_date"] for o in occurrences(client, admin, recurring_payment_id=payment["id"])]
    assert dates == ["2026-12-10", "2027-01-10"]


def test_overdue_does_not_block_next_periods(client, admin, clock, run_reminders):
    payment = create_payment(client, admin, next_due_date="2026-09-10")
    run_reminders()  # фоновая генерация
    statuses = {o["due_date"]: o["state"] for o in occurrences(client, admin, recurring_payment_id=payment["id"])}
    assert statuses == {"2026-09-10": "overdue", "2026-10-10": "overdue", "2026-11-10": "upcoming"}


def test_edit_amount_changes_only_future_unpaid(client, admin):
    payment = create_payment(client, admin, next_due_date="2026-10-01")
    past = occurrences(client, admin, recurring_payment_id=payment["id"])[0]
    client.patch(f"/api/v1/payment-occurrences/{past['id']}", headers=admin, json={"paid_at": "2026-10-01"})

    response = client.patch(f"/api/v1/recurring-payments/{payment['id']}", headers=admin,
                            json={"amount": "90000", "name": "Аренда (новая)"})
    assert response.status_code == 200 and response.json()["amount"] == "90000.00"
    items = {o["due_date"]: o for o in occurrences(client, admin, recurring_payment_id=payment["id"])}
    assert items["2026-10-01"]["amount"] == "85000.00"  # история не меняется
    assert items["2026-11-01"]["amount"] == "90000.00"
    assert items["2026-11-01"]["name"] == "Аренда (новая)"


def test_edit_schedule(client, admin):
    payment = create_payment(client, admin, next_due_date="2026-11-15")
    response = client.patch(f"/api/v1/recurring-payments/{payment['id']}", headers=admin,
                            json={"next_due_date": "2026-11-05", "frequency": "quarterly"})
    assert response.status_code == 200
    assert response.json()["next_due_date"] == "2026-11-05" and response.json()["frequency"] == "quarterly"
    assert [o["due_date"] for o in occurrences(client, admin, recurring_payment_id=payment["id"])] == ["2026-11-05"]

    past = client.patch(f"/api/v1/recurring-payments/{payment['id']}", headers=admin, json={"next_due_date": "2026-10-01"})
    assert past.status_code == 422 and past.json()["error"]["code"] == "next_due_date_in_past"


def test_delete_keeps_history_and_stops_periods(client, admin, clock):
    payment = create_payment(client, admin, next_due_date="2026-10-01")
    first = occurrences(client, admin, recurring_payment_id=payment["id"])[0]
    client.patch(f"/api/v1/payment-occurrences/{first['id']}", headers=admin, json={"paid_at": "2026-10-01"})

    assert client.delete(f"/api/v1/recurring-payments/{payment['id']}", headers=admin).status_code == 204
    assert payment["id"] not in [p["id"] for p in client.get("/api/v1/recurring-payments", headers=admin).json()]
    stopped = client.get(f"/api/v1/recurring-payments/{payment['id']}", headers=admin).json()
    assert stopped["is_active"] is False

    items = occurrences(client, admin, recurring_payment_id=payment["id"])
    assert [o["due_date"] for o in items] == ["2026-10-01"]  # будущий неоплаченный период удалён
    assert items[0]["payment_active"] is False and items[0]["status"] == "paid"

    clock.set_today(date(2027, 3, 1))
    admin = login(client, *ADMIN)
    assert len(occurrences(client, admin, recurring_payment_id=payment["id"])) == 1
    assert client.patch(f"/api/v1/recurring-payments/{payment['id']}", headers=admin, json={"name": "x"}).status_code == 409


def test_summary_is_split_by_currency(client, admin):
    rub = create_payment(client, admin, next_due_date="2026-10-10", amount="100.00", currency="RUB")
    usd = create_payment(client, admin, next_due_date="2026-10-26", amount="20.50", currency="USD")
    create_payment(client, admin, next_due_date="2026-10-27", amount="7.00", currency="EUR")
    rub_occ = occurrences(client, admin, recurring_payment_id=rub["id"])[0]
    client.patch(f"/api/v1/payment-occurrences/{rub_occ['id']}", headers=admin, json={"paid_at": "2026-10-12"})

    summary = client.get("/api/v1/payments/summary", headers=admin).json()
    by = {c["currency"]: c for c in summary["currencies"]}
    assert list(by) == ["RUB", "USD", "EUR"]
    assert by["RUB"]["paid"] == {"amount": "100.00", "count": 1}
    assert by["USD"]["unpaid"] == {"amount": "41.00", "count": 2}
    assert by["EUR"]["overdue"] == {"amount": "0.00", "count": 0}

    october = client.get("/api/v1/payments/summary", headers=admin, params={"from": "2026-10-01", "to": "2026-10-31"}).json()
    assert {c["currency"]: c["unpaid"]["amount"] for c in october["currencies"]} == {"RUB": "0.00", "USD": "20.50", "EUR": "7.00"}


def test_filters(client, admin):
    create_payment(client, admin, next_due_date="2026-10-10", currency="EUR", amount="5")
    assert {o["currency"] for o in occurrences(client, admin, currency="EUR")} == {"EUR"}
    overdue = occurrences(client, admin, status="unpaid", overdue="true")
    assert [o["due_date"] for o in overdue] == ["2026-10-10"]
    assert occurrences(client, admin, status="paid") == []


def test_data_survives_restart(settings, clock, notifier):
    app = create_app(settings, clock=clock, notifier=notifier, start_background=False)
    with TestClient(app) as client:
        headers = login(client, *ADMIN)
        payment = create_payment(client, headers, next_due_date="2026-10-20")
        occ = occurrences(client, headers)[0]
        client.patch(f"/api/v1/payment-occurrences/{occ['id']}", headers=headers, json={"paid_at": "2026-10-21"})

    app = create_app(settings, clock=clock, notifier=notifier, start_background=False)
    with TestClient(app) as client:
        headers = login(client, *ADMIN)
        items = occurrences(client, headers, recurring_payment_id=payment["id"])
        assert items[0]["paid_at"] == "2026-10-21" and items[0]["state"] == "paid_late"


def test_forecast_mixes_real_and_planned_periods(client, admin):
    payment = create_payment(client, admin, next_due_date="2026-10-31", amount="100.00", currency="RUB")
    create_payment(client, admin, next_due_date="2026-11-05", amount="10.00", currency="USD", frequency="weekly")
    data = client.get("/api/v1/payments/forecast", headers=admin, params={"from": "2026-10-01", "to": "2026-12-31"}).json()
    rent = [i for i in data["items"] if i["recurring_payment_id"] == payment["id"]]
    assert [(i["due_date"], i["status"]) for i in rent] == [
        ("2026-10-31", "unpaid"), ("2026-11-30", "planned"), ("2026-12-31", "planned")]
    totals = {t["currency"]: t for t in data["totals"]}
    assert totals["RUB"]["planned"] == {"amount": "300.00", "count": 3}
    assert totals["USD"]["planned"]["count"] == 9  # 05.11 … 31.12 еженедельно
    assert totals["EUR"]["planned"]["amount"] == "0.00"

    too_big = client.get("/api/v1/payments/forecast", headers=admin, params={"from": "2026-01-01", "to": "2027-06-01"})
    assert too_big.status_code == 422
