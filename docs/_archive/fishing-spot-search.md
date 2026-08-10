---
name: 釣り場検索・切り替え機能
about: サイドバーに釣り場検索・履歴・お気に入り機能を実装
title: '釣り場検索・切り替え機能の実装'
labels: 'feature, enhancement, high-priority'
assignees: RRRRRRR-777
---

## 概要

ユーザーが釣り場を検索し、選択した釣り場のダッシュボードを表示できる機能を実装します。サイドバーに**タブ切り替え式の検索UI**（自由検索 / 港マスタ選択）と履歴・お気に入り管理を統合し、UXを向上させます。

### 実装方針

- **アプローチ**: サイドバー統合型（**タブ切り替え** + 履歴 + お気に入り）
- **検索方式**:
  - **「自由検索」タブ**: Google Geocoding API（任意の場所）- **認証不要**
  - **「港から選択」タブ**: ports マスタから選択（都道府県フィルタリング）- **認証不要**
- **データ保存**: 検索時に `locations` テーブルへ自動保存 + `user_search_history` で履歴記録（**要ログイン**）
- **状態管理**: URL遷移（`/dashboard?locationId=UUID`）+ `user_settings.default_location_id` 連携
- **潮汐対応**:
  - **港マスタ選択時**: 直接 `port_id` 設定（確実）
  - **自由検索時**: 最寄りの潮汐観測港を自動マッピング

### 認証仕様

| 機能 | 認証要否 | 理由 |
|------|---------|------|
| 検索タブ（自由検索・港選択） | **不要** | 公開機能。誰でも使える |
| 釣り場切り替え | **不要** | URLパラメータで直接アクセス可能 |
| お気に入り | **必須** | ユーザーデータ操作（`/api/user/favorites`） |
| 検索履歴 | **必須** | ユーザーデータ操作（`/api/user/search-history`） |
| デフォルト釣り場設定 | **必須** | ユーザー設定操作（`/api/user/settings`） |

**UI誘導**:
- 未ログイン時、お気に入り・履歴エリアに「ログインしてお気に入り・履歴を使おう」メッセージ表示
- ログイン後、自動的にお気に入り・履歴が表示される

### UI設計

#### サイドバー構成

```
┌─────────────────────────────┐
│ 🏠 ホーム                   │
│ 📍 釣り場                   │ ← 展開すると↓
│   ├─ 🔍 検索 [公開]        │
│   │   ├─ [自由検索] [港]   │ ← タブ切り替え
│   │   ├─ 検索バー/ドロップダウン
│   │   └─ 検索結果リスト
│   ├─ ⭐ お気に入り [要ログイン]
│   │   ├─ (未ログイン)
│   │   │   └─ "ログインして使おう" 誘導
│   │   └─ (ログイン済み)
│   │       └─ お気に入りリスト (3)
│   └─ 🕐 履歴 [要ログイン]
│       ├─ (未ログイン)
│       │   └─ "ログインして使おう" 誘導
│       └─ (ログイン済み)
│           └─ 履歴リスト (10)
└─────────────────────────────┘
```

#### タブ詳細

**1. 「自由検索」タブ [認証不要]**
- Google Geocoding API で任意の場所を検索
- 入力例: 「東京湾」「横浜港」「江ノ島周辺」
- debounce 300ms でリアルタイム検索
- 検索結果: 場所名、住所、距離表示
- 選択時: 最寄り港を自動マッピング → locations保存（ログイン時のみ）

**2. 「港」タブ [認証不要]**
- ports マスタ（約700港）から選択
- **都道府県ドロップダウン** → 港リスト表示
- 確実に潮汐データが取得可能
- 例: 東京都 → 芝浦港、品川港、...
- 選択時: locations保存（ログイン時のみ）

### 技術仕様

#### 1. データフロー

```
【自由検索タブ（認証不要）】
検索 → Google Geocoding API → 検索結果表示
   ↓ (選択)
ログイン済み? → Yes: 最寄り港マッピング → locations保存 → user_search_history記録
               → No: そのまま釣り場切り替え（locations保存なし）
   ↓
URL遷移 (/dashboard?lat=XX&lng=YY or /dashboard?locationId=UUID)
   ↓
dashboard/page.tsx: locationId優先 → なければlat/lngから一時的に使用
   ↓
潮汐データ取得: 最寄り港マッピング → tide736.net API

【港タブ（認証不要）】
都道府県選択 → ports一覧取得 → 港選択 → 検索結果表示
   ↓ (選択)
ログイン済み? → Yes: locations保存(port_id確定) → user_search_history記録
               → No: そのまま釣り場切り替え
   ↓
URL遷移 (/dashboard?portId=UUID)
   ↓
潮汐データ取得: ports → tide736.net API（確実）

【お気に入り・履歴（要ログイン）】
ログイン済み → お気に入り・履歴API呼び出し → 表示
未ログイン → 誘導メッセージ表示（「ログインして使おう」）
```

#### 2. 最寄り港マッピングロジック（自由検索用）

**課題**: Google Geocodingで見つけた任意の釣り場は、tide736.net APIの対応港（約700港）と一致しない可能性が高い

**解決策**: **緯度経度からの距離計算で最寄り港を自動割り当て**

```typescript
// Haversine距離計算（2点間の直線距離）
function calculateDistance(lat1, lon1, lat2, lon2): number {
  const R = 6371; // 地球の半径（km）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // km
}

// 最寄り港を検索（ports約700件を全件取得してJS計算）
const allPorts = await prisma.ports.findMany({
  where: { latitude: { not: null }, longitude: { not: null } }
});
const sorted = allPorts.map(p => ({
  ...p,
  distance: calculateDistance(lat, lng, p.latitude, p.longitude)
})).sort((a, b) => a.distance - b.distance);
return sorted[0]; // 最寄り港
```

#### 3. DB操作
- **locations**:
  - ログイン済み: `findOrCreate` + `port_id` 自動設定（自由検索）または確定（港選択）
  - 未ログイン: 保存なし（一時的に座標のみ使用）
- **ports**: 既存マスタを参照（都道府県でフィルタリング）
- **user_search_history**: **ログイン済みのみ**記録
- **user_favorites**: **ログイン済みのみ**操作可能
- **user_settings.default_location_id**: **ログイン済みのみ**設定可能

#### 4. API エンドポイント

**公開API（認証不要）**
- ✅ `GET /api/locations/search?q=XX` - **既存**（Google Geocoding利用）
- 🆕 `GET /api/ports?prefecture_code=13` - ports一覧取得（都道府県フィルタ）

**認証必須API（Auth.js proxy）**
- 🆕 `POST /api/locations` - locations保存 + 最寄り港マッピング
- 🆕 `POST /api/user/search-history` - 履歴記録
- 🆕 `GET /api/user/search-history` - 履歴取得
- 🆕 `POST /api/user/favorites` - お気に入り追加
- 🆕 `DELETE /api/user/favorites/:id` - お気に入り削除
- 🆕 `GET /api/user/favorites` - お気に入り一覧
- 🆕 `PATCH /api/user/settings` - デフォルト釣り場更新

## タスク

### Phase 1: 基本検索機能 + 港マスタ選択（優先度: 高）

- [x] **Task 1.1**: 最寄り港検索ロジック実装
  - [x] `lib/portMappingService.ts` 作成
  - [x] Haversine距離計算関数 `calculateDistance(lat1, lon1, lat2, lon2)`
  - [x] 最寄り港検索関数 `findNearestPort(latitude, longitude)` - 全portsを取得して距離計算
  - [] 単体テスト（東京湾 → 芝浦港など）

- [x] **Task 1.2**: 港マスタ取得API実装（**認証不要**）
  - [x] `GET /api/ports?prefecture_code=XX` エンドポイント作成
  - [x] 都道府県コードでフィルタリング（例: `13` → 東京都の港）
  - [x] レスポンス: `{ ports: [{ id, name, prefecture_code, port_code }] }`

- [x] **Task 1.3**: サイドバー検索UIコンポーネント作成（タブ切り替え式）
  - [x] `LocationSearchTabs.tsx` - タブコンテナ（shadcn/ui Tabs）
  - [x] `FreeSearchTab.tsx` - 自由検索タブ
    - shadcn/ui `Input` + `Popover` でリアルタイム検索
    - debounce 300ms
    - 検索結果リスト表示（場所名・住所・距離）
  - [x] `PortSelectionTab.tsx` - 港選択タブ
    - 都道府県ドロップダウン（shadcn/ui Select）
    - 港リスト表示（ScrollArea）
  - [x] ローディング・エラー状態UI

- [x] **Task 1.4**: `POST /api/locations` エンドポイント実装（**認証必須**）
  - [x] **パターンA（自由検索）**: Google Geocoding結果 + 最寄り港マッピング
    - `port_id` を自動設定（`findNearestPort` 利用）
    - 重複チェック（緯度経度で0.001度以内なら同一と判定）
  - [x] **パターンB（港選択）**: port_id を直接指定
    - locations保存時に `port_id` 確定
  - [x] セッションチェック: 未ログインは403エラー
  - [x] レスポンス: `{ id, name, latitude, longitude, prefecture, port_id, nearestPortDistance }`

- [x] **Task 1.5**: 釣り場切り替え処理実装
  - [x] URLクエリパラメータ解析
    - `locationId` → locations取得
    - `portId` → ports取得 + 緯度経度使用
    - `lat & lng` → 一時的に使用（locations保存なし）
  - [x] `dashboard/page.tsx` でクエリパラメータ優先ロジック追加
  - [x] エラーハンドリング（無効な座標・API失敗時）
  - [x] **潮汐データなし時の対処**: `tideScore = 20`（ニュートラル）+ UI表示

### Phase 2: 履歴機能（優先度: 高）

- [x] **Task 2.1**: 検索履歴記録API実装（**認証必須**）
  - [x] `POST /api/user/search-history` エンドポイント
  - [x] セッションチェック: 未ログインは401エラー
  - [x] `user_search_history` テーブルへの記録
  - [x] 重複制御（同一location_idは最新のタイムスタンプに更新）

- [x] **Task 2.2**: 履歴取得API実装（**認証必須**）
  - [x] `GET /api/user/search-history?limit=10` エンドポイント
  - [x] セッションチェック: 未ログインは401エラー
  - [x] 最新10件を取得（`searched_at DESC`）
  - [x] `locations` + `ports` テーブルと結合

- [x] **Task 2.3**: 履歴UIコンポーネント実装
  - [x] `SearchHistory.tsx` - サイドバー展開メニュー
  - [x] **未ログイン時**: 「ログインして履歴を使おう」誘導メッセージ
  - [x] **ログイン済み時**: 履歴アイテムリスト表示
  - [x] 履歴アイテムクリック → URL遷移
  - [x] 空状態メッセージ

### Phase 3: お気に入り機能（優先度: 中）

- [ ] **Task 3.1**: お気に入りCRUD API実装（**認証必須**）
  - [ ] `POST /api/user/favorites` - 追加
  - [ ] `DELETE /api/user/favorites/:id` - 削除
  - [ ] `GET /api/user/favorites` - 一覧取得
  - [ ] すべてセッションチェック: 未ログインは401エラー

- [ ] **Task 3.2**: お気に入りUIコンポーネント実装
  - [ ] `FavoritesList.tsx` - サイドバー展開メニュー
  - [ ] **未ログイン時**: 「ログインしてお気に入りを使おう」誘導メッセージ + ログインボタン
  - [ ] **ログイン済み時**: お気に入りリスト表示
  - [ ] お気に入りボタン（ハートアイコン、トグル式）
  - [ ] ドラッグ&ドロップで並び替え（将来拡張）

- [ ] **Task 3.3**: ダッシュボードにお気に入りボタン追加
  - [ ] 現在表示中の釣り場をお気に入り登録
  - [ ] **未ログイン時**: ボタン非表示またはグレーアウト + ツールチップ「ログインが必要です」
  - [ ] **ログイン済み時**: 楽観的更新（Optimistic UI）

### Phase 4: ログイン時復元機能（優先度: 中）

- [ ] **Task 4.1**: デフォルト釣り場設定API実装（**認証必須**）
  - [ ] `PATCH /api/user/settings` エンドポイント
  - [ ] セッションチェック: 未ログインは401エラー
  - [ ] `user_settings.default_location_id` 更新

- [ ] **Task 4.2**: ログイン後の初期表示ロジック実装
  - [ ] 優先順位: お気に入り > 最後の検索履歴 > デフォルト位置
  - [ ] `dashboard/page.tsx` でサーバーサイドで解決
  - [ ] セッション情報から `user_id` 取得


## 完了条件

### 必須（Phase 1-2）
- [x] サイドバーに「自由検索」「港」タブが表示される
- [x] 「自由検索」タブで任意の場所を検索できる（認証不要）
- [x] 「港」タブで都道府県から港を選択できる（認証不要）
- [x] 検索結果から釣り場を選択し、ダッシュボードが切り替わる
- [x] 自由検索時に**最寄りの潮汐観測港が自動マッピング**される
- [x] 港選択時に潮汐データが確実に取得できる
- [x] 検索履歴がサイドバーに表示される（ログイン済みのみ）
- [x] 未ログイン時、履歴エリアに「ログインして使おう」誘導が表示される
- [x] ログイン済み時、検索した釣り場が `locations` テーブルに保存される
- [x] URL共有で同じ釣り場を表示できる（`/dashboard?locationId=UUID` or `lat=XX&lng=YY`）
- [x] 潮汐データが取れない場合でも天気スコアは表示される

### 推奨（Phase 3-4）
- [x] お気に入り機能が動作する（追加・削除・一覧、ログイン済みのみ）
- [x] 未ログイン時、お気に入りエリアに「ログインして使おう」誘導が表示される
- [x] ログイン時にお気に入りまたは最後の検索履歴が復元される
- [x] 無効なURLパラメータ時にエラー処理される


## テスト方針

### 単体テスト
- [ ] `portMappingService.ts` の距離計算ロジック
- [ ] `locationService.ts` のGeocoding変換ロジック
- [ ] API エンドポイントのバリデーション
- [ ] API 認証チェック（未ログイン時401/403）
- [ ] `dashboard/page.tsx` のクエリパラメータ解析

### 統合テスト
- [ ] 自由検索 → 保存 → 最寄り港マッピング → 履歴記録の一連のフロー（ログイン済み）
- [ ] 港選択 → 保存 → 履歴記録の一連のフロー（ログイン済み）
- [ ] 未ログイン時の検索 → locations保存なし → ダッシュボード表示
- [ ] お気に入り追加 → 削除の状態管理（ログイン済み）
- [ ] ログイン時復元ロジック（優先順位検証）
- [ ] 潮汐データなし時のスコア計算（tideScore = 20）

### E2Eテスト（Playwright）
- [ ] ユーザーシナリオ（未ログイン）: 検索 → 選択 → ダッシュボード表示
- [ ] ユーザーシナリオ（ログイン済み）: 検索 → 選択 → locations保存 → 履歴記録
- [ ] お気に入り登録（ログイン済み）→ サイドバーから選択
- [ ] URL直接アクセス → ダッシュボード表示

## 技術的注意点

### パフォーマンス
- `locations` テーブルの `latitude`, `longitude` にインデックス設定済み（schema.prisma:86）
- `ports` テーブルは約700件のため、全件取得 → JS距離計算で許容範囲
- 都道府県フィルタで ports 取得を軽量化
- 検索APIは既にキャッシュ機能あり（`locationService.ts` + Redis）
- debounce で検索API呼び出しを制御

### セキュリティ
- **公開API**: `/api/locations/search`, `/api/ports` - 認証不要
- **認証必須API**: `/api/user/*` - Auth.js proxy で session チェック
- SQL injection 対策（Prisma ORM使用）
- XSS 対策（React自動エスケープ）

### データ整合性
- `locations.id` は UUID で一意性保証
- `user_favorites` は `@@unique([user_id, location_id])` で重複防止
- `user_search_history` は時系列データ（インデックス: `@@index([user_id, searched_at(sort: Desc)])`）
- **`locations.port_id` は nullable**（最寄り港が見つからない場合もある）

### Google Geocoding API 使用方針
- **既存実装を活用**: `GET /api/locations/search?q=XX` をそのまま使用
- **データフロー**: ユーザー入力 → API → Google Geocoding → Redis キャッシュ（1時間）→ レスポンス
- **コスト削減**:
  - Redis キャッシュ（1時間）
  - フロントエンド debounce（300ms）
  - DBキャッシュ（検索済み釣り場はDB参照、API不使用）
  - **港選択時はAPI不使用**（portsマスタのみ）
- **APIキー管理**: `.env.local` の `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` 使用（ブラウザ露出のためリファラー制限必須）

### 潮汐データ取得不可時の対処
- **最寄り港が見つからない場合**: `port_id = NULL` で保存
- **スコア計算**: `tideScore = 20`（ニュートラル、40点満点の半分）
- **UI表示**: 「この釣り場は潮汐データなし」と明示
- **推奨**: 港選択タブを優先的に使ってもらう（確実に潮汐データあり）

## 参考資料

### 既存実装
- [src/app/api/locations/search/route.ts](../../src/app/api/locations/search/route.ts) - 検索API
- [src/lib/locationService.ts](../../src/lib/locationService.ts) - Geocoding連携
- [src/lib/scoringService.ts](../../src/lib/scoringService.ts) - スコア計算（潮汐なし時の処理: L86-89）
- [src/components/organisms/AppSidebar.tsx](../../src/components/organisms/AppSidebar.tsx) - サイドバー
- [prisma/schema.prisma](../../prisma/schema.prisma) - DB定義
- [prisma/seed.ts](../../prisma/seed.ts) - ports マスタ投入スクリプト
- [portsCode/ports.csv](../../portsCode/ports.csv) - 港マスタCSV
- [src/auth/index.ts](../../src/auth/index.ts) - 認証ロジック（Auth.js）
- [docs/authentication.md](../../docs/authentication.md) - 認証仕様

### ドキュメント
- [docs/architecture.md](../../docs/architecture.md) - システム設計
- [docs/api-integration.md](../../docs/api-integration.md) - 外部API仕様（tide736.net仕様: L26-78）

### UI参考
- shadcn/ui Tabs: https://ui.shadcn.com/docs/components/tabs
- shadcn/ui Select: https://ui.shadcn.com/docs/components/select
- shadcn/ui Command: https://ui.shadcn.com/docs/components/command
- shadcn/ui Popover: https://ui.shadcn.com/docs/components/popover
- shadcn/ui ScrollArea: https://ui.shadcn.com/docs/components/scroll-area

### アルゴリズム参考
- Haversine formula: https://en.wikipedia.org/wiki/Haversine_formula