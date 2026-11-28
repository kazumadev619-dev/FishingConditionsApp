# Claude in Chrome での画面の確認

Playwright（[e2e-env.md](./e2e-env.md)）では自動化しにくい確認を、Claude in Chrome（Claude Code から実際の Chrome を操作する機能）で行うための手順。地図、狭い幅での見た目、ブラウザのコンソールが対象。決めた経緯は #440。

この文書の手順はそのまま Claude に渡せる形で書いている。人が流すときも同じ手順でよい。

## いつ流すか

- `develop` から `main` への昇格の前（[issue-delivery](../../.agents/skills/issue-delivery/SKILL.md) のステップ6）。必須の3項目（C-MAP、C-NARROW、C-CONSOLE）を流す
- 画面を大きく変える PR（レイアウト、デザイン、地図、CSP の変更など）では、その PR のレビューの前にも流す

対象はローカルの E2E 環境だけ。本番・ステージング・Google Cloud Console は Claude in Chrome で開かない。

## 準備

1. Claude Code を Chrome 拡張機能（Claude in Chrome）につなぐ（`claude --chrome` で起動するか、実行中に `/chrome`）。Anthropic のプランで `/login` している必要がある（API キーでは使えない）
2. Claude in Chrome のタブがあるウィンドウを、最大化・タイル配置にしない。最大化していると、ウィンドウの幅を変える操作が成功を返しても幅が変わらない
3. E2E 環境を、**地図の実キーを渡して localhost:3000 で**立てる（下のコマンド）

```bash
F=<.env.local があるチェックアウト>/.env.local
E2E_MAPS_KEY="$(sed -n 's/^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=//p' "$F")" \
E2E_MAPS_MAP_ID="$(sed -n 's/^NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=//p' "$F")" \
E2E_APP_PORT=3000 npm run e2e:up
```

- **地図の確認は localhost:3000 で行う。** ブラウザ用キーの HTTP リファラ制限で許可されている localhost は `http://localhost:3000/*` だけで、ほかのポートではリファラ制限で地図が出ない（2026-11-28 にオーナーが Cloud Console で確認）
- 3000 番はほかの worktree とぶつかりうる。使用中なら `up` は失敗して片付ける。流し終えたらすぐ `npm run e2e:down` で空ける
- キーの値は読まない・出さない。上のコマンドは値を変数に渡すだけで、画面にもログにも出さない。`.env.local` を開かない
- 実キーは `next build` でバンドルに焼き込まれる。流し終えたら `npm run e2e:down` のあと `rm -rf .next` で消し、次の `SKIP_BUILD=1` の `up` に持ち越さない
- 地図を見ない項目だけなら、ふつうの `npm run e2e:up`（キーなし・任意のポート）でよい

ログインは画面から `e2e-verified@example.test` と `scripts/e2e/users.mjs` のパスワードで行う。

## 検証項目

合格の基準は仕様（issue、`docs/reference/`、データ）から決めたもの。いまの見た目を写したものではない。

| ID | 必須 | 確かめる内容 | 合格の基準 | 基準の出どころ |
|---|---|---|---|---|
| C-MAP-1 | 必須 | 実キーで地図が描画される | 「釣り場の位置」に地図のタイルが出る。「マップを表示できませんでした」「APIキーまたはMap IDが設定されていません」が出ない | #440、#262、[google-maps-api.md](../reference/google-maps-api.md) |
| C-MAP-2 | 必須 | マーカーの位置 | 江ノ島を選んだとき、マーカーの座標が `prisma/data/port-coordinates.csv` の江ノ島の行（`14,19,35.3,139.4833…`）と一致し、地図上でも江ノ島の上にある | #440、#345 |
| C-MAP-3 | 必須 | 拡大・縮小と移動 | ズームのボタンとドラッグで、地図の表示範囲が変わる | #440 |
| C-MAP-4 | 人が確かめる | 全画面表示 | 全画面のボタンで地図が全画面になり、Esc で戻る | #440 |
| C-NARROW | 必須 | 狭い幅でのレイアウト | 幅 375px で、`/dashboard` と `/login` に横スクロールが出ず、操作できる（メニューを開ける、ログインできる） | #287 の完了条件 |
| C-CONSOLE | 必須 | ブラウザのコンソールと通信のエラー | 下の「想定内」を除き、`/login`・`/dashboard`・場所の選択・お気に入りの追加と削除の間に、コンソールのエラー・例外・CSP 違反が出ない。同じオリジンへの要求に 4xx・5xx が無い | #440、#284 |
| C-FEEL | 任意 | 操作感（検索タブの切り替え、候補の出方、`dashboard/loading.tsx` の読み込み中の表示、ハートを押したときの反応） | 合否は付けず、気づいたことを記録する（仕様に基準が無いため） | #440 |
| C-GOOGLE | 任意・人 | Google ログイン | 実 Google のログインは人が行う。Claude はログインページで止まり、人に渡す | #440、[authentication.md](../reference/authentication.md) |

C-NARROW は #287（スマホ対応）が終わるまで不合格になりうる。#287 が開いている間の不合格は、昇格を止める理由にしない。前回の結果より悪くなっていないかを見る。

### C-CONSOLE の「想定内」

| メッセージ | 出る条件 |
|---|---|
| `Google Maps API Key or Map ID is not set.` | キーなしで `up` したとき。地図の代替表示と同時に出る（[e2e-env.md](./e2e-env.md) の「Google Maps の地図」） |
| `TypeError: not granted` | Claude が全画面のボタンを押したとき（下の「既知の制約」） |
| `Failed to fetch … errors.authjs.dev#autherror` | タブを開いたまま `e2e:down` したとき（セッションの確認がつながらない） |

これ以外が出たら不合格として記録する。

## 手順（Claude に渡す）

`APP_URL` は `http://localhost:3000`（地図を見ないときは `.e2e/state.env` の `APP_URL`）。

### C-CONSOLE（ほかの項目と一緒に流す）

1. 新しいタブを開き、`read_console_messages` を `clear: true` で1回呼んで記録を始める
2. `$APP_URL/login` を開き、E2E ユーザーでログインする
3. `/dashboard` で「釣り場」→「港」タブ→都道府県「神奈川県」→港「江ノ島」を選ぶ
4. 見出しの横の星（お気に入りに追加）を押し、もう一度押して戻す
5. `read_console_messages`（`pattern: "."`）で全件を読み、「想定内」以外を書き出す
6. 同じオリジンの失敗した要求を、ページで次を実行して確かめる（Google 宛ての要求は URL にキーが入るので、`read_network_requests` で読まない）

```js
performance.getEntriesByType('resource').concat(performance.getEntriesByType('navigation'))
  .filter((e) => e.responseStatus >= 400).map((e) => [e.responseStatus, new URL(e.name).pathname])
```

### C-MAP（localhost:3000、実キー）

1. ウィンドウを幅 1280 程度にし、C-CONSOLE の 2〜3 と同じく江ノ島を選ぶ
2. GIF の記録を始め、「釣り場の位置」までスクロールしてスクリーンショットを撮る（C-MAP-1）
3. ページで次を実行し、マーカーの座標を CSV の江ノ島の行と比べる（C-MAP-2）

```js
const m = document.querySelector('gmp-advanced-marker');
({ lat: m.position.lat, lng: m.position.lng, title: m.title })
```

4. 「ズームイン」を2回、「ズームアウト」を3回押し、地図を横にドラッグする。押す前後のスクリーンショットで表示範囲が変わったかを見る（C-MAP-3）。地図の縮尺の表示（「地図の縮尺: … あたり … m」）の変化も手がかりになる
5. 全画面のボタンは押さない（C-MAP-4 は人が確かめる）。押すと `TypeError: not granted` が出るだけで、全画面にはならない
6. GIF を書き出す

### C-NARROW

1. ウィンドウの幅を 375 にする（`resize_window`）。ページで `innerWidth` を読み、実際の幅を記録する。375 まで縮まないときは、縮められた最小の幅で続け、その幅を記録する
2. `/dashboard`（江ノ島を選んだ状態）で、ページの先頭と地図までスクロールした位置のスクリーンショットを撮る
3. 横スクロールが無いことを、ページで次を実行して確かめる（`scrollWidth` が `clientWidth` 以下なら無い）

```js
({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth })
```

4. 左上のメニューを開いてスクリーンショットを撮り、ユーザーのメニューからログアウトする
5. `/login` で同じ計測とスクリーンショットを行う

## 記録するもの

- 項目ごとの合否と、不合格なら何が起きたか
- 流した日、`develop` の commit、ウィンドウの実際の幅
- スクリーンショットと GIF。昇格前に流した結果は、昇格 PR の本文に書き、画像はコメントに貼る。画面を変える PR で流した結果は、その PR に書く
- 画像にキーが写っていないこと（地図のタイルや URL バーにキーは出ないが、開発者ツールのネットワークの画面などを撮らない）

## 既知の制約

- **全画面にできない。** Claude in Chrome のクリックでは、Fullscreen API が許可されない（素の `requestFullscreen()` を呼ぶボタンでも `not granted`）。C-MAP-4 は人が確かめる
- **375px まで縮まない。** macOS の Chrome は、ウィンドウの最小幅で表示域がおよそ 570px になる（2026-11-28 に実測）。それより狭い幅は Claude in Chrome では作れない。`md`（768px）より狭いので、スマホ用のレイアウトには切り替わる
- 地図はブラウザが Google に直接つなぐ。この確認の間だけ、E2E 環境は外部（Google Maps）に出る
