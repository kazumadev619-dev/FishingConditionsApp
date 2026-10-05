import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { install, renderPlist } from './launchd.mjs';

describe('launchd plist', () => {
  it('renders KeepAlive with fixed absolute program arguments', () => {
    const xml = renderPlist({
      nodePath: '/opt/homebrew/bin/node',
      watcherPath: '/repo/scripts/ai-factory/watcher.mjs',
      workingDirectory: '/repo',
      path: '/opt/homebrew/bin:/usr/bin:/bin',
    });

    expect(xml).toContain('<key>RunAtLoad</key><true/>');
    expect(xml).toContain('<key>KeepAlive</key><true/>');
    expect(xml).toContain('<string>/opt/homebrew/bin/node</string>');
    expect(xml).toContain('<string>/repo/scripts/ai-factory/watcher.mjs</string>');
    expect(xml).toContain(
      '<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string></dict>',
    );
    expect(xml).not.toContain('$HOME');
  });

  it('escapes XML and rejects relative paths', () => {
    const xml = renderPlist({
      nodePath: '/opt/node&bin',
      watcherPath: '/repo/<watcher>.mjs',
      workingDirectory: '/repo/"factory"',
      path: '/opt/homebrew&bin:/usr/bin',
    });

    expect(xml).toContain('/opt/node&amp;bin');
    expect(xml).toContain('/repo/&lt;watcher&gt;.mjs');
    expect(xml).toContain('/repo/&quot;factory&quot;');
    expect(xml).toContain('/opt/homebrew&amp;bin:/usr/bin');
    expect(() =>
      renderPlist({
        nodePath: 'node',
        watcherPath: '/repo/watcher.mjs',
        workingDirectory: '/repo',
        path: '/usr/bin:/bin',
      }),
    ).toThrow('launchd paths must be absolute');
  });

  it('does not restart the daemon immediately after bootstrap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-launchd-'));
    const calls: string[][] = [];
    try {
      await install({
        nodePath: '/opt/homebrew/bin/node',
        watcherPath: '/repo/scripts/ai-factory/watcher.mjs',
        workingDirectory: '/repo',
        path: '/usr/bin:/bin',
        plistPath: join(root, 'factory.plist'),
        uid: 501,
        command: async (file: string, args: string[]) => {
          calls.push([file, ...args]);
          return { stdout: '' };
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    expect(calls.some(([file, action]) => file === 'launchctl' && action === 'kickstart')).toBe(
      false,
    );
  });
});

describe('Slack installation', () => {
  it('stores the supplied secret outside plist, preserves it across install/uninstall, and reports only health', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-launchd-slack-'));
    const fakeWebhook = 'https://hooks.slack.com/services/T/B/FAKE_TEST_ONLY';
    const options = { nodePath: '/opt/node', watcherPath: '/repo/watcher.mjs', workingDirectory: '/repo', path: '/usr/bin:/bin', plistPath: join(root, 'factory.plist'), stateRoot: root, uid: 501, command: async () => ({ stdout: 'daemon running' }) };
    try {
      await install({ ...options, slackWebhookUrl: fakeWebhook });
      const { readFile, stat } = await import('node:fs/promises');
      const { status, uninstall } = await import('./launchd.mjs');
      expect(await readFile(join(root, 'slack-webhook-url'), 'utf8')).toBe(`${fakeWebhook}\n`);
      expect((await stat(join(root, 'slack-webhook-url'))).mode & 0o777).toBe(0o600);
      expect(await readFile(options.plistPath, 'utf8')).not.toContain(fakeWebhook);
      expect(await readFile(options.plistPath, 'utf8')).not.toContain('SLACK_WEBHOOK_URL');
      await install(options);
      const result = await status(options);
      expect(result.stdout).toContain('daemon running');
      expect(result.stdout).toContain('Slack: healthy');
      expect(JSON.stringify(result)).not.toContain(fakeWebhook);
      await uninstall(options);
      expect(await readFile(join(root, 'slack-webhook-url'), 'utf8')).toBe(`${fakeWebhook}\n`);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('validates an invalid webhook before altering the existing plist or launching commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-factory-launchd-invalid-'));
    const { readFile, writeFile } = await import('node:fs/promises');
    const commands: string[] = [];
    const plistPath = join(root, 'factory.plist');
    try {
      await writeFile(plistPath, 'existing plist');
      await expect(install({ stateRoot: root, plistPath, slackWebhookUrl: 'https://wrong.example/secret', command: async (file: string) => { commands.push(file); return { stdout: '' }; } })).rejects.toThrow('invalid Slack webhook URL');
      expect(await readFile(plistPath, 'utf8')).toBe('existing plist');
      expect(commands).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
