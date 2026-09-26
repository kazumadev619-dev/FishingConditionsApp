/**
 * ルートレイアウトが全ページを動的レンダリングにしていることの回帰テスト（#147）
 *
 * CSP の script-src に 'unsafe-inline' が無いので、Next.js のインラインスクリプトは
 * proxy が発行する nonce が付いていないと実行されない。ビルド時に静的に焼いた HTML には
 * nonce が入らないため、静的ページに戻ると本番でだけ画面が固まる（型チェックも
 * ビルドも通る）。connection() を待つことで全ページをリクエスト時の描画にしている。
 */
import { describe, expect, it, vi } from 'vitest';

const { connection } = vi.hoisted(() => ({ connection: vi.fn(async () => {}) }));
vi.mock('next/server', () => ({ connection }));

import RootLayout from './layout';

describe('RootLayout', () => {
  it('connection() を待ってから描画する（静的プリレンダさせない）', async () => {
    await RootLayout({ children: null });

    expect(connection).toHaveBeenCalledOnce();
  });
});
