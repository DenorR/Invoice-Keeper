from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import AdminUser, DbDep
from app.schemas import AuditOut, Page
from app.services import audit as audit_service

router = APIRouter(prefix="/audit-log", tags=["Журнал действий (администратор)"])


@router.get("", response_model=Page[AuditOut], summary="Журнал входов и действий")
def list_audit(
    admin: AdminUser,
    db: DbDep,
    action: Annotated[str | None, Query(max_length=64, description="Префикс действия, например occurrence. или auth.")] = None,
    actor: Annotated[str | None, Query(max_length=128, description="Логин или tg:@username")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    items, total = audit_service.list_entries(db, limit=limit, offset=offset, action=action, actor=actor)
    return Page[AuditOut](items=[AuditOut.build(i) for i in items], total=total, limit=limit, offset=offset)
