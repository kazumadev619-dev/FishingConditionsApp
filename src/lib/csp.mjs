/**
 * Content-Security-Policy の組み立て (#134, #147)
 *
 * next.config.mjs（proxy が nonce を付けないレスポンス用）と src/proxy.ts（proxy が後続へ
 * 通すリクエスト用。リクエスト毎の nonce 入り）の両方から使うので、どちらからも import できる .mjs に置く。
 */

// ESLint の Node グローバル設定は next.config.mjs などのファイル名指定で、ここには
// 効かないので明示的に読む
import process from 'node:process';

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
 * CSP のヘッダ値を返す。
 *
 * script-src に `'unsafe-inline'` は入れない。Next.js App Router が出す
 * ハイドレーション用のインラインスクリプトは、proxy がリクエスト毎に発行する
 * nonce で許可する（Next.js はリクエストヘッダの CSP から nonce を拾って自前の
 * `<script>` に付ける）。
 *
 * `'strict-dynamic'` は、nonce で許可したスクリプトが createElement で読み込む
 * スクリプト（Next.js のチャンク、Maps JS API）にも信頼を引き継がせるため。
 * これを解釈するブラウザは script-src のホスト指定と `'self'` を無視するが、
 * 解釈しない古いブラウザ向けにホスト指定は残す。
 *
 * nonce を渡さないとき（/api/auth・プローブ・静的アセット、および proxy が返す
 * 401 / リダイレクト）はインラインスクリプトを一切許可しない。/api/auth の組み込み
 * ページ（エラー画面など）もインラインスクリプトを使うのは WebAuthn の画面だけで、
 * このアプリでは使っていないので困らない。
 *
 * @param {{ nonce?: string }} [options]
 * @returns {string}
 */
export function buildCsp({ nonce } = {}) {
  const isDev = process.env.NODE_ENV === 'development';

  const directives = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    // X-Frame-Options: DENY の後継。両方出して古い UA も塞ぐ
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'script-src': [
      "'self'",
      ...(nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : []),
      ...GOOGLE_MAPS.script,
      // React Refresh / HMR が eval を使う。本番には出さない
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // スタイルは #147 の対象外。framer-motion や Maps が style 属性を直接書くため
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
