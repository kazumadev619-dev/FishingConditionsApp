# エラーの3分類と扱い

> - **状態**: 仕様（正）
> - **対応する実装**: `src/lib/api/`、`src/lib/apiErrorUtils.ts`、`src/lib/rateLimit.ts`、`src/app/api/`、`src/app/dashboard/error.tsx`、`src/lib/clientErrors.ts`
> - **最終確認**: 2026-11-22（実装を読んで突合。#247）

アプリで起きるエラーを3つに分け、分けごとに HTTP ステータス、利用者への表示、ログのレベル、リトライ、通知の扱いを決める。分ける目的は、人が気づくべきエラーだけを通知の対象にし、通知を増やしすぎないことにある。

API クライアントの使い方は [api-error-handling.md](./api-error-handling.md) にある。

## 1. 3分類と扱い

| | 正常なエラー | 異常なエラー | 想定外のエラー |
|---|---|---|---|
| 何か | 利用者の操作が原因で、起きるのが正常なもの（入力不正、未ログイン、対象なし、重複、回数制限） | システムの外や基盤が原因で、起こりうると分かっているもの（外部 API の障害、DB・Redis・メール送信の障害） | 本来起きないもの（コードの誤り、データの食い違い、画面の例外） |
| HTTP | 400 / 401 / 404 / 409 / 429 | 502 / 503 / 504。上流が 4xx を返しても、利用者には 502 を返す | 500 |
| 利用者への表示 | 何を直せばよいかが分かる固定の文言 | 「一時的に使えない。時間をおいて再試行」の固定の文言。上流の応答本文は出さない | 汎用の文言とエラーID（digest）。`error.message` は出さない |
| ログ | 出さない。回数制限と、不正な値の繰り返しだけ `warn` | 最終的に失敗したとき `error`。リトライ中は `warn`。同じ障害が続くときは間引く（Redis の例） | `error`（スタック付き） |
| リトライ | しない。429 は `Retry-After` のあとに利用者が再試行する | する（指数バックオフ、最大3回）。上流の 429 はしない（#317） | しない |
| 通知 | しない | 1件ごとにはしない。率で検知する（ADR-005 の 5xx 率・外部 API エラー率） | 1件でも人が気づけるようにする（`error` ログ。通知の経路は #283・#284 で入れる） |

境目の判断:

- 「利用者が直せるか」で正常かどうかを決める。直せないものは、利用者の操作が引き金でも異常か想定外に入れる
- 起こりうると分かっていて、コードに対処があれば異常。対処が無い、または対処の外側で起きたものは想定外
- 想定外を 500 以外で返さない。異常を 500 で返さない。この2つが逆になると、通知が鳴るべきでないときに鳴り、鳴るべきときに鳴らない

## 2. エラーパターンと現状

「合」は現状が上の扱いと合っている行。「不一致」は、この PR で直したか、issue に切り出した。

### 正常なエラー

| エラー | 実装の場所 | 現状 | 判定 |
|---|---|---|---|
| 入力不正（座標・日付・コード・JSON） | `src/app/api/*/route.ts`（`validators/`）、`favorites/` | 400 と固定文言。ログなし | 合 |
| 未ログイン | `src/auth/edge.ts`（`/api/*` は 401）、`withUserRateLimit` | 401。ログなし | 合 |
| 回数制限（利用者ごと） | `src/lib/rateLimit.ts` | 429 と `Retry-After`、`warn` | 合 |
| 回数制限（signup） | `src/lib/actions.ts` | 画面の文言を返し、`warn` | 合 |
| 対象なし・重複（お気に入り） | `favorites/handlers/` | 404・409。409 は `warn` | 合（409 は通常は `warn` 不要だが、#78 で復帰に使う情報なので残す） |
| メール重複（signup） | `src/lib/actions.ts`（P2002） | 画面の文言を返す。ログなし | 合 |
| ログイン失敗 | `src/auth/providers/credentials.ts` | `warn`（メールはマスク） | 合 |

### 異常なエラー

| エラー | 実装の場所 | 現状 | 判定 |
|---|---|---|---|
| 外部 API のタイムアウト・5xx・ネットワーク断 | `src/lib/api/client.ts`（リトライ、バックオフ） | `ApiError`（`retryable: true`）、リトライ中は `warn` | 合 |
| 外部 API の 429 | `src/lib/api/errorHandler.ts` | リトライしない（#317） | 合 |
| 外部 API の障害を返す HTTP（`/api/weather`） | `src/app/api/weather/route.ts` | 5xx と通信断は 502。上流の 4xx（自分の API キーの誤り、401・403）はそのまま利用者へ返る | **不一致**。#428 |
| 外部 API の障害を返す HTTP（`/api/scores`、`/api/conditions/tide`、`/api/locations/search`） | 同左の `route.ts` | `ApiError` を見分けず、すべて 500・`error` | **不一致**。#428 |
| tide736 のエラー応答 | `src/lib/tideService.ts` | 素の `Error` で投げる。`ApiError` にならず、想定外として扱われる | **不一致**。#428 |
| Redis 障害 | `src/lib/cache/client.ts`、`rateLimit.ts` | キャッシュは素通し、回数制限は制限なし。`error` を一定間隔で間引く（#343） | 合 |
| DB に届かない（readyz） | `src/app/readyz/route.ts` | 503、`warn`（プローブが繰り返すため） | 合 |
| DB に届かない（signup） | `src/lib/actions.ts`（P1001） | 画面の文言を返し、`error` | 合 |
| メール送信の失敗 | `src/lib/email.ts`、`actions.ts` | 登録は成功させ、`error`。ログインで再送 | 合 |
| 地点解決の DB 障害（ダッシュボード） | `src/app/dashboard/resolveLocation.ts` | `error` を出し、既定の地点で画面は出す | 合 |

### 想定外のエラー

| エラー | 実装の場所 | 現状 | 判定 |
|---|---|---|---|
| ルートの予期しない例外 | 各 `route.ts` の catch | 500、固定文言、`error` | 合 |
| セッションの ID が不正 | `favorites/handlers/`、`auth/callbacks/` | 401、`error` | 合（再ログインで直るので 401。データの食い違いは `error` で残る） |
| Prisma の未対応コード | `favorites/handlers/addFavorite.ts`、`actions.ts` | `error` を出して 500 か汎用の文言 | 合 |
| サーバーの描画で例外（ダッシュボード） | `src/app/dashboard/error.tsx` | digest を出し、message は伏せる。サーバー側は Next.js が digest つきで記録 | 合 |
| 画面（ブラウザ）の例外 | `dashboard/error.tsx`、`MapErrorBoundary`、window の error・unhandledrejection | ブラウザの console だけで、サーバーに届かなかった | **この PR で直した**（#247）。§3 |
| 未ログインの画面と root layout の例外 | `/login` など。`global-error.tsx` が無い | 届かない。Next.js 既定の画面 | **不一致**。#429 |
| クライアントの `logger.error` | `src/hooks/`、`src/components/` | ブラウザの console だけ。サーバーには届かない | 方針: 利用者の通信失敗など異常のもの（再試行で足りる）は届けない。届けたいものは `reportClientError` を呼ぶ |

## 3. 画面の例外をサーバーのログに届ける（#247）

ブラウザの `logger`（pino）は console に出すだけで、サーバーのログには届かない。そこで、ブラウザから受け口に送る。

```
ブラウザ ─ navigator.sendBeacon ─> POST /api/client-errors ─> logger.error（構造化ログ）
```

送る元は4か所。

| 元（`source`） | どこ |
|---|---|
| `dashboard-error` | `src/app/dashboard/error.tsx` |
| `map-boundary` | `MapErrorBoundary`（`componentDidCatch`） |
| `window-error` | `src/instrumentation-client.ts`（`window` の `error`。イベントハンドラの例外） |
| `unhandled-rejection` | 同（握りつぶされた Promise の reject） |

受け口の制限（ログを溢れさせないため）:

- 認証: ログイン中のみ（未ログインは 401。`/api/*` は既定で認証が要る）。利用者 ID は本文でなくセッションから取る
- 回数: 利用者ごとに1分60件（`withUserRateLimit`）。超えたら 429
- 大きさ: 本文は 16KB まで（読みながら数え、超えたら 413）。各項目にも長さの上限があり、超えたら 400
- 形: 項目は決めた7つだけ。ほかの項目があれば 400。値はログの `clientError` の中に閉じ込め、ログの本体メッセージには混ぜない
- ブラウザ側: 1回のページ表示で5件まで。URL はパスだけ送る（クエリとハッシュにはトークンが載りうる）

注意:

- `digest` があるものは、サーバーの描画で起きた例外で、Next.js がサーバーのログにも出している。`digest` をキーにすると、両方を突き合わせられる
- 未ログインの画面の例外は届かない（#429）
- 値の中身（`message`、`stack`）は利用者が自由に作れる。ログを読む側と、通知の条件に使う側は、信頼できる値として扱わない
