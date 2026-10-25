"""Настройки, которые администратор меняет в панели.

* за сколько дней до срока напоминать — значение по умолчанию из .env (REMINDER_DAYS_BEFORE),
  у отдельного платежа может быть своё;
* можно ли прикреплять файлы чеков — по умолчанию можно.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.domain.reminders import clamp_days
from app.models import AppSetting
from app.services import audit
from app.services.audit import Actor

REMINDER_DAYS = "reminder_days_before"
UPLOADS_ENABLED = "uploads_enabled"


def _get(db: Session, key: str):
    row = db.get(AppSetting, key)
    return row.value if row is not None else None


def _set(db: Session, actor: Actor, key: str, value, old) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key)
        db.add(row)
    row.value = value
    if old != value:
        audit.record(db, actor, "settings.update", "settings", None, {key: {"from": old, "to": value}})
    db.flush()


def reminder_days(db: Session, default: int) -> int:
    value = _get(db, REMINDER_DAYS)
    return clamp_days(int(value) if value is not None else default)


def set_reminder_days(db: Session, actor: Actor, value: int, default: int) -> int:
    _set(db, actor, REMINDER_DAYS, value, reminder_days(db, default))
    return value


def uploads_enabled(db: Session) -> bool:
    value = _get(db, UPLOADS_ENABLED)
    return True if value is None else bool(value)


def set_uploads_enabled(db: Session, actor: Actor, value: bool) -> bool:
    _set(db, actor, UPLOADS_ENABLED, value, uploads_enabled(db))
    return value
