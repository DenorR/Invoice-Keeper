from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from app.api.deps import AdminUser, CurrentUser, DbDep, actor_for
from app.schemas import CategoryIn, CategoryOut
from app.services import categories as categories_service

router = APIRouter(prefix="/categories", tags=["Категории"])


def _out(item: categories_service.CategoryOverview) -> CategoryOut:
    c = item.category
    return CategoryOut(id=c.id, name=c.name, payments_count=item.payments_count, created_at=c.created_at)


def _one(db, category_id: int) -> CategoryOut:
    return next(_out(i) for i in categories_service.list_categories(db) if i.category.id == category_id)


@router.get("", response_model=list[CategoryOut], summary="Список категорий платежей")
def list_categories(user: CurrentUser, db: DbDep):
    return [_out(i) for i in categories_service.list_categories(db)]


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED, summary="Создание категории")
def create_category(payload: CategoryIn, request: Request, admin: AdminUser, db: DbDep):
    category = categories_service.create_category(db, actor_for(request, admin), payload.name)
    db.commit()
    return _one(db, category.id)


@router.patch("/{category_id}", response_model=CategoryOut, summary="Переименование категории")
def rename_category(category_id: int, payload: CategoryIn, request: Request, admin: AdminUser, db: DbDep):
    categories_service.rename_category(db, actor_for(request, admin), category_id, payload.name)
    db.commit()
    return _one(db, category_id)


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удаление категории",
    description="Платежи из категории не удаляются — они остаются без категории.",
)
def delete_category(category_id: int, request: Request, admin: AdminUser, db: DbDep):
    categories_service.delete_category(db, actor_for(request, admin), category_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
