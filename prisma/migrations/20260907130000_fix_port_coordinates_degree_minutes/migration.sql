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
-- WHERE 句の2つの条件は多重適用に対する保険である。
--   (a) 分の絶対値 < 60      … 未変換の値は必ず分 < 60 なので取りこぼしは無い
--   (b) 小数第2位までで表せる … 度分形式の値は必ず DD.MM の2桁。変換後は 1/60 が乗って
--                              割り切れなくなるため、ほぼ確実に3桁以上になる
-- 度分形式と十進度は値域が重なるため完全な判別はできない（例: 35度30分 → 35.3 → 35.5 は
-- どちらの解釈でも成立する）。多重適用を防ぐ本体はあくまで prisma の _prisma_migrations
-- による適用済み管理であり、上記は手動実行時の事故を減らすための二重防御である。

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
