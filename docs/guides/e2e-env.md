# E2E 環境

E2E（画面を通した確認）を、毎回同じ条件で流すための環境の立て方と使い方。Playwright のテスト本体は #439、実キーでの地図の確認は #440 が受け持つ。worktree ごとに分けた理由は [ADR-012](../adr/012-e2e-dev-env-per-worktree.md)。

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
| E2E ユーザー | `scripts/e2e/users.mjs` の2人。確認済み（ログインできる）と未確認（ログインは拒否される） |

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
- スタブの応答は成功の形だけ。上流の失敗や、検索結果が複数のときの応答が要るテストは、`scripts/perf/stub.mjs` に足す

### Google Maps の地図

地図はブラウザが Google に直接つなぐので、`fetch` の向け替えでは止まらない。この環境では `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` と `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` を空にしてビルドする。ブラウザが Google に出る経路が無くなり、地図の場所には「APIキーまたはMap IDが設定されていません」の代替表示が出る。

読み込み失敗の画面を試したいときは、`E2E_MAPS_KEY` と `E2E_MAPS_MAP_ID` にダミーを渡して `up` し、Playwright の `page.route` で Google 宛てを遮断する。実キーで地図を出す確認は #440。

## CI

`.github/workflows/ci.yml` の `e2e-env` ジョブが、Postgres・Redis を service container で用意し、同じ `up.sh` / `smoke.sh` を流す。`E2E_DATABASE_URL` と `E2E_REDIS_URL` が両方あると、`up.sh` は compose を使わずそのサービスに接続する。使い捨てで、`localhost` か `127.0.0.1` のものだけを受け付ける。2つの URL を1つずつ判定し、クエリの `host` / `hostaddr` も同じ判定にかける（pg は URL のホストよりクエリを優先する）。どちらかが別のホストなら、`.e2e/` も作らずに終了コード 2 で止まる。`seed-users.mjs` も、`DATABASE_URL` が別のホストなら入れない。

GitHub Actions の `services:` はジョブをまたいで共有できない。実 DB のテスト（#354）は、この `e2e-env` ジョブにステップを足すか、同じ `services:` の定義を写して使う。いまは必須のチェックにしていない。

失敗したときのログは、`up.sh` が片付ける前にジョブのログへ出す。

## 本番に触れない

`scripts/e2e/` は、本番の db-seed・DB・Secret に触れない。E2E ユーザーは `seed-users.mjs` が入れ、`prisma/seed.ts`（本番の db-seed Job が流すもの）には混ぜていない。
