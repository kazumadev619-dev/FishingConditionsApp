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
