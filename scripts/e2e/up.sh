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
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
STATE=.e2e/state.env

[ -f "$STATE" ] && bash scripts/e2e/down.sh
mkdir -p .e2e
trap 'echo "up に失敗した。片付ける（ログは消える前に上に出ている分を見る）" >&2; tail -20 .e2e/app.log 2>/dev/null >&2 || true; bash scripts/e2e/down.sh' ERR

PROJECT=fishing-e2e-$(printf %s "$ROOT" | shasum | cut -c1-8)
if [ -n "${E2E_DATABASE_URL:-}" ] && [ -n "${E2E_REDIS_URL:-}" ]; then COMPOSE=0; else COMPOSE=1; fi
echo "PROJECT=$PROJECT" > "$STATE"
echo "COMPOSE=$COMPOSE" >> "$STATE"

if [ "$COMPOSE" = 1 ]; then
  C=(docker compose -p "$PROJECT" -f scripts/e2e/docker-compose.yml)
  "${C[@]}" up -d --wait
  DATABASE_URL=postgresql://e2e:e2e@127.0.0.1:$("${C[@]}" port postgres 5432 | sed 's/.*://')/e2e
  REDIS_URL=redis://127.0.0.1:$("${C[@]}" port redis 6379 | sed 's/.*://')
else
  # 本番や共有の DB に向けてしまう事故を防ぐ。使い捨てのサービスだけを想定している
  case "$E2E_DATABASE_URL$E2E_REDIS_URL" in
    *@localhost[:/]*|*@127.0.0.1[:/]*|*//localhost[:/]*|*//127.0.0.1[:/]*) ;;
    *) echo "E2E_DATABASE_URL / E2E_REDIS_URL は localhost か 127.0.0.1 だけ使える" >&2; exit 2 ;;
  esac
  DATABASE_URL=$E2E_DATABASE_URL
  REDIS_URL=$E2E_REDIS_URL
fi

# 空きポートを OS に選ばせる（アプリとスタブ）
read -r APP_PORT STUB_PORT < <(node -e '
  const net = require("node:net");
  const pick = () => new Promise((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
  Promise.all([pick(), pick()]).then((p) => console.log(p.join(" ")));')
{
  echo "DATABASE_URL=$DATABASE_URL"
  echo "REDIS_URL=$REDIS_URL"
  echo "APP_PORT=$APP_PORT"
  echo "STUB_PORT=$STUB_PORT"
  echo "APP_URL=http://127.0.0.1:$APP_PORT"
  echo "STUB_URL=http://127.0.0.1:$STUB_PORT"
} >> "$STATE"

DATABASE_URL_DIRECT=$DATABASE_URL npx --no-install prisma migrate deploy > /dev/null
DATABASE_URL=$DATABASE_URL node --import tsx/esm prisma/seed.ts > /dev/null
DATABASE_URL=$DATABASE_URL node scripts/e2e/seed-users.mjs

STUB_PORT=$STUB_PORT nohup node scripts/perf/stub.mjs > .e2e/stub.log 2>&1 &
echo "STUB_PID=$!" >> "$STATE"

AUTH_SECRET=$(node -e 'import("./scripts/e2e/users.mjs").then((m) => process.stdout.write(m.E2E_AUTH_SECRET))')
# シェルにある本物のキーが混ざらないよう、空の環境から必要な値だけを渡す。
# Google Maps のキーは既定で空（ブラウザが Google に出る経路を作らない）。読み込み失敗の画面を試すときは
# E2E_MAPS_KEY / E2E_MAPS_MAP_ID にダミーを渡す
app_env=(
  env -i "PATH=$PATH" "HOME=$HOME" NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Tokyo
  "DATABASE_URL=$DATABASE_URL" "REDIS_URL=$REDIS_URL" LOG_LEVEL=warn
  "AUTH_SECRET=$AUTH_SECRET" "AUTH_URL=http://127.0.0.1:$APP_PORT" "NEXTAUTH_URL=http://127.0.0.1:$APP_PORT" AUTH_TRUST_HOST=true
  AUTH_GOOGLE_ID=e2e-dummy AUTH_GOOGLE_SECRET=e2e-dummy
  OPENWEATHERMAP_API_KEY=e2e-dummy GOOGLE_MAPS_API_KEY=e2e-dummy
  RESEND_API_KEY=re_e2e_dummy EMAIL_FROM=noreply@example.test
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${E2E_MAPS_KEY:-}" "NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=${E2E_MAPS_MAP_ID:-}"
)

[ "${SKIP_BUILD:-0}" = 1 ] || "${app_env[@]}" npx --no-install next build > .e2e/build.log 2>&1 \
  || { tail -30 .e2e/build.log >&2; exit 1; }

nohup "${app_env[@]}" "NODE_OPTIONS=--import $ROOT/scripts/perf/redirect-upstream.mjs" \
  "PERF_STUB_ORIGIN=http://127.0.0.1:$STUB_PORT" \
  npx --no-install next start -H 127.0.0.1 -p "$APP_PORT" > .e2e/app.log 2>&1 &
echo "APP_PID=$!" >> "$STATE"

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$APP_PORT/healthz" > /dev/null && { echo "起動した: http://127.0.0.1:${APP_PORT} （スタブのポート: ${STUB_PORT}。状態は .e2e/state.env）"; exit 0; }
  sleep 1
done
echo "60 秒待ったが /healthz が返らない" >&2
exit 1
