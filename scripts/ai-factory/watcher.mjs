import { spawn as spawnProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';

const CLIENT_INFO = Object.freeze({
  name: 'fishing-conditions-ai-factory',
  title: 'FishingConditions AI Factory',
  version: '1.0.0',
});

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
