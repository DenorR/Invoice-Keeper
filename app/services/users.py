from __future__ import annotations

import logging
import os

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import DEFAULT_ADMIN_PASSWORD, Settings
from app.errors import conflict, forbidden, not_found
from app.models import AuthSession, User
from app.services import audit
from app.services.audit import Actor
from app.services.security import hash_password, verify_password

log = logging.getLogger(__name__)

ADMIN_IMMUTABLE = "Учётная запись администратора задаётся в .env и не изменяется через панель или API"


def normalize_login(login: str) -> str:
    return login.strip().lower()


def ensure_admin(db: Session, settings: Settings) -> User:
    """Синхронизирует единственного администратора с .env (ADMIN_LOGIN, ADMIN_PASSWORD) при каждом старте.

    Смена логина или пароля в .env применяется к той же учётной записи и сбрасывает её сессии.
    Лишние администраторы (остались от версий с ADMINS) удаляются — их отметки об оплате остаются в истории.
    """
    password = settings.admin_password.get_secret_value()
    if password == DEFAULT_ADMIN_PASSWORD:
        log.warning("ADMIN_PASSWORD имеет значение по умолчанию — смените его в .env")
    if os.environ.get("ADMINS"):
        log.warning("ADMINS больше не поддерживается: администратор один — ADMIN_LOGIN. Строку можно удалить из .env")

    holder = db.scalar(select(User).where(User.login == settings.admin_login))
    if holder is not None and not holder.is_admin:
        raise SystemExit(
            f"ADMIN_LOGIN={settings.admin_login} уже занят обычным пользователем. "
            "Укажите другой логин администратора в .env."
        )

    admins = list(db.scalars(select(User).where(User.role == "admin").order_by(User.id)).all())
    admin = holder or (admins[0] if admins else None)
    for extra in admins:
        if extra is not admin:
            db.execute(delete(AuthSession).where(AuthSession.user_id == extra.id))
            db.delete(extra)
            log.info("Администратор «%s» удалён: в системе один администратор (ADMIN_LOGIN)", extra.login)
    db.flush()

    if admin is None:
        admin = User(login=settings.admin_login, name="Администратор", role="admin",
                     password_hash=hash_password(password))
        db.add(admin)
        db.flush()
        return admin

    if admin.login != settings.admin_login or not verify_password(password, admin.password_hash):
        admin.login = settings.admin_login
        admin.password_hash = hash_password(password)
        db.execute(delete(AuthSession).where(AuthSession.user_id == admin.id))
        log.info("Учётные данные администратора обновлены из .env, его сессии сброшены")
    db.flush()
    return admin


def list_users(db: Session) -> list[User]:
    return list(db.scalars(select(User).order_by(User.role, User.login)).all())


def get_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise not_found("Пользователь")
    return user


def _ensure_login_free(db: Session, login: str, settings: Settings, exclude_id: int | None = None) -> None:
    if login == settings.admin_login:
        raise conflict("login_taken", "Этот логин зарезервирован за администратором")
    existing = db.scalar(select(User).where(User.login == login))
    if existing is not None and existing.id != exclude_id:
        raise conflict("login_taken", "Пользователь с таким логином уже существует")


def create_user(db: Session, settings: Settings, actor: Actor, login: str, password: str, name: str | None) -> User:
    login = normalize_login(login)
    _ensure_login_free(db, login, settings)
    user = User(login=login, name=name, role="user", password_hash=hash_password(password))
    db.add(user)
    db.flush()
    audit.record(db, actor, "user.create", "user", user.id, {"login": login})
    return user


def update_user(
    db: Session,
    settings: Settings,
    actor: Actor,
    user_id: int,
    *,
    login: str | None = None,
    password: str | None = None,
    name: str | None = None,
    name_set: bool = False,
) -> User:
    user = get_user(db, user_id)
    if user.is_admin:
        raise forbidden(ADMIN_IMMUTABLE)

    changes: dict[str, object] = {}
    if login is not None:
        login = normalize_login(login)
        if login != user.login:
            _ensure_login_free(db, login, settings, exclude_id=user.id)
            changes["login"] = {"from": user.login, "to": login}
            user.login = login
    if name_set and name != user.name:
        changes["name"] = {"from": user.name, "to": name}
        user.name = name
    if password is not None:
        user.password_hash = hash_password(password)
        db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
        changes["password"] = "changed"

    if changes:
        audit.record(db, actor, "user.update", "user", user.id, changes)
    return user


def delete_user(db: Session, actor: Actor, user_id: int) -> None:
    user = get_user(db, user_id)
    if user.is_admin:
        raise forbidden(ADMIN_IMMUTABLE)
    audit.record(db, actor, "user.delete", "user", user.id, {"login": user.login})
    db.delete(user)
