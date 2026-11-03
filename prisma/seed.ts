import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { PrismaClient } from '../src/generated/prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * CSV行をパースしてオブジェクトに変換
 */
function parsePortsCSV(csvContent: string): Array<{
  prefecture_code: string;
  prefecture_name: string;
  port_code: string;
  name: string;
}> {
  const lines = csvContent.split('\n').filter((line) => line.trim());
  // ヘッダーをスキップ（最初の行）
  const dataLines = lines.slice(1);

  return dataLines.map((line) => {
    const [prefectureCode, portCode, prefectureName, portName] = line.split(',');
    return {
      prefecture_code: prefectureCode?.trim() || '',
      prefecture_name: prefectureName?.trim() || '',
      port_code: portCode?.trim() || '',
      name: portName?.trim() || '',
    };
  });
}

/**
 * 座標CSV（県コード,港コード,緯度,経度）を「県コード,港コード」→ 座標 の Map にする。
 * 数値は SQL に直接埋め込むので、数値でない行は弾く。
 */
function parseCoordinatesCSV(csvContent: string): Map<string, { lat: number; lng: number }> {
  const map = new Map<string, { lat: number; lng: number }>();
  for (const line of csvContent
    .split('\n')
    .filter((l) => l.trim())
    .slice(1)) {
    const [pref, port, lat, lng] = line.split(',').map((v) => v.trim());
    const la = Number(lat);
    const lo = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) {
      throw new Error(`座標が数値ではありません: ${line}`);
    }
    map.set(`${pref},${port}`, { lat: la, lng: lo });
  }
  return map;
}

/**
 * 港マスタデータをデータベースに投入
 */
async function seedPorts() {
  console.log('🌊 Seeding ports data...');

  try {
    // code.csv を読み込む
    const csvPath = path.join(__dirname, '../code.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');

    const ports = parsePortsCSV(csvContent);
    console.log(`📍 Found ${ports.length} ports in CSV`);

    // 座標は tide736.net から取らず、prisma/data/port-coordinates.csv を正とする（#345）
    const coords = parseCoordinatesCSV(
      fs.readFileSync(path.join(__dirname, 'data/port-coordinates.csv'), 'utf-8'),
    );

    // Prisma クライアントが正常に初期化されているか確認
    console.log('🔍 Prisma client:', typeof prisma, Object.keys(prisma).slice(0, 5));

    // ports テーブルに一括 upsert（SQL INSERT を使用）
    // 既存の港は消さずに id を保つ。座標は CSV の値で上書きする。消して作り直すと locations.port_id の
    // FK（ON DELETE SET NULL）で地点との紐づけが静かに切れる（#146）。
    // CSV から消えた港は残る。消すと同じ理由で紐づけが切れるため。
    // 確認: bash scripts/verify-seed-rerun.sh
    // SQL injection 対策：シングルクォートをエスケープ
    const escapeSql = (str: string): string => str.replace(/'/g, "''");

    const valuesList = ports
      .map((port) => {
        const c = coords.get(`${port.prefecture_code},${port.port_code}`);
        if (!c) {
          throw new Error(
            `座標がありません: ${port.prefecture_code}-${port.port_code} ${port.name}`,
          );
        }
        return `('${randomUUID()}', '${escapeSql(port.prefecture_code)}', '${escapeSql(port.prefecture_name)}', '${escapeSql(port.port_code)}', '${escapeSql(port.name)}', ${c.lat}, ${c.lng}, now())`;
      })
      .join(', ');

    const insertQuery = `
      INSERT INTO "ports" (id, prefecture_code, prefecture_name, port_code, name, latitude, longitude, created_at)
      VALUES ${valuesList}
      ON CONFLICT (prefecture_code, port_code)
        DO UPDATE SET name = EXCLUDED.name, prefecture_name = EXCLUDED.prefecture_name,
          latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
    `;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (prisma as any).$executeRawUnsafe(insertQuery);
      console.log(`✅ Upserted ${ports.length} ports (affected: ${result} rows)`);
    } catch (error) {
      console.error('❌ Error inserting ports:', error);
      throw error;
    }
  } catch (error) {
    console.error('❌ Error seeding ports:', error);
    throw error;
  }
}

/**
 * メイン実行
 */
async function main() {
  try {
    console.log('🌱 Starting seed...\n');
    await seedPorts();
    console.log('\n✨ Seed completed successfully!');
  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 実行
main();
