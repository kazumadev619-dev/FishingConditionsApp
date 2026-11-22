#!/usr/bin/env bash
# up.sh が立てた環境を片付ける。state.env に書いた、この worktree の分だけを消す。
set -euo pipefail
cd "$(dirname "$0")/../.."
STATE=.e2e/state.env
[ -f "$STATE" ] || { echo "片付けるものがない"; exit 0; }
set -a
# shellcheck disable=SC1090
. "$STATE"
set +a

for pid in "${APP_PID:-}" "${STUB_PID:-}"; do
  [ -n "$pid" ] && kill "$pid" 2> /dev/null || true
done
# npx が子プロセスを残すことがあるので、この環境のアプリのポートで待ち受けているものも止める
[ -n "${APP_PORT:-}" ] && { lsof -ti "tcp:$APP_PORT" -sTCP:LISTEN 2> /dev/null | xargs kill 2> /dev/null || true; }

if [ "${COMPOSE:-0}" = 1 ]; then
  docker compose -p "$PROJECT" -f scripts/e2e/docker-compose.yml down -v --remove-orphans
fi
rm -rf .e2e
echo "片付けた: ${PROJECT:-}"
