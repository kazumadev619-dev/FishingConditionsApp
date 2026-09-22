import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  acquireLock,
  executeIssue,
  readCodexAccount,
  runOnce,
  transitionIssue,
} from './watcher.mjs';

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
      const replacement = await acquireLock(root, { pid: 456, isPidAlive: () => false });
      expect(replacement).toMatchObject({ acquired: true });
      await replacement.release();
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

describe('single Terra runner', () => {
  function pipelineCommand(states: string[], runnerCalls: Array<{ file: string; args: string[] }>) {
    let prReads = 0;
    return vi.fn(async (file: string, args: string[]) => {
      runnerCalls.push({ file, args });
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ labels: [{ name: states.shift() }] }) };
      }
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'list') return { stdout: '' };
      if (file === 'git' && args[0] === 'show-ref') {
        throw Object.assign(new Error('missing branch'), { code: 1 });
      }
      if (file === 'git' && args[0] === 'status') {
        return { stdout: ' M docs/README.md\0' };
      }
      if (file === 'git' && args[0] === 'diff') return { stdout: 'docs/README.md\n' };
      if (file === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        prReads += 1;
        return {
          stdout: JSON.stringify(
            prReads === 1
              ? []
              : [{ number: 99, url: 'https://example.test/pull/99', state: 'OPEN' }],
          ),
        };
      }
      return { stdout: '' };
    });
  }

  it('runs fixed verification and creates one develop PR after the running transition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-run-'));
    const calls: Array<{ file: string; args: string[] }> = [];
    const command = pipelineCommand(
      ['agent:ready', 'agent:running', 'agent:running', 'agent:review'],
      calls,
    );
    try {
      await expect(
        executeIssue(
          {
            number: 42,
            title: 'Update docs',
            body: 'Small documentation change',
            labels: [{ name: 'agent:ready' }],
          },
          {
            command,
            workRoot: join(root, 'worktrees'),
            stateRoot: root,
            env: { PATH: '/usr/bin', HOME: root },
            runRunner: async ({ args }: { args: string[] }) => {
              calls.push({ file: 'codex', args });
              return {
                result: {
                  outcome: 'ready',
                  commitType: 'docs',
                  summary: 'Update fishing guide',
                  reason: 'Implementation and checks complete',
                },
                threadId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
                runnerPid: 1234,
              };
            },
          },
        ),
      ).resolves.toMatchObject({
        state: 'agent:review',
        pullRequest: 'https://example.test/pull/99',
      });

      const compact = calls.map(({ file, args }) => `${file} ${args.slice(0, 3).join(' ')}`);
      expect(compact).toContain('git fetch origin develop');
      expect(compact).toContain('npm ci');
      expect(compact).toContain('npm run check-code');
      expect(compact).toContain('git status --porcelain=v1 -z');
      expect(compact).toContain('git add -- docs/README.md');
      expect(compact).toContain('git push -u origin');
      expect(
        calls.some(
          ({ file, args }) =>
            file === 'gh' &&
            args[0] === 'pr' &&
            args[1] === 'create' &&
            args.includes('develop') &&
            args.includes('codex/issue-42'),
        ),
      ).toBe(true);
      expect(calls.findIndex(({ file }) => file === 'codex')).toBeGreaterThan(
        calls.findIndex(({ args }) => args.includes('agent:running')),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the worktree and blocks without push or PR when Terra is blocked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-run-'));
    const calls: Array<{ file: string; args: string[] }> = [];
    const command = pipelineCommand(
      ['agent:ready', 'agent:running', 'agent:running', 'agent:blocked'],
      calls,
    );
    try {
      await expect(
        executeIssue(
          { number: 42, title: 'Needs approval', body: '', labels: [{ name: 'agent:ready' }] },
          {
            command,
            workRoot: join(root, 'worktrees'),
            stateRoot: root,
            env: { PATH: '/usr/bin', HOME: root },
            runRunner: async ({ args }: { args: string[] }) => {
              calls.push({ file: 'codex', args });
              return {
                result: {
                  outcome: 'blocked',
                  commitType: 'chore',
                  summary: 'Need approval',
                  reason: 'External approval is required',
                },
                threadId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
                runnerPid: 1234,
              };
            },
          },
        ),
      ).resolves.toMatchObject({ state: 'agent:blocked' });
      expect(calls.some(({ file, args }) => file === 'git' && args[0] === 'push')).toBe(false);
      expect(calls.some(({ file, args }) => file === 'gh' && args[0] === 'pr')).toBe(false);
      expect(calls.some(({ file, args }) => file === 'git' && args[0] === 'worktree')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects API key variables before changing the Issue', async () => {
    const command = vi.fn();

    await expect(
      executeIssue(
        { number: 42, title: 'No API keys', body: '', labels: [{ name: 'agent:ready' }] },
        { command, env: { OPENAI_API_KEY: '' } },
      ),
    ).rejects.toThrow('API key environment is forbidden');
    expect(command).not.toHaveBeenCalled();
  });
});
