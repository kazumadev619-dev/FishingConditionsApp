import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { renderRunComment } from './core.mjs';
import {
  acquireLock,
  executeIssue,
  readCodexAccount,
  reconcileStartup,
  runOnce,
  syncRunComment,
  transitionIssue,
  writeFactoryLog,
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
      env: expect.objectContaining({ PATH: expect.any(String) }),
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

  it('rejects API key variables before spawning app-server', async () => {
    const spawn = vi.fn();

    await expect(
      readCodexAccount({
        spawn,
        timeoutMs: 100,
        env: { PATH: '/usr/bin', HOME: '/tmp', OPENAI_API_KEY: '' },
      }),
    ).rejects.toThrow('API key environment is forbidden');
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('watcher dry-run', () => {
  it('rejects API key variables before GitHub or Codex access', async () => {
    const command = vi.fn();
    const readAccount = vi.fn();

    await expect(
      runOnce({
        dryRun: true,
        command,
        readAccount,
        env: { PATH: '/usr/bin', HOME: '/tmp', CODEX_API_KEY: '' },
      }),
    ).rejects.toThrow('API key environment is forbidden');
    expect(command).not.toHaveBeenCalled();
    expect(readAccount).not.toHaveBeenCalled();
  });

  it('rejects API key variables before recovery GitHub access', async () => {
    const command = vi.fn();

    await expect(
      reconcileStartup({
        command,
        env: { PATH: '/usr/bin', HOME: '/tmp', OPENAI_API_KEY: '' },
      }),
    ).rejects.toThrow('API key environment is forbidden');
    expect(command).not.toHaveBeenCalled();
  });

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
      if (!first.acquired || !first.release) throw new Error('first lock was not acquired');
      await first.release();

      await writeFile(join(root, 'watcher.lock'), '123\n');
      const replacement = await acquireLock(root, { pid: 456, isPidAlive: () => false });
      expect(replacement).toMatchObject({ acquired: true });
      if (!replacement.acquired || !replacement.release) {
        throw new Error('replacement lock was not acquired');
      }
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

  it('allows only one concurrent stale-lock replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-lock-'));
    try {
      await writeFile(join(root, 'watcher.lock'), '123\n');
      const results = await Promise.all([
        acquireLock(root, { pid: 456, isPidAlive: (value) => value !== 123 }),
        acquireLock(root, { pid: 789, isPidAlive: (value) => value !== 123 }),
      ]);

      expect(results.filter((result) => result.acquired)).toHaveLength(1);
      for (const result of results) {
        if (result.acquired && result.release) await result.release();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replaces a guard abandoned by a dead watcher', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-lock-'));
    try {
      await writeFile(join(root, 'watcher.lock'), '123\n');
      await writeFile(join(root, 'watcher.lock.guard'), '999\n');

      const lock = await acquireLock(root, { pid: 456, isPidAlive: () => false });
      expect(lock.acquired).toBe(true);
      if (lock.acquired && lock.release) await lock.release();
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
  function pipelineCommand(
    states: string[],
    runnerCalls: Array<{ file: string; args: string[] }>,
    {
      status = ' M docs/README.md\0',
      staged = 'docs/README.md\0',
      initialPulls = [],
      prepareError = false,
    }: {
      status?: string;
      staged?: string;
      initialPulls?: unknown[];
      prepareError?: boolean;
    } = {},
  ) {
    let prReads = 0;
    return vi.fn(async (file: string, args: string[]) => {
      runnerCalls.push({ file, args });
      if (file === 'gh' && args[0] === 'repo') return { stdout: 'owner/repo\n' };
      if (file === 'gh' && args[0] === 'api' && args[1] === 'user') {
        return { stdout: 'factory-bot\n' };
      }
      if (file === 'gh' && args[0] === 'api') return { stdout: JSON.stringify({ id: 77 }) };
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ labels: [{ name: states.shift() }] }) };
      }
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'list') return { stdout: '' };
      if (file === 'git' && args[0] === 'show-ref') {
        throw Object.assign(new Error('missing branch'), { code: 1 });
      }
      if (file === 'git' && args[0] === 'status') {
        return { stdout: status };
      }
      if (file === 'git' && args[0] === 'diff') return { stdout: staged };
      if (file === 'npm' && args[0] === 'ci' && prepareError) {
        throw new Error('npm ci failed');
      }
      if (file === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        prReads += 1;
        return {
          stdout: JSON.stringify(
            prReads === 1
              ? initialPulls
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
      {
        initialPulls: [
          { number: 98, url: 'https://example.test/pull/98', state: 'MERGED' },
        ],
      },
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
      const codexArgs = calls.find(({ file }) => file === 'codex')?.args ?? [];
      expect(codexArgs).toContain('--approve-for-me');
      expect(codexArgs).not.toContain('--ask-for-approval');
      expect(codexArgs).not.toContain('--sandbox');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stages both sides of a rename with lossless path comparison', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-run-'));
    const calls: Array<{ file: string; args: string[] }> = [];
    const command = pipelineCommand(
      ['agent:ready', 'agent:running', 'agent:running', 'agent:review'],
      calls,
      {
        status: 'R  docs/new.md\0docs/old.md\0',
        staged: 'docs/new.md\0docs/old.md\0',
      },
    );
    try {
      await expect(
        executeIssue(
          { number: 42, title: 'Rename docs', body: '', labels: [{ name: 'agent:ready' }] },
          {
            command,
            workRoot: join(root, 'worktrees'),
            stateRoot: root,
            env: { PATH: '/usr/bin', HOME: root },
            runRunner: async () => ({
              result: {
                outcome: 'ready',
                commitType: 'docs',
                summary: 'Rename docs',
                reason: 'Checks passed',
              },
              threadId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
              runnerPid: 1234,
            }),
          },
        ),
      ).resolves.toMatchObject({ state: 'agent:review' });
      const stagedDiff = calls.find(
        ({ file, args }) => file === 'git' && args[0] === 'diff' && args.includes('--cached'),
      );
      expect(stagedDiff?.args).toEqual([
        'diff',
        '--cached',
        '--name-only',
        '--no-renames',
        '-z',
      ]);
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

  it('resumes the same thread in the worktree and stops after three attempts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-retry-'));
    const calls: Array<{ file: string; args: string[] }> = [];
    const runs: Array<{ args: string[]; cwd: string }> = [];
    const command = pipelineCommand(
      ['agent:ready', 'agent:running', 'agent:running', 'agent:blocked'],
      calls,
    );
    try {
      await expect(
        executeIssue(
          { number: 42, title: 'Retry safely', body: '', labels: [{ name: 'agent:ready' }] },
          {
            command,
            workRoot: join(root, 'worktrees'),
            stateRoot: root,
            env: { PATH: '/usr/bin', HOME: root },
            runRunner: async ({ args, cwd }: { args: string[]; cwd: string }) => {
              await expect(
                readFile(join(root, 'runs', 'issue-42', 'result.json'), 'utf8'),
              ).rejects.toMatchObject({ code: 'ENOENT' });
              await writeFile(join(root, 'runs', 'issue-42', 'result.json'), '{}\n');
              runs.push({ args, cwd });
              return {
                result: {
                  outcome: 'retryable',
                  commitType: 'fix',
                  summary: 'Retry implementation',
                  reason: 'Fixed check still fails',
                },
                threadId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
                runnerPid: 1234,
              };
            },
          },
        ),
      ).resolves.toMatchObject({ state: 'agent:blocked' });
      expect(runs).toHaveLength(3);
      expect(runs[1].args.slice(0, 4)).toEqual([
        'exec',
        'resume',
        '0199a213-81c0-7800-8aa1-bbab2a035a53',
        '-m',
      ]);
      expect(runs[1].cwd).toBe(join(root, 'worktrees', 'issue-42'));
      expect(calls.some(({ file, args }) => file === 'git' && args[0] === 'push')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists an infrastructure retry for the next cycle and then marks the Issue failed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-infra-'));
    const calls: Array<{ file: string; args: string[] }> = [];
    const command = pipelineCommand(
      [
        'agent:ready',
        'agent:running',
        'agent:running',
        'agent:recovery',
        'agent:recovery',
        'agent:running',
        'agent:running',
        'agent:failed',
      ],
      calls,
    );
    const runRunner = vi.fn(async () => {
      throw new Error('runner exited without result');
    });
    try {
      const runDir = join(root, 'runs', 'issue-42');
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, 'infra-retried'), 'stale\n');
      await writeFile(join(runDir, 'result.json'), '{"outcome":"ready"}\n');

      await expect(
        executeIssue(
          { number: 42, title: 'Retry infra', body: '', labels: [{ name: 'agent:ready' }] },
          {
            command,
            workRoot: join(root, 'worktrees'),
            stateRoot: root,
            env: { PATH: '/usr/bin', HOME: root },
            runRunner,
          },
        ),
      ).resolves.toMatchObject({ state: 'agent:recovery' });
      expect(runRunner).toHaveBeenCalledTimes(1);
      await expect(readFile(join(runDir, 'result.json'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });

      await expect(
        executeIssue(
          { number: 42, title: 'Retry infra', body: '', labels: [{ name: 'agent:recovery' }] },
          {
            command,
            workRoot: join(root, 'worktrees'),
            stateRoot: root,
            env: { PATH: '/usr/bin', HOME: root },
            runRunner,
            fromState: 'agent:recovery',
          },
        ),
      ).resolves.toMatchObject({ state: 'agent:failed' });
      expect(runRunner).toHaveBeenCalledTimes(2);
      expect(calls.some(({ args }) => args.includes('agent:recovery'))).toBe(true);
      expect(calls.some(({ args }) => args.includes('agent:failed'))).toBe(true);
      expect(calls.some(({ file, args }) => file === 'git' && args[0] === 'push')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('clears stale run state before prepare and records prepare failure as recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-prepare-'));
    const calls: Array<{ file: string; args: string[] }> = [];
    const command = pipelineCommand(
      ['agent:ready', 'agent:running', 'agent:running', 'agent:recovery'],
      calls,
      { prepareError: true },
    );
    const runRunner = vi.fn();
    const runDir = join(root, 'runs', 'issue-42');
    try {
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, 'infra-retried'), 'stale\n');
      await writeFile(join(runDir, 'result.json'), '{"outcome":"ready"}\n');

      await expect(
        executeIssue(
          { number: 42, title: 'Prepare retry', body: '', labels: [{ name: 'agent:ready' }] },
          {
            command,
            workRoot: join(root, 'worktrees'),
            stateRoot: root,
            env: { PATH: '/usr/bin', HOME: root },
            runRunner,
          },
        ),
      ).resolves.toMatchObject({ state: 'agent:recovery' });
      expect(runRunner).not.toHaveBeenCalled();
      await expect(readFile(join(runDir, 'result.json'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('heartbeat and recovery', () => {
  const record = {
    issue: 42,
    status: 'running',
    branch: 'codex/issue-42',
    worktreeId: 'issue-42',
    model: 'gpt-5.6-terra',
    attempt: 1,
    runnerPid: 1234,
    threadId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
    heartbeatAt: '2026-09-22T00:00:00.000Z',
  };

  it('creates once and PATCHes the same run comment for heartbeat updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-heartbeat-'));
    const calls: string[][] = [];
    const command = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args);
      return { stdout: args.includes('POST') ? JSON.stringify({ id: 77 }) : '{}' };
    });
    try {
      const commentId = await syncRunComment(
        { issue: 42, record, repo: 'owner/repo', runDir: root },
        { command },
      );
      await syncRunComment(
        {
          issue: 42,
          record: { ...record, heartbeatAt: '2026-09-22T00:05:00.000Z' },
          repo: 'owner/repo',
          runDir: root,
          commentId,
        },
        { command },
      );

      expect(commentId).toBe(77);
      expect(calls[0]).toContain('POST');
      expect(calls[1]).toContain('PATCH');
      expect(calls[1]).toContain('repos/owner/repo/issues/comments/77');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rotates structured logs to one previous generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-log-'));
    const logPath = join(root, 'watcher.jsonl');
    try {
      await writeFactoryLog(logPath, { level: 'info', event: 'first', issue: 42 }, { maxBytes: 1 });
      await writeFactoryLog(
        logPath,
        { level: 'info', event: 'second', issue: 42 },
        { maxBytes: 1 },
      );
      await writeFactoryLog(logPath, { level: 'info', event: 'third', issue: 42 }, { maxBytes: 1 });

      await expect(readFile(`${logPath}.1`, 'utf8')).resolves.toContain('second');
      await expect(readFile(logPath, 'utf8')).resolves.toContain('third');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reconciles an existing PR to review without starting another runner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-reconcile-'));
    const states = ['agent:running', 'agent:review'];
    const command = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === 'issue' && args[1] === 'list') {
        return {
          stdout: JSON.stringify(
            args.includes('agent:running')
              ? [
                  {
                    number: 42,
                    title: 'Recovered work',
                    body: '',
                    labels: [{ name: 'agent:running' }],
                  },
                ]
              : [],
          ),
        };
      }
      if (args[0] === 'repo') return { stdout: 'owner/repo\n' };
      if (args[0] === 'api' && args[1] === 'user') return { stdout: 'factory-bot\n' };
      if (args[0] === 'api' && args.includes('--paginate')) {
        return {
          stdout: JSON.stringify([
            [],
            [{ id: 77, user: { login: 'factory-bot' }, body: renderRunComment(record) }],
          ]),
        };
      }
      if (args[0] === 'pr') {
        return {
          stdout: JSON.stringify([
            { number: 99, url: 'https://example.test/pull/99', state: 'OPEN' },
          ]),
        };
      }
      if (args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ labels: [{ name: states.shift() }] }) };
      }
      return { stdout: '' };
    });
    const runRunner = vi.fn();
    try {
      await expect(
        reconcileStartup({
          command,
          runRunner,
          stateRoot: root,
          workRoot: join(root, 'worktrees'),
        }),
      ).resolves.toEqual([{ issue: 42, action: 'review' }]);
      expect(runRunner).not.toHaveBeenCalled();
      expect(
        command.mock.calls.filter(([, args]) => args[0] === 'pr' && args[1] === 'create'),
      ).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('recovers a persisted infrastructure retry before its label transition completed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-reconcile-'));
    const worktree = join(root, 'worktrees', 'issue-42');
    const runDir = join(root, 'runs', 'issue-42');
    const states = [
      'agent:running',
      'agent:recovery',
      'agent:recovery',
      'agent:running',
      'agent:running',
      'agent:failed',
    ];
    const command = vi.fn(async (file: string, args: string[]) => {
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'list') {
        return {
          stdout: JSON.stringify(
            args.includes('agent:running')
              ? [
                  {
                    number: 42,
                    title: 'Retry infrastructure',
                    body: '',
                    labels: [{ name: 'agent:running' }],
                  },
                ]
              : [],
          ),
        };
      }
      if (file === 'gh' && args[0] === 'repo') return { stdout: 'owner/repo\n' };
      if (file === 'gh' && args[0] === 'api' && args[1] === 'user') {
        return { stdout: 'factory-bot\n' };
      }
      if (file === 'gh' && args[0] === 'api' && args.includes('--paginate')) {
        return { stdout: '[[]]' };
      }
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ labels: [{ name: states.shift() }] }) };
      }
      if (file === 'git' && args[0] === 'worktree') {
        return {
          stdout: `worktree ${worktree}\nHEAD abc123\nbranch refs/heads/codex/issue-42\n`,
        };
      }
      return { stdout: '' };
    });
    const runRunner = vi.fn(async () => {
      throw new Error('runner exited without result');
    });
    try {
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, 'infra-retried'), '1\n');

      await expect(
        reconcileStartup({
          command,
          runRunner,
          stateRoot: root,
          workRoot: join(root, 'worktrees'),
          env: { PATH: '/usr/bin', HOME: root },
        }),
      ).resolves.toEqual([{ state: 'agent:failed', worktree }]);
      expect(runRunner).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails a resumed runner after its persisted infrastructure retry is spent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-reconcile-'));
    const worktree = join(root, 'worktrees', 'issue-42');
    const runDir = join(root, 'runs', 'issue-42');
    const states = ['agent:recovery', 'agent:running', 'agent:running', 'agent:failed'];
    const command = vi.fn(async (file: string, args: string[]) => {
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'list') {
        return {
          stdout: JSON.stringify(
            args.includes('agent:recovery')
              ? [
                  {
                    number: 42,
                    title: 'Resume infrastructure',
                    body: '',
                    labels: [{ name: 'agent:recovery' }],
                  },
                ]
              : [],
          ),
        };
      }
      if (file === 'gh' && args[0] === 'repo') return { stdout: 'owner/repo\n' };
      if (file === 'gh' && args[0] === 'api' && args[1] === 'user') {
        return { stdout: 'factory-bot\n' };
      }
      if (file === 'gh' && args[0] === 'api' && args.includes('--paginate')) {
        return {
          stdout: JSON.stringify([
            [{ id: 77, user: { login: 'factory-bot' }, body: renderRunComment(record) }],
          ]),
        };
      }
      if (file === 'gh' && args[0] === 'pr') return { stdout: '[]' };
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ labels: [{ name: states.shift() }] }) };
      }
      if (file === 'git' && args[0] === 'worktree') {
        return {
          stdout: `worktree ${worktree}\nHEAD abc123\nbranch refs/heads/codex/issue-42\n`,
        };
      }
      return { stdout: '' };
    });
    const runRunner = vi.fn(async () => {
      throw new Error('runner exited without result');
    });
    try {
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, 'infra-retried'), '1\n');

      await expect(
        reconcileStartup({
          command,
          runRunner,
          stateRoot: root,
          workRoot: join(root, 'worktrees'),
          env: { PATH: '/usr/bin', HOME: root },
          isPidAlive: () => false,
        }),
      ).resolves.toEqual([{ issue: 42, action: 'failed' }]);
      expect(runRunner).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prioritizes a prepare retry over a stale run comment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-reconcile-'));
    const worktree = join(root, 'worktrees', 'issue-42');
    const runDir = join(root, 'runs', 'issue-42');
    const states = ['agent:recovery', 'agent:running', 'agent:running', 'agent:blocked'];
    const command = vi.fn(async (file: string, args: string[]) => {
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'list') {
        return {
          stdout: JSON.stringify(
            args.includes('agent:recovery')
              ? [
                  {
                    number: 42,
                    title: 'Retry prepare',
                    body: '',
                    labels: [{ name: 'agent:recovery' }],
                  },
                ]
              : [],
          ),
        };
      }
      if (file === 'gh' && args[0] === 'repo') return { stdout: 'owner/repo\n' };
      if (file === 'gh' && args[0] === 'api' && args[1] === 'user') {
        return { stdout: 'factory-bot\n' };
      }
      if (file === 'gh' && args[0] === 'api' && args.includes('--paginate')) {
        return {
          stdout: JSON.stringify([
            [{ id: 77, user: { login: 'factory-bot' }, body: renderRunComment(record) }],
          ]),
        };
      }
      if (file === 'gh' && args[0] === 'api') return { stdout: '{}' };
      if (file === 'gh' && args[0] === 'pr') return { stdout: '[]' };
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ labels: [{ name: states.shift() }] }) };
      }
      if (file === 'git' && args[0] === 'worktree') {
        return {
          stdout: `worktree ${worktree}\nHEAD abc123\nbranch refs/heads/codex/issue-42\n`,
        };
      }
      return { stdout: '' };
    });
    const runRunner = vi.fn(async ({ args }: { args: string[] }) => ({
      result: {
        outcome: 'blocked',
        commitType: 'chore',
        summary: 'Prepare retry blocked',
        reason: 'Needs review',
      },
      threadId: record.threadId,
      runnerPid: 4321,
      args,
    }));
    try {
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, 'prepare-retried'), '1\n');

      await expect(
        reconcileStartup({
          command,
          runRunner,
          stateRoot: root,
          workRoot: join(root, 'worktrees'),
          env: { PATH: '/usr/bin', HOME: root },
          isPidAlive: () => false,
        }),
      ).resolves.toEqual([{ state: 'agent:blocked', worktree }]);
      const args = runRunner.mock.calls[0][0].args;
      expect(args.slice(0, 2)).toEqual(['exec', '-m']);
      expect(args).toContain('-C');
      expect(args).not.toContain('resume');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resumes after commit without creating a second commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-reconcile-'));
    const worktree = join(root, 'worktrees', 'issue-42');
    const runDir = join(root, 'runs', 'issue-42');
    const states = ['agent:running', 'agent:review'];
    const calls: Array<{ file: string; args: string[] }> = [];
    let prReads = 0;
    const command = vi.fn(async (file: string, args: string[]) => {
      calls.push({ file, args });
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'list') {
        return {
          stdout: JSON.stringify(
            args.includes('agent:running')
              ? [
                  {
                    number: 42,
                    title: 'Recovered commit',
                    body: '',
                    labels: [{ name: 'agent:running' }],
                  },
                ]
              : [],
          ),
        };
      }
      if (file === 'gh' && args[0] === 'repo') return { stdout: 'owner/repo\n' };
      if (file === 'gh' && args[0] === 'api' && args[1] === 'user') {
        return { stdout: 'factory-bot\n' };
      }
      if (file === 'gh' && args[0] === 'api' && args.includes('--paginate')) {
        return {
          stdout: JSON.stringify([
            [{ id: 77, user: { login: 'factory-bot' }, body: renderRunComment(record) }],
          ]),
        };
      }
      if (file === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        prReads += 1;
        return {
          stdout: JSON.stringify(
            prReads <= 2
              ? []
              : [{ number: 99, url: 'https://example.test/pull/99', state: 'OPEN' }],
          ),
        };
      }
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ labels: [{ name: states.shift() }] }) };
      }
      if (file === 'git' && args[0] === 'worktree') {
        return {
          stdout: `worktree ${worktree}\nHEAD abc123\nbranch refs/heads/codex/issue-42\n`,
        };
      }
      if (file === 'git' && args[0] === 'status') return { stdout: '' };
      if (file === 'git' && args[0] === 'diff') {
        return { stdout: 'docs/README.md\0' };
      }
      return { stdout: '' };
    });
    try {
      await mkdir(runDir, { recursive: true });
      await writeFile(
        join(runDir, 'result.json'),
        JSON.stringify({
          outcome: 'ready',
          commitType: 'docs',
          summary: 'Recover committed work',
          reason: 'Checks passed',
        }),
      );

      await expect(
        reconcileStartup({
          command,
          runRunner: vi.fn(),
          stateRoot: root,
          workRoot: join(root, 'worktrees'),
          env: { PATH: '/usr/bin', HOME: root },
          isPidAlive: () => false,
        }),
      ).resolves.toEqual([
        {
          state: 'agent:review',
          pullRequest: 'https://example.test/pull/99',
          worktree,
        },
      ]);
      expect(calls.some(({ file, args }) => file === 'git' && args[0] === 'commit')).toBe(false);
      expect(calls.filter(({ file, args }) => file === 'git' && args[0] === 'push')).toHaveLength(1);
      expect(
        calls.filter(({ file, args }) => file === 'gh' && args[0] === 'pr' && args[1] === 'create'),
      ).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resumes a failed recovered check once and blocks at attempt three', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-reconcile-'));
    const worktree = join(root, 'worktrees', 'issue-42');
    const runDir = join(root, 'runs', 'issue-42');
    const states = ['agent:running', 'agent:blocked'];
    const attemptTwo = { ...record, attempt: 2 };
    const command = vi.fn(async (file: string, args: string[]) => {
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'list') {
        return {
          stdout: JSON.stringify(
            args.includes('agent:running')
              ? [
                  {
                    number: 42,
                    title: 'Recovered check',
                    body: '',
                    labels: [{ name: 'agent:running' }],
                  },
                ]
              : [],
          ),
        };
      }
      if (file === 'gh' && args[0] === 'repo') return { stdout: 'owner/repo\n' };
      if (file === 'gh' && args[0] === 'api' && args[1] === 'user') {
        return { stdout: 'factory-bot\n' };
      }
      if (file === 'gh' && args[0] === 'api' && args.includes('--paginate')) {
        return {
          stdout: JSON.stringify([
            [{ id: 77, user: { login: 'factory-bot' }, body: renderRunComment(attemptTwo) }],
          ]),
        };
      }
      if (file === 'gh' && args[0] === 'api') return { stdout: '{}' };
      if (file === 'gh' && args[0] === 'pr') return { stdout: '[]' };
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ labels: [{ name: states.shift() }] }) };
      }
      if (file === 'git' && args[0] === 'worktree') {
        return {
          stdout: `worktree ${worktree}\nHEAD abc123\nbranch refs/heads/codex/issue-42\n`,
        };
      }
      if (file === 'npm') throw new Error('fixed check failed');
      return { stdout: '' };
    });
    const runRunner = vi.fn(async (options: { args: string[] }) => {
      expect(options.args[0]).toBe('exec');
      return {
        result: {
          outcome: 'ready',
          commitType: 'fix',
          summary: 'Retry recovered check',
          reason: 'Implementation complete',
        },
        threadId: record.threadId,
        runnerPid: 4321,
      };
    });
    try {
      await mkdir(runDir, { recursive: true });
      await writeFile(
        join(runDir, 'result.json'),
        JSON.stringify({
          outcome: 'ready',
          commitType: 'fix',
          summary: 'Recovered check',
          reason: 'Implementation complete',
        }),
      );

      await expect(
        reconcileStartup({
          command,
          runRunner,
          stateRoot: root,
          workRoot: join(root, 'worktrees'),
          env: { PATH: '/usr/bin', HOME: root },
          isPidAlive: () => false,
        }),
      ).resolves.toEqual([{ issue: 42, action: 'blocked' }]);
      expect(runRunner).toHaveBeenCalledTimes(1);
      expect(runRunner.mock.calls[0][0].args.slice(0, 4)).toEqual([
        'exec',
        'resume',
        record.threadId,
        '-m',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('moves a stale live run to recovery without starting another runner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-reconcile-'));
    const worktree = join(root, 'worktrees', 'issue-42');
    const states = ['agent:running', 'agent:recovery', 'agent:recovery', 'agent:blocked'];
    const calls: Array<{ file: string; args: string[] }> = [];
    let cycle = 0;
    const command = vi.fn(async (file: string, args: string[]) => {
      calls.push({ file, args });
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'list') {
        const running = args.includes('agent:running');
        const include = cycle === 0 ? running : !running;
        if (!running) cycle += 1;
        return {
          stdout: JSON.stringify(
            include
              ? [
                  {
                    number: 42,
                    title: 'Stale run',
                    body: '',
                    labels: [{ name: running ? 'agent:running' : 'agent:recovery' }],
                  },
                ]
              : [],
          ),
        };
      }
      if (file === 'gh' && args[0] === 'repo') return { stdout: 'owner/repo\n' };
      if (file === 'gh' && args[0] === 'api' && args[1] === 'user') {
        return { stdout: 'factory-bot\n' };
      }
      if (file === 'gh' && args[0] === 'api' && args.includes('--paginate')) {
        return {
          stdout: JSON.stringify([
            [{ id: 77, user: { login: 'factory-bot' }, body: renderRunComment(record) }],
          ]),
        };
      }
      if (file === 'gh' && args[0] === 'api') return { stdout: '{}' };
      if (file === 'gh' && args[0] === 'pr') return { stdout: '[]' };
      if (file === 'gh' && args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ labels: [{ name: states.shift() }] }) };
      }
      if (file === 'git' && args[0] === 'worktree') {
        return {
          stdout: `worktree ${worktree}\nHEAD abc123\nbranch refs/heads/codex/issue-42\n`,
        };
      }
      return { stdout: '' };
    });
    const runRunner = vi.fn();
    try {
      await expect(
        reconcileStartup({
          command,
          runRunner,
          stateRoot: root,
          workRoot: join(root, 'worktrees'),
          env: { PATH: '/usr/bin', HOME: root },
          isPidAlive: () => true,
          now: new Date('2026-09-22T00:30:00.000Z'),
        }),
      ).resolves.toEqual([{ issue: 42, action: 'recovery' }]);
      await expect(
        reconcileStartup({
          command,
          runRunner,
          stateRoot: root,
          workRoot: join(root, 'worktrees'),
          env: { PATH: '/usr/bin', HOME: root },
          isPidAlive: () => true,
          now: new Date('2026-09-22T00:30:00.000Z'),
        }),
      ).resolves.toEqual([{ issue: 42, action: 'blocked' }]);
      expect(runRunner).not.toHaveBeenCalled();
      expect(
        calls.some(
          ({ file, args }) =>
            file === 'gh' && args[0] === 'issue' && args[1] === 'edit' && args.includes('agent:recovery'),
        ),
      ).toBe(true);
      expect(
        calls.some(
          ({ file, args }) =>
            file === 'gh' && args[0] === 'api' && args.includes('PATCH'),
        ),
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
