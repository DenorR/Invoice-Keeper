from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import APIKeyCookie, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.container import Container
from app.errors import forbidden, unauthorized
from app.models import User
from app.services import auth as auth_service
from app.services.audit import Actor

SESSION_COOKIE = "ik_session"

bearer_scheme = HTTPBearer(auto_error=False, description="Токен из ответа POST /api/v1/auth/login")
cookie_scheme = APIKeyCookie(name=SESSION_COOKIE, auto_error=False, description="Сессионная cookie веб-панели")


def get_container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(get_container)]


def get_db(container: ContainerDep) -> Iterator[Session]:
    with container.session_factory() as db:
        yield db


DbDep = Annotated[Session, Depends(get_db)]


def get_token(
    bearer: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    cookie: Annotated[str | None, Depends(cookie_scheme)],
) -> str | None:
    if bearer is not None:
        return bearer.credentials
    return cookie


def get_current_user(
    request: Request,
    db: DbDep,
    container: ContainerDep,
    token: Annotated[str | None, Depends(get_token)],
) -> User:
    if not token:
        raise unauthorized()
    user = auth_service.resolve(db, token, container.clock.now())
    if user is None:
        raise unauthorized("Сессия истекла или недействительна — войдите снова")
    request.state.user = user
    request.state.token = token
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> User:
    if not user.is_admin:
        raise forbidden("Действие доступно только администратору")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def actor_for(request: Request, user: User) -> Actor:
    return Actor.from_user(user, client_ip(request))
