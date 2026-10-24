#!/usr/bin/env bash
# Invoice Keeper — мастер установки, обновления и перенастройки.
#
#   из .run-установщика:       setup.sh --source <распакованный архив> [--yes] [--reconfigure] [--no-ui]
#   на настроенном сервере:    invoice-keeper config   (= setup.sh --reconfigure)
#
# Сценарии:
#   установка     — настроек ещё нет: мастер → файлы → запуск
#   обновление    — настройки есть: резервная копия базы → новые файлы → перезапуск (.env не меняется)
#   перенастройка — мастер с текущими значениями → новый .env → перезапуск
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/invoice-keeper}"
LOG_FILE="${LOG_FILE:-/var/log/invoice-keeper-install.log}"
CLI_LINK="${CLI_LINK:-/usr/local/bin/invoice-keeper}"
NEW_VERSION="${INSTALLER_VERSION:-}"
SOURCE=""
ASSUME_YES=0
RECONFIGURE=0
USE_UI=1
TITLE="Invoice Keeper · установка"

# Кириллица в диалоговых окнах корректна только в UTF-8.
if locale -a 2>/dev/null | grep -qiE '^c\.utf-?8$'; then export LANG=C.UTF-8 LC_ALL=C.UTF-8; fi

# ───────────────────────────── вывод ─────────────────────────────
if [[ -t 1 ]] && command -v tput >/dev/null && [[ $(tput colors 2>/dev/null || echo 0) -ge 8 ]]; then
  BOLD=$(tput bold); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1); CYAN=$(tput setaf 6); RESET=$(tput sgr0)
else
  BOLD="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi
log()  { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >>"$LOG_FILE"; }
info() { printf '%s %s\n' "${CYAN}▸${RESET}" "$*"; log "INFO $*"; }
ok()   { printf '%s %s\n' "${GREEN}✓${RESET}" "$*"; log "OK   $*"; }
warn() { printf '%s %s\n' "${YELLOW}!${RESET}" "$*"; log "WARN $*"; }
die() {
  printf '%s\n' "${RED}✗ $*${RESET}" >&2
  printf '  Подробности в журнале: %s\n' "$LOG_FILE" >&2
  log "FAIL $*"
  exit 1
}

# run "что делаем" команда… — вывод команды уходит в журнал, на экране — индикатор и итог.
run() {
  local title=$1; shift
  log "RUN  $title: $*"
  if [[ -t 1 ]]; then
    ("$@") >>"$LOG_FILE" 2>&1 &
    local pid=$! i=0 frames='|/-\'
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r%s %s ' "${CYAN}${frames:i++%4:1}${RESET}" "$title"
      sleep 0.2
    done
    if wait "$pid"; then printf '\r%s %s \n' "${GREEN}✓${RESET}" "$title"; log "OK   $title"
    else printf '\r%s %s \n' "${RED}✗${RESET}" "$title"; die "Не удалось: $title"; fi
  else
    if ("$@") >>"$LOG_FILE" 2>&1; then ok "$title"; else die "Не удалось: $title"; fi
  fi
}

# ───────────────────────────── диалоги ─────────────────────────────
# Если есть whiptail и терминал — окна; иначе обычные вопросы в консоли; с --yes — значения по умолчанию.
ui_available() { [[ $USE_UI -eq 1 && -t 0 && -t 1 ]] && command -v whiptail >/dev/null; }
cancelled() { clear 2>/dev/null || true; echo "Установка отменена — на сервере ничего не изменено."; exit 1; }

ui_msg() {  # просто сообщение
  [[ $ASSUME_YES -eq 1 ]] && return 0
  if ui_available; then whiptail --title "$TITLE" --msgbox "$1" 22 78; else printf '\n%s\n\n' "$1"; fi
}

ui_pause() {  # сообщение, после которого человек должен что-то сделать и подтвердить
  if ui_available; then whiptail --title "$TITLE" --msgbox "$1" 18 78
  else printf '\n%s\n' "$1"; read -r -p "Нажмите Enter, когда будете готовы… " _; fi
}

ui_yesno() {  # ui_yesno "вопрос" [yes|no — ответ по умолчанию]; код 0 = да
  local question=$1 default=${2:-yes} answer
  if [[ $ASSUME_YES -eq 1 ]]; then [[ $default == yes ]]; return; fi
  if ui_available; then
    if [[ $default == no ]]; then whiptail --title "$TITLE" --defaultno --yes-button "Да" --no-button "Нет" --yesno "$question" 16 78
    else whiptail --title "$TITLE" --yes-button "Да" --no-button "Нет" --yesno "$question" 16 78; fi
    return
  fi
  local hint="[Д/н]"; [[ $default == no ]] && hint="[д/Н]"
  read -r -p "$question $hint " answer
  answer=${answer,,}
  if [[ -z $answer ]]; then [[ $default == yes ]]; return; fi
  [[ $answer == д* || $answer == y* ]]
}

ui_input() {  # ui_input "вопрос" "по умолчанию" → ответ в stdout
  local question=$1 default=${2:-} answer
  if [[ $ASSUME_YES -eq 1 ]]; then printf '%s' "$default"; return; fi
  if ui_available; then
    answer=$(whiptail --title "$TITLE" --ok-button "Далее" --cancel-button "Отмена" --inputbox "$question" 14 78 "$default" 3>&1 1>&2 2>&3) || cancelled
  else
    read -r -p "$question [${default}]: " answer
    answer=${answer:-$default}
  fi
  printf '%s' "$answer"
}

ui_password() {  # ui_password "вопрос" → ответ в stdout (ввод не показывается)
  local question=$1 answer
  if ui_available; then
    answer=$(whiptail --title "$TITLE" --ok-button "Далее" --cancel-button "Отмена" --passwordbox "$question" 14 78 3>&1 1>&2 2>&3) || cancelled
  else
    read -r -s -p "$question: " answer; echo >&2
  fi
  printf '%s' "$answer"
}

ui_menu() {  # ui_menu "текст" "метка по умолчанию" метка1 "описание1" метка2 "описание2" … → метка в stdout
  local text=$1 default=$2; shift 2
  if [[ $ASSUME_YES -eq 1 ]]; then printf '%s' "$default"; return; fi
  if ui_available; then
    local count=$(( $# / 2 ))
    whiptail --title "$TITLE" --ok-button "Выбрать" --cancel-button "Отмена" --default-item "$default" \
      --menu "$text" $(( count + 13 )) 78 "$count" "$@" 3>&1 1>&2 2>&3 || cancelled
    return
  fi
  printf '\n%s\n' "$text" >&2
  local tags=() number=1 default_number=1 answer
  while (( $# )); do
    tags+=("$1"); [[ $1 == "$default" ]] && default_number=$number
    printf '  %d) %s\n' "$number" "$2" >&2
    shift 2; number=$(( number + 1 ))
  done
  read -r -p "Ваш выбор [${default_number}]: " answer
  answer=${answer:-$default_number}
  if ! [[ $answer =~ ^[0-9]+$ ]] || (( answer < 1 || answer > ${#tags[@]} )); then answer=$default_number; fi
  printf '%s' "${tags[answer-1]}"
}

ui_info() {  # короткое сообщение без ожидания (пока идёт фоновое действие)
  if ui_available; then whiptail --title "$TITLE" --infobox "$1" 10 78; else printf '%s\n' "$1"; fi
}

# ───────────────────────────── утилиты ─────────────────────────────
env_get() {  # env_get КЛЮЧ [файл]
  local file=${2:-$INSTALL_DIR/.env}
  [[ -f $file ]] || return 0
  grep -E "^$1=" "$file" | tail -n 1 | cut -d= -f2- || true
}

env_set() {  # env_set КЛЮЧ ЗНАЧЕНИЕ файл — заменить строку или дописать
  local key=$1 value=$2 file=$3
  if grep -qE "^${key}=" "$file"; then
    KEY="$key" VALUE="$value" awk -F= '$1 == ENVIRON["KEY"] { print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; next } { print }' \
      "$file" >"$file.tmp" && cat "$file.tmp" >"$file" && rm -f "$file.tmp"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

gen_password() {
  local length=${1:-16}
  if command -v openssl >/dev/null; then openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-"$length"
  else head -c 200 /dev/urandom | tr -dc 'A-Za-z0-9' | cut -c1-"$length"; fi
}

detect_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }'
}

is_private_ip() { [[ $1 =~ ^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.) ]]; }

host_timezone() {
  local tz=""
  command -v timedatectl >/dev/null && tz=$(timedatectl show -p Timezone --value 2>/dev/null || true)
  [[ -z $tz && -f /etc/timezone ]] && tz=$(</etc/timezone)
  [[ -z $tz || $tz == UTC || $tz == Etc/UTC ]] && tz="Europe/Moscow"
  printf '%s' "$tz"
}

valid_timezone() { [[ ! -d /usr/share/zoneinfo || -f /usr/share/zoneinfo/$1 ]]; }

has_global_ipv6() { ip -6 route get 2001:4860:4860::8888 >/dev/null 2>&1 && ip -6 addr show scope global 2>/dev/null | grep -q inet6; }

docker_major() { docker version --format '{{.Server.Version}}' 2>/dev/null | cut -d. -f1; }

compose() { (cd "$INSTALL_DIR" && docker compose "$@"); }

project_running() { [[ -f $INSTALL_DIR/.env ]] && [[ -n $(compose ps -q app 2>/dev/null || true) ]]; }

# ───────────────────────────── Telegram ─────────────────────────────
# Нужен python3 (есть в Ubuntu и Debian по умолчанию) — только чтобы разобрать JSON-ответы.
tg_api() {  # tg_api ТОКЕН МЕТОД [аргументы curl…] → тело ответа
  local token=$1 method=$2; shift 2
  curl -sS --max-time 25 "https://api.telegram.org/bot${token}/${method}" "$@" 2>/dev/null || true
}

json() {  # json 'выражение над d' < JSON
  python3 -c "import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
$1" 2>/dev/null
}

tg_bot_name() {  # → @username или пусто
  tg_api "$1" getMe | json 'print(d["result"]["username"] if d.get("ok") else "")'
}

tg_find_chats() {  # → строки «id<TAB>название»; код 2 — бот занят другой программой
  local body
  body=$(tg_api "$1" getUpdates -G --data-urlencode "timeout=2")
  if printf '%s' "$body" | json 'sys.exit(0 if d.get("error_code") == 409 else 1)'; then return 2; fi
  printf '%s' "$body" | json '
chats = {}
for update in d.get("result", []):
    for key in ("message", "edited_message", "my_chat_member", "channel_post"):
        if key in update:
            chat = update[key]["chat"]
            title = chat.get("title") or " ".join(filter(None, [chat.get("first_name"), chat.get("last_name")])) or str(chat["id"])
            kind = {"private": "личный чат", "group": "группа", "supergroup": "группа", "channel": "канал"}.get(chat["type"], chat["type"])
            chats[chat["id"]] = f"{title} ({kind})"
for chat_id, title in chats.items():
    print(f"{chat_id}\t{title}")' || true
}

tg_send() {  # tg_send ТОКЕН ЧАТ ТЕКСТ → код 0 при успехе
  tg_api "$1" sendMessage --data-urlencode "chat_id=$2" --data-urlencode "text=$3" | json 'sys.exit(0 if d.get("ok") else 1)'
}

# ───────────────────────────── шаги мастера ─────────────────────────────
step_admin() {
  ADMIN_LOGIN=$(ui_input "Шаг 1 из 5 · Администратор

Логин администратора. Он задаётся только здесь (в файле .env)
и не меняется через панель — так требует кейс." "${ADMIN_LOGIN:-admin}")
  ADMIN_LOGIN=${ADMIN_LOGIN,,}
  [[ $ADMIN_LOGIN =~ ^[a-z0-9_.-]{3,64}$ ]] || ADMIN_LOGIN=admin

  local keep_label=() choice
  [[ -n ${ADMIN_PASSWORD:-} ]] && keep_label=(keep "Оставить текущий пароль")
  [[ $ASSUME_YES -eq 1 ]] && { [[ -n ${ADMIN_PASSWORD:-} ]] || { ADMIN_PASSWORD=$(gen_password 16); PASSWORD_SHOWN=1; }; return; }
  choice=$(ui_menu "Пароль администратора" "$([[ -n ${ADMIN_PASSWORD:-} ]] && echo keep || echo generate)" \
    "${keep_label[@]}" generate "Сгенерировать надёжный (покажу в конце установки)" manual "Ввести свой")
  case $choice in
    keep) ;;
    generate) ADMIN_PASSWORD=$(gen_password 16); PASSWORD_SHOWN=1 ;;
    manual)
      local first second
      while true; do
        first=$(ui_password "Пароль администратора (не короче 8 символов)")
        if (( ${#first} < 8 )); then ui_msg "Пароль слишком короткий — нужно хотя бы 8 символов."; continue; fi
        second=$(ui_password "Повторите пароль")
        [[ $first == "$second" ]] && break
        ui_msg "Пароли не совпали, попробуйте ещё раз."
      done
      ADMIN_PASSWORD=$first; PASSWORD_SHOWN=1 ;;
  esac
}

step_timezone() {
  local tz
  while true; do
    tz=$(ui_input "Шаг 2 из 5 · Часовой пояс

Все сроки и напоминания считаются в этом поясе.
Формат IANA: Europe/Moscow, Asia/Yekaterinburg, Asia/Novosibirsk…" "${APP_TIMEZONE:-$(host_timezone)}")
    if valid_timezone "$tz"; then APP_TIMEZONE=$tz; return; fi
    [[ $ASSUME_YES -eq 1 ]] && die "Неизвестный часовой пояс: $tz"
    ui_msg "Часовой пояс «$tz» не найден. Проверьте написание, например Europe/Moscow."
  done
}

step_address() {
  local ip; ip=$(detect_ip)
  local default=https
  [[ -n ${ACCESS_MODE:-} ]] && default=$ACCESS_MODE
  [[ -n ${DOMAIN:-} && ${DOMAIN:-} != *.sslip.io ]] && default=domain
  if [[ -z $ip ]] || is_private_ip "$ip"; then [[ $default == https ]] && default=http; fi

  ACCESS_MODE=$(ui_menu "Шаг 3 из 5 · Как открывать панель

IP этого сервера: ${ip:-не определён}" "$default" \
    https "HTTPS по адресу ${ip:-IP}.sslip.io — бесплатно, сертификат сам" \
    domain "HTTPS на своём домене (A-запись уже указывает сюда)" \
    http "Без HTTPS: http://${ip:-IP} — только для проверки")

  case $ACCESS_MODE in
    https)
      [[ -n $ip ]] || die "Не удалось определить IP сервера — выберите свой домен или режим без HTTPS"
      DOMAIN="${ip}.sslip.io"; PUBLIC_URL="https://$DOMAIN" ;;
    domain)
      while true; do
        DOMAIN=$(ui_input "Домен панели (без https://), например pay.example.ru" "${DOMAIN:-}")
        DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN%%/*}
        [[ $DOMAIN =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] && break
        [[ $ASSUME_YES -eq 1 ]] && die "Некорректный домен: $DOMAIN"
        ui_msg "«$DOMAIN» не похоже на домен. Пример: pay.example.ru"
      done
      PUBLIC_URL="https://$DOMAIN" ;;
    http)
      DOMAIN=""
      APP_PORT=$(ui_input "Порт панели на этом сервере" "${APP_PORT:-80}")
      [[ $APP_PORT =~ ^[0-9]+$ ]] && (( APP_PORT > 0 && APP_PORT < 65536 )) || APP_PORT=80
      PUBLIC_URL="http://${ip:-localhost}"; [[ $APP_PORT != 80 ]] && PUBLIC_URL="$PUBLIC_URL:$APP_PORT" ;;
  esac
}

step_telegram() {
  if [[ $ASSUME_YES -eq 1 ]]; then return; fi
  if ! command -v python3 >/dev/null || ! command -v curl >/dev/null; then
    TG_TOKEN=$(ui_input "Шаг 4 из 5 · Telegram

Токен бота от @BotFather (пусто — без Telegram)" "${TG_TOKEN:-}")
    TG_CHAT=$(ui_input "ID чата для напоминаний (бот пришлёт его по команде /chatid)" "${TG_CHAT:-}")
    return
  fi

  local choice="setup"
  if [[ -n ${TG_TOKEN:-} ]]; then
    local current_bot; current_bot=$(tg_bot_name "$TG_TOKEN")
    choice=$(ui_menu "Шаг 4 из 5 · Telegram

Сейчас: бот ${current_bot:+@}${current_bot:-(не отвечает)}, чат ${TG_CHAT:-не выбран}" keep \
      keep "Оставить как есть" setup "Настроить заново" off "Отключить напоминания в Telegram")
  elif ! ui_yesno "Шаг 4 из 5 · Telegram

Подключить бота, который за 3 дня до срока пишет в рабочий чат?

Понадобится токен от @BotFather. Шаг можно пропустить
и настроить позже командой:  invoice-keeper config" yes; then
    choice=off
  fi

  case $choice in
    keep) return ;;
    off) TG_TOKEN=""; TG_CHAT=""; return ;;
  esac

  # 1) токен
  local token bot
  while true; do
    token=$(ui_password "Токен бота от @BotFather (вида 1234567890:AAH…)")
    token=${token//[[:space:]]/}
    if [[ -z $token ]]; then
      ui_yesno "Токен не введён. Пропустить настройку Telegram?" yes && { TG_TOKEN=""; TG_CHAT=""; return; }
      continue
    fi
    ui_info "Проверяю токен…"
    bot=$(tg_bot_name "$token")
    [[ -n $bot ]] && break
    ui_yesno "Telegram не принял токен (или сервер не может связаться с api.telegram.org).

Ввести токен ещё раз?" yes || { TG_TOKEN=""; TG_CHAT=""; return; }
  done
  TG_TOKEN=$token; TG_BOT=$bot

  # 2) чат: ищем автоматически по последним сообщениям боту
  if project_running; then compose stop app >>"$LOG_FILE" 2>&1 || true; fi   # иначе наше приложение само читает бота
  ui_pause "Бот найден: @$TG_BOT ✓

Теперь выберите чат для напоминаний:
  1. Добавьте @$TG_BOT в рабочую группу Telegram
     (или откройте группу, где он уже есть);
  2. Напишите в этой группе любое сообщение, например  /start

Затем нажмите OK — я найду чат сам (жду до 2 минут)."

  local chats="" status=0 waited=0
  while (( waited < 120 )); do
    ui_info "Ищу чат с ботом @$TG_BOT… прошло ${waited} с из 120.

Напишите любое сообщение в группе, куда добавлен бот."
    status=0; chats=$(tg_find_chats "$TG_TOKEN") || status=$?
    [[ $status -eq 2 || -n $chats ]] && break
    sleep 3; waited=$(( waited + 6 ))
  done

  if [[ $status -eq 2 ]]; then
    ui_msg "Этот бот сейчас запущен в другом месте (например, на другом сервере),
а Telegram не даёт двум программам одновременно читать одного бота.

Введите ID чата вручную: бот пришлёт его в ответ на /chatid там, где он запущен.
Или создайте для этого сервера отдельного бота у @BotFather."
    TG_CHAT=$(ui_input "ID чата (например -1001234567890)" "${TG_CHAT:-}")
  elif [[ -z $chats ]]; then
    TG_CHAT=$(ui_input "Сообщений боту не нашлось. Так бывает, если этот бот уже запущен
на другом сервере — тогда сообщения забирает он.

Введите ID чата вручную (бот пришлёт его по команде /chatid)
или оставьте пустым, чтобы настроить позже" "${TG_CHAT:-}")
  else
    local count; count=$(printf '%s\n' "$chats" | grep -c .)
    if (( count == 1 )); then
      TG_CHAT=$(cut -f1 <<<"$chats"); TG_CHAT_TITLE=$(cut -f2 <<<"$chats")
    else
      local items=() line
      while IFS=$'\t' read -r line_id line_title; do items+=("$line_id" "$line_title"); done <<<"$chats"
      TG_CHAT=$(ui_menu "Бот видит несколько чатов. Куда присылать напоминания?" "${items[0]}" "${items[@]}")
      TG_CHAT_TITLE=$(awk -F'\t' -v id="$TG_CHAT" '$1 == id { print $2 }' <<<"$chats")
    fi
  fi

  # 3) пробное сообщение
  if [[ -n $TG_CHAT ]]; then
    if tg_send "$TG_TOKEN" "$TG_CHAT" "✅ Invoice Keeper подключён к этому чату. Напоминания о платежах будут приходить сюда за 3 дня до срока."; then
      ui_msg "Готово: чат ${TG_CHAT_TITLE:+«$TG_CHAT_TITLE» }($TG_CHAT).

В него отправлено пробное сообщение — проверьте Telegram."
    else
      ui_msg "Не удалось отправить пробное сообщение в чат $TG_CHAT.
Проверьте, что бот добавлен в этот чат. Настройку можно поправить позже: invoice-keeper config"
    fi
  fi
}

step_demo() {
  local default=yes
  [[ ${SEED_DEMO_DATA:-true} == false ]] && default=no
  if ui_yesno "Шаг 5 из 5 · Демо-данные

Загрузить пример: аренда в рублях, сервер в долларах, подписка в евро,
просроченный платёж и история оплат? Удобно для показа и проверки.

Демо загружается только в пустую базу; удалить его можно командой
invoice-keeper reset-demo --empty" "$default"; then SEED_DEMO_DATA=true; else SEED_DEMO_DATA=false; fi
}

step_confirm() {
  local tg="не подключён"
  [[ -n ${TG_TOKEN:-} ]] && tg="@${TG_BOT:-бот} → чат ${TG_CHAT:-не выбран}"
  ui_yesno "Всё готово к запуску:

  Папка:          $INSTALL_DIR
  Панель:         $PUBLIC_URL
  Администратор:  $ADMIN_LOGIN
  Часовой пояс:   $APP_TIMEZONE
  Telegram:       $tg
  Демо-данные:    $([[ $SEED_DEMO_DATA == true ]] && echo да || echo нет)

Продолжить?" yes || cancelled
}

# ───────────────────────────── установка ─────────────────────────────
preflight() {
  [[ $EUID -eq 0 ]] || die "Нужны права администратора: sudo …"
  [[ -f /etc/os-release ]] && . /etc/os-release
  case "${ID:-}${ID_LIKE:-}" in
    *ubuntu*|*debian*) ok "Система: ${PRETTY_NAME:-Linux}" ;;
    *) warn "Система ${PRETTY_NAME:-неизвестна} не проверялась — нужен установленный Docker с Compose" ;;
  esac
  [[ $INSTALL_DIR == /* && ${#INSTALL_DIR} -gt 4 ]] || die "Странная папка установки: $INSTALL_DIR"
  command -v curl >/dev/null || run "Установка curl" bash -c 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y curl'
}

ensure_docker() {
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    systemctl is-active --quiet docker 2>/dev/null || systemctl start docker 2>/dev/null || true
    ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '') и Compose уже установлены"
    return
  fi
  command -v apt-get >/dev/null || die "Docker не найден. Установите Docker Engine с Compose: https://docs.docker.com/engine/install/"
  ui_yesno "Для работы нужен Docker, а он не установлен.

Установить его сейчас из репозитория системы
(пакеты docker.io и docker compose)?" yes || die "Без Docker установка невозможна"
  run "Установка Docker (1–2 минуты)" bash -c '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y docker.io
    apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin
    apt-get install -y docker-buildx || true
    systemctl enable --now docker'
  docker compose version >/dev/null 2>&1 || die "Docker Compose не установился. Инструкция: https://docs.docker.com/engine/install/"
  ok "Docker установлен"
}

needed_ports() { if [[ $ACCESS_MODE == http ]]; then echo "$APP_PORT"; else echo "80 443"; fi; }

check_ports() {
  local port holder
  for port in $(needed_ports); do
    holder=$(ss -ltnpH "sport = :$port" 2>/dev/null | head -n 1 || true)
    [[ -z $holder ]] && continue
    if docker ps --filter "label=com.docker.compose.project=$PROJECT_NAME" --format '{{.Ports}}' 2>/dev/null | grep -qE "[:.]$port->"; then continue; fi
    die "Порт $port уже занят другой программой:
    $holder
  Освободите его или выберите режим «без HTTPS» с другим портом (invoice-keeper config)."
  done
}

open_firewall() {
  command -v ufw >/dev/null || return 0
  ufw status 2>/dev/null | grep -q "Status: active" || return 0
  local port
  for port in 22 $(needed_ports); do ufw allow "$port/tcp" >>"$LOG_FILE" 2>&1 || true; done
  ok "Брандмауэр ufw: открыты порты 22 $(needed_ports)"
}

compose_files() {
  local files="docker-compose.yml"
  [[ $ACCESS_MODE != http ]] && files="$files:docker-compose.prod.yml"
  if has_global_ipv6 && (( $(docker_major || echo 0) >= 27 )); then files="$files:docker-compose.ipv6.yml"; fi
  printf '%s' "$files"
}

install_files() {
  mkdir -p "$INSTALL_DIR"
  # файлы прошлой версии удаляем целиком; настройки и резервные копии не трогаем
  find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name '.env' ! -name '.env.bak*' ! -name 'backups' -exec rm -rf {} +
  cp -a "$SOURCE"/. "$INSTALL_DIR"/
  chmod 755 "$INSTALL_DIR/installer/invoice-keeper" "$INSTALL_DIR/installer/setup.sh"
  ln -sf "$INSTALL_DIR/installer/invoice-keeper" "$CLI_LINK"
}

write_env() {
  local env_file="$INSTALL_DIR/.env"
  if [[ -f $env_file ]]; then cp -p "$env_file" "$env_file.bak-$(date +%Y%m%d-%H%M%S)"
  else cp "$INSTALL_DIR/.env.example" "$env_file"; fi
  chmod 600 "$env_file"
  env_set ADMIN_LOGIN "$ADMIN_LOGIN" "$env_file"
  env_set ADMIN_PASSWORD "$ADMIN_PASSWORD" "$env_file"
  env_set APP_TIMEZONE "$APP_TIMEZONE" "$env_file"
  env_set PUBLIC_URL "$PUBLIC_URL" "$env_file"
  env_set COOKIE_SECURE "$([[ $ACCESS_MODE == http ]] && echo false || echo true)" "$env_file"
  env_set DOMAIN "${DOMAIN:-}" "$env_file"
  env_set APP_PORT "${APP_PORT:-80}" "$env_file"
  env_set TELEGRAM_BOT_TOKEN "${TG_TOKEN:-}" "$env_file"
  env_set TELEGRAM_CHAT_ID "${TG_CHAT:-}" "$env_file"
  env_set SEED_DEMO_DATA "$SEED_DEMO_DATA" "$env_file"
  env_set DEMO_USER_PASSWORD "${DEMO_USER_PASSWORD:-$(gen_password 12)}" "$env_file"
  env_set DEMO_ACCOUNTANT_PASSWORD "${DEMO_ACCOUNTANT_PASSWORD:-$(gen_password 12)}" "$env_file"
  env_set COMPOSE_PROJECT_NAME "$PROJECT_NAME" "$env_file"
  env_set COMPOSE_FILE "$(compose_files)" "$env_file"
  ok "Настройки записаны в $env_file"
}

load_env() {  # текущие значения — как подсказки для мастера (переменные окружения важнее)
  ADMIN_LOGIN=${ADMIN_LOGIN:-$(env_get ADMIN_LOGIN)}
  ADMIN_PASSWORD=${ADMIN_PASSWORD:-$(env_get ADMIN_PASSWORD)}
  APP_TIMEZONE=${APP_TIMEZONE:-$(env_get APP_TIMEZONE)}
  DOMAIN=${DOMAIN:-$(env_get DOMAIN)}
  APP_PORT=${APP_PORT:-$(env_get APP_PORT)}
  TG_TOKEN=${TELEGRAM_BOT_TOKEN:-$(env_get TELEGRAM_BOT_TOKEN)}
  TG_CHAT=${TELEGRAM_CHAT_ID:-$(env_get TELEGRAM_CHAT_ID)}
  SEED_DEMO_DATA=${SEED_DEMO_DATA:-$(env_get SEED_DEMO_DATA)}
  DEMO_USER_PASSWORD=${DEMO_USER_PASSWORD:-$(env_get DEMO_USER_PASSWORD)}
  DEMO_ACCOUNTANT_PASSWORD=${DEMO_ACCOUNTANT_PASSWORD:-$(env_get DEMO_ACCOUNTANT_PASSWORD)}
  PUBLIC_URL=$(env_get PUBLIC_URL)
  if [[ -z ${ACCESS_MODE:-} ]]; then
    if [[ -n $DOMAIN ]]; then [[ $DOMAIN == *.sslip.io ]] && ACCESS_MODE=https || ACCESS_MODE=domain; fi
  fi
  [[ $ADMIN_PASSWORD == change-me ]] && ADMIN_PASSWORD=""
  if [[ -n ${DOMAIN:-} && -z ${PUBLIC_URL:-} ]]; then PUBLIC_URL="https://$DOMAIN"; fi
  return 0
}

migrate_env() {  # обновление: добавить ключи, которых не было в прошлых версиях; остальное не трогаем
  local env_file="$INSTALL_DIR/.env"
  [[ -z ${ACCESS_MODE:-} ]] && { [[ -n ${DOMAIN:-} ]] && ACCESS_MODE=https || ACCESS_MODE=http; }
  [[ -n $(env_get COMPOSE_PROJECT_NAME) ]] || env_set COMPOSE_PROJECT_NAME "$PROJECT_NAME" "$env_file"
  env_set COMPOSE_FILE "$(compose_files)" "$env_file"
  if [[ -z $(env_get PUBLIC_URL) ]]; then
    PUBLIC_URL=$([[ -n ${DOMAIN:-} ]] && echo "https://$DOMAIN" || echo "http://$(detect_ip)")
    env_set PUBLIC_URL "$PUBLIC_URL" "$env_file"
  fi
  APP_PORT=${APP_PORT:-80}
}

backup_before_update() {
  project_running || return 0
  mkdir -p "$INSTALL_DIR/backups"
  local file="$INSTALL_DIR/backups/before-update-$(date +%Y%m%d-%H%M%S).db"
  if compose exec -T app python -c "import sqlite3; s = sqlite3.connect('/app/data/invoice-keeper.db'); d = sqlite3.connect('/app/data/.backup.db'); s.backup(d); d.close()" >>"$LOG_FILE" 2>&1 \
    && compose cp app:/app/data/.backup.db "$file" >>"$LOG_FILE" 2>&1; then
    compose exec -T app rm -f /app/data/.backup.db >>"$LOG_FILE" 2>&1 || true
    chmod 600 "$file"
    ok "Резервная копия базы: $file"
  else
    warn "Резервную копию сделать не удалось (продолжаю обновление)"
  fi
}

wait_healthy() {
  local status="" i
  for i in $(seq 1 90); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app 2>/dev/null)" 2>/dev/null || echo starting)
    [[ $status == healthy ]] && return 0
    sleep 2
  done
  return 1
}

wait_url() {
  local i code
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$1/api/v1/openapi.json" 2>/dev/null || true)
    [[ $code == 200 ]] && return 0
    sleep 3
  done
  return 1
}

start_app() {
  run "Сборка и запуск (первый раз — 1–3 минуты)" compose up -d --build --remove-orphans --force-recreate
  run "Ожидание готовности приложения" wait_healthy
  if wait_url "$PUBLIC_URL"; then ok "Панель отвечает: $PUBLIC_URL"
  else warn "Приложение работает, но $PUBLIC_URL пока не открылся снаружи (сертификат или DNS могут появиться через минуту). Проверьте: invoice-keeper status"; fi
  docker image prune -f >>"$LOG_FILE" 2>&1 || true
}

summary() {
  local tg="не подключён — настроить: invoice-keeper config"
  local token chat; token=$(env_get TELEGRAM_BOT_TOKEN); chat=$(env_get TELEGRAM_CHAT_ID)
  if [[ -n $token && -n $chat ]]; then tg="включены${TG_BOT:+ (@$TG_BOT)}, чат $chat"
  elif [[ -n $token ]]; then tg="бот есть, чат не выбран — invoice-keeper config"; fi
  local url; url=$(env_get PUBLIC_URL)
  local password_line="пароль без изменений — показать: invoice-keeper credentials"
  [[ ${PASSWORD_SHOWN:-0} -eq 1 ]] && password_line="пароль: ${BOLD}$(env_get ADMIN_PASSWORD)${RESET}   ← сохраните его"
  local demo_line="демо-данные выключены"
  [[ $(env_get SEED_DEMO_DATA) != false ]] && demo_line="user / $(env_get DEMO_USER_PASSWORD),  accountant / $(env_get DEMO_ACCOUNTANT_PASSWORD)"
  local line="──────────────────────────────────────────────────────────────────────"
  cat <<EOF

${GREEN}${line}${RESET}
 ${BOLD}Invoice Keeper $(cat "$INSTALL_DIR/VERSION" 2>/dev/null) — ${ACTION_DONE}${RESET}
${GREEN}${line}${RESET}
  Панель         ${BOLD}${url}${RESET}
  Swagger        ${url}/api/v1/docs
  Администратор  $(env_get ADMIN_LOGIN), ${password_line}
  Пользователи   ${demo_line}
  Напоминания    ${tg}

  Управление     invoice-keeper status | logs | restart | backup | config | help
  Настройки      $INSTALL_DIR/.env
  Журнал         $LOG_FILE
${GREEN}${line}${RESET}
EOF
}

# ───────────────────────────── main ─────────────────────────────
main() {
  while (( $# )); do
    case $1 in
      --source) SOURCE=$2; shift ;;
      --yes|-y) ASSUME_YES=1 ;;
      --reconfigure) RECONFIGURE=1 ;;
      --no-ui) USE_UI=0 ;;
      *) die "Неизвестный параметр: $1 (справка: --help)" ;;
    esac
    shift
  done

  mkdir -p "$(dirname "$LOG_FILE")"; touch "$LOG_FILE"; chmod 600 "$LOG_FILE"
  log "════ Invoice Keeper ${NEW_VERSION:-} · $(basename "$0") $* ════"
  PROJECT_NAME=$(basename "$INSTALL_DIR" | tr -cd 'a-z0-9_-'); PROJECT_NAME=${PROJECT_NAME:-invoice-keeper}
  PASSWORD_SHOWN=0

  local mode current_version=""
  [[ -f $INSTALL_DIR/VERSION ]] && current_version=$(<"$INSTALL_DIR/VERSION")
  if [[ -n $SOURCE ]]; then
    [[ -f $INSTALL_DIR/.env && $RECONFIGURE -eq 0 ]] && mode=update || mode=install
  else
    [[ -f $INSTALL_DIR/.env ]] || die "Invoice Keeper не установлен в $INSTALL_DIR — запустите .run-установщик"
    mode=reconfigure
  fi

  printf '\n%s\n\n' "${BOLD}Invoice Keeper ${NEW_VERSION:-$current_version}${RESET} · папка $INSTALL_DIR"
  preflight
  load_env

  case $mode in
    install)
      ACTION_DONE=$([[ -f $INSTALL_DIR/.env ]] && echo "перенастроен и запущен" || echo "установлен и запущен")
      [[ -f $INSTALL_DIR/.env ]] || PASSWORD_SHOWN=1   # при первой установке пароль показываем один раз
      ui_msg "Добро пожаловать в установку Invoice Keeper ${NEW_VERSION}!

Invoice Keeper напоминает о регулярных платежах (аренда, серверы,
подписки) в Telegram за 3 дня до срока и показывает, что оплачено
и что просрочено.

Мастер задаст 5 вопросов, затем сам:
  • поставит Docker, если его нет;
  • запишет настройки в $INSTALL_DIR/.env;
  • соберёт и запустит приложение, включит HTTPS;
  • проверит, что всё работает."
      ensure_docker
      step_admin; step_timezone; step_address; step_telegram; step_demo; step_confirm
      backup_before_update
      run "Копирование файлов в $INSTALL_DIR" install_files
      write_env ;;
    update)
      ACTION_DONE="обновлён"
      ui_yesno "Invoice Keeper уже установлен в $INSTALL_DIR (версия ${current_version:-неизвестна}).

Обновить до версии ${NEW_VERSION}? Настройки (.env) и данные сохранятся,
перед обновлением будет сделана резервная копия базы.

Чтобы заодно поменять настройки, запустите установщик с --reconfigure." yes || cancelled
      ensure_docker
      backup_before_update      # по старой конфигурации — до замены файлов
      run "Обновление файлов в $INSTALL_DIR" install_files
      migrate_env ;;
    reconfigure)
      ACTION_DONE="перенастроен"
      ensure_docker
      step_admin; step_timezone; step_address; step_telegram; step_demo; step_confirm
      write_env ;;
  esac

  check_ports
  open_firewall
  start_app
  summary
  log "DONE $mode"
}

main "$@"
