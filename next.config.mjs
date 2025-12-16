/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker本番ビルド用: 最小限のstandalone出力を生成
  output: 'standalone',
  // Turbopackを有効にするため、turbopack: {} を追加。
  // `next-pwa`がTurbopack未対応のため、PWA機能は一時的に無効化しています。
  turbopack: {
    root: './',
  },
};

// --- PWA Config (Disabled) ---
// To re-enable PWA, uncomment the following lines and the export statement at the bottom.
// Make sure `next-pwa` supports Turbopack before re-enabling.
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
