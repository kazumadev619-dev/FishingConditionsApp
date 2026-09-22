import { describe, expect, it } from 'vitest';
import { renderPlist } from './launchd.mjs';

describe('launchd plist', () => {
  it('renders KeepAlive with fixed absolute program arguments', () => {
    const xml = renderPlist({
      nodePath: '/opt/homebrew/bin/node',
      watcherPath: '/repo/scripts/ai-factory/watcher.mjs',
      workingDirectory: '/repo',
    });

    expect(xml).toContain('<key>RunAtLoad</key><true/>');
    expect(xml).toContain('<key>KeepAlive</key><true/>');
    expect(xml).toContain('<string>/opt/homebrew/bin/node</string>');
    expect(xml).toContain('<string>/repo/scripts/ai-factory/watcher.mjs</string>');
    expect(xml).not.toContain('$HOME');
  });

  it('escapes XML and rejects relative paths', () => {
    const xml = renderPlist({
      nodePath: '/opt/node&bin',
      watcherPath: '/repo/<watcher>.mjs',
      workingDirectory: '/repo/"factory"',
    });

    expect(xml).toContain('/opt/node&amp;bin');
    expect(xml).toContain('/repo/&lt;watcher&gt;.mjs');
    expect(xml).toContain('/repo/&quot;factory&quot;');
    expect(() =>
      renderPlist({
        nodePath: 'node',
        watcherPath: '/repo/watcher.mjs',
        workingDirectory: '/repo',
      }),
    ).toThrow('launchd paths must be absolute');
  });
});
