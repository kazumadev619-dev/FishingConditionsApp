// 実際の外部 API（OpenWeatherMap・tide736・Google Geocoding）の応答時間を、数回だけ測る。
//
//   npx dotenv -e <キーを持つ env ファイル> -- node scripts/perf/upstream-latency.mjs [回数] [間隔ms]
//
// 課金・クォータがあるので、回数は少なく（既定 5）、呼び出しの間隔を置く（既定 1000 ms）。
// キーの値は URL に使うだけで、出力しない。出すのは、API 名・状態コード・応答時間・応答の大きさだけ。
// エラーのときも、メッセージ（URL を含みうる）は出さず、種類だけを出す。
/* global fetch -- Node 組み込み */
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const [count = '5', gap = '1000'] = process.argv.slice(2);
const weatherKey = process.env.OPENWEATHERMAP_API_KEY;
const googleKey = process.env.GOOGLE_MAPS_API_KEY;
if (!weatherKey || !googleKey) {
  console.error('OPENWEATHERMAP_API_KEY と GOOGLE_MAPS_API_KEY が要る（値は出さない）');
  process.exit(2);
}

const today = new Date();
const targets = {
  openweather: () =>
    `https://api.openweathermap.org/data/2.5/weather?lat=35.68&lon=139.65&lang=ja&units=metric&appid=${weatherKey}`,
  tide736: () =>
    `https://tide736.net/api/get_tide.php?pc=13&hc=1&yr=${today.getFullYear()}&mn=${today.getMonth() + 1}&dy=${today.getDate()}&rg=week`,
  geocode: () =>
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent('Tokyo Station, Japan')}&language=ja&key=${googleKey}`,
};

const results = {};
for (const [name, url] of Object.entries(targets)) {
  results[name] = [];
  for (let i = 0; i < Number(count); i++) {
    const start = performance.now();
    try {
      const res = await fetch(url());
      const body = await res.arrayBuffer();
      results[name].push({
        status: res.status,
        ms: performance.now() - start,
        bytes: body.byteLength,
      });
    } catch (error) {
      results[name].push({
        status: `error:${error.name}`,
        ms: performance.now() - start,
        bytes: 0,
      });
    }
    await sleep(Number(gap));
  }
}

for (const [name, rows] of Object.entries(results)) {
  const ok = rows
    .filter((r) => r.status === 200)
    .map((r) => r.ms)
    .sort((a, b) => a - b);
  const bad = rows.filter((r) => r.status !== 200).map((r) => r.status);
  console.log(
    JSON.stringify({
      api: name,
      calls: rows.length,
      nonOk: bad,
      ms: rows.map((r) => Math.round(r.ms)),
      min: Math.round(ok[0] ?? 0),
      median: Math.round(ok[Math.floor(ok.length / 2)] ?? 0),
      max: Math.round(ok.at(-1) ?? 0),
      bytes: rows[0].bytes,
    }),
  );
}
