# API エラーハンドリング - 使用方法ガイド

> - **状態**: 仕様（正）
> - **対応する実装**: `src/lib/api/`、`src/lib/apiErrorUtils.ts`、`src/lib/openWeatherService.ts`、`src/lib/rateLimit.ts`、`src/lib/clientErrors.ts`、`src/app/api/`
> - **最終確認**: 2026-11-22（`error-classification.md` の分類の決まりをこの文書に統合した。#446）。2026-11-21（#379 で、使われていない `timeout`・`retries`・`isRetryable` の記述を消した。2026-11-21 に 4xx の種別とリトライの範囲を #389 で直した。#414 で、上流の応答が不正なときの節を足した。2026-11-07 に 429 を #368 で直した。リトライの条件・ログ・`apiErrorUtils.ts` は #388 で実装と突き合わせて直した）

## 概要

エラーを「正常・異常・想定外」に分けた扱い（HTTP ステータス、ログのレベル、リトライ、通知）は、この文書の「エラーの分類と扱い」にある。

`src/lib/api/` に実装したエラーハンドリング機構の使用方法を説明します。クライアントは `@/lib/api/client`、`ApiError` と `ApiErrorType` は `@/lib/api/types` から import します。

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
import { openWeatherMapClient } from '@/lib/api/client';
import { ApiError, ApiErrorType } from '@/lib/api/types';

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

### タイムアウトとリトライの設定

タイムアウトは 10 秒、リトライは最大 3 回（最初の呼び出しと合わせて 4 回）で固定です。呼び出しごとには変えられません（#379 で、使っている呼び出しが無かった `timeout`・`retries` を削った）。遅延は 100ms・200ms・400ms です（`src/lib/api/retryStrategy.ts`）。

API キーが必要なクライアントで、キーが未設定のときは、上流を呼ばず、`ApiErrorType.CLIENT_ERROR`（`retryable: false`）を投げます（`src/lib/api/client.ts`）。

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

import { openWeatherMapClient } from '@/lib/api/client';
import { ApiError, ApiErrorType } from '@/lib/api/types';
import { logApiError } from '@/lib/apiErrorUtils';
import { logger } from '@/lib/logger';

export async function fetchWeatherData(lat: number, lon: number) {
  try {
    const weather = await openWeatherMapClient.get('/weather', {
      params: {
        lat: String(lat),
        lon: String(lon),
      },
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

タイムアウトもリトライ対象です。ネットワークエラーは、`TypeError` で、メッセージに `fetch` を含むものだけがリトライ対象です（`src/lib/api/client.ts`）。それ以外の `TypeError` は `NETWORK_ERROR` になりますが、リトライしません。

**429（レート制限）はリトライしません。** 上流が絞っているときに叩き直すと、呼び出しが増えるだけで、状況を悪くするためです（#317）。429 は `ApiErrorType.RATE_LIMITED`、`retryable: false` になります（`src/lib/api/errorHandler.ts`）。

### リトライしないエラー

上の一覧にないステータスコードは、自動リトライされません。501・505 などの 5xx も同じです。

- 4xx は `ApiErrorType.CLIENT_ERROR`（400・401・403・404・405・409・422 など）。クライアント側の問題（不正なリクエスト、認証エラーなど）なので、リトライしても成功しません（408 を除く）。
- 5xx は `ApiErrorType.SERVER_ERROR`。一覧（500・502・503・504）以外はリトライしません。
- 408 は 4xx なので `CLIENT_ERROR` ですが、一覧にあるのでリトライします。

種別（`type`）は、429 を除いてステータスコードで決まります。500 未満は `CLIENT_ERROR`、500 以上は `SERVER_ERROR` です。リトライするかどうか（`retryable`）は、種別ではなく一覧だけで決まります（`src/lib/api/errorHandler.ts`）。

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

## エラーの分類と扱い

アプリで起きるエラーを3つに分け、分けごとに HTTP ステータス、利用者への表示、ログのレベル、リトライ、通知の扱いを決める。分ける目的は、人が気づくべきエラーだけを通知の対象にし、通知を増やしすぎないことにある。

API ルートごとの現状は、ここに書かない（コードが変わるたびに食い違うため）。決まりと合っていないルートは issue で追う（上流の障害と DB 障害は #428、未ログインの画面の例外は #429）。

| | 正常なエラー | 異常なエラー | 想定外のエラー |
|---|---|---|---|
| 何か | 利用者の操作が原因で、起きるのが正常なもの（入力不正、未ログイン、対象なし、重複、回数制限） | システムの外や基盤が原因で、起こりうると分かっているもの（外部 API の障害、DB・Redis・メール送信の障害） | 本来起きないもの（コードの誤り、データの食い違い、画面の例外） |
| HTTP | 400 / 401 / 404 / 409 / 413 / 429 | 502 / 503 / 504。上流が 4xx を返しても、利用者には 502 を返す | 500 |
| 利用者への表示 | 何を直せばよいかが分かる固定の文言 | 「一時的に使えない。時間をおいて再試行」の固定の文言。上流の応答本文は出さない | 汎用の文言とエラーID（digest）。`error.message` は出さない |
| ログ | 出さない。回数制限と、不正な値の繰り返しだけ `warn` | 最終的に失敗したとき `error`。リトライ中は `warn`。同じ障害が続くときは間引く（Redis の例） | `error`（スタック付き） |
| リトライ | しない。429 は `Retry-After` のあとに利用者が再試行する | する（指数バックオフ、最大3回）。上流の 429 はしない（#317） | しない |
| 通知 | しない | 1件ごとにはしない。率で検知する（ADR-005 の 5xx 率・外部 API エラー率） | 1件でも人が気づけるようにする（`error` ログ。通知の経路は #283・#284 で入れる） |

境目の判断:

- 「利用者が直せるか」で正常かどうかを決める。直せないものは、利用者の操作が引き金でも異常か想定外に入れる
- 起こりうると分かっていて、コードに対処があれば異常。対処が無い、または対処の外側で起きたものは想定外
- 想定外を 500 以外で返さない。異常を 500 で返さない。この2つが逆になると、通知が鳴るべきでないときに鳴り、鳴るべきときに鳴らない
- 設定の誤り（API キーの未設定など）は、人が直すものなので、異常として扱い、`error` を出す

画面（ブラウザ）の例外は、想定外に入る。ブラウザの `logger` は console に出すだけでサーバーに届かないので、届けたいものは `reportClientError`（`src/lib/clientErrors.ts`）でサーバーの受け口（`POST /api/client-errors`）に送る。送る元、上限、ログの形は `src/lib/clientErrors.ts` と `src/app/api/client-errors/route.ts` が正で、そこに理由も書いてある。送った値（`message`、`stack`）は利用者が自由に作れるので、ログを読む側と通知の条件に使う側は、信頼できる値として扱わない。

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

## まとめ

新しいエラーハンドリング機構により：

✅ **タイムアウトが自動的に処理される**
✅ **一時的なエラーは自動的にリトライされる**
✅ **エラーの種類で異なる対応ができる**
✅ **ユーザーに適切なメッセージを表示できる**
✅ **デバッグが容易になる**
