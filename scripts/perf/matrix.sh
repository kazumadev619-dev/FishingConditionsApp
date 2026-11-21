#!/usr/bin/env bash
# docs/perf/ の測定条件を全部流す。結果は out/results.jsonl に 1 条件 1 行で追記する。
#   scripts/perf/matrix.sh [DURATION]    既定 20s
# 結果は追記される。測り直すときは先に out/results.jsonl を消す。
set -euo pipefail
cd "$(dirname "$0")"
LEN=${1:-20s}
OUT=out/results.jsonl
mkdir -p out

run() { # TARGET MODE VUS DELAY
  echo "== $*" >&2
  ./run.sh "$1" "$2" "$3" "$LEN" "$4" | tee -a "$OUT" >/dev/null
}

# 最初の条件がプロセスの温め（JIT・ルートの初回読み込み）に左右されないよう、結果に入れずに先に流す
for target in floor scores tide weather locations; do
  ./run.sh "$target" cached 10 5s 0 >/dev/null
done

for vus in 1 10 50; do run floor cached "$vus" 0; done
for target in scores tide weather locations; do
  for vus in 1 10 50; do run "$target" cached "$vus" 0; done
  for delay in 0 200; do
    for vus in 1 10; do run "$target" uncached "$vus" "$delay"; done
  done
done
