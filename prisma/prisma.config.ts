import 'dotenv/config';
import { defineConfig } from '../generated/prisma/client';

export default defineConfig({
  datasources: {
    db: {
      provider: 'postgresql',
      url: process.env.DATABASE_URL,
    },
  },
});
