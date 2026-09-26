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
import { encode } from 'next-auth/jwt';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auth, authorized } from '@/auth/edge';
import proxy, { config } from './proxy';

const ORIGIN = 'https://fishing.kazuma-lab.com';

/**
 * JWT の署名・検証に使う。next-auth は NextAuth() を呼んだ時点（= @/auth/edge の
 * import 時）の process.env.AUTH_SECRET を設定へ焼き付け、以後は読み直さない
 * （node_modules/next-auth/index.js の末尾の setEnvDefaults）。beforeAll で
 * stubEnv しても間に合わないので、import より前に置く。
 */
const { AUTH_SECRET } = vi.hoisted(() => {
  const secret = 'test-secret-for-proxy-test';
  process.env.AUTH_SECRET = secret;
  return { AUTH_SECRET: secret };
});

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

/**
 * src/app を走査して、実在するルート・ページの URL パスを列挙する。
 *
 * この関数が取りこぼすと期待値表のチェックが素通りするので、Next.js が
 * ルートとして認識する条件に合わせる。拡張子は `.ts` だけでなく `.js` も対象
 * （このリポジトリは今のところ TypeScript だけだが、拾えないこと自体が死角になる）。
 */
function routePatternsOnDisk(): string[] {
  const appDir = fileURLToPath(new URL('./app', import.meta.url));

  return (
    readdirSync(appDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(route|page)\.[jt]sx?$/.test(entry.name))
      .map((entry) => entry.parentPath.slice(appDir.length).split('/').filter(Boolean))
      // プライベートフォルダ `_folder` は配下ごとルーティングから外れる。
      // セグメントを削るのではなく、ルートとして数えない。
      .filter((segments) => !segments.some((s) => s.startsWith('_')))
      .map((segments) => {
        // 未対応の規約は、黙って誤った URL を作らずその場で落とす。
        // 例えば parallel route の `@modal` をそのまま繋ぐと実在しない URL になり、
        // 直す人が期待値表にその URL を足して辻褄を合わせてしまう。
        const unsupported = segments.find((s) => s.startsWith('@') || /^\(\.{1,3}\)/.test(s));
        if (unsupported) {
          throw new Error(
            `この走査器は parallel route / intercepting route に未対応: ${segments.join('/')}\n` +
              'routePatternsOnDisk() を実際の URL へ変換できるよう直すこと。',
          );
        }

        // ルートグループ `(group)` は URL に出ない
        return `/${segments.filter((s) => !s.startsWith('(')).join('/')}`;
      })
      .sort()
  );
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

    if (!(result instanceof Response)) throw new Error(`Response が返っていない: ${result}`);
    expect(result.status).toBe(401);
    expect(result.headers.get('content-type')).toContain('application/json');
    await expect(result.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});

describe('NextAuth への配線', () => {
  // proxy.ts が実際に使うのは authorized() ではなく、それを NextAuth() に渡して
  // 得た auth() のほう。next-auth は authorized コールバックが渡されなかった場合、
  // 既定で許可に倒す（node_modules/next-auth/lib/index.js の `let authorized = true`）。
  //
  // つまり NextAuth() の引数から `authorized,` の1行が消えると、判定ロジックが
  // 1文字も壊れていないのに保護が丸ごと外れる。authorized() を直接呼ぶ上の
  // テストではこれを検知できないので、ここだけ auth() を通して確かめる。
  //
  // 認証済みの経路は署名済み JWT クッキーが要るので扱わない。配線が外れたときに
  // 開くのは未認証の経路なので、そこが押さえられていれば目的は果たせる。
  beforeAll(() => {
    // 実際の値は使わない。未設定だと @auth/core が MissingSecret を吐くだけで
    // 判定結果は変わらないが、テストを例外経路に依存させない
    vi.stubEnv('AUTH_SECRET', 'test-secret-not-used-for-signing');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  /** proxy として呼ばれたときの auth() の応答 */
  async function callAuth(pathname: string): Promise<Response> {
    const handler = auth as unknown as (request: NextRequest) => Promise<Response>;
    return handler(new NextRequest(`${ORIGIN}${pathname}`));
  }

  it('未認証で保護対象の API を叩くと 401', async () => {
    const response = await callAuth('/api/ports');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('未認証で保護対象のページを開くとログインへ飛ぶ', async () => {
    const response = await callAuth('/dashboard');

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `${ORIGIN}/login?callbackUrl=${encodeURIComponent(`${ORIGIN}/dashboard`)}`,
    );
  });

  it('公開ページはそのままハンドラへ渡る', async () => {
    const response = await callAuth('/login');

    expect(response.status).toBe(200);
    // next-auth が「後続へ進める」ときに付けるヘッダ。
    // 配線が外れると、保護対象でもこれが付いた 200 が返るようになる
    expect(response.headers.get('x-middleware-next')).toBe('1');
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

describe('nonce 入りの CSP（#147）', () => {
  // script-src から 'unsafe-inline' を外したので、Next.js のインラインスクリプトは
  // proxy が付ける nonce が無いと1本も実行されない（画面が固まる）。
  // Next.js は「リクエストヘッダの CSP」から nonce を拾うため、レスポンスだけでなく
  // リクエスト側にも同じ値が載っていることを確かめる。
  // ORIGIN が https なので、Auth.js は __Secure- 付きの Cookie 名を使う
  const COOKIE = '__Secure-authjs.session-token';

  async function callProxy(pathname: string, cookie?: string): Promise<Response> {
    const headers = cookie ? { cookie: `${COOKIE}=${cookie}` } : undefined;
    return proxy(new NextRequest(`${ORIGIN}${pathname}`, { headers }));
  }

  /** レスポンスの CSP と、Next.js へ渡すリクエストヘッダの CSP */
  function csps(response: Response) {
    return {
      response: response.headers.get('content-security-policy'),
      // NextResponse.next({ request: { headers } }) はこの形で後段へ渡す
      request: response.headers.get('x-middleware-request-content-security-policy'),
    };
  }

  function scriptSrc(csp: string | null): string[] {
    const directive = csp?.split(';').find((d) => d.trim().startsWith('script-src '));
    return directive?.trim().split(/\s+/).slice(1) ?? [];
  }

  it('公開ページに nonce 入りの CSP をリクエストとレスポンスの両方へ付ける', async () => {
    const response = await callProxy('/login');
    const { response: resCsp, request: reqCsp } = csps(response);

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(reqCsp).toBe(resCsp);
    const src = scriptSrc(resCsp);
    expect(src).toContainEqual(expect.stringMatching(/^'nonce-[A-Za-z0-9+/=]{16,}'$/));
    expect(src).toContain("'strict-dynamic'");
    expect(src).not.toContain("'unsafe-inline'");
  });

  it('nonce はリクエスト毎に変わる', async () => {
    const a = csps(await callProxy('/login')).response;
    const b = csps(await callProxy('/login')).response;

    expect(a).not.toBe(b);
  });

  it('認証済みのページにも付け、セッション更新の Set-Cookie を落とさない', async () => {
    const token = await encode({
      token: { id: 'test-user', email: 'test@example.com', sub: 'test-user' },
      secret: AUTH_SECRET,
      salt: COOKIE,
    });
    const response = await callProxy('/dashboard', token);

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(scriptSrc(csps(response).request)).toContainEqual(expect.stringMatching(/^'nonce-/));
    // Auth.js はリクエストのたびにトークンを作り直して返す。落とすとセッションが延びない
    expect(response.headers.getSetCookie().some((c) => c.startsWith(`${COOKIE}=`))).toBe(true);
  });

  it('認証判定は proxy を通しても効いている（401 / ログインへのリダイレクト）', async () => {
    // auth((req) => ...) のラッパー形式にすると、next-auth は authorized() が false を
    // 返してもリダイレクトせずラッパーを呼ぶ。そうなるとここが 200 になる
    const api = await callProxy('/api/ports');
    expect(api.status).toBe(401);

    const page = await callProxy('/dashboard');
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toMatch(/\/login\?callbackUrl=/);
  });
});
