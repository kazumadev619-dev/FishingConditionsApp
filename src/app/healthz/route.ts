import { NextResponse } from 'next/server';

/**
 * Liveness / Readiness 用のヘルスチェック。
 * DB・外部 API・Redis のいずれにも依存しないこと。
 * 依存を足すと、外部要因での Pod 再起動ループを招く。
 *
 * `/api/` 配下に置かないのは、Stage 5 で `/api/v1/*` を Go に振る際の
 * パス空間を汚さないため（設計書 §4.1 契約 5）。
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok' });
}
