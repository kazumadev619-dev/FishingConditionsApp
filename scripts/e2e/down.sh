#!/usr/bin/env bash
# up.sh が立てた環境を片付ける。state.env に書いた、この worktree の分だけを消す。
set -euo pipefail
cd "$(dirname "$0")/../.."
STATE=.e2e/state.env
if [ -f "$STATE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$STATE"
  set +a
else
  # state.env を失っていても、プロジェクト名はパスから決まるので、コンテナは片付けられる
  PROJECT=fishing-e2e-$(printf %s "$PWD" | shasum | cut -c1-8)
  COMPOSE=1
fi

for pid in "${APP_PID:-}" "${STUB_PID:-}"; do
  [ -n "$pid" ] && kill "$pid" 2> /dev/null || true
done
# npx が子プロセスを残すことがあるので、この環境のアプリのポートで待ち受けているものも止める。
# ただしポートが別の worktree に渡っていることがあるので、作業ディレクトリがここのものだけにする
if [ -n "${APP_PORT:-}" ]; then
  for pid in $(lsof -ti "tcp:$APP_PORT" -sTCP:LISTEN 2> /dev/null || true); do
    lsof -a -p "$pid" -d cwd -Fn 2> /dev/null | grep -qx "n$PWD" && kill "$pid" 2> /dev/null || true
  done
fi

if [ "${COMPOSE:-0}" = 1 ]; then
  docker compose -p "$PROJECT" -f scripts/e2e/docker-compose.yml down -v --remove-orphans
fi
rm -rf .e2e
echo "片付けた: ${PROJECT:-}"
