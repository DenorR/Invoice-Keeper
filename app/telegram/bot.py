"""Telegram-бот: отправка напоминаний, кнопка «Оплачено», служебные команды."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import timedelta
from html import escape

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.telegram import TelegramAPIServer
from aiogram.enums import ChatType, ParseMode
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import JOIN_TRANSITION, ChatMemberUpdatedFilter, Command, CommandStart
from aiogram.types import (
    BotCommand,
    CallbackQuery,
    ChatMemberUpdated,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from sqlalchemy import select
from sqlalchemy.orm import contains_eager, sessionmaker

from app.config import Settings
from app.domain.dates import Clock
from app.domain.money import format_amount
from app.models import PaymentOccurrence, RecurringPayment
from app.services import app_settings
from app.services.audit import Actor
from app.services.occurrences import generate_for_payment, set_paid
from app.services.reminders import Reminder, ReminderService, load_reminder_by_message
from app.telegram.messages import WEEKDAYS, fmt_date, plural_days, relative_due, render_reminder

log = logging.getLogger(__name__)

PAY_PREFIX = "pay:"

BOT_COMMANDS = [
    BotCommand(command="upcoming", description="Что и когда оплатить"),
    BotCommand(command="help", description="Как пользоваться ботом"),
    BotCommand(command="chatid", description="ID этого чата (для настройки)"),
]


def create_bot(settings: Settings) -> Bot:
    session_kwargs = {}
    if settings.telegram_api_url:
        session_kwargs["api"] = TelegramAPIServer.from_base(settings.telegram_api_url)
    session = AiohttpSession(proxy=settings.telegram_proxy, **session_kwargs)
    return Bot(
        token=settings.telegram_bot_token.get_secret_value(),
        session=session,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )


def panel_url(settings: Settings, path: str = "/") -> str | None:
    """Ссылка на веб-панель — только если задан публичный адрес (Telegram не принимает localhost)."""
    if not settings.public_url:
        return None
    return settings.public_url.rstrip("/") + path


def _keyboard(buttons: list[tuple[str, int]], open_url: str | None = None) -> InlineKeyboardMarkup | None:
    rows = [[InlineKeyboardButton(text=label, callback_data=f"{PAY_PREFIX}{oid}")] for label, oid in buttons]
    if open_url:
        rows.append([InlineKeyboardButton(text="🔗 Открыть в панели", url=open_url)])
    return InlineKeyboardMarkup(inline_keyboard=rows) if rows else None


class TelegramNotifier:
    def __init__(self, bot: Bot, settings: Settings):
        self.bot = bot
        self.settings = settings
        self.chat_id = settings.telegram_chat_id

    @property
    def enabled(self) -> bool:
        return self.chat_id is not None

    def _markup(self, reminder: Reminder, buttons: list[tuple[str, int]]) -> InlineKeyboardMarkup | None:
        return _keyboard(buttons, panel_url(self.settings, f"/payments?payment={reminder.payment_id}"))

    async def send_reminder(self, reminder: Reminder) -> int | None:
        text, buttons = render_reminder(reminder)
        message = await self.bot.send_message(self.chat_id, text, reply_markup=self._markup(reminder, buttons))
        return message.message_id

    async def refresh_reminder(self, message_id: int, reminder: Reminder) -> None:
        text, buttons = render_reminder(reminder)
        try:
            await self.bot.edit_message_text(
                text=text, chat_id=self.chat_id, message_id=message_id, reply_markup=self._markup(reminder, buttons)
            )
        except TelegramBadRequest as exc:
            if "message is not modified" not in str(exc):
                raise


def _actor_label(callback: CallbackQuery) -> str:
    user = callback.from_user
    if user.username:
        return f"tg:@{user.username}"
    return f"tg:{user.full_name or user.id}"


def build_router(
    settings: Settings,
    session_factory: sessionmaker,
    clock: Clock,
    reminders: ReminderService,
    notifier: TelegramNotifier,
) -> Router:
    router = Router(name="invoice-keeper")

    def remind_days() -> int:
        with session_factory() as db:
            return app_settings.reminder_days(db, settings.reminder_days_before)

    def is_configured_chat(chat_id: int) -> bool:
        return settings.telegram_chat_id is not None and str(chat_id) == str(settings.telegram_chat_id)

    def chat_allowed(chat_id: int) -> bool:
        return settings.telegram_chat_id is None or is_configured_chat(chat_id)

    def setup_hint(chat_id: int) -> str:
        return (
            "Чтобы напоминания приходили в этот чат, укажите в файле <code>.env</code>:\n"
            f"<code>TELEGRAM_CHAT_ID={chat_id}</code>\n"
            "и перезапустите приложение."
        )

    @router.message(CommandStart())
    @router.message(Command("help"))
    async def cmd_help(message: Message) -> None:
        lines = [
            "👋 Я <b>Invoice Keeper</b> — слежу, чтобы вы не забывали о регулярных платежах: "
            "аренде, серверах, подписках.",
            "",
            f"🔔 За {plural_days(remind_days())} до срока пишу в чат: что, сколько и когда оплатить "
            "(для отдельных платежей срок может быть свой).",
            "✅ Оплатили — нажмите «Оплачено» под напоминанием, и я отмечу оплату.",
            "⚠️ Если срок прошёл, а оплаты нет — платёж станет просроченным.",
            "",
            "<b>Команды</b>",
            "/upcoming — что и когда оплатить",
            "/chatid — ID этого чата",
        ]
        if message.chat.type == ChatType.PRIVATE:
            lines += ["", "Напоминания приходят в общий рабочий чат: добавьте меня в группу команды."]
        elif not is_configured_chat(message.chat.id):
            lines += ["", setup_hint(message.chat.id)]
        url = panel_url(settings)
        markup = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🔗 Открыть панель", url=url)]]) if url else None
        await message.answer("\n".join(lines), reply_markup=markup)

    @router.message(Command("chatid"))
    async def cmd_chatid(message: Message) -> None:
        text = f"ID этого чата: <code>{message.chat.id}</code>"
        if is_configured_chat(message.chat.id):
            text += "\n\n✅ Напоминания приходят именно сюда."
        elif settings.telegram_chat_id is None:
            text += "\n\n" + setup_hint(message.chat.id)
        else:
            text += "\n\nНапоминания сейчас настроены на другой чат."
        await message.answer(text)

    @router.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=JOIN_TRANSITION))
    async def on_added_to_chat(event: ChatMemberUpdated, bot: Bot) -> None:
        if event.chat.type == ChatType.PRIVATE:
            return
        if is_configured_chat(event.chat.id):
            text = "👋 Я на месте — напоминания о платежах будут приходить в этот чат. Список дел — /upcoming"
        else:
            text = "👋 Привет! Я напоминаю о регулярных платежах.\n\n" + setup_hint(event.chat.id)
        await bot.send_message(event.chat.id, text)

    @router.message(Command("upcoming"))
    async def cmd_upcoming(message: Message) -> None:
        if not chat_allowed(message.chat.id):
            await message.answer("Этот чат не подключён к Invoice Keeper.")
            return
        today = clock.today()
        with session_factory() as db:
            rows = db.scalars(
                select(PaymentOccurrence)
                .join(PaymentOccurrence.recurring_payment)
                .options(contains_eager(PaymentOccurrence.recurring_payment))
                .where(
                    RecurringPayment.deleted_at.is_(None),
                    PaymentOccurrence.paid_at.is_(None),
                    PaymentOccurrence.due_date <= today + timedelta(days=30),
                )
                .order_by(PaymentOccurrence.due_date)
                .limit(30)
            ).unique().all()

            def line(o: PaymentOccurrence) -> str:
                return (
                    f"• <b>{o.due_date:%d.%m}</b> ({WEEKDAYS[o.due_date.weekday()]}) — "
                    f"{escape(o.recurring_payment.name)} — {format_amount(o.amount_minor, o.currency)} "
                    f"({o.currency}) — {relative_due(o.due_date, today)}"
                )

            overdue = [line(o) for o in rows if o.due_date < today]
            upcoming = [line(o) for o in rows if o.due_date >= today]

        if not rows:
            await message.answer("🎉 Всё оплачено — в ближайшие 30 дней платежей нет.")
            return
        parts = ["📋 <b>Что оплатить</b>"]
        if overdue:
            parts += ["", "⚠️ <b>Просрочено</b>", *overdue]
        if upcoming:
            parts += ["", "🗓 <b>Ближайшие 30 дней</b>", *upcoming]
        url = panel_url(settings, "/payments?tab=unpaid")
        markup = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🔗 Открыть в панели", url=url)]]) if url else None
        await message.answer("\n".join(parts), reply_markup=markup)

    @router.callback_query(F.data.startswith(PAY_PREFIX))
    async def on_pay(callback: CallbackQuery) -> None:
        message = callback.message
        if message is None or not chat_allowed(message.chat.id):
            await _safe_answer(callback, "Недоступно в этом чате", show_alert=True)
            return
        try:
            occurrence_id = int(callback.data.removeprefix(PAY_PREFIX))
        except ValueError:
            await _safe_answer(callback)
            return

        today, now = clock.today(), clock.now()
        with session_factory() as db:
            occurrence = db.get(PaymentOccurrence, occurrence_id)
            if occurrence is None:
                answer = "Этого платежа уже нет — возможно, его прекратили"
            elif occurrence.paid_at is not None:
                who = f" ({occurrence.paid_by_label})" if occurrence.paid_by_label else ""
                answer = f"Уже оплачено {fmt_date(occurrence.paid_at)}{who}"
            else:
                set_paid(db, occurrence, today, today=today, now=now,
                         actor=Actor(user_id=None, label=_actor_label(callback)), via="telegram")
                generate_for_payment(db, occurrence.recurring_payment, today,
                                     app_settings.reminder_days(db, settings.reminder_days_before))
                db.commit()
                answer = f"✅ Оплата отмечена: {fmt_date(today)}"
            reminder = load_reminder_by_message(db, message.message_id, today)

        # Ответ на нажатие — только всплывающая подсказка. Если нажали давно (бот перезапускался),
        # Telegram его не примет, но оплата уже отмечена — сообщение всё равно обновляем.
        await _safe_answer(callback, answer)
        if reminder is not None:
            try:
                await notifier.refresh_reminder(message.message_id, reminder)
            except Exception:
                log.exception("Не удалось обновить сообщение")
        reminders.wake()

    return router


async def _safe_answer(callback: CallbackQuery, text: str | None = None, show_alert: bool = False) -> None:
    try:
        await callback.answer(text, show_alert=show_alert)
    except TelegramBadRequest as exc:
        log.info("Ответ на нажатие кнопки не доставлен: %s", exc.message)


def create_dispatcher(router: Router) -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    return dispatcher


async def run_polling(dispatcher: Dispatcher, bot: Bot, on_connected: Callable[[str], None] | None = None) -> None:
    """Приём команд и нажатий кнопок. Если Telegram недоступен — пишем в лог и переподключаемся."""
    delay = 5
    while True:
        try:
            me = await bot.get_me()
            log.info("Telegram-бот @%s подключён", me.username)
            if on_connected:
                on_connected(me.username)
            try:
                await bot.set_my_commands(BOT_COMMANDS)
            except Exception:
                log.warning("Не удалось установить меню команд бота", exc_info=True)
            delay = 5
            await dispatcher.start_polling(bot, handle_signals=False, close_bot_session=False)
            return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("Нет связи с Telegram (%s: %s) — повтор через %s с", type(exc).__name__, exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 300)
