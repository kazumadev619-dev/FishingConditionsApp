import { execFile, spawn as spawnProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFile,
  link,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildCommitMessage,
  buildPrBody,
  canRetryRunner,
  evaluateUsage,
  isRunStale,
  parseChangedPaths,
  parseRunComment,
  RUNNER_RESULT_SCHEMA,
  readState,
  renderRunComment,
  runIdentity,
  runnerPrompt,
  STATES,
  selectReadyIssue,
  transitionAllowed,
  validateChangedPaths,
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

const FACTORY_ROOT = join(
  homedir(),
  'Library',
  'Application Support',
  'FishingConditionsApp',
  'ai-factory',
);

/** @typedef {{ stdout: string, stderr?: string }} CommandResult */
/** @typedef {(file: string, args: string[], options?: { cwd?: string, env?: Record<string, string | undefined>, timeout?: number }) => Promise<CommandResult>} CommandAdapter */

/**
 * @param {string} file
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, timeout?: number }} [options]
 * @returns {Promise<CommandResult>}
 */
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
  const guardPath = `${lockPath}.guard`;
  const guardCandidate = `${guardPath}.${pid}.${randomUUID()}`;
  await writeFile(guardCandidate, `${pid}\n`, { flag: 'wx', mode: 0o600 });
  try {
    try {
      await link(guardCandidate, guardPath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let guardText;
      try {
        guardText = await readFile(guardPath, 'utf8');
      } catch (readError) {
        if (readError?.code === 'ENOENT') return acquireLock(stateRoot, { pid, isPidAlive });
        throw readError;
      }
      const guardPid = Number(guardText.trim());
      if (Number.isSafeInteger(guardPid) && guardPid > 0 && isPidAlive(guardPid)) {
        return { acquired: false, reason: 'lock-busy' };
      }
      try {
        await unlink(guardPath);
      } catch (unlinkError) {
        if (unlinkError?.code === 'ENOENT') return { acquired: false, reason: 'lock-busy' };
        throw unlinkError;
      }
      return acquireLock(stateRoot, { pid, isPidAlive });
    }
    let handle;
    try {
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
        handle = await open(lockPath, 'wx', 0o600);
      }
      await handle.writeFile(`${pid}\n`);
    } finally {
      await unlink(guardPath);
    }
    return {
      acquired: true,
      async release() {
        await handle.close();
        await unlink(lockPath).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
      },
    };
  } finally {
    await unlink(guardCandidate).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
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

export async function writeFactoryLog(
  logPath,
  entry,
  { maxBytes = 5 * 1024 * 1024, now = new Date() } = {},
) {
  await mkdir(dirname(logPath), { recursive: true });
  const size = await stat(logPath)
    .then((value) => value.size)
    .catch((error) => {
      if (error?.code === 'ENOENT') return 0;
      throw error;
    });
  if (size >= maxBytes) {
    await unlink(`${logPath}.1`).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await rename(logPath, `${logPath}.1`);
  }
  const record = Object.fromEntries(
    ['level', 'event', 'issue', 'runId', 'reason']
      .filter((key) => entry[key] !== undefined)
      .map((key) => [key, entry[key]]),
  );
  await appendFile(
    logPath,
    `${JSON.stringify({ timestamp: new Date(now).toISOString(), ...record })}\n`,
    {
      mode: 0o600,
    },
  );
}

/**
 * @param {{ issue: number, record: any, repo: string, runDir: string, commentId?: number }} input
 * @param {{ command?: CommandAdapter }} [dependencies]
 */
export async function syncRunComment(
  { issue, record, repo, runDir, commentId },
  { command: commandAdapter = command } = {},
) {
  validateIssueNumber(issue);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('invalid repository name');
  const bodyPath = join(runDir, 'run-comment.md');
  await writeFile(bodyPath, renderRunComment(record), { mode: 0o600 });
  const endpoint = commentId
    ? `repos/${repo}/issues/comments/${commentId}`
    : `repos/${repo}/issues/${issue}/comments`;
  const { stdout } = await commandAdapter('gh', [
    'api',
    endpoint,
    '--method',
    commentId ? 'PATCH' : 'POST',
    '--field',
    `body=@${bodyPath}`,
  ]);
  if (commentId) return commentId;
  const created = parseJson(stdout, 'run comment');
  if (!Number.isSafeInteger(created.id) || created.id <= 0)
    throw new Error('run comment ID missing');
  return created.id;
}

async function listIssuesForState(state, commandAdapter) {
  const { stdout } = await commandAdapter('gh', [
    'issue',
    'list',
    '--state',
    'open',
    '--label',
    state,
    '--limit',
    '100',
    '--json',
    'number,title,body,labels,url',
  ]);
  return parseJson(stdout, 'recovery issue list');
}

async function blockRecoveredIssue(issue, state, reason, runDir, commandAdapter) {
  await commentIssue(issue.number, String(reason).slice(0, 500), runDir, commandAdapter);
  await transitionIssue(issue.number, state, STATES.BLOCKED, { command: commandAdapter });
  return { issue: issue.number, action: 'blocked' };
}

async function hasRunMarker(runDir, name) {
  return readFile(join(runDir, name), 'utf8')
    .then(() => true)
    .catch((error) => {
      if (error?.code === 'ENOENT') return false;
      throw error;
    });
}

async function recoverInfrastructureFailure(
  issue,
  runDir,
  commandAdapter,
  marker = 'infra-retried',
) {
  try {
    await writeFile(join(runDir, marker), '1\n', { flag: 'wx', mode: 0o600 });
    await transitionIssue(issue, STATES.RUNNING, STATES.RECOVERY, {
      command: commandAdapter,
    });
    return STATES.RECOVERY;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  await transitionIssue(issue, STATES.RUNNING, STATES.FAILED, { command: commandAdapter });
  return STATES.FAILED;
}

/**
 * @param {{ command?: CommandAdapter, runRunner?: (...args: any[]) => any, stateRoot?: string, workRoot?: string, env?: Record<string, string | undefined>, isPidAlive?: (pid: number) => boolean, now?: Date }} [options]
 */
export async function reconcileStartup({
  command: commandAdapter = command,
  runRunner = startRunner,
  stateRoot = FACTORY_ROOT,
  workRoot = join(FACTORY_ROOT, 'worktrees'),
  env = process.env,
  isPidAlive = pidIsAlive,
  now = new Date(),
} = {}) {
  safeRunnerEnv(env);
  const issues = [
    ...(await listIssuesForState(STATES.RUNNING, commandAdapter)),
    ...(await listIssuesForState(STATES.RECOVERY, commandAdapter)),
  ];
  if (issues.length === 0) return [];

  const repo = (
    await commandAdapter('gh', [
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ])
  ).stdout.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('invalid repository name');
  const viewer = (await commandAdapter('gh', ['api', 'user', '--jq', '.login'])).stdout.trim();
  const results = [];

  for (const issue of issues.sort((left, right) => left.number - right.number)) {
    const number = validateIssueNumber(issue.number);
    let state = readState(issue.labels);
    const identity = runIdentity(number);
    const worktree = join(workRoot, identity.worktreeId);
    const runDir = join(stateRoot, 'runs', identity.worktreeId);
    await mkdir(runDir, { recursive: true });
    const prepareRetry = await hasRunMarker(runDir, 'prepare-retried');
    const infraRetry = await hasRunMarker(runDir, 'infra-retried');
    if (state === STATES.RUNNING && (prepareRetry || infraRetry)) {
      await transitionIssue(number, STATES.RUNNING, STATES.RECOVERY, {
        command: commandAdapter,
      });
      state = STATES.RECOVERY;
    }
    if (prepareRetry) {
      results.push(
        await executeIssue(issue, {
          command: commandAdapter,
          runRunner,
          stateRoot,
          workRoot,
          env,
          fromState: STATES.RECOVERY,
        }),
      );
      continue;
    }
    const commentPages = parseJson(
      (
        await commandAdapter('gh', [
          'api',
          `repos/${repo}/issues/${number}/comments`,
          '--paginate',
          '--slurp',
        ])
      ).stdout,
      'issue comments',
    );
    if (!Array.isArray(commentPages) || commentPages.some((page) => !Array.isArray(page))) {
      throw new Error('invalid issue comments JSON');
    }
    const comments = commentPages.flat();
    const ownRunComments = comments.filter(
      (comment) =>
        comment.user?.login === viewer && comment.body?.startsWith('<!-- ai-factory-run:v1 -->'),
    );
    if (state === STATES.RECOVERY && ownRunComments.length === 0) {
      if (infraRetry) {
        results.push(
          await executeIssue(issue, {
            command: commandAdapter,
            runRunner,
            stateRoot,
            workRoot,
            env,
            fromState: STATES.RECOVERY,
          }),
        );
        continue;
      }
    }
    let record;
    try {
      record = parseRunComment(ownRunComments.at(-1), { issue: number, viewer });
    } catch (error) {
      results.push(await blockRecoveredIssue(issue, state, error.message, runDir, commandAdapter));
      continue;
    }

    const pullArgs = [
      'pr',
      'list',
      '--state',
      'all',
      '--head',
      identity.branch,
      '--json',
      'number,url,state',
    ];
    const pulls = openPullRequests((await commandAdapter('gh', pullArgs)).stdout);
    if (pulls.length > 0) {
      await transitionIssue(number, state, STATES.REVIEW, { command: commandAdapter });
      results.push({ issue: number, action: 'review' });
      continue;
    }

    const listed = parseWorktrees(
      (await commandAdapter('git', ['worktree', 'list', '--porcelain'])).stdout,
    );
    const attached = listed.find((entry) => entry.path === worktree);
    if (!attached || attached.branch !== identity.branch) {
      results.push(
        await blockRecoveredIssue(
          issue,
          state,
          'worktree evidence mismatch',
          runDir,
          commandAdapter,
        ),
      );
      continue;
    }
    const runnerAlive = isPidAlive(record.runnerPid);
    if (runnerAlive && isRunStale(record, now)) {
      if (state === STATES.RUNNING) {
        await transitionIssue(number, STATES.RUNNING, STATES.RECOVERY, {
          command: commandAdapter,
        });
        results.push({ issue: number, action: 'recovery' });
      } else {
        results.push(
          await blockRecoveredIssue(
            issue,
            STATES.RECOVERY,
            'stale live runner requires human review',
            runDir,
            commandAdapter,
          ),
        );
      }
      continue;
    }
    if (runnerAlive) {
      record.heartbeatAt = new Date().toISOString();
      await syncRunComment(
        { issue: number, record, repo, runDir, commentId: record.commentId },
        { command: commandAdapter },
      );
      results.push({ issue: number, action: 'monitor' });
      continue;
    }

    let recoveredResult = null;
    try {
      recoveredResult = parseJson(
        await readFile(join(runDir, 'result.json'), 'utf8'),
        'runner result',
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (recoveredResult?.outcome === 'ready') {
      let checkError;
      try {
        await commandAdapter('npm', ['run', 'check-code'], { cwd: worktree });
      } catch (error) {
        checkError = error;
      }
      if (!checkError) {
        results.push(
          await publishReady(
            issue,
            { ...identity, worktree },
            recoveredResult,
            runDir,
            state,
            commandAdapter,
          ),
        );
        continue;
      }
      if (!record.threadId || record.attempt >= 3) {
        results.push(
          await blockRecoveredIssue(issue, state, checkError.message, runDir, commandAdapter),
        );
        continue;
      }
    }

    if (record.threadId && record.attempt < 3) {
      if (state === STATES.RECOVERY) {
        await transitionIssue(number, STATES.RECOVERY, STATES.RUNNING, { command: commandAdapter });
      }
      const nextAttempt = record.attempt + 1;
      let resumed;
      try {
        resumed = await runAttempt(runRunner, {
          args: [
            'exec',
            'resume',
            record.threadId,
            '-m',
            'gpt-5.6-terra',
            '--json',
            '--output-schema',
            join(runDir, 'runner-result.schema.json'),
            '--output-last-message',
            join(runDir, 'result.json'),
            '固定検証 npm run check-code が失敗した。再実行して根本原因だけを直し、成功するまで確認する。push、PR、Issue、labelは操作しない。',
          ],
          cwd: worktree,
          runDir,
          env,
        });
      } catch (error) {
        await writeFactoryLog(join(stateRoot, 'watcher.jsonl'), {
          level: 'error',
          event: 'runner-infrastructure-failed',
          issue: number,
          runId: identity.worktreeId,
          reason: error.message,
        });
        const recoveredState = await recoverInfrastructureFailure(
          number,
          runDir,
          commandAdapter,
        );
        results.push({
          issue: number,
          action: recoveredState === STATES.RECOVERY ? 'recovery' : 'failed',
        });
        continue;
      }
      const nextRecord = {
        ...record,
        status: 'running',
        attempt: nextAttempt,
        runnerPid: resumed.runnerPid,
        threadId: resumed.threadId,
        heartbeatAt: new Date().toISOString(),
      };
      delete nextRecord.commentId;
      await syncRunComment(
        { issue: number, record: nextRecord, repo, runDir, commentId: record.commentId },
        { command: commandAdapter },
      );
      if (resumed.result.outcome === 'ready') {
        let checkError;
        try {
          await commandAdapter('npm', ['run', 'check-code'], { cwd: worktree });
        } catch (error) {
          checkError = error;
        }
        if (!checkError) {
          results.push(
            await publishReady(
              issue,
              { ...identity, worktree },
              resumed.result,
              runDir,
              STATES.RUNNING,
              commandAdapter,
            ),
          );
        } else {
          if (nextAttempt === 3) {
            results.push(
              await blockRecoveredIssue(
                issue,
                STATES.RUNNING,
                checkError.message,
                runDir,
                commandAdapter,
              ),
            );
          } else {
            results.push({ issue: number, action: 'resume' });
          }
        }
      } else if (resumed.result.outcome === 'blocked' || nextAttempt === 3) {
        results.push(
          await blockRecoveredIssue(
            issue,
            STATES.RUNNING,
            resumed.result.reason,
            runDir,
            commandAdapter,
          ),
        );
      } else {
        results.push({ issue: number, action: 'resume' });
      }
      continue;
    }

    const dirty = (await commandAdapter('git', ['status', '--porcelain=v1'], { cwd: worktree }))
      .stdout;
    if (dirty) {
      results.push(
        await blockRecoveredIssue(
          issue,
          state,
          'dirty worktree needs human review',
          runDir,
          commandAdapter,
        ),
      );
      continue;
    }
    const retryPath = join(runDir, 'infra-retried');
    const infraRetried = await readFile(retryPath, 'utf8')
      .then(() => true)
      .catch((error) => {
        if (error?.code === 'ENOENT') return false;
        throw error;
      });
    if (!infraRetried) {
      await writeFile(retryPath, '1\n', { mode: 0o600 });
      if (state === STATES.RUNNING) {
        await transitionIssue(number, STATES.RUNNING, STATES.RECOVERY, { command: commandAdapter });
      }
      results.push({ issue: number, action: 'recovery' });
    } else {
      await transitionIssue(number, state, STATES.FAILED, { command: commandAdapter });
      results.push({ issue: number, action: 'failed' });
    }
  }
  return results;
}

function parseWorktrees(output) {
  return output
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const fields = new Map(block.split('\n').map((line) => line.split(/ (.*)/s, 2)));
      return {
        path: fields.get('worktree'),
        branch: fields.get('branch')?.replace('refs/heads/', ''),
      };
    });
}

async function localBranchExists(branch, commandAdapter) {
  try {
    await commandAdapter('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

export async function prepareWorktree(
  issue,
  { command: commandAdapter = command, workRoot = join(FACTORY_ROOT, 'worktrees') } = {},
) {
  const identity = runIdentity(issue);
  const worktree = join(workRoot, identity.worktreeId);
  await mkdir(workRoot, { recursive: true });
  const { stdout } = await commandAdapter('git', ['worktree', 'list', '--porcelain']);
  const worktrees = parseWorktrees(stdout);
  const atTarget = worktrees.find((entry) => entry.path === worktree);
  if (atTarget && atTarget.branch !== identity.branch) throw new Error('worktree branch mismatch');
  const branchElsewhere = worktrees.find(
    (entry) => entry.branch === identity.branch && entry.path !== worktree,
  );
  if (branchElsewhere) throw new Error('branch is attached to another worktree');

  if (!atTarget) {
    if (await localBranchExists(identity.branch, commandAdapter)) {
      await commandAdapter('git', ['worktree', 'add', worktree, identity.branch]);
    } else {
      await commandAdapter('git', ['fetch', 'origin', 'develop']);
      await commandAdapter('git', [
        'worktree',
        'add',
        '-b',
        identity.branch,
        worktree,
        'origin/develop',
      ]);
    }
  }
  await commandAdapter('npm', ['ci'], { cwd: worktree });
  return { ...identity, worktree };
}

function safeRunnerEnv(env) {
  if ('OPENAI_API_KEY' in env || 'CODEX_API_KEY' in env) {
    throw new Error('API key environment is forbidden');
  }
  return Object.fromEntries(
    ['PATH', 'HOME', 'CODEX_HOME', 'TMPDIR', 'LANG', 'LC_ALL']
      .filter((name) => env[name] !== undefined)
      .map((name) => [name, env[name]]),
  );
}

function runnerArguments(issue, worktree, schemaPath, resultPath) {
  return [
    'exec',
    '-m',
    'gpt-5.6-terra',
    '-C',
    worktree,
    '--approve-for-me',
    '--json',
    '--output-schema',
    schemaPath,
    '--output-last-message',
    resultPath,
    runnerPrompt(issue),
  ];
}

async function runAttempt(runRunner, options) {
  await unlink(join(options.runDir, 'result.json')).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return runRunner(options);
}

/** @param {{ args: string[], runDir: string, env: Record<string, string | undefined>, cwd?: string, onHeartbeat?: (value: any) => Promise<void>, heartbeatMs?: number, spawn?: (...args: any[]) => any }} options */
export async function startRunner({
  args,
  runDir,
  env,
  cwd,
  onHeartbeat,
  heartbeatMs = 5 * 60 * 1000,
  spawn = spawnProcess,
}) {
  const stdoutPath = join(runDir, 'codex.jsonl');
  const stderrPath = join(runDir, 'codex.stderr.log');
  const resultPath = join(runDir, 'result.json');
  const stdout = await open(stdoutPath, 'w', 0o600);
  const stderr = await open(stderrPath, 'w', 0o600);
  const child = spawn('codex', args, {
    cwd,
    detached: true,
    env: safeRunnerEnv(env),
    stdio: ['ignore', stdout.fd, stderr.fd],
  });
  const runnerPid = child.pid;
  let lastHeartbeat = 0;
  let heartbeatPending = false;
  const heartbeat = onHeartbeat
    ? setInterval(
        async () => {
          if (heartbeatPending) return;
          heartbeatPending = true;
          try {
            const lines = (await readFile(stdoutPath, 'utf8')).split('\n').filter(Boolean);
            const started = lines
              .map((line) => {
                try {
                  return JSON.parse(line);
                } catch {
                  return null;
                }
              })
              .find((event) => event?.type === 'thread.started' || event?.thread?.started);
            const threadId = started?.thread_id ?? started?.thread?.started?.thread_id;
            if (threadId && Date.now() - lastHeartbeat >= heartbeatMs) {
              lastHeartbeat = Date.now();
              await onHeartbeat({ runnerPid, threadId, heartbeatAt: new Date().toISOString() });
            }
          } catch (error) {
            await writeFactoryLog(join(runDir, 'runner.jsonl'), {
              level: 'error',
              event: 'heartbeat-failed',
              reason: error.message,
            });
          } finally {
            heartbeatPending = false;
          }
        },
        Math.min(1_000, heartbeatMs),
      )
    : null;
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(async () => {
    if (heartbeat) clearInterval(heartbeat);
    await Promise.all([stdout.close(), stderr.close()]);
  });
  let resultText;
  try {
    resultText = await readFile(resultPath, 'utf8');
  } catch (error) {
    if (exitCode !== 0 && error?.code === 'ENOENT') throw new Error('runner exited without result');
    throw error;
  }
  const events = (await readFile(stdoutPath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => parseJson(line, 'Codex JSONL'));
  const started = events.find((event) => event.type === 'thread.started' || event.thread?.started);
  const threadId = started?.thread_id ?? started?.thread?.started?.thread_id;
  if (!threadId) throw new Error('runner thread ID missing');
  return { result: parseJson(resultText, 'runner result'), threadId, runnerPid };
}

function openPullRequests(stdout) {
  const pulls = parseJson(stdout, 'pull request list');
  if (!Array.isArray(pulls)) throw new Error('invalid pull request list JSON');
  return pulls.filter((pull) => pull.state === 'OPEN');
}

async function commentIssue(issue, body, runDir, commandAdapter) {
  const path = join(runDir, 'issue-comment.md');
  await writeFile(path, body, { mode: 0o600 });
  await commandAdapter('gh', ['issue', 'comment', String(issue), '--body-file', path]);
}

async function publishReady(issue, prepared, result, runDir, fromState, commandAdapter) {
  const number = validateIssueNumber(issue.number);
  const status = await commandAdapter('git', ['status', '--porcelain=v1', '-z'], {
    cwd: prepared.worktree,
  });
  let changedPaths;
  if (status.stdout) {
    changedPaths = validateChangedPaths(parseChangedPaths(status.stdout));
    await commandAdapter('git', ['add', '--', ...changedPaths], { cwd: prepared.worktree });
    const staged = await commandAdapter(
      'git',
      ['diff', '--cached', '--name-only', '--no-renames', '-z'],
      { cwd: prepared.worktree },
    );
    const stagedPaths = staged.stdout.split('\0').filter(Boolean);
    if ([...stagedPaths].sort().join('\0') !== [...changedPaths].sort().join('\0')) {
      throw new Error('staged paths do not match validated changes');
    }
    const message = buildCommitMessage(result, number);
    await commandAdapter('git', ['commit', '-m', message], { cwd: prepared.worktree });
  } else {
    const committed = await commandAdapter(
      'git',
      ['diff', '--name-only', '--no-renames', '-z', 'origin/develop...HEAD'],
      { cwd: prepared.worktree },
    );
    changedPaths = validateChangedPaths(committed.stdout.split('\0').filter(Boolean));
  }
  const message = buildCommitMessage(result, number);

  const listArgs = [
    'pr',
    'list',
    '--state',
    'all',
    '--head',
    prepared.branch,
    '--json',
    'number,url,state',
  ];
  let pulls = openPullRequests((await commandAdapter('gh', listArgs)).stdout);
  if (pulls.length === 0) {
    await commandAdapter('git', ['push', '-u', 'origin', prepared.branch], {
      cwd: prepared.worktree,
    });
    const bodyPath = join(runDir, 'pr.md');
    await writeFile(bodyPath, buildPrBody(issue, changedPaths), { mode: 0o600 });
    await commandAdapter('gh', [
      'pr',
      'create',
      '--base',
      'develop',
      '--head',
      prepared.branch,
      '--title',
      message,
      '--body-file',
      bodyPath,
    ]);
    pulls = openPullRequests((await commandAdapter('gh', listArgs)).stdout);
  }
  if (pulls.length !== 1 || !pulls[0].url) throw new Error('pull request read-back failed');
  await transitionIssue(number, fromState, STATES.REVIEW, { command: commandAdapter });
  return { state: STATES.REVIEW, pullRequest: pulls[0].url, worktree: prepared.worktree };
}

/**
 * @param {any} issue
 * @param {{ command?: CommandAdapter, runRunner?: (options: any) => Promise<any>, stateRoot?: string, workRoot?: string, env?: Record<string, string | undefined>, fromState?: string }} [options]
 */
export async function executeIssue(
  issue,
  {
    command: commandAdapter = command,
    runRunner = startRunner,
    stateRoot = FACTORY_ROOT,
    workRoot = join(FACTORY_ROOT, 'worktrees'),
    env = process.env,
    fromState = STATES.READY,
  } = {},
) {
  const number = validateIssueNumber(issue.number);
  safeRunnerEnv(env);
  const identity = runIdentity(number);
  const runDir = join(stateRoot, 'runs', identity.worktreeId);
  await mkdir(runDir, { recursive: true });
  if (fromState === STATES.READY) {
    await Promise.all(
      ['infra-retried', 'prepare-retried', 'result.json'].map((name) =>
        unlink(join(runDir, name)).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        }),
      ),
    );
  }
  const repo = (
    await commandAdapter('gh', [
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ])
  ).stdout.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('invalid repository name');
  await commandAdapter('gh', ['api', 'user', '--jq', '.login']);
  await transitionIssue(number, fromState, STATES.RUNNING, { command: commandAdapter });
  let prepared;
  try {
    prepared = await prepareWorktree(number, { command: commandAdapter, workRoot });
  } catch (error) {
    await writeFactoryLog(join(stateRoot, 'watcher.jsonl'), {
      level: 'error',
      event: 'prepare-worktree-failed',
      issue: number,
      runId: identity.worktreeId,
      reason: error.message,
    });
    const recoveredState = await recoverInfrastructureFailure(
      number,
      runDir,
      commandAdapter,
      'prepare-retried',
    );
    return {
      state: recoveredState,
      worktree: join(workRoot, identity.worktreeId),
    };
  }
  await unlink(join(runDir, 'prepare-retried')).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  const schemaPath = join(runDir, 'runner-result.schema.json');
  const resultPath = join(runDir, 'result.json');
  await writeFile(schemaPath, `${JSON.stringify(RUNNER_RESULT_SCHEMA, null, 2)}\n`, {
    mode: 0o600,
  });
  let attempt = 1;
  let commentId;
  let runner;
  let threadId;
  while (attempt <= 3) {
    const args =
      attempt === 1
        ? runnerArguments(issue, prepared.worktree, schemaPath, resultPath)
        : [
            'exec',
            'resume',
            threadId,
            '-m',
            'gpt-5.6-terra',
            '--json',
            '--output-schema',
            schemaPath,
            '--output-last-message',
            resultPath,
            '固定検証 npm run check-code が失敗した。再実行して根本原因だけを直し、成功するまで確認する。push、PR、Issue、labelは操作しない。',
          ];
    const heartbeatRecord = async ({ runnerPid, threadId: activeThread, heartbeatAt }) => {
      const record = {
        issue: number,
        status: 'running',
        branch: prepared.branch,
        worktreeId: prepared.worktreeId,
        model: 'gpt-5.6-terra',
        attempt,
        runnerPid,
        threadId: activeThread,
        heartbeatAt,
      };
      try {
        commentId = await syncRunComment(
          { issue: number, record, repo, runDir, commentId },
          { command: commandAdapter },
        );
      } catch (error) {
        await writeFactoryLog(join(stateRoot, 'watcher.jsonl'), {
          level: 'error',
          event: 'heartbeat-write-failed',
          issue: number,
          runId: prepared.worktreeId,
          reason: error.message,
        });
      }
    };
    try {
      runner = await runAttempt(runRunner, {
        args,
        runDir,
        env,
        cwd: prepared.worktree,
        onHeartbeat: heartbeatRecord,
      });
    } catch (error) {
      await writeFactoryLog(join(stateRoot, 'watcher.jsonl'), {
        level: 'error',
        event: 'runner-infrastructure-failed',
        issue: number,
        runId: prepared.worktreeId,
        reason: error.message,
      });
      const recoveredState = await recoverInfrastructureFailure(number, runDir, commandAdapter);
      return { state: recoveredState, worktree: prepared.worktree };
    }
    threadId = runner.threadId;
    await heartbeatRecord({
      runnerPid: runner.runnerPid,
      threadId,
      heartbeatAt: new Date().toISOString(),
    });

    if (runner.result.outcome === 'blocked') break;
    if (canRetryRunner(runner.result, attempt)) {
      attempt += 1;
      continue;
    }
    if (runner.result.outcome !== 'ready') break;
    try {
      await commandAdapter('npm', ['run', 'check-code'], { cwd: prepared.worktree });
      break;
    } catch (error) {
      if (!canRetryRunner(runner.result, attempt, true)) {
        runner = {
          ...runner,
          result: { ...runner.result, outcome: 'blocked', reason: error.message },
        };
        break;
      }
      attempt += 1;
    }
  }

  if (runner.result.outcome !== 'ready') {
    await commentIssue(number, String(runner.result.reason).slice(0, 500), runDir, commandAdapter);
    await transitionIssue(number, STATES.RUNNING, STATES.BLOCKED, { command: commandAdapter });
    return { state: STATES.BLOCKED, worktree: prepared.worktree };
  }

  return publishReady(issue, prepared, runner.result, runDir, STATES.RUNNING, commandAdapter);
}

/** @param {{ dryRun?: boolean, command?: CommandAdapter, readAccount?: (...args: any[]) => any, runRunner?: (...args: any[]) => any, stateRoot?: string, workRoot?: string, env?: Record<string, string | undefined>, useLock?: boolean }} [options] */
export async function runOnce({
  dryRun = false,
  command: commandAdapter = command,
  readAccount = readCodexAccount,
  runRunner = startRunner,
  stateRoot = FACTORY_ROOT,
  workRoot = join(FACTORY_ROOT, 'worktrees'),
  env = process.env,
  useLock = true,
} = {}) {
  safeRunnerEnv(env);
  const issue = selectReadyIssue(await listIssues(commandAdapter));
  if (!issue) return { mode: dryRun ? 'dry-run' : 'once', reason: 'no-ready-issue' };

  const usage = evaluateUsage(await readAccount({ env }));
  if (!usage.allowed) {
    return { mode: dryRun ? 'dry-run' : 'once', issue: issue.number, usage };
  }
  const number = validateIssueNumber(issue.number);
  const identity = runIdentity(number);
  const plan = {
    mode: dryRun ? 'dry-run' : 'once',
    issue: number,
    usage,
    ...identity,
    nextState: STATES.RUNNING,
    model: 'gpt-5.6-terra',
  };
  if (dryRun) return plan;
  if (!useLock) {
    return executeIssue(issue, {
      command: commandAdapter,
      runRunner,
      stateRoot,
      workRoot,
      env,
    });
  }
  const lock = await acquireLock(stateRoot);
  if (!lock.acquired) return { ...plan, reason: lock.reason };
  try {
    return await executeIssue(issue, {
      command: commandAdapter,
      runRunner,
      stateRoot,
      workRoot,
      env,
    });
  } finally {
    await lock.release();
  }
}

export async function runCycle(options = {}) {
  safeRunnerEnv(options.env ?? process.env);
  const stateRoot = options.stateRoot ?? FACTORY_ROOT;
  const cycleLock = await acquireLock(stateRoot);
  if (!cycleLock.acquired) return { reason: cycleLock.reason };
  try {
    const recovered = await reconcileStartup({ ...options, stateRoot });
    if (recovered.length > 0) return { recovered };
    return runOnce({ ...options, stateRoot, useLock: false });
  } finally {
    await cycleLock.release();
  }
}

export async function watch({ pollMs = 30_000, ...options } = {}) {
  for (;;) {
    try {
      await runCycle(options);
    } catch (error) {
      await writeFactoryLog(join(options.stateRoot ?? FACTORY_ROOT, 'watcher.jsonl'), {
        level: 'error',
        event: 'watch-cycle-failed',
        reason: error.message,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** @param {{ spawn?: (...args: any[]) => any, timeoutMs?: number, env?: Record<string, string | undefined> }} [options] */
export function readCodexAccount({
  spawn = spawnProcess,
  timeoutMs = 5_000,
  env = process.env,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['app-server'], {
      env: safeRunnerEnv(env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
  safeRunnerEnv(process.env);
  const args = new Set(process.argv.slice(2));
  if (args.has('--ensure-labels')) {
    await ensureLabels();
    return;
  }
  if (args.has('--once')) {
    process.stdout.write(`${JSON.stringify(await runOnce({ dryRun: args.has('--dry-run') }))}\n`);
    return;
  }
  await watch();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
