// 性能測定用の k6 スクリプト（docs/perf/）。条件は環境変数で変える。
//
//   TARGET    floor | scores | tide | weather | locations   測る経路（floor は認証とレート制限だけを通る 400）
//   MODE      cached | uncached     cached は同じ条件を繰り返す。uncached は要求ごとに違うキーにする
//   VUS       同時接続数（既定 10）
//   DURATION  測る時間（既定 30s）。ITERATIONS を指定したら、その要求数で終わる
//   ITERATIONS 総要求数（任意）
//   DELAY_MS  上流スタブの遅延（既定 0）
//   WARMUP    0 にすると、cached の 1 回目の要求（キャッシュに載せる）を省く。同時の初回要求の確かめ用
//
// 結果は標準出力に 1 行（PERF_RESULT {...}）と /perf/out/result-<TARGET>-<MODE>.json に出す。
// 200 以外（429 など）は応答時間の集計に入れず、件数だけ数える。
/* global __ENV, open, console -- k6 の実行環境が与えるグローバル */
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';
import http from 'k6/http';
import { SharedArray } from 'k6/data';

const APP = __ENV.APP_URL || 'http://app:3000';
const STUB = __ENV.STUB_URL || 'http://stub:4000';
const TARGET = __ENV.TARGET || 'scores';
const MODE = __ENV.MODE || 'cached';
const VUS = Number(__ENV.VUS || 10);
const DELAY_MS = Number(__ENV.DELAY_MS || 0);

const cookies = new SharedArray('cookies', () => JSON.parse(open('/perf/out/cookies.json')));

const reqMs = new Trend('req_ms', true); // k6 から見た応答時間（ネットワーク込み）
const serverMs = new Trend('server_ms', true); // Server-Timing の dur（ハンドラ内）
const noTiming = new Counter('n_without_server_timing');
// 指標は init 段階で宣言する必要があるので、数える状態コードを先に決めておく
const statuses = Object.fromEntries(
  [200, 400, 401, 429, 500, 502, 503].map((s) => [s, new Counter(`n_status_${s}`)]),
);
const otherStatus = new Counter('n_status_other');
const count = (status) => (statuses[status] ?? otherStatus).add(1);

export const options = {
  scenarios: {
    load: __ENV.ITERATIONS
      ? {
          executor: 'shared-iterations',
          vus: VUS,
          iterations: Number(__ENV.ITERATIONS),
          maxDuration: '10m',
        }
      : { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION || '30s' },
  },
  // 組み込みの http_req_* は setup の要求も含むので使わない
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// 条件ごとの URL。cached は固定、uncached は i ごとに別のキーになるようにする
function path(i) {
  const cached = MODE === 'cached';
  // 座標は小数 2 桁でキーになる。i から重ならない格子点を作る
  const lat = cached ? '35.68' : (25 + (i % 2000) * 0.01).toFixed(2);
  const lon = cached ? '139.65' : (125 + Math.floor(i / 2000) * 0.01).toFixed(2);
  const port = cached ? '1' : `p${i}`;
  switch (TARGET) {
    case 'floor':
      return '/api/weather?lat=x&lon=y'; // 入力検証で 400。認証とレート制限の後に返る
    case 'scores':
      return `/api/scores?lat=${lat}&lon=${lon}&prefectureCode=13&portCode=${port}`;
    case 'tide':
      return `/api/conditions/tide?prefectureCode=13&portCode=${port}&range=week`;
    case 'weather':
      return `/api/weather?lat=${lat}&lon=${lon}`;
    case 'locations':
      return `/api/locations/search?q=${cached ? 'tokyo' : `perf${i}`}`;
    default:
      throw new Error(`unknown TARGET: ${TARGET}`);
  }
}

export function setup() {
  http.get(`${STUB}/__delay?ms=${DELAY_MS}`);
  http.get(`${STUB}/__reset`);
  if (MODE === 'cached' && TARGET !== 'floor' && __ENV.WARMUP !== '0') {
    // キャッシュに載せる 1 回目。測定には入れない（カスタム指標にだけ記録する）
    const res = http.get(`${APP}${path(0)}`, {
      headers: { Cookie: cookies[0] },
      jar: new http.CookieJar(),
    });
    if (res.status !== 200) throw new Error(`warm-up failed: ${res.status}`);
  }
}

export default function () {
  const i = exec.scenario.iterationInTest;
  const res = http.get(`${APP}${path(i)}`, {
    // 要求ごとに別のユーザー（レート制限はユーザー × ルート単位）
    headers: { Cookie: cookies[i % cookies.length] },
    jar: new http.CookieJar(),
  });
  count(res.status);
  const expected = TARGET === 'floor' ? 400 : 200;
  if (res.status !== expected) return;
  reqMs.add(res.timings.duration);
  const m = /dur=([\d.]+)/.exec(res.headers['Server-Timing'] || '');
  if (m) serverMs.add(Number(m[1]));
  else noTiming.add(1);
}

export function teardown() {
  const stats = http.get(`${STUB}/__stats`).json();
  console.log(`PERF_STUB ${JSON.stringify(stats)}`);
}

export function handleSummary(data) {
  const m = data.metrics;
  const t = (name) => {
    const v = m[name]?.values;
    return (
      v && {
        n: m[name].values.count ?? undefined,
        avg: v.avg,
        med: v.med,
        p90: v['p(90)'],
        p95: v['p(95)'],
        p99: v['p(99)'],
        max: v.max,
      }
    );
  };
  const status = {};
  for (const [k, v] of Object.entries(m)) {
    if (k.startsWith('n_status_')) status[k.slice(9)] = v.values.count;
  }
  const result = {
    target: TARGET,
    mode: MODE,
    vus: VUS,
    delayMs: DELAY_MS,
    seconds: data.state.testRunDurationMs / 1000,
    status,
    withoutServerTiming: m.n_without_server_timing?.values.count ?? 0,
    reqMs: t('req_ms'),
    serverMs: t('server_ms'),
  };
  const ok = status[TARGET === 'floor' ? 400 : 200] ?? 0;
  result.rps = ok / result.seconds;
  const line = `PERF_RESULT ${JSON.stringify(result)}\n`;
  return {
    stdout: line,
    [`/perf/out/result-${TARGET}-${MODE}.json`]: JSON.stringify(result, null, 2),
  };
}
