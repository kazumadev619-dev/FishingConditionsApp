import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

export const loggerOptions: pino.LoggerOptions = {
  level: logLevel,

  // 本番環境: JSON形式のみ（pretty OFF）
  // 開発環境: pino-prettyで読みやすい形式
  // target は絶対パスで渡す。名前だと next dev の再評価で解決に失敗し、以後 500 になる（#332）
  // ponytail: 起動ディレクトリがプロジェクト直下である前提。ブラウザには process.cwd() が無いのでサーバーのみ
  transport:
    !isProduction && typeof window === 'undefined'
      ? {
          target: `${process.cwd()}/node_modules/pino-pretty/index.js`,
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined, // 本番環境では transport を設定しない = 純粋なJSON出力

  // pino が既定で Error を展開するのは `err` キーだけ。呼び出し元の多くは
  // `{ error }` で渡しているので、こちらも展開しないと `"error":{}` になり
  // 失敗の理由がログに残らない（#294）
  serializers: {
    error: pino.stdSerializers.err,
  },

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
};

export const logger = pino(loggerOptions);

/**
 * メールアドレスのマスキング用ヘルパー
 * @example maskEmail("test@example.com") -> "te***@example.com"
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[INVALID_EMAIL]';
  return `${local.slice(0, 2)}***@${domain}`;
}
