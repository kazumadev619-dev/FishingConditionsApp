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
# E2E ユーザーとして、画面と同じ credentials のコールバックでログインする。転送先の Location を出す
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
login() {
  : > "$JAR"
  csrf=$(curl -s -c "$JAR" -b "$JAR" "$APP_URL/api/auth/csrf" | node -pe 'JSON.parse(require("fs").readFileSync(0)).csrfToken')
  curl -s -o /dev/null -D - -c "$JAR" -b "$JAR" "$APP_URL/api/auth/callback/credentials" \
    --data-urlencode "csrfToken=$csrf" --data-urlencode "email=$1" --data-urlencode "password=$2" \
    --data-urlencode "callbackUrl=$APP_URL/dashboard" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p'
}
E2E_USERS_JSON=$(node -e 'import("./scripts/e2e/users.mjs").then((m) => console.log(JSON.stringify(m.E2E_USERS)))')
field() { echo "$E2E_USERS_JSON" | node -pe "JSON.parse(require('fs').readFileSync(0)).$1"; }

counts=$(node -e '
  const pg = require("pg");
  const p = new pg.Pool({ connectionString: process.argv[1] });
  p.query("SELECT (SELECT count(*) FROM users WHERE email LIKE '"'"'e2e-%@example.test'"'"') AS u, (SELECT count(*) FROM ports) AS p")
    .then((r) => console.log(r.rows[0].u + " " + r.rows[0].p)).finally(() => p.end());' "$DATABASE_URL")
check "E2E ユーザー2人が DB にいる" "${counts% *}" 2
check "港が seed されている（736件）" "${counts#* }" 736

COOKIE=$(node scripts/e2e/session-cookie.mjs verified)
check "/healthz が 200" "$(code "$APP_URL/healthz")" 200
check "/readyz が 200（DB と Redis に届く）" "$(code "$APP_URL/readyz")" 200
check "未ログインの /api/favorites は 401" "$(code "$APP_URL/api/favorites")" 401
check "Cookie を付けた /api/favorites は 200（JWT が通る）" "$(code -H "Cookie: $COOKIE" "$APP_URL/api/favorites")" 200

# 画面と同じログインの流れ。転送先が APP_URL と同じホストで、Cookie が届くこと。
# 127.0.0.1 と localhost が混ざると、ブラウザは Cookie を送らず未ログインに戻される
loc=$(login "$(field verified.email)" "$(field verified.password)")
check "ログイン後の転送先が APP_URL と同じホスト" "$loc" "$APP_URL/dashboard"
check "ログインの Cookie で /api/favorites が 200" "$(code -b "$JAR" "$APP_URL/api/favorites")" 200

# 未確認のユーザーはログインを拒否され、確認メールがスタブに届く（実 Resend には出ない）
login "$(field unverified.email)" "$(field unverified.password)" > /dev/null
sleep 1
check "確認メールがスタブに届いた" "$(curl -s "$STUB_URL/__stats" | node -pe 'JSON.parse(require("fs").readFileSync(0)).calls.resend')" 1

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
