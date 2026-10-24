"""Telegram-бот: отправка напоминаний, кнопка «Оплачено», служебные команды."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from html import escape

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.telegram import TelegramAPIServer
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from sqlalchemy import select
from sqlalchemy.orm import contains_eager, sessionmaker

from app.config import Settings
from app.domain.dates import Clock
from app.domain.money import format_amount
from app.models import PaymentOccurrence, RecurringPayment
from app.services.audit import Actor
from app.services.occurrences import generate_for_payment, set_paid
from app.services.reminders import Reminder, ReminderService, load_reminder_by_message
from app.telegram.messages import fmt_date, relative_due, render_reminder

log = logging.getLogger(__name__)

PAY_PREFIX = "pay:"


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


def _keyboard(buttons: list[tuple[str, int]]) -> InlineKeyboardMarkup | None:
    if not buttons:
        return None
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=label, callback_data=f"{PAY_PREFIX}{oid}")] for label, oid in buttons]
    )


class TelegramNotifier:
    def __init__(self, bot: Bot, chat_id: str | None):
        self.bot = bot
        self.chat_id = chat_id

    @property
    def enabled(self) -> bool:
        return self.chat_id is not None

    async def send_reminder(self, reminder: Reminder) -> int | None:
        text, buttons = render_reminder(reminder)
        message = await self.bot.send_message(self.chat_id, text, reply_markup=_keyboard(buttons))
        return message.message_id

    async def refresh_reminder(self, message_id: int, reminder: Reminder) -> None:
        text, buttons = render_reminder(reminder)
        try:
            await self.bot.edit_message_text(
                text=text, chat_id=self.chat_id, message_id=message_id, reply_markup=_keyboard(buttons)
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

    def chat_allowed(chat_id: int) -> bool:
        return settings.telegram_chat_id is None or str(chat_id) == str(settings.telegram_chat_id)

    @router.message(CommandStart())
    @router.message(Command("help"))
    async def cmd_help(message: Message) -> None:
        await message.answer(
            "Я <b>Invoice Keeper</b> — напоминаю о регулярных платежах за "
            f"{settings.reminder_days_before} дня до срока.\n\n"
            "/upcoming — что и когда оплатить\n"
            "/chatid — id этого чата (для TELEGRAM_CHAT_ID в .env)"
        )

    @router.message(Command("chatid"))
    async def cmd_chatid(message: Message) -> None:
        configured = settings.telegram_chat_id
        note = ""
        if configured is None:
            note = "\n\nУкажите это значение в TELEGRAM_CHAT_ID в .env и перезапустите приложение."
        elif str(message.chat.id) != str(configured):
            note = "\n\nВнимание: напоминания сейчас настроены на другой чат."
        await message.answer(f"ID этого чата: <code>{message.chat.id}</code>{note}")

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
                .limit(25)
            ).unique().all()
            lines = [
                f"• <b>{fmt_date(o.due_date)}</b> — {escape(o.recurring_payment.name)} — "
                f"{format_amount(o.amount_minor, o.currency)} — {relative_due(o.due_date, today)}"
                for o in rows
            ]
        if not lines:
            await message.answer("На ближайшие 30 дней неоплаченных платежей нет 🎉")
            return
        await message.answer("<b>К оплате в ближайшие 30 дней:</b>\n\n" + "\n".join(lines))

    @router.callback_query(F.data.startswith(PAY_PREFIX))
    async def on_pay(callback: CallbackQuery) -> None:
        message = callback.message
        if message is None or not chat_allowed(message.chat.id):
            await callback.answer("Недоступно в этом чате", show_alert=True)
            return
        try:
            occurrence_id = int(callback.data.removeprefix(PAY_PREFIX))
        except ValueError:
            await callback.answer()
            return

        today, now = clock.today(), clock.now()
        with session_factory() as db:
            occurrence = db.get(PaymentOccurrence, occurrence_id)
            if occurrence is None:
                answer = "Период не найден — платёж мог быть прекращён"
            elif occurrence.paid_at is not None:
                answer = f"Уже отмечено как оплаченное ({fmt_date(occurrence.paid_at)})"
            else:
                set_paid(db, occurrence, today, today=today, now=now,
                         actor=Actor(user_id=None, label=_actor_label(callback)), via="telegram")
                generate_for_payment(db, occurrence.recurring_payment, today, settings.reminder_days_before)
                db.commit()
                answer = "Оплата отмечена ✅"
            reminder = load_reminder_by_message(db, message.message_id, today)

        await callback.answer(answer)
        if reminder is not None:
            try:
                await notifier.refresh_reminder(message.message_id, reminder)
            except Exception:
                log.exception("Не удалось обновить сообщение")
        reminders.wake()

    return router


def create_dispatcher(router: Router) -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    return dispatcher


async def run_polling(dispatcher: Dispatcher, bot: Bot) -> None:
    """Приём команд и нажатий кнопок. Если Telegram недоступен — пишем в лог и переподключаемся."""
    delay = 5
    while True:
        try:
            me = await bot.get_me()
            log.info("Telegram-бот @%s подключён", me.username)
            delay = 5
            await dispatcher.start_polling(bot, handle_signals=False, close_bot_session=False)
            return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("Нет связи с Telegram (%s: %s) — повтор через %s с", type(exc).__name__, exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 300)
