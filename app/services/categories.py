"""Категории (группы) регулярных платежей."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.errors import ApiError, not_found
from app.models import Category, RecurringPayment
from app.services import audit
from app.services.audit import Actor


@dataclass
class CategoryOverview:
    category: Category
    payments_count: int  # активных платежей в категории


def get_category(db: Session, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise not_found("Категория")
    return category


def ensure_exists(db: Session, category_id: int | None) -> None:
    """Для поля category_id у платежа: несуществующая категория — 422, а не 404 всего запроса."""
    if category_id is not None and db.get(Category, category_id) is None:
        raise ApiError(422, "category_not_found", f"Категории с id={category_id} нет")


def list_categories(db: Session) -> list[CategoryOverview]:
    counts = dict(
        db.execute(
            select(RecurringPayment.category_id, func.count())
            .where(RecurringPayment.category_id.is_not(None), RecurringPayment.deleted_at.is_(None))
            .group_by(RecurringPayment.category_id)
        ).all()
    )
    categories = db.scalars(select(Category)).all()
    return [CategoryOverview(c, counts.get(c.id, 0)) for c in sorted(categories, key=lambda c: c.name.casefold())]


def _check_unique(db: Session, name: str, exclude_id: int | None = None) -> None:
    # SQLite без учёта регистра сравнивает только латиницу — сравниваем в Python (категорий немного)
    for other in db.scalars(select(Category)).all():
        if other.id != exclude_id and other.name.casefold() == name.casefold():
            raise ApiError(409, "category_exists", f"Категория «{other.name}» уже есть")


def create_category(db: Session, actor: Actor, name: str) -> Category:
    _check_unique(db, name)
    category = Category(name=name)
    db.add(category)
    db.flush()
    audit.record(db, actor, "category.create", "category", category.id, {"name": name})
    return category


def rename_category(db: Session, actor: Actor, category_id: int, name: str) -> Category:
    category = get_category(db, category_id)
    if name != category.name:
        _check_unique(db, name, exclude_id=category.id)
        audit.record(db, actor, "category.update", "category", category.id,
                     {"name": {"from": category.name, "to": name}})
        category.name = name
        db.flush()
    return category


def delete_category(db: Session, actor: Actor, category_id: int) -> int:
    """Удаляет категорию; её платежи остаются, но без категории. Возвращает, сколько платежей отвязано."""
    category = get_category(db, category_id)
    released = db.execute(
        update(RecurringPayment).where(RecurringPayment.category_id == category.id).values(category_id=None)
    ).rowcount
    audit.record(db, actor, "category.delete", "category", category.id,
                 {"name": category.name, "payments": released})
    db.delete(category)
    db.flush()
    return released
