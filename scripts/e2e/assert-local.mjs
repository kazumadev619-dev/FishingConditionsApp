// 接続先がすべて localhost / 127.0.0.1 であることを確かめる。そうでなければ終了コード 2。
// 本番や共有の DB に、migrate・seed・パスワードが公開された E2E ユーザーの投入をしてしまう事故を防ぐ。
// up.sh（E2E_DATABASE_URL / E2E_REDIS_URL）と seed-users.mjs（DATABASE_URL）が使う。URL は1つずつ判定する。
import console from 'node:console';
import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';

export function assertLocal(...urls) {
  for (const u of urls) {
    let host;
    try {
      host = new URL(u).hostname;
    } catch {
      throw new Error('接続先の URL として読めない（値は出さない）');
    }
    if (host !== 'localhost' && host !== '127.0.0.1') {
      throw new Error(`接続先が localhost / 127.0.0.1 ではない: ${host}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assertLocal(...process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
