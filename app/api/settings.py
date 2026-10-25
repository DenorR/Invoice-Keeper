from __future__ import annotations

from fastapi import APIRouter, Request

from app.api.deps import AdminUser, ContainerDep, CurrentUser, DbDep, actor_for
from app.schemas import SettingsOut, SettingsUpdate
from app.services import app_settings

router = APIRouter(prefix="/settings", tags=["Настройки"])


def _settings_out(db, container) -> SettingsOut:
    default = container.settings.reminder_days_before
    return SettingsOut(
        reminder_days_before=app_settings.reminder_days(db, default),
        reminder_days_default=default,
        uploads_enabled=app_settings.uploads_enabled(db),
        upload_max_mb=container.settings.upload_max_mb,
    )


@router.get("", response_model=SettingsOut, summary="Получение настроек")
def get_settings(user: CurrentUser, db: DbDep, container: ContainerDep):
    return _settings_out(db, container)


@router.patch(
    "",
    response_model=SettingsOut,
    summary="Изменение настроек: окно напоминания, загрузка файлов чеков",
    description=(
        "reminder_days_before — за сколько дней до срока напоминать о платежах без своего окна (3–365). "
        "Если окно увеличили, напоминания о попавших в него сроках уйдут при ближайшей проверке. "
        "uploads_enabled — можно ли прикреплять файлы чеков (уже прикреплённые остаются доступны)."
    ),
)
def update_settings(payload: SettingsUpdate, request: Request, admin: AdminUser, db: DbDep, container: ContainerDep):
    actor = actor_for(request, admin)
    if payload.reminder_days_before is not None:
        app_settings.set_reminder_days(db, actor, payload.reminder_days_before, container.settings.reminder_days_before)
    if payload.uploads_enabled is not None:
        app_settings.set_uploads_enabled(db, actor, payload.uploads_enabled)
    db.commit()
    container.reminders.wake()
    return _settings_out(db, container)
