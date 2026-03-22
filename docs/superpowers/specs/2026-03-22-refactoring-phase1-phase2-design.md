# リファクタリング設計書：Phase 1 + Phase 2

**日付:** 2026-03-22
**ブランチ戦略:** `develop` からブランチを切る
**対象:** `refactoring-candidates.md` #1〜#10

---

## 概要

コードベース全体の重複排除（Phase 1）と大型ファイルの構造分解（Phase 2）を段階的に行う。
各項目を独立したPRで進め、Phase 1 完了後に Phase 2 に移行する。
テストは別タスクとして後回しにする。

---

## Phase 1：重複解消（#1〜#5）

### 新規ファイル構成

```
src/lib/validators/
├── uuidValidator.ts       # UUID検証
├── coordinateValidator.ts # 座標バリデーション + 丸め処理
└── index.ts               # re-export

src/lib/utils/
├── dashboardUtils.ts      # 既存（一部変更: formatDate → formatDisplayDate）
├── dateUtils.ts           # 日付フォーマット統一（新規）
└── scoreRank.ts           # スコアランク判定（新規: 循環依存回避のため独立）

src/lib/apiResponseHandler.ts  # APIエラーレスポンス統一（新規）
```

### 各PRの詳細

#### PR-1 `refactor/#2`：UUID検証統一

**新規ファイル:** `src/lib/validators/uuidValidator.ts`

```typescript
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUUID(value: string | undefined): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value)
}
```

**変更ファイル:**
- `src/app/api/favorites/route.ts`（3箇所のインライン検証を `isValidUUID()` 呼び出しに差し替え）
- `src/auth/index.ts`（2箇所のインライン検証を `isValidUUID()` 呼び出しに差し替え）

---

#### PR-2 `refactor/#3`：日付フォーマット統一 + スコアランク判定一本化

**新規ファイル:** `src/lib/utils/dateUtils.ts`

```typescript
// YYYY-MM-DD形式（ローカルタイムベース）
// scoringService.ts の formatDateToString 相当。
// toISOString() は UTC ベースで日本（UTC+9）では午前0〜9時に前日の日付を返すため、
// 潮汐データの日付マッチングにはローカルタイムが必要。
export function formatDateLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 日本語ロケール表示形式（dashboardUtils の formatDate 相当）
export function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })
}
```

> **タイムゾーン注意:** `dashboard/page.tsx` は既存で `toISOString().split('T')[0]` を使用しており、これは意図的な UTC ベースのため変更しない。`dateUtils.ts` には UTC ベース関数は追加しない。

**新規ファイル:** `src/lib/utils/scoreRank.ts`

循環依存を避けるため、スコアランク判定ロジックを独立ファイルに切り出す。
`scoringService.ts` と `dashboardUtils.ts` の両者がここをインポートする。

```typescript
import type { ScoreRank } from '@/types/scoring'

export function getScoreRank(score: number): ScoreRank {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'fair'
  if (score >= 20) return 'poor'
  return 'bad'
}
```

**変更ファイル:**
- `src/lib/scoringService.ts`
  - `formatDateToString` (private) → `dateUtils.formatDateLocal` に差し替え（ローカルタイムベースを維持）
  - `getRankFromScore` (private) → `scoreRank.getScoreRank` に差し替え
- `src/lib/utils/dashboardUtils.ts`
  - `formatDate` → 実装本体を削除し `dateUtils.formatDisplayDate` への re-export に変更（`export { formatDisplayDate as formatDate } from '../dateUtils'`）
    - **確認済み:** `formatDate` を外部からインポートしているファイルは存在しない（grep 確認）。ただし `dashboardUtils.ts` を使用するコンポーネント7ファイル（`dashboard/page.tsx`, `ScoreCard.tsx`, `TimeScoreCard.tsx`, `WeatherCard.tsx`, `TideCard.tsx`, `ScoreBadge.tsx`, `page.tsx`）への影響はない（`formatDate` は外部から呼ばれていないため）
  - `getScoreRank` → 実装を `scoreRank.getScoreRank` への re-export に変更
- `src/app/dashboard/page.tsx` → **変更なし**（既存の `toISOString().split('T')[0]` を維持。UTC ベースで意図通りのため）

> **タイムゾーン注意:** `scoringService.ts` の `formatDateToString` はローカルタイムベースであり、潮汐データの日付マッチング（`tideData.tides.find((t) => t.date === today)`）で使用している。`toISOString()` に置き換えると日本時間の午前0〜9時に日付がずれて `todayTides` が `undefined` になるバグが発生する。`formatDateLocal` はローカルタイムベースを維持する。

---

#### PR-3 `refactor/#4`：座標丸め処理統一

**新規ファイル:** `src/lib/validators/coordinateValidator.ts`

```typescript
// 座標の丸め処理（favorites/route.ts で使用）
export function roundCoordinate(value: number, precision = 4): number {
  return Math.round(value * 10 ** precision) / 10 ** precision
}

// 文字列クエリパラメータをパース + バリデーション（weather/route.ts の既存シグネチャを維持）
export function parseAndValidateCoordinates(
  lat: string | null,
  lon: string | null,
): { lat: number; lon: number } | { error: string } {
  if (!lat || !lon) {
    return { error: '緯度(lat)と経度(lon)は必須パラメータです' }
  }
  const latNum = parseFloat(lat)
  const lonNum = parseFloat(lon)
  if (isNaN(latNum) || isNaN(lonNum)) {
    return { error: '緯度と経度は有効な数値である必要があります' }
  }
  if (latNum < -90 || latNum > 90) {
    return { error: '緯度は-90から90の範囲である必要があります' }
  }
  if (lonNum < -180 || lonNum > 180) {
    return { error: '経度は-180から180の範囲である必要があります' }
  }
  return { lat: latNum, lon: lonNum }
}
```

> **注意:** `weather/route.ts` の既存 `validateCoordinates` は `string | null` を受け取りパースも行う。
> 新関数は `parseAndValidateCoordinates` という名前で既存のシグネチャ・返却型をそのまま維持し、呼び出し元の変更を最小化する。

**変更ファイル:**
- `src/app/api/favorites/route.ts`（`roundCoordinate` をインポートに変更）
- `src/app/api/weather/route.ts`（ローカルの `validateCoordinates` を削除し `parseAndValidateCoordinates` をインポートして呼び出し）

---

#### PR-4 `refactor/#5`：APIエラーレスポンス統一

**新規ファイル:** `src/lib/apiResponseHandler.ts`

```typescript
import { NextResponse } from 'next/server'

export function createErrorResponse(
  message: string,
  status: number,
  code?: string
): NextResponse {
  return NextResponse.json({ error: message, code, status }, { status })
}
```

**変更ファイル:**
- `src/app/api/weather/route.ts`
- `src/app/api/conditions/tide/route.ts`
- `src/app/api/locations/search/route.ts`

---

## Phase 2：構造分解（#6〜#10）

Phase 1 の全PRマージ完了後に開始する。

### 新規ファイル構成

```
src/lib/scoring/
├── index.ts                 # ScoringEngine（総合計算のみ、約100行）
├── tideScore.ts             # 潮汐スコア計算（95行）
├── weatherScore.ts          # 天気スコア計算（45行）
├── timeScore.ts             # 時間帯スコア計算（37行）
└── explanationGenerator.ts  # 説明文生成（49行）

src/lib/api/
├── client.ts                # ApiClientコア（約150行）
├── retryStrategy.ts         # リトライロジック
├── errorHandler.ts          # エラー分類・解析
└── types.ts                 # ApiError, RequestOptions 型定義

src/app/api/favorites/
├── route.ts                 # エントリポイント（約80行）
├── handlers/
│   ├── getFavorites.ts      # GET処理
│   ├── addFavorite.ts       # POST処理
│   └── deleteFavorite.ts    # DELETE処理
└── services/
    └── locationResolver.ts  # locationId/portId/coordinates パターン処理

src/auth/
├── index.ts                 # 設定エクスポート（約50行）
├── callbacks/
│   ├── signInCallback.ts
│   ├── jwtCallback.ts
│   └── sessionCallback.ts
├── providers/
│   ├── credentials.ts
│   └── google.ts
└── utils/
    └── userRepository.ts

src/lib/validators/           # Phase 1で作成済みを拡張
├── uuidValidator.ts          # Phase 1で作成
├── coordinateValidator.ts    # Phase 1で作成
├── queryValidator.ts         # 検索クエリバリデーション（新規）
├── dateValidator.ts          # 日付バリデーション（新規）
├── portCodeValidator.ts      # 港コードバリデーション（新規）
└── index.ts                  # re-export
```

### 各PRの詳細

#### PR-5 `refactor/#6`：scoringService.ts 分解

`src/lib/scoringService.ts`（370行）を `src/lib/scoring/` に分解する。

- `tideScore.ts`：`calculateTideScore` を移動
- `weatherScore.ts`：`calculateWeatherScore` を移動
- `timeScore.ts`：`calculateTimeScore` を移動
- `explanationGenerator.ts`：`generateExplanation` を移動
- `index.ts`：`ScoringEngine` クラスを残し、各モジュールをインポート

**後方互換性:** `src/lib/scoringService.ts` は `src/lib/scoring/index.ts` への re-export ファイルとして残す（全参照先の更新は行わない）。

```typescript
// src/lib/scoringService.ts（re-export のみ）
export { ScoringEngine, scoringEngine, calculateFishingScore } from './scoring/index'
```

> **理由:** テストなし・参照先3ファイル（`src/app/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/api/scores/route.ts`）の更新コストに比べ、re-export の方がリスクが低い。
> `scoringEngine`（インスタンス）と `calculateFishingScore`（関数）も re-export に含める。

---

#### PR-6 `refactor/#7`：apiClient.ts 分解

`src/lib/apiClient.ts`（338行）を `src/lib/api/` に分解する。

- `types.ts`：`ApiError`（class）, `ApiErrorType`（enum）, `RequestOptions` 型定義を移動
- `retryStrategy.ts`：リトライロジックを抽出
- `errorHandler.ts`：エラー分類・解析ロジックを抽出
- `client.ts`：`ApiClient` コアを残し、各モジュールをインポート。`openWeatherMapClient`・`googleMapsClient`・`tide736Client` の3インスタンスもここで定義する

**後方互換性:** `src/lib/apiClient.ts` を re-export ファイルとして残す。

```typescript
// src/lib/apiClient.ts（re-export のみ）
export { ApiClient, openWeatherMapClient, googleMapsClient, tide736Client } from './api/client'
export { ApiError, ApiErrorType } from './api/types'
```

---

#### PR-7 `refactor/#8`：favorites/route.ts 分解

`src/app/api/favorites/route.ts`（304行）を分解する。

- `handlers/getFavorites.ts`：GET処理
- `handlers/addFavorite.ts`：POST処理（locationId / portId / coordinates の3パターン）
- `handlers/deleteFavorite.ts`：DELETE処理
- `services/locationResolver.ts`：3パターンの分岐ロジック
- `route.ts`：ハンドラ呼び出しのみ（約80行）

> **Next.js App Router について:** `src/app/api/favorites/` 配下に `handlers/` や `services/` サブディレクトリを作成しても、Next.js App Router はそれらをHTTPルートとして登録しない。`route.ts`（または `route.js`）という名前のファイルのみがHTTPハンドラとして登録される仕様のため、この構成は安全である。

---

#### PR-8 `refactor/#9`：auth/index.ts 分解

`src/auth/index.ts`（261行）を分解する。

- `callbacks/signInCallback.ts`：signInコールバック（85行）
- `callbacks/jwtCallback.ts`：jwtコールバック（45行）
- `callbacks/sessionCallback.ts`：sessionコールバック
- `providers/credentials.ts`：Credentials認証
- `providers/google.ts`：Google認証
- `utils/userRepository.ts`：`getUser` 関数
- `index.ts`：設定エクスポートのみ（約50行）

---

#### PR-9 `refactor/#10`：バリデーション統合

Phase 1 で作成した `src/lib/validators/` を拡張する。

`src/app/api/conditions/tide/route.ts` に存在する4つの要素を以下のように配置する：

| 元の定数/関数 | 移動先 |
|-------------|--------|
| `DATE_REGEX` | `dateValidator.ts` |
| `getTodayDateString()` | `dateValidator.ts` |
| `PORT_CODE_REGEX` | `portCodeValidator.ts` |
| `PREFECTURE_CODE_REGEX` | `portCodeValidator.ts`（港コード・都道府県コードは同じ文脈のため同居） |

- `queryValidator.ts`：`src/app/api/locations/search/route.ts` の `isValidQuery()` を移動
- `dateValidator.ts`：`DATE_REGEX`, `getTodayDateString()` を移動
- `portCodeValidator.ts`：`PORT_CODE_REGEX`, `PREFECTURE_CODE_REGEX` を移動
- `index.ts`：全バリデーターを re-export

---

## ブランチ戦略

| PR | ブランチ名 | ベース | 内容 |
|----|-----------|--------|------|
| PR-1 | `refactor/#2` | `develop` | UUID検証統一 |
| PR-2 | `refactor/#3` | `develop` | 日付フォーマット + スコアランク統一 |
| PR-3 | `refactor/#4` | `develop` | 座標丸め処理統一 |
| PR-4 | `refactor/#5` | `develop` | APIエラーレスポンス統一 |
| PR-5 | `refactor/#6` | `develop`（Phase 1 全マージ後） | scoringService.ts 分解 |
| PR-6 | `refactor/#7` | `develop`（Phase 1 全マージ後） | apiClient.ts 分解 |
| PR-7 | `refactor/#8` | `develop`（Phase 1 全マージ後） | favorites/route.ts 分解 |
| PR-8 | `refactor/#9` | `develop`（Phase 1 全マージ後） | auth/index.ts 分解 |
| PR-9 | `refactor/#10` | `develop`（Phase 1 全マージ後） | バリデーション統合 |

Phase 1（PR-1〜PR-4）を全て `develop` にマージ完了した後の `develop` HEAD から、Phase 2 の各ブランチを切る。
Phase 2 の各PRは互いに独立しているため、並行して進めることができる。

---

## 完了条件

- 各PRでビルドエラーなし（`npm run type-check && npm run build` が通る）
- Biomeフォーマット・Oxlintチェック通過（`npm run lint && npm run format`）
- 既存機能の動作が変わらないこと（振る舞いの変更なし）
- テストは別タスクで対応

---

## 非対象（Phase 3 以降）

`refactoring-candidates.md` の #11〜#15（フック・コンポーネント・キャッシュの改善）は今回のスコープ外とする。
