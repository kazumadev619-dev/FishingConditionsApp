// ローカルの既存ユーザーとしてログインした状態の Cookie を、curl の cookie jar に書き出す。
//
//   npx dotenv -e .env.local -- node .agents/skills/run-app-locally/session-cookie.mjs <jar> [email]
//
// セッションは JWT 戦略なので、AUTH_SECRET でトークンを作ればパスワードも OAuth も要らない。
// トークンの値は標準出力に出さない（jar のパスだけを出す）。email を省くと最初に作られたユーザーを使う。
import console from 'node:console';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';
import { encode } from 'next-auth/jwt';
import pg from 'pg';

const [jarPath, email] = process.argv.slice(2);
if (!jarPath) {
  console.error('使い方: session-cookie.mjs <cookie jar の出力先> [email]');
  process.exit(2);
}
for (const name of ['DATABASE_URL', 'AUTH_SECRET']) {
  if (!process.env[name]) {
    console.error(`${name} が無い。npx dotenv -e .env.local -- で起動すること`);
    process.exit(2);
  }
}

const baseUrl = new URL(process.env.AUTH_URL ?? 'http://localhost:3000');
const secure = baseUrl.protocol === 'https:';
// Auth.js は HTTPS かどうかでセッション Cookie の名前を変える。salt も Cookie 名と同じにする
const cookieName = `${secure ? '__Secure-' : ''}authjs.session-token`;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = email
  ? await client.query('SELECT id, email FROM users WHERE email = $1', [email.toLowerCase().trim()])
  : await client.query('SELECT id, email FROM users ORDER BY created_at LIMIT 1');
await client.end();

if (rows.length === 0) {
  console.error(
    email
      ? 'そのメールアドレスのユーザーがローカル DB に無い'
      : 'ローカル DB にユーザーが1人もいない',
  );
  process.exit(1);
}
const user = rows[0];

const maxAge = 60 * 60; // 1時間。検証用なので短くする
const token = await encode({
  token: { id: user.id, email: user.email, sub: user.id },
  secret: process.env.AUTH_SECRET,
  salt: cookieName,
  maxAge,
});

const expires = Math.floor(Date.now() / 1000) + maxAge;
try {
  // 作った瞬間から 600 にする（書いてから chmod すると、その間 umask しだいで 644 になる）。
  // 既にあるファイルやシンボリックリンクには書かない（リンク先にトークンを書いてしまうため）
  writeFileSync(
    jarPath,
    `# Netscape HTTP Cookie File\n${baseUrl.hostname}\tFALSE\t/\t${secure ? 'TRUE' : 'FALSE'}\t${expires}\t${cookieName}\t${token}\n`,
    { mode: 0o600, flag: 'wx' },
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.error(`${jarPath} は既にある。上書きしないので、消してから実行するか別のパスを渡すこと`);
  process.exit(1);
}

const [local, domain] = user.email.split('@');
console.log(`cookie jar: ${jarPath}`);
console.log(`ユーザー: ${local.slice(0, 2)}***@${domain}（id ${user.id.slice(0, 8)}…）`);
console.log(`Cookie 名: ${cookieName} / ホスト: ${baseUrl.hostname} / 有効期限: 1時間`);
