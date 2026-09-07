/**
 * 港の座標データ更新スクリプト
 * tide736.net API から座標情報を取得してDBを更新
 *
 * 使い方:
 * npx tsx scripts/update-port-coordinates.ts [--dry-run] [--only-missing]
 *
 * --dry-run      DBを更新せず差分だけ表示する
 * --only-missing 座標が未設定の港だけを対象にする（既定は全港を再取得する）
 */

import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { dmToDegrees } from '../src/lib/validators/coordinateValidator';
import type { TideApiResponse } from '../src/types/tide';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * tide736.net API から座標情報を取得し、十進度に変換して返す
 *
 * API は座標を度分形式（DD.MM）の JSON number で返す。例: 35.4 は 35度40分。
 * そのまま十進度として保存すると常に南西へ最大約44km ずれる（#71）。
 */
async function fetchCoordinates(
  prefectureCode: string,
  portCode: string,
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const today = new Date();
    const year = today.getFullYear().toString();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');

    const url = `https://tide736.net/api/get_tide.php?pc=${prefectureCode}&hc=${portCode}&yr=${year}&mn=${month}&dy=${day}&rg=day`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`⚠️  HTTP error ${response.status} for ${prefectureCode}-${portCode}`);
      return null;
    }

    const data: TideApiResponse = await response.json();

    if (data.status !== 1) {
      console.warn(`⚠️  API error for ${prefectureCode}-${portCode}: ${data.message}`);
      return null;
    }

    let lat: number;
    let lng: number;
    try {
      lat = dmToDegrees(data.tide.port.latitude);
      lng = dmToDegrees(data.tide.port.longitude);
    } catch (error) {
      console.warn(
        `⚠️  Invalid coordinates for ${prefectureCode}-${portCode}: lat=${data.tide.port.latitude}, lng=${data.tide.port.longitude} (${error instanceof Error ? error.message : error})`,
      );
      return null;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      console.warn(
        `⚠️  Coordinates out of range for ${prefectureCode}-${portCode}: lat=${lat}, lng=${lng}`,
      );
      return null;
    }

    return { latitude: lat, longitude: lng };
  } catch (error) {
    console.error(`❌ Error fetching ${prefectureCode}-${portCode}:`, error);
    return null;
  }
}

/**
 * メイン処理
 */
async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const onlyMissing = process.argv.includes('--only-missing');

  console.log('🌊 Starting port coordinates update...');
  console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (no changes will be made)' : '✍️  LIVE UPDATE'}`);
  console.log(`Target: ${onlyMissing ? '座標が未設定の港のみ' : '全港（既存の値も上書きする）'}\n`);

  try {
    // 既定は全港。座標未設定だけを対象にすると、既に誤った値が入っている港が
    // 永久に更新されない（#71 でこれが原因で誤った座標が残り続けた）。
    const targetPorts = await prisma.ports.findMany({
      where: onlyMissing ? { OR: [{ latitude: null }, { longitude: null }] } : {},
      select: {
        id: true,
        name: true,
        prefecture_code: true,
        port_code: true,
        latitude: true,
        longitude: true,
      },
    });

    console.log(`📍 Found ${targetPorts.length} ports to update\n`);

    if (targetPorts.length === 0) {
      console.log('✅ No ports to update.');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (let i = 0; i < targetPorts.length; i++) {
      const port = targetPorts[i];
      const progress = `[${i + 1}/${targetPorts.length}]`;

      // 進捗表示
      process.stdout.write(
        `${progress} ${port.name} (${port.prefecture_code}-${port.port_code})... `,
      );

      // API レート制限対策（100ms待機）
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // 座標を取得
      const coords = await fetchCoordinates(port.prefecture_code, port.port_code);

      if (!coords) {
        console.log('❌ Failed');
        failCount++;
        continue;
      }

      // DRY RUN の場合は更新をスキップ
      if (isDryRun) {
        const before =
          port.latitude === null || port.longitude === null
            ? '(未設定)'
            : `${port.latitude.toFixed(4)}, ${port.longitude.toFixed(4)}`;
        console.log(
          `✅ Would update: ${before} → ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`,
        );
        skipCount++;
        continue;
      }

      // DBを更新
      try {
        await prisma.ports.update({
          where: { id: port.id },
          data: {
            latitude: coords.latitude,
            longitude: coords.longitude,
          },
        });

        console.log(`✅ Updated: lat=${coords.latitude}, lng=${coords.longitude}`);
        successCount++;
      } catch (error) {
        console.log(`❌ DB update failed: ${error}`);
        failCount++;
      }
    }

    // サマリー
    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary:');
    console.log(`  Total ports: ${targetPorts.length}`);
    if (isDryRun) {
      console.log(`  Would update: ${skipCount}`);
      console.log(`  Would fail: ${failCount}`);
    } else {
      console.log(`  ✅ Successfully updated: ${successCount}`);
      console.log(`  ❌ Failed: ${failCount}`);
    }
    console.log('='.repeat(60));

    if (!isDryRun && successCount > 0) {
      console.log('\n✨ Coordinates update completed!');
    } else if (isDryRun) {
      console.log('\n🔍 DRY RUN completed. Run without --dry-run to apply changes.');
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

// 実行
main();
