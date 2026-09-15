// Next.js のサーバーコードは AsyncLocalStorage が globalThis にある前提で動く。
// 本番では next start が起動時に用意しているものを、Vitest では自前で置く。
//
// Next 自身の node-environment-baseline.js を読み込んでも同じことができるが、
// あちらは dist 配下の内部パスで公開 API ではないため、依存を上げたときに
// 黙って消えうる。中身はこの3行と同じなので、標準ライブラリから直接置く。
import { AsyncLocalStorage } from 'node:async_hooks';

if (typeof globalThis.AsyncLocalStorage !== 'function') {
  globalThis.AsyncLocalStorage = AsyncLocalStorage;
}
