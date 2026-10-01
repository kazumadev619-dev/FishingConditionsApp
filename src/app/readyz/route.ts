import { NextResponse } from 'next/server';
import { cache } from '@/lib/cache';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';

/**
 * 依存の到達性を確かめる診断用エンドポイント。人が状態を知りたいときに叩く。
 *
 * **k8s の probe や監視など、定期ポーリングを向けないこと。** 向けた時点で
 * Neon の autosuspend が効かなくなり、無料枠を使い切って本番が落ちる
 * （#187、経緯は k8s/README.md）。probe は `/healthz` を使う。
 *
 * 判定に含めるもの:
 * - **DB**: 含める。このエンドポイントの主目的が DB 到達性の確認のため。
 * - **Redis**: 含めない。キャッシュが落ちても `isAvailable()` が false を
 *   返して呼び出し側が素通しするだけで、アプリは（遅くなるが）動く。
 *   状態は body に出して観測できるようにするに留める。
 *
 * `/api/` 配下に置かないのは `/healthz` と同じ理由（Stage 5 で `/api/v1/*`
 * を Go に振る際のパス空間を汚さないため）。
 */
export const dynamic = 'force-dynamic';

/**
 * 応答が返らないまま待ち続けないための打ち切り。probe から外れた今も、
 * 人が叩いたときに固まらないよう残す。
 */
const DB_CHECK_TIMEOUT_MS = 3000;

async function isDatabaseReachable(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Database check timed out after ${DB_CHECK_TIMEOUT_MS}ms`)),
          DB_CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'Readiness check failed: database is not reachable');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const databaseReady = await isDatabaseReachable();
  const cacheAvailable = cache.isAvailable();

  return NextResponse.json(
    {
      status: databaseReady ? 'ready' : 'not_ready',
      checks: {
        database: databaseReady ? 'ok' : 'error',
        // Ready 判定には影響しない（degraded でもトラフィックは受ける）
        cache: cacheAvailable ? 'ok' : 'degraded',
      },
    },
    { status: databaseReady ? 200 : 503 },
  );
}
