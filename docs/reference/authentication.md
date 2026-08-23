# 認証機能

このプロジェクトでは、`next-auth` (Auth.js) v5 を使用して認証システムを構築しています。

> 📊 **フロー図・シーケンス図**: 認証システムの視覚的な理解には [認証システム フロー図・シーケンス図](./authentication-diagrams.md) を参照してください。

## 概要

- **プロバイダー**:
  - `Credentials` プロバイダー: メールアドレスとパスワードによる認証
  - `Google` プロバイダー: GoogleアカウントでのOAuth認証
- **データベース**: `PostgreSQL` を使用し、ユーザー情報は `users` テーブルに格納されます（Prisma ORM経由）。
- **パスワードハッシュ化**: `bcrypt` を使用してパスワードを安全にハッシュ化し、保存・比較しています。
- **メール検証**: Resend + React Email による検証メール送信（通常登録・Google連携時）
- **アカウント連携**: メールアドレスで既存アカウントと連携（メール検証必須）

## 主要ファイル

### 認証設定（Edge/Node分離アーキテクチャ）

- `src/auth/config.ts`: **共通設定**。session戦略、pages設定など、Edge/Node両方で使用可能な設定のみを定義。
- `src/auth/edge.ts`: **Edge Runtime用**。`authorized`コールバック（アクセス制御）を含む。`proxy.ts`から使用。
- `src/auth/index.ts`: **Node Runtime用**。Prismaを使用したDB操作、`Credentials`/`Google`プロバイダー、`signIn`コールバックを定義。
- `src/proxy.ts`: Next.js 16のProxy（旧middleware）。`edge.ts`の`auth`を使用してアクセス制御を実行。

### メール検証関連

- `src/lib/email.ts`: Resendを使用したメール送信ユーティリティ
- `src/lib/token.ts`: トークン生成・検証・削除ロジック（有効期限1時間）
- `src/emails/verification-email.tsx`: React Emailテンプレート（通常登録・Google連携用）
- `src/app/api/auth/verify-email/route.ts`: トークン検証エンドポイント
- `src/app/auth/verification-success/page.tsx`: 検証成功ページ
- `src/app/auth/verification-error/page.tsx`: 検証失敗ページ

### その他

- `src/app/api/auth/[...nextauth]/route.ts`: `next-auth` が使用するAPIルートです。
- `src/lib/actions.ts`: ユーザー登録 (`signup`) やログイン (`authenticate`) のためのサーバーアクションを定義しています。
- `src/types/next-auth.d.ts`: Next-Authの型拡張（セッション/JWTトークンにユーザーIDを追加）。

## 認証フロー

### 1. ユーザー登録（通常登録）

1.  ユーザーが登録ページ (`/register`) で情報を入力します。
2.  `signup` サーバーアクションが呼び出されます。
3.  `bcrypt` を使ってパスワードをハッシュ化し、新しいユーザー情報を `users` テーブルに保存します（`email_verified_at` は NULL）。
4.  検証トークンを生成し、Resendでメールを送信します。
5.  ユーザーはメール内のリンクをクリックして検証を完了します。
6.  `/api/auth/verify-email` エンドポイントで `email_verified_at` が更新されます。

### 2. ログイン

1.  ユーザーがログインページ (`/login`) でメールアドレスとパスワードを入力します。
2.  `authenticate` サーバーアクションが呼び出され、内部で `next-auth` の `signIn` 関数を `credentials` プロバイダーで実行します。
3.  `src/auth.ts` の `authorize` 関数が実行されます。
    1.  提供されたメールアドレスでユーザーをデータベースから検索します。
    2.  ユーザーが存在し、パスワードが `bcrypt.compare` によって一致した場合、ユーザーオブジェクトを返します。
    3.  一致しない場合はエラーがスローされます。
4.  認証が成功すると、セッションが作成され、ユーザーはダッシュボード (`/dashboard`) にリダイレクトされます。

### 3. アクセス制御

`src/auth/edge.ts` の `authorized` コールバックでアクセス制御を行っています（Edge Runtime専用）。

**既定は「認証必須」で、公開するパスだけを allowlist に列挙する方式です。** 新しいルートを足すと自動的に保護されるため、書き忘れが穴にならないようにしています。

| 対象 | 未認証でのアクセス |
|---|---|
| `/login`、`/register` | 許可（`PUBLIC_PATHS`） |
| `/auth/*` | 許可（メール検証リンクの着地ページ） |
| `/api/auth/*` | 許可（Auth.js 本体） |
| `/healthz`、`/readyz`、`/_next/*` などの静的・メタデータ系 | `proxy.ts` の matcher で除外され、そもそもここへ来ない |
| 上記以外の `/api/*` | **401 `{"error":"Unauthorized"}`** |
| 上記以外のページ | `/login` へリダイレクト |

- API だけリダイレクトではなく 401 を返すのは、`fetch` の呼び出し側がログインページの HTML を掴んでしまうのを避けるためです。
- 認証済みのユーザーがログインページ (`/login`)、登録ページ (`/register`)、ルート (`/`) にアクセスすると、ダッシュボード (`/dashboard`) に自動的にリダイレクトされます。
- `/api/auth/*` は `proxy.ts` の matcher で除外済みですが、allowlist にも重複して入れています。matcher を変更した拍子にここが 401 を返すと「ログインするためのエンドポイントにログインが必要」になり復旧できなくなるためです。

> **Stage 2 の性能計測について**: 計測対象の `/api/weather`、`/api/scores`、`/api/conditions/tide`、`/api/locations/search` も認証必須です。k6 などの計測クライアントは `/api/auth/csrf` → `/api/auth/callback/credentials` でセッション Cookie を一度取得し、それを使い回してください。

### 4. Google OAuth認証

1. ユーザーがログインページ (`/login`) または登録ページ (`/register`) で「Googleでログイン」ボタンをクリックします。
2. `signIn('google', { callbackUrl: '/dashboard' })` が呼び出され、Google OAuth画面へリダイレクトされます。
3. ユーザーがGoogleアカウントで認証します。
4. `/api/auth/callback/google` へリダイレクトされ、`src/auth/index.ts` の `signIn` コールバックが実行されます。
5. **既存ユーザーの場合（メール未検証）**:
   - メールアドレスで既存ユーザーを検索
   - `email_verified_at` が NULL の場合、サインイン拒否（AccessDenied）
   - 検証トークンを生成し、Resendでメールを送信（`purpose: 'social-link'`）
   - ユーザーはメール内のリンクをクリックして検証を完了
   - 検証完了後、再度Google認証を試みると成功
6. **既存ユーザーの場合（メール検証済み）**:
   - `identities` テーブルに新規レコード追加（アカウント連携）
   - `users.is_sso_user` を `true` に更新
7. **新規ユーザーの場合**:
   - Prismaトランザクションで `users`, `identities` を同時作成
   - `password_hash` は `NULL`（パスワード不要）
   - `email_verified_at` に現在時刻を設定（Google検証済み）
8. セッション作成、`/dashboard` へリダイレクト

## アカウント連携

### メールアドレスによる安全な連携

メール検証を必須とすることで、セキュアなアカウント連携を実現しています。

**フロー**:
1. ユーザーがメール/パスワードで登録（`user@example.com`）
2. 検証メールを受信し、リンクをクリック（`email_verified_at` 更新）
3. 後日、同じメールアドレスのGoogleアカウントでログインを試みる
4. メール検証済みのため、アカウント連携が成功（`identities` テーブルに新規レコード追加）
5. 次回以降、メール/パスワードとGoogleどちらでもログイン可能

### セキュリティ強化

- ✅ **メール所有確認必須**: 通常登録・Google連携時の両方でメール検証を実施
- ✅ **トークン有効期限**: 検証トークンは1時間で失効
- ✅ **使用済みトークン削除**: 検証完了後、トークンを自動削除
- ✅ **アカウント乗っ取り防止**: メール所有確認なしのアカウント連携を防止
- ✅ **Resend使用**: 信頼性の高いメール配信サービス

## データベーススキーマ

### `users`

統合ユーザーテーブル（認証+プロフィール情報）:
- `id`: UUID (主キー)
- `email`: String (ユニーク、正規化済み)
- `password_hash`: String? (NULL許可、OAuth専用ユーザー対応)
- `name`: String?
- `avatar_url`: String?
- `is_sso_user`: Boolean (デフォルト: false、OAuthユーザー識別)
- `email_verified_at`: DateTime? (メール検証完了日時)
- `created_at`: DateTime
- `updated_at`: DateTime

### `identities`

プロバイダー別の認証情報を管理:
- `id`: UUID (主キー)
- `user_id`: UUID (外部キー → users.id)
- `provider`: String (`"google"`)
- `provider_id`: String (GoogleアカウントのユニークID)
- `identity_data`: JSON (email, name, pictureを保存)
- `last_sign_in_at`: DateTime?
- ユニーク制約: `(provider, provider_id)`

### `verification_tokens`

メール検証トークン管理:
- `id`: UUID (主キー)
- `email`: String (検証対象メールアドレス)
- `token`: String (ユニーク、64文字の16進数文字列)
- `expires_at`: DateTime (有効期限、1時間後)
- `created_at`: DateTime
- インデックス: `email`, `expires_at`

## 環境変数

### Google OAuth設定

```bash
# Google Cloud Consoleで取得
AUTH_GOOGLE_ID="your_google_client_id"
AUTH_GOOGLE_SECRET="your_google_client_secret"

# Auth.js基本設定
AUTH_SECRET="npx auth secretで生成"
NEXTAUTH_URL="http://localhost:3000"  # 本番環境では実際のURL
```

### メール検証設定

```bash
# Resend API Key（https://resend.com/ で取得）
RESEND_API_KEY="re_xxxxxxxxxxxxx"

# 送信元メールアドレス（Resendで検証済みドメイン）
EMAIL_FROM="noreply@yourdomain.com"

# 開発時は Resend のテストドメインも使用可能
# EMAIL_FROM="onboarding@resend.dev"
```

### Google Cloud Console設定

1. **OAuth 2.0クライアントを作成**:
   - [Google Cloud Console](https://console.cloud.google.com/) にアクセス
   - 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth 2.0 クライアントID」

2. **承認済みリダイレクトURI**:
   ```
   http://localhost:3000/api/auth/callback/google
   https://yourdomain.com/api/auth/callback/google
   ```

3. **スコープ**: `email`, `profile`（デフォルト）

## フロントエンドでの利用

- **`AuthProvider`**: `src/components/providers/auth-provider.tsx` で `SessionProvider` をラップし、アプリケーション全体でセッション情報を提供します。
- **`useSession`**: クライアントコンポーネントでセッション情報を取得するために使用します。
- **`auth()`**: サーバーコンポーネントやサーバーアクションでセッション情報を取得するために使用します。
- **`signIn` / `signOut`**: ログイン・ログアウト処理を実行するために使用します。

### Google OAuth ログイン実装例

```typescript
'use client';
import { signIn } from 'next-auth/react';

const handleGoogleSignIn = async () => {
  try {
    await signIn('google', { callbackUrl: '/dashboard' });
  } catch (error) {
    console.error('Google sign-in error:', error);
    // エラーハンドリング
  }
};
```
