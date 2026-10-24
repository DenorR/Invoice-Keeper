#!/usr/bin/env bash
# Invoice Keeper — мастер установки, обновления и перенастройки.
#
#   из .run-установщика:       setup.sh --source <распакованный архив> [--yes] [--reconfigure] [--plain]
#   на настроенном сервере:    invoice-keeper config   (= setup.sh --reconfigure)
#
# Сценарии:
#   установка     — настроек ещё нет: вопросы → файлы → запуск
#   обновление    — настройки есть: резервная копия базы → новые файлы → перезапуск (.env не меняется)
#   перенастройка — вопросы с текущими значениями → новый .env → перезапуск
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/invoice-keeper}"
LOG_FILE="${LOG_FILE:-/var/log/invoice-keeper-install.log}"
CLI_LINK="${CLI_LINK:-/usr/local/bin/invoice-keeper}"
NEW_VERSION="${INSTALLER_VERSION:-}"
SOURCE=""
ASSUME_YES=0
RECONFIGURE=0
PLAIN=0
IMPORT_FILE=""
IMPORT_DB=""
# shellcheck source=backup-lib.sh
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/backup-lib.sh"

# Кириллица и символы рамок корректны только в UTF-8.
if locale -a 2>/dev/null | grep -qiE '^c\.utf-?8$'; then export LANG=C.UTF-8 LC_ALL=C.UTF-8; fi

# ═════════════════════════════ оформление ═════════════════════════════
setup_colors() {
  RESET="" BOLD="" DIM="" GRAY="" CYAN="" GREEN="" YELLOW="" RED="" WHITE="" BRAND=""
  [[ -t 1 ]] || return 0
  local colors; colors=$(tput colors 2>/dev/null || echo 0)
  (( colors >= 8 )) || return 0
  RESET=$'\e[0m' BOLD=$'\e[1m' DIM=$'\e[2m' GRAY=$'\e[90m' CYAN=$'\e[36m' GREEN=$'\e[32m' YELLOW=$'\e[33m' RED=$'\e[31m' WHITE=$'\e[97m'
  # Фирменный голубой aéza #4cc6f1: точный (24-битный) цвет, а где терминал его не умеет — ближайший из 256.
  if (( colors >= 256 )) && [[ ${TERM_PROGRAM:-} != Apple_Terminal ]]; then BRAND=$'\e[38;2;76;198;241m'
  elif (( colors >= 256 )); then BRAND=$'\e[38;5;81m'
  else BRAND=$CYAN; fi
  CYAN=$BRAND   # активные элементы мастера (◆, ❯, индикатор) — тем же цветом
}

# Интерактивный режим: живой терминал, без --yes и --plain → курсор, стрелки, анимация.
interactive() { [[ $ASSUME_YES -eq 0 && $PLAIN -eq 0 && -t 0 && -t 1 ]]; }
animated() { [[ $PLAIN -eq 0 && -t 1 ]]; }

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >>"$LOG_FILE"; }

paint_logo() {  # «лицо» букв — белым, тени — фирменным голубым
  local text=$1
  printf '%s' "${BRAND}${text//█/${WHITE}█${BRAND}}${RESET}"
}

banner() {
  # «aéza» шрифтом ANSI Shadow. Ударение — ровный косой штрих над правой частью «e».
  local -a A=("         " "         " " ██████╗ " " ╚════██╗" " ███████║" "██╔═══██║" "╚███████║" " ╚══════╝")
  local -a E=("     ██╗ " "    ██╔╝ " " ██████╗ " "██╔═══██╗" "████████║" "██╔═════╝" "╚███████╗" " ╚══════╝")
  local -a Z=("         " "         " "████████╗" "╚════██╔╝" "   ██╔═╝ " " ██╔═╝   " "████████╗" "╚═══════╝")
  local i
  echo
  for i in "${!A[@]}"; do
    printf '   %s %s %s %s\n' "$(paint_logo "${A[i]}")" "$(paint_logo "${E[i]}")" "$(paint_logo "${Z[i]}")" "$(paint_logo "${A[i]}")"
  done
  cat <<EOF

   ${BOLD}Invoice Keeper${RESET} ${DIM}— напоминания о регулярных платежах${RESET}   ${GRAY}v${NEW_VERSION:-$(cat "$INSTALL_DIR/VERSION" 2>/dev/null || echo ?)}${RESET}
   ${DIM}Аренда, серверы, подписки: бот напомнит в Telegram за 3 дня до срока,${RESET}
   ${DIM}а веб-панель покажет, что оплачено и что просрочено.${RESET}

EOF
}

BAR_CHAR="│"
bar()       { printf '%s\n' "${GRAY}${BAR_CHAR}${RESET}"; }
ui_intro()  { printf '%s  %s\n' "${GRAY}┌${RESET}" "${BOLD}$1${RESET}"; bar; }
ui_line()   { printf '%s  %s\n' "${GRAY}${BAR_CHAR}${RESET}" "$*"; }
ui_dim()    { local line; while IFS= read -r line; do printf '%s  %s\n' "${GRAY}${BAR_CHAR}${RESET}" "${DIM}${line}${RESET}"; done <<<"$1"; }
ui_section() { printf '%s  %s\n' "${GRAY}${BAR_CHAR}${RESET}" "${GRAY}── $1 ──${RESET}"; bar; }
ui_done() {  # ui_done "что сделано" ["подробности"]
  printf '%s  %s\n' "${GREEN}◇${RESET}" "$1"
  [[ -n ${2:-} ]] && ui_dim "$2"
  bar; log "OK   $1${2:+ — $2}"
}
ui_warn() { printf '%s  %s\n' "${YELLOW}▲${RESET}" "$1"; [[ -n ${2:-} ]] && ui_dim "$2"; bar; log "WARN $1 ${2:-}"; }
ui_outro() { printf '%s  %s\n\n' "${GRAY}└${RESET}" "$1"; }

die() {
  animated && tput cnorm 2>/dev/null || true
  printf '%s  %s\n' "${RED}▲${RESET}" "${RED}$1${RESET}" >&2
  [[ -n ${2:-} ]] && printf '%s  %s\n' "${GRAY}${BAR_CHAR}${RESET}" "$2" >&2
  printf '%s  %s\n\n' "${GRAY}└${RESET}" "Подробный журнал: $LOG_FILE" >&2
  log "FAIL $1 ${2:-}"
  exit 1
}
cancelled() {
  animated && tput cnorm 2>/dev/null || true
  printf '\n%s  %s\n\n' "${GRAY}└${RESET}" "Прервано. Можно запустить установщик снова — повторный запуск безопасен."
  exit 1
}
trap 'cancelled' INT

erase_lines() { (( $1 > 0 )) && printf '\e[%dA\e[J' "$1"; return 0; }
line_count() { local n=0 line; [[ -z $1 ]] && { echo 0; return; }; while IFS= read -r line; do n=$((n + 1)); done <<<"$1"; echo "$n"; }

# ─── вопросы ───
# Все функции кладут ответ в переменную по имени (не через $(…), чтобы рисовать на экране).

ask_text() {  # ask_text ПЕРЕМЕННАЯ "вопрос" "по умолчанию" ["подсказка"]
  local __var=$1 title=$2 default=${3:-} hint=${4:-} answer
  if [[ $ASSUME_YES -eq 1 ]]; then answer=$default
  elif interactive; then
    printf '%s  %s\n' "${CYAN}◆${RESET}" "${BOLD}${title}${RESET}"
    [[ -n $hint ]] && ui_dim "$hint"
    read -r -e -i "$default" -p $'\001'"${CYAN}"$'\002'"${BAR_CHAR}"$'\001'"${RESET}"$'\002'"  " answer || cancelled
    erase_lines $(( 2 + $(line_count "$hint") ))
  else
    printf '%s  %s\n' "◆" "$title"; [[ -n $hint ]] && ui_dim "$hint"
    read -r -p "${BAR_CHAR}  [${default}]: " answer || answer=""
    answer=${answer:-$default}
  fi
  ui_done "$title" "${answer:-—}"
  printf -v "$__var" '%s' "$answer"
}

ask_secret() {  # ask_secret ПЕРЕМЕННАЯ "вопрос" ["подсказка"] — ввод скрыт точками
  local __var=$1 title=$2 hint=${3:-} secret="" ch
  if interactive; then
    printf '%s  %s\n' "${CYAN}◆${RESET}" "${BOLD}${title}${RESET}"
    [[ -n $hint ]] && ui_dim "$hint"
    printf '%s  ' "${CYAN}${BAR_CHAR}${RESET}"
    while IFS= read -rsn1 ch; do
      case $ch in
        "") break ;;
        $'\x7f'|$'\b') if [[ -n $secret ]]; then secret=${secret%?}; printf '\b \b'; fi ;;
        $'\e') read -rsn2 -t 0.05 _ || true ;;
        *) secret+=$ch; printf '•' ;;
      esac
    done
    echo
    erase_lines $(( 2 + $(line_count "$hint") ))
  else
    printf '%s  %s\n' "◆" "$title"; [[ -n $hint ]] && ui_dim "$hint"
    read -r -s -p "${BAR_CHAR}  " secret || secret=""; echo
  fi
  ui_done "$title" "$([[ -n $secret ]] && echo '••••••••' || echo 'не введено')"
  printf -v "$__var" '%s' "$secret"
}

ask_select() {  # ask_select ПЕРЕМЕННАЯ "вопрос" "метка по умолчанию" метка1 "вариант1" метка2 "вариант2" …
  local __var=$1 title=$2 default=$3; shift 3
  local -a tags=() labels=()
  while (( $# )); do tags+=("$1"); labels+=("$2"); shift 2; done
  local count=${#tags[@]} index=0 i key rest
  for i in "${!tags[@]}"; do [[ ${tags[i]} == "$default" ]] && index=$i; done

  if [[ $ASSUME_YES -eq 1 ]]; then :
  elif interactive; then
    tput civis 2>/dev/null || true
    draw_select() {
      printf '%s  %s\n' "${CYAN}◆${RESET}" "${BOLD}${title}${RESET}"
      for i in "${!labels[@]}"; do
        if (( i == index )); then printf '%s  %s %s\n' "${CYAN}${BAR_CHAR}${RESET}" "${CYAN}❯ ●${RESET}" "${labels[i]}"
        else printf '%s    %s\n' "${CYAN}${BAR_CHAR}${RESET}" "${DIM}○ ${labels[i]}${RESET}"; fi
      done
      printf '%s  %s\n' "${CYAN}${BAR_CHAR}${RESET}" "${GRAY}↑↓ — выбор, Enter — подтвердить${RESET}"
    }
    draw_select
    while IFS= read -rsn1 key; do
      if [[ $key == $'\e' ]]; then read -rsn2 -t 0.05 rest || true; key+=$rest; fi
      case $key in
        $'\e[A'|k) index=$(( (index - 1 + count) % count )) ;;
        $'\e[B'|j) index=$(( (index + 1) % count )) ;;
        [1-9]) (( key <= count )) && index=$(( key - 1 )) ;;
        "") break ;;
        *) continue ;;
      esac
      erase_lines $(( count + 2 )); draw_select
    done
    erase_lines $(( count + 2 ))
    tput cnorm 2>/dev/null || true
  else
    printf '%s  %s\n' "◆" "$title"
    for i in "${!labels[@]}"; do printf '%s    %d) %s\n' "$BAR_CHAR" $(( i + 1 )) "${labels[i]}"; done
    read -r -p "${BAR_CHAR}  Номер [$(( index + 1 ))]: " key || key=""
    if [[ $key =~ ^[0-9]+$ ]] && (( key >= 1 && key <= count )); then index=$(( key - 1 )); fi
  fi
  ui_done "$title" "${labels[index]}"
  printf -v "$__var" '%s' "${tags[index]}"
}

ask_confirm() {  # ask_confirm "вопрос" [yes|no] → код 0, если «Да»
  local title=$1 default=${2:-yes} choice key rest
  choice=$([[ $default == yes ]] && echo 0 || echo 1)
  if [[ $ASSUME_YES -eq 1 ]]; then :
  elif interactive; then
    tput civis 2>/dev/null || true
    draw_confirm() {
      local yes no
      if (( choice == 0 )); then yes="${CYAN}● Да${RESET}"; no="${DIM}○ Нет${RESET}"
      else yes="${DIM}○ Да${RESET}"; no="${CYAN}● Нет${RESET}"; fi
      printf '%s  %s\n%s  %s  %s   %s\n' "${CYAN}◆${RESET}" "${BOLD}${title}${RESET}" "${CYAN}${BAR_CHAR}${RESET}" "$yes" "${GRAY}/${RESET}" "$no"
    }
    draw_confirm
    while IFS= read -rsn1 key; do
      if [[ $key == $'\e' ]]; then read -rsn2 -t 0.05 rest || true; key+=$rest; fi
      case $key in
        $'\e[D'|$'\e[C'|$'\t'|h|l) choice=$(( 1 - choice )) ;;
        y|Y|д|Д) choice=0; break ;;
        n|N|н|Н) choice=1; break ;;
        "") break ;;
        *) continue ;;
      esac
      erase_lines 2; draw_confirm
    done
    erase_lines 2
    tput cnorm 2>/dev/null || true
  else
    local hint="[Д/н]"; [[ $default == no ]] && hint="[д/Н]"
    read -r -p "◆  $title $hint " key || key=""
    key=${key,,}
    if [[ -n $key ]]; then [[ $key == д* || $key == y* ]] && choice=0 || choice=1; fi
  fi
  ui_done "$title" "$( (( choice == 0 )) && echo Да || echo Нет)"
  return $choice
}

# spin "что делаем" команда… — индикатор и время; вывод команды — в журнал.
spin() {
  local title=$1; shift
  local started=$SECONDS status=0
  log "RUN  $title: $*"
  if animated; then
    tput civis 2>/dev/null || true
    ("$@") >>"$LOG_FILE" 2>&1 &
    local pid=$! frames=(◒ ◐ ◓ ◑) i=0
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r%s  %s %s\e[K' "${CYAN}${frames[i++ % 4]}${RESET}" "$title" "${GRAY}$(( SECONDS - started )) с${RESET}"
      sleep 0.15
    done
    wait "$pid" || status=$?
    printf '\r\e[K'
    tput cnorm 2>/dev/null || true
  else
    ("$@") >>"$LOG_FILE" 2>&1 || status=$?
  fi
  if (( status != 0 )); then
    if [[ ${SPIN_SOFT:-0} == 1 ]]; then
      ui_warn "${SPIN_FAIL_TITLE:-Не удалось: $title}" "${SPIN_FAIL_NOTE:-Подробности в журнале: $LOG_FILE}"
      return 1
    fi
    die "Не удалось: $title" "Причина — в последних строках журнала: tail -n 30 $LOG_FILE"
  fi
  local took=$(( SECONDS - started )) note=${SPIN_NOTE:-готово}
  [[ -n ${SPIN_NOTE_FILE:-} && -s ${SPIN_NOTE_FILE:-} ]] && note=$(<"$SPIN_NOTE_FILE")
  ui_done "$title" "$note$( (( took >= 2 )) && printf ' за %s' "$(human_time "$took")")"
}

strip_ansi() { sed 's/\x1b\[[0-9;]*m//g' <<<"$1"; }
repeat_char() { local line; printf -v line '%*s' "$2" ''; printf '%s' "${line// /$1}"; }

ui_table() {  # ui_table "Название|Значение" … ; строка "---" — разделитель
  local row key value plain w1=0 w2=0
  for row in "$@"; do
    [[ $row == --- ]] && continue
    key=${row%%|*}; plain=$(strip_ansi "${row#*|}")
    (( ${#key} > w1 )) && w1=${#key}
    (( ${#plain} > w2 )) && w2=${#plain}
  done
  local bar_prefix="${GRAY}${BAR_CHAR}${RESET}  "
  printf '%s%s\n' "$bar_prefix" "${GRAY}┌$(repeat_char ─ $((w1 + 2)))┬$(repeat_char ─ $((w2 + 2)))┐${RESET}"
  for row in "$@"; do
    if [[ $row == --- ]]; then
      printf '%s%s\n' "$bar_prefix" "${GRAY}├$(repeat_char ─ $((w1 + 2)))┼$(repeat_char ─ $((w2 + 2)))┤${RESET}"
      continue
    fi
    key=${row%%|*}; value=${row#*|}; plain=$(strip_ansi "$value")
    printf '%s%s %s%*s %s %s%*s %s\n' "$bar_prefix" "${GRAY}│${RESET}" "$key" $((w1 - ${#key})) '' "${GRAY}│${RESET}" \
      "$value" $((w2 - ${#plain})) '' "${GRAY}│${RESET}"
  done
  printf '%s%s\n' "$bar_prefix" "${GRAY}└$(repeat_char ─ $((w1 + 2)))┴$(repeat_char ─ $((w2 + 2)))┘${RESET}"
}

human_time() { local s=$1; (( s >= 60 )) && printf '%d мин %d с' $(( s / 60 )) $(( s % 60 )) || printf '%d с' "$s"; }

# ═════════════════════════════ утилиты ═════════════════════════════
env_get() { ik_env_get "$1" "${2:-$INSTALL_DIR/.env}"; }   # env_get КЛЮЧ [файл]
env_set() { ik_env_set "$1" "$2" "$3"; }                      # env_set КЛЮЧ ЗНАЧЕНИЕ файл

gen_password() {
  local length=${1:-16}
  if command -v openssl >/dev/null; then openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-"$length"
  else head -c 200 /dev/urandom | tr -dc 'A-Za-z0-9' | cut -c1-"$length"; fi
}

detect_ip() { ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }'; }
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

# ═════════════════════════════ Telegram ═════════════════════════════
# python3 (есть в Ubuntu и Debian по умолчанию) нужен только для разбора JSON-ответов.
tg_api() {
  local token=$1 method=$2; shift 2
  curl -sS --max-time 25 "https://api.telegram.org/bot${token}/${method}" "$@" 2>/dev/null || true
}

json() {
  python3 -c "import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
$1" 2>/dev/null
}

tg_bot_name() { tg_api "$1" getMe | json 'print(d["result"]["username"] if d.get("ok") else "")'; }

tg_find_chats() {  # → строки «id<TAB>название»; код 2 — бота читает другая программа
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

save_bot_name() { local name; name=$(tg_bot_name "$1"); [[ -n $name ]] || return 1; printf 'бот @%s' "$name" >"$2"; }

tg_send() { tg_api "$1" sendMessage --data-urlencode "chat_id=$2" --data-urlencode "text=$3" | json 'sys.exit(0 if d.get("ok") else 1)'; }

# Ждёт, пока в группу напишут сообщение. Результат — в CHATS; код 0 — найден, 1 — не дождались, 2 — бот занят.
wait_for_chat() {
  local token=$1 limit=120 result_file started=$SECONDS key code=1
  result_file=$(mktemp)
  (
    while (( SECONDS - started < limit )); do
      found=""; rc=0; found=$(tg_find_chats "$token") || rc=$?
      if (( rc == 2 )); then exit 2; fi
      if [[ -n $found ]]; then printf '%s\n' "$found" >"$result_file"; exit 0; fi
      sleep 3
    done
    exit 1
  ) &
  local pid=$! frames=(◒ ◐ ◓ ◑) i=0
  if interactive; then
    tput civis 2>/dev/null || true
    while kill -0 "$pid" 2>/dev/null; do
      local elapsed=$(( SECONDS - started ))
      printf '\r%s  %s %s\e[K' "${CYAN}${frames[i++ % 4]}${RESET}" "Жду сообщение в группе" \
        "${GRAY}$(printf '%d:%02d' $(( elapsed / 60 )) $(( elapsed % 60 ))) из 2:00 · Enter — ввести ID вручную${RESET}"
      if IFS= read -rsn1 -t 0.3 key; then [[ -z $key ]] && { kill "$pid" 2>/dev/null || true; break; }; fi
    done
    printf '\r\e[K'
    tput cnorm 2>/dev/null || true
  else
    printf '%s  %s\n' "◒" "Жду сообщение в группе (до 2 минут)…"
  fi
  wait "$pid" 2>/dev/null && code=0 || code=$?
  CHATS=$(cat "$result_file" 2>/dev/null || true); rm -f "$result_file"
  [[ -n $CHATS ]] && return 0
  (( code == 2 )) && return 2
  return 1
}

# ═════════════════════════════ шаги мастера ═════════════════════════════
TOTAL_STEPS=5

# Суперадмин (единственный администратор) задаётся только в .env: мастер его не спрашивает,
# а открывает .env в редакторе. Без вопросов (--yes) он должен быть уже вписан в .env.
admin_login_ok() { [[ ${ADMIN_LOGIN:-} =~ ^[a-z0-9_.-]{3,64}$ ]]; }
admin_password_ok() { (( ${#ADMIN_PASSWORD} >= 8 )) && [[ $ADMIN_PASSWORD != change-me ]]; }

prepare_env_template() {  # .env из шаблона, если его ещё нет: туда вписывают суперадмина
  local env_file="$INSTALL_DIR/.env"
  [[ -f $env_file ]] && return 0
  mkdir -p "$INSTALL_DIR"
  cp "$SOURCE/.env.example" "$env_file"; chmod 600 "$env_file"
  env_set ADMIN_PASSWORD "" "$env_file"
  log "создан $env_file из шаблона"
}

step_admin() {
  local env_file="$INSTALL_DIR/.env" title="Шаг 1 из $TOTAL_STEPS · Суперадмин"
  ADMIN_LOGIN=${ADMIN_LOGIN,,}
  if admin_login_ok && admin_password_ok; then
    ui_done "$title" "$ADMIN_LOGIN — задан в $env_file (ADMIN_LOGIN, ADMIN_PASSWORD), через панель не меняется"
    return
  fi
  prepare_env_template
  if [[ $ASSUME_YES -eq 1 || ! -t 0 || ! -t 1 ]]; then
    die "Суперадмин не задан" "Впишите ADMIN_LOGIN и ADMIN_PASSWORD (от 8 символов) в $env_file и запустите установщик снова."
  fi
  local editor line
  editor=$(command -v nano || command -v vi || true)
  [[ -n $editor ]] || die "Не найден редактор nano или vi" "Впишите ADMIN_LOGIN и ADMIN_PASSWORD в $env_file и запустите установщик снова."

  printf '%s  %s\n' "${CYAN}◆${RESET}" "${BOLD}$title${RESET}"
  ui_line "Суперадмин — единственный администратор. Он задаётся только в файле .env:"
  ui_line "через панель и API его не создать и не изменить."
  bar
  ui_line "Сейчас откроется ${BOLD}$env_file${RESET}"
  ui_line "  1. Впишите ${BOLD}ADMIN_LOGIN${RESET} и ${BOLD}ADMIN_PASSWORD${RESET} (пароль — от 8 символов)."
  ui_line "     Если в пароле есть \$, # или пробел — возьмите его в одинарные кавычки: 'пароль'."
  ui_line "  2. Сохраните — ${BOLD}Ctrl+O${RESET}, затем Enter. Выйдите — ${BOLD}Ctrl+X${RESET}."
  bar
  while true; do
    ask_confirm "Открыть .env?" yes || cancelled
    line=$(grep -n '^ADMIN_LOGIN=' "$env_file" | head -n 1 | cut -d: -f1)
    tput cnorm 2>/dev/null || true
    "$editor" "+${line:-1}" "$env_file" </dev/tty >/dev/tty 2>&1 || true
    ADMIN_LOGIN=$(env_get ADMIN_LOGIN); ADMIN_LOGIN=${ADMIN_LOGIN,,}; ADMIN_PASSWORD=$(env_get ADMIN_PASSWORD)
    if ! admin_login_ok; then
      ui_warn "ADMIN_LOGIN не подходит: «$ADMIN_LOGIN»" "3–64 символа: строчная латиница, цифры, точка, дефис, подчёркивание."
    elif ! admin_password_ok; then
      ui_warn "ADMIN_PASSWORD не задан или короче 8 символов" "Откройте файл ещё раз и впишите пароль."
    else
      ui_done "$title" "$ADMIN_LOGIN — задан в .env; пароль на экран не выводится"
      return
    fi
  done
}

ask_new_password() {  # ask_new_password ПЕРЕМЕННАЯ "для кого" — ввод дважды, от 8 символов; на экран не выводится
  local __var=$1 title=$2 first second
  while true; do
    ask_secret first "$title" "Не короче 8 символов. На экран он не выводится — запомните его."
    if (( ${#first} < 8 )); then ui_warn "Слишком короткий пароль" "Нужно хотя бы 8 символов — введите ещё раз."; continue; fi
    ask_secret second "Повторите пароль"
    [[ $first == "$second" ]] && break
    ui_warn "Пароли не совпали" "Введите ещё раз."
  done
  printf -v "$__var" '%s' "$first"
}

step_timezone() {
  local tz
  while true; do
    ask_text tz "Шаг 2 из $TOTAL_STEPS · Часовой пояс" "${APP_TIMEZONE:-$(host_timezone)}" \
      "В нём считаются сроки и напоминания. Например: Europe/Moscow, Asia/Yekaterinburg."
    if valid_timezone "$tz"; then APP_TIMEZONE=$tz; return; fi
    [[ $ASSUME_YES -eq 1 ]] && die "Неизвестный часовой пояс: $tz"
    ui_warn "Пояс «$tz» не найден" "Проверьте написание, например Europe/Moscow."
  done
}

step_address() {
  local ip; ip=$(detect_ip)
  local default=${ACCESS_MODE:-https}
  [[ -n ${DOMAIN:-} && ${DOMAIN:-} != *.sslip.io ]] && default=domain
  if [[ -z $ip ]] || is_private_ip "$ip"; then [[ $default == https ]] && default=http; fi

  ask_select ACCESS_MODE "Шаг 3 из $TOTAL_STEPS · Адрес панели" "$default" \
    https "HTTPS · https://${ip:-IP}.sslip.io — бесплатно, сертификат получу сам" \
    domain "HTTPS · свой домен (A-запись уже указывает на этот сервер)" \
    http "HTTP · http://${ip:-IP} — без шифрования, только для проверки"

  case $ACCESS_MODE in
    https)
      [[ -n $ip ]] || die "Не удалось определить IP сервера" "Выберите свой домен или режим без HTTPS."
      DOMAIN="${ip}.sslip.io"; PUBLIC_URL="https://$DOMAIN" ;;
    domain)
      while true; do
        ask_text DOMAIN "Домен панели" "${DOMAIN:-}" "Без https://, например pay.example.ru"
        DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN%%/*}
        [[ $DOMAIN =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] && break
        [[ $ASSUME_YES -eq 1 ]] && die "Некорректный домен: $DOMAIN"
        ui_warn "«$DOMAIN» не похоже на домен" "Пример: pay.example.ru"
      done
      PUBLIC_URL="https://$DOMAIN" ;;
    http)
      DOMAIN=""
      ask_text APP_PORT "Порт панели" "${APP_PORT:-80}"
      [[ $APP_PORT =~ ^[0-9]+$ ]] && (( APP_PORT > 0 && APP_PORT < 65536 )) || APP_PORT=80
      PUBLIC_URL="http://${ip:-localhost}"; [[ $APP_PORT != 80 ]] && PUBLIC_URL="$PUBLIC_URL:$APP_PORT" ;;
  esac
}

step_telegram() {
  local title="Шаг 4 из $TOTAL_STEPS · Telegram-бот"
  if [[ $ASSUME_YES -eq 1 ]]; then
    ui_done "$title" "$([[ -n ${TG_TOKEN:-} ]] && echo "токен задан${TG_CHAT:+, чат $TG_CHAT}" || echo 'не подключён')"; return
  fi
  if ! command -v python3 >/dev/null; then
    ask_text TG_TOKEN "$title" "${TG_TOKEN:-}" "Токен бота от @BotFather (пусто — без Telegram)"
    ask_text TG_CHAT "ID чата для напоминаний" "${TG_CHAT:-}" "Бот пришлёт его в ответ на /chatid"
    return
  fi

  local choice=setup
  if [[ -n ${TG_TOKEN:-} ]]; then
    local current; current=$(tg_bot_name "$TG_TOKEN")
    ask_select choice "$title" keep \
      keep "Оставить как есть — бот ${current:+@}${current:-(не отвечает)}, чат ${TG_CHAT:-не выбран}" \
      setup "Настроить заново" \
      off "Отключить напоминания в Telegram"
  else
    ask_select choice "$title" setup \
      setup "Подключить — бот будет писать в рабочий чат за 3 дня до срока" \
      off "Пропустить — подключу позже командой invoice-keeper config"
  fi
  case $choice in
    keep) return ;;
    off) TG_TOKEN=""; TG_CHAT=""; return ;;
  esac

  # 1) токен
  local token bot
  while true; do
    ask_secret token "Токен бота" "Создайте бота у @BotFather командой /newbot и вставьте токен (вид 1234567890:AAH…)."
    token=${token//[[:space:]]/}
    if [[ -z $token ]]; then
      if ask_confirm "Токен не введён. Пропустить Telegram?" yes; then TG_TOKEN=""; TG_CHAT=""; return; fi
      continue
    fi
    local check_file; check_file=$(mktemp)
    if SPIN_SOFT=1 SPIN_NOTE_FILE="$check_file" SPIN_FAIL_TITLE="Telegram не принял токен"        SPIN_FAIL_NOTE="Проверьте токен (его выдаёт @BotFather) или связь сервера с api.telegram.org."        spin "Проверка токена" save_bot_name "$token" "$check_file"; then
      bot=$(<"$check_file"); bot=${bot#бот @}; rm -f "$check_file"; break
    fi
    rm -f "$check_file"
    ask_confirm "Ввести токен ещё раз?" yes || { TG_TOKEN=""; TG_CHAT=""; return; }
  done
  TG_TOKEN=$token; TG_BOT=$bot

  # 2) чат — находим сами по сообщению в группе
  if project_running; then compose stop app >>"$LOG_FILE" 2>&1 || true; fi   # иначе наше же приложение заберёт сообщение
  printf '%s  %s\n' "${CYAN}◆${RESET}" "${BOLD}Выберите чат для напоминаний${RESET}"
  ui_line "1. Добавьте ${BOLD}@$TG_BOT${RESET} в рабочую группу Telegram"
  ui_line "2. Напишите в этой группе любое сообщение, например /start"
  bar
  local rc=0; wait_for_chat "$TG_TOKEN" || rc=$?
  TG_CHAT="" TG_CHAT_TITLE=""
  if (( rc == 0 )); then
    local count; count=$(printf '%s\n' "$CHATS" | grep -c .)
    if (( count == 1 )); then
      TG_CHAT=$(cut -f1 <<<"$CHATS"); TG_CHAT_TITLE=$(cut -f2 <<<"$CHATS")
      ui_done "Чат найден" "$TG_CHAT_TITLE · ID $TG_CHAT"
    else
      local items=() chat_id chat_title
      while IFS=$'\t' read -r chat_id chat_title; do items+=("$chat_id" "$chat_title"); done <<<"$CHATS"
      ask_select TG_CHAT "Бот видит несколько чатов — куда присылать напоминания?" "${items[0]}" "${items[@]}"
      TG_CHAT_TITLE=$(awk -F'\t' -v id="$TG_CHAT" '$1 == id { print $2 }' <<<"$CHATS")
    fi
  else
    (( rc == 2 )) && ui_warn "Бот сейчас запущен в другом месте" "Telegram не даёт двум программам читать одного бота."
    (( rc == 1 )) && ui_warn "Сообщение не найдено" "Если бот уже работает на другом сервере, сообщения забирает он."
    ask_text TG_CHAT "ID чата" "" "Бот пришлёт его в ответ на /chatid. Пусто — настроить позже."
  fi

  # 3) пробное сообщение
  if [[ -n $TG_CHAT ]]; then
    if tg_send "$TG_TOKEN" "$TG_CHAT" "✅ Invoice Keeper подключён к этому чату. Напоминания о платежах будут приходить сюда за 3 дня до срока."; then
      ui_done "Пробное сообщение отправлено" "Проверьте Telegram — оно уже в чате."
    else
      ui_warn "Пробное сообщение не отправилось" "Проверьте, что бот добавлен в чат. Поправить: invoice-keeper config"
    fi
  fi
}

step_demo() {
  local default=yes
  [[ ${SEED_DEMO_DATA:-true} == false ]] && default=no
  local choice
  ask_select choice "Шаг 5 из $TOTAL_STEPS · Демо-данные" "$default" \
    yes "Загрузить пример — аренда в RUB, сервер в USD, подписка в EUR, просрочка, история" \
    no "Начать с пустой базы"
  SEED_DEMO_DATA=$([[ $choice == yes ]] && echo true || echo false)
  # Демо-пользователи создаются один раз, при первой загрузке демо в пустую базу.
  if [[ $SEED_DEMO_DATA == true && ${DEMO_PASSWORD_ASK:-0} == 1 ]]; then
    local demo_choice=generate demo_password
    if [[ $ASSUME_YES -eq 1 && -n ${DEMO_USER_PASSWORD:-} ]]; then return 0; fi
    [[ $ASSUME_YES -eq 1 ]] || ask_select demo_choice "Пароль демо-пользователей user и accountant" manual \
      manual "Ввести свой (один на обоих)" generate "Сгенерировать — сохраню в .env, на экран не выведу"
    if [[ $demo_choice == manual ]]; then
      ask_new_password demo_password "Пароль демо-пользователей"
    else
      demo_password=$(gen_password 12); DEMO_PASSWORD_GENERATED=1
    fi
    DEMO_USER_PASSWORD=$demo_password DEMO_ACCOUNTANT_PASSWORD=$demo_password
  fi
  return 0
}

step_confirm() {
  local tg="не подключён"
  [[ -n ${TG_TOKEN:-} ]] && tg="@${TG_BOT:-бот}${TG_CHAT:+ → ${TG_CHAT_TITLE:-чат $TG_CHAT}}"
  local data="Демо-данные|$([[ $SEED_DEMO_DATA == true ]] && echo да || echo нет)"
  [[ $mode == import ]] && data="Данные|из архива $(basename "$IMPORT_FILE")"
  printf '%s  %s\n' "${CYAN}◆${RESET}" "${BOLD}Проверьте настройки${RESET}"
  ui_table "Панель|$PUBLIC_URL" "Администратор|$ADMIN_LOGIN" "Часовой пояс|$APP_TIMEZONE" "Telegram|$tg" \
    "$data" "Папка|$INSTALL_DIR"
  bar
  ask_confirm "Всё верно, устанавливаем?" yes || cancelled
}

# ═════════════════════════════ установка ═════════════════════════════
preflight() {
  [[ $EUID -eq 0 ]] || die "Нужны права администратора" "Запустите через sudo."
  [[ $INSTALL_DIR == /* && ${#INSTALL_DIR} -gt 4 ]] || die "Странная папка установки: $INSTALL_DIR"
  local os="Linux"
  [[ -f /etc/os-release ]] && os=$(. /etc/os-release; echo "${PRETTY_NAME:-Linux}")
  local family=""
  [[ -f /etc/os-release ]] && family=$(. /etc/os-release; echo "${ID:-} ${ID_LIKE:-}")
  if ! [[ $family == *ubuntu* || $family == *debian* ]]; then
    ui_warn "Система $os не проверялась" "Нужен установленный Docker с Compose."
  fi
  if ! command -v curl >/dev/null; then
    spin "Установка curl" bash -c 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y curl'
  fi
  local ip; ip=$(detect_ip)
  local memory; memory=$(free -m 2>/dev/null | awk '/^Mem:/ { printf "%.1f ГБ", $2 / 1024 }' | tr . ,)
  ui_done "Проверка системы" "$os · IP ${ip:-не определён} · ядер: $(nproc 2>/dev/null || echo ?) · память: ${memory:-?}"
}

ensure_docker() {
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    systemctl is-active --quiet docker 2>/dev/null || systemctl start docker 2>/dev/null || true
    ui_done "Docker" "уже установлен: Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null), Compose $(docker compose version --short 2>/dev/null | cut -d+ -f1)"
    return
  fi
  command -v apt-get >/dev/null || die "Docker не найден" "Установите Docker Engine с Compose: https://docs.docker.com/engine/install/"
  ask_confirm "Docker не установлен. Установить его сейчас (пакеты из репозитория системы)?" yes || die "Без Docker установка невозможна"
  SPIN_NOTE="установлен" spin "Установка Docker" bash -c '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y docker.io
    apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin
    apt-get install -y docker-buildx || true
    systemctl enable --now docker'
  docker compose version >/dev/null 2>&1 || die "Docker Compose не установился" "Инструкция: https://docs.docker.com/engine/install/"
}

needed_ports() { if [[ $ACCESS_MODE == http ]]; then echo "$APP_PORT"; else echo "80 443"; fi; }

check_ports() {
  local port holder busy=()
  for port in $(needed_ports); do
    holder=$(ss -ltnpH "sport = :$port" 2>/dev/null | head -n 1 || true)
    [[ -z $holder ]] && continue
    if docker ps --filter "label=com.docker.compose.project=$PROJECT_NAME" --format '{{.Ports}}' 2>/dev/null | grep -qE "[:.]$port->"; then continue; fi
    busy+=("$port: $(grep -oE 'users:\(\("[^"]+' <<<"$holder" | cut -d'"' -f2)")
  done
  (( ${#busy[@]} == 0 )) || die "Порт занят другой программой — ${busy[*]}" "Освободите его или выберите режим HTTP с другим портом: invoice-keeper config"
  ui_done "Порты $(needed_ports | tr ' ' '/')" "свободны"
}

open_firewall() {
  command -v ufw >/dev/null || return 0
  ufw status 2>/dev/null | grep -q "Status: active" || return 0
  local port
  for port in 22 $(needed_ports); do ufw allow "$port/tcp" >>"$LOG_FILE" 2>&1 || true; done
  ui_done "Брандмауэр ufw" "открыты порты 22 $(needed_ports)"
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

drop_legacy_admins() {  # ADMINS из версий 1.2–1.3 больше не поддерживается: администратор один
  local env_file="$INSTALL_DIR/.env"
  if [[ ${1:-} == backup ]] && grep -qE '^ADMINS=.' "$env_file" 2>/dev/null; then
    cp -p "$env_file" "$env_file.bak-$(date +%Y%m%d-%H%M%S)"
  fi
  if ik_drop_admins "$env_file"; then
    ui_warn "Строка ADMINS удалена из .env" "Администратор в системе один — ${ADMIN_LOGIN:-$(env_get ADMIN_LOGIN)}. Дополнительные администраторы больше не входят."
  fi
  return 0
}

write_env() {
  local env_file="$INSTALL_DIR/.env"
  if [[ ! -f $env_file ]]; then cp "$INSTALL_DIR/.env.example" "$env_file"
  elif [[ ${WAS_INSTALLED:-0} -eq 1 ]]; then cp -p "$env_file" "$env_file.bak-$(date +%Y%m%d-%H%M%S)"; fi
  chmod 600 "$env_file"
  drop_legacy_admins
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
}

load_env() {  # текущие значения — как подсказки (переменные окружения важнее)
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
  if [[ -z ${ACCESS_MODE:-} && -n $DOMAIN ]]; then [[ $DOMAIN == *.sslip.io ]] && ACCESS_MODE=https || ACCESS_MODE=domain; fi
  if [[ -z ${ACCESS_MODE:-} && ${PUBLIC_URL:-} == http://* ]]; then ACCESS_MODE=http; fi   # текущий режим без HTTPS
  [[ $ADMIN_PASSWORD == change-me ]] && ADMIN_PASSWORD=""
  [[ -n ${DOMAIN:-} && -z ${PUBLIC_URL:-} ]] && PUBLIC_URL="https://$DOMAIN"
  return 0
}

migrate_env() {  # обновление: дописать ключи, которых не было в прошлых версиях
  local env_file="$INSTALL_DIR/.env"
  [[ -z ${ACCESS_MODE:-} ]] && { [[ -n ${DOMAIN:-} ]] && ACCESS_MODE=https || ACCESS_MODE=http; }
  [[ -n $(env_get COMPOSE_PROJECT_NAME) ]] || env_set COMPOSE_PROJECT_NAME "$PROJECT_NAME" "$env_file"
  drop_legacy_admins backup
  env_set COMPOSE_FILE "$(compose_files)" "$env_file"
  if [[ -z $(env_get PUBLIC_URL) ]]; then
    PUBLIC_URL=$([[ -n ${DOMAIN:-} ]] && echo "https://$DOMAIN" || echo "http://$(detect_ip)")
    env_set PUBLIC_URL "$PUBLIC_URL" "$env_file"
  fi
  APP_PORT=${APP_PORT:-80}
}

make_update_backup() {  # make_update_backup ФАЙЛ_ДЛЯ_ПОДПИСИ
  local file
  file=$(ik_backup before-update) || return 1
  ik_prune before-update 5
  printf '%s' "$file" >"$1"
}

backup_before_update() {
  project_running || return 0
  local note; note=$(mktemp)
  SPIN_SOFT=1 SPIN_NOTE_FILE="$note" SPIN_FAIL_NOTE="Продолжаю без копии. Подробности: $LOG_FILE" \
    spin "Резервная копия базы" make_update_backup "$note" || true
  rm -f "$note"
}

install_system_units() {  # ночные резервные копии (таймер systemd) и ротация журналов
  local unit="$PROJECT_NAME-backup"
  cat >"/etc/systemd/system/$unit.service" <<EOF
[Unit]
Description=Invoice Keeper: резервная копия базы
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=$INSTALL_DIR/installer/invoice-keeper backup --auto
EOF
  cat >"/etc/systemd/system/$unit.timer" <<EOF
[Unit]
Description=Invoice Keeper: резервная копия базы каждую ночь

[Timer]
OnCalendar=*-*-* 03:00:00
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload && systemctl enable --now "$unit.timer" >>"$LOG_FILE" 2>&1
  local logs="/var/log/$PROJECT_NAME-backup.log"
  [[ $PROJECT_NAME == invoice-keeper ]] && logs="$LOG_FILE $logs"
  cat >"/etc/logrotate.d/$PROJECT_NAME" <<EOF
$logs {
    monthly
    rotate 6
    compress
    missingok
    notifempty
    create 600 root root
}
EOF
  ui_done "Резервные копии по расписанию" "каждую ночь около 03:00 → $INSTALL_DIR/backups (7 ежедневных + 4 еженедельных)"
}

unpack_import() {  # расшифровать архив переноса во временную папку IMPORT_WORK
  IMPORT_WORK=$(mktemp -d)
  trap 'rm -rf "${IMPORT_WORK:-}"' EXIT
  local pass rc=0 attempt
  for attempt in 1 2 3; do
    if [[ -n ${IK_PASSPHRASE:-} ]]; then pass=$IK_PASSPHRASE
    elif [[ $ASSUME_YES -eq 1 ]]; then die "Для --import без вопросов передайте пароль архива: IK_PASSPHRASE=… bash … --import ФАЙЛ --yes"
    else ask_secret pass "Пароль архива" "Тот, что вводили при invoice-keeper export на старом сервере."
    fi
    rc=0
    SPIN_SOFT=1 SPIN_FAIL_TITLE="Архив не открылся" SPIN_FAIL_NOTE="Неверный пароль или архив повреждён." \
      spin "Расшифровка архива" ik_unpack "$IMPORT_FILE" "$pass" "$IMPORT_WORK" || rc=1
    (( rc == 0 )) && break
    [[ -n ${IK_PASSPHRASE:-} ]] && die "Неверный пароль архива или архив повреждён"
  done
  (( rc == 0 )) || die "Архив не удалось открыть" "Проверьте пароль и что файл скопирован целиком."
  local m="$IMPORT_WORK/manifest"
  ui_done "Архив" "создан $(ik_env_get created "$m") на $(ik_env_get host "$m"), версия $(ik_env_get version "$m"), адрес был $(ik_env_get url "$m")"
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

check_url() {
  local i code
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$PUBLIC_URL/api/v1/openapi.json" 2>/dev/null || true)
    [[ $code == 200 ]] && return 0
    sleep 3
  done
  return 1
}

start_app() {
  ui_section "Установка"
  SPIN_NOTE="образ собран, контейнеры запущены" spin "Сборка и запуск" compose up -d --build --remove-orphans --force-recreate
  SPIN_NOTE="приложение отвечает" spin "Проверка приложения" wait_healthy
  if animated; then
    local note="адрес открывается снаружи"; [[ $ACCESS_MODE != http ]] && note="HTTPS-сертификат получен, адрес открывается"
    if check_url >>"$LOG_FILE" 2>&1; then ui_done "Проверка адреса $PUBLIC_URL" "$note"
    else ui_warn "Адрес $PUBLIC_URL пока не открылся" "Сертификат или DNS могут появиться через минуту. Проверьте: invoice-keeper status"; fi
  else
    check_url && ui_done "Проверка адреса $PUBLIC_URL" "открывается" || ui_warn "Адрес $PUBLIC_URL пока не открылся" "Проверьте позже: invoice-keeper status"
  fi
  docker image prune -f >>"$LOG_FILE" 2>&1 || true
}

summary() {
  local url token chat tg
  url=$(env_get PUBLIC_URL); token=$(env_get TELEGRAM_BOT_TOKEN); chat=$(env_get TELEGRAM_CHAT_ID)
  if [[ -n $token && -n $chat ]]; then tg="включены${TG_BOT:+, @$TG_BOT}${TG_CHAT_TITLE:+ → $TG_CHAT_TITLE}"
  elif [[ -n $token ]]; then tg="бот подключён, чат не выбран — invoice-keeper config"
  else tg="Telegram не подключён — invoice-keeper config"; fi
  local users="демо-данные выключены"
  [[ $(env_get SEED_DEMO_DATA) != false ]] && users="user, accountant (демо)"

  printf '%s  %s\n' "${GREEN}◆${RESET}" "${BOLD}${GREEN}Invoice Keeper $(cat "$INSTALL_DIR/VERSION" 2>/dev/null) — ${ACTION_DONE}${RESET}"
  bar
  local rows=("Панель|${BOLD}${url}${RESET}" "Swagger|${url}/api/v1/docs" "Администратор|$(env_get ADMIN_LOGIN)" "Пользователи|$users"
              "Напоминания|$tg" ---)
  [[ ${DEMO_PASSWORD_GENERATED:-0} == 1 ]] && rows+=("Пароль демо|grep ^DEMO_ $INSTALL_DIR/.env")
  rows+=("Резервные копии|каждую ночь → $INSTALL_DIR/backups" "Настройки|$INSTALL_DIR/.env" "Журнал установки|$LOG_FILE")
  ui_table "${rows[@]}"
  bar
  ui_line "${BOLD}Управление сервером${RESET}"
  ui_table "invoice-keeper status|состояние и проверка панели" "invoice-keeper logs|журнал приложения" \
    "invoice-keeper config|изменить настройки" \
    "invoice-keeper backups|резервные копии и перенос" \
    "invoice-keeper help|все команды"
  bar
  ui_dim "Пароли на экран не выводятся. Суперадмин — в $INSTALL_DIR/.env (ADMIN_LOGIN, ADMIN_PASSWORD);"
  ui_dim "сменить: nano $INSTALL_DIR/.env → invoice-keeper restart."
  ui_outro "Готово! Откройте панель в браузере."
}

# ═════════════════════════════ main ═════════════════════════════
main() {
  while (( $# )); do
    case $1 in
      --source) SOURCE=$2; shift ;;
      --yes|-y) ASSUME_YES=1 ;;
      --reconfigure) RECONFIGURE=1 ;;
      --plain|--no-ui) PLAIN=1 ;;
      --import) IMPORT_FILE=$(readlink -f "${2:-}"); shift ;;
      *) echo "Неизвестный параметр: $1 (справка: --help)" >&2; exit 1 ;;
    esac
    shift
  done

  setup_colors
  mkdir -p "$(dirname "$LOG_FILE")"; touch "$LOG_FILE"; chmod 600 "$LOG_FILE"
  log "════ Invoice Keeper ${NEW_VERSION:-} · $(basename "$0") $* ════"
  PROJECT_NAME=$(basename "$INSTALL_DIR" | tr -cd 'a-z0-9_-'); PROJECT_NAME=${PROJECT_NAME:-invoice-keeper}

  local mode current_version=""
  WAS_INSTALLED=0; [[ -f $INSTALL_DIR/.env && -f $INSTALL_DIR/VERSION ]] && WAS_INSTALLED=1
  [[ -f $INSTALL_DIR/VERSION ]] && current_version=$(<"$INSTALL_DIR/VERSION")
  if [[ -n $IMPORT_FILE ]]; then
    [[ -n $SOURCE ]] || { echo "--import работает только из .run-установщика" >&2; exit 1; }
    [[ -f $IMPORT_FILE ]] || { echo "Архив не найден: $IMPORT_FILE" >&2; exit 1; }
    if [[ $WAS_INSTALLED -eq 1 ]]; then
      echo "Здесь уже установлен Invoice Keeper. Чтобы восстановить данные из архива: invoice-keeper import $IMPORT_FILE" >&2; exit 1
    fi
    mode=import
  elif [[ -n $SOURCE ]]; then
    [[ $WAS_INSTALLED -eq 1 && $RECONFIGURE -eq 0 ]] && mode=update || mode=install
  else
    [[ -f $INSTALL_DIR/.env ]] || { echo "Invoice Keeper не установлен в $INSTALL_DIR — запустите .run-установщик" >&2; exit 1; }
    mode=reconfigure
  fi

  banner
  case $mode in
    install) [[ $WAS_INSTALLED -eq 1 ]] && ui_intro "Перенастройка и переустановка · $INSTALL_DIR" || ui_intro "Установка · $INSTALL_DIR" ;;
    update) ui_intro "Обновление ${current_version:+$current_version → }${NEW_VERSION} · $INSTALL_DIR" ;;
    import) ui_intro "Перенос из архива $(basename "$IMPORT_FILE") · $INSTALL_DIR" ;;
    reconfigure) ui_intro "Изменение настроек · $INSTALL_DIR" ;;
  esac

  preflight
  load_env

  case $mode in
    install)
      ACTION_DONE=$([[ $WAS_INSTALLED -eq 1 ]] && echo "перенастроен и запущен" || echo "установлен и запущен")
      ensure_docker
      ui_section "Настройка: $TOTAL_STEPS вопросов"
      [[ $WAS_INSTALLED -eq 1 ]] || DEMO_PASSWORD_ASK=1   # новая база — спросим пароль демо-пользователей
      step_admin; step_timezone; step_address; step_telegram; step_demo; step_confirm
      ui_section "Подготовка"
      backup_before_update
      SPIN_NOTE="$INSTALL_DIR" spin "Копирование файлов" install_files
      write_env; ui_done "Настройки записаны" "$INSTALL_DIR/.env (доступ только у root)" ;;
    update)
      ACTION_DONE="обновлён"
      ask_confirm "Обновить до ${NEW_VERSION}? Настройки и данные сохранятся, базу сначала скопирую" yes || cancelled
      ensure_docker
      ui_section "Подготовка"
      backup_before_update      # по старой конфигурации — до замены файлов
      SPIN_NOTE="$INSTALL_DIR" spin "Обновление файлов" install_files
      migrate_env ;;
    import)
      ACTION_DONE="перенесён из архива и запущен"
      ensure_docker
      ui_section "Перенос из архива"
      unpack_import
      mkdir -p "$INSTALL_DIR"
      cp "$IMPORT_WORK/env" "$INSTALL_DIR/.env"; chmod 600 "$INSTALL_DIR/.env"
      for key in "${IK_SERVER_KEYS[@]}"; do ik_env_set "$key" "" "$INSTALL_DIR/.env"; done   # адрес — заново, IP другой
      load_env
      ui_done "Настройки из архива" "администратор $ADMIN_LOGIN, часовой пояс $APP_TIMEZONE, Telegram $([[ -n $TG_TOKEN ]] && echo подключён || echo нет)"
      step_address; step_confirm
      ui_section "Подготовка"
      SPIN_NOTE="$INSTALL_DIR" spin "Копирование файлов" install_files
      write_env; ui_done "Настройки записаны" "$INSTALL_DIR/.env — из архива, адрес этого сервера"
      IMPORT_DB="$IMPORT_WORK/invoice-keeper.db" ;;
    reconfigure)
      ACTION_DONE="перенастроен"
      ensure_docker
      ui_section "Настройка: $TOTAL_STEPS вопросов"
      step_admin; step_timezone; step_address; step_telegram; step_demo; step_confirm
      ui_section "Подготовка"
      write_env; ui_done "Настройки записаны" "$INSTALL_DIR/.env (старые — в .env.bak-*)" ;;
  esac

  check_ports
  open_firewall
  install_system_units
  if [[ -n $IMPORT_DB ]]; then
    SPIN_NOTE="образ готов" spin "Сборка образа" compose build
    SPIN_NOTE="платежи, история оплат, пользователи и журнал действий" spin "Перенос базы" ik_restore_db "$IMPORT_DB"
  fi
  start_app
  summary
  [[ $mode == import ]] && printf '%s  %s\n\n' "${YELLOW}▲${RESET}" "Если старый сервер ещё работает, остановите его (invoice-keeper stop): один Telegram-бот не может работать в двух местах."
  log "DONE $mode"
}

main "$@"
