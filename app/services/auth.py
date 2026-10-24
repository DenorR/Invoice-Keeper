from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from threading import Lock

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.errors import ApiError, unauthorized
from app.models import AuthSession, User
from app.services import audit
from app.services.audit import Actor
from app.services.security import hash_password, hash_token, new_session_token, verify_password
from app.services.users import normalize_login

# Хэш-заглушка, чтобы время ответа не выдавало, существует ли логин.
_DUMMY_HASH = hash_password("timing-equalizer")


class LoginRateLimiter:
    """Не более `max_failures` неудачных входов за `window` секунд с одного IP."""

    def __init__(self, max_failures: int = 10, window: float = 300.0):
        self.max_failures = max_failures
        self.window = window
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        attempts = self._failures[key]
        while attempts and now - attempts[0] > self.window:
            attempts.popleft()
        return attempts

    def check(self, key: str) -> None:
        with self._lock:
            if len(self._prune(key, time.monotonic())) >= self.max_failures:
                raise ApiError(429, "too_many_attempts", "Слишком много неудачных попыток входа, попробуйте позже")

    def fail(self, key: str) -> None:
        with self._lock:
            self._prune(key, time.monotonic()).append(time.monotonic())

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)


def login(
    db: Session,
    *,
    login_value: str,
    password: str,
    now: datetime,
    ttl: timedelta,
    ip: str | None,
    user_agent: str | None,
) -> tuple[str, AuthSession]:
    login_value = normalize_login(login_value)
    user = db.scalar(select(User).where(User.login == login_value))
    password_ok = verify_password(password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not password_ok:
        audit.record(db, Actor(user_id=None, label=login_value[:128] or "?", ip=ip), "auth.login_failed")
        db.commit()
        raise unauthorized("Неверный логин или пароль")

    token = new_session_token()
    session = AuthSession(
        token_hash=hash_token(token),
        user_id=user.id,
        created_at=now,
        expires_at=now + ttl,
        last_seen_at=now,
        ip=ip,
        user_agent=(user_agent or "")[:255] or None,
    )
    db.add(session)
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at < now))
    audit.record(db, Actor.from_user(user, ip), "auth.login")
    db.flush()
    session.user = user
    return token, session


def resolve(db: Session, token: str, now: datetime) -> User | None:
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
    if session is None:
        return None
    if session.expires_at <= now:
        db.delete(session)
        db.commit()
        return None
    if now - session.last_seen_at > timedelta(minutes=5):
        session.last_seen_at = now
        db.commit()
    return session.user


def logout(db: Session, token: str, actor: Actor) -> None:
    db.execute(delete(AuthSession).where(AuthSession.token_hash == hash_token(token)))
    audit.record(db, actor, "auth.logout")
