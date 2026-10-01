#!/usr/bin/env bash
# db-seed の1段目（prisma/seed.ts）を2回流しても、港の id・座標と
# locations.port_id が保たれることを確かめる（#146）。
#
#   bash scripts/verify-seed-rerun.sh
#
# 使い捨ての PostgreSQL コンテナを立てて、終わったら消す。ローカルの
# docker compose の DB にも .env.local の接続先にも触らない。
set -euo pipefail

PORT=${PORT:-55146}
NAME=verify-seed-rerun-pg
URL=postgresql://postgres@127.0.0.1:${PORT}/app
K="prefecture_code='0' AND port_code='1'" # code.csv の2行目: 千島列島 小泊

q() { docker exec -i "$NAME" psql -U postgres -d app -qtAX -v ON_ERROR_STOP=1 -c "$1"; }
seed() { DATABASE_URL=$URL node --import tsx/esm prisma/seed.ts > /dev/null; }

docker rm -f "$NAME" > /dev/null 2>&1 || true
trap 'docker rm -f "$NAME" > /dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=app \
  -p "127.0.0.1:${PORT}:5432" postgres:17-alpine > /dev/null
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -d app -q && break; sleep 1; done

DATABASE_URL_DIRECT=$URL npx --no-install prisma migrate deploy > /dev/null
seed

# 2段目（update-port-coordinates）が座標を埋めた状態・港に紐づいた地点・
# CSV 側だけが新しい港名、の3つを作ってから流し直す
q "UPDATE ports SET latitude = 45.5, longitude = 148.5, name = '旧名' WHERE $K"
q "INSERT INTO locations (id, name, latitude, longitude, port_id) SELECT gen_random_uuid(), 'fav', 45.5, 148.5, id FROM ports WHERE $K"
before=$(q "SELECT id FROM ports WHERE $K")

seed

fail=0
check() { if [ "$2" != "$3" ]; then echo "::error::$1: got '$2' want '$3'"; fail=1; else echo "ok  $1"; fi; }
check "港の id が変わらない" "$(q "SELECT id FROM ports WHERE $K")" "$before"
check "locations.port_id が保たれる" "$(q "SELECT coalesce(port_id::text, 'NULL') FROM locations WHERE name = 'fav'")" "$before"
check "座標が保たれる" "$(q "SELECT latitude || ',' || longitude FROM ports WHERE $K")" "45.5,148.5"
check "港名は CSV に追従する" "$(q "SELECT name FROM ports WHERE $K")" "小泊"
check "港の件数が CSV と一致する" "$(q 'SELECT count(*) FROM ports')" "736"
exit $fail
