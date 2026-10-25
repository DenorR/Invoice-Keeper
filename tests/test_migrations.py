"""Миграции не должны терять данные: в SQLite пересоздание таблицы каскадом удаляет связанные строки."""

from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import command
from alembic.config import Config

from app.config import BASE_DIR
from app.db import make_engine


def alembic_config(db_url: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(BASE_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    cfg.attributes["configure_logging"] = False
    return cfg


def counts(db_url: str) -> tuple[int, int]:
    engine = make_engine(db_url)
    with engine.connect() as conn:
        result = (conn.scalar(sa.text("SELECT count(*) FROM recurring_payments")),
                  conn.scalar(sa.text("SELECT count(*) FROM payment_occurrences")))
    engine.dispose()
    return result


def test_upgrade_and_downgrade_keep_payment_history(db_url):
    cfg = alembic_config(db_url)
    command.upgrade(cfg, "0001")
    engine = make_engine(db_url)
    now = datetime.now(timezone.utc).isoformat()
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO recurring_payments (id, name, amount_minor, currency, anchor_date, frequency, created_at, updated_at) "
            "VALUES (1, 'Аренда', 100, 'RUB', '2026-10-01', 'monthly', :now, :now)"), {"now": now})
        conn.execute(sa.text(
            "INSERT INTO payment_occurrences (recurring_payment_id, due_date, amount_minor, currency, paid_at, created_at, updated_at) "
            "VALUES (1, '2026-10-01', 100, 'RUB', '2026-10-01', :now, :now)"), {"now": now})
    engine.dispose()

    command.upgrade(cfg, "head")
    assert counts(db_url) == (1, 1)
    command.downgrade(cfg, "0001")
    assert counts(db_url) == (1, 1)
