// 性能測定用: 仮のユーザー N 人ぶんのセッション Cookie（JWT）を JSON で書き出す。
//
//   AUTH_SECRET=<測定用の値> node scripts/perf/make-cookies.mjs <出力先> [人数]
//
// レート制限はユーザー × ルートで 60 回/分（src/lib/rateLimit.ts）。1 人で負荷をかけると 429 に
// なるので、k6 は要求ごとに別のユーザーの Cookie を使う。id が UUID のトークンは DB を引かずに
// 通る（src/auth/callbacks/jwtCallback.ts）ので、ユーザーは DB に作らない。
// 測定用の AUTH_SECRET は docker-compose.yml のものと同じ。本番・ローカル開発の値は使わない。
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { encode } from 'next-auth/jwt';

const [out, count = '2000'] = process.argv.slice(2);
const secret = process.env.AUTH_SECRET;
if (!out || !secret) {
  console.error('使い方: AUTH_SECRET=... node scripts/perf/make-cookies.mjs <出力先> [人数]');
  process.exit(2);
}
// AUTH_URL が http なので Cookie 名に __Secure- は付かない
const cookieName = 'authjs.session-token';
const cookies = [];
for (let i = 0; i < Number(count); i++) {
  const id = randomUUID();
  const token = await encode({
    token: { id, email: `perf${i}@example.invalid`, sub: id },
    secret,
    salt: cookieName,
    maxAge: 60 * 60 * 6,
  });
  cookies.push(`${cookieName}=${token}`);
}
writeFileSync(out, JSON.stringify(cookies), { mode: 0o600 });
console.log(`${cookies.length} 人ぶんを ${out} に書いた`);
