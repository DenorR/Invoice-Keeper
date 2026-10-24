#!/usr/bin/env bash
# Собирает самораспаковывающийся установщик для сервера:
#   deploy-kit/invoice-keeper-<версия>.run  (+ .sha256)
#
#   scripts/build-installer.sh              из текущих файлов (панель — уже собранная в app/static)
#   scripts/build-installer.sh --build-web  сначала пересобрать панель (нужен Node)
set -Eeuo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

VERSION=$(sed -n 's/^__version__ = "\(.*\)"/\1/p' app/__init__.py | tr -d '\r')
[[ -n $VERSION ]] || { echo "Не найдена версия в app/__init__.py" >&2; exit 1; }

if [[ ${1:-} == --build-web ]]; then (cd web && npm run build); fi
[[ -f app/static/index.html ]] || { echo "Панель не собрана: cd web && npm run build" >&2; exit 1; }

FILES=(app migrations installer deploy alembic.ini requirements.txt openapi.yaml Dockerfile .dockerignore
       docker-compose.yml docker-compose.prod.yml docker-compose.ipv6.yml .env.example README.md)

STAGE=$(mktemp -d)
PAYLOAD=$(mktemp)
trap 'rm -rf "$STAGE" "$PAYLOAD"' EXIT

tar --exclude='__pycache__' --exclude='*.pyc' -cf - "${FILES[@]}" | tar -xf - -C "$STAGE"
printf '%s\n' "$VERSION" >"$STAGE/VERSION"
# Переводы строк Windows → Unix во всех текстовых файлах, которые выполняются на сервере
find "$STAGE" -type f \( -name '*.sh' -o -name 'invoice-keeper' -o -name '*.py' -o -name '*.yml' -o -name '*.ini' \
  -o -name '*.txt' -o -name 'Caddyfile' -o -name 'Dockerfile' -o -name '.env.example' -o -name '.dockerignore' -o -name '*.mako' \) \
  -exec sed -i 's/\r$//' {} +
chmod 755 "$STAGE/installer/setup.sh" "$STAGE/installer/invoice-keeper"

tar -C "$STAGE" --owner=0 --group=0 -czf "$PAYLOAD" .
SHA=$(sha256sum "$PAYLOAD" | cut -d' ' -f1)

mkdir -p deploy-kit
NAME="invoice-keeper-$VERSION.run"
OUT="deploy-kit/$NAME"
sed -e "s/__VERSION__/$VERSION/g" -e "s/__PAYLOAD_SHA256__/$SHA/" -e 's/\r$//' installer/header.sh >"$OUT"
cat "$PAYLOAD" >>"$OUT"
chmod 755 "$OUT"
(cd deploy-kit && sha256sum "$NAME" >"$NAME.sha256")
# прошлые версии из папки убираем, чтобы не перепутать
find deploy-kit -maxdepth 1 -name 'invoice-keeper-*.run*' ! -name "$NAME" ! -name "$NAME.sha256" -delete

# имя файла в инструкции — под текущую версию
sed -i -E "s/invoice-keeper-[0-9]+\.[0-9]+\.[0-9]+\.run/$NAME/g" deploy-kit/README.md

echo "Готово: $OUT ($(du -h "$OUT" | cut -f1)), sha256 $SHA"
