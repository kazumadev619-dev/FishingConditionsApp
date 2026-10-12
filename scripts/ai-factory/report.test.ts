import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, symlink, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendFactoryEvent,
  readFactoryEvents,
  pruneFactoryEvents,
  aggregateFactoryReport,
  renderFactoryReport,
  validateFactoryEvent,
  previousTokyoWeek,
  weeklyReportDue,
  updateFactoryWait,
  reportMain,
  enqueueWeeklyReport,
} from './report.mjs';
const roots: string[] = [];
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'factory-report-'));
  roots.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const base = {
  type: 'stage-started',
  issue: 42,
  stage: 'running',
  generation: 'a'.repeat(64),
  attempt: 1,
  model: 'gpt-5.6-terra',
  at: '2026-10-05T00:00:00.000Z',
};
describe('factory observations', () => {
  it('validates closed schema and stable identity', () => {
    expect(validateFactoryEvent(base).id).toBe(
      validateFactoryEvent({ ...base, at: '2026-10-05T01:00:00.000Z' }).id,
    );
    for (const extra of [
      { body: 'secret' },
      { issue: 0 },
      { model: 'other' },
      { at: '2026-02-30T00:00:00.000Z' },
      { attempt: 0 },
      { generation: 'free text' },
      { generation: 'a'.repeat(64) + '\n' },
      { headSha: 'a'.repeat(40) + '\n' },
      { reason: 'free text' },
    ])
      expect(() => validateFactoryEvent({ ...base, ...extra })).toThrow();
    expect(() => validateFactoryEvent({ ...base, id: 'b'.repeat(64) })).toThrow();
  });
  it('writes private JSONL and ignores only final incomplete line', async () => {
    const stateRoot = await root();
    await appendFactoryEvent(base, { stateRoot });
    const path = join(stateRoot, 'events', '2026-10-05.jsonl');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const text = await readFile(path, 'utf8');
    await writeFile(path, text + '{"unfinished":', { mode: 0o600 });
    expect((await readFactoryEvents({ stateRoot })).events).toHaveLength(1);
    expect((await readFactoryEvents({ stateRoot })).incomplete).toBe(true);
    await writeFile(path, text + '{"body":"DO_NOT_ECHO"}\n');
    const result = await readFactoryEvents({ stateRoot });
    expect(result.incomplete).toBe(true);
    expect(JSON.stringify(result)).not.toContain('DO_NOT_ECHO');
  });
  it('rejects symlink FIFO and public files without blocking', async () => {
    const stateRoot = await root();
    await mkdir(join(stateRoot, 'events'), { mode: 0o700 });
    const path = join(stateRoot, 'events', '2026-10-05.jsonl');
    const target = join(stateRoot, 'target');
    await writeFile(target, 'KEEP', { mode: 0o600 });
    await symlink(target, path);
    await expect(appendFactoryEvent(base, { stateRoot })).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('KEEP');
    await rm(path);
    execFileSync('mkfifo', [path]);
    await expect(appendFactoryEvent(base, { stateRoot })).rejects.toThrow();
    expect((await readFactoryEvents({ stateRoot })).incomplete).toBe(true);
    await rm(path);
    await writeFile(path, '', { mode: 0o644 });
    await expect(appendFactoryEvent(base, { stateRoot })).rejects.toThrow();
  });
  it('prunes only regular valid daily files older than 35 days', async () => {
    const stateRoot = await root();
    await mkdir(join(stateRoot, 'events'), { mode: 0o700 });
    await writeFile(join(stateRoot, 'events', '2026-09-05.jsonl\n'), 'KEEP');
    for (const day of ['2026-09-05', '2026-09-06', '2026-09-07', '2026-02-30'])
      await writeFile(join(stateRoot, 'events', `${day}.jsonl`), '');
    await mkdir(join(stateRoot, 'events', '2026-01-01.jsonl'));
    await writeFile(join(stateRoot, 'secret'), 'KEEP');
    await pruneFactoryEvents({ stateRoot, now: new Date('2026-10-11T00:00:00.000Z') });
    await expect(stat(join(stateRoot, 'events', '2026-09-05.jsonl'))).rejects.toThrow();
    for (const day of ['2026-09-06', '2026-09-07', '2026-02-30', '2026-01-01'])
      expect(await stat(join(stateRoot, 'events', `${day}.jsonl`))).toBeDefined();
    expect(await readFile(join(stateRoot, 'events', '2026-09-05.jsonl\n'), 'utf8')).toBe('KEEP');
    expect(await readFile(join(stateRoot, 'secret'), 'utf8')).toBe('KEEP');
  });
  it('pairs exact attempts, clips waits, deduplicates and uses even median', () => {
    const event = (fields: Record<string, unknown>) => validateFactoryEvent({ ...base, ...fields });
    const events = [
      event({}),
      event({ type: 'stage-finished', at: '2026-10-05T02:00:00.000Z', outcome: 'ready' }),
      event({ attempt: 2, at: '2026-10-05T03:00:00.000Z' }),
      event({
        attempt: 2,
        type: 'stage-finished',
        at: '2026-10-05T07:00:00.000Z',
        outcome: 'ready',
      }),
      event({
        type: 'wait-started',
        stage: undefined,
        model: undefined,
        attempt: undefined,
        reason: 'quota',
      }),
      event({
        type: 'wait-finished',
        stage: undefined,
        model: undefined,
        attempt: undefined,
        reason: 'quota',
        at: '2026-10-05T04:00:00.000Z',
      }),
    ];
    const report = aggregateFactoryReport([...events, events[0]], {
      from: '2026-10-05T01:00:00.000Z',
      to: '2026-10-07T00:00:00.000Z',
    });
    expect(report.stageDurations.running).toEqual({
      medianMs: 10800000,
      maxMs: 14400000,
      count: 2,
    });
    expect(report.waitDurations.quota).toBe(10800000);
    expect(report.invalid).toBe(0);
    const wrong = aggregateFactoryReport(
      [
        events[0],
        event({
          attempt: 3,
          type: 'stage-finished',
          at: '2026-10-05T07:00:00.000Z',
          outcome: 'ready',
        }),
      ],
      { from: base.at, to: '2026-10-07T00:00:00.000Z' },
    );
    expect(wrong.invalid).toBe(1);
    expect(wrong.stalledIssues).toEqual([42]);
  });
  it('reports empty and unknown data without NaN or Infinity', () => {
    const report = aggregateFactoryReport([], { from: base.at, to: '2026-10-07T00:00:00.000Z' });
    expect(report.counts.started).toBe(0);
    expect(report.escalationRate).toBe(0);
    expect(renderFactoryReport(report)).toContain('0件');
    expect(renderFactoryReport(report)).not.toMatch(/NaN|Infinity/);
  });
  it('uses Tokyo Monday 09:00 and previous week across year boundary', () => {
    expect(weeklyReportDue(new Date('2026-10-11T23:59:00Z'))).toBe(false);
    expect(weeklyReportDue(new Date('2026-10-12T00:00:00Z'))).toBe(true);
    expect(previousTokyoWeek(new Date('2026-01-05T00:00:00Z'))).toEqual({
      week: '2025-12-29',
      from: '2025-12-28T15:00:00.000Z',
      to: '2026-01-04T15:00:00.000Z',
    });
    expect(previousTokyoWeek(new Date('2026-10-14T00:00:00Z')).week).toBe('2026-10-05');
  });
});

describe('weekly report delivery', () => {
  it('persists wait episodes across repeated cycles and ends once', async () => {
    const stateRoot = await root();
    const now = new Date(base.at);
    await updateFactoryWait(42, 'quota', true, { stateRoot, now });
    await updateFactoryWait(42, 'quota', true, { stateRoot, now });
    await updateFactoryWait(42, 'quota', false, {
      stateRoot,
      now: new Date('2026-10-05T01:00:00.000Z'),
    });
    const observations = await readFactoryEvents({ stateRoot });
    expect(observations.events).toHaveLength(2);
    const report = aggregateFactoryReport(observations.events, {
      from: base.at,
      to: '2026-10-06T00:00:00.000Z',
    });
    expect(report.waitDurations.quota).toBe(3600000);
  });
  it('enqueues one snapshot per week without sending HTTP and preserves first snapshot', async () => {
    const stateRoot = await root();
    const now = new Date('2026-10-12T00:00:00Z');
    expect((await enqueueWeeklyReport({ stateRoot, now })).created).toBe(true);
    await appendFactoryEvent(
      { ...base, type: 'task-started', stage: undefined, attempt: undefined },
      { stateRoot },
    );
    expect(
      (await enqueueWeeklyReport({ stateRoot, now: new Date('2026-10-14T00:00:00Z') })).created,
    ).toBe(false);
    const repeated = await reportMain(['--send'], { stateRoot, now });
    expect(repeated).toContain('予約済みID');
    expect(repeated).toContain('started: 0件');
    await expect(reportMain(['--oops'], { stateRoot, now })).rejects.toThrow();
  });
});

it('isolates CI head changes and measures CI duration from durable wait evidence', async () => {
  const stateRoot = await root();
  const headSha = 'a'.repeat(40);
  const at = new Date(base.at);
  await updateFactoryWait(42, 'ci', true, { stateRoot, now: at, headSha });
  await updateFactoryWait(42, 'ci', true, {
    stateRoot,
    now: new Date('2026-10-05T01:00:00.000Z'),
    headSha: 'b'.repeat(40),
  });
  await updateFactoryWait(42, 'ci', false, {
    stateRoot,
    now: new Date('2026-10-05T02:00:00.000Z'),
    headSha: 'b'.repeat(40),
    outcome: 'passed',
  });
  const report = aggregateFactoryReport((await readFactoryEvents({ stateRoot })).events, {
    from: base.at,
    to: '2026-10-06T00:00:00.000Z',
  });
  expect(report.stageDurations.ci).toEqual({ medianMs: 3600000, maxMs: 3600000, count: 2 });
  expect(report.invalid).toBe(0);
  expect(report.stalledIssues).toEqual([]);
});

it('verifies owned runner PID command and local thread, otherwise shows unknown', async () => {
  const { inspectFactoryProcesses } = await import('./report.mjs');
  const { renderRunComment } = await import('./core.mjs');
  const stateRoot = await root();
  const record = {
    issue: 42,
    status: 'running',
    branch: 'codex/issue-42',
    worktreeId: 'issue-42',
    model: 'gpt-5.6-terra',
    planHash: 'a'.repeat(64),
    attempt: 1,
    runnerPid: 1234,
    threadId: 'thread-42',
    heartbeatAt: base.at,
  };
  await mkdir(join(stateRoot, 'runs', 'issue-42'), { recursive: true });
  await writeFile(
    join(stateRoot, 'runs', 'issue-42', 'codex.jsonl'),
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-42' }) + '\n',
    { mode: 0o600 },
  );
  const adapter = async (file: string, args: string[]) => ({
    stdout:
      file === 'ps'
        ? `codex exec --output-last-message ${stateRoot}/runs/issue-42/result.json`
        : args[1] === 'user'
          ? 'factory-bot\n'
          : args[0] === 'repo'
            ? 'owner/repo\n'
            : JSON.stringify([
                [{ id: 1, user: { login: 'factory-bot' }, body: renderRunComment(record) }],
              ]),
  });
  expect(
    await inspectFactoryProcesses([{ number: 42, labels: [{ name: 'agent:running' }] }], {
      stateRoot,
      command: adapter,
    }),
  ).toEqual({ workerProcesses: 1, reviewerProcess: 0 });
  await writeFile(
    join(stateRoot, 'runs', 'issue-42', 'codex.jsonl'),
    JSON.stringify({ type: 'thread.started', thread_id: 'wrong' }) + '\n',
  );
  expect(
    (
      await inspectFactoryProcesses([{ number: 42, labels: [{ name: 'agent:running' }] }], {
        stateRoot,
        command: adapter,
      })
    ).workerProcesses,
  ).toBe('unknown');
});

it('delivers the immutable bounded weekly snapshot and rejects injected text', async () => {
  const { saveSlackWebhook, flushSlackOutbox, slackHealth, enqueueSlackEvent } = await import(
    './slack.mjs'
  );
  const { validateWeeklySnapshot } = await import('./report.mjs');
  const stateRoot = await root();
  const now = new Date('2026-10-12T00:00:00Z');
  const result = await enqueueWeeklyReport({ stateRoot, now });
  const original = await readFile(join(stateRoot, 'slack-outbox', `${result.id}.json`), 'utf8');
  await appendFactoryEvent(
    { ...base, type: 'task-started', stage: undefined, attempt: undefined },
    { stateRoot },
  );
  await enqueueWeeklyReport({ stateRoot, now });
  expect(await readFile(join(stateRoot, 'slack-outbox', `${result.id}.json`), 'utf8')).toBe(
    original,
  );
  const report = JSON.parse(original).event.report;
  expect(() => validateWeeklySnapshot('2026-10-05', { ...report, body: 'SECRET' })).toThrow();
  expect(() =>
    validateWeeklySnapshot('2026-10-05', {
      ...report,
      counts: { ...report.counts, started: Infinity },
    }),
  ).toThrow();
  await expect(
    enqueueSlackEvent(
      { type: 'weekly-report', week: '2026-10-06', report, occurredAt: now.toISOString() },
      { stateRoot },
    ),
  ).rejects.toThrow();
  await saveSlackWebhook('https://hooks.slack.com/services/T/B/FAKE_TEST_ONLY', { stateRoot });
  let text = '';
  expect(
    (
      await flushSlackOutbox({
        stateRoot,
        now,
        fetch: async (_url, options) => {
          text = JSON.parse(options.body).text;
          return { ok: true, status: 200 };
        },
      })
    ).outcome,
  ).toBe('sent');
  expect(text).toContain('開始 0');
  expect(text.length).toBeLessThan(3000);
  expect((await slackHealth({ stateRoot })).lastWeeklySuccessAt).toBe(now.toISOString());
});

it('persists observation loss as incomplete instead of a misleading zero report', async () => {
  const { markFactoryObservationFailure } = await import('./report.mjs');
  const stateRoot = await root();
  await markFactoryObservationFailure({ stateRoot });
  const data = await readFactoryEvents({ stateRoot });
  expect(data.incomplete).toBe(true);
  expect(await reportMain([], { stateRoot, now: new Date('2026-10-12T00:00:00Z') })).toContain(
    '不完全',
  );
});

it('does not truncate a rejected observation marker and handles malformed aggregate inputs', async () => {
  const { markFactoryObservationFailure } = await import('./report.mjs');
  const stateRoot = await root();
  const path = join(stateRoot, 'observation-incomplete');
  await writeFile(path, 'KEEP', { mode: 0o644 });
  await expect(markFactoryObservationFailure({ stateRoot })).rejects.toThrow();
  expect(await readFile(path, 'utf8')).toBe('KEEP');
  expect(
    aggregateFactoryReport([{ type: 'broken' }, { ...base, at: 'invalid' }], {
      from: base.at,
      to: '2026-10-06T00:00:00.000Z',
    }).invalid,
  ).toBe(2);
});

it('counts fixed improvement signals, models and the exact 24-hour stall boundary', () => {
  const generation = (n: number) => n.toString(16).padStart(64, '0');
  const event = (fields: Record<string, unknown>) =>
    validateFactoryEvent({
      type: 'task-started',
      issue: 42,
      generation: generation(1),
      at: base.at,
      ...fields,
    });
  const events = [
    event({}),
    event({ type: 'pr-created', pullRequest: 43 }),
    event({ type: 'approval' }),
    event({ type: 'stage-started', stage: 'review', model: 'gpt-5.6-sol', attempt: 1 }),
    event({ type: 'escalation', model: 'gpt-5.6-sol' }),
    ...Array.from({ length: 3 }, (_, n) =>
      event({ type: 'blocked', reason: 'review', generation: generation(n + 2) }),
    ),
    event({ type: 'slack-retry', deliveryId: 'd'.repeat(64), reason: 'network' }),
  ];
  const options = { from: base.at, to: '2026-10-06T00:00:00.000Z' };
  const report = aggregateFactoryReport(events, options);
  expect(report.counts).toMatchObject({
    started: 1,
    pullRequests: 1,
    approvals: 1,
    blocked: 3,
    slackFailures: 1,
  });
  expect(report.models['gpt-5.6-sol']).toBe(1);
  expect(report.escalationRate).toBe(1);
  expect(report.stalledIssues).toEqual([42]);
  expect(report.improvementSignals).toEqual(
    expect.arrayContaining([
      { type: 'repeated', reason: 'review', count: 3 },
      { type: 'slack-unrecovered', count: 1 },
    ]),
  );
  expect(
    aggregateFactoryReport(events, { ...options, to: '2026-10-05T23:59:59.999Z' }).stalledIssues,
  ).toEqual([]);
  expect(
    aggregateFactoryReport(
      [
        ...events,
        event({ type: 'slack-sent', deliveryId: 'd'.repeat(64), at: '2026-10-05T01:00:00.000Z' }),
      ],
      options,
    ).improvementSignals,
  ).not.toContainEqual({ type: 'slack-unrecovered', count: 1 });
});

it('records loss in an existing owned 0755 factory root', async () => {
  const { chmod } = await import('node:fs/promises');
  const { markFactoryObservationFailure } = await import('./report.mjs');
  const stateRoot = await root();
  await chmod(stateRoot, 0o755);
  await markFactoryObservationFailure({ stateRoot });
  expect((await readFactoryEvents({ stateRoot })).incomplete).toBe(true);
});

it('marks unmatched starts as incomplete', () => {
  const report = aggregateFactoryReport([validateFactoryEvent(base)], {
    from: base.at,
    to: '2026-10-12T00:00:00.000Z',
  });
  expect(report.unfinished).toBe(1);
  expect(report.incomplete).toBe(true);
  expect(renderFactoryReport(report)).toContain('不完全');
});
it('uses the same logical Sol review cohort for cross-week escalations and retries', () => {
  const from = '2026-10-04T15:00:00.000Z',
    to = '2026-10-11T15:00:00.000Z';
  const events = [42, 43].flatMap((issue, index) => {
    const review = {
      ...base,
      issue,
      stage: 'review',
      model: 'gpt-5.6-sol',
      generation: String(issue).padStart(64, '0'),
    };
    const start = index ? '2026-10-05T00:00:00.000Z' : '2026-10-04T14:00:00.000Z';
    const end = index ? '2026-10-05T01:00:00.000Z' : '2026-10-04T15:01:00.000Z';
    return [
      validateFactoryEvent({ ...review, at: start }),
      validateFactoryEvent({ ...review, type: 'stage-finished', at: end, outcome: 'escalate' }),
      validateFactoryEvent({
        ...review,
        type: 'escalation',
        stage: undefined,
        attempt: undefined,
        at: end,
      }),
    ];
  });
  const report = aggregateFactoryReport(events, { from, to });
  expect(report.escalations).toBe(2);
  expect(report.escalationRate).toBe(1);
  expect(report.models['gpt-5.6-sol']).toBe(1);
  expect(report.incomplete).toBe(false);
  const retry = events
    .slice(0, 2)
    .map((e) =>
      validateFactoryEvent({ ...e, id: undefined, attempt: 2, at: '2026-10-05T02:00:00.000Z' }),
    );
  expect(aggregateFactoryReport([...events, ...retry], { from, to }).escalationRate).toBe(1);
});
it.each(['pullRequest', 'headSha', 'ciFingerprint', 'parent'])(
  'rejects untrusted reviewer %s evidence',
  async (field) => {
    const { inspectFactoryProcesses } = await import('./report.mjs');
    const { renderReviewComment } = await import('./core.mjs');
    const stateRoot = await root();
    const record = {
      issue: 42,
      pullRequest: 43,
      headSha: 'a'.repeat(40),
      ciFingerprint: 'b'.repeat(64),
      model: 'gpt-5.6-sol',
      status: 'running',
      reviewerPid: 1234,
      threadId: 'fixture-thread',
      heartbeatAt: base.at,
    };
    const malformed = {
      ...record,
      ...(field === 'parent'
        ? {}
        : { [field]: field === 'headSha' ? '/../outside/' : 'not-valid' }),
    };
    const runDir = join(
      stateRoot,
      'review-runs',
      `issue-42-${malformed.headSha.slice(0, 12)}-${record.model}`,
    );
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(runDir, 'codex.jsonl'),
      JSON.stringify({ type: 'thread.started', thread_id: record.threadId }) + '\n',
      { mode: 0o600 },
    );
    if (field === 'parent') await chmod(join(stateRoot, 'review-runs'), 0o777);
    const command = async (file: string, args: string[]) => ({
      stdout:
        file === 'ps'
          ? `codex exec --output-last-message ${runDir}/result.json`
          : args[1] === 'user'
            ? 'factory-bot\n'
            : args[0] === 'repo'
              ? 'owner/repo\n'
              : JSON.stringify([
                  [{ id: 1, user: { login: 'factory-bot' }, body: renderReviewComment(malformed) }],
                ]),
    });
    expect(
      (
        await inspectFactoryProcesses([{ number: 42, labels: [{ name: 'agent:review' }] }], {
          stateRoot,
          command,
        })
      ).reviewerProcess,
    ).toBe('unknown');
  },
);

it('does not fabricate a rate for escalations with missing Sol starts', () => {
  const known = { ...base, stage: 'review', model: 'gpt-5.6-sol' };
  const events = [
    validateFactoryEvent(known),
    validateFactoryEvent({ ...known, type: 'escalation', stage: undefined, attempt: undefined }),
    validateFactoryEvent({
      ...known,
      issue: 43,
      type: 'escalation',
      stage: undefined,
      attempt: undefined,
    }),
  ];
  const report = aggregateFactoryReport(events, { from: base.at, to: '2026-10-06T00:00:00.000Z' });
  expect(report.escalations).toBe(2);
  expect(report.escalationRate).toBe(1);
  expect(report.incomplete).toBe(true);
  expect(report.invalid).toBe(1);
});
