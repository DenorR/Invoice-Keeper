from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.db import make_engine, make_session_factory
from app.domain.dates import Clock
from app.services.auth import LoginRateLimiter
from app.services.reminders import Notifier, NullNotifier, ReminderService


@dataclass
class Container:
    """Зависимости приложения, собранные в одном месте (подменяются в тестах)."""

    settings: Settings
    engine: Engine
    session_factory: sessionmaker
    clock: Clock
    notifier: Notifier
    reminders: ReminderService
    rate_limiter: LoginRateLimiter = field(default_factory=LoginRateLimiter)
    bot: object | None = None
    dispatcher: object | None = None
    telegram_bot_username: str | None = None


def build_container(settings: Settings, *, clock: Clock | None = None, notifier: Notifier | None = None) -> Container:
    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)
    clock = clock or Clock(settings.tz)

    bot = None
    if notifier is None:
        if settings.telegram_enabled:
            from app.telegram.bot import TelegramNotifier, create_bot

            bot = create_bot(settings)
            notifier = TelegramNotifier(bot, settings)
        else:
            notifier = NullNotifier()

    reminders = ReminderService(
        session_factory=session_factory,
        clock=clock,
        notifier=notifier,
        default_remind_days=settings.reminder_days_before,
        interval_seconds=settings.reminder_check_interval_seconds,
    )
    container = Container(
        settings=settings,
        engine=engine,
        session_factory=session_factory,
        clock=clock,
        notifier=notifier,
        reminders=reminders,
        bot=bot,
    )
    if bot is not None:
        from app.telegram.bot import build_router, create_dispatcher

        router = build_router(settings, session_factory, clock, reminders, notifier)
        container.dispatcher = create_dispatcher(router)
    return container
