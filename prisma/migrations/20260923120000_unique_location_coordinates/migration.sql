-- #151: locations を (latitude, longitude) で一意にする。
--
-- お気に入り登録の「座標で探して無ければ作る」が非アトミックで、同じ座標への同時リクエストで
-- locations が重複していた。本番に既に重複行があると unique index の作成が失敗するので、
-- 先に重複を1行へ寄せる。寄せ先は各座標で最も古い行（created_at, id の順）。
--
-- 重複が無ければ 1)〜4) はどれも 0 行の更新で終わる。index も IF [NOT] EXISTS なので、
-- 再実行しても結果は変わらない（それでも手で流さず migrate deploy に任せること）。
--
-- 丸め前の座標を持つ古い行は丸めない。値を動かすと別の行と衝突しうるうえ、アプリは
-- 丸めた値でしか検索しないので、ここで寄せなくても重複の原因にはならない。
--
-- prisma migrate deploy は文ごとに autocommit するので、自分でトランザクションに包む。
-- 包まないと途中で失敗したとき重複の削除だけが確定する。ロックは、migrate の間も動いている
-- 旧 Pod が付け替えの後に重複行へお気に入りを足し、4) の CASCADE で消えるのを防ぐ。

BEGIN;

LOCK TABLE "locations", "user_favorites", "user_settings" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE location_dupes AS
SELECT dup_id, keep_id
FROM (
  SELECT id AS dup_id,
         first_value(id) OVER (PARTITION BY latitude, longitude ORDER BY created_at, id) AS keep_id
  FROM "locations"
) AS t
WHERE dup_id <> keep_id;

-- 1) 寄せ先に port_id が無く、重複側にあるなら引き継ぐ（港との紐付けを失わない）
UPDATE "locations" AS k
SET port_id = d.port_id
FROM (
  SELECT DISTINCT ON (ld.keep_id) ld.keep_id, l.port_id
  FROM location_dupes AS ld
  JOIN "locations" AS l ON l.id = ld.dup_id
  WHERE l.port_id IS NOT NULL
  ORDER BY ld.keep_id, l.created_at, l.id
) AS d
WHERE k.id = d.keep_id
  AND k.port_id IS NULL;

-- 2) お気に入りを寄せ先へ付け替える。同じユーザーが同じ地点の複数の行を登録していると
--    (user_id, location_id) の unique に当たるので、先に最も古い1件だけ残して消す
DELETE FROM "user_favorites" AS f
USING (
  SELECT f2.id,
         row_number() OVER (
           PARTITION BY f2.user_id, COALESCE(ld.keep_id, f2.location_id)
           ORDER BY f2.created_at, f2.id
         ) AS rn
  FROM "user_favorites" AS f2
  LEFT JOIN location_dupes AS ld ON ld.dup_id = f2.location_id
) AS r
WHERE f.id = r.id
  AND r.rn > 1;

UPDATE "user_favorites" AS f
SET location_id = ld.keep_id
FROM location_dupes AS ld
WHERE f.location_id = ld.dup_id;

-- 3) default_location_id は外部キーではないが locations.id を指すので付け替える
UPDATE "user_settings" AS s
SET default_location_id = ld.keep_id
FROM location_dupes AS ld
WHERE s.default_location_id = ld.dup_id;

-- 4) 重複行を消す（参照はすべて付け替え済み）
DELETE FROM "locations" AS l
USING location_dupes AS ld
WHERE l.id = ld.dup_id;

DROP TABLE location_dupes;

-- 5) 既存の (latitude, longitude) の index を unique に置き換える
DROP INDEX IF EXISTS "locations_latitude_longitude_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "locations_latitude_longitude_key" ON "locations"("latitude", "longitude");

COMMIT;
