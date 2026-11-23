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
  it('logApiError は context に type が含まれていても type: API_ERROR を上書きさせない', () => {
    const error = new ApiError('upstream failed', ApiErrorType.SERVER_ERROR, 502, true);

    logApiError(error, { endpoint: '/api/weather', type: 'current' });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'API_ERROR',
        errorType: ApiErrorType.SERVER_ERROR,
        endpoint: '/api/weather',
      }),
      'API request failed',
    );
  });

  it('createApiErrorResponse は TIMEOUT を 504、それ以外の ApiError を 502 で返す', () => {
    const timeoutRes = createApiErrorResponse(
      new ApiError('timeout', ApiErrorType.TIMEOUT, undefined, true),
    );
    const clientRes = createApiErrorResponse(
      new ApiError('unauthorized', ApiErrorType.CLIENT_ERROR, 401, false),
    );

    expect(timeoutRes.status).toBe(504);
    expect(clientRes.status).toBe(502);
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

  it('isDatabaseUnavailableError は非接続エラーを false と判定する', () => {
    const uniqueErr = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: '7.10.1',
    });
    const validationErr = new Prisma.PrismaClientValidationError('invalid', {
      clientVersion: '7.10.1',
    });

    expect(isDatabaseUnavailableError(uniqueErr)).toBe(false);
    expect(isDatabaseUnavailableError(validationErr)).toBe(false);
    expect(isDatabaseUnavailableError(new Error('bug'))).toBe(false);
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
