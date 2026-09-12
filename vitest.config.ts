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
  },
});
