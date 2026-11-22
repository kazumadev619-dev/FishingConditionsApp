import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reportClientError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/clientErrors', () => ({ reportClientError }));

type Listener = (event: unknown) => void;
const listeners = new Map<string, Listener>();

beforeEach(async () => {
  listeners.clear();
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  });
  vi.resetModules();
  await import('./instrumentation-client');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// #247: error.tsx も境界も通らない例外（イベントハンドラ、非同期処理）の報告
describe('instrumentation-client（#247）', () => {
  it('window の error を window-error として報告する', () => {
    const error = new Error('handler failed');
    listeners.get('error')?.({ error, message: 'handler failed' });

    expect(reportClientError).toHaveBeenCalledWith(error, 'window-error');
  });

  it('error に例外オブジェクトが無い（別オリジンのスクリプトなど）ときは message を報告する', () => {
    listeners.get('error')?.({ error: null, message: 'Script error.' });

    expect(reportClientError).toHaveBeenCalledWith('Script error.', 'window-error');
  });

  it('握りつぶされた Promise の reject を unhandled-rejection として報告する', () => {
    const reason = new Error('rejected');
    listeners.get('unhandledrejection')?.({ reason });

    expect(reportClientError).toHaveBeenCalledWith(reason, 'unhandled-rejection');
  });
});
