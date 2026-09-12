-- #71: 港の座標が度分形式(DD.MM)のまま十進度として保存されていたのを是正する
--
-- tide736.net API は座標を度分形式で返す（例: 35.4 は 35度40分 = 35.6667度）。
-- scripts/update-port-coordinates.ts がこれを十進度としてそのまま取り込んでいたため、
-- 全736港の座標が「分 × (1/60 - 1/100)」だけ常に南西へずれていた（最大 約44km）。
--
-- 変換式: trunc(v) + round((v - trunc(v)) * 100) / 60
--   round() は浮動小数の誤差対策（0.31 * 100 が 30.999... になる）。
--   trunc() は符号を保つため、負の座標でも正しく動く。
--   float8 のまま計算すると誤差が乗るので numeric にキャストしてから計算する。
--
-- WHERE 句の2つの条件は多重適用に対する保険だが、【完全ではない】。
--   (a) 分の絶対値 < 60      … 未変換の値は必ず分 < 60 なので取りこぼしは無い
--   (b) 小数第2位までで表せる … 度分形式の値は必ず DD.MM の2桁
--
-- (b) をすり抜ける値が 1/3 ある。60 = 2^2 * 3 * 5 なので、分が3の倍数のとき 分/60 は
-- 小数2桁で終端する（0, 3, 6, ... 57 の20通り。例: 30分 → 0.5、6分 → 0.1）。
-- つまり 35.3（35度30分）は変換後 35.5 になり、これは「35度50分」としても解釈できるため
-- 再適用すると 35.8333 に壊れる。
--
-- 度分形式と十進度は値域が重なるため、値だけからの完全な判別は原理的に不可能である。
-- 多重適用を防ぐ本体はあくまで prisma の _prisma_migrations による適用済み管理であり
-- （`migrate deploy` を2回叩いても2回目は No pending migrations to apply. になる）、
-- 上記 (a)(b) は手動で psql -f した事故の被害を 2/3 程度に減らすだけの二重防御である。
-- このファイルを手で流し込んではいけない。

-- 1) locations を先に是正する。
--    ports を先に更新すると、下の EXISTS で港由来のレコードを特定できなくなる。
--    locations の座標はアプリ側で小数4桁に丸めて保存・検索しているため
--    （src/lib/validators/coordinateValidator.ts の roundCoordinate）、
--    変換後も4桁に丸めないとお気に入りの照合が一致しなくなる。
UPDATE "locations" AS l
SET
  latitude = round(
    trunc(l.latitude::numeric) + round((l.latitude::numeric - trunc(l.latitude::numeric)) * 100) / 60,
    4
  ),
  longitude = round(
    trunc(l.longitude::numeric) + round((l.longitude::numeric - trunc(l.longitude::numeric)) * 100) / 60,
    4
  )
WHERE abs(round((l.latitude::numeric - trunc(l.latitude::numeric)) * 100)) < 60
  AND abs(round((l.longitude::numeric - trunc(l.longitude::numeric)) * 100)) < 60
  AND l.latitude::numeric = round(l.latitude::numeric, 2)
  AND l.longitude::numeric = round(l.longitude::numeric, 2)
  AND (
    l.port_id IS NOT NULL
    -- port_id が付かないまま港の座標をコピーしたレコードも拾う。
    -- locationResolver は座標一致で既存 location を再利用するため、
    -- 港由来でも port_id が NULL のままになる経路がある。
    OR EXISTS (
      SELECT 1
      FROM "ports" AS p
      WHERE round(p.latitude::numeric, 4) = l.latitude::numeric
        AND round(p.longitude::numeric, 4) = l.longitude::numeric
    )
  );

-- 2) ports を是正する
UPDATE "ports"
SET
  latitude = trunc(latitude::numeric) + round((latitude::numeric - trunc(latitude::numeric)) * 100) / 60,
  longitude = trunc(longitude::numeric) + round((longitude::numeric - trunc(longitude::numeric)) * 100) / 60
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND abs(round((latitude::numeric - trunc(latitude::numeric)) * 100)) < 60
  AND abs(round((longitude::numeric - trunc(longitude::numeric)) * 100)) < 60
  AND latitude::numeric = round(latitude::numeric, 2)
  AND longitude::numeric = round(longitude::numeric, 2);

-- ---------------------------------------------------------------------------
-- 適用後の確認クエリ（実行は任意。マイグレーション本体には含まれない）
--
-- locations.port_id の FK は ON DELETE SET NULL であり、prisma/seed.ts は
-- `DELETE FROM "ports"` で港を作り直す。そのため seed を再実行すると港由来の
-- locations の port_id が NULL になり、上の EXISTS も参照先を失って
-- 変換対象から漏れる。漏れた行は座標が DD.MM のまま残る。
--
-- 下記は「まだ度分形式に見える locations」を洗い出す。件数が 0 でなければ
-- 目視で港由来かユーザー作成かを判断して個別に是正する。
--
--   SELECT id, name, latitude, longitude, port_id
--   FROM "locations"
--   WHERE latitude::numeric  = round(latitude::numeric, 2)
--     AND longitude::numeric = round(longitude::numeric, 2)
--   ORDER BY name;
-- ---------------------------------------------------------------------------
