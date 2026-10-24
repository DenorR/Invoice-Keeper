"""Точка входа: python -m app [serve | reset-db | export-openapi]."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.config import BASE_DIR, load_settings


def reset_database(with_demo: bool) -> None:
    from alembic import command
    from alembic.config import Config as AlembicConfig

    from app.container import build_container
    from app.main import run_migrations
    from app.seed import seed
    from app.services.users import ensure_admin

    settings = load_settings()
    cfg = AlembicConfig()
    cfg.set_main_option("script_location", str(BASE_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
    cfg.attributes["configure_logging"] = False
    run_migrations(settings.database_url)
    command.downgrade(cfg, "base")
    run_migrations(settings.database_url)

    container = build_container(settings)
    with container.session_factory() as db:
        ensure_admin(db, settings)
        if with_demo:
            seed(db, container.clock, settings)
        db.commit()
    container.engine.dispose()
    print("База пересоздана" + (" с демо-данными" if with_demo else ""))


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(prog="python -m app", description="Invoice Keeper")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("serve", help="запустить веб-сервер (по умолчанию)")
    reset = sub.add_parser("reset-db", help="пересоздать базу данных с демо-данными")
    reset.add_argument("--empty", action="store_true", help="без демо-данных")
    export = sub.add_parser("export-openapi", help="сохранить OpenAPI-спецификацию в файл")
    export.add_argument("--output", default=str(BASE_DIR / "openapi.yaml"))
    args = parser.parse_args()

    if args.command == "reset-db":
        reset_database(with_demo=not args.empty)
    elif args.command == "export-openapi":
        from app.main import export_openapi

        export_openapi(Path(args.output))
        print(f"OpenAPI сохранён в {args.output}")
    else:
        import uvicorn

        settings = load_settings()
        uvicorn.run(
            "app.main:create_app",
            factory=True,
            host=settings.host,
            port=settings.port,
            proxy_headers=True,
            forwarded_allow_ips="*",
            log_level=settings.log_level.lower(),
        )


if __name__ == "__main__":
    main()
