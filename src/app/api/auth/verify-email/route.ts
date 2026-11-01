import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { deleteVerificationToken, verifyToken } from '@/lib/token';

/**
 * メール検証エンドポイント
 * POST /api/auth/verify-email（/auth/verify-email のボタンから）
 *
 * GET を置かない。メールのスキャナがリンクを開くだけで確認済みになるのを防ぐ
 */
export async function POST(request: NextRequest) {
  // 303 にしないと、遷移先にも POST が飛ぶ。request.url はトンネルの外の URL と
  // 一致しないので、Location は相対パスにする
  const redirectTo = (path: string) =>
    new NextResponse(null, { status: 303, headers: { Location: path } });

  try {
    const token = (await request.formData()).get('token');

    if (typeof token !== 'string' || !token) {
      return redirectTo('/auth/verification-error?error=missing_token');
    }

    // トークンを検証
    const email = await verifyToken(token);

    if (!email) {
      return redirectTo('/auth/verification-error?error=invalid_token');
    }

    // ユーザーを取得
    const user = await prisma.users.findUnique({
      where: { email },
    });

    if (!user) {
      // トークンを削除
      await deleteVerificationToken(token);
      return redirectTo('/auth/verification-error?error=user_not_found');
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
    return redirectTo('/auth/verification-success');
  } catch (error) {
    logger.error({ err: error }, 'Email verification error');
    return redirectTo('/auth/verification-error?error=server_error');
  }
}
