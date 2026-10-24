from __future__ import annotations

import logging

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


def ensure_admins(db: Session, settings: Settings) -> list[User]:
    """Приводит администраторов в базе к списку из .env (ADMIN_LOGIN + ADMINS) при каждом старте.

    Новые создаются, у изменившихся обновляется пароль и сбрасываются сессии,
    убранные из .env удаляются (их отметки об оплате остаются в истории).
    """
    if settings.admin_password.get_secret_value() == DEFAULT_ADMIN_PASSWORD:
        log.warning("ADMIN_PASSWORD имеет значение по умолчанию — смените его в .env")
    wanted = dict(settings.admin_accounts)

    for login in wanted:
        holder = db.scalar(select(User).where(User.login == login))
        if holder is not None and not holder.is_admin:
            raise SystemExit(
                f"Логин администратора «{login}» уже занят обычным пользователем. "
                "Укажите другой логин в .env (ADMIN_LOGIN или ADMINS)."
            )

    existing = {user.login: user for user in db.scalars(select(User).where(User.role == "admin")).all()}
    result = []
    for login, password in wanted.items():
        user = existing.get(login)
        if user is None:
            name = "Администратор" if login == settings.admin_login else None
            user = User(login=login, name=name, role="admin", password_hash=hash_password(password))
            db.add(user)
            log.info("Администратор «%s» добавлен из .env", login)
        elif not verify_password(password, user.password_hash):
            user.password_hash = hash_password(password)
            db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
            log.info("Пароль администратора «%s» обновлён из .env, его сессии сброшены", login)
        result.append(user)
    for login, user in existing.items():
        if login not in wanted:
            db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
            db.delete(user)
            log.info("Администратор «%s» убран из .env — доступ закрыт", login)
    db.flush()
    return result


def list_users(db: Session) -> list[User]:
    return list(db.scalars(select(User).order_by(User.role, User.login)).all())


def get_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise not_found("Пользователь")
    return user


def _ensure_login_free(db: Session, login: str, settings: Settings, exclude_id: int | None = None) -> None:
    if login in settings.admin_logins:
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
