# ADR-012: E2E の dev 環境はローカルで worktree ごとに分ける

**日付:** 2026-11-22
**ステータス:** 採用済み

## 決定

E2E を流すための dev 環境は、ローカルで worktree ごとに分けて立てる。

- worktree ごとに docker compose のプロジェクト名とポートを変え、Postgres・Redis・上流スタブをその場で立て、終わったら捨てる
- アプリは `next build` + `next start` で、手元のホストで動かす
- CI でも同じ構成にする。Postgres・Redis は service container で用意し、同じ `up.sh` / `smoke.sh` を流す
- ログイン状態は併用する。ログインの流れは画面から1本、ほかは DB のユーザーと JWT の Cookie で作る

手順と使い方は [E2E 環境](../guides/e2e-env.md)、実装は `scripts/e2e/`。元の記録は [#437 のコメント](https://github.com/kazumadev619-dev/FishingConditionsApp/issues/437#issuecomment-7074573035) と [#438](https://github.com/kazumadev619-dev/FishingConditionsApp/issues/438)。

## 理由

- 複数のエージェントが並行して検証しても、ポート、DB のデータ、Redis のカウンタ（レート制限を含む）で互いに干渉しない。worktree ごとに別のコンテナ・別のポートなので、片方が DB を書き換えても、Redis を空にしても、もう片方に届かない
- すでにある `docker/docker-compose.yml` と同じイメージ（`postgres:17-alpine`、`redis:7-alpine`）と、`scripts/perf/` の上流スタブを使える。足すものが一番少ない
- 立てて捨てる作りなので、毎回空の状態から同じ条件で始められる

## 代替案

### Raspberry Pi に dev 環境を1つ置く（不採用）

本番と同じ Pi に置くと、並行する検証が同じ環境を共有するので互いに干渉する。本番と同じ Pi の資源や、Neon の無料枠も分け合う。Pi の staging は、ローカルで足りないと分かってから、昇格の前だけ使う形で足す。

### Testcontainers（不採用。ポートの割り振りが面倒になったら移る）

テストのコードの中からコンテナを立てて捨てられる。ただ、E2E はアプリ本体と上流スタブも一緒に立てる必要があり、compose のほうが既存の資産を使えて足すものが少ない。ポートの割り振りが compose と自前のスクリプトでは面倒になったときに移る。

### コンテナを共有して DB 名だけで分ける（不採用）

コンテナは1組で済むが、Redis は DB 名で分けられず、レート制限のカウンタや、キャッシュ、`flushall` が worktree をまたいで干渉する。DB も、接続数や負荷、`DROP` の事故が共有される。

### CI だけで E2E を流す（不採用）

手元で再現できず、エージェントが PR を出す前に確かめられない。失敗の原因を調べるたびに CI を回すことになる。

### PR ごとのプレビュー環境（不採用）

環境を作って捨てる仕組みが大きい。いまの規模では、worktree ごとの使い捨てで足りる。

## 結果

- `npm run e2e:up` / `e2e:down` / `e2e:smoke` で立てる・片付ける・確かめる。`e2e-env` ジョブが CI で同じ手順を流す。必須のチェックにするのは、E2E が安定してから
- Playwright のテスト本体は #439、実キーでの地図などの確認は #440
- 実 DB を使うテスト（#354）は、`e2e-env` ジョブの service container を使う（`services:` はジョブをまたいで共有できないので、このジョブにステップを足すか、同じ定義を写す）

## 見直す条件

- ローカルの環境では足りないと分かったとき（Pi の staging を昇格の前だけ足す）
- ポートの割り振りが面倒になったとき（Testcontainers へ）
