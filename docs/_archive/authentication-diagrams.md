# 🔐 認証システム フロー図・シーケンス図

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

    CredRegister --> CreateCredUser[ユーザー作成<br/>auth_users + public_users]
    GoogleRegister --> GoogleAuth

    GoogleAuth --> CheckExisting{既存ユーザー?}
    CheckExisting -->|Yes| LinkAccount[アカウント連携<br/>identities追加]
    CheckExisting -->|No| CreateOAuthUser[ユーザー作成<br/>auth_users + public_users<br/>+ identities]

    CredAuth --> AuthSuccess{認証成功?}
    CreateCredUser --> LoginRedirect[/loginへリダイレクト/]
    LinkAccount --> AuthSuccess
    CreateOAuthUser --> AuthSuccess
    LoginRedirect --> CredLogin

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
    style LinkAccount fill:#FFD700
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
        Action->>DB: メール重複チェック
        DB-->>Action: 結果

        alt メール既に存在
            Action-->>UI: "既に登録済み"
            UI-->>User: エラー表示
        else メール未使用
            Action->>Bcrypt: パスワードハッシュ化
            Bcrypt-->>Action: ハッシュ値

            Action->>DB: users作成<br/>(password_hash, email_verified_at=NULL)
            DB-->>Action: 成功

            Note over Action,Email: メール検証フロー
            Action->>Token: 検証トークン生成(1時間有効)
            Token-->>Action: token
            Action->>DB: verification_tokens保存
            DB-->>Action: 成功

            Action->>Email: 検証メール送信<br/>(purpose: 'signup')
            Email-->>User: メール送信

            Action-->>UI: 登録成功
            UI->>UI: /loginへリダイレクト
            UI-->>User: ログインページ表示<br/>※メール確認を促すメッセージ

            User->>User: メール確認
            User->>User: 検証リンククリック
            User->>UI: /api/auth/verify-email?token=xxx
            UI->>DB: トークン検証・email_verified_at更新
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
    participant AuthTS as /src/auth.ts
    participant Bcrypt as bcrypt
    participant DB as Prisma + PostgreSQL
    participant Session as セッション管理

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
            else パスワード一致
                AuthTS-->>NextAuth: userオブジェクト
                NextAuth->>AuthTS: jwt({ token, user })
                AuthTS->>AuthTS: token.id = user.id
                AuthTS-->>NextAuth: token

                NextAuth->>Session: セッション作成
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
    participant AuthTS as /src/auth.ts signIn()
    participant DB as Prisma + PostgreSQL
    participant Session as セッション管理

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

        Callback->>AuthTS: signIn({ user, account })
        AuthTS->>AuthTS: provider === 'google'?
        AuthTS->>DB: findUnique(email)
        DB-->>AuthTS: null (新規ユーザー)

        AuthTS->>DB: トランザクション開始
        Note over AuthTS,DB: 新規ユーザー作成
        AuthTS->>DB: auth_users作成<br/>(encrypted_password=NULL,<br/>is_sso_user=true)
        AuthTS->>DB: public_users作成
        AuthTS->>DB: identities作成<br/>(provider='google',<br/>provider_id, identity_data)
        AuthTS->>DB: トランザクションコミット
        DB-->>AuthTS: 成功

        AuthTS-->>Callback: true
        Callback->>AuthTS: jwt({ token, user })
        AuthTS->>AuthTS: token.id = user.id
        AuthTS-->>Callback: token

        Callback->>Session: セッション作成
        Session-->>Callback: 成功

        Callback-->>UI: リダイレクト
        UI->>UI: /dashboardへ
        UI-->>User: ダッシュボード表示
    end
```

### 既存ユーザーアカウント連携フロー（メール検証付き）

```mermaid
sequenceDiagram
    actor User as ユーザー<br/>(Credentials登録済み)
    participant UI as /login
    participant NextAuth as NextAuth Client
    participant Google as Google OAuth
    participant Callback as /api/auth/callback/google
    participant AuthTS as /src/auth/index.ts signIn()
    participant DB as Prisma + PostgreSQL
    participant Token as Token Generator
    participant Email as Resend
    participant Session as セッション管理

    Note over User: user@example.com で<br/>Credentials登録済み<br/>(email_verified_at=NULL)

    User->>UI: "Googleでログイン"<br/>ボタンクリック
    UI->>NextAuth: signIn('google', {callbackUrl})
    NextAuth->>Google: OAuth認証リクエスト

    Google-->>User: Google認証画面表示
    User->>Google: 同じメールアドレスの<br/>Googleアカウントで認証
    Google->>Callback: リダイレクト
    Callback->>Google: トークン交換
    Google-->>Callback: access_token, user info

    Callback->>AuthTS: signIn({ user, account })
    AuthTS->>AuthTS: provider === 'google'?
    AuthTS->>DB: findUnique(email)
    DB-->>AuthTS: existingUser<br/>(Credentials登録済み)

    Note over AuthTS,DB: 既存ユーザー検出
    AuthTS->>DB: identities.findUnique(<br/>provider_id, provider)
    DB-->>AuthTS: null (未連携)

    AuthTS->>AuthTS: email_verified_at確認

    alt メール未検証
        Note over AuthTS,Email: メール検証フロー開始
        AuthTS->>Token: 検証トークン生成(1時間有効)
        Token-->>AuthTS: token
        AuthTS->>DB: verification_tokens保存
        DB-->>AuthTS: 成功

        AuthTS->>Email: 検証メール送信<br/>(purpose: 'social-link')
        Email-->>User: メール送信

        AuthTS-->>Callback: false (AccessDenied)
        Callback-->>UI: エラー
        UI-->>User: "メール確認が必要です"

        User->>User: メール確認
        User->>User: 検証リンククリック
        User->>UI: /api/auth/verify-email?token=xxx
        UI->>DB: トークン検証・email_verified_at更新
        DB-->>UI: 成功
        UI->>UI: /auth/verification-successへ
        UI-->>User: "検証完了。再度Googleログインしてください"

        User->>UI: "Googleでログイン"再試行
        UI->>NextAuth: signIn('google', {callbackUrl})
        NextAuth->>Google: OAuth認証リクエスト
        Google->>Callback: リダイレクト
        Callback->>AuthTS: signIn({ user, account })
        AuthTS->>DB: findUnique(email)
        DB-->>AuthTS: existingUser<br/>(email_verified_at あり)
    end

    Note over AuthTS,DB: メール検証済み → アカウント連携
    AuthTS->>DB: identities.create({<br/>provider='google',<br/>user_id,<br/>provider_id,<br/>identity_data})
    DB-->>AuthTS: 成功

    AuthTS->>DB: users.update(<br/>is_sso_user=true)
    DB-->>AuthTS: 成功

    AuthTS-->>Callback: true
    Callback->>AuthTS: jwt({ token, user })
    AuthTS->>AuthTS: token.id = existingUser.id
    AuthTS-->>Callback: token

    Callback->>Session: セッション作成
    Session-->>Callback: 成功

    Callback-->>UI: リダイレクト
    UI->>UI: /dashboardへ
    UI-->>User: ダッシュボード表示

    Note over User,DB: 次回以降、Credentials/Google<br/>どちらでもログイン可能
```

---

## 🔄 アカウント連携状態遷移図

```mermaid
stateDiagram-v2
    [*] --> Unregistered: ユーザー初回訪問

    Unregistered --> CredentialsOnly: メール/パスワード登録
    Unregistered --> GoogleOnly: Google登録

    CredentialsOnly --> Linked: Googleログイン(同一メール)
    GoogleOnly --> Linked: メール/パスワード設定(将来機能)

    state CredentialsOnly {
        [*] --> HasPassword
    }
    note right of HasPassword
        encrypted_password: あり
        is_sso_user: false
        identities: なし
    end note

    state GoogleOnly {
        [*] --> NoPassword
    }
    note right of NoPassword
        encrypted_password: NULL
        is_sso_user: true
        identities: Google
    end note

    state Linked {
        [*] --> BothMethods
    }
    note right of BothMethods
        encrypted_password: あり
        is_sso_user: true
        identities: Google
        ログイン方法: 両方可能
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
    Start([トランザクション開始]) --> Step1[auth_users作成]
    Step1 --> Step1Details{encrypted_password: NULL<br/>is_sso_user: true<br/>email_confirmed_at: NOW}

    Step1Details --> Step2[public_users作成]
    Step2 --> Step2Details{同じUUID<br/>name: Google名<br/>email: Googleメール}

    Step2Details --> Step3[identities作成]
    Step3 --> Step3Details{provider: 'google'<br/>provider_id: GoogleアカウントID<br/>identity_data: JSON}

    Step3Details --> Commit{コミット成功?}
    Commit -->|Success| Success([ユーザー作成完了])
    Commit -->|Failure| Rollback([全てロールバック])

    Rollback --> Error[エラーログ出力]
    Error --> End([ログイン失敗])

    Success --> SessionCreate[セッション作成]
    SessionCreate --> Dashboard([/dashboardへ])

    style Step1 fill:#FFE4B5
    style Step2 fill:#FFE4B5
    style Step3 fill:#FFE4B5
    style Success fill:#90EE90
    style Rollback fill:#FFB6C1
```

### 既存ユーザーアカウント連携

```mermaid
flowchart LR
    Start([既存ユーザー検出]) --> Check1{identitiesレコード<br/>存在確認}

    Check1 -->|既に連携済み| Skip([処理スキップ])
    Check1 -->|未連携| Step1[identities作成]

    Step1 --> Step1Details{provider: 'google'<br/>provider_id: GoogleアカウントID<br/>user_id: 既存ユーザーID<br/>identity_data: JSON}

    Step1Details --> Step2[auth_users更新]
    Step2 --> Step2Details{is_sso_user: true}

    Step2Details --> Success([アカウント連携完了])
    Skip --> Success

    Success --> SessionCreate[セッション作成]
    SessionCreate --> Dashboard([/dashboardへ])

    style Step1 fill:#FFE4B5
    style Step2 fill:#FFE4B5
    style Success fill:#90EE90
```

---

## 🔐 セッション管理フロー

```mermaid
flowchart TD
    Login([ログイン成功]) --> CreateJWT[JWTトークン生成]
    CreateJWT --> AddUserID[token.id = user.id]
    AddUserID --> CreateSession[セッションレコード作成]

    CreateSession --> SessionDB[(Database<br/>sessions テーブル)]
    SessionDB --> SetCookie[Cookie設定<br/>next-auth.session-token]

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

    Logout --> DeleteSession[セッション削除]
    DeleteSession --> ClearCookie[Cookie削除]
    ClearCookie --> LoginPage([/loginへリダイレクト/])

    style CreateSession fill:#87CEEB
    style AccessGranted fill:#90EE90
    style Redirect fill:#FFB6C1

```

---

## 🛡️ アクセス制御フロー（Middleware）

```mermaid
flowchart TD
    Request([リクエスト受信]) --> CheckURL{URLパス確認}

    CheckURL -->|/dashboard/*| RequireAuth{認証済み?}
    CheckURL -->|/login, /register| CheckLogged{ログイン済み?}
    CheckURL -->|その他| AllowAccess([アクセス許可])

    RequireAuth -->|Yes| AllowAccess
    RequireAuth -->|No| RedirectLogin[/loginへリダイレクト/]

    CheckLogged -->|Yes| RedirectDashboard[/dashboardへリダイレクト/]
    CheckLogged -->|No| AllowAccess

    AllowAccess --> Response([レスポンス返却])
    RedirectLogin --> Response
    RedirectDashboard --> Response

    style AllowAccess fill:#90EE90
    style RedirectLogin fill:#FFB6C1
    style RedirectDashboard fill:#87CEEB
```

---

## 📋 エラーハンドリングフロー

```mermaid
flowchart TD
    Start([認証処理開始]) --> TryCatch{try-catch}

    TryCatch -->|Success| ProcessAuth[認証処理実行]
    TryCatch -->|Error| CatchError[エラーキャッチ]

    ProcessAuth --> AuthResult{認証結果}

    AuthResult -->|Success| CreateSession([セッション作成])
    AuthResult -->|CredentialsSignin| Error1[メールアドレスまたは<br/>パスワードが正しくありません]
    AuthResult -->|OAuthSignin| Error2[OAuth認証に失敗しました]
    AuthResult -->|CallbackRouteError| Error3[予期しないエラーが<br/>発生しました]

    CatchError --> LogError[console.error]
    LogError --> Error4[エラーメッセージ生成]

    Error1 --> DisplayError([UIにエラー表示])
    Error2 --> DisplayError
    Error3 --> DisplayError
    Error4 --> DisplayError

    DisplayError --> RetryPrompt([ユーザーに再試行促す])
    CreateSession --> Dashboard([/dashboardへ])

    style CreateSession fill:#90EE90
    style DisplayError fill:#FFB6C1
    style LogError fill:#FFA500
```

---
