from __future__ import annotations

import asyncio
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.dates import FixedClock
from app.main import create_app

TZ = ZoneInfo("Europe/Moscow")
TODAY = date(2026, 10, 24)
ADMIN = ("admin", "admin-pass")


class FakeNotifier:
    """Вместо Telegram: запоминает отправленные напоминания."""

    def __init__(self):
        self.sent = []
        self.refreshed = []
        self.fail = False
        self.enabled = True
        self._message_id = 1000

    async def send_reminder(self, reminder):
        if self.fail:
            raise RuntimeError("telegram недоступен")
        self.sent.append(reminder)
        self._message_id += 1
        return self._message_id

    async def refresh_reminder(self, message_id, reminder):
        self.refreshed.append((message_id, reminder))


@pytest.fixture
def db_url(tmp_path):
    return f"sqlite:///{(tmp_path / 'test.db').as_posix()}"


@pytest.fixture
def settings(db_url):
    return Settings(
        _env_file=None,
        admin_login=ADMIN[0],
        admin_password=ADMIN[1],
        database_url=db_url,
        seed_demo_data=False,
        app_timezone="Europe/Moscow",
        telegram_bot_token=None,
        telegram_chat_id=None,
    )


@pytest.fixture
def clock():
    clock = FixedClock(TZ, datetime(2026, 10, 24, 9, 0, tzinfo=TZ))
    return clock


@pytest.fixture
def notifier():
    return FakeNotifier()


@pytest.fixture
def app(settings, clock, notifier):
    return create_app(settings, clock=clock, notifier=notifier, start_background=False)


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


def login(client: TestClient, username: str, password: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"login": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


@pytest.fixture
def admin(client):
    return login(client, *ADMIN)


@pytest.fixture
def user(client, admin):
    response = client.post("/api/v1/users", headers=admin, json={"login": "ivan", "password": "ivan-pass", "name": "Иван"})
    assert response.status_code == 201, response.text
    return login(client, "ivan", "ivan-pass")


@pytest.fixture
def run_reminders(app):
    def run() -> int:
        return asyncio.run(app.state.container.reminders.run_cycle())

    return run


def create_payment(client, headers, **overrides):
    payload = {
        "name": "Аренда",
        "amount": "85000.00",
        "currency": "RUB",
        "next_due_date": "2026-11-15",
        "frequency": "monthly",
    }
    payload.update(overrides)
    response = client.post("/api/v1/recurring-payments", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def occurrences(client, headers, **params):
    response = client.get("/api/v1/payment-occurrences", headers=headers, params={"limit": 500, **params})
    assert response.status_code == 200, response.text
    return response.json()["items"]
