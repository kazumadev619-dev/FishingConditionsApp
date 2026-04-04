import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { deleteVerificationToken, verifyToken } from '@/lib/token';

/**
 * メール検証エンドポイント
 * GET /api/auth/verify-email?token=xxx
 */
export async function GET(request: NextRequest) {
  try {
    // URLパラメータからトークンを取得
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.redirect(
        new URL('/auth/verification-error?error=missing_token', request.url),
      );
    }

    // トークンを検証
    const email = await verifyToken(token);

    if (!email) {
      return NextResponse.redirect(
        new URL('/auth/verification-error?error=invalid_token', request.url),
      );
    }

    // ユーザーを取得
    const user = await prisma.users.findUnique({
      where: { email },
    });

    if (!user) {
      // トークンを削除
      await deleteVerificationToken(token);
      return NextResponse.redirect(
        new URL('/auth/verification-error?error=user_not_found', request.url),
      );
    }

    // メール検証完了: email_verified_atを更新
    await prisma.users.update({
      where: { id: user.id },
      data: {
        email_verified_at: new Date(),
      },
    });

    // トークンを削除（使用済み）
    await deleteVerificationToken(token);

    // 検証成功ページにリダイレクト
    return NextResponse.redirect(new URL('/auth/verification-success', request.url));
  } catch (error) {
    logger.error({ err: error }, 'Email verification error');
    return NextResponse.redirect(
      new URL('/auth/verification-error?error=server_error', request.url),
    );
  }
}
