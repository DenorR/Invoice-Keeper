"""reminder settings and resume

Окно напоминания: общая настройка (таблица app_settings) и своё у платежа (remind_days).
Возобновление прекращённого платежа (resumed_on).

Столбцы добавляются простым ALTER TABLE, без batch-режима: в SQLite batch пересоздаёт таблицу,
а DROP старой recurring_payments при включённых внешних ключах каскадом удалил бы все периоды.
Поэтому и без CHECK-ограничения — диапазон 1–365 проверяет API.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-25 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.db


revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('app_settings',
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('value', sa.JSON(), nullable=True),
    sa.Column('updated_at', app.db.UTCDateTime(), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.add_column('recurring_payments', sa.Column('remind_days', sa.Integer(), nullable=True))
    op.add_column('recurring_payments', sa.Column('resumed_on', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('recurring_payments', 'resumed_on')
    op.drop_column('recurring_payments', 'remind_days')
    op.drop_table('app_settings')
