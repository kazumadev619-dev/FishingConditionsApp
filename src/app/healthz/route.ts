import { NextResponse } from 'next/server';

/**
 * Liveness / Readiness / Startup すべてが叩くヘルスチェック。
 * DB・外部 API・Redis のいずれにも依存しないこと。
 *
 * 依存を足すと、probe が10秒ごとにそれを叩くうえ、外部要因での再起動ループも招く（#187）。
 *
 * `/api/` 配下に置かないのは、Stage 5 で `/api/v1/*` を Go に振る際の
 * パス空間を汚さないため（設計書 §4.1 契約 5）。
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok' });
}
