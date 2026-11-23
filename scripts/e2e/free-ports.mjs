// 空きポートを n 個選んで、空白区切りで出す。up.sh がアプリとスタブのポートに使う。
//
// 空きかどうかは、127.0.0.1 と ::1 の両方で確かめる。macOS では `localhost` が ::1 に引かれ、
// `next start -H localhost` は [::1] だけで待ち受ける。127.0.0.1 だけで確かめると、別の worktree の
// アプリが [::1] で使っているポートを空きと見なし、/healthz がそちらに届いて「起動した」と誤る。
import console from 'node:console';
import net from 'node:net';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const HOSTS = ['127.0.0.1', '::1'];

// そのホストで bind できれば true。IPv6 が無い環境（EADDRNOTAVAIL など）は、そのホストを確かめない
function canBind(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (e) => resolve(['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(e.code)));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

export async function isFree(port) {
  for (const host of HOSTS) if (!(await canBind(port, host))) return false;
  return true;
}

export async function pickFreePorts(n) {
  const ports = [];
  while (ports.length < n) {
    // OS に 127.0.0.1 で選ばせた候補を、::1 でも空いているか確かめる
    const port = await new Promise((resolve) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
    if (!ports.includes(port) && (await isFree(port))) ports.push(port);
  }
  return ports;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log((await pickFreePorts(Number(process.argv[2] ?? 1))).join(' '));
}
