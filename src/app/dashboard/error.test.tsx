import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DashboardError from './error';

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

  it('digest が無ければエラーIDの行を出さない', () => {
    expect(render(new Error('x'))).not.toContain('エラーID');
  });
});
