import { expect, it } from 'vitest';
import { baseAuthConfig } from './config';

it('認証の拒否はログインページに戻す', () => {
  expect(baseAuthConfig.pages.error).toBe('/login');
});
