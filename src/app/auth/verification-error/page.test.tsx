import { useSearchParams } from 'next/navigation';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import VerificationErrorPage from './page';

vi.mock('next/navigation', () => ({ useSearchParams: vi.fn() }));

const openWith = (query: string) => {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as never);
  return renderToStaticMarkup(<VerificationErrorPage />);
};

// 主ボタンは先頭の <a>。副ボタンは outline なので区別できる
const primaryHref = (html: string) => html.match(/<a[^>]*href="([^"]+)"/)?.[1];

describe('メール確認の失敗ページ', () => {
  it.each(['invalid_token', 'missing_token'])(
    '%s では登録済みの人が多いので、ログインを主ボタンにする',
    (error) => {
      expect(primaryHref(openWith(`error=${error}`))).toBe('/login');
    },
  );

  it.each(['user_not_found', 'server_error'])('%s では新規登録を主ボタンのままにする', (error) => {
    expect(primaryHref(openWith(`error=${error}`))).toBe('/register');
  });
});
