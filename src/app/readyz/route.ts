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
 *   成功は DB_CHECK_INTERVAL_MS の間覚える。`databaseCheckedAt` は `ok` の根拠になった確認の
 *   時刻で、今の状態はそれより古いことがある。失敗したときは null。
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

/**
 * このエンドポイントは未認証で届く。回数に関係なく compute を起こす頻度を抑えるため、
 * 成功をこの間だけ覚える。Neon の autosuspend は5分なので、起きている時間は最大で 5/30。
 * 失敗は覚えない（復旧がすぐ見えるように）。新しい Pod の最初の1回は必ず DB を見るので、
 * デプロイのスモークには影響しない。
 */
const DB_CHECK_INTERVAL_MS = 30 * 60 * 1000;

let lastReachableAt: number | undefined;

async function isDatabaseReachable(): Promise<boolean> {
  if (lastReachableAt !== undefined && Date.now() - lastReachableAt < DB_CHECK_INTERVAL_MS) {
    return true;
  }

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
    lastReachableAt = Date.now();
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
        databaseCheckedAt:
          databaseReady && lastReachableAt ? new Date(lastReachableAt).toISOString() : null,
        // Ready 判定には影響しない（degraded でもトラフィックは受ける）
        cache: cacheAvailable ? 'ok' : 'degraded',
      },
    },
    { status: databaseReady ? 200 : 503 },
  );
}
