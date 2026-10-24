from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AuditLog, User


@dataclass(frozen=True)
class Actor:
    """Кто совершает действие: пользователь панели/API, Telegram-пользователь или система."""

    user_id: int | None
    label: str
    ip: str | None = None

    @classmethod
    def from_user(cls, user: User, ip: str | None = None) -> Actor:
        return cls(user_id=user.id, label=user.login, ip=ip)

    @classmethod
    def system(cls) -> Actor:
        return cls(user_id=None, label="system")


def record(
    db: Session,
    actor: Actor,
    action: str,
    entity: str | None = None,
    entity_id: int | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.user_id,
            actor_label=actor.label,
            action=action,
            entity=entity,
            entity_id=entity_id,
            details=details,
            ip=actor.ip,
        )
    )


def list_entries(
    db: Session, *, limit: int, offset: int, action: str | None = None, actor: str | None = None
) -> tuple[list[AuditLog], int]:
    query = select(AuditLog)
    if action:
        query = query.where(AuditLog.action.startswith(action))
    if actor:
        query = query.where(AuditLog.actor_label == actor)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(query.order_by(AuditLog.id.desc()).limit(limit).offset(offset)).all()
    return list(items), total
