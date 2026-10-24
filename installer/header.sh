#!/usr/bin/env bash
# Invoice Keeper __VERSION__ — установщик для Linux-сервера (Ubuntu / Debian).
#
# Это один файл: короткий скрипт и архив приложения после строки-маркера в конце.
#   sudo bash invoice-keeper-__VERSION__.run           установка или обновление (мастер с вопросами)
#   sudo bash invoice-keeper-__VERSION__.run --help    все параметры
set -Eeuo pipefail

VERSION="__VERSION__"
PAYLOAD_SHA256="__PAYLOAD_SHA256__"
INSTALL_DIR="${INSTALL_DIR:-/opt/invoice-keeper}"

usage() {
  cat <<EOF
Invoice Keeper ${VERSION} — установщик

Использование:
  sudo bash $(basename "$0") [параметры]

Без параметров — установка или обновление с мастером настройки.

Параметры:
  --yes            без вопросов: значения берутся из переменных окружения
                   (ADMIN_PASSWORD, TELEGRAM_BOT_TOKEN, DOMAIN, … — см. README),
                   остальное — по умолчанию
  --reconfigure    пройти мастер заново, даже если приложение уже настроено
  --no-ui          вопросы обычным текстом вместо диалоговых окон
  --extract ПАПКА  только распаковать содержимое (посмотреть, что внутри)
  --version        версия установщика
  -h, --help       эта справка

Папка установки: ${INSTALL_DIR} (изменить: INSTALL_DIR=/путь sudo -E bash …)
После установки приложением управляет команда: invoice-keeper help
EOF
}

payload_line() { awk '/^__PAYLOAD_BELOW__$/ { print NR + 1; exit }' "$0"; }

verify_payload() {
  local actual
  actual=$(tail -n +"$(payload_line)" "$0" | sha256sum | cut -d' ' -f1)
  if [[ "$actual" != "$PAYLOAD_SHA256" ]]; then
    echo "✗ Файл установщика повреждён: контрольная сумма не совпала." >&2
    echo "  Скопируйте его на сервер заново (scp копирует без искажений)." >&2
    exit 1
  fi
}

extract_to() { tail -n +"$(payload_line)" "$0" | tar -xzf - -C "$1"; }

main() {
  case "${1:-}" in
    -h|--help) usage; exit 0 ;;
    --version) echo "$VERSION"; exit 0 ;;
    --extract)
      local dest=${2:?укажите папку: --extract ПАПКА}
      verify_payload; mkdir -p "$dest"; extract_to "$dest"
      echo "Распаковано в $dest"; exit 0 ;;
  esac

  if [[ $EUID -ne 0 ]]; then
    echo "Нужны права администратора. Запустите так: sudo bash $0 $*" >&2
    exit 1
  fi
  for tool in tar sha256sum awk; do
    command -v "$tool" >/dev/null || { echo "Не найдена программа $tool" >&2; exit 1; }
  done

  verify_payload
  TMP_DIR=$(mktemp -d /tmp/invoice-keeper-install.XXXXXX)
  trap 'rm -rf "${TMP_DIR:-}"' EXIT
  extract_to "$TMP_DIR"
  INSTALLER_VERSION="$VERSION" INSTALL_DIR="$INSTALL_DIR" bash "$TMP_DIR/installer/setup.sh" --source "$TMP_DIR" "$@"
}

main "$@"
exit 0
__PAYLOAD_BELOW__
