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

describe('apiErrorUtils（#428）', () => {
  it('logApiError は context に同名キーが含まれていても固定フィールドを上書きさせない', () => {
    const error = new ApiError('upstream failed', ApiErrorType.SERVER_ERROR, 502, true);

    logApiError(error, {
      endpoint: '/api/weather',
      type: 'current',
      errorType: 'CUSTOM',
      statusCode: 200,
      message: 'forged',
      retryable: false,
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

  it.each(['P1000', 'P1001', 'P1002', 'P1008', 'P1011', 'P1017', 'P2024', 'P2037'])(
    'isDatabaseUnavailableError は Prisma 接続系エラー %s を true と判定する',
    (code) => {
      const error = new Prisma.PrismaClientKnownRequestError('db error', {
        code,
        clientVersion: '7.10.1',
      });

      expect(isDatabaseUnavailableError(error)).toBe(true);
    },
  );

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
    const uniqueErr = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: '7.10.1',
    });
    const notFoundErr = new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: '7.10.1',
    });
    const unknownErr = new Prisma.PrismaClientUnknownRequestError('unknown', {
      clientVersion: '7.10.1',
    });
    const validationErr = new Prisma.PrismaClientValidationError('invalid', {
      clientVersion: '7.10.1',
    });
    const plainErr = new Error('bug');

    for (const err of [uniqueErr, notFoundErr, unknownErr, validationErr, plainErr]) {
      expect(isDatabaseUnavailableError(err)).toBe(false);
      expect(createDatabaseErrorResponse(err)).toBeNull();
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('createDatabaseErrorResponse は DB 障害時に type: DB_ERROR を保持して 503 を返す', () => {
    const error = new Prisma.PrismaClientKnownRequestError('db down', {
      code: 'P1001',
      clientVersion: '7.10.1',
    });

    const response = createDatabaseErrorResponse(error, { type: 'override-attempt' });

    expect(response?.status).toBe(503);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DB_ERROR', code: 'P1001', err: error }),
      'Database request failed',
    );
  });
});
