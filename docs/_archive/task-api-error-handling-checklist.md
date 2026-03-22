# Task 2: API エラーハンドリング - 完了チェックリスト

## 実装完了項目

### ✅ Core Implementation

- [x] `ApiError` クラスを定義
  - [x] `type: ApiErrorType` プロパティ
  - [x] `statusCode?: number` プロパティ
  - [x] `retryable: boolean` プロパティ
  - [x] カスタムエラーメッセージ

- [x] `ApiErrorType` 列挙型を定義
  - [x] TIMEOUT
  - [x] RATE_LIMITED
  - [x] SERVER_ERROR
  - [x] CLIENT_ERROR
  - [x] NETWORK_ERROR

- [x] タイムアウト機構を実装
  - [x] `AbortController` で実装
  - [x] `timeout` オプション追加（デフォルト: 10秒）
  - [x] `RequestOptions` に `timeout` フィールド

- [x] リトライロジックを実装
  - [x] 指数バックオフ (100ms, 200ms, 400ms, ...)
  - [x] `retries` オプション追加（デフォルト: 3回）
  - [x] リトライ対象エラーの定義
  - [x] リトライしないエラーの定義
  - [x] リトライ時のログ出力

- [x] ステータスコード別エラー分類
  - [x] 429 (Rate Limited)
  - [x] 5xx (Server Error)
  - [x] 4xx (Client Error)
  - [x] その他のコード

- [x] エラーレスポンス解析
  - [x] JSON レスポンスの処理
  - [x] テキストレスポンスの処理
  - [x] エラーメッセージ抽出

- [x] 各種エラーハンドリング
  - [x] タイムアウトエラー（DOMException）
  - [x] ネットワークエラー（TypeError）
  - [x] API エラー（HTTP エラーレスポンス）
  - [x] 予期しないエラー

### ✅ Utility Functions

- [x] `src/lib/apiErrorUtils.ts` を作成
  - [x] `isApiError()` - 型ガード関数
  - [x] `getErrorMessage()` - 日本語メッセージ
  - [x] `isRetryable()` - リトライ可能判定
  - [x] `logApiError()` - 構造化ログ
  - [x] `retryWithBackoff()` - 手動リトライ関数

### ✅ Documentation

- [x] `docs/task-api-error-handling.md` - タスク要件
- [x] `docs/api-error-handling-usage.md` - 使用方法ガイド
- [x] コード内コメント - JSDoc フォーマット

### ✅ Code Quality

- [x] `npm run type-check` - ✅ エラーなし
- [x] `npm run lint` - ✅ エラーなし
- [x] `npm run build` - ✅ 成功

## 実装仕様の確認

### タイムアウト

```typescript
// デフォルト: 10秒
const response = await openWeatherMapClient.get('/weather', {
  /* ... */
});

// カスタム: 5秒
const response = await openWeatherMapClient.get('/weather', {
  timeout: 5000,
});
```

✅ **実装確認**:

- `AbortController` で実装
- `DOMException` with `name === 'AbortError'` でキャッチ
- リトライ対象

### リトライ

```typescript
// デフォルト: 3回リトライ
const data = await openWeatherMapClient.get('/endpoint');

// カスタム: 1回リトライ
const data = await openWeatherMapClient.get('/endpoint', { retries: 1 });
```

✅ **実装確認**:

- 指数バックオフ: 100ms → 200ms → 400ms
- リトライ対象エラー: 408, 429, 500, 502, 503, 504
- リトライ不可エラー: 400, 401, 403, 404
- コンソールにリトライ情報をログ出力

### エラー分類

```typescript
try {
  const data = await openWeatherMapClient.get('/weather', {
    /* ... */
  });
} catch (error) {
  if (error instanceof ApiError) {
    switch (error.type) {
      case ApiErrorType.TIMEOUT:
        // 10秒以内に応答がなかった
        break;
      case ApiErrorType.RATE_LIMITED:
        // HTTP 429 が返された
        break;
      case ApiErrorType.SERVER_ERROR:
        // HTTP 5xx が返された
        break;
      case ApiErrorType.CLIENT_ERROR:
        // HTTP 4xx が返された
        break;
      case ApiErrorType.NETWORK_ERROR:
        // ネットワークエラーまたはタイムアウト
        break;
    }
  }
}
```

✅ **実装確認**:

- すべてのエラー型が分類可能
- `retryable` プロパティでリトライ可否を判定

## 動作検証テスト

### テスト 1: 正常なリクエスト

```bash
# ホームページで Locations を取得（Prisma から）
npm run dev
# ブラウザで http://localhost:3000 にアクセス
# → Locations が正常に表示されることを確認
```

**期待結果**: Locations が読み込まれる

**実装の状態**: ✅ Prisma Server Component で動作

---

### テスト 2: タイムアウトのシミュレーション

モック API を使用してテストします（手動テスト時）:

```typescript
// テスト用: 遅い API にアクセス
const slowApiClient = new ApiClient(
  'https://httpbin.org/delay/15', // 15秒待機
  '',
);

try {
  const data = await slowApiClient.get('/', {
    timeout: 5000, // 5秒でタイムアウト
  });
} catch (error) {
  if (error instanceof ApiError) {
    console.log(error.type); // ApiErrorType.TIMEOUT
    console.log(error.retryable); // true
  }
}
```

**期待結果**:

- 5秒後に `ApiError` がスロー
- `type === 'TIMEOUT'`
- `retryable === true`
- リトライが最大 3回実行される

---

### テスト 3: 429 (Rate Limited) のシミュレーション

```typescript
// モック API: 429 を返す
const mockApiClient = new ApiClient('https://httpbin.org/status/429', '');

try {
  const data = await mockApiClient.get('/');
} catch (error) {
  if (error instanceof ApiError) {
    console.log(error.type); // ApiErrorType.RATE_LIMITED
    console.log(error.statusCode); // 429
    console.log(error.retryable); // true
  }
}
```

**期待結果**:

- `ApiError` がスロー
- `type === 'RATE_LIMITED'`
- `statusCode === 429`
- `retryable === true`
- リトライが実行される（コンソールに表示）

---

### テスト 4: 404 (Not Found) - リトライしない

```typescript
// モック API: 404 を返す
const mockApiClient = new ApiClient('https://httpbin.org/status/404', '');

try {
  const data = await mockApiClient.get('/');
} catch (error) {
  if (error instanceof ApiError) {
    console.log(error.type); // ApiErrorType.CLIENT_ERROR
    console.log(error.statusCode); // 404
    console.log(error.retryable); // false (リトライしない)
  }
}
```

**期待結果**:

- `ApiError` がスロー
- `type === 'CLIENT_ERROR'`
- `statusCode === 404`
- `retryable === false`
- リトライが実行されない（コンソールに表示されない）

---

### テスト 5: ネットワークエラーのシミュレーション

```typescript
// インターネット接続を切断してテスト
const weatherClient = new ApiClient(
  'https://api.openweathermap.org/data/2.5',
  'test-key',
  'query',
  'appid',
);

try {
  const data = await weatherClient.get('/weather', {
    params: { lat: '35.6762', lon: '139.6503' },
  });
} catch (error) {
  if (error instanceof ApiError) {
    console.log(error.type); // ApiErrorType.NETWORK_ERROR
    console.log(error.retryable); // true
  }
}
```

**期待結果**:

- `ApiError` がスロー
- `type === 'NETWORK_ERROR'`
- `retryable === true`
- リトライが実行される

---

## 現実的なテスト確認

### API が正常に動作しているか確認

```bash
# 開発サーバーを起動
npm run dev

# ホームページで Prisma から Locations を取得（既存機能）
# → console.log で既存エラーが見えないことを確認
```

### 型安全性の確認

```bash
# TypeScript 型チェック
npm run type-check

# ESLint チェック
npm run lint
```

**期待結果**: ✅ エラーなし

---

## 次のステップ

Task 2 の実装が完了しました。以下のタスクに進めます：

1. **Task 3**: パスワード強度検証の強化
2. **Task 4**: キャッシング戦略の実装
3. **Task 5**: API レート制限の実装
4. **Task 6**: Next.js 16 への現代化

## 参考資料

- [MDN: AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [MDN: Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
- [rule.md: 信頼性の確保](../rule.md)
