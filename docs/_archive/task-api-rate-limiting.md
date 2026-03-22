# Task 5: API レート制限の実装

## 概要
ブルートフォース攻撃やAPI悪用からアプリケーションを保護するため、API レート制限機構を実装する。

**関連ファイル:**
- 新規: `src/lib/rateLimit.ts` - レート制限エンジン
- `src/app/api/auth/[...nextauth]/route.ts` - 認証エンドポイント
- `src/lib/actions.ts` - signup/authenticate アクション

## 現状の問題

### 1. ログイン試行の制限がない
- ブルートフォース攻撃が可能
- 同じユーザーアカウントに対して無制限に攻撃可能

### 2. 外部 API 呼び出しの制限がない
- API レート制限に達する可能性がある
- 他のユーザーへのサービス悪化につながる

### 3. アカウントロックの機構がない
- 複数回の失敗後の保護がない

## 実装要件

### 1. ログイン試行のレート制限

**仕様:**
- **制限対象**: IP アドレス + メールアドレスの組み合わせ
- **制限内容**: 1分間に5回まで
- **ロック期間**: 5回失敗後、30分間ログイン不可
- **ロック解除**: 30分経過後、またはパスワードリセット時

**実装パターン:**

```typescript
// src/lib/rateLimit.ts

interface RateLimitConfig {
  maxAttempts: number;      // 最大試行回数
  windowMs: number;         // ウィンドウ期間（ミリ秒）
  lockoutMs: number;        // ロックアウト期間（ミリ秒）
  lockoutThreshold?: number; // ロックアウトの閾値（デフォルト: maxAttempts）
}

class RateLimiter {
  private redis: Redis;

  async checkLimit(
    key: string,
    config: RateLimitConfig
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    // Redis でカウント管理
  }

  async recordAttempt(key: string, config: RateLimitConfig): Promise<void> {
    // 試行を記録
  }

  async reset(key: string): Promise<void> {
    // ロックをリセット
  }

  async isLocked(key: string): Promise<boolean> {
    // ロック状態を確認
  }
}
```

### 2. 認証エンドポイントでのレート制限

```typescript
// src/lib/actions.ts 修正

const LOGIN_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 60 * 1000, // 1分
  lockoutMs: 30 * 60 * 1000, // 30分
  lockoutThreshold: 5,
};

const SIGNUP_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxAttempts: 10, // signup はもう少し寛容
  windowMs: 60 * 1000,
  lockoutMs: 15 * 60 * 1000, // 15分
};

export async function authenticate(_prevState: string | undefined, formData: FormData) {
  const email = formData.get('email') as string;
  const ip = getClientIp(); // IP アドレスを取得

  // ロック状態をチェック
  const rateLimiter = new RateLimiter();
  if (await rateLimiter.isLocked(`login:${email}`)) {
    return 'アカウントが一時的にロックされています。30分後に再度お試しください。';
  }

  // レート制限をチェック
  const limit = await rateLimiter.checkLimit(`login:${ip}:${email}`, LOGIN_RATE_LIMIT_CONFIG);
  if (!limit.allowed) {
    await rateLimiter.recordAttempt(`login:${email}`, LOGIN_RATE_LIMIT_CONFIG);
    return `ログイン試行が多すぎます。${Math.ceil(limit.resetAt.getTime() / 1000)}秒後に再度お試しください。`;
  }

  try {
    await signIn('credentials', formData);
    // ログイン成功時はカウンターをリセット
    await rateLimiter.reset(`login:${ip}:${email}`);
  } catch (error) {
    // ログイン失敗時はカウンターを記録
    await rateLimiter.recordAttempt(`login:${ip}:${email}`, LOGIN_RATE_LIMIT_CONFIG);

    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'メールアドレスまたはパスワードが正しくありません。';
        default:
          return '予期しないエラーが発生しました。';
      }
    }
    throw error;
  }

  redirect('/dashboard');
}
```

### 3. IP アドレスの取得

```typescript
// src/lib/utils.ts に追加

import { headers } from 'next/headers';

export function getClientIp(): string {
  const headersList = headers();

  // Vercel でのプロキシヘッダー
  const forwardedFor = headersList.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  // その他のプロキシ
  const realIp = headersList.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // localhost の場合
  return 'unknown';
}
```

### 4. 外部 API 呼び出しのレート制限

```typescript
// src/lib/apiClient.ts 修正

class ApiClient {
  private rateLimiter: RateLimiter;
  private rateLimitConfig: RateLimitConfig;

  constructor(...) {
    // ...
    this.rateLimitConfig = {
      maxAttempts: 100, // 1分間に100回
      windowMs: 60 * 1000,
      lockoutMs: 5 * 60 * 1000, // 5分間ロック
    };
  }

  private async request<T>(...): Promise<T> {
    // API 呼び出し前にレート制限をチェック
    const limit = await this.rateLimiter.checkLimit(
      `api:${this.baseUrl}`,
      this.rateLimitConfig
    );

    if (!limit.allowed) {
      throw new ApiError(
        `Rate limited. Reset in ${Math.ceil(limit.resetAt.getTime() / 1000)}s`,
        ApiErrorType.RATE_LIMITED,
        429,
        true // リトライ可能
      );
    }

    // ... 既存のコード ...
  }
}
```

## 実装チェックリスト

- [ ] `src/lib/rateLimit.ts` を作成（RateLimiter クラス）
- [ ] Redis（Upstash）でレート制限カウンターを管理
- [ ] IP アドレス取得ロジックを `src/lib/utils.ts` に追加
- [ ] `authenticate()` 関数にレート制限チェックを追加
- [ ] `signup()` 関数にレート制限チェックを追加（オプション）
- [ ] ロック状態の確認と表示
- [ ] ロック解除メカニズム（時間ベース、またはパスワードリセット）
- [ ] 外部 API 呼び出し時のレート制限を検討
- [ ] Vercel 環境での IP アドレス取得が正確であることを確認
- [ ] エラーメッセージが日本語で明確
- [ ] `npm run type-check` でエラーなし
- [ ] `npm run lint` でエラーなし

## セキュリティ考慮事項

### 1. IP スプーフィング対策
- 信頼できるプロキシからのヘッダーのみを受け入れる
- Vercel での `x-forwarded-for` は信頼可能

### 2. キャッシュの一貫性
- 複数インスタンス環境では Redis を使用（既に Upstash 使用予定）
- ローカルメモリキャッシュは使用しない

### 3. ロック期間の適切性
- 短すぎる: 攻撃者が再度試行可能
- 長すぎる: 正規ユーザーが不便
- **推奨**: ログイン 30分、signup 15分

### 4. ユーザーへの通知（推奨）
- アカウントロック時にメール通知
- アンロック手段（パスワードリセット）を提供

## テスト戦略

### テストケース

1. **正常系**
   - ログイン成功 → カウンターリセット

2. **レート制限**
   - 5回失敗 → 次のリクエストで拒否
   - ロック解除後は再度試行可能

3. **IP アドレス判定**
   - 異なる IP → 別のカウンター
   - 同一 IP → 共通カウンター

4. **ロック期間**
   - ロック中 → ログイン不可
   - ロック解除後 → ログイン可能

### 手動テスト

```bash
# ログイン失敗を5回行う
curl -X POST http://localhost:3000/api/auth/callback/credentials \
  -d "email=test@example.com&password=wrong" \
  # ... 5回繰り返す

# 6回目のリクエストは拒否されることを確認
```

## 完了判定基準

- [ ] すべてのチェックリスト項目が完了
- [ ] レート制限が有効に機能（5回失敗後にロック）
- [ ] ロック期間が正確（30分）
- [ ] IP アドレス取得が Vercel で正確
- [ ] エラーメッセージが分かりやすい
- [ ] `npm run type-check` でエラーなし
- [ ] `npm run lint` でエラーなし

## 関連ドキュメント

- [rule.md: 信頼性の確保](../rule.md)
- [OWASP: Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Vercel: Headers](https://vercel.com/docs/functions/edge-middleware#headers)
