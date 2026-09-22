import { execFile, spawn as spawnProcess } from 'node:child_process';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  evaluateUsage,
  readState,
  STATES,
  selectReadyIssue,
  transitionAllowed,
  validateIssueNumber,
} from './core.mjs';

const execFileAsync = promisify(execFile);

export const LABELS = Object.freeze([
  ['agent:ready', '0E8A16', 'AI factory queue entry'],
  ['agent:running', '1D76DB', 'AI factory runner is active'],
  ['agent:review', '5319E7', 'PR is ready for automated review'],
  ['human:approval', 'FBCA04', 'Human merge approval is required'],
  ['done', '0E8A16', 'AI factory work is complete'],
  ['agent:blocked', 'D93F0B', 'Human input or requirement clarification is required'],
  ['agent:failed', 'B60205', 'Infrastructure execution failed'],
  ['agent:recovery', 'F9D0C4', 'Watcher is reconciling an interrupted run'],
  ['agent:paused', 'C5DEF5', 'Human paused new work'],
]);

const CLIENT_INFO = Object.freeze({
  name: 'fishing-conditions-ai-factory',
  title: 'FishingConditions AI Factory',
  version: '1.0.0',
});

export function command(file, args, options = {}) {
  return execFileAsync(file, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeout ?? 30_000,
    maxBuffer: 1024 * 1024,
  });
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export async function acquireLock(stateRoot, { pid = process.pid, isPidAlive = pidIsAlive } = {}) {
  await mkdir(stateRoot, { recursive: true });
  const lockPath = `${stateRoot}/watcher.lock`;
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existingText = await readFile(lockPath, 'utf8');
    const existingPid = Number(existingText.trim());
    if (!Number.isSafeInteger(existingPid) || existingPid <= 0) {
      return { acquired: false, reason: 'invalid-lock' };
    }
    if (isPidAlive(existingPid)) return { acquired: false, reason: 'already-running' };
    await unlink(lockPath);
    return acquireLock(stateRoot, { pid, isPidAlive });
  }
  await handle.writeFile(`${pid}\n`);
  return {
    acquired: true,
    async release() {
      await handle.close();
      await unlink(lockPath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    },
  };
}

function parseJson(stdout, context) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`invalid ${context} JSON`);
  }
}

export async function listIssues(commandAdapter = command) {
  const { stdout } = await commandAdapter('gh', [
    'issue',
    'list',
    '--state',
    'open',
    '--label',
    STATES.READY,
    '--limit',
    '100',
    '--json',
    'number,title,body,labels,url',
  ]);
  return parseJson(stdout, 'issue list');
}

async function issueState(issue, commandAdapter) {
  const { stdout } = await commandAdapter('gh', [
    'issue',
    'view',
    String(validateIssueNumber(issue)),
    '--json',
    'labels',
  ]);
  return readState(parseJson(stdout, 'issue').labels);
}

export async function transitionIssue(issue, from, to, { command: commandAdapter = command } = {}) {
  validateIssueNumber(issue);
  if (!transitionAllowed(from, to)) throw new Error(`invalid state transition: ${from} -> ${to}`);
  if ((await issueState(issue, commandAdapter)) !== from) throw new Error('issue state changed');
  await commandAdapter('gh', [
    'issue',
    'edit',
    String(issue),
    '--remove-label',
    from,
    '--add-label',
    to,
  ]);
  if ((await issueState(issue, commandAdapter)) !== to) {
    throw new Error('issue state transition was not applied');
  }
}

export async function ensureLabels(commandAdapter = command) {
  for (const [name, color, description] of LABELS) {
    await commandAdapter('gh', [
      'label',
      'create',
      name,
      '--color',
      color,
      '--description',
      description,
      '--force',
    ]);
  }
}

export async function runOnce({
  dryRun = false,
  command: commandAdapter = command,
  readAccount = readCodexAccount,
} = {}) {
  const issue = selectReadyIssue(await listIssues(commandAdapter));
  if (!issue) return { mode: dryRun ? 'dry-run' : 'once', reason: 'no-ready-issue' };

  const usage = evaluateUsage(await readAccount());
  if (!usage.allowed) {
    return { mode: dryRun ? 'dry-run' : 'once', issue: issue.number, usage };
  }
  const number = validateIssueNumber(issue.number);
  const plan = {
    mode: dryRun ? 'dry-run' : 'once',
    issue: number,
    usage,
    branch: `codex/issue-${number}`,
    worktreeId: `issue-${number}`,
    nextState: STATES.RUNNING,
    model: 'gpt-5.6-terra',
  };
  if (dryRun) return plan;
  throw new Error('runner execution is not implemented');
}

export function readCodexAccount({ spawn = spawnProcess, timeoutMs = 5_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    let account;
    let limits;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill('SIGTERM');
      if (error) reject(error);
      else resolve(value);
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const maybeFinish = () => {
      if (!account || !limits) return;
      finish(null, {
        account: { type: account.account?.type ?? null },
        ordinaryUsageAllowed: limits.ordinaryUsageAllowed,
        rateLimits: limits.rateLimits,
        rateLimitsByLimitId: limits.rateLimitsByLimitId,
      });
    };
    const timer = setTimeout(
      () => finish(new Error('app-server usage request timed out')),
      timeoutMs,
    );

    child.once('error', () => finish(new Error('app-server failed to start')));
    child.once('exit', () => finish(new Error('app-server exited before usage response')));
    child.stderr.resume();
    lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        finish(new Error('invalid app-server JSON'));
        return;
      }
      if (message.error) {
        finish(new Error('app-server request failed'));
        return;
      }
      if (message.id === 1) {
        send({ method: 'initialized', params: {} });
        send({ method: 'account/read', id: 2, params: { refreshToken: false } });
        send({
          method: 'account/rateLimits/read',
          id: 3,
          params: { excludeResetCreditDetails: true, supportsLunaReserve: false },
        });
      } else if (message.id === 2) {
        account = message.result;
        maybeFinish();
      } else if (message.id === 3) {
        limits = message.result;
        maybeFinish();
      }
    });

    send({ method: 'initialize', id: 1, params: { clientInfo: CLIENT_INFO } });
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--ensure-labels')) {
    await ensureLabels();
    return;
  }
  if (args.has('--once')) {
    process.stdout.write(`${JSON.stringify(await runOnce({ dryRun: args.has('--dry-run') }))}\n`);
    return;
  }
  throw new Error('use --once [--dry-run] or --ensure-labels');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
