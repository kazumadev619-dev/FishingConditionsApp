#!/usr/bin/env bash
# 性能測定の実行（docs/perf/ の手順）。環境を起動した状態で 1 条件を測る。
#
#   scripts/perf/run.sh <TARGET> <MODE> [VUS] [DURATION|ITERATIONS=N] [DELAY_MS]
#   例: scripts/perf/run.sh scores uncached 10 30s 200
#
# 測る前に、この環境の Redis を空にする（前の条件のキャッシュとレート制限の数を持ち越さない）。
# Redis はこの環境専用（docker-compose.yml）で、ほかの Redis には触れない。
set -euo pipefail
cd "$(dirname "$0")"

TARGET=${1:?TARGET が要る}
MODE=${2:?MODE が要る}
VUS=${3:-10}
LEN=${4:-30s}
DELAY_MS=${5:-0}
COMPOSE=(docker compose -f docker-compose.yml -p fishing-perf)

mkdir -p out
if [ ! -f out/cookies.json ]; then
  AUTH_SECRET=perf-only-secret-not-used-anywhere-else node make-cookies.mjs out/cookies.json 2000
fi

"${COMPOSE[@]}" exec -T redis redis-cli flushall >/dev/null
env_len=(-e "DURATION=$LEN")
case "$LEN" in ITERATIONS=*) env_len=(-e "$LEN") ;; esac

# k6 が失敗したら（TARGET の綴り間違い、warm-up の失敗など）、終了コードも失敗にする
log=$(mktemp)
trap 'rm -f "$log"' EXIT
if ! "${COMPOSE[@]}" --profile tools run --rm -T --quiet-pull k6 run --quiet \
  -e TARGET="$TARGET" -e MODE="$MODE" -e VUS="$VUS" -e DELAY_MS="$DELAY_MS" -e WARMUP="${WARMUP:-1}" "${env_len[@]}" /perf/k6.js \
  >"$log" 2>&1; then
  tail -5 "$log" >&2
  exit 1
fi
grep -E 'PERF_(RESULT|STUB)' "$log"
grep -q 'PERF_RESULT' "$log" || { echo "PERF_RESULT が出ていない" >&2; exit 1; }
