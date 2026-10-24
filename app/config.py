from __future__ import annotations

import re
from functools import cached_property
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_ADMIN_PASSWORD = "change-me"


class Settings(BaseSettings):
    """Настройки приложения. Читаются из переменных окружения и файла .env."""

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    host: str = "0.0.0.0"
    port: int = 8080
    log_level: str = "INFO"

    app_timezone: str = "Europe/Moscow"
    database_url: str = f"sqlite:///{(BASE_DIR / 'data' / 'invoice-keeper.db').as_posix()}"

    admin_login: str = Field(default="admin", min_length=3, max_length=64)
    admin_password: SecretStr
    # Дополнительные администраторы: ADMINS=anna:Пароль-Анны,oleg:Пароль-Олега
    # (логин:пароль через запятую; в пароле не должно быть запятой, длина — от 8 символов)
    admins: SecretStr | None = None
    session_ttl_hours: int = Field(default=168, ge=1)
    cookie_secure: bool = False

    telegram_bot_token: SecretStr | None = None
    telegram_chat_id: str | None = None
    telegram_api_url: str | None = None
    telegram_proxy: str | None = None
    telegram_polling: bool = True
    # Публичный адрес панели (https://…) — для кнопки «Открыть в панели» в сообщениях бота
    public_url: str | None = None

    reminder_days_before: int = Field(default=3, ge=3, le=60)
    reminder_check_interval_seconds: int = Field(default=60, ge=5)

    seed_demo_data: bool = True
    # Пароли демо-пользователей. По умолчанию — публичные из README (для локального запуска);
    # на сервере, доступном из интернета, задайте свои.
    demo_user_password: SecretStr = Field(default=SecretStr("user12345"), min_length=6)
    demo_accountant_password: SecretStr = Field(default=SecretStr("accountant123"), min_length=6)

    @field_validator("app_timezone")
    @classmethod
    def _validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"неизвестный часовой пояс: {value}") from exc
        return value

    @field_validator("admin_login")
    @classmethod
    def _normalize_admin_login(cls, value: str) -> str:
        return value.strip().lower()

    @model_validator(mode="after")
    def _validate_admins(self) -> "Settings":
        self.admin_accounts  # ошибка формата ADMINS видна сразу при старте
        return self

    @cached_property
    def admin_accounts(self) -> list[tuple[str, str]]:
        """Все администраторы из .env: основной (ADMIN_LOGIN) и дополнительные (ADMINS)."""
        accounts = [(self.admin_login, self.admin_password.get_secret_value())]
        raw = self.admins.get_secret_value() if self.admins else ""
        for item in filter(None, (part.strip() for part in raw.split(","))):
            login, sep, password = item.partition(":")
            login = login.strip().lower()
            if not sep or not re.fullmatch(r"[a-z0-9_.-]{3,64}", login):
                raise ValueError("ADMINS: ожидается формат логин:пароль через запятую, "
                                 "логин — 3–64 символа (латиница, цифры, . _ -)")
            if len(password) < 8:
                raise ValueError(f"ADMINS: пароль администратора «{login}» короче 8 символов")
            if login in {existing for existing, _ in accounts}:
                raise ValueError(f"ADMINS: логин «{login}» указан дважды")
            accounts.append((login, password))
        return accounts

    @property
    def admin_logins(self) -> set[str]:
        return {login for login, _ in self.admin_accounts}

    @cached_property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.app_timezone)

    @property
    def telegram_enabled(self) -> bool:
        return self.telegram_bot_token is not None

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


def load_settings(**overrides) -> Settings:
    try:
        return Settings(**overrides)
    except ValidationError as exc:
        lines = ["Ошибка конфигурации (.env):"]
        for error in exc.errors():
            field = ".".join(str(part) for part in error["loc"]).upper()
            lines.append(f"  {field}: {error['msg']}")
        raise SystemExit("\n".join(lines)) from None
