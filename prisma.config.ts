import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

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
