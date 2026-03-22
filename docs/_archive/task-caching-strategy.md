# Task 4: キャッシング戦略の実装

## 概要
外部 API（OpenWeatherMap、tide736.net）のレスポンスを Redis（Upstash）でキャッシュし、レスポンス時間と API クォータの消費を最適化する。

**関連ファイル:**
- `src/lib/apiClient.ts` - ApiClient クラス
- 新規: `src/lib/cache.ts` - キャッシング機構
- `.env.example` - Redis 設定

## 現状の問題

### 1. キャッシング機構がない
- 毎回 API を呼び出し → API クォータを無駄に消費
- ユーザーの読み込み時間が遅い（API の応答時間に依存）

### 2. キャッシュの TTL（Time To Live）戦略が不明確
```typescript
// next.config.mjs の PWA config にキャッシュ戦略のコメントがあるが実装されていない
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
]
```

### 3. 環境変数が不完全
```env
UPSTASH_REDIS_REST_URL=your-redis-url
UPSTASH_REDIS_REST_TOKEN=your-redis-token
```

## 実装要件

### キャッシュ戦略（TTL）

| API | TTL | 理由 |
|-----|-----|------|
| **OpenWeatherMap** | 30分（1,800秒） | 天気は30分ごとに変わる可能性がある |
| **tide736.net** | 6時間（21,600秒） | 潮汐データは長期的に安定 |
| **Google Maps Geocoding** | 24時間（86,400秒） | 地名の座標はほぼ変わらない |

### キャッシュキー設計

```typescript
// 例: weather:lat:35.6762,lng:139.6503
// 例: tide:prefecture:13,harbor:12345
// 例: geocode:address:tokyo-station
```

### キャッシング層の設計

```typescript
// src/lib/cache.ts - 新規ファイル

interface CacheOptions {
  ttl: number; // 秒単位
  namespace?: string; // キャッシュキーのプレフィックス
}

class CacheManager {
  private redis: Redis;

  async get<T>(key: string): Promise<T | null> {
    // Upstash Redis から取得
  }

  async set<T>(key: string, value: T, options: CacheOptions): Promise<void> {
    // Upstash Redis に設定
  }

  async invalidate(pattern: string): Promise<void> {
    // パターンマッチでキャッシュを削除
  }
}

export const cacheManager = new CacheManager();
```

### ApiClient への統合

```typescript
// src/lib/apiClient.ts 修正

class ApiClient {
  // ... 既存のコード ...

  private async request<T>(
    endpoint: string,
    options: RequestOptions & { cache?: CacheOptions } = {}
  ): Promise<T> {
    const { cache, ...requestOptions } = options;

    // キャッシュキーを生成
    if (cache) {
      const cacheKey = this.generateCacheKey(endpoint, requestOptions.params);
      const cached = await cacheManager.get<T>(cacheKey);
      if (cached) {
        console.log(`[Cache HIT] ${cacheKey}`);
        return cached;
      }
    }

    // API を呼び出し
    const response = await this.fetchWithRetry(endpoint, requestOptions);
    const data = await response.json() as T;

    // キャッシュに保存
    if (cache) {
      const cacheKey = this.generateCacheKey(endpoint, requestOptions.params);
      await cacheManager.set(cacheKey, data, cache);
    }

    return data;
  }
}
```

### 使用例

```typescript
// 既存
const weather = await openWeatherMapClient.get<WeatherData>(
  '/weather',
  { params: { lat: '35.6762', lon: '139.6503' } }
);

// キャッシング対応
const weather = await openWeatherMapClient.get<WeatherData>(
  '/weather',
  {
    params: { lat: '35.6762', lon: '139.6503' },
    cache: { ttl: 1800, namespace: 'weather' } // 30分キャッシュ
  }
);
```

## 実装チェックリスト

- [ ] `src/lib/cache.ts` を作成（CacheManager クラス）
- [ ] Upstash Redis クライアント（@upstash/redis）をインポート
- [ ] キャッシュキー生成ロジックを実装
- [ ] ApiClient に `cache` オプションパラメータを追加
- [ ] `openWeatherMapClient` にキャッシング設定（TTL: 1,800秒）
- [ ] `tide736Client` にキャッシング設定（TTL: 21,600秒）
- [ ] `googleMapsClient` にキャッシング設定（TTL: 86,400秒）
- [ ] `.env.example` に Upstash Redis 設定を明示
- [ ] キャッシュ無効化ロジック（必要に応じて）
- [ ] ログ出力（キャッシュヒット/ミスの確認用）
- [ ] `npm run type-check` でエラーなし
- [ ] `npm run lint` でエラーなし

## キャッシュ無効化戦略

### 1. TTL ベース
- 自動的に期限切れデータを削除

### 2. イベントベース（推奨）
- ユーザーが場所を変更 → 関連キャッシュを削除
- 管理者が環境データを手動更新 → キャッシュをパージ

```typescript
// 例: 場所変更時にキャッシュを削除
async function changeLocation(lat: number, lon: number) {
  const cacheKey = `weather:lat:${lat},lng:${lon}`;
  await cacheManager.invalidate(cacheKey);
  // ...
}
```

### 3. Next.js 16 の `revalidateTag` / `updateTag`（推奨）
- Server Actions 内で使用
- より細かいキャッシュ制御が可能

```typescript
// 将来の実装（Next.js 16 機能）
import { revalidateTag, updateTag } from 'next/cache';

// キャッシュを再検証
await revalidateTag(`weather:${locationId}`);

// Server Action 内でのみ使用可能
await updateTag(`weather:${locationId}`);
```

## パフォーマンス考慮事項

### メモリ効率
- Upstash Redis の無料プラン: 限定的（最大 100MB）
- キャッシュサイズを監視
- 不要なキャッシュは定期的に削除

### 一貫性
- キャッシュが古いデータを返す可能性
- TTL を適切に設定して最小化
- ユーザーに「キャッシュ時刻」を表示（オプション）

## テスト戦略

### テストケース

1. **キャッシュヒット**
   - API を呼び出し → キャッシュに保存
   - 同じリクエスト → キャッシュから返却（ログで確認）

2. **キャッシュミス**
   - キャッシュ期限切れ → API を呼び出し

3. **キャッシュ無効化**
   - 明示的に削除 → 次リクエストで API 呼び出し

4. **TTL の正確性**
   - 期限を超えたデータが返されないことを確認

## 完了判定基準

- [ ] すべてのチェックリスト項目が完了
- [ ] Upstash Redis に接続可能
- [ ] キャッシュヒット/ミスのログが確認できる
- [ ] `npm run type-check` でエラーなし
- [ ] `npm run lint` でエラーなし
- [ ] 各 API（weather, tide, maps）のキャッシングが動作確認済み

## 関連ドキュメント

- [CLAUDE.md: 外部 API 統合](../CLAUDE.md#%E5%A4%96%E9%83%A8api%E7%B5%B1%E5%90%88critical-for-tasks)
- [rule.md: キャッシュ戦略の明確性](../rule.md)
- [Upstash Redis ドキュメント](https://docs.upstash.com/redis)
- [Next.js Data Cache](https://nextjs.org/docs/app/building-your-application/caching)
