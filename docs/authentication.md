# 認証機能

このプロジェクトでは、`next-auth` (Auth.js) v5 を使用して認証システムを構築しています。

> 📊 **フロー図・シーケンス図**: 認証システムの視覚的な理解には [認証システム フロー図・シーケンス図](./authentication-diagrams.md) を参照してください。

## 概要

- **プロバイダー**:
  - `Credentials` プロバイダー: メールアドレスとパスワードによる認証
  - `Google` プロバイダー: GoogleアカウントでのOAuth認証
- **データベース**: `Supabase` の `PostgreSQL` を使用し、ユーザー情報は `auth_users` テーブルに格納されます。
- **パスワードハッシュ化**: `bcrypt` を使用してパスワードを安全にハッシュ化し、保存・比較しています。
- **アカウント連携**: メールアドレスで既存アカウントと自動連携

## 主要ファイル

- `src/auth.ts`: `next-auth` のメイン設定ファイル。`Credentials`と`Google`プロバイダーの設定、`signIn`コールバックでのアカウント連携ロジックを定義しています。
- `src/auth.config.ts`: 認証に関する設定（ログインページのパス、リダイレクト処理、アクセス制御など）を定義しています。
- `src/app/api/auth/[...nextauth]/route.ts`: `next-auth` が使用するAPIルートです。
- `src/lib/actions.ts`: ユーザー登録 (`signup`) やログイン (`authenticate`) のためのサーバーアクションを定義しています。
- `src/types/next-auth.d.ts`: Next-Authの型拡張（セッション/JWTトークンにユーザーIDを追加）。

## 認証フロー

### 1. ユーザー登録

1.  ユーザーが登録ページ (`/register`) で情報を入力します。
2.  `registerUser` サーバーアクションが呼び出されます。
3.  `bcrypt` を使ってパスワードをハッシュ化し、新しいユーザー情報を `auth_users` テーブルに保存します。

### 2. ログイン

1.  ユーザーがログインページ (`/login`) でメールアドレスとパスワードを入力します。
2.  `authenticate` サーバーアクションが呼び出され、内部で `next-auth` の `signIn` 関数を `credentials` プロバイダーで実行します。
3.  `src/auth.ts` の `authorize` 関数が実行されます。
    1.  提供されたメールアドレスでユーザーをデータベースから検索します。
    2.  ユーザーが存在し、パスワードが `bcrypt.compare` によって一致した場合、ユーザーオブジェクトを返します。
    3.  一致しない場合はエラーがスローされます。
4.  認証が成功すると、セッションが作成され、ユーザーはダッシュボード (`/dashboard`) にリダイレクトされます。

### 3. アクセス制御

`src/auth.config.ts` の `authorized` コールバックでアクセス制御を行っています。

- `/dashboard` で始まるパスへのアクセスには認証が必要です。未認証のユーザーはログインページ (`/login`) にリダイレクトされます。
- 認証済みのユーザーがログインページ (`/login`) や登録ページ (`/register`) にアクセスすると、ダッシュボード (`/dashboard`) に自動的にリダイレクトされます。

### 4. Google OAuth認証

1. ユーザーがログインページ (`/login`) または登録ページ (`/register`) で「Googleでログイン」ボタンをクリックします。
2. `signIn('google', { callbackUrl: '/dashboard' })` が呼び出され、Google OAuth画面へリダイレクトされます。
3. ユーザーがGoogleアカウントで認証します。
4. `/api/auth/callback/google` へリダイレクトされ、`src/auth.ts` の `signIn` コールバックが実行されます。
5. **既存ユーザーの場合**:
   - メールアドレスで既存ユーザーを検索
   - `identities` テーブルに新規レコード追加（アカウント連携）
   - `auth_users.is_sso_user` を `true` に更新
6. **新規ユーザーの場合**:
   - Prismaトランザクションで `auth_users`, `public_users`, `identities` を同時作成
   - `encrypted_password` は `NULL`（パスワード不要）
7. セッション作成、`/dashboard` へリダイレクト

## アカウント連携

### メールアドレスによる自動連携

`allowDangerousEmailAccountLinking: true` 設定により、同一メールアドレスのアカウントを自動連携します。

**例**:
1. ユーザーがメール/パスワードで登録（`user@example.com`）
2. 後日、同じメールアドレスのGoogleアカウントでログイン
3. 既存アカウントと自動連携される（`identities` テーブルに新規レコード追加）
4. 次回以降、メール/パスワードとGoogleどちらでもログイン可能

### セキュリティ考慮事項

- **GoogleのOAuth認証**: Google側でメール所有権が確認されているため、なりすましリスクは低い
- **残存リスク**: 攻撃者がターゲットのメールアドレスのGoogleアカウントを持っている場合のみ影響
- **将来対応**: 独自のメール検証機能追加、二段階認証実装

## データベーススキーマ

### `auth.users` (auth_users)

- `encrypted_password`: `String?` (NULL許可、OAuth専用ユーザー対応)
- `is_sso_user`: `Boolean` (デフォルト: false、OAuthユーザー識別)
- `email_confirmed_at`: OAuth認証時に自動設定

### `auth.identities`

プロバイダー別の認証情報を管理:
- `provider_id`: GoogleアカウントのユニークID
- `provider`: `"google"`
- `identity_data`: JSON（email, name, pictureを保存）
- ユニーク制約: `(provider_id, provider)`

### `public.users` (public_users)

アプリケーション用ユーザープロファイル（`auth_users.id` と同じUUIDを使用）

## 環境変数

### Google OAuth設定

```bash
# Google Cloud Consoleで取得
AUTH_GOOGLE_ID="your_google_client_id"
AUTH_GOOGLE_SECRET="your_google_client_secret"

# Auth.js基本設定
AUTH_SECRET="npx auth secretで生成"
AUTH_URL="http://localhost:3000"  # 本番環境では実際のURL
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
