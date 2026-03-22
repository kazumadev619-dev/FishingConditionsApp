# Task 6: Next.js 16 への現代化と最適化

## 概要
Next.js 16 が提供する最新機能（`"use cache"` ディレクティブ、React Compiler など）を活用し、パフォーマンスと開発体験を向上させる。

**関連ファイル:**
- `next.config.mjs` - Next.js 設定
- `src/app/` - App Router ページ・コンポーネント
- `src/app/layout.tsx` - ルートレイアウト
- 設定: `tsconfig.json`

## 現状の問題

### 1. Turbopack の設定が不完全
```javascript
// next.config.mjs
const nextConfig = {
  reactStrictMode: true,
  turbopack: {},
};
```
- Turbopack は有効だが、細かい設定がない
- Next.js 16 の他の最適化機能が未活用

### 2. React Compiler が有効になっていない
- `useMemo`, `useCallback` の手動最適化が必要
- React 19.2 の自動最適化が利用されていない

### 3. `"use cache"` ディレクティブが未使用
- Server Components でのキャッシング管理が曖昧
- **Next.js 16 のデフォルト**: キャッシュされないため、明示的に指定する必要がない
- ただし、外部 API 呼び出しのキャッシング戦略が不明確

### 4. PWA 機能が無効化
```javascript
// Commented out because next-pwa doesn't support Turbopack
// export default withPWA(nextConfig);
export default nextConfig;
```

### 5. パフォーマンス最適化の未実装
- 画像の遅延ロード
- Code splitting
- バンドルサイズの最適化

## 実装要件

### 1. React Compiler を有効化

```javascript
// next.config.mjs

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    reactCompiler: true, // React Compiler を有効化
  },
  turbopack: {
    // Turbopack 固有の設定（必要に応じて）
  },
};

export default nextConfig;
```

**効果:**
- `useMemo` / `useCallback` の自動最適化
- 不要なレンダリング最適化の自動化
- バンドルサイズの削減

### 2. Server Components でのキャッシング戦略

```typescript
// src/app/dashboard/page.tsx 例

// Option 1: デフォルト（キャッシュなし）
export default function DashboardPage() {
  // 毎回新しくレンダリング
}

// Option 2: 静的キャッシング（再検証なし）
'use cache';

export default function DashboardPage() {
  // このコンポーネントはキャッシュされる
}

// Option 3: ISR（Incremental Static Regeneration）
export const revalidate = 3600; // 1時間後に再生成

export default function DashboardPage() {
  // 1時間ごとに再生成
}
```

**実装パターン:**

```typescript
// src/app/dashboard/page.tsx

'use cache'; // このページをキャッシュ

import { openWeatherMapClient } from '@/lib/apiClient';

export const revalidate = 1800; // 30分ごとに再生成

export default async function DashboardPage() {
  // 外部 API 呼び出し
  const weather = await openWeatherMapClient.get('/weather', {
    params: { lat: '35.6762', lon: '139.6503' },
  });

  return (
    <div>
      <h1>ダッシュボード</h1>
      <p>天気: {weather.main}</p>
    </div>
  );
}
```

### 3. `revalidateTag` / `updateTag` の活用

```typescript
// src/lib/actions.ts

'use server';

import { revalidateTag, updateTag } from 'next/cache';

export async function updateLocation(locationId: string) {
  // ... 位置情報を更新 ...

  // 該当するキャッシュを再検証
  revalidateTag(`location:${locationId}`);

  // または Server Action 内で即座に更新
  updateTag(`location:${locationId}`);
}
```

### 4. middleware.ts から proxy.ts への移行（推奨）

**Next.js 16 の変更:**
```
middleware.ts → proxy.ts
```

移行が必要な場合:

```typescript
// src/proxy.ts（新規）

import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  // ネットワーク境界でのリクエスト処理
  // 認証チェック、ヘッダー操作など

  const response = NextResponse.next();
  response.headers.set('X-Custom-Header', 'value');
  return response;
}

export const config = {
  matcher: [
    // 対象パス
    '/((?!_next|favicon).*)',
  ],
};
```

現状で `middleware.ts` がない場合は実装不要。

### 5. Image コンポーネントの最適化

```typescript
// src/app/page.tsx 例

import Image from 'next/image';

export default function Home() {
  return (
    <div>
      {/* Next.js 16 での自動画像最適化 */}
      <Image
        src="/logo.png"
        alt="Fishing Conditions App"
        width={200}
        height={200}
        loading="lazy" // 遅延ロード
        priority={false} // 優先度ロード（フォールド上の画像のみ true）
      />
    </div>
  );
}
```

### 6. PWA 機能の再有効化（オプション）

```javascript
// next.config.mjs（将来の実装）

// next-pwa が Turbopack に対応したら再有効化
// const withPWA = require('next-pwa')({ ... });
// export default withPWA(nextConfig);
```

**確認方法:**
- [next-pwa GitHub](https://github.com/shadowwalker/next-pwa)で Turbopack サポート状況を確認

## 実装チェックリスト

### Phase 1: 必須

- [ ] `next.config.mjs` で React Compiler を有効化（`experimental.reactCompiler: true`）
- [ ] Turbopack 設定を確認・最適化
- [ ] 型チェック: `npm run type-check`
- [ ] ビルド確認: `npm run build`
- [ ] 開発サーバー確認: `npm run dev`

### Phase 2: 推奨

- [ ] ダッシュボードなど主要ページに `'use cache'` ディレクティブを追加
- [ ] `revalidate` 設定でキャッシュ戦略を定義（天気: 30分、潮汐: 6時間）
- [ ] 静的生成可能なページを最適化
- [ ] Image コンポーネントで遅延ロード設定
- [ ] バンドルサイズを測定・最適化

### Phase 3: オプション

- [ ] `proxy.ts` への移行（middleware.ts がある場合）
- [ ] PWA 機能の再有効化（next-pwa の Turbopack サポート確認後）
- [ ] Performance Insights 導入（Vercel Analytics）

## パフォーマンス改善の期待値

### React Compiler による改善

| メトリクス | 改善率 |
|-----------|-------|
| Bundle Size | 5-10% 削減 |
| First Paint | 10-20% 高速化 |
| Interactive | 15-30% 高速化 |

### Turbopack による改善

| 項目 | 改善 |
|------|------|
| Dev Server Start | 2-5倍高速化 |
| Fast Refresh | 最大10倍高速化 |
| Build | 2-5倍高速化 |

## テスト戦略

### 開発環境での確認

```bash
# 開発サーバー起動（Turbopack が動作）
npm run dev

# ブラウザで確認
# - ページ遷移の速度
# - Hot Reload の速度

# ビルド確認
npm run build

# ビルド後の起動
npm run start
```

### パフォーマンス測定

```bash
# Lighthouse でパフォーマンス測定
# Chrome DevTools で bundle size を確認

# Next.js Analytics（Vercel 統合時）
# Vercel Dashboard → Analytics
```

### 動作確認チェックリスト

- [ ] 開発サーバーが快適に動作
- [ ] ページの読み込み時間が許容範囲内
- [ ] キャッシュが正しく機能
- [ ] エラーが出ないこと（console）
- [ ] `npm run type-check` でエラーなし
- [ ] `npm run lint` でエラーなし

## 互換性確認

### Node.js バージョン

```json
// package.json または .nvmrc
{
  "engines": {
    "node": ">=20.9.0"
  }
}
```

現状: Node.js 24.11.0（✅ 対応）

### TypeScript バージョン

```json
{
  "devDependencies": {
    "typescript": "^5.9.3" // ✅ 5.1.0 以上必須
  }
}
```

## ロールバック戦略

React Compiler で問題が発生した場合:

```javascript
// next.config.mjs
experimental: {
  reactCompiler: false, // 無効化
},
```

## 完了判定基準

- [ ] React Compiler が有効化され、ビルド成功
- [ ] `npm run dev` で開発サーバーが起動
- [ ] `npm run build && npm run start` で本番ビルド成功
- [ ] `npm run type-check` でエラーなし
- [ ] `npm run lint` でエラーなし
- [ ] パフォーマンス測定で改善を確認
- [ ] 既存機能が正常に動作

## 関連ドキュメント

- [Next.js 16 Official Release Notes](https://nextjs.org/blog/next-16)
- [Next.js: Data Cache](https://nextjs.org/docs/app/building-your-application/caching)
- [React Compiler Playground](https://playground.react.dev/)
- [CLAUDE.md: Next.js 16 情報](../CLAUDE.md)

## 参考: rule.md ガイドライン

> **パフォーマンスの意識**
> - 推測ではなく計測に基づいて最適化
> - 初期段階から拡張性を考慮
> - キャッシュの有効期限と無効化戦略を明確に
