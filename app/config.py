from __future__ import annotations

from functools import cached_property
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, SecretStr, ValidationError, field_validator
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
