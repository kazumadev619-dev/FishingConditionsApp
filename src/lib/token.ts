import { randomBytes } from 'crypto';
import prisma from '@/lib/prisma';
import { logger, maskEmail } from '@/lib/logger';

/**
 * ランダムなトークンを生成
 * @returns 32バイトのランダムトークン（16進数文字列）
 */
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * メール検証トークンを生成してDBに保存
 * @param email - 検証対象のメールアドレス
 * @returns 生成されたトークン文字列
 */
export async function createVerificationToken(email: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1); // 1時間後に期限切れ

  try {
    // 既存の同じメールアドレスのトークンを削除（重複防止）
    await prisma.verification_tokens.deleteMany({
      where: { email },
    });

    // 新しいトークンを保存
    await prisma.verification_tokens.create({
      data: {
        email,
        token,
        expires_at: expiresAt,
      },
    });

    return token;
  } catch (error) {
    logger.error({ err: error, email: maskEmail(email) }, 'Failed to create verification token');
    throw new Error('Failed to create verification token');
  }
}

/**
 * トークンを検証して、有効なメールアドレスを返す
 * @param token - 検証するトークン
 * @returns 有効な場合はメールアドレス、無効な場合はnull
 */
export async function verifyToken(token: string): Promise<string | null> {
  try {
    const verificationToken = await prisma.verification_tokens.findUnique({
      where: { token },
    });

    if (!verificationToken) {
      return null; // トークンが見つからない
    }

    // 有効期限チェック
    if (verificationToken.expires_at < new Date()) {
      // 期限切れトークンを削除
      await prisma.verification_tokens.delete({
        where: { token },
      });
      return null;
    }

    return verificationToken.email;
  } catch (error) {
    logger.error({ err: error }, 'Failed to verify token');
    return null;
  }
}

/**
 * 検証完了後、トークンを削除
 * @param token - 削除するトークン
 */
export async function deleteVerificationToken(token: string): Promise<void> {
  try {
    await prisma.verification_tokens.delete({
      where: { token },
    });
  } catch (error) {
    logger.warn({ err: error }, 'Failed to delete verification token');
    // 削除失敗してもエラーにはしない（すでに削除されている可能性がある）
  }
}
