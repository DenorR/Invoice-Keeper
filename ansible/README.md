# Invoice Keeper — развёртывание через Ansible

Роль `invoice_keeper` описывает развёртывание кодом. Один и тот же плейбук ставит приложение
на чистый сервер, обновляет версию и применяет изменённые настройки.

* Каждый сервер из inventory — **независимый экземпляр**: своя база, свой суперадмин, свой Telegram-бот.
* Повторный прогон без изменений ничего не трогает (`changed=0`).
* Мастер-установщик не запускается, вопросов нет.
* **Суперадмин задаётся только в `.env`.** Роль генерирует `.env` из переменных `ik_admin_login`
  и `ik_admin_password`; пароль хранится в Ansible Vault. Вызывать API не нужно: приложение само
  создаёт суперадмина из `.env` при запуске.

## Содержание

1. [Что делает роль](#1-что-делает-роль)
2. [Требования](#2-требования)
3. [Быстрый старт](#3-быстрый-старт)
4. [Переменные](#4-переменные)
5. [Типовые операции](#5-типовые-операции)
6. [Что получается на сервере](#6-что-получается-на-сервере)
7. [Решение проблем](#7-решение-проблем)
8. [Как проверялось](#8-как-проверялось)

---

## 1. Что делает роль

| Шаг | Что происходит | Когда считается изменением |
|---|---|---|
| Проверка параметров | понятная ошибка, если не задан пароль суперадмина, домен, ID чата и т. п. | никогда |
| Docker | ставит Docker и Compose, если их нет | только при установке |
| Файлы версии | копирует релиз `deploy-kit/invoice-keeper-<версия>.run` и распаковывает его в `/opt/invoice-keeper` | новая версия или пересобранный релиз |
| Копия перед обновлением | если приложение работает, сохраняет базу в `backups/before-update-…` | при смене версии |
| `.env` | генерирует файл целиком из переменных, права `600`, секреты в кавычках | изменились переменные |
| Образ и запуск | `docker compose build` и `up`, ждёт готовности (`--wait`) | новая версия или новый `.env` |
| Резервные копии | systemd-таймер на каждую ночь, ротация журнала | изменились юниты |
| Брандмауэр | если `ufw` включён, открывает SSH и 80/443 (или порт HTTP) | новое правило |
| Проверка | запрашивает `ПУБЛИЧНЫЙ_АДРЕС/api/v1/openapi.json`, при HTTPS ждёт сертификат | никогда |

Источник версии — тот же файл `.run`, что и для ручной установки. Его собирает `scripts/build-installer.sh`.
Роль только распаковывает его (`--extract`), поэтому раскладка на сервере та же, что после установщика.
На сервере работают все команды `invoice-keeper`: `status`, `logs`, `backup`, `restore`, `export`…

## 2. Требования

**Управляющая машина** (откуда запускается плейбук): Linux, macOS или WSL в Windows. Нужны:

* `ansible-core` 2.15 или новее. Проверено на 2.21.
* коллекции из `requirements.yml`: `community.docker` (`docker_compose_v2`) и `community.general` (`ufw`).

**Серверы:**

| Что | Требование |
|---|---|
| Система | Ubuntu 22.04 / 24.04 / 26.04 (проверено на 26.04). Debian 12 — Docker ставится из репозитория Docker (на стенде не проверялось) |
| Доступ | SSH под `root` или пользователем с `sudo` (плейбук использует `become`), Python 3 |
| Сеть | выход в интернет: Docker Hub (образы `python`, `caddy`), PyPI (зависимости при сборке), Let's Encrypt, Telegram |
| Порты | HTTPS: свободны 80 и 443. HTTP: свободен выбранный порт |

## 3. Быстрый старт

Все команды выполняются на управляющей машине, в папке `ansible/` репозитория.

> **С Windows** — в WSL (Ubuntu): `sudo apt install -y ansible`, SSH-ключ: `ssh-keygen -t ed25519`
> и `ssh-copy-id root@IP`. Скопируйте `ansible/` и `deploy-kit/` в домашнюю папку WSL
> (`cp -r /mnt/d/путь/ansible /mnt/d/путь/deploy-kit ~/invoice-keeper/`) и работайте там:
> из папок на дисках Windows (`/mnt/c`, `/mnt/d`) Ansible не читает `ansible.cfg` — они доступны всем на запись.

1. Поставьте коллекции:

   ```bash
   ansible-galaxy collection install -r requirements.yml
   ```

2. Опишите серверы. В примере три сервера: HTTPS на `IP.sslip.io`, HTTPS на своём домене, демо-стенд по HTTP.

   ```bash
   cp inventory.example.yml inventory.yml
   nano inventory.yml
   ```

3. Положите секреты в Vault:

   ```bash
   cp group_vars/invoice_keeper/vault.yml.example group_vars/invoice_keeper/vault.yml
   nano group_vars/invoice_keeper/vault.yml        # пароль суперадмина, токены ботов
   ansible-vault encrypt group_vars/invoice_keeper/vault.yml
   ```

4. Убедитесь, что в `deploy-kit/` лежит релиз `invoice-keeper-<версия>.run`. Он хранится в репозитории;
   пересобрать из текущего кода: `scripts/build-installer.sh`.

5. Разверните:

   ```bash
   ansible-playbook site.yml --ask-vault-pass
   ```

В конце для каждого сервера выводятся адрес панели, Swagger, логин суперадмина и состояние Telegram.
Пароли не выводятся. Первый прогон на чистом сервере занимает 2–4 минуты (Docker и сборка образа),
повторные — около 20 секунд.

Минимальный inventory для одного сервера:

```yaml
invoice_keeper:
  hosts:
    ik-1:
      ansible_host: 203.0.113.10
      ansible_user: root
      ik_admin_login: owner
      ik_admin_password: "{{ vault_ik_admin_password }}"
```

Панель будет на `https://203.0.113.10.sslip.io`.

## 4. Переменные

Полный список с комментариями: [`roles/invoice_keeper/defaults/main.yml`](roles/invoice_keeper/defaults/main.yml).

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `ik_admin_login` | `admin` | логин суперадмина |
| `ik_admin_password` | — | **обязательно**, от 8 символов, без `'`. Храните в Vault |
| `ik_access_mode` | `https` | `https` — Caddy + Let's Encrypt; `http` — без шифрования |
| `ik_domain` | `<IP>.sslip.io` | домен для HTTPS: свой (A-запись на сервер) или IP.sslip.io |
| `ik_http_port` | `80` | порт для `http` |
| `ik_timezone` | `Europe/Moscow` | часовой пояс сроков и напоминаний |
| `ik_telegram_bot_token` | — | токен бота. **У каждого сервера свой бот** |
| `ik_telegram_chat_id` | — | ID чата. Можно сначала раскатить с одним токеном: бот запустится и ответит на `/chatid` в группе, затем впишите ID и запустите плейбук ещё раз |
| `ik_telegram_proxy` | — | прокси для Telegram: `socks5://…` или `http://…` |
| `ik_upload_max_mb` | `10` | предельный размер файла чека, МБ (1–50) |
| `ik_reminder_days_before` | `3` | за сколько дней напоминать по умолчанию (3–365); потом меняется в панели, раздел «Настройки» |
| `ik_seed_demo_data` | `false` | загрузить демо-данные в пустую базу |
| `ik_demo_user_password`, `ik_demo_accountant_password` | — | пароли демо-пользователей, обязательны при `ik_seed_demo_data: true` |
| `ik_env_extra` | `{}` | любые другие строки `.env`: `{ LOG_LEVEL: DEBUG }` |
| `ik_install_dir` | `/opt/invoice-keeper` | папка установки. От её имени зависят проект Compose и юниты systemd |
| `ik_cli_link` | `/usr/local/bin/invoice-keeper` | команда управления на сервере |
| `ik_release` | `deploy-kit/invoice-keeper-*.run` | путь к релизу на управляющей машине |
| `ik_manage_docker` / `ik_manage_firewall` / `ik_backups` | `true` | ставить Docker, открывать порты в ufw, ночные копии |
| `ik_backup_time` | `03:00` | время ночной копии (по времени сервера) |
| `ik_ipv6` | `auto` | IPv6 в сети контейнеров: нужен, если Telegram доступен только по IPv6 |

## 5. Типовые операции

**Добавить сервер.** Допишите его в `inventory.yml` и разверните только его:

```bash
ansible-playbook site.yml --ask-vault-pass --limit ik-new
```

**Обновить версию.** Положите новый `.run` в `deploy-kit/` (старый удалите) или обновите репозиторий,
затем запустите плейбук. На каждом сервере:

1. сохраняется копия базы `before-update-…`;
2. раскладываются новые файлы, `.env` и копии не трогаются;
3. пересобирается образ, перезапускается приложение;
4. миграции базы применяются автоматически при старте.

**Изменить настройки** (пароль суперадмина, бот, часовой пояс…). Поменяйте переменную
или `ansible-vault edit group_vars/invoice_keeper/vault.yml` и запустите плейбук.
`.env` перегенерируется, контейнеры пересоздаются. Смена пароля суперадмина завершает его сессии.

**Проверить связь с серверами** (Vault нужен, потому что переменные зашифрованы):

```bash
ansible invoice_keeper -m ping --ask-vault-pass
```

**Посмотреть, что изменится, ничего не меняя** (на уже развёрнутых серверах):

```bash
ansible-playbook site.yml --ask-vault-pass --check --diff
```

Содержимое `.env` в diff не показывается, потому что в нём пароли.

**Выполнить только часть шагов:**

```bash
ansible-playbook site.yml --tags config,service     # только .env и перезапуск
```

Теги: `docker`, `release`, `config`/`service`, `backups`, `firewall`, `verify`.

**Откатить версию.** Укажите прошлый релиз и восстановите копию, сделанную перед обновлением:

```bash
ansible-playbook site.yml --ask-vault-pass --limit ik-1 -e ik_release=/путь/invoice-keeper-СТАРАЯ.run
ssh root@203.0.113.10 invoice-keeper restore /opt/invoice-keeper/backups/before-update-ДАТА.db.gz
```

**Резервные копии и перенос** выполняются на самом сервере теми же командами, что и после установщика:
`invoice-keeper backups`, `restore`, `export`, `import`. Подробно — в [`deploy-kit/README.md`](../deploy-kit/README.md), разделы 10–11.

**Несколько экземпляров на одном сервере.** Задайте каждому свой `ik_install_dir`, а также `ik_cli_link`
и порт `ik_http_port` в режиме `http`. HTTPS-экземпляр на сервере может быть только один: порты 80/443.

**Удалить экземпляр.** На сервере: `invoice-keeper uninstall --purge`. Затем уберите сервер из inventory.

> **Не меняйте `.env` на сервере вручную:** следующий прогон его перезапишет.
> Команда `invoice-keeper config` на таких серверах предупреждает об этом.

## 6. Что получается на сервере

| Путь | Что там |
|---|---|
| `/opt/invoice-keeper/` | файлы версии (из `.run`), `VERSION` |
| `/opt/invoice-keeper/.env` | настройки и секреты, сгенерированы Ansible, права `600` |
| `/opt/invoice-keeper/backups/` | резервные копии базы, права `700` |
| `/var/cache/invoice-keeper/` | скопированный релиз `.run` |
| Docker-том `invoice-keeper_ik-data` | база SQLite |
| `/etc/systemd/system/invoice-keeper-backup.{service,timer}` | ночные копии |
| `/etc/logrotate.d/invoice-keeper` | ротация журнала копий |
| `/usr/local/bin/invoice-keeper` | команда управления |

## 7. Решение проблем

| Симптом | Причина и что делать |
|---|---|
| `ik_admin_password: пароль суперадмина обязателен…` | не задан пароль или не подключён Vault: добавьте `--ask-vault-pass` |
| `Не найден релиз deploy-kit/invoice-keeper-*.run` | соберите его: `scripts/build-installer.sh`, или укажите `ik_release` |
| `Пароли, токен и прокси не должны содержать одинарную кавычку` | секреты пишутся в `.env` в одинарных кавычках: `$`, `#` и пробел можно, `'` — нельзя |
| `Запустить и дождаться готовности` упал по таймауту | на сервере: `invoice-keeper logs`. Обычно это ошибка в настройках (например, логин суперадмина совпал с логином пользователя) |
| `Панель открывается по https://…` не дождалась | закрыты 80/443 в брандмауэре хостинга или A-запись домена не указывает на сервер; журнал: `invoice-keeper logs caddy` |
| бот не отвечает, в журнале `Conflict: terminated by other getUpdates request` | этот токен запущен на другом сервере. Каждому экземпляру — свой бот |
| `community.docker.docker_compose_v2` не найден | не установлены коллекции: `ansible-galaxy collection install -r requirements.yml` |

## 8. Как проверялось

На стенде с Ubuntu 26.04, ansible-core 2.21, community.docker 5.4, community.general 13.5:

* установка с нуля: HTTP-экземпляр и HTTPS-экземпляр на одном сервере, сертификат получен,
  IPv6 в сети контейнеров включился автоматически;
* второй прогон подряд — `changed=0`;
* смена часового пояса и пароля суперадмина: старый пароль перестал работать, новый работает;
* пароль со спецсимволами (`$`, `#`, пробел) доходит до приложения без искажений;
* смена версии в обе стороны: копия `before-update` создаётся, файлы прошлой версии убираются;
* `--check --diff`: показывает будущие изменения, ничего не применяет, паролей не выводит;
* на сервере после прогона работают `invoice-keeper info`, `backup`, ночной таймер.
