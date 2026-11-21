/**
 * ブラウザで起きた例外を受け取り、サーバーの構造化ログに残す（#247）
 * POST /api/client-errors
 *
 * 認証と回数の制限は withUserRateLimit（未ログインは 401、上限超えは 429）。
 * 悪用でログを溢れさせないよう、本文の大きさと各項目の長さを制限する。
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { CLIENT_ERROR_LIMITS, CLIENT_ERROR_SOURCES } from '@/lib/clientErrors';
import { logger } from '@/lib/logger';
import { withUserRateLimit } from '@/lib/rateLimit';

const bodySchema = z.strictObject({
  source: z.enum(CLIENT_ERROR_SOURCES),
  message: z.string().max(CLIENT_ERROR_LIMITS.message),
  name: z.string().max(CLIENT_ERROR_LIMITS.name).optional(),
  stack: z.string().max(CLIENT_ERROR_LIMITS.stack).optional(),
  componentStack: z.string().max(CLIENT_ERROR_LIMITS.componentStack).optional(),
  digest: z.string().max(CLIENT_ERROR_LIMITS.digest).optional(),
  path: z.string().max(CLIENT_ERROR_LIMITS.path).optional(),
});

/** 本文を上限まで読む。Content-Length は偽れるので、読みながら数える。超えたら null */
async function readBodyWithin(request: NextRequest, maxBytes: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

export const POST = (request: NextRequest) =>
  withUserRateLimit('client-errors', () => handlePost(request));

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const body = await readBodyWithin(request, CLIENT_ERROR_LIMITS.bodyBytes);
  if (body === null) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // withUserRateLimit を通っているので、セッションの id はある
  const userId = (await auth())?.user?.id;
  // 本文の値は利用者が自由に作れる。ログの本体（msg）には混ぜず、clientError の中に閉じ込める
  logger.error({ userId, clientError: parsed.data }, 'Client-side error reported');

  return new NextResponse(null, { status: 204 });
}
