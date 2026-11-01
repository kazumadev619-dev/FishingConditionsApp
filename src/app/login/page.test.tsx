import { useSearchParams } from 'next/navigation';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

vi.mock('next/navigation', () => ({ useSearchParams: vi.fn() }));
vi.mock('@/lib/actions', () => ({ authenticate: vi.fn() }));
vi.mock('@/lib/googleSignIn', () => ({ signInWithGoogle: vi.fn() }));

const openWith = (query: string) => {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as never);
  return renderToStaticMarkup(<LoginPage />);
};

describe('ログインページの Google 拒否の表示', () => {
  it('AccessDenied なら登録時の方法でのログインを案内する', () => {
    expect(openWith('error=AccessDenied')).toContain('登録時の方法でログインしてください');
  });

  it('それ以外のエラーは案内を出さず、失敗だけを伝える', () => {
    const html = openWith('error=Configuration');

    expect(html).toContain('ログインに失敗しました');
    expect(html).not.toContain('登録時の方法');
  });

  it('error が無ければ何も出さない', () => {
    expect(openWith('')).not.toMatch(/ログインできませんでした|ログインに失敗しました/);
  });
});
