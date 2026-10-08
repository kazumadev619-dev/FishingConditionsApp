import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { URL } from 'node:url';

const TYPES = new Set([
  'task-started',
  'pr-created',
  'review-started',
  'review-approved',
  'task-blocked',
  'task-failed',
  'quota-wait',
  'notification-recovered',
]);
const MODELS = new Set(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra']);
const REASONS = new Set(['ci', 'review', 'infrastructure', 'recovery', 'quota']);
const BACKOFF = [60, 300, 1800, 3600, 21600];
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const ID = /^[a-f0-9]{64}$/;
const iso = (value) =>
  typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value));
const positive = (value) => Number.isSafeInteger(value) && value > 0;

export function validateWebhookUrl(value) {
  try {
    if (
      typeof value !== 'string' ||
      !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(
        value,
      )
    )
      throw new Error('shape');
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'hooks.slack.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('shape');
    return url.toString();
  } catch {
    throw new Error('invalid Slack webhook URL');
  }
}

function validateEvent(event) {
  const allowed = [
    'type',
    'issue',
    'pullRequest',
    'headSha',
    'generation',
    'occurredAt',
    'model',
    'reason',
    'pendingCount',
  ];
  if (
    !event ||
    typeof event !== 'object' ||
    Array.isArray(event) ||
    Object.keys(event).some((key) => !allowed.includes(key)) ||
    !TYPES.has(event.type) ||
    !iso(event.occurredAt)
  )
    throw new Error('invalid Slack event');
  if (event.type !== 'notification-recovered' && !positive(event.issue))
    throw new Error('invalid Slack event');
  if (event.pullRequest !== undefined && !positive(event.pullRequest))
    throw new Error('invalid Slack event');
  if (
    event.headSha !== undefined &&
    (typeof event.headSha !== 'string' || !/^[a-f0-9]{40}$/.test(event.headSha))
  )
    throw new Error('invalid Slack event');
  if (
    event.generation !== undefined &&
    !iso(event.generation) &&
    !(typeof event.generation === 'string' && ID.test(event.generation))
  )
    throw new Error('invalid Slack event');
  if (event.model !== undefined && !MODELS.has(event.model)) throw new Error('invalid Slack event');
  if (event.reason !== undefined && !REASONS.has(event.reason))
    throw new Error('invalid Slack event');
  if (
    event.pendingCount !== undefined &&
    (!Number.isSafeInteger(event.pendingCount) || event.pendingCount < 0)
  )
    throw new Error('invalid Slack event');
  if (event.type === 'pr-created' && !positive(event.pullRequest))
    throw new Error('invalid Slack event');
  if (
    ['review-started', 'review-approved'].includes(event.type) &&
    (!positive(event.pullRequest) || !event.headSha)
  )
    throw new Error('invalid Slack event');
  if (
    ['task-started', 'quota-wait', 'notification-recovered'].includes(event.type) &&
    !event.generation
  )
    throw new Error('invalid Slack event');
  if (
    event.type === 'notification-recovered' &&
    (event.issue !== undefined || event.pullRequest !== undefined || event.headSha !== undefined)
  )
    throw new Error('invalid Slack event');
  return event;
}

export function slackEventId(event) {
  validateEvent(event);
  return createHash('sha256')
    .update(
      JSON.stringify([
        event.type,
        event.issue ?? null,
        event.pullRequest ?? null,
        event.headSha ?? null,
        event.generation ?? null,
        event.model ?? null,
        event.reason ?? null,
      ]),
    )
    .digest('hex');
}

async function directory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!(await lstat(path)).isDirectory()) throw new Error('Slack storage failed');
}

async function readPrivate(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 65536 || (info.mode & 0o077) !== 0)
      throw new Error('Slack storage failed');
    return await file.readFile('utf8');
  } finally {
    await file.close();
  }
}

async function atomicWrite(path, value, exclusive = false) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
  try {
    if (exclusive) {
      try {
        await link(temporary, path);
      } catch (error) {
        if (error?.code === 'EEXIST') return false;
        throw error;
      }
    } else await rename(temporary, path);
    return true;
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}

export async function saveSlackWebhook(value, { stateRoot }) {
  if (value === undefined) return;
  const valid = validateWebhookUrl(value);
  try {
    await directory(stateRoot);
    await atomicWrite(join(stateRoot, 'slack-webhook-url'), `${valid}\n`);
  } catch {
    throw new Error('Slack secret save failed');
  }
}

async function readWebhook(stateRoot) {
  try {
    return validateWebhookUrl(
      (await readPrivate(join(stateRoot, 'slack-webhook-url'))).replace(/\n$/, ''),
    );
  } catch {
    return null;
  }
}

export async function enqueueSlackEvent(event, { stateRoot }) {
  const id = slackEventId(event);
  const path = join(stateRoot, 'slack-outbox');
  try {
    await directory(path);
    const created = await atomicWrite(
      join(path, `${id}.json`),
      `${JSON.stringify({ id, event, status: 'pending', attempts: 0, nextAttemptAt: event.occurredAt })}\n`,
      true,
    );
    return { id, created };
  } catch {
    throw new Error('Slack storage failed');
  }
}

async function readRecords(stateRoot) {
  const dir = join(stateRoot, 'slack-outbox');
  let names;
  try {
    if (!(await lstat(dir)).isDirectory()) throw new Error('invalid Slack outbox');
    names = await readdir(dir);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new Error('invalid Slack outbox', { cause: error });
  }
  const records = [];
  for (const name of names.filter((name) => name.endsWith('.json')).sort()) {
    try {
      const record = JSON.parse(await readPrivate(join(dir, name)));
      const keys = [
        'id',
        'event',
        'status',
        'attempts',
        'nextAttemptAt',
        'sentAt',
        'failure',
        'recoveryId',
      ];
      if (
        Object.keys(record).some((key) => !keys.includes(key)) ||
        !ID.test(record.id) ||
        name !== `${record.id}.json` ||
        record.id !== slackEventId(record.event) ||
        !['pending', 'sent'].includes(record.status) ||
        !Number.isSafeInteger(record.attempts) ||
        record.attempts < 0 ||
        !iso(record.nextAttemptAt) ||
        (record.status === 'sent' && !iso(record.sentAt)) ||
        (record.recoveryId !== undefined && !ID.test(record.recoveryId)) ||
        (record.failure !== undefined && !['http', 'network'].includes(record.failure))
      )
        throw new Error('shape');
      records.push(record);
    } catch {
      throw new Error('invalid Slack outbox');
    }
  }
  return records;
}

async function persistRecord(record, { stateRoot }) {
  try {
    await atomicWrite(
      join(stateRoot, 'slack-outbox', `${record.id}.json`),
      `${JSON.stringify(record)}\n`,
    );
  } catch {
    throw new Error('Slack storage failed');
  }
}

function payload(record) {
  const labels = {
    'task-started': 'タスク開始',
    'pr-created': 'PR作成',
    'review-started': '最終レビュー開始',
    'review-approved': '承認待ち',
    'task-blocked': '人の確認が必要',
    'task-failed': '実行基盤の停止',
    'quota-wait': '利用枠の回復待ち',
    'notification-recovered': 'Slack通知復旧',
  };
  const event = record.event;
  return {
    text: [
      `AIファクトリー: ${labels[event.type]}`,
      event.issue ? `Issue #${event.issue}` : '',
      event.pullRequest ? `PR #${event.pullRequest}` : '',
      event.model ?? '',
      event.pendingCount !== undefined ? `未送信 ${event.pendingCount}件` : '',
      `event ${record.id.slice(0, 12)}`,
    ]
      .filter(Boolean)
      .join(' / '),
  };
}

async function enqueueRecovery(record, records, stateRoot, now) {
  await enqueueSlackEvent(
    {
      type: 'notification-recovered',
      generation: record.recoveryId ?? record.id,
      occurredAt: now.toISOString(),
      pendingCount: records.filter((item) => item.status === 'pending' && item.id !== record.id)
        .length,
    },
    { stateRoot },
  );
}

/** @param {{ stateRoot: string, fetch?: (url: string, options: any) => Promise<{ ok: boolean, status: number, headers?: { get: (name: string) => string | null } }>, now?: Date, persistRecord?: (record: any, options: any) => Promise<any> }} options */
// ponytail: sent receipts are retained; prune only after defining a replay horizon.
export async function flushSlackOutbox({
  stateRoot,
  fetch = globalThis.fetch,
  now = new Date(),
  persistRecord: persist = persistRecord,
}) {
  const webhook = await readWebhook(stateRoot);
  if (!webhook) return { outcome: 'disabled' };
  let records = await readRecords(stateRoot);
  // Repair the sent-save/enqueue crash window before selecting this cycle's one delivery.
  for (const sent of records.filter(
    (item) =>
      item.status === 'sent' && item.attempts > 0 && item.event.type !== 'notification-recovered',
  ))
    await enqueueRecovery(sent, records, stateRoot, now);
  records = await readRecords(stateRoot);
  const record = records
    .filter((item) => item.status === 'pending' && Date.parse(item.nextAttemptAt) <= now.getTime())
    .sort(
      (a, b) => a.event.occurredAt.localeCompare(b.event.occurredAt) || a.id.localeCompare(b.id),
    )[0];
  if (!record) return { outcome: 'idle' };
  let response;
  try {
    response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload(record)),
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(10_000),
    });
  } catch {
    response = null;
  }
  const id = record.id;
  if (response?.ok) {
    try {
      await persist({ ...record, status: 'sent', sentAt: now.toISOString() }, { stateRoot });
    } catch {
      throw new Error('Slack storage failed');
    }
    // Derive recovery identity from the failed record, so a recovery retry cannot spawn another.
    if (record.attempts > 0 && record.event.type !== 'notification-recovered') {
      await enqueueRecovery(record, records, stateRoot, now);
    }
    return { outcome: 'sent', id };
  }
  const attempts = record.attempts + 1;
  let seconds = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)];
  if (response?.status === 429) {
    const retry = Number(response.headers?.get('Retry-After'));
    if (Number.isFinite(retry) && retry > 0 && retry <= 86400) seconds = Math.max(seconds, retry);
  }
  const existingOutage = records.find(
    (item) =>
      item.status === 'pending' &&
      item.attempts > 0 &&
      item.event.type !== 'notification-recovered',
  );
  const recoveryId =
    record.recoveryId ?? existingOutage?.recoveryId ?? existingOutage?.id ?? record.id;
  try {
    await persist(
      {
        ...record,
        recoveryId,
        attempts,
        failure: response ? 'http' : 'network',
        nextAttemptAt: new Date(now.getTime() + seconds * 1000).toISOString(),
      },
      { stateRoot },
    );
  } catch {
    throw new Error('Slack storage failed');
  }
  return { outcome: 'retry', id };
}

export async function slackHealth({ stateRoot }) {
  const configured = Boolean(await readWebhook(stateRoot));
  try {
    const records = await readRecords(stateRoot);
    const pending = records.filter((record) => record.status === 'pending');
    const success = records
      .filter((record) => record.status === 'sent')
      .map((record) => record.sentAt)
      .sort();
    return {
      configured,
      health:
        configured && !pending.some((record) => record.attempts > 0) ? 'healthy' : 'unhealthy',
      outboxPending: pending.length,
      oldestPendingAt: pending.map((record) => record.event.occurredAt).sort()[0] ?? null,
      lastSuccessAt: success.at(-1) ?? null,
    };
  } catch {
    return {
      configured,
      health: 'unhealthy',
      outboxPending: null,
      oldestPendingAt: null,
      lastSuccessAt: null,
    };
  }
}

export async function updateSlackIssue(issue, update, { stateRoot }) {
  if (!positive(issue)) throw new Error('invalid Slack event');
  try {
    const dir = join(stateRoot, 'slack-issues');
    await directory(dir);
    const path = join(dir, `${issue}.json`);
    let identity = {};
    try {
      identity = JSON.parse(await readPrivate(path));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const validate = (value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some(
          (key) => !['generation', 'pullRequest', 'headSha', 'quotaGeneration'].includes(key),
        )
      )
        throw new Error('shape');
      if (value.generation !== undefined && !ID.test(value.generation)) throw new Error('shape');
      if (value.quotaGeneration !== undefined && !ID.test(value.quotaGeneration))
        throw new Error('shape');
      if (value.pullRequest !== undefined && !positive(value.pullRequest)) throw new Error('shape');
      if (value.headSha !== undefined && !/^[a-f0-9]{40}$/.test(value.headSha))
        throw new Error('shape');
    };
    validate(identity);
    const next = update(identity);
    validate(next);
    await atomicWrite(path, `${JSON.stringify(next)}\n`);
    return next;
  } catch {
    throw new Error('Slack storage failed');
  }
}
