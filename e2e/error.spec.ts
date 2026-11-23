import { expect, getPortId, test } from './fixtures';

test.describe('上流 API エラー時の表示（docs/reference/api-error-handling.md）', () => {
  test('E2E-ERR-01 上流 API が失敗したときエラー画面が表示され、上流の応答本文は漏れない（docs/reference/api-error-handling.md）', async ({
    authenticatedPage: page,
  }) => {
    // scripts/perf/stub.mjs で 0,24（千島列島・伽藍埼）だけ潮汐の上流 503 を返す
    const failingPortId = await getPortId('0', '24');

    await page.goto(`/dashboard?portId=${failingPortId}`);

    // ApiClient は 503 に対し指数バックオフ（100ms + 200ms + 400ms）で最大 3 回リトライする
    await expect(page.getByRole('heading', { name: '一時的に利用できません' })).toBeVisible({
      timeout: 15_000,
    });
    const retryButton = page.getByRole('button', { name: '再試行' });
    await expect(retryButton).toBeVisible();

    const mainContent = page.locator('main');
    const assertNoLeakedErrorDetails = async () => {
      await expect(mainContent).not.toContainText('STUB_UPSTREAM_ERROR_BODY_DO_NOT_LEAK');
      // Next.js 16 + React 19 本番ビルドでは ErrorBoundary の error.message が Minified React error になる
      await expect(mainContent).not.toContainText('Minified React error');
      await expect(mainContent).not.toContainText('https://react.dev/errors/');
      await expect(mainContent).not.toContainText(
        'An error occurred in the Server Components render',
      );
    };

    await assertNoLeakedErrorDetails();

    // 「再試行」押下で /dashboard への RSC 再取得が走り、引き続きエラー画面が表示される（#189）
    const retryResponsePromise = page.waitForResponse(
      (res) => new URL(res.url()).pathname === '/dashboard' && res.request().headers().rsc === '1',
      { timeout: 10_000 },
    );
    await retryButton.click();
    await retryResponsePromise;

    await expect(page.getByRole('heading', { name: '一時的に利用できません' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(retryButton).toBeVisible();
    await assertNoLeakedErrorDetails();
  });
});
