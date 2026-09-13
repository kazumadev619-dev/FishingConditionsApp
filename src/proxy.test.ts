/**
 * 認証 allowlist の回帰テスト（#129）
 *
 * 保護は proxy.ts の matcher と src/auth/edge.ts の allowlist の2枚で成り立っている。
 * どちらかが壊れても型チェックもビルドも通り、画面も動くので気づけない。実際 #113 で
 * matcher の境界バグ（`/healthz-debug` が素通り）を、#116 で既定 allow を修正している。
 *
 * scores / weather / ports / conditions/tide / locations/search の5本はハンドラ内で
 * auth() を呼んでおらず、この2枚だけが防御になっている。
 *
 * matcher の判定には Next.js 自身のコンパイラ（unstable_doesMiddlewareMatch）を使う。
 * 正規表現を手で書き直すと、Next の解釈とズレたまま緑になるテストができてしまう。
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { describe, expect, it } from 'vitest';
import { authorized } from '@/auth/edge';
import { config } from './proxy';

const ORIGIN = 'https://fishing.kazuma-lab.com';

const SESSION: Session = {
  user: { id: 'test-user', email: 'test@example.com' },
  expires: new Date(Date.now() + 86_400_000).toISOString(),
};

/**
 * リクエストの行き先。
 *
 * `bypasses-proxy` は matcher が対象外にしていて認証判定そのものが走らない状態。
 * `allowed` は認証判定を通ったうえでハンドラに届く状態。どちらもハンドラには届くが、
 * 原因が違うので区別する。matcher の設定ミスは前者を意図せず増やす形で現れる。
 */
type Outcome =
  | 'bypasses-proxy'
  | 'allowed'
  | 'unauthorized-401'
  | 'login-redirect'
  | 'dashboard-redirect';

/** matcher → authorized() の順に通して、実際の行き先を求める */
function visit(pathname: string, session: Session | null): Outcome {
  if (!unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${pathname}` })) {
    return 'bypasses-proxy';
  }

  const result = authorized({
    auth: session,
    request: new NextRequest(`${ORIGIN}${pathname}`),
  });

  if (result instanceof Promise) throw new Error('authorized() が Promise を返した');
  if (result === true) return 'allowed';
  if (result === false) return 'login-redirect';
  if (result instanceof Response) {
    if (result.status === 401) return 'unauthorized-401';
    const location = result.headers.get('location');
    if (location === `${ORIGIN}/dashboard`) return 'dashboard-redirect';
    throw new Error(`想定外のリダイレクト: ${result.status} → ${location}`);
  }
  throw new Error(`想定外の戻り値: ${String(result)}`);
}

/** ハンドラまで到達するか（到達するなら、そのルートは未認証の第三者に開いている） */
function reachesHandler(outcome: Outcome): boolean {
  return outcome === 'bypasses-proxy' || outcome === 'allowed';
}

/** k8s のプローブ。ページでも API でもない */
function isProbe(pattern: string): boolean {
  return pattern === '/healthz' || pattern === '/readyz';
}

interface RouteExpectation {
  /** src/app 上のパス。ディレクトリ構成との突き合わせに使う */
  pattern: string;
  /** 実際に投げるパス。動的セグメントを含む場合は具体値に置き換える */
  sample: string;
  anonymous: Outcome;
  authenticated: Outcome;
  why: string;
}

/**
 * 全ルート・全ページの期待値。
 *
 * ここに無いルートがあるとテストが落ちる。ルートを足した人に「公開か保護か」を
 * 必ず一度考えさせるための仕掛けで、これが既定 deny を運用で支える部分になる。
 */
const ROUTES: RouteExpectation[] = [
  // ---- 公開（matcher が対象外にしている） ----
  {
    pattern: '/api/auth/[...nextauth]',
    sample: '/api/auth/session',
    anonymous: 'bypasses-proxy',
    authenticated: 'bypasses-proxy',
    why: 'Auth.js 本体。ログインするための入口なので認証を要求してはいけない',
  },
  {
    pattern: '/api/auth/verify-email',
    sample: '/api/auth/verify-email?token=dummy',
    anonymous: 'bypasses-proxy',
    authenticated: 'bypasses-proxy',
    why: 'メール内のリンクから未ログインで叩かれる',
  },
  {
    pattern: '/healthz',
    sample: '/healthz',
    anonymous: 'bypasses-proxy',
    authenticated: 'bypasses-proxy',
    why: 'k8s の liveness probe。Cookie を持たない',
  },
  {
    pattern: '/readyz',
    sample: '/readyz',
    anonymous: 'bypasses-proxy',
    authenticated: 'bypasses-proxy',
    why: 'k8s の readiness probe（#119）。落とすとデプロイが通らなくなる',
  },

  // ---- 保護（ハンドラ内に auth() が無く、この2枚だけが防御） ----
  {
    pattern: '/api/scores',
    sample: '/api/scores',
    anonymous: 'unauthorized-401',
    authenticated: 'allowed',
    why: 'ハンドラ内に auth() 無し',
  },
  {
    pattern: '/api/weather',
    sample: '/api/weather',
    anonymous: 'unauthorized-401',
    authenticated: 'allowed',
    why: 'ハンドラ内に auth() 無し。OpenWeatherMap のクォータを消費する',
  },
  {
    pattern: '/api/ports',
    sample: '/api/ports',
    anonymous: 'unauthorized-401',
    authenticated: 'allowed',
    why: 'ハンドラ内に auth() 無し',
  },
  {
    pattern: '/api/conditions/tide',
    sample: '/api/conditions/tide',
    anonymous: 'unauthorized-401',
    authenticated: 'allowed',
    why: 'ハンドラ内に auth() 無し',
  },
  {
    pattern: '/api/locations/search',
    sample: '/api/locations/search',
    anonymous: 'unauthorized-401',
    authenticated: 'allowed',
    why: 'ハンドラ内に auth() 無し。Google Maps のクォータを消費する',
  },

  // ---- 保護（ハンドラ内でも auth() を呼ぶ二段防御） ----
  {
    pattern: '/api/favorites',
    sample: '/api/favorites',
    anonymous: 'unauthorized-401',
    authenticated: 'allowed',
    why: 'ハンドラ内でも auth() を呼ぶが、proxy 層でも止まることを固定する',
  },

  // ---- ページ ----
  {
    pattern: '/',
    sample: '/',
    anonymous: 'login-redirect',
    authenticated: 'dashboard-redirect',
    why: 'ルート。ログイン済みならダッシュボードへ送る',
  },
  {
    pattern: '/login',
    sample: '/login',
    anonymous: 'allowed',
    authenticated: 'dashboard-redirect',
    why: 'ログインページ',
  },
  {
    pattern: '/register',
    sample: '/register',
    anonymous: 'allowed',
    authenticated: 'dashboard-redirect',
    why: '新規登録ページ',
  },
  {
    pattern: '/auth/verification-success',
    sample: '/auth/verification-success',
    anonymous: 'allowed',
    authenticated: 'dashboard-redirect',
    why: 'メール検証リンクの着地ページ。未ログインで開くのが前提',
  },
  {
    pattern: '/auth/verification-error',
    sample: '/auth/verification-error',
    anonymous: 'allowed',
    authenticated: 'dashboard-redirect',
    why: 'メール検証リンクの着地ページ。未ログインで開くのが前提',
  },
  {
    pattern: '/dashboard',
    sample: '/dashboard',
    anonymous: 'login-redirect',
    authenticated: 'allowed',
    why: '本体',
  },
];

/** src/app を走査して、実在するルート・ページの URL パスを列挙する */
function routePatternsOnDisk(): string[] {
  const appDir = fileURLToPath(new URL('./app', import.meta.url));

  return readdirSync(appDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(route\.tsx?|page\.tsx?)$/.test(entry.name))
    .map((entry) => {
      const dir = entry.parentPath.slice(appDir.length);
      // ルートグループ `(group)` と プライベートフォルダ `_folder` は URL に出ない
      const segments = dir.split('/').filter((s) => s && !s.startsWith('(') && !s.startsWith('_'));
      return `/${segments.join('/')}`;
    })
    .sort();
}

describe('認証 allowlist', () => {
  it('src/app 上の全ルート・全ページが期待値表に載っている', () => {
    expect(ROUTES.map((r) => r.pattern).sort()).toEqual(routePatternsOnDisk());
  });

  describe.each(ROUTES)('$pattern（$why）', ({ sample, anonymous, authenticated }) => {
    it(`未認証: ${anonymous}`, () => {
      expect(visit(sample, null)).toBe(anonymous);
    });

    it(`認証済み: ${authenticated}`, () => {
      expect(visit(sample, SESSION)).toBe(authenticated);
    });
  });

  // 個別の期待値は上で見ているが、それは「表に書いた通りか」の確認でしかない。
  // 表そのものが緩む方向に書き換えられたときに落ちるよう、全体の集合を固定する。
  it('未認証で叩ける API は Auth.js 配下だけ', () => {
    const open = ROUTES.filter(
      (r) => r.pattern.startsWith('/api/') && reachesHandler(r.anonymous),
    ).map((r) => r.pattern);

    // ここが増えるのは、外部 API のクォータか DB が未認証の第三者に開いたということ
    expect(open.sort()).toEqual(['/api/auth/[...nextauth]', '/api/auth/verify-email']);
  });

  it('未認証で開けるページは4つだけ', () => {
    const open = ROUTES.filter(
      (r) => !r.pattern.startsWith('/api/') && !isProbe(r.pattern) && reachesHandler(r.anonymous),
    ).map((r) => r.pattern);

    expect(open.sort()).toEqual([
      '/auth/verification-error',
      '/auth/verification-success',
      '/login',
      '/register',
    ]);
  });
});

describe('既定 deny', () => {
  it('allowlist に無い新しい API は、何もしなくても 401 になる', () => {
    expect(visit('/api/not-yet-invented', null)).toBe('unauthorized-401');
  });

  it('allowlist に無い新しいページは、何もしなくてもログインへ飛ぶ', () => {
    expect(visit('/some-new-page', null)).toBe('login-redirect');
  });

  it('公開パスは完全一致。前方一致で近いパスが漏れない', () => {
    // `/auth/` を前方一致にすると、あとから src/app/auth/ にページを足した人が
    // 意図せず公開してしまう
    expect(visit('/auth/verification-success-x', null)).toBe('login-redirect');
    expect(visit('/login-as-admin', null)).toBe('login-redirect');
  });

  it('API の拒否は 401 JSON。ログインページの HTML を掴ませない', async () => {
    const result = authorized({
      auth: null,
      request: new NextRequest(`${ORIGIN}/api/ports`),
    });

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});

describe('proxy の matcher', () => {
  const matches = (pathname: string) =>
    unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${pathname}` });

  it.each([
    ['/api/auth/callback/google', 'Auth.js のコールバック'],
    ['/api/auth', 'Auth.js のルート直下'],
    ['/healthz', 'liveness probe'],
    ['/readyz', 'readiness probe'],
    ['/_next/static/chunks/main.js', 'ビルド成果物'],
    ['/_next/image', '画像最適化'],
    ['/favicon.ico', 'メタデータ'],
    ['/sitemap.xml', 'メタデータ'],
    ['/robots.txt', 'メタデータ'],
  ])('対象外にする: %s（%s）', (pathname) => {
    expect(matches(pathname)).toBe(false);
  });

  // #113 の回帰。除外を `(?:/|$)` でパス境界に固定していないと、
  // 名前が前方一致するだけの別ルートまで proxy を素通りする。
  it.each([
    ['/healthz-debug', '/healthz の前方一致'],
    ['/readyz-internal', '/readyz の前方一致'],
    ['/_next/static-evil', '/_next/static の前方一致'],
    ['/_next/imageproxy', '/_next/image の前方一致'],
    ['/api/authenticate', '/api/auth の前方一致'],
    ['/faviconZico', '`.` をエスケープしないと素通りする'],
    ['/sitemapZxml', '`.` をエスケープしないと素通りする'],
  ])('素通りさせない: %s（%s）', (pathname) => {
    expect(matches(pathname)).toBe(true);
  });
});
