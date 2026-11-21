import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_ERROR_LIMITS,
  reportClientError,
  resetClientErrorCountForTest,
} from './clientErrors';

const sendBeacon = vi.fn(() => true);

beforeEach(() => {
  resetClientErrorCountForTest();
  vi.stubGlobal('navigator', { sendBeacon });
  vi.stubGlobal('window', { location: { pathname: '/dashboard' } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function sentPayload() {
  const [url, blob] = sendBeacon.mock.lastCall as unknown as [string, Blob];
  return { url, type: blob.type, body: JSON.parse(await blob.text()) };
}

describe('reportClientError（#247）', () => {
  it('例外の種類・メッセージ・digest・パスを /api/client-errors へ JSON で送る', async () => {
    const error = Object.assign(new TypeError('boom'), { digest: 'abc123' });

    reportClientError(error, 'dashboard-error', '\n    at Map');

    const { url, type, body } = await sentPayload();
    expect(url).toBe('/api/client-errors');
    expect(type).toBe('application/json');
    expect(body).toMatchObject({
      source: 'dashboard-error',
      name: 'TypeError',
      message: 'boom',
      digest: 'abc123',
      componentStack: '\n    at Map',
      path: '/dashboard',
    });
    expect(body.stack).toContain('TypeError: boom');
  });

  it('Error でない値（reject された文字列など）も message として送る', async () => {
    reportClientError('plain rejection', 'unhandled-rejection');

    expect((await sentPayload()).body).toMatchObject({
      source: 'unhandled-rejection',
      message: 'plain rejection',
    });
  });

  it('クエリとハッシュは送らない（トークンが載りうる）', async () => {
    vi.stubGlobal('window', {
      location: { pathname: '/auth/verify-email', search: '?token=SECRET', hash: '#x' },
    });

    reportClientError(new Error('x'), 'window-error');

    expect(JSON.stringify((await sentPayload()).body)).not.toContain('SECRET');
  });

  it('受け口の上限を超える長さは、送る前に切る（超えると 400 で捨てられるため）', async () => {
    const error = new Error('m'.repeat(CLIENT_ERROR_LIMITS.message + 100));
    error.stack = 's'.repeat(CLIENT_ERROR_LIMITS.stack + 100);

    reportClientError(error, 'window-error', 'c'.repeat(CLIENT_ERROR_LIMITS.componentStack + 100));

    const { body } = await sentPayload();
    expect(body.message).toHaveLength(CLIENT_ERROR_LIMITS.message);
    expect(body.stack).toHaveLength(CLIENT_ERROR_LIMITS.stack);
    expect(body.componentStack).toHaveLength(CLIENT_ERROR_LIMITS.componentStack);
  });

  it('1 回のページ表示で送るのは 5 件まで（描画の繰り返しでサーバーを叩き続けない）', () => {
    for (let i = 0; i < 8; i++) reportClientError(new Error(`e${i}`), 'window-error');

    expect(sendBeacon).toHaveBeenCalledTimes(5);
  });

  it('sendBeacon が無い環境では何も送らず、例外も投げない', () => {
    vi.stubGlobal('navigator', {});

    expect(() => reportClientError(new Error('x'), 'window-error')).not.toThrow();
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
