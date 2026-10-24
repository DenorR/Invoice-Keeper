from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from app.api.deps import AdminUser, ContainerDep, DbDep, actor_for
from app.schemas import UserCreate, UserOut, UserUpdate
from app.services import users as users_service

router = APIRouter(prefix="/users", tags=["Пользователи (администратор)"])


@router.get("", response_model=list[UserOut], summary="Получение списка пользователей")
def list_users(admin: AdminUser, db: DbDep):
    return [UserOut.build(user) for user in users_service.list_users(db)]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED, summary="Создание обычного пользователя")
def create_user(payload: UserCreate, request: Request, admin: AdminUser, db: DbDep, container: ContainerDep):
    user = users_service.create_user(
        db, container.settings, actor_for(request, admin), payload.login, payload.password, payload.name or None
    )
    db.commit()
    return UserOut.build(user)


@router.get("/{user_id}", response_model=UserOut, summary="Получение пользователя")
def get_user(user_id: int, admin: AdminUser, db: DbDep):
    return UserOut.build(users_service.get_user(db, user_id))


@router.patch("/{user_id}", response_model=UserOut, summary="Изменение пользователя")
def update_user(user_id: int, payload: UserUpdate, request: Request, admin: AdminUser, db: DbDep,
                container: ContainerDep):
    user = users_service.update_user(
        db,
        container.settings,
        actor_for(request, admin),
        user_id,
        login=payload.login,
        password=payload.password,
        name=payload.name or None,
        name_set="name" in payload.model_fields_set,
    )
    db.commit()
    return UserOut.build(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удаление пользователя")
def delete_user(user_id: int, request: Request, admin: AdminUser, db: DbDep):
    users_service.delete_user(db, actor_for(request, admin), user_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
