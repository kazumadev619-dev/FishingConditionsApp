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

    // Prisma クライアントが正常に初期化されているか確認
    console.log('🔍 Prisma client:', typeof prisma, Object.keys(prisma).slice(0, 5));

    // 既存データをクリア（再実行時のため）
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deleteResult = await (prisma as any).$executeRaw`DELETE FROM "ports"`;
      console.log(`🗑️  Cleared existing ports (${deleteResult} rows)`);
    } catch {
      console.log('⚠️  No existing ports to clear (table might not exist yet)');
    }

    // ports テーブルに一括挿入（SQL INSERT を使用）
    // SQL injection 対策：シングルクォートをエスケープ
    const escapeSql = (str: string): string => str.replace(/'/g, "''");

    const valuesList = ports
      .map(
        (port) =>
          `('${randomUUID()}', '${escapeSql(port.prefecture_code)}', '${escapeSql(port.prefecture_name)}', '${escapeSql(port.port_code)}', '${escapeSql(port.name)}', NULL, NULL, now())`,
      )
      .join(', ');

    const insertQuery = `
      INSERT INTO "ports" (id, prefecture_code, prefecture_name, port_code, name, latitude, longitude, created_at)
      VALUES ${valuesList}
      ON CONFLICT (prefecture_code, port_code) DO NOTHING
    `;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (prisma as any).$executeRawUnsafe(insertQuery);
      console.log(`✅ Inserted ${ports.length} ports (affected: ${result} rows)`);
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
