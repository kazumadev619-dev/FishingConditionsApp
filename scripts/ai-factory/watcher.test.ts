import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { acquireLock, readCodexAccount, runOnce, transitionIssue } from './watcher.mjs';

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
}

function respondingChild(responseDelayMs = 0) {
  const child = new FakeChild();
  const messages: unknown[] = [];
  let buffered = '';
  const respond = (message: unknown) => {
    const write = () => child.stdout.write(`${JSON.stringify(message)}\n`);
    if (responseDelayMs === 0) write();
    else setTimeout(write, responseDelayMs);
  };
  child.stdin.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line);
      messages.push(message);
      if (message.id === 1) respond({ id: 1, result: {} });
      if (message.id === 2) {
        respond({
          id: 2,
          result: {
            account: { type: 'chatgpt', email: 'must-not-leak@example.com' },
            requiresOpenaiAuth: true,
          },
        });
      }
      if (message.id === 3) {
        respond({
          id: 3,
          result: {
            ordinaryUsageAllowed: true,
            rateLimits: { primary: { usedPercent: 25, resetsAt: 1_800_000_000 } },
            rateLimitsByLimitId: {
              codex: {
                limitId: 'codex',
                primary: { usedPercent: 25, resetsAt: 1_800_000_000 },
                secondary: null,
              },
            },
            rateLimitResetCredits: { availableCount: 2 },
          },
        });
      }
    }
  });
  return { child, messages };
}

describe('readCodexAccount', () => {
  it('performs the app-server handshake and returns only gate fields', async () => {
    const { child, messages } = respondingChild();
    const spawn = vi.fn(() => child);

    await expect(readCodexAccount({ spawn, timeoutMs: 100 })).resolves.toEqual({
      account: { type: 'chatgpt' },
      ordinaryUsageAllowed: true,
      rateLimits: { primary: { usedPercent: 25, resetsAt: 1_800_000_000 } },
      rateLimitsByLimitId: {
        codex: {
          limitId: 'codex',
          primary: { usedPercent: 25, resetsAt: 1_800_000_000 },
          secondary: null,
        },
      },
    });
    expect(spawn).toHaveBeenCalledWith('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(messages).toEqual([
      {
        method: 'initialize',
        id: 1,
        params: {
          clientInfo: {
            name: 'fishing-conditions-ai-factory',
            title: 'FishingConditions AI Factory',
            version: '1.0.0',
          },
        },
      },
      { method: 'initialized', params: {} },
      { method: 'account/read', id: 2, params: { refreshToken: false } },
      {
        method: 'account/rateLimits/read',
        id: 3,
        params: { excludeResetCreditDetails: true, supportsLunaReserve: false },
      },
    ]);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects malformed JSON', async () => {
    const child = new FakeChild();
    const result = readCodexAccount({ spawn: () => child, timeoutMs: 100 });
    child.stdout.write('not-json\n');

    await expect(result).rejects.toThrow('invalid app-server JSON');
  });

  it('ignores stderr diagnostics without returning their content', async () => {
    const { child } = respondingChild(1);
    const result = readCodexAccount({ spawn: () => child, timeoutMs: 100 });
    child.stderr.write('token-like diagnostic');

    await expect(result).resolves.toMatchObject({
      account: { type: 'chatgpt' },
    });
  });

  it('rejects an early process exit', async () => {
    const child = new FakeChild();
    const result = readCodexAccount({ spawn: () => child, timeoutMs: 100 });
    child.emit('exit', 1, null);

    await expect(result).rejects.toThrow('app-server exited before usage response');
  });

  it('rejects a timeout', async () => {
    const child = new FakeChild();

    await expect(readCodexAccount({ spawn: () => child, timeoutMs: 5 })).rejects.toThrow(
      'app-server usage request timed out',
    );
  });
});

describe('watcher dry-run', () => {
  it('reads GitHub and usage without writing or starting Codex', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const command = vi.fn(async (file: string, args: string[]) => {
      calls.push({ file, args });
      if (args[0] === 'issue' && args[1] === 'list') {
        return {
          stdout: JSON.stringify([
            {
              number: 3,
              title: 'Update docs',
              body: 'Small documentation change',
              labels: [{ name: 'agent:ready' }],
              url: 'https://example.test/issues/3',
            },
          ]),
        };
      }
      throw new Error(`unexpected command: ${file} ${args.join(' ')}`);
    });

    await expect(
      runOnce({
        dryRun: true,
        command,
        readAccount: async () => ({
          account: { type: 'chatgpt' },
          ordinaryUsageAllowed: true,
          rateLimits: { primary: { usedPercent: 79, resetsAt: 1_800_000_000 } },
        }),
      }),
    ).resolves.toMatchObject({
      mode: 'dry-run',
      issue: 3,
      usage: { allowed: true, remainingPercent: 21 },
      branch: 'codex/issue-3',
      worktreeId: 'issue-3',
      nextState: 'agent:running',
      model: 'gpt-5.6-terra',
    });
    expect(calls.some(({ args }) => args.includes('edit'))).toBe(false);
    expect(calls.some(({ args }) => args.includes('--method'))).toBe(false);
    expect(calls.some(({ file, args }) => file === 'codex' && args[0] === 'exec')).toBe(false);
  });
});

describe('watcher lock', () => {
  it('rejects a duplicate live lock and replaces a stale lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-lock-'));
    try {
      const first = await acquireLock(root, { pid: 123, isPidAlive: () => true });
      await expect(acquireLock(root, { pid: 456, isPidAlive: () => true })).resolves.toMatchObject({
        acquired: false,
        reason: 'already-running',
      });
      await first.release();

      await writeFile(join(root, 'watcher.lock'), '123\n');
      await expect(acquireLock(root, { pid: 456, isPidAlive: () => false })).resolves.toMatchObject(
        { acquired: true },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed for an invalid lock PID', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-lock-'));
    try {
      await writeFile(join(root, 'watcher.lock'), 'not-a-pid\n');
      await expect(acquireLock(root)).resolves.toMatchObject({
        acquired: false,
        reason: 'invalid-lock',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('GitHub state transitions', () => {
  it('re-reads the state before and after the label edit', async () => {
    const states = ['agent:ready', 'agent:running'];
    const calls: string[][] = [];
    const command = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ labels: [{ name: states.shift() }] }) };
      }
      if (args[0] === 'issue' && args[1] === 'edit') return { stdout: '' };
      throw new Error('unexpected command');
    });

    await expect(
      transitionIssue(3, 'agent:ready', 'agent:running', { command }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      ['issue', 'view', '3', '--json', 'labels'],
      ['issue', 'edit', '3', '--remove-label', 'agent:ready', '--add-label', 'agent:running'],
      ['issue', 'view', '3', '--json', 'labels'],
    ]);
  });
});
