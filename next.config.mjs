/**
 * セキュリティヘッダ (#134)
 *
 * TLS を Cloudflare で終端する構成にしたため、ヘッダを足せる場所が
 * 「アプリ / Cloudflare / Traefik」の3箇所に散っている。CSP はアプリが
 * 何を読み込むかと一体で決まるので、アプリ側（ここ）に集約する。
 */

import { buildCsp } from './src/lib/csp.mjs';

/*
 * ここで付ける CSP は proxy を通らないレスポンス（API・静的アセット・プローブ）向けで、
 * インラインスクリプトを許可しない。ページには proxy（src/proxy.ts）が nonce 入りの
 * CSP を付け直す（同じ名前のヘッダは proxy の値で上書きされる）。
 */

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
