import { render } from '@react-email/components';
import { Resend } from 'resend';
import VerificationEmail from '@/emails/verification-email';
import { logger } from './logger';

// Resendクライアントを遅延初期化（ビルド時エラーを回避）
let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not set in environment variables');
    }
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

/**
 * メール検証リンクを送信
 * @param email - 送信先メールアドレス
 * @param verificationUrl - 検証用URL（トークン含む）
 * @param purpose - メール送信の用途（'signup': 通常登録, 'social-link': ソーシャル連携）
 * @returns 送信成功時はtrue、失敗時はfalse
 */
export async function sendVerificationEmail(
  email: string,
  verificationUrl: string,
  purpose: 'signup' | 'social-link' = 'signup',
): Promise<boolean> {
  try {
    // Resendクライアントを取得（遅延初期化）
    const resend = getResendClient();

    // React EmailテンプレートをHTMLにレンダリング
    const emailHtml = await render(VerificationEmail({ verificationUrl, purpose }));

    // メール送信
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'noreply@fishing-conditions.app',
      to: email,
      subject: 'メールアドレスの確認 - Fishing Conditions App',
      html: emailHtml,
    });

    if (error) {
      logger.error({ error }, 'Failed to send verification email');
      return false;
    }

    logger.info({ data }, 'Verification email sent successfully');
    return true;
  } catch (error) {
    logger.error({ error }, 'Error sending verification email');
    return false;
  }
}
