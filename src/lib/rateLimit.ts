import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { cache } from '@/lib/cache';
import { logger } from '@/lib/logger';

const USER_LIMIT_PER_MINUTE = 60;
const WINDOW_SECONDS = 60;
const SIGNUP_LIMIT_PER_IP = 10;
const SIGNUP_LIMIT_PER_ADDRESS = 3;
const SIGNUP_WINDOW_SECONDS = 60 * 60;

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

/** ログイン中のユーザーがこの経路の上限を超えたかどうか。ユーザーが不明なら通さない */
export async function isUserRateLimited(routeName: string): Promise<boolean> {
  const userId = (await auth())?.user?.id;

  return !userId || isRateLimited(`${routeName}:${userId}`, USER_LIMIT_PER_MINUTE, WINDOW_SECONDS);
}

/**
 * 接続元を数える単位。IPv6 は1契約に /64 が割り当たるので、/64 をひとつに数える。
 * Cloudflare を通らない要求にはこのヘッダが無いので、まとめてひとつに数える。
 * X-Forwarded-For は使わない。トンネルの経路では cloudflared の Pod の IP になる。
 *
 * ponytail: LAN から直接届く要求はヘッダを偽装できるので、この単位の制限は効かない
 * （k8s/README.md）。塞ぐならトンネルの外を Traefik で拒否する。
 */
function clientNetwork(ip: string): string {
  if (isIPv4(ip)) {
    return ip;
  }
  if (!isIPv6(ip)) {
    return 'unknown';
  }
  const groups = ip.split('::')[0].split(':');
  const prefix = [0, 1, 2, 3].map((i) => parseInt(groups[i] || '0', 16).toString(16));
  return `${prefix.join(':')}::/64`;
}

/**
 * 同じ受信箱に届く別名をひとつに数えるための形。Redis のキーと障害時のログに
 * 残るのでハッシュにする。Gmail のドットはプロバイダ依存なので畳まない。
 */
function addressKey(email: string): string {
  const lowered = email.toLowerCase();
  const at = lowered.lastIndexOf('@');
  const address = lowered.slice(0, at).split('+')[0] + lowered.slice(at);
  return createHash('sha256').update(address).digest('hex');
}

/**
 * 未ログインの登録を制限する。送信先のメールとパスワードのハッシュ化を守るので、
 * どちらより先に呼ぶ。接続元の上限で止めた要求は、そのアドレスの枠を減らさない。
 */
export async function isSignupRateLimited(email: string): Promise<boolean> {
  const ip = (await headers()).get('cf-connecting-ip') ?? '';

  return (
    (await isRateLimited(
      `signup:ip:${clientNetwork(ip)}`,
      SIGNUP_LIMIT_PER_IP,
      SIGNUP_WINDOW_SECONDS,
    )) ||
    isRateLimited(
      `signup:address:${addressKey(email)}`,
      SIGNUP_LIMIT_PER_ADDRESS,
      SIGNUP_WINDOW_SECONDS,
    )
  );
}

/**
 * 課金される上流を呼ぶルートを、ユーザーごと・ルートごとに制限する。
 * セッションがあっても id が空のことがある（jwtCallback が DB から引けなかったとき）。
 * 数えられないので通さない。
 */
export async function withUserRateLimit<T extends NextResponse>(
  routeName: string,
  handler: () => Promise<T>,
): Promise<T | NextResponse<{ error: string }>> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (await isRateLimited(`${routeName}:${userId}`, USER_LIMIT_PER_MINUTE, WINDOW_SECONDS)) {
    logger.warn({ routeName, userId }, 'Rate limit exceeded');
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(WINDOW_SECONDS) } },
    );
  }

  return handler();
}
