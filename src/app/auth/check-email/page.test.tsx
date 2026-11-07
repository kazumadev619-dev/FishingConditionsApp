import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CheckEmailPage from './page';

const render = async (searchParams: { sent?: string }) =>
  renderToStaticMarkup(await CheckEmailPage({ searchParams: Promise.resolve(searchParams) }));

describe('確認メール送信ページ', () => {
  it('送信できたら、確認メールを送ったことと、ログインへの導線を出す', async () => {
    const html = await render({});

    expect(html).toContain('確認メールを送信しました');
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('送信できませんでした');
  });

  it.each<[string, { sent?: string }]>([
    ['sent=1', { sent: '1' }],
    ['sent=（空）', { sent: '' }],
    ['sent=00', { sent: '00' }],
    ['sent= 0（空白つき）', { sent: ' 0' }],
  ])('失敗表示になるのは sent=0 だけ。%s は成功表示', async (_label, params) => {
    const html = await render(params);

    expect(html).toContain('確認メールを送信しました');
    expect(html).not.toContain('送信できませんでした');
  });

  it('送信に失敗したら、送れなかったことと、ログインすれば送り直すことを伝える', async () => {
    const html = await render({ sent: '0' });

    expect(html).toContain('送信できませんでした');
    expect(html).toContain('ログインすると確認メールを送り直します');
    expect(html).not.toContain('確認メールを送信しました');
    expect(html).toContain('href="/login"');
  });
});
