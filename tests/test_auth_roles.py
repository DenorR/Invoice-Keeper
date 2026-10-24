import re

import pytest

from tests.conftest import ADMIN, login

PUBLIC = {("POST", "/api/v1/auth/login")}


def api_routes(app):
    """Все операции API — из OpenAPI-спецификации (она строится из тех же роутов)."""
    for path, operations in app.openapi()["paths"].items():
        for method in operations:
            yield method.upper(), path


def test_every_api_route_requires_auth(app, client):
    checked = 0
    for method, path in api_routes(app):
        if (method, path) in PUBLIC:
            continue
        url = re.sub(r"\{[^}]+\}", "1", path)
        response = client.request(method, url, json={})
        assert response.status_code == 401, f"{method} {path} → {response.status_code}"
        assert response.json()["error"]["code"] == "unauthorized"
        checked += 1
    assert checked >= 14


def test_docs_are_public(client):
    assert client.get("/api/v1/docs").status_code == 200
    spec = client.get("/api/v1/openapi.json").json()
    assert "/api/v1/recurring-payments" in spec["paths"]


def test_login_wrong_password(client):
    response = client.post("/api/v1/auth/login", json={"login": "admin", "password": "nope"})
    assert response.status_code == 401


def test_login_me_logout(client):
    headers = login(client, *ADMIN)
    me = client.get("/api/v1/auth/me", headers=headers).json()
    assert me["role"] == "admin" and me["managed_by_env"] is True
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_cookie_session_works_for_panel(client):
    client.post("/api/v1/auth/login", json={"login": ADMIN[0], "password": ADMIN[1]})
    assert client.get("/api/v1/auth/me").status_code == 200
    client.post("/api/v1/auth/logout")
    assert client.get("/api/v1/auth/me").status_code == 401


ADMIN_ONLY = [
    ("POST", "/api/v1/recurring-payments"),
    ("PATCH", "/api/v1/recurring-payments/1"),
    ("DELETE", "/api/v1/recurring-payments/1"),
    ("GET", "/api/v1/users"),
    ("POST", "/api/v1/users"),
    ("GET", "/api/v1/users/1"),
    ("PATCH", "/api/v1/users/1"),
    ("DELETE", "/api/v1/users/1"),
    ("GET", "/api/v1/audit-log"),
]


@pytest.mark.parametrize("method,url", ADMIN_ONLY)
def test_user_cannot_call_admin_endpoints(client, user, method, url):
    body = {"name": "x", "amount": "1.00", "currency": "RUB", "next_due_date": "2026-11-01",
            "login": "hacker", "password": "123456"}
    response = client.request(method, url, headers=user, json=body)
    assert response.status_code == 403, f"{method} {url} → {response.status_code}"
    assert response.json()["error"]["code"] == "forbidden"


def test_user_can_view_and_mark(client, admin, user):
    client.post("/api/v1/recurring-payments", headers=admin, json={
        "name": "Сервер", "amount": "10.00", "currency": "USD", "next_due_date": "2026-11-01"})
    assert client.get("/api/v1/recurring-payments", headers=user).status_code == 200
    items = client.get("/api/v1/payment-occurrences", headers=user).json()["items"]
    response = client.patch(f"/api/v1/payment-occurrences/{items[0]['id']}", headers=user, json={"paid": True})
    assert response.status_code == 200 and response.json()["status"] == "paid"
    assert client.get("/api/v1/payments/summary", headers=user).status_code == 200


def test_admin_account_is_immutable(client, admin):
    admin_id = client.get("/api/v1/auth/me", headers=admin).json()["id"]
    assert client.patch(f"/api/v1/users/{admin_id}", headers=admin, json={"name": "x"}).status_code == 403
    assert client.patch(f"/api/v1/users/{admin_id}", headers=admin, json={"password": "new-pass"}).status_code == 403
    assert client.delete(f"/api/v1/users/{admin_id}", headers=admin).status_code == 403


def test_user_crud_and_conflicts(client, admin):
    created = client.post("/api/v1/users", headers=admin, json={"login": "Maria", "password": "maria-pass"})
    assert created.status_code == 201 and created.json()["login"] == "maria" and created.json()["role"] == "user"
    user_id = created.json()["id"]

    assert client.post("/api/v1/users", headers=admin, json={"login": "maria", "password": "x123456"}).status_code == 409
    assert client.post("/api/v1/users", headers=admin, json={"login": "admin", "password": "x123456"}).status_code == 409
    # роль через API не назначить
    assert client.post("/api/v1/users", headers=admin,
                       json={"login": "boss", "password": "x123456", "role": "admin"}).status_code == 422

    maria = login(client, "maria", "maria-pass")
    renamed = client.patch(f"/api/v1/users/{user_id}", headers=admin, json={"name": "Мария", "password": "new-pass-1"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Мария"
    # смена пароля завершает сессии пользователя
    assert client.get("/api/v1/auth/me", headers=maria).status_code == 401
    maria = login(client, "maria", "new-pass-1")

    assert client.delete(f"/api/v1/users/{user_id}", headers=admin).status_code == 204
    assert client.get("/api/v1/auth/me", headers=maria).status_code == 401
    logins = [u["login"] for u in client.get("/api/v1/users", headers=admin).json()]
    assert logins == ["admin"]
