import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // テストは実装の隣に置く。src/ 配下がほとんどだが、next.config.mjs のような
    // ルート直下の設定ファイルもテスト対象なので、ルート直下の *.test.ts も拾う
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', '*.test.ts'],
    environment: 'node',
    // next-auth は `next/server` を拡張子なしで import するが、next の package.json に
    // exports が無いため Node の ESM 解決では引けない。Vite に通して解決させる。
    server: { deps: { inline: ['next-auth', '@auth/core'] } },
    setupFiles: ['./vitest.setup.ts'],
  },
});
