// 期待値の出どころ: #438 と ADR-012。E2E 環境は使い捨ての localhost / 127.0.0.1 の DB・Redis だけに繋ぎ、
// 本番や共有のサービスには、migrate・seed・公開パスワードの E2E ユーザーの投入をしない。
import { describe, expect, it } from 'vitest';
import { assertLocal } from './assert-local.mjs';

describe('assertLocal', () => {
  it.each([
    'postgresql://e2e:e2e@127.0.0.1:5432/e2e',
    'postgresql://e2e:e2e@localhost:5432/e2e',
    'redis://localhost:6379',
  ])('localhost / 127.0.0.1 は通す: %s', (url) => {
    expect(() => assertLocal(url)).not.toThrow();
  });

  it.each([
    ['別のホスト', 'postgresql://u:p@prod.example.com:5432/db'],
    ['localhost で始まる別のドメイン', 'postgresql://u:p@localhost.evil.example:5432/db'],
    ['userinfo に localhost', 'postgresql://localhost:x@prod.example.com:5432/db'],
    [
      'クエリの host で差し替え（pg はこちらを優先する）',
      'postgresql://u:p@localhost:5432/db?host=prod.example.com',
    ],
    ['クエリの hostaddr で差し替え', 'postgresql://u:p@localhost:5432/db?hostaddr=203.0.113.1'],
    [
      'クエリの host を2つ（後ろが外）',
      'postgresql://u:p@localhost:5432/db?host=localhost&host=prod.example.com',
    ],
    ['URL として読めない', 'not a url'],
  ])('通さない: %s', (_name, url) => {
    expect(() => assertLocal(url)).toThrow();
  });

  it('複数の URL は1つずつ判定する（片方が localhost でも、もう片方が外なら通さない）', () => {
    expect(() =>
      assertLocal('postgresql://u:p@prod.example.com:5432/db', 'redis://localhost:6379'),
    ).toThrow();
    expect(() =>
      assertLocal('postgresql://u:p@localhost:5432/db', 'redis://prod.example.com:6379'),
    ).toThrow();
  });

  it('エラーの文言に接続先のパスワードを出さない', () => {
    let message = '';
    try {
      assertLocal('postgresql://u:secretpw@prod.example.com:5432/db');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('secretpw');
  });
});
