// E2E 専用ユーザーを DB に入れる（何度流しても同じ状態になる）。本番の db-seed（prisma/seed.ts）には混ぜない。
//
//   DATABASE_URL=postgresql://... node scripts/e2e/seed-users.mjs
import bcrypt from 'bcrypt';
import console from 'node:console';
import process from 'node:process';
import pg from 'pg';
import { E2E_USERS } from './users.mjs';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL が要る');
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (const u of Object.values(E2E_USERS)) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, name, email_verified_at)
       VALUES ($1, $2, $3, 'E2E', $4)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
             email_verified_at = EXCLUDED.email_verified_at`,
      [u.id, u.email, hash, u.verified ? new Date() : null],
    );
  }
  console.log(`E2E ユーザー ${Object.keys(E2E_USERS).length} 人を用意した`);
} finally {
  await pool.end();
}
