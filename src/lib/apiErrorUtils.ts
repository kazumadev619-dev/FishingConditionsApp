import { NextResponse } from 'next/server';
import { Prisma } from '@/generated/prisma/client';
import { type ApiError, ApiErrorType } from './api/types';
import { logger } from './logger';

/**
 * Prisma が DB 接続・到達不能・認証・プール枯渇などの障害時に返すエラーコード。
 *
 * `error.meta` の形は `@prisma/adapter-pg` の有無とバージョンで変わる（#161）ため、
 * 原則として `error.code` のみで判定する（#428）。
 *
 * - P1000: AuthenticationFailed
 * - P1001: DatabaseNotReachable（127.0.0.1 等単一アドレスの ENOTFOUND / ECONNREFUSED）
 * - P1002: Database server timed out
 * - P1003: DatabaseDoesNotExist（PostgreSQL 3D000）
 * - P1008: Operations timed out / SocketTimeout（ETIMEDOUT）
 * - P1010: DatabaseAccessDenied（PostgreSQL 28000: no pg_hba.conf entry 等）
 * - P1011: TlsConnectionError
 * - P1017: ConnectionClosed（ECONNRESET / EOF）
 * - P2024: Timed out fetching a new connection from the connection pool
 * - P2037: TooManyConnections（PostgreSQL 53300）
 * - ECONNREFUSED 等: `localhost` デュアルスタック（AggregateError）経由のソケットエラーを
 *   `@prisma/adapter-pg` が P1001 へ変換せず生の `error.code` で通すことがあるため併せて扱う
 */
const DATABASE_UNAVAILABLE_ERROR_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1010',
  'P1011',
  'P1017',
  'P2024',
  'P2037',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * `@prisma/adapter-pg` が `P2039`（汎用 postgres エラー）で包む SQLSTATE のうち、
 * クエリの誤り（42601 構文エラー等）ではなく一時的な障害を表すもの。
 * 08xxx（接続例外）、57P01〜57P03（停止・起動中）、53xxx（資源枯渇）。
 */
function isTransientSqlState(sqlState: string): boolean {
  return (
    sqlState.startsWith('08') ||
    sqlState.startsWith('53') ||
    ['57P01', '57P02', '57P03'].includes(sqlState)
  );
}

/**
 * `pg` / `pg-pool` が PrismaClientKnownRequestError に包まれず生の `Error` として投げる
 * 接続タイムアウト・プール枯渇・切断メッセージ（完全一致で判定し、一般的な Error を誤分類しない）。
 */
const PG_CONNECTION_ERROR_MESSAGES = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated',
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
]);

/**
 * P2039 は `error.code` だけでは一時的な障害とクエリの誤りを区別できないため、例外として
 * `error.meta.driverAdapterError.cause.originalCode`（SQLSTATE）だけを読む（#428）。
 * `error.message` は解析しない。meta が読めなければ false（想定外の 500）に倒す。
 */
function isUnavailableP2039(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (error.code !== 'P2039') {
    return false;
  }

  const meta = error.meta as
    | { driverAdapterError?: { cause?: { originalCode?: unknown } } }
    | undefined;
  const sqlState = meta?.driverAdapterError?.cause?.originalCode;

  return typeof sqlState === 'string' && isTransientSqlState(sqlState);
}

// エラー型から日本語のメッセージを生成
export function getErrorMessage(error: ApiError): string {
  switch (error.type) {
    case ApiErrorType.TIMEOUT:
      return '通信がタイムアウトしました。インターネット接続を確認して、もう一度お試しください。';

    case ApiErrorType.RATE_LIMITED:
      return 'API の使用制限に達しました。数分後にお試しください。';

    case ApiErrorType.SERVER_ERROR:
      return 'サーバーで問題が発生しました。サポートに連絡してください。';

    case ApiErrorType.CLIENT_ERROR:
      return 'リクエストが無効です。入力内容を確認してください。';

    case ApiErrorType.NETWORK_ERROR:
      return 'ネットワーク接続を確認してください。';

    default:
      return 'エラーが発生しました。もう一度お試しください。';
  }
}

/**
 * エラーをログに記録（構造化ログ）
 */
export function logApiError(error: ApiError, context?: Record<string, unknown>): void {
  const logData = {
    ...context,
    type: 'API_ERROR',
    errorType: error.type,
    statusCode: error.statusCode,
    message: error.message,
    retryable: error.retryable,
    timestamp: new Date().toISOString(),
  };
  logger.error(logData, 'API request failed');
}

/**
 * 上流 API 障害（ApiError）を構造化ログに記録し、固定文言の HTTP 応答を生成する。
 * 上流の応答本文（error.message）はログにのみ残し、レスポンスには含めない。
 * 上流の 4xx（API キーの設定誤りや上流のレート制限など）も利用者には 502、タイムアウトは 504
 * を返す（docs/reference/api-error-handling.md）。
 */
export function createApiErrorResponse(
  error: ApiError,
  context?: Record<string, unknown>,
  extraFields?: Record<string, unknown>,
): NextResponse<{ error: string; code: ApiErrorType; retryable: boolean }> {
  logApiError(error, context);

  return NextResponse.json(
    {
      ...extraFields,
      error: getErrorMessage(error),
      code: error.type,
      retryable: error.retryable,
    },
    { status: error.type === ApiErrorType.TIMEOUT ? 504 : 502 },
  );
}

/**
 * Prisma の接続・到達不能・初期化失敗（異常なエラー）かどうかを判定する。
 * クエリやデータ不整合のエラー（想定外）とはここで見分ける。
 */
export function isDatabaseUnavailableError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return DATABASE_UNAVAILABLE_ERROR_CODES.has(error.code) || isUnavailableP2039(error);
  }
  return (
    error instanceof Error &&
    error.name === 'Error' &&
    PG_CONNECTION_ERROR_MESSAGES.has(error.message)
  );
}

/**
 * DB 障害（異常なエラー）であれば構造化ログに記録して 503 応答を返し、
 * それ以外の例外（想定外のエラー）であれば null を返す。
 */
export function createDatabaseErrorResponse(
  error: unknown,
  context?: Record<string, unknown>,
): NextResponse<{ error: string; code: string }> | null {
  if (!isDatabaseUnavailableError(error)) {
    return null;
  }

  const code =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : error instanceof Prisma.PrismaClientInitializationError
        ? error.errorCode
        : undefined;

  logger.error(
    {
      ...context,
      type: 'DB_ERROR',
      ...(code !== undefined && { code }),
      err: error,
    },
    'Database request failed',
  );

  return NextResponse.json(
    {
      error: '一時的に利用できません。時間をおいて再度お試しください。',
      code: 'DB_UNAVAILABLE',
    },
    { status: 503 },
  );
}
