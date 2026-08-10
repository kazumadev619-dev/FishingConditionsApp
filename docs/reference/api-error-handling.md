# API エラーハンドリング - 使用方法ガイド

## 概要

`src/lib/apiClient.ts` に実装した新しいエラーハンドリング機構の使用方法を説明します。

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

### React コンポーネントでの使用

```typescript
'use client';

import { useState, useEffect } from 'react';
import { openWeatherMapClient, ApiError, ApiErrorType } from '@/lib/apiClient';

export function WeatherWidget() {
  const [weather, setWeather] = useState(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchWeather = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await openWeatherMapClient.get('/weather', {
          params: { lat: '35.6762', lon: '139.6503' },
        });
        setWeather(data);
      } catch (err) {
        if (err instanceof ApiError) {
          switch (err.type) {
            case ApiErrorType.TIMEOUT:
              setError('通信がタイムアウトしました。もう一度お試しください。');
              break;
            case ApiErrorType.RATE_LIMITED:
              setError('API の使用制限に達しました。しばらく後にお試しください。');
              break;
            case ApiErrorType.NETWORK_ERROR:
              setError('ネットワーク接続を確認してください。');
              break;
            default:
              setError('天気情報の取得に失敗しました。');
          }
        } else {
          setError('予期しないエラーが発生しました。');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
  }, []);

  if (loading) return <div>読み込み中...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!weather) return <div>天気情報なし</div>;

  return <div>{weather.main.temp}°C</div>;
}
```

### Server Action での使用

```typescript
'use server';

import { openWeatherMapClient, ApiError, ApiErrorType } from '@/lib/apiClient';

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
      // ログに記録（本番環境では構造化ログを使用）
      console.error('[Weather API Error]', {
        type: error.type,
        statusCode: error.statusCode,
        message: error.message,
        retryable: error.retryable,
      });

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
    console.error('Unexpected error:', error);
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
  429,  // Too Many Requests (Rate Limit)
  500,  // Internal Server Error
  502,  // Bad Gateway
  503,  // Service Unavailable
  504,  // Gateway Timeout
];
```

タイムアウト、ネットワークエラーもリトライ対象です。

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

### コンソールログの確認

リトライが行われている場合、以下のログが出力されます：

```
[API] Retry attempt 1/3 for /weather after 100ms
[API] Retry attempt 2/3 for /weather after 200ms
```

### ネットワークタブでの確認

ブラウザの DevTools > Network タブで：

1. 最初のリクエストが失敗（例: 503）
2. 100ms 後に 2番目のリクエスト
3. 200ms 後に 3番目のリクエスト（成功）

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

```typescript
const getUserFriendlyMessage = (error: ApiError): string => {
  switch (error.type) {
    case ApiErrorType.TIMEOUT:
      return '通信がタイムアウトしました。インターネット接続を確認して、もう一度お試しください。';
    case ApiErrorType.NETWORK_ERROR:
      return 'インターネット接続がありません。接続を確認してください。';
    case ApiErrorType.RATE_LIMITED:
      return 'しばらくの間、リクエストが制限されています。数分後にお試しください。';
    default:
      return 'エラーが発生しました。もう一度お試しください。';
  }
};
```

### 3. エラーログを構造化する

```typescript
console.error('API Error', {
  endpoint: '/weather',
  type: error.type,
  statusCode: error.statusCode,
  message: error.message,
  retryable: error.retryable,
  timestamp: new Date().toISOString(),
});
```

### 4. カスタムタイムアウトを設定

```typescript
// 遅い API にはタイムアウトを長くする
const tideData = await tide736Client.get('/tides', {
  params: { harbor: '12345' },
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
