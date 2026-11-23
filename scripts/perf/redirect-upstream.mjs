// 性能測定・E2E 用: アプリの fetch のうち、外部 API への要求だけをスタブ（stub.mjs）へ向け替える。
// アプリのコードは変えず、NODE_OPTIONS=--import で読み込む（scripts/perf/docker-compose.yml、scripts/e2e/up.sh）。
// 課金・クォータのある上流を呼ばないための仕組みなので、向け替え対象のホストは必要なときだけ足し（api.resend.com は E2E の登録メール用）、
// 対象外のホストは素通しにしない（外へ出る要求は測定の前提を壊すので、その場で失敗させる）。
import process from 'node:process';
import { URL } from 'node:url';

const STUB = process.env.PERF_STUB_ORIGIN ?? 'http://stub:4000';
const UPSTREAM_HOSTS = new Set([
  'api.openweathermap.org',
  'tide736.net',
  'maps.googleapis.com',
  // E2E の登録メール用。perf では送信しないので影響しない
  'api.resend.com',
]);
const originalFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  // コンテナの HEALTHCHECK（node で localhost:3000/healthz を叩く）も、この fetch を通る
  if (url.hostname === 'localhost') return originalFetch(input, init);
  if (!UPSTREAM_HOSTS.has(url.hostname)) {
    return Promise.reject(
      new Error(`perf: 想定外の外部ホストへの fetch を止めた: ${url.hostname}`),
    );
  }
  return originalFetch(`${STUB}/${url.hostname}${url.pathname}${url.search}`, init);
};
