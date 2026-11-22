import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RegisterPage from './page';

vi.mock('@/lib/actions', () => ({ signup: vi.fn() }));
vi.mock('@/lib/googleSignIn', () => ({ signInWithGoogle: vi.fn() }));

const getInputAutocomplete = (html: string, id: string) => {
  const tag = (html.match(/<input(?=\s)[^>]*>/g) ?? []).find((el) =>
    new RegExp(`(?:^|\\s)id="${id}"`).test(el),
  );
  return tag?.match(/(?:^|\s)autocomplete="([^"]*)"/i)?.[1];
};

describe('新規登録フォームの autoComplete 属性（#444）', () => {
  it.each([
    ['name', 'name'],
    ['email', 'email'],
    ['password', 'new-password'],
  ])('%s 入力欄に autoComplete="%s" が設定されている', (id, expected) => {
    const html = renderToStaticMarkup(<RegisterPage />);

    expect(getInputAutocomplete(html, id)).toBe(expected);
  });
});
