/**
 * 港の座標データ更新スクリプト
 * tide736.net API から座標情報を取得してDBを更新
 *
 * 使い方:
 * npx tsx scripts/update-port-coordinates.ts [--dry-run]
 */

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface TideApiResponse {
  status: number;
  message: string;
  tide: {
    port: {
      prefecture_code: string;
      harbor_code: string;
      harbor_namej: string;
      latitude: string;
      longitude: string;
    };
  };
}

/**
 * tide736.net API から座標情報を取得
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
      console.warn(
        `⚠️  API error for ${prefectureCode}-${portCode}: ${data.message}`,
      );
      return null;
    }

    const lat = parseFloat(data.tide.port.latitude);
    const lng = parseFloat(data.tide.port.longitude);

    if (isNaN(lat) || isNaN(lng)) {
      console.warn(
        `⚠️  Invalid coordinates for ${prefectureCode}-${portCode}: lat=${data.tide.port.latitude}, lng=${data.tide.port.longitude}`,
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

  console.log('🌊 Starting port coordinates update...');
  console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (no changes will be made)' : '✍️  LIVE UPDATE'}\n`);

  try {
    // 座標が未設定の港を取得
    const portsWithoutCoords = await prisma.ports.findMany({
      where: {
        OR: [{ latitude: null }, { longitude: null }],
      },
      select: {
        id: true,
        name: true,
        prefecture_code: true,
        port_code: true,
        latitude: true,
        longitude: true,
      },
    });

    console.log(`📍 Found ${portsWithoutCoords.length} ports without coordinates\n`);

    if (portsWithoutCoords.length === 0) {
      console.log('✅ All ports already have coordinates!');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (let i = 0; i < portsWithoutCoords.length; i++) {
      const port = portsWithoutCoords[i];
      const progress = `[${i + 1}/${portsWithoutCoords.length}]`;

      // 進捗表示
      process.stdout.write(`${progress} ${port.name} (${port.prefecture_code}-${port.port_code})... `);

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
        console.log(`✅ Would update: lat=${coords.latitude}, lng=${coords.longitude}`);
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
    console.log(`  Total ports: ${portsWithoutCoords.length}`);
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
