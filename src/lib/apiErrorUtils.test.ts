/**
 * apiErrorUtils の単体テスト（#428）
 *
 * 仕様の出典: docs/reference/api-error-handling.md「エラーの分類と扱い」および
 * 「エラー表示とログのヘルパー（src/lib/apiErrorUtils.ts）」。
 *
 * DB 接続エラーの実物形状は `@prisma/adapter-pg 7.10.1` + `pg 8.23.0` + `PrismaClient 7.10.1`
 * に対してローカルの閉鎖ポート・遅延 TCP サーバ・擬似 PostgreSQL wire protocol サーバで
 * 実際に発生させて採取した固定値を使用している（`src/lib/prismaConstraints.test.ts` と同流儀）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { ApiError, ApiErrorType } from './api/types';
import {
  createApiErrorResponse,
  createDatabaseErrorResponse,
  isDatabaseUnavailableError,
  logApiError,
} from './apiErrorUtils';
import { logger } from './logger';

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

afterEach(() => vi.clearAllMocks());

function knownError(code: string, message: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: '7.10.1',
    meta,
  });
}

// ---- @prisma/adapter-pg 7.10.1 + pg 8.23.0 で実測・採取した DB 障害エラー形状 ----

// localhost の閉鎖ポート（デュアルスタック AggregateError）で採取: P1001 にならず code='ECONNREFUSED' になる
const localhostConnRefused = knownError(
  'ECONNREFUSED',
  'Invalid `prisma.ports.findMany()` invocation',
  { modelName: 'ports' },
);

// SQLSTATE 57P01 (admin_shutdown) で採取: code='P2039' + driverAdapterError.cause.code='57P01'
const pgAdminShutdown57P01 = knownError(
  'P2039',
  'Database error. Code: `57P01`. Message: `terminating connection due to administrator command`',
  {
    modelName: 'ports',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '57P01',
        originalMessage: 'terminating connection due to administrator command',
        kind: 'postgres',
        code: '57P01',
        severity: 'FATAL',
        message: 'terminating connection due to administrator command',
      },
    },
  },
);

// SQLSTATE 57P03 (cannot_connect_now) で採取
const pgCannotConnectNow57P03 = knownError(
  'P2039',
  'Database error. Code: `57P03`. Message: `the database system is starting up`',
  {
    modelName: 'ports',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '57P03',
        kind: 'postgres',
        code: '57P03',
        severity: 'FATAL',
      },
    },
  },
);

// SQLSTATE 42601 (構文エラー = コードの誤り) で採取: 同じ P2039 だが 503 にしてはいけない
const pgSyntaxError42601 = knownError(
  'P2039',
  'Database error. Code: `42601`. Message: `syntax error at or near "BAD"`',
  {
    modelName: 'ports',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '42601',
        originalMessage: 'syntax error at or near "BAD"',
        kind: 'postgres',
        code: '42601',
        severity: 'FATAL',
      },
    },
  },
);

describe('apiErrorUtils（#428）', () => {
  it('logApiError は context に同名キー（timestamp 含む）が含まれていても固定フィールドを上書きさせない', () => {
    const error = new ApiError('upstream failed', ApiErrorType.SERVER_ERROR, 502, true);

    logApiError(error, {
      endpoint: '/api/weather',
      type: 'current',
      errorType: 'CUSTOM',
      statusCode: 200,
      message: 'forged',
      retryable: false,
      timestamp: 'forged',
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'API_ERROR',
        errorType: ApiErrorType.SERVER_ERROR,
        statusCode: 502,
        message: 'upstream failed',
        retryable: true,
        endpoint: '/api/weather',
      }),
      'API request failed',
    );
    const loggedMeta = vi.mocked(logger.error).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(loggedMeta.timestamp).not.toBe('forged');
    expect(loggedMeta.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });

  it('createApiErrorResponse は TIMEOUT を 504、上流 504 を含むそれ以外を 502 で返し extraFields で固定フィールドを上書きさせない', async () => {
    const timeoutRes = createApiErrorResponse(
      new ApiError('secret timeout', ApiErrorType.TIMEOUT, undefined, true),
    );
    const upstream504Res = createApiErrorResponse(
      new ApiError('secret upstream 504', ApiErrorType.SERVER_ERROR, 504, true),
      { endpoint: '/api/weather' },
      {
        success: false,
        error: 'override',
        code: 'OVERRIDE',
        retryable: false,
      },
    );
    const clientRes = createApiErrorResponse(
      new ApiError('unauthorized', ApiErrorType.CLIENT_ERROR, 401, false),
    );

    expect(timeoutRes.status).toBe(504);
    expect(clientRes.status).toBe(502);
    expect(upstream504Res.status).toBe(502);

    const body = await upstream504Res.json();
    expect(body).toEqual({
      success: false,
      error: 'サーバーで問題が発生しました。サポートに連絡してください。',
      code: ApiErrorType.SERVER_ERROR,
      retryable: true,
    });
    expect(JSON.stringify(body)).not.toContain('secret upstream 504');
  });

  it.each([
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
  ])('isDatabaseUnavailableError は Prisma/ソケット接続系エラー %s を true と判定する', (code) => {
    expect(isDatabaseUnavailableError(knownError(code, 'db error'))).toBe(true);
  });

  it.each([
    ['localhost 閉鎖ポート（ECONNREFUSED）', localhostConnRefused],
    ['SQLSTATE 57P01 (P2039 / admin_shutdown)', pgAdminShutdown57P01],
    ['SQLSTATE 57P03 (P2039 / cannot_connect_now)', pgCannotConnectNow57P03],
    [
      'meta なしの P2039（メッセージ内 SQLSTATE 57P01）',
      knownError('P2039', 'Database error. Code: `57P01`. Message: `terminating`'),
    ],
    [
      'pg TCP 接続タイムアウト（生の Error）',
      new Error('Connection terminated due to connection timeout'),
    ],
    ['pg-pool プール枯渇（生の Error）', new Error('timeout exceeded when trying to connect')],
    ['pg 途中切断（生の Error）', new Error('Connection terminated unexpectedly')],
    ['pg 明示終了時の切断（生の Error）', new Error('Connection terminated')],
  ])('実測の DB 障害形状を 503 / DB_ERROR として捕捉する: %s', (_label, err) => {
    expect(isDatabaseUnavailableError(err)).toBe(true);

    const response = createDatabaseErrorResponse(err, { endpoint: '/api/ports' });
    expect(response?.status).toBe(503);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DB_ERROR', err }),
      'Database request failed',
    );
  });

  it('isDatabaseUnavailableError と createDatabaseErrorResponse は errorCode なしの PrismaClientInitializationError でも true / 503 になる', () => {
    const initError = new Prisma.PrismaClientInitializationError('db init failed', '7.10.1');

    expect(isDatabaseUnavailableError(initError)).toBe(true);

    const response = createDatabaseErrorResponse(initError, { endpoint: '/api/ports' });

    expect(response?.status).toBe(503);
    const loggedMeta = vi.mocked(logger.error).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(loggedMeta).toMatchObject({
      type: 'DB_ERROR',
      err: initError,
      endpoint: '/api/ports',
    });
    expect('code' in loggedMeta).toBe(false);
  });

  it('isDatabaseUnavailableError / createDatabaseErrorResponse は非接続エラーで false / null を返しログを出さない', () => {
    const uniqueErr = knownError('P2002', 'unique');
    const notFoundErr = knownError('P2025', 'not found');
    const tableMissingErr = knownError('P2021', 'table does not exist');
    const emptyP2039Err = knownError('P2039', 'Database error');
    const unknownErr = new Prisma.PrismaClientUnknownRequestError('unknown', {
      clientVersion: '7.10.1',
    });
    const validationErr = new Prisma.PrismaClientValidationError('invalid', {
      clientVersion: '7.10.1',
    });
    const plainErr = new Error('bug');
    const partialPgLikeErr = new Error('unexpected error: Connection terminated unexpectedly');

    for (const err of [
      uniqueErr,
      notFoundErr,
      tableMissingErr,
      pgSyntaxError42601,
      emptyP2039Err,
      unknownErr,
      validationErr,
      plainErr,
      partialPgLikeErr,
    ]) {
      expect(isDatabaseUnavailableError(err)).toBe(false);
      expect(createDatabaseErrorResponse(err)).toBeNull();
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('createDatabaseErrorResponse は DB 障害時に type: DB_ERROR を保持して 503 を返す', () => {
    const error = knownError('P1001', 'db down');

    const response = createDatabaseErrorResponse(error, { type: 'override-attempt' });

    expect(response?.status).toBe(503);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DB_ERROR', code: 'P1001', err: error }),
      'Database request failed',
    );
  });
});
