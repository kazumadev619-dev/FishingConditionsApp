import { existsSync } from 'node:fs';
import { defineConfig, env } from 'prisma/config';

// Docker のビルドと CI が置く .env を読む（既存の環境変数は上書きしない）。
// dotenv 18 は dotenv-cli と同じ `dotenv` コマンドを持ち込み、package.json の
// `dotenv -e .env.local --` を壊すため、dotenv ではなく Node 標準で読む（#110）。
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Prisma CLI（migrate / db push）専用の接続。
    // Neon の pooled エンドポイント経由では DDL が詰まるため direct を使う。
    // アプリ実行時の接続は src/lib/prisma.ts が DATABASE_URL から作る（別経路）。
    url: env('DATABASE_URL_DIRECT'),
  },
});
