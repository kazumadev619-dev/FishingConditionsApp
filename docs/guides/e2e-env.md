# E2E 環境

E2E（画面を通した確認）を、毎回同じ条件で流すための環境の立て方と使い方。Playwright の E2E テスト本体は #439（基盤と全 10 シナリオを導入済み）、実キーでの地図の確認は #440（[chrome-visual-check.md](./chrome-visual-check.md)）が受け持つ。worktree ごとに分けた理由は [ADR-012](../adr/012-e2e-dev-env-per-worktree.md)。

## 立てる・片付ける

```bash
npm run e2e:up      # 立てる → migrate → seed → E2E ユーザー → ビルド → アプリ起動 → /healthz を待つ
npm run e2e:smoke   # 立ち上がった環境が正しいかを確かめる
npm run e2e:down    # 片付ける（アプリ・スタブを止め、コンテナとボリュームを消す）
```

前提は Docker と、`npm ci` が済んでいること。Prisma Client は `src/generated/prisma/` にあるので、そのまま動く。再生成が要るとき（`prisma/schema.prisma` を変えたあとなど）は、`.env` が無い worktree では接続先の変数が足りず失敗するので、ダミーを渡す。

```bash
DATABASE_URL_DIRECT=postgresql://x@localhost/x npx prisma generate
```

ビルドを省いて既存の `.next` を使うときは `SKIP_BUILD=1 npm run e2e:up`。

`up` は、すでに環境が残っていれば先に片付けてから立て直す。2回続けて流しても同じ状態になる。

`up` が失敗したとき（ビルド失敗、`/healthz` が返らない）や Ctrl-C で止めたときは、ビルド・アプリ・スタブのログの末尾を出してから、自分で片付ける。`.e2e/state.env` を失っていても、`npm run e2e:down` はプロジェクト名（パスから決まる）でコンテナを片付ける。

## 何が立つか

| もの | 中身 |
| --- | --- |
| Postgres・Redis | `scripts/e2e/docker-compose.yml`。この環境専用の空のコンテナ |
| 上流スタブ | `scripts/perf/stub.mjs`（OpenWeatherMap・tide736・Google Geocoding・Resend の代わり）。ホストのプロセス |
| アプリ | `next build` + `next start`。`scripts/perf/redirect-upstream.mjs` で、上の4つ宛ての `fetch` だけをスタブへ向ける |
| E2E ユーザー | `scripts/e2e/users.mjs` の2人（確認済み・未確認）に加え、`e2e/fixtures.ts` の `testUserPage` が DB を書き換えるテストごとに乱数 UUID の確認済みユーザーを作り、終了時に削除する（`user_favorites` は `ON DELETE CASCADE` で自動削除）。新規登録テスト（`E2E-AUTH-03`）は `cleanupUserByEmail()` で `verification_tokens` と `users` を削除する |

接続先・ポート・PID は `.e2e/state.env`（git 管理外）に書く。ログは `.e2e/app.log`・`.e2e/stub.log`・`.e2e/build.log`。

## 複数の worktree で同時に使う

worktree ごとに次を分けているので、並行して立てても干渉しない。

- compose のプロジェクト名は `fishing-e2e-<worktree のパスのハッシュ>`。コンテナ・ネットワーク・ボリュームが分かれる
- Postgres・Redis のホスト側ポートは Docker に、アプリとスタブのポートは OS に選ばせる。固定のポートは使わない。空きは `127.0.0.1` と `::1` の両方で確かめる（macOS では `localhost` が `::1` に引かれ、アプリは `[::1]` だけで待ち受けるため）。`up` は、`/healthz` が返ったあとも、そのポートで待ち受けているのが自分のアプリ（作業ディレクトリがこの worktree）であることを確かめ、違えば失敗にして片付ける
- DB のデータ、Redis のカウンタ（レート制限を含む）、スタブの呼び出し回数は、環境ごとに別

アプリの URL は `http://localhost:<ポート>`。`127.0.0.1` ではなく `localhost` にそろえている。Auth.js はログイン後の転送先を `localhost` で作るので、`127.0.0.1` で開くと Cookie が届かず、ログインの直後に未ログインへ戻る。画面を開くテストも `APP_URL` を使う。

ポートは起動のたびに変わる。`.e2e/state.env` を読むか、`npm run e2e:smoke` のように `state.env` を読むスクリプトを使う。

```bash
. .e2e/state.env      # APP_URL, STUB_URL, DATABASE_URL, REDIS_URL が入る
```

`down` は、その worktree の `state.env` に書いた分だけを消す。ほかの worktree の環境には触れない。

## ログイン状態の作り方

併用する。

- **ログインの流れ自体**: 画面から通す（#439）。メール `e2e-verified@example.test`、パスワードは `scripts/e2e/users.mjs` の値
- **それ以外**: DB のユーザーの ID でセッション Cookie（JWT）を作る。ログインの画面を通さないので速い

```bash
node scripts/e2e/session-cookie.mjs verified   # "authjs.session-token=..." を出す
curl -H "Cookie: $(node scripts/e2e/session-cookie.mjs verified)" "$(. .e2e/state.env; echo $APP_URL)/api/favorites"
```

Playwright からは `scripts/e2e/session-cookie.mjs` の `sessionCookie()` を import する。`E2E_AUTH_SECRET` などの固定値は、本番と無関係なダミーで、リポジトリに置いてよいものに限る。

## 外部 API に出ない作り

- 天気・潮・Geocoding・Resend は、アプリの `fetch` をスタブへ向け替える。向け替え対象以外のホストへの `fetch` は、その場で失敗する
- アプリは空の環境変数から起動し、必要な値だけを明示して渡す。シェルにある本物のキーは混ざらない
- `npm run e2e:smoke` が、スタブに呼び出しが届くことと、想定外のホストへの `fetch` が止まることを確かめる。あわせて、画面と同じ credentials のログインで転送先が `APP_URL` と同じホストになること、未確認ユーザーのログインで確認メールがスタブに届くことも確かめる
- スタブは `127.0.0.1` だけで待ち受ける（`/__mails` の確認リンクが同じ LAN から見えないように）
- ここでいう「外部に出ない」は実行時の話。`next build` は `next/font/google` でフォントを取りに行くため、ビルドのときだけ Google Fonts に出る（課金のある API ではない）
- Resend に送られた内容は `$STUB_URL/__mails` で読める（登録の流れで確認リンクを取り出すときに使う）。上流の呼び出し回数は `$STUB_URL/__stats`
- `scripts/e2e/session-cookie.mjs` の `sessionCookie()` は、`users.mjs` の固定ユーザー名だけでなく `{ id, email }` も受け取る。`testUserPage` fixture はテストごとに作成したユーザーで Cookie を発行し、`finally` で `users` 行を削除して他のテストと状態を共有しない
- `scripts/perf/stub.mjs` は通常 200 の固定応答を返す（Geocoding は `スタブ地点0`〜`9` の 10 件）。ただし `E2E-ERR-01` 用に、他テストや perf で使わない専用の港（`pc=0, hc=24`: 千島列島・伽藍埼）への `tide736` 要求に限り HTTP 503（本文マーカー `STUB_UPSTREAM_ERROR_BODY_DO_NOT_LEAK`）を返す（状態を持たず Redis キャッシュも汚さないため、テストの実行順に依存しない）

### Google Maps の地図

地図はブラウザが Google に直接つなぐので、`fetch` の向け替えでは止まらない。この環境では `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` と `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` を空にしてビルドする。ブラウザが Google に出る経路が無くなり、地図の場所には「APIキーまたはMap IDが設定されていません」の代替表示が出る。

読み込み失敗の画面を試したいときは、`E2E_MAPS_KEY` と `E2E_MAPS_MAP_ID` にダミーを渡して `up` し、Playwright の `page.route` で Google 宛てを遮断する。実キーで地図を出す確認は [chrome-visual-check.md](./chrome-visual-check.md)（localhost:3000 で立てる。`E2E_APP_PORT` でアプリのポートを固定できる）。

## CI

`.github/workflows/ci.yml` の `e2e-env` ジョブが、Postgres・Redis を service container で用意し、同じ `up.sh` / `smoke.sh` に続けて Playwright（Chromium）の `npm run test:e2e` を流す。`E2E_DATABASE_URL` と `E2E_REDIS_URL` が両方あると、`up.sh` は compose を使わずそのサービスに接続する。使い捨てで、`localhost` か `127.0.0.1` のものだけを受け付ける。2つの URL を1つずつ判定し、クエリの `host` / `hostaddr` も同じ判定にかける（pg は URL のホストよりクエリを優先する）。どちらかが別のホストなら、`.e2e/` も作らずに終了コード 2 で止まる。`seed-users.mjs` も、`DATABASE_URL` が別のホストなら入れない。

`ci-summary` は `e2e-env` の結果を参照し、`main` 向け PR（`github.event_name == 'pull_request' && github.base_ref == 'main'`）のときだけ `e2e-env` の失敗で `ci-summary` を落とす（`develop` 向け PR や `push` では参考結果の表示のみ）。

GitHub Actions の `services:` はジョブをまたいで共有できない。実 DB のテスト（#354）は、この `e2e-env` ジョブにステップを足すか、同じ `services:` の定義を写して使う。

失敗したときは、`e2e:down` で `.e2e/` が消える前に `.e2e/app.log` と `.e2e/stub.log` の末尾をジョブのログへ出し、`playwright-report/` と `test-results/` を 7 日間 artifact に保存する。

## Playwright の実行とシナリオ一覧（#439）

```bash
npm run e2e:up        # 環境を起動（.e2e/state.env に APP_URL を書き出す）
npm run test:e2e      # Playwright E2E テストを実行（Chromium のみ）
npm run e2e:down      # 環境を片付ける
```

- 設定は `playwright.config.ts`、共通 fixture と `expectDashboard` は `e2e/fixtures.ts`。
- `e2e/fixtures.ts` の `context` fixture が `APP_URL` 以外のオリジンへのブラウザ通信を遮断し、1件でも記録されればテストを落とす。
- テストを足したり消したりしたら、下の表も更新する。

| ID | 優先度 | 状態 | 流れ | 期待値の出どころ | ファイル |
|---|---|---|---|---|---|
| `E2E-AUTH-01` | P0 | 実装済み | 未ログインで `/dashboard` を開くと `/login` に移り、確認済みユーザーでログインすると `/dashboard` と各カードが表示される | [authentication.md](../reference/authentication.md)（2・3節）、[scoring-algorithm.md](../reference/scoring-algorithm.md) | `e2e/auth.spec.ts` |
| `E2E-AUTH-02` | P0 | 実装済み | 間違ったパスワードでログインするとエラーが表示され、`/dashboard` へも入れない | [authentication.md](../reference/authentication.md)（2・3節） | `e2e/auth.spec.ts` |
| `E2E-LOC-01` | P0 | 実装済み | （Cookie でログイン）「港から選ぶ」で都道府県・港を選ぶと `portId=` 付き URL と選択港の見出しに切り替わる | #439、`code.csv`、[scoring-algorithm.md](../reference/scoring-algorithm.md) | `e2e/location.spec.ts` |
| `E2E-FAV-01` | P1 | 実装済み | お気に入りに追加・削除し、再読み込み後も状態が保たれる | #439、#78 | `e2e/favorites.spec.ts` |
| `E2E-FAV-02` | P1 | 実装済み | お気に入り一覧から場所を選ぶとその場所のダッシュボードに切り替わる | #439、[scoring-algorithm.md](../reference/scoring-algorithm.md) | `e2e/favorites.spec.ts` |
| `E2E-LOC-02` | P2 | 実装済み | 自由検索で場所を選ぶとその場所のダッシュボードに切り替わる | #439、`scripts/perf/stub.mjs`、[scoring-algorithm.md](../reference/scoring-algorithm.md) | `e2e/location.spec.ts` |
| `E2E-AUTH-03` | P2 | 実装済み | 新規登録 → 確認メール → 確認確定 → ログイン（未確認のままのログイン拒否と、リンクを開くだけでは確定しないことも含む） | [authentication.md](../reference/authentication.md)（1・2節） | `e2e/auth.spec.ts` |
| `E2E-ERR-01` | P2 | 実装済み | 上流 API が失敗したときエラー画面（「一時的に利用できません」と「再試行」）が表示され、上流の応答本文は漏れない | [api-error-handling.md](../reference/api-error-handling.md) | `e2e/error.spec.ts` |
| `E2E-AUTH-04` | P1 | 実装済み | サイドバーからログアウトすると `/login` に移り `/dashboard` に戻れない | [authentication.md](../reference/authentication.md)（3節）、#439 | `e2e/auth.spec.ts` |
| `E2E-AUTH-05` | P2 | 実装済み | ログイン済みで `/login` と `/register` を開くと `/dashboard` にリダイレクトされる | [authentication.md](../reference/authentication.md)（3節） | `e2e/auth.spec.ts` |

## 本番に触れない

`scripts/e2e/` は、本番の db-seed・DB・Secret に触れない。E2E ユーザーは `seed-users.mjs` が入れ、`prisma/seed.ts`（本番の db-seed Job が流すもの）には混ぜていない。
