import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueSlackEvent, flushSlackOutbox, saveSlackWebhook, slackEventId, slackHealth, validateWebhookUrl } from './slack.mjs';

const webhook = 'https://hooks.slack.com/services/T/B/FAKE_TEST_ONLY';
const now = new Date('2026-10-05T01:00:00.000Z');
const event = { type: 'review-approved', issue: 42, pullRequest: 321, headSha: 'a'.repeat(40), occurredAt: now.toISOString() };
let stateRoot: string;
beforeEach(async () => { stateRoot = await mkdtemp(join(tmpdir(), 'factory-slack-test-')); });
afterEach(async () => { await rm(stateRoot, { recursive: true, force: true }); });
const setup = async () => { await saveSlackWebhook(webhook, { stateRoot }); return enqueueSlackEvent(event, { stateRoot }); };
const record = async (id: string) => JSON.parse(await readFile(join(stateRoot, 'slack-outbox', `${id}.json`), 'utf8'));

describe('Slack secret boundary', () => {
  it('accepts only the exact HTTPS Slack webhook shape', () => {
    expect(validateWebhookUrl(webhook)).toBe(webhook);
    for (const value of ['http://hooks.slack.com/services/T/B/X', 'https://hooks.slack.com.evil.test/services/T/B/X', 'https://u@hooks.slack.com/services/T/B/X', `${webhook}?x=1`, `${webhook}#x`, 'https://hooks.slack.com:444/services/T/B/X', 'https://hooks.slack.com/services/T/B/', 'https://hooks.slack.com/services/T/B/%0a', 'not a URL', ` ${webhook}`]) {
      expect(() => validateWebhookUrl(value)).toThrow('invalid Slack webhook URL');
    }
  });
  it('saves a 0600 secret, preserves it when unset, and rejects invalid input without overwrite', async () => {
    await saveSlackWebhook(webhook, { stateRoot });
    await saveSlackWebhook(undefined, { stateRoot });
    await expect(saveSlackWebhook('invalid', { stateRoot })).rejects.toThrow('invalid Slack webhook URL');
    const path = join(stateRoot, 'slack-webhook-url');
    expect(await readFile(path, 'utf8')).toBe(`${webhook}\n`);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await slackHealth({ stateRoot })).toMatchObject({ configured: true, health: 'healthy', outboxPending: 0 });
  });
  it('treats missing secret as disabled without network requests', async () => {
    await enqueueSlackEvent(event, { stateRoot });
    const fetch = vi.fn();
    expect(await flushSlackOutbox({ stateRoot, fetch, now })).toEqual({ outcome: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
    expect(await slackHealth({ stateRoot })).toMatchObject({ configured: false, health: 'unhealthy', outboxPending: 1 });
  });
  it.each(['symlink', 'public', 'invalid'])('refuses a %s secret without exposing it', async (kind) => {
    const path = join(stateRoot, 'slack-webhook-url');
    await writeFile(join(stateRoot, 'target'), `${webhook}\n`, { mode: 0o600 });
    if (kind === 'symlink') await symlink(join(stateRoot, 'target'), path);
    else {
      await writeFile(path, kind === 'invalid' ? 'invalid\n' : `${webhook}\n`, { mode: 0o600 });
      if (kind === 'public') await chmod(path, 0o644);
    }
    const fetch = vi.fn();
    await setupPending();
    expect(await flushSlackOutbox({ stateRoot, fetch, now })).toEqual({ outcome: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
    const health = await slackHealth({ stateRoot });
    expect(health.health).toBe('unhealthy');
    expect(JSON.stringify(health)).not.toContain(webhook);
  });
});
async function setupPending() { return enqueueSlackEvent(event, { stateRoot }); }

describe('durable Slack delivery', () => {
  it('validates fields and derives IDs from identity rather than occurrence time', () => {
    expect(slackEventId(event)).toBe(slackEventId({ ...event, occurredAt: '2026-10-06T01:00:00.000Z' }));
    expect(slackEventId({ ...event, headSha: 'b'.repeat(40) })).not.toBe(slackEventId(event));
    for (const invalid of [{ ...event, body: 'secret' }, { ...event, type: 'unknown' }, { ...event, issue: '../42' }, { ...event, headSha: 'a' }, { ...event, model: 'untrusted' }, { ...event, occurredAt: 'invalid' }, { ...event, reason: '/private/file' }, { ...event, generation: 'free form\ntext' }]) expect(() => slackEventId(invalid)).toThrow('invalid Slack event');
    expect(() => slackEventId({ type: 'task-started', issue: 42, occurredAt: now.toISOString() })).toThrow('invalid Slack event');
  });
  it('publishes one record for concurrent duplicates, preserving attempts and sent receipts', async () => {
    await saveSlackWebhook(webhook, { stateRoot });
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => enqueueSlackEvent(event, { stateRoot })));
    expect(duplicates.filter((x) => x.created)).toHaveLength(1);
    const fetch = vi.fn(async () => ({ ok: false, status: 500 }));
    await flushSlackOutbox({ stateRoot, fetch, now });
    await enqueueSlackEvent(event, { stateRoot });
    expect((await record(duplicates[0].id)).attempts).toBe(1);
    fetch.mockResolvedValue({ ok: true, status: 200 });
    await flushSlackOutbox({ stateRoot, fetch, now: new Date(now.getTime() + 60_000) });
    await enqueueSlackEvent(event, { stateRoot });
    // Drain the recovery event, then re-enqueue and verify only the receipt remains.
    await flushSlackOutbox({ stateRoot, fetch, now: new Date(now.getTime() + 60_000) });
    await flushSlackOutbox({ stateRoot, fetch, now: new Date(now.getTime() + 60_000) });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect((await record(duplicates[0].id)).status).toBe('sent');
    expect((await stat(join(stateRoot, 'slack-outbox', `${duplicates[0].id}.json`))).mode & 0o777).toBe(0o600);
  });
  it('stores success and suppresses resending across fresh calls', async () => {
    const { id } = await setup();
    const text = vi.fn();
    const fetch = vi.fn(async () => ({ ok: true, status: 200, text }));
    expect(await flushSlackOutbox({ stateRoot, fetch, now })).toEqual({ outcome: 'sent', id });
    expect((await record(id)).sentAt).toBe(now.toISOString());
    await enqueueSlackEvent(event, { stateRoot });
    expect(await flushSlackOutbox({ stateRoot, fetch, now })).toEqual({ outcome: 'idle' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
    const options = fetch.mock.calls[0]?.[1] as unknown as RequestInit;
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(options.body)).text).toContain(id.slice(0, 12));
    expect(await slackHealth({ stateRoot })).toMatchObject({ health: 'healthy', outboxPending: 0, lastSuccessAt: now.toISOString() });
  });
  it.each([429, 500, 400])('retains pending status on HTTP %s and respects due time', async (status) => {
    const { id } = await setup();
    const text = vi.fn();
    const fetch = vi.fn(async () => ({ ok: false, status, text, headers: new Headers({ 'Retry-After': '120' }) }));
    expect(await flushSlackOutbox({ stateRoot, fetch, now })).toEqual({ outcome: 'retry', id });
    const pending = await record(id);
    expect(pending.status).toBe('pending');
    expect(pending.nextAttemptAt).toBe(new Date(now.getTime() + (status === 429 ? 120_000 : 60_000)).toISOString());
    expect(await flushSlackOutbox({ stateRoot, fetch, now })).toEqual({ outcome: 'idle' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
    expect((await slackHealth({ stateRoot })).health).toBe('unhealthy');
  });
  it('backs off to 6 hours and never persists thrown error details or response bodies', async () => {
    const { id } = await setup();
    const fetch = vi.fn(async () => { throw new Error(`request ${webhook} failed: PRIVATE_BODY`); });
    let time = now;
    for (const delay of [60, 300, 1800, 3600, 21600, 21600]) {
      await flushSlackOutbox({ stateRoot, fetch, now: time });
      const pending = await record(id);
      expect(Date.parse(pending.nextAttemptAt) - time.getTime()).toBe(delay * 1000);
      time = new Date(Date.parse(pending.nextAttemptAt));
      const saved = JSON.stringify(pending);
      expect(saved).not.toContain(webhook);
      expect(saved).not.toContain('PRIVATE_BODY');
    }
  });
  it('sends at most one of multiple pending events per cycle', async () => {
    await setup();
    await enqueueSlackEvent({ ...event, issue: 43 }, { stateRoot });
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    await flushSlackOutbox({ stateRoot, fetch, now });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await slackHealth({ stateRoot })).outboxPending).toBe(1);
  });
  it('preserves pending state when local sent persistence fails, allowing at-least-once retry', async () => {
    const { id } = await setup();
    const persistRecord = vi.fn(async () => { throw new Error('disk unavailable'); });
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(flushSlackOutbox({ stateRoot, fetch, now, persistRecord })).rejects.toThrow('Slack storage failed');
    expect((await record(id)).status).toBe('pending');
    await flushSlackOutbox({ stateRoot, fetch, now });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await record(id)).status).toBe('sent');
  });
  it('emits one recovery notification and does not recursively create recovery events', async () => {
    await setup();
    const fetch = vi.fn(async () => ({ ok: false, status: 500 }));
    await flushSlackOutbox({ stateRoot, fetch, now });
    fetch.mockResolvedValue({ ok: true, status: 200 });
    const later = new Date(now.getTime() + 60_000);
    await flushSlackOutbox({ stateRoot, fetch, now: later });
    expect((await slackHealth({ stateRoot })).outboxPending).toBe(1);
    fetch.mockResolvedValue({ ok: false, status: 500 });
    await flushSlackOutbox({ stateRoot, fetch, now: later });
    fetch.mockResolvedValue({ ok: true, status: 200 });
    await flushSlackOutbox({ stateRoot, fetch, now: new Date(later.getTime() + 60_000) });
    const all = await readdir(join(stateRoot, 'slack-outbox'));
    expect(all.filter((x) => x.endsWith('.json'))).toHaveLength(2);
    expect((await slackHealth({ stateRoot })).outboxPending).toBe(0);
  });
  it('refuses malformed or symlink outbox records without sending untrusted data', async () => {
    await saveSlackWebhook(webhook, { stateRoot });
    await mkdir(join(stateRoot, 'slack-outbox'));
    await writeFile(join(stateRoot, 'slack-outbox', `${'a'.repeat(64)}.json`), '{"event":{"body":"secret"}}');
    const fetch = vi.fn();
    await expect(flushSlackOutbox({ stateRoot, fetch, now })).rejects.toThrow('invalid Slack outbox');
    expect(fetch).not.toHaveBeenCalled();
  });
});
