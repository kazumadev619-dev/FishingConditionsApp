# API エラーハンドリング - 使用方法ガイド

> - **状態**: 仕様（正）
> - **対応する実装**: `src/lib/api/`、`src/lib/apiClient.ts`、`src/lib/apiErrorUtils.ts`、`src/lib/openWeatherService.ts`
> - **最終確認**: 2026-11-20（#414 で、上流の応答が不正なときの節を足した。2026-11-07 に 429 を #368 で直した。リトライの条件・ログ・`apiErrorUtils.ts` は #388 で実装と突き合わせて直した）

## 概要

`src/lib/api/` に実装したエラーハンドリング機構の使用方法を説明します。`src/lib/apiClient.ts` は、その再エクスポートの入口で、以降の例はそこから import します。

**この HTTP クライアントはサーバー専用です。** `openWeatherMapClient` と `googleMapsClient` のキーはサーバー専用で、`NEXT_PUBLIC_` を付けられません（#143）。`'use client'` のコンポーネントから呼ばず、Route Handler・Server Action・サーバーコンポーネントから使います。ブラウザには `/api/*` の応答だけを返します。

## エクスポートされた型とクラス

### 1. ApiErrorType (列挙型)

```typescript
export enum ApiErrorType {
  TIMEOUT = 'TIMEOUT',               // リクエストタイムアウト
  RATE_LIMITED = 'RATE_LIMITED',     // API レート制限（429）
  SERVER_ERROR = 'SERVER_ERROR',     // サーバーエラー（5xx）
  CLIENT_ERROR = 'CLIENT_ERROR',     // クライアントエラー（4xx）
  NETWORK_ERROR = 'NETWORK_ERROR',   // ネットワークエラー
}
```

### 2. ApiError (カスタムエラークラス)

```typescript
export class ApiError extends Error {
  constructor(
    message: string,
    public type: ApiErrorType,
    public statusCode?: number,
    public retryable: boolean = false,
  )
}
```

**プロパティ:**
- `message`: エラーメッセージ
- `type`: エラーの種類（ApiErrorType）
- `statusCode`: HTTP ステータスコード（該当する場合）
- `retryable`: リトライ可能なエラーか

## 使用例

### 基本的なエラーハンドリング

```typescript
import { openWeatherMapClient, ApiError, ApiErrorType } from '@/lib/apiClient';

try {
  const weather = await openWeatherMapClient.get('/weather', {
    params: {
      lat: '35.6762',
      lon: '139.6503',
    },
  });

  console.log('天気データを取得しました:', weather);
} catch (error) {
  if (error instanceof ApiError) {
    switch (error.type) {
      case ApiErrorType.TIMEOUT:
        console.error('リクエストがタイムアウトしました');
        // ユーザーに「通信が遅い」メッセージを表示
        break;

      case ApiErrorType.RATE_LIMITED:
        console.error('API のレート制限に達しました');
        // ユーザーに「しばらく待ってから再度お試しください」と通知
        break;

      case ApiErrorType.SERVER_ERROR:
        console.error(`サーバーエラーが発生しました: ${error.statusCode}`);
        // ユーザーに「サーバーエラー」と通知
        break;

      case ApiErrorType.CLIENT_ERROR:
        console.error(`クライアントエラー: ${error.message}`);
        // ユーザーに「リクエストが無効です」と通知
        break;

      case ApiErrorType.NETWORK_ERROR:
        console.error('ネットワークエラーが発生しました');
        // ユーザーに「インターネット接続を確認してください」と通知
        break;
    }
  } else {
    // ApiError 以外の予期しないエラー
    console.error('予期しないエラー:', error);
  }
}
```

### タイムアウトと リトライの設定

```typescript
// デフォルト: タイムアウト 10秒、リトライ 3回

// カスタム設定: タイムアウト 5秒、リトライ 1回
const weather = await openWeatherMapClient.get('/weather', {
  params: { lat: '35.6762', lon: '139.6503' },
  timeout: 5000,  // 5秒
  retries: 1,     // 1回リトライ
});
```

### リトライ可能なエラーの判定

```typescript
try {
  const data = await openWeatherMapClient.get('/weather', { /* ... */ });
} catch (error) {
  if (error instanceof ApiError && error.retryable) {
    console.log('このエラーはリトライ可能です');
    console.log(`状態: ${error.type}, ステータス: ${error.statusCode}`);

    // 手動でリトライする場合
    // await retryWithExponentialBackoff(() => openWeatherMapClient.get(...));
  }
}
```

### Server Action での使用

```typescript
'use server';

import { openWeatherMapClient, ApiError, ApiErrorType } from '@/lib/apiClient';
import { logApiError } from '@/lib/apiErrorUtils';
import { logger } from '@/lib/logger';

export async function fetchWeatherData(lat: number, lon: number) {
  try {
    const weather = await openWeatherMapClient.get('/weather', {
      params: {
        lat: String(lat),
        lon: String(lon),
      },
      timeout: 8000, // 8秒
    });

    return { success: true, data: weather };
  } catch (error) {
    if (error instanceof ApiError) {
      // 構造化ログに記録する（`src/lib/apiErrorUtils.ts`。詳細は後述）
      logApiError(error, { operation: 'fetchWeatherData' });

      // ユーザーフレンドリーなメッセージを返す
      let userMessage = '天気情報の取得に失敗しました。';

      if (error.type === ApiErrorType.TIMEOUT) {
        userMessage = 'リクエストがタイムアウトしました。通信速度を確認してください。';
      } else if (error.type === ApiErrorType.RATE_LIMITED) {
        userMessage = 'API の使用制限に達しました。しばらく後にお試しください。';
      }

      return {
        success: false,
        error: userMessage,
        retryable: error.retryable,
      };
    }

    // ApiError 以外のエラー
    logger.error({ error }, 'Unexpected error');
    return {
      success: false,
      error: '予期しないエラーが発生しました。',
      retryable: false,
    };
  }
}
```

## リトライロジックの詳細

### 指数バックオフ

リトライ時の待機時間は指数バックオフで自動的に計算されます：

- **1回目のリトライ**: 100ms 待機
- **2回目のリトライ**: 200ms 待機
- **3回目のリトライ**: 400ms 待機
- **最大**: 5秒（それ以上は 5秒で固定）

```
attempt:     0     1     2
delay:      100ms 200ms 400ms
            └─┬──┘└─┬──┘└─┬──┘
            fetch  wait  fetch  wait  fetch
```

### リトライ対象エラー

自動的にリトライされるエラー：

```typescript
const RETRYABLE_STATUS_CODES = [
  408,  // Request Timeout
  500,  // Internal Server Error
  502,  // Bad Gateway
  503,  // Service Unavailable
  504,  // Gateway Timeout
];
```

タイムアウトもリトライ対象です。ネットワークエラーは、`TypeError` で、メッセージに `fetch` を含むものだけがリトライ対象です（`src/lib/api/retryStrategy.ts` の `isRetryable`）。それ以外の `TypeError` は `NETWORK_ERROR` になりますが、リトライしません。

**429（レート制限）はリトライしません。** 上流が絞っているときに叩き直すと、呼び出しが増えるだけで、状況を悪くするためです（#317）。429 は `ApiErrorType.RATE_LIMITED`、`retryable: false` になります（`src/lib/api/errorHandler.ts`）。

### リトライしないエラー

以下は自動リトライされません：

```typescript
const NON_RETRYABLE_STATUS_CODES = [
  400,  // Bad Request
  401,  // Unauthorized
  403,  // Forbidden
  404,  // Not Found
];
```

これらはクライアント側の問題（不正なリクエスト、認証エラーなど）なため、リトライしても成功しません。

## デバッグ方法

### ログの確認

リトライするたびに、サーバーで pino の構造化ログ（warn）が出ます（`src/lib/api/client.ts`）。

| 契機 | メッセージ | 項目 |
|---|---|---|
| リトライ対象のステータス（上の一覧）の応答 | `Retrying API request` | `endpoint`、`attempt`、`maxRetries`、`delayMs` |
| タイムアウト | `Retrying API request after timeout` | 上と同じ + `reason: 'timeout'` |
| ネットワークエラー | `Retrying API request after network error` | 上と同じ + `reason: 'network_error'` |

呼び出しはサーバーで行うので、リトライはブラウザの DevTools には見えません。サーバーのログで確認します。

## エラー表示とログのヘルパー（`src/lib/apiErrorUtils.ts`）

- `getErrorMessage(error: ApiError): string`: `ApiErrorType` から、利用者向けの日本語のメッセージを返す。
- `logApiError(error: ApiError, context?)`: `{ type: 'API_ERROR', errorType, statusCode, message, retryable, timestamp, ...context }` を、メッセージ `API request failed` で `logger.error` に出す。
- `isRetryable(error: ApiError): boolean`: `error.retryable` を返す。

`/api/weather` の Route Handler が `getErrorMessage` と `logApiError` を使っている。

## 上流の応答が不正なとき

OpenWeather が 200 を返しても、スコアに使う数値（風速・気圧）が有限の数値でなければ、不正な応答として弾く（`src/lib/openWeatherService.ts`、#414）。`createApiError(502, …)` を投げる（`SERVER_ERROR`、`retryable: true`）。弾いた応答はキャッシュに書かない。

| 入口 | 利用者に出るもの |
|---|---|
| `/api/weather` | HTTP 502。`error` は「サーバーで問題が発生しました。サポートに連絡してください。」、`code` は `SERVER_ERROR` |
| `/api/scores` | HTTP 500。`error` は「Failed to calculate fishing score」 |
| `/` | `try/catch` も `app/error.tsx` も無いので、Next.js 既定のエラー画面 |
| `/dashboard` | `try/catch` は無いが、`dashboard/error.tsx` が受ける。「一時的に利用できません」と、「再試行」ボタン |

応答には、不正だった値も上流の本文も入れない（`message` はログにだけ残る）。点を付けられない値を 0 点として扱う案は採らない（点と説明文が食い違うため）。

## ベストプラクティス

### 1. エラー型ごとに異なる対応をする

```typescript
if (error instanceof ApiError) {
  if (error.type === ApiErrorType.TIMEOUT) {
    // タイムアウト特有の処理
  } else if (error.type === ApiErrorType.RATE_LIMITED) {
    // レート制限特有の処理
  }
}
```

### 2. ユーザーに適切なメッセージを表示

文言は自分で書かず、`getErrorMessage(error)`（`src/lib/apiErrorUtils.ts`）を使う。

```typescript
import { getErrorMessage } from '@/lib/apiErrorUtils';

if (error instanceof ApiError) {
  return getErrorMessage(error);
}
```

### 3. エラーログを構造化する

`logApiError(error, { endpoint: '/weather' })` を使う。`console.error` に書かない。

### 4. カスタムタイムアウトを設定

```typescript
// 遅い API にはタイムアウトを長くする
const tideData = await tide736Client.get('/get_tide.php', {
  params: { pc: '13', hc: '1', yr: '2026', mn: '11', dy: '20', rg: 'day' },
  timeout: 15000, // 15秒
});
```

## まとめ

新しいエラーハンドリング機構により：

✅ **タイムアウトが自動的に処理される**
✅ **一時的なエラーは自動的にリトライされる**
✅ **エラーの種類で異なる対応ができる**
✅ **ユーザーに適切なメッセージを表示できる**
✅ **デバッグが容易になる**
