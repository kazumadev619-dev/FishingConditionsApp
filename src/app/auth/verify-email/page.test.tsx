import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import VerifyEmailPage from './page';

describe('メール確認ページ', () => {
  it('トークンを確認 API へ POST するフォームを出す', async () => {
    const page = await VerifyEmailPage({ searchParams: Promise.resolve({ token: 'token-1' }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/auth/verify-email"');
    expect(html).toMatch(/name="token"[^>]*value="token-1"/);
  });
});
