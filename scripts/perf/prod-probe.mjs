// 本番（Pi）を、負荷を絞って測る。k6 は使わず、間隔を置いた逐次の要求だけを送る。
//
//   PERF_COOKIE_FILE=<「名前=値」を 1 行で書いたファイル> node scripts/perf/prod-probe.mjs <ベース URL> [authed|unauth]
//
// - Cookie の値はファイルから読んでヘッダに入れるだけで、出力しない（エラーにも含めない）
// - skipCache は使わない
// - 止める条件（1 つでも当てはまったら、その場で止めて終了コード 1）: 5xx、429、401/403（authed のとき。
//   unauth は 401 が正常）、接続エラー、1 要求が 5 秒超
// - 結果は 1 条件 1 行の JSON（件数・状態・Server-Timing と全体の応答時間の最小・中央値・最大）
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

/* global fetch -- Node 組み込み */

const [base, mode = 'authed'] = process.argv.slice(2);
if (!base) {
  console.error('使い方: node scripts/perf/prod-probe.mjs <ベース URL> [authed|unauth]');
  process.exit(2);
}
const cookie =
  mode === 'authed' ? readFileSync(process.env.PERF_COOKIE_FILE ?? '', 'utf8').trim() : '';
const expectedOk = mode === 'authed' ? [200, 400] : [401];

class Stop extends Error {}

async function one(path) {
  const start = performance.now();
  let res;
  try {
    res = await fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
    await res.arrayBuffer();
  } catch (error) {
    throw new Stop(`接続エラー: ${error.name} (${path.split('?')[0]})`);
  }
  const ms = performance.now() - start;
  const route = path.split('?')[0];
  if (!expectedOk.includes(res.status)) throw new Stop(`想定外の状態 ${res.status}: ${route}`);
  if (res.status >= 500) throw new Stop(`5xx: ${route}`);
  if (ms > 5000) throw new Stop(`5 秒超 (${Math.round(ms)} ms): ${route}`);
  const st = /dur=([\d.]+)/.exec(res.headers.get('server-timing') ?? '');
  return {
    status: res.status,
    ms,
    st: st ? Number(st[1]) : undefined,
    hit: res.headers.get('x-from-cache'),
  };
}

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const r1 = (n) => (n === undefined ? undefined : Math.round(n * 10) / 10);

// 1 つの条件: paths（要求ごとの URL の列）を、vus 本の接続で、間隔 gapMs を置いて送る
async function run(label, paths, vus, gapMs) {
  const rows = [];
  const queue = [...paths];
  await Promise.all(
    Array.from({ length: vus }, async () => {
      while (queue.length > 0) {
        rows.push(await one(queue.shift()));
        await sleep(gapMs);
      }
    }),
  );
  const ms = rows.map((r) => r.ms);
  const st = rows.map((r) => r.st).filter((v) => v !== undefined);
  console.log(
    JSON.stringify({
      label,
      mode,
      vus,
      gapMs,
      n: rows.length,
      status: Object.fromEntries(
        [...new Set(rows.map((r) => r.status))].map((s) => [
          s,
          rows.filter((r) => r.status === s).length,
        ]),
      ),
      withoutServerTiming: rows.length - st.length,
      fromCache: rows.filter((r) => r.hit === 'true').length,
      serverMs: st.length
        ? { min: r1(Math.min(...st)), med: r1(med(st)), max: r1(Math.max(...st)) }
        : undefined,
      totalMs: { min: r1(Math.min(...ms)), med: r1(med(ms)), max: r1(Math.max(...ms)) },
    }),
  );
}

const rep = (path, n) => Array.from({ length: n }, () => path);
const stamp = Date.now() % 100000; // ミス用のキーを、実行ごとに変える
const same = {
  floor: '/api/weather?lat=x&lon=y',
  weather: '/api/weather?lat=35.68&lon=139.65',
  tide: '/api/conditions/tide?prefectureCode=13&portCode=1&range=week',
  scores: '/api/scores?lat=35.68&lon=139.65&prefectureCode=13&portCode=1',
  locations: '/api/locations/search?q=tokyo',
};
// ミス用: 実際の上流を呼ぶ。座標は小数 2 桁でキーになるので、海上の離れた点にする
const miss = (i) => ({
  weather: `/api/weather?lat=${(30 + i * 0.37 + stamp / 1e5).toFixed(2)}&lon=${(135 + i * 0.41).toFixed(2)}`,
  tide: `/api/conditions/tide?prefectureCode=13&portCode=${2 + i}&range=week`,
  scores: `/api/scores?lat=${(31 + i * 0.37 + stamp / 1e5).toFixed(2)}&lon=${(136 + i * 0.41).toFixed(2)}&prefectureCode=13&portCode=${2 + i}`,
  locations: `/api/locations/search?q=${['osaka', 'sapporo', 'naha'][i]}`,
});

try {
  if (mode === 'unauth') {
    await run('unauth-401', rep(same.weather, 10), 1, 2000);
  } else {
    await run('floor', rep(same.floor, 15), 1, 2000);
    await run('floor', rep(same.floor, 20), 2, 3000);
    for (const name of ['weather', 'tide', 'scores', 'locations']) {
      await run(
        `${name}-miss`,
        [0, 1, 2].map((i) => miss(i)[name]),
        1,
        3000,
      );
      await one(same[name]); // 温め（結果に入れない）
      await sleep(2000);
      await run(`${name}-hit`, rep(same[name], 15), 1, 2000);
      await run(`${name}-hit`, rep(same[name], 20), 2, 3000);
    }
  }
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(`止めた: ${error.message}`);
  process.exit(1);
}
