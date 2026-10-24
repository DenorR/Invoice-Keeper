#!/usr/bin/env bash
# Собрать установщик, скопировать на сервер и запустить там.
#   scripts/push-to-server.sh root@203.0.113.10 [параметры установщика, например --reconfigure]
# SSH-параметры можно передать через SSH_OPTS, например SSH_OPTS="-i ~/.ssh/mykey"
set -Eeuo pipefail

HOST=${1:?укажите сервер, например root@203.0.113.10}; shift
ROOT=$(cd "$(dirname "$0")/.." && pwd)

bash "$ROOT/scripts/build-installer.sh"
RUN=$(ls -t "$ROOT"/deploy-kit/invoice-keeper-*.run | head -n 1)
NAME=$(basename "$RUN")

# shellcheck disable=SC2086
scp ${SSH_OPTS:-} "$RUN" "$HOST:/root/$NAME"
# shellcheck disable=SC2086
ssh -t ${SSH_OPTS:-} "$HOST" "bash /root/$NAME $*"
