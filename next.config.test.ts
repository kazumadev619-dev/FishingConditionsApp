/**
 * セキュリティヘッダの回帰テスト（#134）
 *
 * ヘッダは「消えても画面が壊れない」ため、劣化に気づけない。
 * next.config.mjs を実際に読み込んで、出力されるヘッダを直接検証する。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from './next.config.mjs';

/**
 * headers() を呼んで結果を返す。
 * NextConfig 上は省略可能な項目なので、存在すること自体もここで担保する。
 */
async function headerRules(config: typeof nextConfig) {
  if (!config.headers) throw new Error('next.config.mjs に headers() が無い');
  return config.headers();
}

/** 指定した名前のヘッダ値を取り出す */
async function headerValue(name: string): Promise<string> {
  const rules = await headerRules(nextConfig);
  const header = rules[0].headers.find((h) => h.key === name);
  if (!header) throw new Error(`ヘッダが存在しない: ${name}`);
  return header.value;
}

/** CSP を「ディレクティブ名 → 値の配列」に分解する */
async function cspDirectives(): Promise<Record<string, string[]>> {
  const csp = await headerValue('Content-Security-Policy');
  return Object.fromEntries(
    csp.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('セキュリティヘッダ', () => {
  it('API もヘルスチェックも静的アセットも含む全パスに適用する', async () => {
    const rules = await headerRules(nextConfig);
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/:path*');
  });

  it('必要なヘッダが揃っている', async () => {
    const rules = await headerRules(nextConfig);
    const keys = rules[0].headers.map((h) => h.key);

    expect(keys).toEqual(
      expect.arrayContaining([
        'Content-Security-Policy',
        'Strict-Transport-Security',
        'X-Content-Type-Options',
        'X-Frame-Options',
        'Referrer-Policy',
        'Permissions-Policy',
        'Cross-Origin-Opener-Policy',
      ]),
    );
  });

  it('HSTS に preload を付けない', async () => {
    // preload は登録すると取り消しに数か月かかるため意図的に外している。
    // 「強くしよう」と足されると戻せなくなるので、テストで固定する
    const hsts = await headerValue('Strict-Transport-Security');
    expect(hsts).toBe('max-age=31536000; includeSubDomains');
  });

  it('X-Frame-Options と frame-ancestors の両方で frame を禁止する', async () => {
    expect(await headerValue('X-Frame-Options')).toBe('DENY');
    expect((await cspDirectives())['frame-ancestors']).toEqual(["'none'"]);
  });
});

describe('CSP', () => {
  it('乗っ取りの足がかりになるディレクティブを閉じている', async () => {
    const d = await cspDirectives();

    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    // <base> を書き換えて相対 URL のスクリプトを外部へ向ける攻撃を防ぐ
    expect(d['base-uri']).toEqual(["'self'"]);
    // Server Actions の POST 先は同一オリジンなので 'self' で足りる
    expect(d['form-action']).toEqual(["'self'"]);
  });

  it('本番では unsafe-eval と ws: を許可しない', async () => {
    const d = await cspDirectives();

    expect(d['script-src']).not.toContain("'unsafe-eval'");
    expect(d['connect-src']).not.toContain('ws:');
    expect(d).toHaveProperty('upgrade-insecure-requests');
  });

  it('開発時だけ HMR 用の unsafe-eval と ws: を足す', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    const devConfig = (await import('./next.config.mjs')).default;
    const rules = await headerRules(devConfig);
    const csp = rules[0].headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';

    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws:');
    // 開発はそもそも http なので昇格させない
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('Google Maps が必要とするオリジンを許可している', async () => {
    // ヘッドレス Chrome で本番と同じ CSP を当てて実測した結果、
    // タイル読み込みまで違反ゼロで通ることを確認済み（#134）
    const d = await cspDirectives();

    expect(d['script-src']).toContain('https://maps.googleapis.com');
    expect(d['connect-src']).toContain('https://maps.googleapis.com');
    expect(d['img-src']).toContain('https://*.googleapis.com');
    // Maps が Roboto を後から <link> で差し込む
    expect(d['style-src']).toContain('https://fonts.googleapis.com');
    expect(d['font-src']).toContain('https://fonts.gstatic.com');
    // ベクタータイルのデコードが blob: の Worker で走る
    expect(d['worker-src']).toContain('blob:');
  });
});
