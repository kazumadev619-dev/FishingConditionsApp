# ADR-009: テスト品質ポリシー

**日付:** 2026-11-07
**ステータス:** 採用済み

## 決定

テストの「何を保証するか」を、[テスト品質ポリシー](../guides/testing-policy.md)として定める。規則の本文はガイドに置き、この ADR には決めた理由だけを書く。決めた論点は次の5つで、内容はガイドの「期待値の出どころ」「テスト・ダブルの分類表」「高リスク箇所」「カバレッジ」「適用範囲」の各節にある。

- 期待値の出どころ（仕様から決める）
- モックとスタブの使い分け
- 高リスク箇所の追加要件
- カバレッジの扱い（閾値もツールも置かない）
- 適用範囲（新しく書くテストと変更するテストだけ）

## 理由

### 1. Green は正しさの保証ではない

AI が実装し、AI がテストを書き、AI が「問題ありません」と報告すると、実装と評価の基準が同じ作り手から出る。実装と同じ誤解から作った期待値は、誤っていても Green になる。Qiita の記事は、これを実装と検証が同じ最適化ループに入る問題として整理し、人が正しさを定義する側に回ることと、評価軸を独立させることを求めている。このポリシーは、その2点を、このリポジトリの手順に落としたものである。

### 2. 誤報が、テストへの信頼を失わせる

Zenn の記事は、良いテストを4本柱（退行に対する保護、リファクタリングへの耐性、迅速なフィードバック、保守のしやすさ）で評価し、誤報（壊れていないのに赤くなる）の害を重く見ている。このリポジトリのテストでも、`src/` のテスト 39 ファイルのうち 22 ファイルに、`toHaveBeenCalled*` が 129 件ある。副作用や仕様の検証なら正しい使い方だが、内部の呼び出しに結びついたものが混ざっていないかは、確かめられていない。ポリシーは、新しく書くものから、誤報の元を増やさない。既存の見直しは [#353](https://github.com/kazumadev619-dev/FishingConditionsApp/issues/353) に分ける。

### 3. Prisma と Redis を暫定規則にした

Zenn は、自アプリだけが使う DB をモックにせず、実DBの統合テストで確かめるとしている。しかし、いまの CI には Postgres も Redis もなく、実DBを使うテストは1つもない。新しいテストに「実物を使う」を課すと、最初の PR から規則違反が常態化する。そこで、読み取りはスタブ、書き込みは引数の検証、ドライバの挙動は採取した固定値、という暫定規則にした。これは Zenn の方針から外れた妥協である。解除の条件（CI への Postgres・Redis の導入）は [#354](https://github.com/kazumadev619-dev/FishingConditionsApp/issues/354) に記録し、ガイドにも書いてある。

### 4. 高リスク箇所の検証に、別のエージェントを使う

実装者の「テストが通った」を品質の根拠にしないために、高リスク箇所では、別のエージェントに「間違いを証明するテスト」を差分として提案させる。`pr-verifier` は検証が役目で、Write と Edit を持たず、コミットもしないので、提案役には使わない。提案は新しいエージェントに頼み、実装者が取り込む形にした。提案を fork に頼むと、実装者の文脈と見落としをそのまま引き継ぐので、仕様と差分だけを渡した新しいエージェント（できれば別モデル）に頼む。

### 5. データ移行には、冪等性を求めない

`prisma/migrations/` のマイグレーションには、再適用すると値が壊れるものがある（`20260907130000_fix_port_coordinates_degree_minutes`）。多重適用を防いでいるのは `_prisma_migrations` で、`migrate deploy` を2回流しても2回目は何もしない。このため「2回流して確かめる」は検証にならず、手で流せば事故になる。データ移行・シードでは、seed の再実行（`scripts/verify-seed-rerun.sh`）と、空の DB での `migrate deploy` の結果を載せる。データを入れた DB での適用前後の比較は、[#354](https://github.com/kazumadev619-dev/FishingConditionsApp/issues/354) に回した。

### 6. 強制は、いまはレビュー頼みである

Qiita の記事は、守る条件をプロンプトだけに置かず、CI の Required Checks に置くことを求めている。このポリシーは、いまは docs と、`CLAUDE.md` と `AGENTS.md` の要点、PR テンプレートのチェック項目、人のレビューで運用する。CI での強制は、リンター設定ファイルの直接編集が禁止されており、ユーザーの作業が前提になるため、[#355](https://github.com/kazumadev619-dev/FishingConditionsApp/issues/355) に分けた。それまでは、記事の主張を満たさない。

## 代替案

### rules ファイル（`.claude/rules/testing.md`）に要点を書く（不採用）

`paths:` で `*.test.ts` を指定した rules は、対象のファイルを Read、Write、Edit した時点で読み込まれる。新しいテストファイルの最初の Write は、rules を見ないまま書かれる。さらに、GitHub Actions 版の AI factory（ADR-007。まだマージされていない）は実行前に `.claude` を消して動くので、移行後は rules を読まない。`CLAUDE.md` と `AGENTS.md` に直接書けば、Claude、Codex、factory のすべてが読む。

### `reviewing-tests` skill を作る（今回は見送り）

中身が `pr-verifier` と `mutation-test` にほぼ重なり、保守が二重になる。この2つで足りない場面が出てから作る。

### `issue-delivery` を緩め、高リスク箇所だけ `mutation-test` を必須にする（不採用）

`issue-delivery` は、回帰テストを書いたときは常に `mutation-test` を使うと定めている。緩めると、いまの約束より弱くなる。コストが気になる箇所は、実績を見てから緩める。高リスク箇所では、その結果を PR に載せるところまでを必須にする。

### カバレッジの閾値を CI で強制する（不採用）

網羅率は、コードが実行されたかどうかしか示さない。閾値を置くと、結果をほとんど確かめないテストが増える。退行を検知できるかは、`mutation-test` で確かめる。

## 結果

- [`docs/guides/testing-policy.md`](../guides/testing-policy.md) が、テストの方針の本体になる。
- `CLAUDE.md` と `AGENTS.md` に要点とリンクを置く。`docs/README.md` の「テストを書きたい」の行と、`docs/guides/development.md` のテスト戦略の節を、このポリシーに合わせて更新する。
- `github-push-pr` の PR テンプレートの「テスト計画」と、`issue-delivery` のレビューの手順に、高リスク箇所の要件を足す（`.claude/skills/` と、Codex 用の写し `.agents/skills/` の両方）。
- 既存テストの見直し（[#353](https://github.com/kazumadev619-dev/FishingConditionsApp/issues/353)）、実DB基盤と暫定規則の解除（[#354](https://github.com/kazumadev619-dev/FishingConditionsApp/issues/354)）、CI での強制（[#355](https://github.com/kazumadev619-dev/FishingConditionsApp/issues/355)）は、別の issue で扱う。

## 補足: 番号と、この決定を見直すべきタイミング

- ADR の番号は、007 を AI factory、008 を signup のレート制限に予約している。どちらもまだマージされていないので、この ADR は 009 とした。
- CI に Postgres と Redis が入り、暫定規則を解除したとき（[#354](https://github.com/kazumadev619-dev/FishingConditionsApp/issues/354)）。
- CI で強制できる条件が見つかったとき（[#355](https://github.com/kazumadev619-dev/FishingConditionsApp/issues/355)）。
- AI factory（ADR-007）がマージされたとき。ガイドと ADR にある「まだマージされていない」の記述を直す。
- 高リスク箇所の4つの役割を持つファイルを、一覧の外に新しく作ったとき。
