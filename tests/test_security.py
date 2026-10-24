"""SQL-инъекции, XSS, CSRF и заголовки безопасности."""

import sqlite3
from datetime import date

import pytest

from app.services.reminders import Reminder, ReminderItem
from app.telegram.messages import render_reminder
from tests.conftest import ADMIN, create_payment, login, occurrences

SQLI = [
    "' OR '1'='1",
    "admin'--",
    "'; DROP TABLE users; --",
    "1; DELETE FROM payment_occurrences",
    "%' OR 1=1 --",
]


# --- SQL-инъекции -------------------------------------------------------------


@pytest.mark.parametrize("payload", SQLI)
def test_login_is_not_injectable(client, payload):
    assert client.post("/api/v1/auth/login", json={"login": payload, "password": payload}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"login": "admin", "password": payload}).status_code == 401


def test_injection_payloads_are_stored_as_plain_text(client, admin, db_url):
    name = "Аренда'); DROP TABLE users; --"
    payment = create_payment(client, admin, name=name)
    assert payment["name"] == name
    assert client.get(f"/api/v1/recurring-payments/{payment['id']}", headers=admin).json()["name"] == name

    created = client.post("/api/v1/users", headers=admin,
                          json={"login": "bob", "password": "secret1", "name": "Robert'); DROP TABLE users;--"})
    assert created.status_code == 201

    # таблицы на месте, данные целы
    with sqlite3.connect(db_url.removeprefix("sqlite:///")) as raw:
        tables = {row[0] for row in raw.execute("select name from sqlite_master where type='table'")}
        assert {"users", "recurring_payments", "payment_occurrences", "sessions", "audit_log"} <= tables
        assert raw.execute("select count(*) from users").fetchone()[0] == 2


@pytest.mark.parametrize("payload", SQLI)
def test_query_params_are_not_injectable(client, admin, payload):
    create_payment(client, admin)
    # типизированные параметры отвергают мусор
    assert client.get("/api/v1/payment-occurrences", headers=admin, params={"currency": payload}).status_code == 422
    assert client.get("/api/v1/payment-occurrences", headers=admin, params={"from": payload}).status_code == 422
    assert client.get("/api/v1/payment-occurrences", headers=admin,
                      params={"recurring_payment_id": payload}).status_code == 422
    # строковые фильтры — просто не находят ничего (в LIKE % и _ экранируются)
    response = client.get("/api/v1/audit-log", headers=admin, params={"action": payload})
    assert response.status_code == 200 and response.json()["total"] == 0
    response = client.get("/api/v1/audit-log", headers=admin, params={"actor": payload})
    assert response.status_code == 200 and response.json()["total"] == 0


def test_path_params_are_typed(client, admin):
    assert client.get("/api/v1/payment-occurrences/1 OR 1=1", headers=admin).status_code == 422
    assert client.delete("/api/v1/users/1;DROP", headers=admin).status_code == 422


# --- XSS ------------------------------------------------------------------------

XSS = '<script>alert("xss")</script><img src=x onerror=alert(1)>'


def test_xss_payload_is_returned_as_json_data_not_html(client, admin):
    payment = create_payment(client, admin, name=XSS)
    response = client.get("/api/v1/payment-occurrences", headers=admin)
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["items"][0]["name"] == XSS  # данные не искажаются; экранирует React при выводе
    assert payment["name"] == XSS


def test_receipt_url_rejects_dangerous_schemes(client, admin):
    payment = create_payment(client, admin, next_due_date="2026-10-20")
    occ = occurrences(client, admin, recurring_payment_id=payment["id"])[0]
    url = f"/api/v1/payment-occurrences/{occ['id']}"
    for bad in ("javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd"):
        assert client.patch(url, headers=admin, json={"receipt_url": bad}).status_code == 422, bad
    ok = client.patch(url, headers=admin, json={"receipt_url": "https://example.com/check/42"})
    assert ok.status_code == 200 and ok.json()["receipt_url"] == "https://example.com/check/42"


def test_control_characters_rejected(client, admin):
    response = client.post("/api/v1/recurring-payments", headers=admin, json={
        "name": "Аренда\u0000\u001b[31m", "amount": "1.00", "currency": "RUB", "next_due_date": "2026-11-01"})
    assert response.status_code == 422


def test_telegram_message_escapes_html():
    reminder = Reminder(
        payment_id=1, payment_name=XSS, payment_active=True, today=date(2026, 10, 24),
        items=[ReminderItem(1, date(2026, 10, 26), 100, "RUB", paid_at=date(2026, 10, 24), paid_by_label="tg:@<b>x</b>")],
    )
    text, _ = render_reminder(reminder)
    assert "<script>" not in text and "<img" not in text and "<b>x</b>" not in text
    assert "&lt;script&gt;" in text and "&lt;b&gt;x&lt;/b&gt;" in text


# --- заголовки ---------------------------------------------------------------------


def test_security_headers_on_panel_and_api(client, admin):
    panel = client.get("/")
    csp = panel.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "'unsafe-inline'" not in csp.split("script-src")[1].split(";")[0]
    assert "frame-ancestors 'none'" in csp
    assert panel.headers["x-content-type-options"] == "nosniff"
    assert panel.headers["x-frame-options"] == "DENY"

    api = client.get("/api/v1/auth/me", headers=admin)
    assert api.headers["cache-control"] == "no-store"
    assert api.headers["x-content-type-options"] == "nosniff"

    docs = client.get("/api/v1/docs")
    assert docs.status_code == 200 and "https://cdn.jsdelivr.net" in docs.headers["content-security-policy"]


def test_session_cookie_flags(client):
    response = client.post("/api/v1/auth/login", json={"login": ADMIN[0], "password": ADMIN[1]})
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie


# --- CSRF ------------------------------------------------------------------------------


def test_cookie_requests_from_foreign_origin_are_rejected(client, admin):
    create_payment(client, admin)
    client.post("/api/v1/auth/login", json={"login": ADMIN[0], "password": ADMIN[1]})  # cookie-сессия
    occ = occurrences(client, admin)[0]
    url = f"/api/v1/payment-occurrences/{occ['id']}"

    evil = client.patch(url, json={"paid": True}, headers={"Origin": "https://evil.example"})
    assert evil.status_code == 403
    assert client.get(url).json()["status"] == "unpaid"

    same = client.patch(url, json={"paid": True}, headers={"Origin": "http://testserver"})
    assert same.status_code == 200

    # чтение с чужого Origin не меняет данных — разрешено (CORS всё равно не отдаст ответ)
    assert client.get(url, headers={"Origin": "https://evil.example"}).status_code == 200
    # Bearer-токен браузер сам не подставляет — для него проверка не нужна
    bearer = login(client, *ADMIN)
    client.cookies.clear()
    assert client.patch(url, json={"paid": False}, headers={**bearer, "Origin": "https://evil.example"}).status_code == 200
