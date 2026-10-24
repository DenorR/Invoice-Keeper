from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Request, Response, status

from app.api.deps import SESSION_COOKIE, ContainerDep, CurrentUser, DbDep, actor_for, client_ip
from app.schemas import LoginRequest, LoginResponse, MetaOut, TelegramStatus, UserOut
from app.domain.money import Currency
from app.domain.schedule import Frequency
from app.services import auth as auth_service

public_router = APIRouter(prefix="/auth", tags=["Авторизация"])
router = APIRouter(prefix="/auth", tags=["Авторизация"])
meta_router = APIRouter(tags=["Служебное"])


@public_router.post(
    "/login",
    response_model=LoginResponse,
    summary="Вход по логину и паролю",
    responses={401: {"description": "Неверный логин или пароль"}, 429: {"description": "Слишком много попыток"}},
)
def login(payload: LoginRequest, request: Request, response: Response, db: DbDep, container: ContainerDep):
    ip = client_ip(request) or "unknown"
    container.rate_limiter.check(ip)
    ttl = timedelta(hours=container.settings.session_ttl_hours)
    try:
        token, session = auth_service.login(
            db,
            login_value=payload.login,
            password=payload.password,
            now=container.clock.now(),
            ttl=ttl,
            ip=ip,
            user_agent=request.headers.get("user-agent"),
        )
    except Exception:
        container.rate_limiter.fail(ip)
        raise
    db.commit()
    container.rate_limiter.reset(ip)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(ttl.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=container.settings.cookie_secure,
        path="/",
    )
    return LoginResponse(token=token, expires_at=session.expires_at, user=UserOut.build(session.user))


@router.get("/me", response_model=UserOut, summary="Текущий пользователь")
def me(user: CurrentUser):
    return UserOut.build(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Завершение текущей сессии")
def logout(request: Request, user: CurrentUser, db: DbDep):
    auth_service.logout(db, request.state.token, actor_for(request, user))
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@meta_router.get("/meta", response_model=MetaOut, summary="Параметры системы для интерфейса")
def meta(user: CurrentUser, container: ContainerDep):
    settings = container.settings
    return MetaOut(
        today=container.clock.today(),
        timezone=settings.app_timezone,
        reminder_days_before=settings.reminder_days_before,
        currencies=list(Currency),
        frequencies=list(Frequency),
        telegram=TelegramStatus(
            bot_configured=settings.telegram_enabled,
            chat_configured=settings.telegram_enabled and settings.telegram_chat_id is not None,
            bot_username=container.telegram_bot_username,
        ),
    )

