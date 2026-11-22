#!/usr/bin/env bash
# E2E 用の環境を、この worktree の中に立てる（docs/guides/e2e-env.md）。
#   npm run e2e:up      立てる → migrate → seed → E2E ユーザー → ビルド → アプリ起動 → 待つ
#   npm run e2e:down    片付ける
#
# 接続先・ポート・PID は .e2e/state.env に書く（git 管理外）。worktree ごとに別のプロジェクト名と
# 空きポートを使うので、複数の worktree で同時に立てても衝突しない。
# E2E_DATABASE_URL と E2E_REDIS_URL が両方あるときは、compose を使わずそのサービスに接続する
# （CI の service container 用。使い捨てで、localhost / 127.0.0.1 のものだけ）。
# SKIP_BUILD=1 で、既にある .next をそのまま使う。
# 失敗・中断（Ctrl-C を含む）したときは、ログを出してから自分で片付ける。
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
STATE=.e2e/state.env

# 本番や共有の DB に向けてしまう事故を防ぐ。.e2e を作る前に、2つの URL を1つずつ判定する
if [ -n "${E2E_DATABASE_URL:-}" ] && [ -n "${E2E_REDIS_URL:-}" ]; then
  COMPOSE=0
  node scripts/e2e/assert-local.mjs "$E2E_DATABASE_URL" "$E2E_REDIS_URL"
else
  COMPOSE=1
fi

[ -f "$STATE" ] && bash scripts/e2e/down.sh
mkdir -p .e2e

READY=0
# shellcheck disable=SC2329  # trap から呼ばれる
cleanup() {
  [ "$READY" = 1 ] && return
  echo "up に失敗した。ログの末尾を出してから片付ける" >&2
  for f in build app stub; do
    [ -f ".e2e/$f.log" ] && { echo "=== .e2e/$f.log ===" >&2; tail -n 30 ".e2e/$f.log" >&2; }
  done
  bash scripts/e2e/down.sh
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

PROJECT=fishing-e2e-$(printf %s "$ROOT" | shasum | cut -c1-8)
echo "PROJECT=$PROJECT" > "$STATE"
echo "COMPOSE=$COMPOSE" >> "$STATE"

if [ "$COMPOSE" = 1 ]; then
  C=(docker compose -p "$PROJECT" -f scripts/e2e/docker-compose.yml)
  "${C[@]}" up -d --wait
  DATABASE_URL=postgresql://e2e:e2e@127.0.0.1:$("${C[@]}" port postgres 5432 | sed 's/.*://')/e2e
  REDIS_URL=redis://127.0.0.1:$("${C[@]}" port redis 6379 | sed 's/.*://')
else
  DATABASE_URL=$E2E_DATABASE_URL
  REDIS_URL=$E2E_REDIS_URL
fi

# 空きポートを OS に選ばせる（アプリとスタブ）
read -r APP_PORT STUB_PORT < <(node scripts/e2e/free-ports.mjs 2)
# アプリは localhost で名乗る。Auth.js はログイン後の転送先を localhost で作るので、127.0.0.1 だと
# Cookie が届かない（ブラウザは 127.0.0.1 と localhost を別のホストとして扱う）
APP_URL=http://localhost:$APP_PORT
{
  echo "DATABASE_URL=$DATABASE_URL"
  echo "REDIS_URL=$REDIS_URL"
  echo "APP_PORT=$APP_PORT"
  echo "STUB_PORT=$STUB_PORT"
  echo "APP_URL=$APP_URL"
  echo "STUB_URL=http://127.0.0.1:$STUB_PORT"
} >> "$STATE"

DATABASE_URL_DIRECT=$DATABASE_URL npx --no-install prisma migrate deploy > /dev/null
DATABASE_URL=$DATABASE_URL node --import tsx/esm prisma/seed.ts > /dev/null
DATABASE_URL=$DATABASE_URL node scripts/e2e/seed-users.mjs

STUB_HOST=127.0.0.1 STUB_PORT=$STUB_PORT nohup node scripts/perf/stub.mjs > .e2e/stub.log 2>&1 &
echo "STUB_PID=$!" >> "$STATE"
for _ in $(seq 1 20); do
  curl -sf "http://127.0.0.1:$STUB_PORT/__stats" > /dev/null && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$STUB_PORT/__stats" > /dev/null || { echo "スタブが起動しない" >&2; exit 1; }

AUTH_SECRET=$(node -e 'import("./scripts/e2e/users.mjs").then((m) => process.stdout.write(m.E2E_AUTH_SECRET))')
# シェルにある本物のキーが混ざらないよう、空の環境から必要な値だけを渡す。
# Google Maps のキーは既定で空（ブラウザが Google に出る経路を作らない）。読み込み失敗の画面を試すときは
# E2E_MAPS_KEY / E2E_MAPS_MAP_ID にダミーを渡す
app_env=(
  env -i "PATH=$PATH" "HOME=$HOME" NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Tokyo
  "DATABASE_URL=$DATABASE_URL" "REDIS_URL=$REDIS_URL" LOG_LEVEL=warn
  "AUTH_SECRET=$AUTH_SECRET" "AUTH_URL=$APP_URL" "NEXTAUTH_URL=$APP_URL" AUTH_TRUST_HOST=true
  AUTH_GOOGLE_ID=e2e-dummy AUTH_GOOGLE_SECRET=e2e-dummy
  OPENWEATHERMAP_API_KEY=e2e-dummy GOOGLE_MAPS_API_KEY=e2e-dummy
  RESEND_API_KEY=re_e2e_dummy EMAIL_FROM=noreply@example.test
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${E2E_MAPS_KEY:-}" "NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=${E2E_MAPS_MAP_ID:-}"
)

[ "${SKIP_BUILD:-0}" = 1 ] || "${app_env[@]}" npx --no-install next build > .e2e/build.log 2>&1

nohup "${app_env[@]}" "NODE_OPTIONS=--import $ROOT/scripts/perf/redirect-upstream.mjs" \
  "PERF_STUB_ORIGIN=http://127.0.0.1:$STUB_PORT" \
  npx --no-install next start -H localhost -p "$APP_PORT" > .e2e/app.log 2>&1 &
echo "APP_PID=$!" >> "$STATE"

# /healthz が返っても、返したのが自分のアプリとは限らない（別の worktree のアプリがそのポートにいると、
# 自分のアプリは EADDRINUSE で死んでいても、curl はそちらに届く）。ポートで待ち受けているのが、
# 自分が起動したアプリで、作業ディレクトリもこの worktree のものであることを確かめる
owns_port() {
  kill -0 "$(grep '^APP_PID=' "$STATE" | cut -d= -f2)" 2> /dev/null || return 1
  for pid in $(lsof -ti "tcp:$APP_PORT" -sTCP:LISTEN 2> /dev/null); do
    lsof -a -p "$pid" -d cwd -Fn 2> /dev/null | grep -qx "n$PWD" && return 0
  done
  return 1
}
for _ in $(seq 1 60); do
  if curl -sf "$APP_URL/healthz" > /dev/null; then
    owns_port || {
      echo "$APP_PORT で待ち受けているのが、この worktree のアプリではない（別のものがそのポートを使っている）" >&2
      lsof -nP "-iTCP:$APP_PORT" -sTCP:LISTEN >&2 2> /dev/null || echo "（lsof で待ち受けを引けなかった: $(command -v lsof || echo 'lsof が無い')）" >&2
      for pid in $(lsof -ti "tcp:$APP_PORT" -sTCP:LISTEN 2> /dev/null); do echo "pid $pid cwd: $(lsof -a -p "$pid" -d cwd -Fn 2> /dev/null | tr '\n' ' ') / PWD=$PWD" >&2; done
      exit 1
    }
    READY=1
    echo "起動した: $APP_URL （スタブのポート: ${STUB_PORT}。状態は .e2e/state.env）"
    exit 0
  fi
  sleep 1
done
echo "60 秒待ったが /healthz が返らない" >&2
exit 1
