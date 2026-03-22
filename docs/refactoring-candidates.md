# リファクタリング候補一覧

## 概要

コードベース全体を調査し、リファクタリング可能なポイントを洗い出した結果をまとめる。
優先度は **高（すぐ着手可能）/ 中（構造的分解）/ 低（品質向上）** の3段階。

---

## 高優先度（シンプルで効果が大きい）

### 1. UUID検証ロジックの重複

**対象ファイル:**
- `src/app/api/favorites/route.ts` （3箇所）
- `src/auth/index.ts` （2箇所）

**問題:** 同じ正規表現 `/^[0-9a-f]{8}-[0-9a-f]{4}-...$/i` が5回繰り返されている。

**リファクタリング案:**
```typescript
// src/lib/validation.ts
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isValidUUID(value: string | undefined): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value)
}
```

---

### 2. スコアランク判定の重複

**対象ファイル:**
- `src/lib/scoringService.ts` （getRankFromScore）
- `src/lib/dashboardUtils.ts` （getScoreRank）

**問題:** 同じランク判定ロジックが2箇所に存在。

**リファクタリング案:** 片方に統一し、もう片方はインポートで参照。

---

### 3. 日付フォーマットの分散

**対象ファイル:**
- `src/lib/scoringService.ts` （formatDateToString）
- `src/lib/dashboardUtils.ts` （formatDate）
- `src/app/dashboard/page.tsx` （インライン実装）

**問題:** 日付フォーマット処理が3箇所で独立実装されている。

**リファクタリング案:**
```typescript
// src/lib/dateUtils.ts
export function formatDate(date: Date, format: 'YYYY-MM-DD' | 'display'): string { ... }
```

---

### 4. 座標丸め処理の重複

**対象ファイル:**
- `src/app/api/favorites/route.ts` （3箇所）

**問題:** 座標のrounding処理がファイル内で3回繰り返されている。

**リファクタリング案:**
```typescript
// src/lib/coordinateUtils.ts
export function roundCoordinate(value: number, precision = 4): number {
  return Math.round(value * 10 ** precision) / 10 ** precision
}
```

---

### 5. APIエラーレスポンス形式の不統一

**対象ファイル:**
- `src/app/api/weather/route.ts` → `{ error, code }`
- `src/app/api/conditions/tide/route.ts` → `{ error, status }`
- `src/app/api/locations/search/route.ts` → `{ error, status }`

**問題:** エンドポイントごとにエラーレスポンスの形式が異なる。

**リファクタリング案:**
```typescript
// src/lib/apiResponseHandler.ts
export function createErrorResponse(message: string, status: number, code?: string): NextResponse {
  return NextResponse.json({ error: message, code, status }, { status })
}
```

---

## 中優先度（構造的な分解）

### 6. `scoringService.ts` の分解（370行）

**対象:** `src/lib/scoringService.ts`

**問題:** スコア計算の全ロジックが1ファイルに集中。ScoringEngineクラスが350行超。

**現在の構成:**
- `calculateFishingScore()` - 総合スコア計算
- `calculateTideScore()` - 潮汐スコア（95行）
- `calculateWeatherScore()` - 天気スコア（45行）
- `calculateTimeScore()` - 時間帯スコア（37行）
- `generateExplanation()` - 説明文生成（49行）

**リファクタリング案:**
```
src/lib/scoring/
├── index.ts             # ScoringEngine（総合計算のみ、約100行）
├── tideScore.ts         # 潮汐スコア計算（95行）
├── weatherScore.ts      # 天気スコア計算（45行）
├── timeScore.ts         # 時間帯スコア計算（37行）
└── explanationGenerator.ts  # 説明文生成（49行）
```

---

### 7. `apiClient.ts` の分解（338行）

**対象:** `src/lib/apiClient.ts`

**問題:** `request()` メソッドが147行の巨大メソッド。キャッシュ/リトライ/タイムアウト/エラー処理が混在。

**リファクタリング案:**
```
src/lib/api/
├── client.ts           # ApiClient コア実装（約150行）
├── retryStrategy.ts    # リトライロジック
├── errorHandler.ts     # エラー分類・解析
└── types.ts            # ApiError, RequestOptions 型定義
```

---

### 8. `favorites/route.ts` の分解（304行）

**対象:** `src/app/api/favorites/route.ts`

**問題:** GET/POST/DELETEが1ファイル。特にPOSTに3パターンの分岐ロジック（locationId / portId / coordinates）がある。

**リファクタリング案:**
```
src/app/api/favorites/
├── route.ts                  # ハンドラエントリポイント（約80行）
├── handlers/
│   ├── getFavorites.ts       # GET処理
│   ├── addFavorite.ts        # POST処理
│   └── deleteFavorite.ts     # DELETE処理
└── services/
    └── locationResolver.ts   # locationId/portId/coordinates パターン処理
```

---

### 9. `auth/index.ts` の分解（261行）

**対象:** `src/auth/index.ts`

**問題:** 認証設定 + 全コールバック（signIn 85行、jwt 45行、session）が1ファイル。

**リファクタリング案:**
```
src/auth/
├── index.ts                  # 設定エクスポート（約50行）
├── callbacks/
│   ├── signInCallback.ts     # signInコールバック
│   ├── jwtCallback.ts        # jwtコールバック
│   └── sessionCallback.ts    # sessionコールバック
├── providers/
│   ├── credentials.ts        # Credentials認証
│   └── google.ts             # Google認証
└── utils/
    └── userRepository.ts     # getUser関数
```

---

### 10. バリデーション関数の統合

**対象ファイル:**
- `src/app/api/weather/route.ts` → `validateCoordinates()`
- `src/app/api/locations/search/route.ts` → `isValidQuery()`
- `src/app/api/conditions/tide/route.ts` → 正規表現定義

**問題:** 各APIルートでバリデーションを独自実装している。

**リファクタリング案:**
```
src/lib/validators/
├── coordinateValidator.ts   # 座標バリデーション
├── queryValidator.ts        # 検索クエリバリデーション
├── dateValidator.ts         # 日付バリデーション
└── portCodeValidator.ts     # 港コードバリデーション
```

---

## 低優先度（品質向上）

### 11. `useFavorites.ts` の分解（195行）

**対象:** `src/hooks/useFavorites.ts`

**問題:** 状態管理 + データ取得 + 楽観的UI更新 + 削除ロジックが1フックに集中。

**リファクタリング案:**
```
src/hooks/
├── useFavorites.ts              # メインフック（約60行）
├── useFavoritesFetch.ts         # データ取得
├── useFavoritesOptimistic.ts    # 楽観的更新ロジック
└── utils/
    └── favoriteRequestBuilder.ts  # リクエストボディ構築
```

---

### 12. `openWeatherService.ts` の重複解消

**対象:** `src/lib/openWeatherService.ts`

**問題:** `getCurrentWeather()` と `getForecast()` で座標rounding / キャッシュキー生成 / skipCache処理が重複。

**リファクタリング案:** 共通ヘルパーメソッドに抽出。

---

### 13. LocationSearchTabs の状態管理共有

**対象:**
- `src/components/organisms/LocationSearchTabs/PortSelectionTab.tsx` （186行）
- `src/components/organisms/LocationSearchTabs/FreeSearchTab.tsx` （160行）
- `src/components/organisms/LocationSearchTabs/FavoriteTab.tsx` （113行）

**問題:** 各タブが独立して loading / error / データ取得を管理している。

**リファクタリング案:** React Context で共有状態を管理。

---

### 14. `DashboardGrid` の責務分離（179行）

**対象:** `src/components/organisms/DashboardGrid.tsx`

**問題:** レイアウト + お気に入りロジック + ナビゲーション処理が混在。

**リファクタリング案:** お気に入りロジックをカスタムフックに抽出し、レイアウトに専念させる。

---

### 15. キャッシュレイヤーの再編（`cache.ts` 180行）

**対象:** `src/lib/cache.ts`

**問題:** TTL定義 / CacheClient実装 / ヘルパー関数が混在。

**リファクタリング案:**
```
src/lib/cache/
├── client.ts    # CacheClient 実装
├── config.ts    # TTL, PREFIX 定義
├── helpers.ts   # withCache, generateCacheKey
└── types.ts     # キャッシュ型定義
```

---

## 推奨アクションプラン

### Phase 1: 重複解消（1〜2日）
- #1 UUID検証統一
- #2 スコアランク判定統一
- #3 日付フォーマット統一
- #4 座標丸め処理統一
- #5 APIエラーレスポンス統一

### Phase 2: 構造分解（1〜2週間）
- #6 scoringService.ts 分解
- #7 apiClient.ts 分解
- #8 favorites/route.ts 分解
- #9 auth/index.ts 分解
- #10 バリデーション統合

### Phase 3: 品質向上（1〜2週間）
- #11〜#15 フック・コンポーネント・キャッシュの改善
