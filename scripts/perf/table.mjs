// out/results.jsonl（matrix.sh の出力）を、docs/perf/ に貼る Markdown の表にする。
//   node scripts/perf/table.mjs scripts/perf/out/results.jsonl
import console from 'node:console';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const rows = readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .filter((l) => l.includes('PERF_RESULT'))
  .map((l) => JSON.parse(l.slice(l.indexOf('{'))));
// 実行時間が中央値の 1.5 倍を超えた行は印を付ける（Mac のスリープなどで止まった測定を見逃さない）
const sorted = rows.map((r) => r.seconds).sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const f = (n) => (n === undefined ? '-' : n.toFixed(1));
console.log(
  '| 対象 | 条件 | 上流遅延 | VUS | 件数/秒 | 非200 | Server-Timing p50 | p95 | p99 | k6 p50 | p95 | p99 | 実行秒 |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const expected = r.target === 'floor' ? '400' : '200';
  const bad = Object.entries(r.status)
    .filter(([k]) => k !== expected)
    .reduce((a, [, v]) => a + v, 0);
  const s = r.serverMs ?? {};
  const k = r.reqMs ?? {};
  console.log(
    `| ${r.target} | ${r.mode} | ${r.delayMs}ms | ${r.vus} | ${f(r.rps)} | ${bad} | ${f(s.med)} | ${f(s.p95)} | ${f(s.p99)} | ${f(k.med)} | ${f(k.p95)} | ${f(k.p99)} | ${f(r.seconds)}${r.seconds > median * 1.5 ? ' ⚠' : ''} |`,
  );
}
