import { execFile } from 'node:child_process';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';

export const LABEL = 'com.kazuma-lab.fishing-conditions-ai-factory';

import { saveSlackWebhook, slackHealth } from './slack.mjs';
import { readFactoryEvents, aggregateFactoryReport, inspectFactoryProcesses } from './report.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function command(file, args) {
  return execFileAsync(file, args, { encoding: 'utf8', timeout: 30_000 });
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function renderPlist({ nodePath, watcherPath, workingDirectory, path }) {
  if (![nodePath, watcherPath, workingDirectory].every(isAbsolute) || !path) {
    throw new Error('launchd paths must be absolute');
  }
  const [node, watcher, cwd, executablePath] = [nodePath, watcherPath, workingDirectory, path].map(
    escapeXml,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${node}</string><string>${watcher}</string></array>
<key>WorkingDirectory</key><string>${cwd}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${executablePath}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
</dict></plist>
`;
}

function defaults() {
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  return {
    nodePath: process.execPath,
    watcherPath: join(repoRoot, 'scripts', 'ai-factory', 'watcher.mjs'),
    workingDirectory: repoRoot,
    path: process.env.PATH,
    plistPath,
    stateRoot: join(
      homedir(),
      'Library',
      'Application Support',
      'FishingConditionsApp',
      'ai-factory',
    ),
    uid: process.getuid(),
  };
}

async function bootout(uid, commandAdapter) {
  await commandAdapter('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch((error) => {
    if (error?.code !== 3 && error?.code !== 5) throw error;
  });
}

export async function install(options = {}) {
  const values = { ...defaults(), ...options };
  const commandAdapter = options.command ?? command;
  await saveSlackWebhook(options.slackWebhookUrl, { stateRoot: values.stateRoot });
  const temporaryPath = `${values.plistPath}.tmp-${process.pid}`;
  await mkdir(dirname(values.plistPath), { recursive: true });
  await writeFile(
    temporaryPath,
    renderPlist({
      nodePath: values.nodePath,
      watcherPath: values.watcherPath,
      workingDirectory: values.workingDirectory,
      path: values.path,
    }),
    { mode: 0o600 },
  );
  try {
    await commandAdapter('plutil', ['-lint', temporaryPath]);
    await bootout(values.uid, commandAdapter);
    await rename(temporaryPath, values.plistPath);
    await commandAdapter('launchctl', ['bootstrap', `gui/${values.uid}`, values.plistPath]);
  } catch (error) {
    await unlink(temporaryPath).catch((cleanupError) => {
      if (cleanupError?.code !== 'ENOENT') {
        throw new AggregateError([error, cleanupError], 'launchd install cleanup failed');
      }
    });
    throw error;
  }
  return values.plistPath;
}

export async function uninstall(options = {}) {
  const values = { ...defaults(), ...options };
  const commandAdapter = options.command ?? command;
  await bootout(values.uid, commandAdapter);
  await unlink(values.plistPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

export async function status(options = {}) {
  const values = { ...defaults(), ...options };
  const adapter = options.command ?? command;
  let launchd;
  try {
    const result = await adapter('launchctl', ['print', `gui/${values.uid}/${LABEL}`]);
    launchd =
      result.stdout.match(/(?:^|\n)\s*state = (running|waiting|exited)\b/)?.[1] ??
      (result.stdout === 'daemon running' ? 'running' : 'unknown');
  } catch {
    launchd = 'unavailable';
  }
  let queues = {
    health: 'unavailable',
    runningIssues: null,
    reviewQueue: null,
    workerProcesses: 'unknown',
    reviewerProcess: 'unknown',
  };
  try {
    const result = await adapter('gh', [
      'issue',
      'list',
      '--state',
      'open',
      '--limit',
      '1000',
      '--json',
      'number,labels',
    ]);
    const issues = JSON.parse(result.stdout);
    if (
      !Array.isArray(issues) ||
      issues.length >= 1000 ||
      issues.some(
        (issue) =>
          !Number.isSafeInteger(issue.number) ||
          issue.number < 1 ||
          !Array.isArray(issue.labels) ||
          issue.labels.some((label) => typeof label.name !== 'string'),
      )
    )
      throw new Error('invalid queue');
    queues = {
      ...queues,
      health: 'available',
      runningIssues: issues.filter((issue) =>
        issue.labels.some(
          (label) => label.name === 'agent:running' || label.name === 'agent:recovery',
        ),
      ).length,
      reviewQueue: issues.filter((issue) =>
        issue.labels.some((label) => label.name === 'agent:review'),
      ).length,
    };
    queues = {
      ...queues,
      ...(await inspectFactoryProcesses(issues, { stateRoot: values.stateRoot, command: adapter })),
    };
  } catch {
    queues.health = 'unavailable';
  }
  const slack = await slackHealth({ stateRoot: values.stateRoot });
  const events = await readFactoryEvents({ stateRoot: values.stateRoot });
  const now = options.now ?? new Date();
  const report = aggregateFactoryReport(events.events, {
    from: new Date(now.getTime() - 7 * 86400000).toISOString(),
    to: now.toISOString(),
    incomplete: events.incomplete,
  });
  return {
    stdout: `LaunchAgent: ${launchd === 'running' ? 'daemon running' : launchd}\nQueues: ${JSON.stringify(queues)}\nQuota: ${events.incomplete ? 'unknown' : (report.waitDurations.quota ?? 0) + 'ms observed / live unknown'}\nSlack: ${slack.health} ${JSON.stringify(slack)}\nObservations: ${report.incomplete ? 'incomplete' : 'available'} / unfinished ${report.unfinished}\n`,
  };
}

async function main() {
  const action = process.argv[2];
  if (action === 'print') {
    process.stdout.write(renderPlist(defaults()));
  } else if (action === 'install') {
    process.stdout.write(`${await install({ slackWebhookUrl: process.env.SLACK_WEBHOOK_URL })}\n`);
  } else if (action === 'uninstall') {
    await uninstall();
  } else if (action === 'status') {
    process.stdout.write((await status()).stdout);
  } else {
    throw new Error('use print, install, status, or uninstall');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
