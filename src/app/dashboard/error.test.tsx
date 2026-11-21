import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportClientError } from '@/lib/clientErrors';
import DashboardError from './error';

// node 環境には DOM が無く、renderToStaticMarkup は effect を実行しない。
// effect の中身（サーバーへの報告）を確かめるため、描画中に即実行させる
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (effect: () => void) => effect(),
}));
vi.mock('@/lib/clientErrors', () => ({ reportClientError: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

const render = (error: Error & { digest?: string }) =>
  renderToStaticMarkup(<DashboardError error={error} retry={() => {}} />);

describe('DashboardError', () => {
  it('error.message は出さず、digest をエラーIDとして出す', () => {
    const error = Object.assign(new Error('Raw query failed. Code: 53000'), {
      digest: '1234567890',
    });
    const html = render(error);

    expect(html).not.toContain('Raw query failed');
    expect(html).toContain('1234567890');
  });

  // digest が無いのはクライアント側で投げられたエラー。本番でも message は伏せられずに届く
  it('digest が無ければエラーIDの行も error.message も出さない', () => {
    const html = render(new Error('CLIENT-SIDE-DETAIL'));

    expect(html).not.toContain('エラーID');
    expect(html).not.toContain('CLIENT-SIDE-DETAIL');
  });

  // #247: この画面が受け止めた例外はサーバーのログに残す。画面に出さない message も、ログには要る
  it('受け止めた例外を dashboard-error としてサーバーへ報告する', () => {
    const error = Object.assign(new Error('boom'), { digest: 'd1' });
    render(error);

    expect(reportClientError).toHaveBeenCalledWith(error, 'dashboard-error');
  });
});
