"""categories, comments and receipt files

Категории регулярных платежей, комментарий к оплате и файл чека (хранится в базе).

Как и в 0002 — без batch-режима: в SQLite он пересоздаёт таблицу, и каскад удалил бы связанные строки.
Внешний ключ recurring_payments.category_id в SQLite объявить через ALTER нельзя — там «отвязку»
при удалении категории делает сервис (services/categories.py), в PostgreSQL ключ создаётся.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-25 15:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.db


revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('categories',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('created_at', app.db.UTCDateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('receipt_files',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('occurrence_id', sa.Integer(), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('content_type', sa.String(length=64), nullable=False),
    sa.Column('size', sa.Integer(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('data', sa.LargeBinary(), nullable=False),
    sa.Column('uploaded_by', sa.Integer(), nullable=True),
    sa.Column('uploaded_by_label', sa.String(length=128), nullable=True),
    sa.Column('created_at', app.db.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['occurrence_id'], ['payment_occurrences.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['uploaded_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('occurrence_id')
    )
    op.add_column('recurring_payments', sa.Column('category_id', sa.Integer(), nullable=True))
    op.add_column('payment_occurrences', sa.Column('comment', sa.Text(), nullable=True))
    if op.get_bind().dialect.name != 'sqlite':
        op.create_foreign_key('fk_recurring_category', 'recurring_payments', 'categories',
                              ['category_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    if op.get_bind().dialect.name != 'sqlite':
        op.drop_constraint('fk_recurring_category', 'recurring_payments', type_='foreignkey')
    op.drop_column('payment_occurrences', 'comment')
    op.drop_column('recurring_payments', 'category_id')
    op.drop_table('receipt_files')
    op.drop_table('categories')
