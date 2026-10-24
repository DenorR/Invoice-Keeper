# Invoice Keeper — общие функции резервного копирования и переноса.
# Подключается командой invoice-keeper и установщиком (source). У вызывающего скрипта должны быть
# переменная INSTALL_DIR и функция compose() (docker compose в папке установки).
#
# Копии:   $INSTALL_DIR/backups/<тип>-ГГГГММДД-ЧЧММСС.db.gz   (папка и файлы — только root)
# Архив:   *.ikb — tar.gz (база + .env + версия + описание), зашифрованный паролем (GnuPG, AES-256)

IK_SERVER_KEYS=(PUBLIC_URL DOMAIN APP_PORT COOKIE_SECURE COMPOSE_FILE COMPOSE_PROJECT_NAME)

ik_env_get() {  # ik_env_get КЛЮЧ ФАЙЛ
  [[ -f $2 ]] || return 0
  grep -E "^$1=" "$2" | tail -n 1 | cut -d= -f2- || true
}

ik_env_set() {  # ik_env_set КЛЮЧ ЗНАЧЕНИЕ ФАЙЛ
  if grep -qE "^$1=" "$3"; then
    KEY="$1" VALUE="$2" awk -F= '$1 == ENVIRON["KEY"] { print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; next } { print }' \
      "$3" >"$3.tmp" && cat "$3.tmp" >"$3" && rm -f "$3.tmp"
  else
    printf '%s=%s\n' "$1" "$2" >>"$3"
  fi
}

ik_drop_admins() {  # ik_drop_admins ФАЙЛ — убрать ADMINS (версии 1.2–1.3); код 0, если строка была
  grep -qE '^ADMINS=.' "$1" 2>/dev/null || { sed -i '/^ADMINS=/d' "$1" 2>/dev/null; return 1; }
  sed -i '/^ADMINS=/d' "$1"
}

ik_backup_dir() {
  local dir="$INSTALL_DIR/backups"
  mkdir -p "$dir" && chmod 700 "$dir"
  printf '%s' "$dir"
}

ik_kind_label() {
  case $1 in
    daily) echo "ежедневная" ;;
    weekly) echo "еженедельная" ;;
    manual) echo "вручную" ;;
    before-update) echo "перед обновлением" ;;
    before-restore) echo "перед восстановлением" ;;
    before-import) echo "перед импортом" ;;
    *) echo "$1" ;;
  esac
}

# Согласованная копия базы из работающего приложения (без остановки) и проверка её целостности.
ik_snapshot_db() {  # ik_snapshot_db ФАЙЛ.db
  local out=$1
  compose exec -T app python - <<'PY' || return 1
import sqlite3
src = sqlite3.connect("/app/data/invoice-keeper.db")
dst = sqlite3.connect("/app/data/.snapshot.db")
src.backup(dst)
ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
dst.close()
raise SystemExit(0 if ok == "ok" else 1)
PY
  compose cp app:/app/data/.snapshot.db "$out" >/dev/null 2>&1 || return 1
  compose exec -T app rm -f /app/data/.snapshot.db >/dev/null 2>&1 || true
  chmod 600 "$out"
}

# Проверка файла базы на сервере: целостность и что это действительно база Invoice Keeper.
ik_check_db() {  # ik_check_db ФАЙЛ.db
  python3 - "$1" <<'PY'
import sqlite3, sys
try:
    db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
    ok = db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    ours = db.execute("SELECT count(*) FROM sqlite_master WHERE name = 'payment_occurrences'").fetchone()[0] == 1
except Exception:
    sys.exit(1)
sys.exit(0 if ok and ours else 1)
PY
}

ik_backup() {  # ik_backup ТИП → печатает путь к новой копии .db.gz
  local kind=$1 dir stamp tmp out
  dir=$(ik_backup_dir); stamp=$(date +%Y%m%d-%H%M%S)
  tmp="$dir/.tmp-$stamp.db"
  if ! ik_snapshot_db "$tmp"; then rm -f "$tmp"; return 1; fi
  out="$dir/$kind-$stamp.db.gz"
  gzip -c "$tmp" >"$out" && rm -f "$tmp"
  chmod 600 "$out"
  printf '%s' "$out"
}

ik_prune() {  # ik_prune ТИП СКОЛЬКО_ОСТАВИТЬ
  local file count=0
  while IFS= read -r file; do
    count=$((count + 1))
    (( count > $2 )) && rm -f "$file"
  done < <(ls -1t "$(ik_backup_dir)/$1"-*.db.gz 2>/dev/null)
  return 0
}

ik_latest_backup() { ls -1t "$(ik_backup_dir)"/*.db.gz 2>/dev/null | head -n 1; }

# Положить базу в том приложения. Приложение при этом должно быть остановлено.
ik_restore_db() {  # ik_restore_db ФАЙЛ(.db | .db.gz)
  local src=$1 tmp rc=0
  tmp=$(mktemp /tmp/ik-restore.XXXXXX)
  if [[ $src == *.gz ]]; then gzip -dc "$src" >"$tmp" || { rm -f "$tmp"; return 1; }; else cp "$src" "$tmp"; fi
  if ! ik_check_db "$tmp"; then rm -f "$tmp"; return 2; fi
  compose run --rm --no-deps -u root -v "$tmp:/restore.db:ro" --entrypoint sh app -c \
    'cp /restore.db /app/data/invoice-keeper.db && rm -f /app/data/invoice-keeper.db-wal /app/data/invoice-keeper.db-shm && chown 1000:1000 /app/data/invoice-keeper.db && chmod 600 /app/data/invoice-keeper.db' \
    >/dev/null 2>&1 || rc=1
  rm -f "$tmp"
  return $rc
}

# ─── шифрованный архив для переноса ───
ik_gpg() {  # отдельный временный каталог ключей — keyring root не трогаем
  local home rc=0
  home=$(mktemp -d)
  GNUPGHOME=$home gpg --batch --yes --quiet --pinentry-mode loopback "$@" || rc=$?
  rm -rf "$home"
  return $rc
}

ik_ensure_gpg() {
  command -v gpg >/dev/null && return 0
  DEBIAN_FRONTEND=noninteractive apt-get install -y gnupg >/dev/null 2>&1
}

ik_export() {  # ik_export ВЫХОДНОЙ_ФАЙЛ ПАРОЛЬ
  local out=$1 pass=$2 work rc=0
  ik_ensure_gpg || return 1
  work=$(mktemp -d)
  if ! ik_snapshot_db "$work/invoice-keeper.db"; then rm -rf "$work"; return 1; fi
  cp "$INSTALL_DIR/.env" "$work/env"
  cp "$INSTALL_DIR/VERSION" "$work/VERSION"
  printf 'created=%s\nhost=%s\nversion=%s\nurl=%s\n' "$(date '+%d.%m.%Y %H:%M')" "$(hostname)" \
    "$(cat "$INSTALL_DIR/VERSION")" "$(ik_env_get PUBLIC_URL "$INSTALL_DIR/.env")" >"$work/manifest"
  tar -C "$work" -czf "$work/bundle.tar.gz" invoice-keeper.db env VERSION manifest || rc=1
  if (( rc == 0 )); then
    ik_gpg --passphrase-fd 3 --symmetric --cipher-algo AES256 -o "$out" "$work/bundle.tar.gz" 3<<<"$pass" || rc=1
  fi
  rm -rf "$work"
  [[ -f $out ]] && chmod 600 "$out"
  return $rc
}

ik_unpack() {  # ik_unpack АРХИВ ПАРОЛЬ ПАПКА → код 0; 3 — неверный пароль; 4 — повреждённый архив
  local file=$1 pass=$2 dest=$3
  ik_ensure_gpg || return 4
  ik_gpg --passphrase-fd 3 -o "$dest/bundle.tar.gz" -d "$file" 3<<<"$pass" 2>/dev/null || return 3
  tar -C "$dest" -xzf "$dest/bundle.tar.gz" 2>/dev/null || return 4
  rm -f "$dest/bundle.tar.gz"
  [[ -f $dest/invoice-keeper.db && -f $dest/env ]] || return 4
  ik_check_db "$dest/invoice-keeper.db" || return 4
  chmod 600 "$dest"/*
}

# Заменить .env импортированным, сохранив адрес и состав сервисов этого сервера.
ik_merge_env() {  # ik_merge_env ИМПОРТИРОВАННЫЙ_ENV
  local imported=$1 current="$INSTALL_DIR/.env" merged key
  merged=$(mktemp)
  cp "$imported" "$merged"
  ik_drop_admins "$merged" || true   # администратор один — ADMIN_LOGIN
  for key in "${IK_SERVER_KEYS[@]}"; do ik_env_set "$key" "$(ik_env_get "$key" "$current")" "$merged"; done
  cp -p "$current" "$current.bak-$(date +%Y%m%d-%H%M%S)"
  cat "$merged" >"$current"
  rm -f "$merged"
  chmod 600 "$current"
}
