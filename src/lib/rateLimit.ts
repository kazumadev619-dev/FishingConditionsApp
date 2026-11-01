import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { cache } from '@/lib/cache';
import { logger } from '@/lib/logger';

const USER_LIMIT_PER_MINUTE = 60;
const WINDOW_SECONDS = 60;

/**
 * このキーの呼び出しが、窓の間に limit を超えたかどうか。
 *
 * ponytail: 固定窓なので、窓の境目では瞬間的に limit の2倍まで通る。
 * Redis が使えないときは制限しない（キャッシュと同じく、落ちてもアプリは動かす）。
 */
export async function isRateLimited(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const count = await cache.increment(`ratelimit:${key}`, windowSeconds);
  return count !== null && count > limit;
}

/**
 * 課金される上流を呼ぶルートを、ユーザーごと・ルートごとに制限する。
 * 未ログインは proxy が 401 にするのでここには来ない。
 */
export async function withUserRateLimit<T extends NextResponse>(
  routeName: string,
  handler: () => Promise<T>,
): Promise<T | NextResponse<{ error: string }>> {
  const session = await auth();
  const userId = session?.user?.id;

  if (
    userId &&
    (await isRateLimited(`${routeName}:${userId}`, USER_LIMIT_PER_MINUTE, WINDOW_SECONDS))
  ) {
    logger.warn({ routeName, userId }, 'Rate limit exceeded');
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(WINDOW_SECONDS) } },
    );
  }

  return handler();
}
