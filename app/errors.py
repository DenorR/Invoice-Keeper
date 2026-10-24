from __future__ import annotations

from typing import Any


class ApiError(Exception):
    """Ошибка бизнес-логики, которая превращается в JSON-ответ {"error": {...}}."""

    def __init__(self, status: int, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def not_found(entity: str = "Объект") -> ApiError:
    return ApiError(404, "not_found", f"{entity} не найден")


def forbidden(message: str = "Недостаточно прав для этого действия") -> ApiError:
    return ApiError(403, "forbidden", message)


def unauthorized(message: str = "Требуется авторизация") -> ApiError:
    return ApiError(401, "unauthorized", message)


def unprocessable(code: str, message: str, details: Any = None) -> ApiError:
    return ApiError(422, code, message, details)


def conflict(code: str, message: str) -> ApiError:
    return ApiError(409, code, message)
