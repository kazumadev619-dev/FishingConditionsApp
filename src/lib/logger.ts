import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

export const logger = pino({
  level: logLevel,

  // 本番環境: JSON形式のみ（pretty OFF）
  // 開発環境: pino-prettyで読みやすい形式
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined, // 本番環境では transport を設定しない = 純粋なJSON出力

  // センシティブ情報のマスキング
  redact: {
    paths: [
      'password',
      'password_hash',
      'token',
      'accessToken',
      'refreshToken',
      '*.password',
      '*.password_hash',
      '*.token',
    ],
    censor: '[REDACTED]',
  },

  // 基本情報の追加
  base: {
    env: process.env.NODE_ENV,
  },
});

/**
 * メールアドレスのマスキング用ヘルパー
 * @example maskEmail("test@example.com") -> "te***@example.com"
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[INVALID_EMAIL]';
  return `${local.slice(0, 2)}***@${domain}`;
}
