/**
 * セキュリティヘッダ (#134)
 *
 * TLS を Cloudflare で終端する構成にしたため、ヘッダを足せる場所が
 * 「アプリ / Cloudflare / Traefik」の3箇所に散っている。CSP はアプリが
 * 何を読み込むかと一体で決まるので、アプリ側（ここ）に集約する。
 */

const isDev = process.env.NODE_ENV === 'development';

/**
 * Google Maps JavaScript API が実際に触るオリジン。
 * 公式ガイド: https://developers.google.com/maps/documentation/javascript/content-security-policy
 *
 * `@vis.gl/react-google-maps` は内部で Maps JS API をロードするだけなので、
 * 追加で許可すべきオリジンは無い。
 */
const GOOGLE_MAPS = {
  script: ['https://maps.googleapis.com', 'https://maps.gstatic.com'],
  // タイル画像は maps.googleapis.com 以外のホストからも配信される
  img: [
    'https://maps.googleapis.com',
    'https://maps.gstatic.com',
    'https://*.googleapis.com',
    'https://*.gstatic.com',
  ],
  connect: ['https://maps.googleapis.com'],
  // Maps が Roboto を <link> で後から差し込む
  style: ['https://fonts.googleapis.com'],
  font: ['https://fonts.gstatic.com'],
};

/**
 * CSP のディレクティブ。
 *
 * script-src に `'unsafe-inline'` が入っているのは、Next.js App Router が
 * ハイドレーション用のインラインスクリプトを出すためで、これを外すには
 * リクエストごとの nonce が要る。nonce は proxy.ts（= 認証ミドルウェア）で
 * 発行することになり、
 *   1. 認証の回帰テストがまだ無い（#129）proxy に手を入れることになる
 *   2. nonce はリクエスト毎に変わるので /login と /register の
 *      静的プリレンダが効かなくなる
 * の2点があるため、本 issue では見送って #147 に切り出した。
 * `'unsafe-inline'` があっても「外部ホストのスクリプトを読ませない」
 * 「frame されない」「base/form の乗っ取りを防ぐ」効果は生きている。
 */
function buildCsp() {
  const directives = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    // X-Frame-Options: DENY の後継。両方出して古い UA も塞ぐ
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      ...GOOGLE_MAPS.script,
      // React Refresh / HMR が eval を使う。本番には出さない
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    'style-src': ["'self'", "'unsafe-inline'", ...GOOGLE_MAPS.style],
    'font-src': ["'self'", 'data:', ...GOOGLE_MAPS.font],
    'img-src': ["'self'", 'data:', 'blob:', ...GOOGLE_MAPS.img],
    'connect-src': [
      "'self'",
      ...GOOGLE_MAPS.connect,
      // dev サーバーの HMR は WebSocket でつながる
      ...(isDev ? ['ws:'] : []),
    ],
    // Maps はタイルのデコードを blob: の Worker でやる
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
  };

  const csp = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');

  // Cloudflare 終端なので配信は常に https。混在コンテンツを黙って昇格させる
  return isDev ? csp : `${csp}; upgrade-insecure-requests`;
}

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: buildCsp(),
  },
  {
    // HSTS。preload は付けない（登録すると取り消しに数か月かかり、
    // kazuma-lab.com 配下すべてを HTTPS に縛ることになる）
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // frame-ancestors 未対応の古い UA 向け
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // 使っていない機能は明示的に閉じる。位置情報は現状どこからも呼んでいない
    // （将来「現在地から探す」を足すときは geolocation=(self) に変える）
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  {
    // Google ログインはリダイレクト方式でポップアップを使わないため、
    // same-origin にしてもフローは壊れない
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker本番ビルド用: 最小限のstandalone出力を生成
  output: 'standalone',
  // Turbopackを有効にするため、turbopack: {} を追加。
  // `next-pwa`がTurbopack未対応のため、PWA機能は無効化しています（下記参照）。
  turbopack: {
    root: './',
  },
  // pinoのビルドエラー回避: ネイティブモジュールをバンドルから除外
  serverExternalPackages: ['pino', 'pino-pretty'],
  async headers() {
    return [
      {
        // API・ヘルスチェック・静的アセットを含む全レスポンスに付ける
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

// --- PWA Config (Disabled) ---
//
// `next-pwa` パッケージは削除済み。Turbopack 未対応でこの設定ごと無効化されており、
// 依存としては webpack プラグイン一式（workbox 系 253 パッケージ）を引き込んで
// npm audit の high を 5 件出すだけの状態だったため。
//
// PWA を再開するときは:
//   1. `next-pwa` が Turbopack に対応したことを確認する
//   2. `npm i next-pwa` で入れ直す
//   3. 以下と最下部の export をコメント解除する
//   4. `public/manifest.json` とアイコン類を用意する（現状 public/ は存在しない）
/*
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/api\.openweathermap\.org/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'weather-api-cache',
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 60 * 60, // 1時間
        },
      },
    },
  ],
});
*/

// export default withPWA(nextConfig);
export default nextConfig;
