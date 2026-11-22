#!/usr/bin/env bash
# 立ち上がった E2E 環境が正しいかを確かめる（npm run e2e:smoke。CI の e2e-env ジョブも使う）。
# 外部の実 API・実 Resend に出ていないことも、ここで確かめる。
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .e2e/state.env ] || { echo "先に npm run e2e:up" >&2; exit 2; }
set -a
# shellcheck disable=SC1091
. .e2e/state.env
set +a

fail=0
check() { if [ "$2" != "$3" ]; then echo "NG  $1: got '$2' want '$3'"; fail=1; else echo "ok  $1"; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

COOKIE=$(node scripts/e2e/session-cookie.mjs verified)

users=$(node -e '
  const pg = require("pg");
  const p = new pg.Pool({ connectionString: process.argv[1] });
  p.query("SELECT count(*) FROM users WHERE email LIKE '"'"'e2e-%@example.test'"'"'").then((r) => console.log(r.rows[0].count)).finally(() => p.end());' "$DATABASE_URL")
ports=$(node -e '
  const pg = require("pg");
  const p = new pg.Pool({ connectionString: process.argv[1] });
  p.query("SELECT count(*) FROM ports").then((r) => console.log(r.rows[0].count)).finally(() => p.end());' "$DATABASE_URL")
check "E2E ユーザー2人が DB にいる" "$users" 2
check "港が seed されている（736件）" "$ports" 736
check "/healthz が 200" "$(code "$APP_URL/healthz")" 200
check "/readyz が 200（DB と Redis に届く）" "$(code "$APP_URL/readyz")" 200
check "未ログインの /api/favorites は 401" "$(code "$APP_URL/api/favorites")" 401
check "ログイン済みの /api/favorites は 200（DB のユーザーで通る）" "$(code -H "Cookie: $COOKIE" "$APP_URL/api/favorites")" 200
# スコアは天気（OpenWeatherMap）と潮（tide736）を呼ぶ。スタブだけに届くことを呼び出し回数で見る
TODAY=$(TZ=Asia/Tokyo date +%F)
check "/api/scores が 200" "$(code -H "Cookie: $COOKIE" "$APP_URL/api/scores?lat=35.6762&lon=139.6503&prefectureCode=13&portCode=1&date=$TODAY")" 200
stats=$(curl -s "$STUB_URL/__stats")
check "天気の上流がスタブに届いた" "$(echo "$stats" | node -pe 'JSON.parse(require("fs").readFileSync(0)).calls.openweather > 0')" true
check "潮の上流がスタブに届いた" "$(echo "$stats" | node -pe 'JSON.parse(require("fs").readFileSync(0)).calls.tide736 > 0')" true
# 向け替え対象外のホストへの fetch は、その場で失敗する（実 API・実 Resend には出られない）
# 届くはずの宛先（スタブ自身。ただし向け替え対象のホストではない）で試す。止まらなければ REACHED になる
out=$(NODE_OPTIONS="--import $PWD/scripts/perf/redirect-upstream.mjs" PERF_STUB_ORIGIN=$STUB_URL node -e "fetch('$STUB_URL/__stats').then(() => console.log('REACHED'), () => console.log('BLOCKED'))")
check "想定外のホストへの fetch は止まる" "$out" BLOCKED

exit $fail
