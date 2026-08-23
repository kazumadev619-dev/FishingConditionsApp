import { NextResponse } from 'next/server';
import { cache } from '@/lib/cache';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';

/**
 * Readiness 用のヘルスチェック。
 *
 * liveness の `/healthz` とは役割が異なる。`/healthz` は依存ゼロで
 * 「プロセスが生きているか」だけを見る（依存を足すと外部要因での再起動
 * ループを招く）。こちらは「このPodにトラフィックを流してよいか」を見る。
 *
 * 判定に含めるもの:
 * - **DB**: 含める。ダッシュボードもお気に入りも Prisma を通るため、
 *   繋がっていないPodに流すと全ページが 500 になる。
 * - **Redis**: 含めない。キャッシュが落ちても `isAvailable()` が false を
 *   返して呼び出し側が素通しするだけで、アプリは（遅くなるが）動く。
 *   ここに含めると、クラスタ全体の Redis 障害で全Podが NotReady になり、
 *   本来まだ提供できたはずのサービスまで落ちる。状態は body に出して
 *   観測できるようにするに留める。
 *
 * `/api/` 配下に置かないのは `/healthz` と同じ理由（Stage 5 で `/api/v1/*`
 * を Go に振る際のパス空間を汚さないため）。
 */
export const dynamic = 'force-dynamic';

/**
 * probe の timeoutSeconds より短くする。probe 側で打ち切られると
 * 「なぜ落ちたか」がログに残らないため、こちらから先に見切って 503 を返す。
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
