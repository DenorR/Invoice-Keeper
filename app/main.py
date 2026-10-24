from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import API_PREFIX, build_api_router
from app.config import BASE_DIR, Settings, load_settings
from app.container import Container, build_container
from app.domain.dates import Clock
from app.errors import ApiError
from app.middleware import SecurityHeadersMiddleware
from app.services.reminders import Notifier
from app.services.users import ensure_admin

log = logging.getLogger("app")

STATIC_DIR = BASE_DIR / "app" / "static"

API_DESCRIPTION = """
**Invoice Keeper** — учёт регулярных платежей с напоминаниями в Telegram.

* Все эндпоинты, кроме `POST /auth/login`, требуют авторизации: заголовок
  `Authorization: Bearer <token>` (токен из ответа `login`) или cookie `ik_session`.
* Пользователь видит платежи и отмечает оплату; администратор дополнительно
  управляет регулярными платежами и пользователями. Ограничения действуют в API.
* Даты — в формате `YYYY-MM-DD` в часовом поясе приложения. Суммы — строки с двумя
  знаками после запятой, итоги — отдельно по каждой валюте (RUB, USD, EUR).
"""


def run_migrations(database_url: str) -> None:
    cfg = AlembicConfig()
    cfg.set_main_option("script_location", str(BASE_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    cfg.attributes["configure_logging"] = False
    command.upgrade(cfg, "head")


def bootstrap(container: Container) -> None:
    """Миграции, администратор из .env и демо-данные (если база пустая)."""
    settings = container.settings
    run_migrations(settings.database_url)
    with container.session_factory() as db:
        ensure_admin(db, settings)
        db.commit()
    if settings.seed_demo_data:
        from app.seed import seed_if_empty

        with container.session_factory() as db:
            if seed_if_empty(db, container.clock, settings):
                log.info("Загружены демо-данные")
            db.commit()


def _error(status: int, code: str, message: str, details=None, headers=None) -> JSONResponse:
    body = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(status_code=status, content=body, headers=headers)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError):
        headers = {"WWW-Authenticate": "Bearer"} if exc.status == 401 else None
        return _error(exc.status, exc.code, exc.message, exc.details, headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(str(p) for p in err["loc"] if p != "body"), "message": err["msg"]}
            for err in exc.errors()
        ]
        return _error(422, "validation_error", "Некорректные данные запроса", details)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        codes = {404: "not_found", 405: "method_not_allowed"}
        message = exc.detail if isinstance(exc.detail, str) else "Ошибка запроса"
        if exc.status_code == 404:
            message = "Не найдено"
        return _error(exc.status_code, codes.get(exc.status_code, "http_error"), message)


def mount_frontend(app: FastAPI) -> None:
    """Отдаёт собранную веб-панель (SPA). Пути /api/* сюда не попадают."""
    index = STATIC_DIR / "index.html"
    assets = STATIC_DIR / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            return _error(404, "not_found", "Не найдено")
        candidate = (STATIC_DIR / full_path).resolve()
        if full_path and candidate.is_file() and STATIC_DIR.resolve() in candidate.parents:
            return FileResponse(candidate)
        if index.is_file():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return HTMLResponse(
            "<h1>Invoice Keeper</h1><p>Веб-панель не собрана. API: "
            f'<a href="{API_PREFIX}/docs">{API_PREFIX}/docs</a></p>',
            status_code=200,
        )


def create_app(
    settings: Settings | None = None,
    *,
    clock: Clock | None = None,
    notifier: Notifier | None = None,
    start_background: bool = True,
) -> FastAPI:
    settings = settings or load_settings()
    logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
    container = build_container(settings, clock=clock, notifier=notifier)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        bootstrap(container)
        tasks: list[asyncio.Task] = []
        if start_background:
            tasks.append(asyncio.create_task(container.reminders.run_forever(), name="reminders"))
            if container.dispatcher is not None and settings.telegram_polling:
                from app.telegram.bot import run_polling

                def remember_username(username: str) -> None:
                    container.telegram_bot_username = username

                tasks.append(asyncio.create_task(
                    run_polling(container.dispatcher, container.bot, remember_username), name="telegram-polling"
                ))
            if not settings.telegram_enabled:
                log.warning("TELEGRAM_BOT_TOKEN не задан — напоминания в Telegram отключены")
            elif settings.telegram_chat_id is None:
                log.warning("TELEGRAM_CHAT_ID не задан — отправьте боту /chatid в нужном чате и укажите значение в .env")
        log.info("Invoice Keeper запущен: панель http://%s:%s/, Swagger %s/docs",
                 "localhost" if settings.host in ("0.0.0.0", "::") else settings.host, settings.port, API_PREFIX)
        try:
            yield
        finally:
            if container.dispatcher is not None and settings.telegram_polling and start_background:
                with contextlib.suppress(Exception):
                    await container.dispatcher.stop_polling()
            for task in tasks:
                task.cancel()
            for task in tasks:
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
            if container.bot is not None:
                await container.bot.session.close()
            container.engine.dispose()

    app = FastAPI(
        title="Invoice Keeper API",
        version="1.0.0",
        description=API_DESCRIPTION.strip(),
        docs_url=f"{API_PREFIX}/docs",
        openapi_url=f"{API_PREFIX}/openapi.json",
        swagger_ui_oauth2_redirect_url=f"{API_PREFIX}/docs/oauth2-redirect",
        redoc_url=None,
        lifespan=lifespan,
        swagger_ui_parameters={"persistAuthorization": True, "docExpansion": "none", "validatorUrl": None},
    )
    app.state.container = container
    app.add_middleware(SecurityHeadersMiddleware, docs_prefix=f"{API_PREFIX}/docs", api_prefix=API_PREFIX)
    install_error_handlers(app)
    app.include_router(build_api_router())
    mount_frontend(app)
    return app


def export_openapi(path: Path) -> None:
    import yaml

    app = create_app(start_background=False)
    spec = app.openapi()
    path.write_text(yaml.safe_dump(spec, allow_unicode=True, sort_keys=False), encoding="utf-8")
