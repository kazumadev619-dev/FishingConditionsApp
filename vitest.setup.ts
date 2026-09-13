// Next.js のサーバーコードは AsyncLocalStorage が globalThis にある前提で動く。
// 本番では next start がこのファイルを最初に読み込んで用意している。
// Vitest は素の Node なので同じものを自前で読み込む。
import 'next/dist/server/node-environment-baseline.js';
