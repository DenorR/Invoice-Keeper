from fastapi import APIRouter, Depends

from app.api import audit, auth, categories, payments, settings, users
from app.api.deps import get_current_user
from app.schemas import ErrorResponse

API_PREFIX = "/api/v1"

_errors = {
    401: {"model": ErrorResponse, "description": "Не авторизован"},
    403: {"model": ErrorResponse, "description": "Недостаточно прав"},
    404: {"model": ErrorResponse, "description": "Не найдено"},
    409: {"model": ErrorResponse, "description": "Конфликт"},
    422: {"model": ErrorResponse, "description": "Некорректные данные"},
}


def build_api_router() -> APIRouter:
    api = APIRouter(prefix=API_PREFIX)

    # Публично доступен только вход. Всё остальное — запрещено по умолчанию без сессии.
    api.include_router(auth.public_router, responses={422: _errors[422]})

    protected = APIRouter(dependencies=[Depends(get_current_user)], responses=_errors)
    protected.include_router(auth.router)
    protected.include_router(auth.meta_router)
    protected.include_router(payments.recurring_router)
    protected.include_router(payments.occurrences_router)
    protected.include_router(payments.summary_router)
    protected.include_router(categories.router)
    protected.include_router(settings.router)
    protected.include_router(users.router)
    protected.include_router(audit.router)
    api.include_router(protected)
    return api
