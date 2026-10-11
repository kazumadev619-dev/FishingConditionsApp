import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import process from 'node:process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 86400000;
const HASH = /^[a-f0-9]{64}$/;
const MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'];
const STAGES = ['planning', 'running', 'ci', 'review'];
const REASONS = [
  'dependency',
  'conflict',
  'quota',
  'ci',
  'review',
  'infrastructure',
  'recovery',
  'validation',
  'http',
  'network',
];
const TYPES = [
  'stage-started',
  'stage-finished',
  'wait-started',
  'wait-finished',
  'task-started',
  'pr-created',
  'approval',
  'blocked',
  'failed',
  'retry',
  'recovery',
  'escalation',
  'slack-enqueued',
  'slack-sent',
  'slack-retry',
  'slack-recovered',
  'ci-passed',
  'ci-failed',
];
export const REPORT_ROOT = join(
  homedir(),
  'Library',
  'Application Support',
  'FishingConditionsApp',
  'ai-factory',
);
const iso = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
function dateName(name) {
  return /^\d{4}-\d\d-\d\d\.jsonl$/.test(name) && iso(`${name.slice(0, 10)}T00:00:00.000Z`);
}

export function validateFactoryEvent(input) {
  const event = Object.fromEntries(Object.entries(input ?? {}).filter(([, v]) => v !== undefined));
  const allowed = [
    'version',
    'id',
    'type',
    'at',
    'issue',
    'pullRequest',
    'headSha',
    'generation',
    'attempt',
    'stage',
    'model',
    'outcome',
    'reason',
    'deliveryId',
  ];
  const fail = () => {
    throw new Error('invalid factory observation');
  };
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(event).some((k) => !allowed.includes(k)) ||
    !TYPES.includes(event.type) ||
    !iso(event.at)
  )
    fail();
  if (event.version !== undefined && event.version !== 1) fail();
  if (event.issue !== undefined && !positive(event.issue)) fail();
  if (event.pullRequest !== undefined && !positive(event.pullRequest)) fail();
  if (
    event.headSha !== undefined &&
    (typeof event.headSha !== 'string' || !/^[a-f0-9]{40}$/.test(event.headSha))
  )
    fail();
  if (
    event.generation !== undefined &&
    (typeof event.generation !== 'string' || !HASH.test(event.generation))
  )
    fail();
  if (
    event.deliveryId !== undefined &&
    (typeof event.deliveryId !== 'string' || !HASH.test(event.deliveryId))
  )
    fail();
  if (event.attempt !== undefined && (!positive(event.attempt) || event.attempt > 3)) fail();
  if (event.model !== undefined && !MODELS.includes(event.model)) fail();
  if (event.stage !== undefined && !STAGES.includes(event.stage)) fail();
  if (event.reason !== undefined && !REASONS.includes(event.reason)) fail();
  if (
    event.outcome !== undefined &&
    ![
      'planned',
      'ready',
      'approved',
      'blocked',
      'failed',
      'retryable',
      'changes-required',
      'escalate',
      'passed',
    ].includes(event.outcome)
  )
    fail();
  const stage = event.type.startsWith('stage-');
  const wait = event.type.startsWith('wait-');
  const slack = event.type.startsWith('slack-');
  if (
    stage &&
    (!event.issue ||
      !event.stage ||
      !event.generation ||
      !event.attempt ||
      (event.stage !== 'ci' && !event.model))
  )
    fail();
  if (event.type === 'stage-finished' && !event.outcome) fail();
  if (
    wait &&
    (!event.issue ||
      !event.generation ||
      !['dependency', 'conflict', 'quota', 'ci'].includes(event.reason))
  )
    fail();
  if (slack && !event.deliveryId) fail();
  if (!slack && !event.issue) fail();
  if (!stage && ['stage', 'attempt', 'outcome'].some((k) => event[k] !== undefined)) fail();
  if (wait && ['model', 'pullRequest', 'deliveryId'].some((k) => event[k] !== undefined)) fail();
  if (!slack && !wait && !stage && !event.generation) fail();
  const identity = [
    event.type,
    event.issue ?? null,
    event.pullRequest ?? null,
    event.headSha ?? null,
    event.generation ?? null,
    event.attempt ?? null,
    event.stage ?? null,
    event.model ?? null,
    event.outcome ?? null,
    event.reason ?? null,
    event.deliveryId ?? null,
  ];
  const id = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  if (event.id !== undefined && event.id !== id) fail();
  return { ...event, version: 1, id };
}
async function directory(path, create = false) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid()
  )
    throw new Error('factory observation storage failed');
}
async function privateOpen(path, flags) {
  const file = await open(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      info.uid !== process.getuid() ||
      info.size > 16 * 1024 * 1024
    )
      throw new Error('factory observation storage failed');
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}
export async function appendFactoryEvent(input, { stateRoot = REPORT_ROOT } = {}) {
  const event = validateFactoryEvent(input);
  const dir = join(stateRoot, 'events');
  await directory(dir, true);
  const file = await privateOpen(
    join(dir, `${event.at.slice(0, 10)}.jsonl`),
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT,
  );
  try {
    await file.writeFile(`${JSON.stringify(event)}\n`);
  } finally {
    await file.close();
  }
  return event;
}
export async function readFactoryEvents({ stateRoot = REPORT_ROOT } = {}) {
  const dir = join(stateRoot, 'events');
  const events = [];
  const errors = [];
  try {
    const file = await privateOpen(join(stateRoot, 'observation-incomplete'), constants.O_RDONLY);
    await file.close();
    errors.push('observation-loss');
  } catch (error) {
    if (error.code !== 'ENOENT') errors.push('observation-health');
  }
  let names;
  try {
    await directory(dir);
    names = await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return { events, incomplete: errors.length > 0, errors };
    return { events, incomplete: true, errors: ['storage'] };
  }
  if (names.length > 1000) return { events, incomplete: true, errors: ['file-limit'] };
  for (const name of names.sort().filter(dateName)) {
    let text;
    try {
      const file = await privateOpen(join(dir, name), constants.O_RDONLY);
      try {
        text = await file.readFile('utf8');
      } finally {
        await file.close();
      }
    } catch {
      errors.push(name);
      continue;
    }
    const lines = text.split('\n');
    if (lines.pop() !== '') errors.push(`${name}:incomplete`);
    if (lines.length > 100000) {
      errors.push(`${name}:line-limit`);
      continue;
    }
    if (events.length + lines.length > 100000) {
      errors.push(`${name}:total-limit`);
      break;
    }
    for (let i = 0; i < lines.length; i++) {
      try {
        if (lines[i].length > 4096) throw new Error('line-limit');
        const event = validateFactoryEvent(JSON.parse(lines[i]));
        if (event.at.slice(0, 10) !== name.slice(0, 10)) throw new Error('date');
        events.push(event);
      } catch {
        errors.push(`${name}:${i + 1}`);
      }
    }
  }
  return { events, incomplete: errors.length > 0, errors };
}
export async function pruneFactoryEvents({ stateRoot = REPORT_ROOT, now = new Date() } = {}) {
  const dir = join(stateRoot, 'events');
  try {
    await directory(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  for (const name of await readdir(dir)) {
    if (!dateName(name) || today - Date.parse(`${name.slice(0, 10)}T00:00:00.000Z`) <= 35 * DAY)
      continue;
    const path = join(dir, name);
    const info = await lstat(path);
    if (info.isFile() && !info.isSymbolicLink()) await unlink(path);
  }
}
const pairKey = (e) =>
  JSON.stringify([
    e.issue,
    e.stage ?? e.reason,
    e.generation,
    e.attempt ?? null,
    e.headSha ?? null,
    e.model ?? null,
  ]);
export function aggregateFactoryReport(events, { from, to, incomplete = false }) {
  if (!iso(from) || !iso(to) || from >= to) throw new Error('invalid report interval');
  const left = Date.parse(from),
    right = Date.parse(to);
  const counts = {
    started: 0,
    pullRequests: 0,
    approvals: 0,
    blocked: 0,
    failed: 0,
    retries: 0,
    recoveries: 0,
    slackFailures: 0,
  };
  /** @type {Record<string, number>} */
  const models = {},
    reasons = {},
    waitDurations = /** @type {Record<string, number>} */ ({}),
    durations = {},
    starts = new Map(),
    seen = new Set(),
    stalled = new Set(),
    outages = new Set(),
    solReviews = new Set(),
    reviewCohort = new Set(),
    escalatedReviews = new Set();
  let invalid = 0,
    escalations = 0;
  const valid = [];
  for (const raw of events) {
    try {
      valid.push(validateFactoryEvent(raw));
    } catch {
      invalid++;
    }
  }
  for (const e of valid.sort((a, b) => a.at.localeCompare(b.at))) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const at = Date.parse(e.at);
    if (at >= right) continue;
    const inside = at >= left;
    const key = pairKey(e);
    const reviewKey = JSON.stringify([e.issue, e.generation, e.headSha ?? null]);
    if (e.type === 'stage-started' || e.type === 'wait-started') {
      if (starts.has(key)) invalid++;
      else starts.set(key, e);
      if (inside && e.model) models[e.model] = (models[e.model] ?? 0) + 1;
      if (e.stage === 'review' && e.model === 'gpt-5.6-sol') {
        solReviews.add(reviewKey);
        if (inside) reviewCohort.add(reviewKey);
      }
    } else if (e.type === 'stage-finished' || e.type === 'wait-finished') {
      const start = starts.get(key);
      if (!start || start.type.replace('started', 'finished') !== e.type) {
        if (inside) invalid++;
        continue;
      }
      starts.delete(key);
      if (inside && e.stage === 'review' && e.model === 'gpt-5.6-sol') reviewCohort.add(reviewKey);
      if (e.type === 'wait-finished')
        waitDurations[e.reason] =
          (waitDurations[e.reason] ?? 0) + Math.max(0, at - Math.max(left, Date.parse(start.at)));
      else if (inside) (durations[e.stage] ??= []).push(at - Date.parse(start.at));
    }
    if (e.type === 'slack-retry') outages.add(e.deliveryId);
    if (e.type === 'slack-sent' || e.type === 'slack-recovered') outages.delete(e.deliveryId);
    if (!inside) continue;
    const counter = {
      'task-started': 'started',
      'pr-created': 'pullRequests',
      approval: 'approvals',
      blocked: 'blocked',
      failed: 'failed',
      retry: 'retries',
      recovery: 'recoveries',
      'slack-retry': 'slackFailures',
    }[e.type];
    if (counter) counts[counter]++;
    if (['blocked', 'failed', 'slack-retry', 'ci-failed'].includes(e.type) && e.reason)
      reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
    if (e.type === 'escalation') {
      escalations++;
      if (solReviews.has(reviewKey)) {
        reviewCohort.add(reviewKey);
        escalatedReviews.add(reviewKey);
      } else invalid++;
    }
  }
  for (const start of starts.values()) {
    if (start.type === 'wait-started')
      waitDurations[start.reason] =
        (waitDurations[start.reason] ?? 0) + right - Math.max(left, Date.parse(start.at));
    if (right - Date.parse(start.at) >= 24 * 3600000) stalled.add(start.issue);
  }
  /** @type {Record<string, {medianMs:number,maxMs:number,count:number}>} */
  const stageDurations = {};
  for (const [stage, values] of Object.entries(durations)) {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    stageDurations[stage] = {
      medianMs: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
      maxMs: values.at(-1),
      count: values.length,
    };
  }
  const stalledIssues = [...stalled].sort((a, b) => a - b);
  const improvementSignals = [
    ...stalledIssues.map((issue) => ({ type: 'stalled', issue })),
    ...Object.entries(reasons)
      .filter(([, count]) => count >= 3)
      .map(([reason, count]) => ({ type: 'repeated', reason, count })),
    ...(outages.size ? [{ type: 'slack-unrecovered', count: outages.size }] : []),
  ];
  return {
    from,
    to,
    counts,
    stageDurations,
    models,
    reasons,
    waitDurations,
    escalations,
    escalationRate: reviewCohort.size ? escalatedReviews.size / reviewCohort.size : 0,
    stalledIssues,
    improvementSignals,
    invalid,
    incomplete: incomplete || invalid > 0 || starts.size > 0,
    unfinished: starts.size,
  };
}
export function renderFactoryReport(report) {
  return [
    `AIファクトリーレポート ${report.from} ～ ${report.to}`,
    ...Object.entries(report.counts).map(([key, count]) => `${key}: ${count}件`),
    ...Object.entries(report.stageDurations).map(
      ([stage, d]) => `${stage}: 中央値 ${d.medianMs}ms / 最長 ${d.maxMs}ms`,
    ),
    `モデル: ${JSON.stringify(report.models)}`,
    `待機(ms): ${JSON.stringify(report.waitDurations)}`,
    `原因: ${JSON.stringify(report.reasons)}`,
    `Astra昇格: ${report.escalations}件 / ${Math.round(report.escalationRate * 100)}%`,
    `停滞: ${report.stalledIssues.length ? report.stalledIssues.map((n) => `#${n}`).join(', ') : '0件'}`,
    `改善要確認: ${report.improvementSignals.length}件`,
    `観測: ${report.incomplete ? '不完全' : '正常'} / 未完了 ${report.unfinished}件 / 不明 ${report.invalid}件`,
  ].join('\n');
}
export function previousTokyoWeek(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type).value;
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  const monday = date.getTime() - offset * DAY;
  return {
    week: new Date(monday - 7 * DAY).toISOString().slice(0, 10),
    from: new Date(monday - 7 * DAY - 9 * 3600000).toISOString(),
    to: new Date(monday - 9 * 3600000).toISOString(),
  };
}
export function weeklyReportDue(now = new Date()) {
  const week = previousTokyoWeek(now);
  return now.getTime() >= Date.parse(week.to) + 9 * 3600000;
}

/** @param {number} issue @param {string} reason @param {boolean} waiting @param {{stateRoot?:string,now?:Date,headSha?:string,outcome?:string}} [options] */
export async function updateFactoryWait(
  issue,
  reason,
  waiting,
  { stateRoot = REPORT_ROOT, now = new Date(), headSha, outcome = 'passed' } = {},
) {
  if (!positive(issue) || !['dependency', 'conflict', 'quota', 'ci'].includes(reason))
    throw new Error('invalid wait');
  const dir = join(stateRoot, 'observation-waits');
  await directory(dir, true);
  const path = join(dir, `${issue}-${reason}.json`);
  let current;
  let recorded = false;
  const persistWait = async (event, saved) => {
    const temp = `${path}.tmp-${randomUUID()}`;
    await writeFile(temp, JSON.stringify({ event, recorded: saved }), { flag: 'wx', mode: 0o600 });
    try {
      await rename(temp, path);
    } finally {
      await unlink(temp).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  };
  try {
    const file = await privateOpen(path, constants.O_RDONLY);
    try {
      const envelope = JSON.parse(await file.readFile('utf8'));
      if (
        !envelope ||
        Object.keys(envelope).length !== 2 ||
        typeof envelope.recorded !== 'boolean' ||
        !envelope.event
      )
        throw new Error('invalid wait envelope');
      current = envelope.event;
      recorded = envelope.recorded;
    } finally {
      await file.close();
    }
    current = validateFactoryEvent(current);
    if (current.type !== 'wait-started' || current.issue !== issue || current.reason !== reason)
      throw new Error('invalid wait');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const finish = async (record, result) => {
    await appendFactoryEvent(
      { ...record, id: undefined, type: 'wait-finished', at: now.toISOString() },
      { stateRoot },
    );
    if (reason === 'ci')
      await appendFactoryEvent(
        {
          type: 'stage-finished',
          issue,
          stage: 'ci',
          generation: record.generation,
          attempt: 1,
          headSha: record.headSha,
          outcome: result,
          at: now.toISOString(),
        },
        { stateRoot },
      );
    await unlink(path);
  };
  if (current && reason === 'ci' && current.headSha !== headSha) {
    await finish(current, 'blocked');
    current = undefined;
    recorded = false;
  }
  if (waiting && !current) {
    current = validateFactoryEvent({
      type: 'wait-started',
      issue,
      reason,
      ...(reason === 'ci' ? { headSha } : {}),
      generation: createHash('sha256').update(randomUUID()).digest('hex'),
      at: now.toISOString(),
    });
    await persistWait(current, false);
  }
  if (!current) return;
  if (!recorded) {
    await appendFactoryEvent(current, { stateRoot });
    if (reason === 'ci')
      await appendFactoryEvent(
        {
          type: 'stage-started',
          issue,
          stage: 'ci',
          generation: current.generation,
          attempt: 1,
          headSha: current.headSha,
          at: current.at,
        },
        { stateRoot },
      );
    await persistWait(current, true);
  }
  if (!waiting) await finish(current, outcome);
}

export async function enqueueWeeklyReport({
  stateRoot = REPORT_ROOT,
  now = new Date(),
  enqueue,
} = {}) {
  if (!weeklyReportDue(now)) return { due: false };
  const week = previousTokyoWeek(now);
  const observations = await readFactoryEvents({ stateRoot });
  const report = aggregateFactoryReport(observations.events, {
    ...week,
    incomplete: observations.incomplete,
  });
  const { enqueueSlackEvent, readWeeklySnapshot } = await import('./slack.mjs');
  const result = await (enqueue ?? enqueueSlackEvent)(
    { type: 'weekly-report', week: week.week, report, occurredAt: now.toISOString() },
    { stateRoot },
  );
  const snapshot =
    !result.created && !enqueue ? await readWeeklySnapshot(week.week, { stateRoot }) : report;
  return { due: true, report: snapshot, ...result };
}
export async function reportMain(
  args = process.argv.slice(2),
  { stateRoot = REPORT_ROOT, now = new Date(), enqueue } = {},
) {
  if (args.length > 1 || args.some((arg) => arg !== '--send'))
    throw new Error('use factory:report [--send]');
  if (args.includes('--send')) {
    const result = await enqueueWeeklyReport({ stateRoot, now, enqueue });
    return result.due
      ? `${renderFactoryReport(result.report)}\n週次通知: ${result.created ? '予約済み' : '予約済みIDを保持'}`
      : '週次通知: 月曜09:00以降に実行してください';
  }
  const observations = await readFactoryEvents({ stateRoot });
  return renderFactoryReport(
    aggregateFactoryReport(observations.events, {
      from: new Date(now.getTime() - 7 * DAY).toISOString(),
      to: now.toISOString(),
      incomplete: observations.incomplete,
    }),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  reportMain()
    .then((text) => process.stdout.write(`${text}\n`))
    .catch(() => {
      process.stderr.write('factory report failed\n');
      process.exitCode = 1;
    });

export function validateWeeklySnapshot(week, report) {
  const fail = () => {
    throw new Error('invalid weekly report');
  };
  if (
    typeof week !== 'string' ||
    !iso(`${week}T00:00:00.000Z`) ||
    new Date(`${week}T00:00:00Z`).getUTCDay() !== 1
  )
    fail();
  const period = previousTokyoWeek(new Date(Date.parse(`${week}T00:00:00Z`) + 7 * DAY));
  const keys = [
    'from',
    'to',
    'counts',
    'stageDurations',
    'models',
    'reasons',
    'waitDurations',
    'escalations',
    'escalationRate',
    'stalledIssues',
    'improvementSignals',
    'invalid',
    'incomplete',
    'unfinished',
  ];
  if (
    !report ||
    Object.keys(report).length !== keys.length ||
    Object.keys(report).some((k) => !keys.includes(k)) ||
    report.from !== period.from ||
    report.to !== period.to
  )
    fail();
  const num = (n) =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
  const map = (value, allowed) => {
    if (
      !value ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !allowed.includes(k) || !num(value[k]))
    )
      fail();
  };
  const counts = [
    'started',
    'pullRequests',
    'approvals',
    'blocked',
    'failed',
    'retries',
    'recoveries',
    'slackFailures',
  ];
  map(report.counts, counts);
  if (Object.keys(report.counts).length !== counts.length) fail();
  map(report.models, MODELS);
  map(report.reasons, REASONS);
  map(report.waitDurations, ['dependency', 'conflict', 'quota', 'ci']);
  if (!report.stageDurations || Object.keys(report.stageDurations).some((k) => !STAGES.includes(k)))
    fail();
  for (const duration of Object.values(report.stageDurations)) {
    map(duration, ['medianMs', 'maxMs', 'count']);
    if (Object.keys(duration).length !== 3) fail();
  }
  if (
    ![report.escalations, report.escalationRate, report.invalid, report.unfinished].every(num) ||
    typeof report.incomplete !== 'boolean'
  )
    fail();
  if (
    !Array.isArray(report.stalledIssues) ||
    report.stalledIssues.length > 1000 ||
    !report.stalledIssues.every(positive)
  )
    fail();
  if (!Array.isArray(report.improvementSignals) || report.improvementSignals.length > 1100) fail();
  for (const signal of report.improvementSignals) {
    if (signal.type === 'stalled') {
      if (Object.keys(signal).length !== 2 || !positive(signal.issue)) fail();
    } else if (signal.type === 'repeated') {
      if (
        Object.keys(signal).length !== 3 ||
        !REASONS.includes(signal.reason) ||
        !num(signal.count)
      )
        fail();
    } else if (signal.type === 'slack-unrecovered') {
      if (Object.keys(signal).length !== 2 || !num(signal.count)) fail();
    } else fail();
  }
  return report;
}
export function renderWeeklySnapshot(week, report) {
  validateWeeklySnapshot(week, report);
  const reasons = Object.entries(report.reasons)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([reason, count]) => `${reason} ${count}件`)
    .join(', ');
  return [
    `AIファクトリー週次レポート ${week}`,
    `開始 ${report.counts.started} / PR ${report.counts.pullRequests} / 承認待ち ${report.counts.approvals} / blocked ${report.counts.blocked} / failed ${report.counts.failed}`,
    ...Object.entries(report.stageDurations).map(
      ([stage, d]) => `${stage}: 中央値 ${d.medianMs}ms / 最長 ${d.maxMs}ms`,
    ),
    `原因: ${reasons || '0件'}`,
    `停滞: ${
      report.stalledIssues
        .slice(0, 10)
        .map((n) => `#${n}`)
        .join(', ') || '0件'
    } / 省略 ${Math.max(0, report.stalledIssues.length - 10)}件`,
    `改善要確認 ${report.improvementSignals.length}件 / 観測 ${report.incomplete ? '不完全' : '正常'}`,
  ].join('\n');
}

export async function inspectFactoryProcesses(issues, { stateRoot, command }) {
  const interested = issues.filter((issue) =>
    issue.labels.some((label) =>
      [
        'agent:running',
        'agent:recovery',
        'agent:review',
        'agent:blocked',
        'human:approval',
      ].includes(label.name),
    ),
  );
  const counts = { workerProcesses: 0, reviewerProcess: 0 };
  if (!interested.length) return counts;
  try {
    const { parseRunComment, parseReviewComment } = await import('./core.mjs');
    const viewer = (await command('gh', ['api', 'user', '--jq', '.login'])).stdout.trim();
    const repo = (
      await command('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    ).stdout.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(viewer) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
      throw new Error('invalid context');
    for (const issue of interested) {
      const pages = JSON.parse(
        (
          await command('gh', [
            'api',
            `repos/${repo}/issues/${issue.number}/comments`,
            '--paginate',
            '--slurp',
          ])
        ).stdout,
      );
      if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
        throw new Error('invalid comments');
      const records = new Map();
      for (const comment of pages.flat()) {
        if (comment.user?.login !== viewer) continue;
        for (const kind of ['run', 'review']) {
          if (!comment.body?.startsWith(`<!-- ai-factory-${kind}:v1 -->\n`)) continue;
          try {
            const match = comment.body.match(/\n```json\n([^\n]+)\n```\n?$/);
            const parsed = JSON.parse(match?.[1] ?? 'null');
            if (
              kind === 'review' &&
              (!positive(parsed?.pullRequest) ||
                typeof parsed?.headSha !== 'string' ||
                !/^[a-f0-9]{40}$/.test(parsed.headSha) ||
                typeof parsed?.ciFingerprint !== 'string' ||
                !HASH.test(parsed.ciFingerprint))
            )
              throw new Error('invalid reviewer identity');
            const record =
              kind === 'run'
                ? parseRunComment(comment, { issue: issue.number, viewer })
                : parseReviewComment(comment, {
                    issue: issue.number,
                    viewer,
                    pullRequest: parsed?.pullRequest,
                    headSha: parsed?.headSha,
                    ciFingerprint: parsed?.ciFingerprint,
                  });
            records.set(kind, record);
          } catch {
            records.set(kind, null);
          }
        }
      }
      for (const kind of ['run', 'review']) {
        const field = kind === 'run' ? 'workerProcesses' : 'reviewerProcess';
        if (!records.has(kind)) {
          if (
            issue.labels.some((label) =>
              kind === 'run'
                ? ['agent:running', 'agent:recovery'].includes(label.name)
                : label.name === 'agent:review',
            )
          )
            counts[field] = 'unknown';
          continue;
        }
        const record = records.get(kind);
        if (!record) {
          counts[field] = 'unknown';
          continue;
        }
        if (record.status === 'completed') continue;
        const pid = kind === 'run' ? record.runnerPid : record.reviewerPid;
        const runDir =
          kind === 'run'
            ? join(stateRoot, 'runs', `issue-${issue.number}`)
            : join(
                stateRoot,
                'review-runs',
                `issue-${issue.number}-${record.headSha.slice(0, 12)}-${record.model}`,
              );
        let processCommand;
        try {
          processCommand = (await command('ps', ['-p', String(pid), '-o', 'command='])).stdout;
        } catch (error) {
          if (error.code === 1) continue;
          counts[field] = 'unknown';
          continue;
        }
        if (!processCommand.trim()) continue;
        if (
          !/(?:^|[\s/])codex(?:\s|$)/.test(processCommand) ||
          !processCommand.includes(`${runDir}/`)
        ) {
          counts[field] = 'unknown';
          continue;
        }
        try {
          for (const path of [
            stateRoot,
            join(stateRoot, kind === 'run' ? 'runs' : 'review-runs'),
            runDir,
          ]) {
            const info = await lstat(path);
            if (
              !info.isDirectory() ||
              info.isSymbolicLink() ||
              info.uid !== process.getuid() ||
              (info.mode & 0o022) !== 0
            )
              throw new Error('untrusted process evidence');
          }
          const file = await privateOpen(join(runDir, 'codex.jsonl'), constants.O_RDONLY);
          let text;
          try {
            text = await file.readFile('utf8');
          } finally {
            await file.close();
          }
          const threadMatches = text
            .split('\n')
            .slice(0, -1)
            .some((line) => {
              try {
                const event = JSON.parse(line);
                return event.type === 'thread.started' && event.thread_id === record.threadId;
              } catch {
                return false;
              }
            });
          if (!threadMatches) {
            counts[field] = 'unknown';
            continue;
          }
          if (counts[field] !== 'unknown') counts[field]++;
        } catch {
          counts[field] = 'unknown';
        }
      }
    }
    return counts;
  } catch {
    return { workerProcesses: 'unknown', reviewerProcess: 'unknown' };
  }
}

export async function markFactoryObservationFailure({ stateRoot = REPORT_ROOT } = {}) {
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const info = await lstat(stateRoot);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    (info.mode & 0o022) !== 0
  )
    throw new Error('factory observation storage failed');
  const path = join(stateRoot, 'observation-incomplete');
  const file = await privateOpen(path, constants.O_WRONLY | constants.O_CREAT);
  try {
    await file.truncate(0);
    await file.writeFile('observation-loss\n');
  } finally {
    await file.close();
  }
}
