#!/usr/bin/env bash
# docs/perf/ の測定条件を全部流す。結果は out/results.jsonl に 1 条件 1 行で追記する。
#   scripts/perf/matrix.sh [DURATION]    既定 20s
set -euo pipefail
cd "$(dirname "$0")"
LEN=${1:-20s}
OUT=out/results.jsonl
mkdir -p out

run() { # TARGET MODE VUS DELAY
  echo "== $*" >&2
  ./run.sh "$1" "$2" "$3" "$LEN" "$4" | tee -a "$OUT" >/dev/null
}

for vus in 1 10 50; do run floor cached "$vus" 0; done
for target in scores tide weather locations; do
  for vus in 1 10 50; do run "$target" cached "$vus" 0; done
  for delay in 0 200; do
    for vus in 1 10; do run "$target" uncached "$vus" "$delay"; done
  done
done
