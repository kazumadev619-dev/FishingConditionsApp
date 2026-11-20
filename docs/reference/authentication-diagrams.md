# 🔐 認証システム フロー図・シーケンス図

> - **状態**: 説明（参考）
> - **対応する実装**: `src/auth/`
> - **最終確認**: 2026-11-20（#388 で、読んで実装と突き合わせて直した。実行はしていない）

このドキュメントでは、Fishing Conditions Appの認証システムのフロー図とシーケンス図を提供します。

---

## 📊 全体認証フロー図

```mermaid
flowchart TD
    Start([ユーザー訪問]) --> CheckAuth{認証済み?}

    CheckAuth -->|Yes| Dashboard[/dashboard へ/]
    CheckAuth -->|No| LoginChoice{認証方法選択}

    LoginChoice -->|Credentials| CredLogin[メール/パスワード<br/>ログイン]
    LoginChoice -->|Google OAuth| GoogleLogin[Googleログイン]
    LoginChoice -->|新規登録| RegisterChoice{登録方法選択}

    RegisterChoice -->|Credentials| CredRegister[メール/パスワード<br/>新規登録]
    RegisterChoice -->|Google OAuth| GoogleRegister[Googleで登録]

    CredLogin --> CredAuth[Credentials認証処理]
    GoogleLogin --> GoogleAuth[Google OAuth処理]

    CredRegister --> CreateCredUser[ユーザー作成<br/>users]
    GoogleRegister --> GoogleAuth

    GoogleAuth --> CheckExisting{既存ユーザー?}
    CheckExisting -->|連携済み| AuthSuccess
    CheckExisting -->|確認済みの別アカウント| ShowError
    CheckExisting -->|未確認またはなし| CreateOAuthUser[ユーザー作成<br/>users + identities]

    CredAuth --> AuthSuccess{認証成功?}
    CreateCredUser --> LoginRedirect["/auth/check-email へ<br/>送れなければ ?sent=0"]
    CreateOAuthUser --> AuthSuccess
    LoginRedirect -->|メールのリンクで確認後| CredLogin

    AuthSuccess -->|Success| CreateSession[セッション作成]
    AuthSuccess -->|Failure| ShowError[エラー表示]

    CreateSession --> Dashboard
    ShowError --> LoginChoice

    Dashboard --> UserAction{ユーザー操作}
    UserAction -->|ログアウト| Logout[セッション削除]
    UserAction -->|継続利用| Dashboard

    Logout --> Start

    style Dashboard fill:#90EE90
    style ShowError fill:#FFB6C1
    style CreateSession fill:#87CEEB
```

---

## 🔑 Credentials認証シーケンス図

### 新規登録フロー（メール検証付き）

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant UI as /register
    participant Action as signup()
    participant Validation as Zod Validator
    participant Redis as Redis
    participant Bcrypt as bcrypt
    participant DB as Prisma + PostgreSQL
    participant Token as Token Generator
    participant Email as Resend

    User->>UI: 名前、メール、パスワード入力
    UI->>UI: パスワード強度チェック<br/>(リアルタイム)
    User->>UI: フォーム送信
    UI->>Action: signup(formData)

    Action->>Validation: バリデーション実行
    Validation-->>Action: 検証結果

    alt バリデーション失敗
        Action-->>UI: エラーメッセージ
        UI-->>User: エラー表示
    else バリデーション成功
        Action->>Redis: 回数を確認<br/>(接続元、正規化したアドレス)
        Redis-->>Action: 結果

        alt 上限を超えた
            Action-->>UI: "時間をおいて再度お試しください"
            UI-->>User: エラー表示
        else 上限の内
            Action->>DB: 7日超の未確認の登録と<br/>期限切れトークンを削除
            Action->>Bcrypt: パスワードハッシュ化
            Bcrypt-->>Action: ハッシュ値

            Action->>DB: users作成<br/>(password_hash, email_verified_at=NULL)
            Note over Action,DB: 同じメールの行があれば一意制約で失敗し、<br/>"既に使用されています" を返す
            DB-->>Action: 成功

            Note over Action,Email: メール検証フロー
            Action->>Token: 検証トークン生成(1時間有効)
            Token-->>Action: token
            Action->>DB: verification_tokens保存
            DB-->>Action: 成功

            Action->>Email: 検証メール送信
            Email-->>User: メール送信

            Action-->>UI: 登録成功
            UI->>UI: /auth/check-email へリダイレクト<br/>（メールを送れなければ ?sent=0）
            UI-->>User: 確認メールの案内を表示

            User->>User: メール確認
            User->>User: 検証リンククリック
            User->>UI: /auth/verify-email?token=xxx
            User->>UI: 確認ボタンを押す
            UI->>DB: POST /api/auth/verify-email<br/>トークン検証・email_verified_at更新
            DB-->>UI: 成功
            UI->>UI: /auth/verification-successへ
            UI-->>User: 検証完了メッセージ
        end
    end
```

### ログインフロー

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant UI as /login
    participant Action as authenticate()
    participant NextAuth as signIn('credentials')
    participant AuthTS as src/auth/providers/credentials.ts<br/>（authorize）
    participant JWT as src/auth/callbacks/jwtCallback.ts
    participant Bcrypt as bcrypt
    participant DB as Prisma + PostgreSQL
    participant Session as セッション（JWT の Cookie）

    User->>UI: メール、パスワード入力
    User->>UI: ログインボタンクリック
    UI->>Action: authenticate(formData)
    Action->>NextAuth: signIn('credentials', formData)

    NextAuth->>AuthTS: Credentials.authorize()
    AuthTS->>AuthTS: Zodバリデーション

    alt バリデーション失敗
        AuthTS-->>NextAuth: null
        NextAuth-->>Action: CredentialsSignin Error
        Action-->>UI: エラーメッセージ
        UI-->>User: "メールアドレスまたは<br/>パスワードが正しくありません"
    else バリデーション成功
        AuthTS->>DB: getUser(email)
        DB-->>AuthTS: ユーザー情報

        alt ユーザーなし or パスワードなし
            AuthTS-->>NextAuth: null
            NextAuth-->>Action: CredentialsSignin Error
            Action-->>UI: エラーメッセージ
            UI-->>User: エラー表示
        else ユーザー存在
            AuthTS->>Bcrypt: compare(password, hash)
            Bcrypt-->>AuthTS: 比較結果

            alt パスワード不一致
                AuthTS-->>NextAuth: null
                NextAuth-->>Action: CredentialsSignin Error
                Action-->>UI: エラーメッセージ
                UI-->>User: エラー表示
            else パスワード一致・メール未確認
                AuthTS->>DB: 有効なトークンが無ければ発行し、確認メールを送り直す
                AuthTS-->>NextAuth: EmailNotVerifiedError
                NextAuth-->>Action: CredentialsSignin Error
                Action-->>UI: 確認を促すメッセージ
                UI-->>User: エラー表示
            else パスワード一致・メール確認済み
                AuthTS-->>NextAuth: userオブジェクト
                NextAuth->>JWT: jwt({ token, user, account })
                JWT->>JWT: token.id = user.id
                JWT-->>NextAuth: token

                NextAuth->>Session: JWT を Cookie に保存
                Session-->>NextAuth: 成功

                NextAuth-->>Action: 成功
                Action-->>UI: リダイレクト
                UI->>UI: /dashboardへ
                UI-->>User: ダッシュボード表示
            end
        end
    end
```

---

## 🌐 Google OAuth認証シーケンス図

### 新規ユーザー登録フロー

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant UI as /login or /register
    participant NextAuth as NextAuth Client
    participant Google as Google OAuth
    participant Callback as /api/auth/callback/google
    participant AuthTS as src/auth/callbacks/signInCallback.ts
    participant JWT as src/auth/callbacks/jwtCallback.ts
    participant DB as Prisma + PostgreSQL
    participant Session as セッション（JWT の Cookie）

    User->>UI: "Googleでログイン"<br/>ボタンクリック
    UI->>NextAuth: signIn('google', {callbackUrl})
    NextAuth->>Google: OAuth認証リクエスト

    Google-->>User: Google認証画面表示
    User->>Google: Googleアカウントで認証

    alt 認証キャンセル
        Google-->>NextAuth: キャンセル通知
        NextAuth-->>UI: エラー
        UI-->>User: "Googleログインに失敗しました"
    else 認証成功
        Google->>Callback: リダイレクト<br/>(authorization code)
        Callback->>Google: トークン交換
        Google-->>Callback: access_token, user info

        Callback->>AuthTS: signIn({ user, account, profile })
        AuthTS->>AuthTS: provider === 'google'?<br/>profile.email_verified が true か確認
        AuthTS->>DB: users をメールで検索、identities を sub で検索
        DB-->>AuthTS: どちらも無し (新規ユーザー)

        AuthTS->>DB: トランザクション開始
        Note over AuthTS,DB: 新規ユーザー作成
        AuthTS->>DB: users作成<br/>(password_hash=NULL,<br/>is_sso_user=true,<br/>email_verified_at=現在時刻)
        AuthTS->>DB: identities作成<br/>(provider='google',<br/>provider_id, identity_data)
        AuthTS->>DB: トランザクションコミット
        DB-->>AuthTS: 成功

        AuthTS-->>Callback: true
        Callback->>JWT: jwt({ token, user, account })
        JWT->>DB: users をメールで検索
        DB-->>JWT: id
        JWT->>JWT: token.id = users.id
        JWT-->>Callback: token

        Callback->>Session: JWT を Cookie に保存
        Session-->>Callback: 成功

        Callback-->>UI: リダイレクト
        UI->>UI: /dashboardへ
        UI-->>User: ダッシュボード表示
    end
```

### 同じメールのアカウントがある場合の Google ログイン

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant Callback as /api/auth/callback/google
    participant AuthTS as signInCallback
    participant DB as Prisma + PostgreSQL
    participant Login as /login

    User->>Callback: Google で認証して戻る
    Callback->>AuthTS: signIn({ user, account, profile })
    AuthTS->>AuthTS: profile.email_verified が true か確認
    AuthTS->>DB: users をメールで検索
    AuthTS->>DB: identities を Google の sub で検索

    alt sub が連携済み
        AuthTS-->>Callback: true（ユーザーが一致するときだけ）
    else メールが確認済みのアカウントと一致
        AuthTS-->>Callback: false
        Callback-->>Login: /login?error=AccessDenied
        Login-->>User: 登録時の方法でのログインを案内
    else メールが未確認のアカウントと一致
        AuthTS->>DB: 未確認の行を削除し、別の id で users と identities を作成
        AuthTS-->>Callback: true
    end
```

## 🔄 アカウント連携状態遷移図

```mermaid
stateDiagram-v2
    [*] --> Unregistered: ユーザー初回訪問

    Unregistered --> CredentialsOnly: メール/パスワード登録
    Unregistered --> GoogleOnly: Google登録

    GoogleOnly --> Linked: メール/パスワード設定(将来機能)

    state CredentialsOnly {
        [*] --> HasPassword
    }
    note right of HasPassword
        password_hash: あり
        is_sso_user: false
        identities: なし
    end note

    state GoogleOnly {
        [*] --> NoPassword
    }
    note right of NoPassword
        password_hash: NULL
        is_sso_user: true
        identities: Google
    end note

    state Linked {
        [*] --> BothMethods
    }
    note right of BothMethods
        password_hash: あり
        is_sso_user: true
        identities: Google
        ログイン方法: 両方可能
        この状態になるのは、自動連携を止める前に連携した利用者だけ
    end note

    CredentialsOnly --> [*]: ログアウト
    GoogleOnly --> [*]: ログアウト
    Linked --> [*]: ログアウト

```

---

## 🗂️ データベーストランザクションフロー図

### 新規Google OAuth ユーザー作成

```mermaid
flowchart LR
    Start([トランザクション開始]) --> Step1[users作成]
    Step1 --> Step1Details{password_hash: NULL<br/>is_sso_user: true<br/>email_verified_at: NOW<br/>name: Google名<br/>email: Googleメール}

    Step1Details --> Step3[identities作成]
    Step3 --> Step3Details{provider: 'google'<br/>provider_id: GoogleアカウントID<br/>identity_data: JSON}

    Step3Details --> Commit{コミット成功?}
    Commit -->|Success| Success([ユーザー作成完了])
    Commit -->|Failure| Rollback([全てロールバック])

    Rollback --> Error[エラーログ出力]
    Error --> End([ログイン失敗])

    Success --> SessionCreate[JWT を Cookie に保存]
    SessionCreate --> Dashboard([/dashboardへ])

    style Step1 fill:#FFE4B5
    style Step3 fill:#FFE4B5
    style Success fill:#90EE90
    style Rollback fill:#FFB6C1
```

### 既存ユーザーの Google ログイン

```mermaid
flowchart LR
    Start([Google から戻る]) --> Check1{identities に<br/>sub がある?}

    Check1 -->|ある| Match{メールのユーザーと一致?}
    Match -->|一致| Session[セッション作成]
    Match -->|不一致| Denied([/login?error=AccessDenied])

    Check1 -->|ない| Check2{同じメールのアカウント}
    Check2 -->|確認済み| Denied
    Check2 -->|未確認| Replace[行を削除して作り直す]
    Check2 -->|なし| Create[新規作成]

    Replace --> Session
    Create --> Session
    Session --> Dashboard([/dashboardへ])
```

---

## 🔐 セッション管理フロー

セッション戦略は JWT（`src/auth/config.ts`）。`sessions` テーブルは無く、Redis にも持たない。セッションの実体は Cookie に入った JWT だけ。

```mermaid
flowchart TD
    Login([ログイン成功]) --> CreateJWT[JWTトークン生成]
    CreateJWT --> AddUserID[token.id = users.id]
    AddUserID --> SetCookie[Cookie設定<br/>authjs.session-token<br/>HTTPS では __Secure- 付き]

    SetCookie --> User([ユーザーへ返却])

    User --> Request{リクエスト}
    Request --> AuthFunc[authサーバーコンポーネント]
    Request --> UseSession[useSessionクライアントコンポーネント]

    AuthFunc --> VerifyJWT[JWTトークン検証]
    UseSession --> VerifyJWT

    VerifyJWT --> CheckSession{セッション有効?}
    CheckSession -->|有効| GetUserInfo[ユーザー情報取得]
    CheckSession -->|無効| Redirect[/loginへリダイレクト/]

    GetUserInfo --> AccessGranted([アクセス許可])

    AccessGranted --> UserAction{ユーザー操作}
    UserAction -->|継続| Request
    UserAction -->|ログアウト| Logout[signOut]

    Logout --> ClearCookie[Cookie削除]
    ClearCookie --> LoginPage([/loginへリダイレクト/])

    style SetCookie fill:#87CEEB
    style AccessGranted fill:#90EE90
    style Redirect fill:#FFB6C1

```

> Cookie 名は Auth.js v5 の既定（v4 の `next-auth.session-token` ではない）。HTTPS のときの `__Secure-` 付きの名前は `src/proxy.test.ts` が使っている。ブラウザで実際の名前を見る確認は、まだしていない。

---

## 🛡️ アクセス制御フロー（Proxy）

`src/proxy.ts`（Next.js 16 の Proxy）が `src/auth/edge.ts` の `authorized` を呼ぶ。**既定は拒否**で、公開するパスだけを列挙している。`/dashboard` だけを保護しているのではない。

```mermaid
flowchart TD
    Request([リクエスト受信]) --> Logged{ログイン済み?}

    Logged -->|Yes| Verif{"メール確認まわりの3ページ?<br/>/auth/verify-email<br/>/auth/verification-success<br/>/auth/verification-error"}
    Verif -->|Yes| AllowAccess([アクセス許可<br/>転送しない])
    Verif -->|No| PublicOrRoot{"公開パス または /?"}
    PublicOrRoot -->|Yes| RedirectDashboard[/dashboardへリダイレクト/]
    PublicOrRoot -->|No| AllowAccess

    Logged -->|No| Public{"公開パス?<br/>/login, /register,<br/>/auth/check-email,<br/>メール確認の3ページ,<br/>/api/auth/*"}
    Public -->|Yes| AllowAccess
    Public -->|No| IsApi{"/api/* ?"}
    IsApi -->|Yes| Unauthorized["401 JSON<br/>error: Unauthorized"]
    IsApi -->|No| RedirectLogin[/loginへリダイレクト/]

    AllowAccess --> Response([レスポンス返却])
    RedirectLogin --> Response
    RedirectDashboard --> Response
    Unauthorized --> Response

    style AllowAccess fill:#90EE90
    style RedirectLogin fill:#FFB6C1
    style Unauthorized fill:#FFB6C1
    style RedirectDashboard fill:#87CEEB
```

`/healthz`、`/readyz`、`/_next/*` などは `proxy.ts` の matcher で除外されるので、この判定に来ない。

---

## 📋 エラーハンドリングフロー

`authenticate()`（`src/lib/actions.ts`）が、ログインの失敗を利用者向けの文言にする。

```mermaid
flowchart TD
    Start([authenticate 開始]) --> SignIn[signIn credentials を実行]

    SignIn -->|成功| Redirect(["signIn が /dashboard への遷移を投げる<br/>catch せずそのまま投げ直す"])
    SignIn -->|例外| Kind{例外の種類}

    Kind -->|Error ではない| Error0[予期しないエラーが<br/>発生しました。]
    Kind -->|AuthError 以外の Error| Rethrow([そのまま投げる])
    Kind -->|AuthError| Type{error.type}

    Type -->|CredentialsSignin| Unverified{EmailNotVerifiedError?}
    Unverified -->|Yes| Error1[メールアドレスが確認できていません。<br/>確認メールのリンクを開いてください。]
    Unverified -->|No| Error2[メールアドレスまたは<br/>パスワードが正しくありません。]
    Type -->|CallbackRouteError| Error3[ログイン処理中に<br/>エラーが発生しました。]
    Type -->|その他| Error0

    Error0 --> DisplayError([UIにエラー表示])
    Error1 --> DisplayError
    Error2 --> DisplayError
    Error3 --> DisplayError

    style Redirect fill:#90EE90
    style DisplayError fill:#FFB6C1
```

Google ログインの拒否は `authenticate()` を通らず、`/login?error=AccessDenied` に戻る。

---
