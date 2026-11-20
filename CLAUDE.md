# CLAUDE.md

基本的な会話は日本語で。

## プロジェクト概要

**Fishing Conditions App** - 釣り条件をスコア化するPWA
- **Phase 1 (現在):** Next.js + React フルスタックMVP

## 禁止事項

- `@ts-ignore`、空catch禁止（根本原因を修正）
- リンター設定ファイル（biome.json, .oxlintrc.json, eslint.config.*）の直接編集禁止
- 関連が薄く見えるエラーの放置禁止（対処するか、理由を明示して記録する）
- テストを通すためだけのテスト改変禁止（実装の誤りを疑う）

## 開発の工程と使う skill

詳細は各 skill と docs/guides にある。ここには複製しない。

| 工程 | 使うもの | 必須か推奨か | 誰が |
|---|---|---|---|
| 要件・設計 | `grilling`（必要なら `domain-modeling` / `codebase-design`）で詰める。issue の前提は `issue-delivery` のステップ0で疑う | 推奨。不明点はエージェントが決めず、ユーザーに確認する | 実装者 |
| 実装 | `mattpocock-skills:tdd`（テスト先行）。不具合は `diagnosing-bugs` で調べる。書き方は `docs/guides/testing-policy.md` | 推奨。高リスク箇所（同 7節）は必須 | 実装者 |
| 実装の完了後 | `ponytail:ponytail-review`（差分）、`ponytail:ponytail-audit`（リポジトリ全体）、`ponytail:ponytail-debt`（`ponytail:` コメントの台帳化） | 推奨。報告のみで、修正は適用しない | 実装者 |
| 実証 | `mutation-test`、`run-app-locally`、`updating-dependencies`（依存の更新）。高リスク箇所は `docs/guides/testing-policy.md` 7節の追加要件 | 高リスク箇所は必須。それ以外は変更に応じて | 実装者 |
| レビュー | `mattpocock-skills:code-review` と OCR delegate（上の「コードレビュー」）の併用、`pr-verifier`、`test-review`。手順は `issue-delivery` のステップ4 | 必須。投稿は明示承認のあと | 実装者とは別のエージェント |
| PR とマージ | `github-push-pr`（コミット・push・PR）。`develop` 向けは `Refs #N`、`Closes #N` は `main` への昇格 PR で付ける | 必須。マージはオーナーの指示を待つ | 実装者（マージはオーナー） |
| 昇格・デプロイ後の確認 | `issue-delivery` のステップ6（`main` への昇格、本番での確認） | 必須 | オーナーの指示のもとで実装者 |

文章を書くときは `yomiyasu` を使う。表の skill のうち `grilling`、`mattpocock-skills:*`、`ponytail:*`、`yomiyasu` はオーナーの全体設定にある。無い環境では、同じ目的を満たす手順（要件を質問して詰める、失敗するテストを先に書く、など）を実装者が自分で行う。無い skill を理由に止まらない。

## テスト

テストを書く・直す前に `docs/guides/testing-policy.md` を読む。要点:

- 期待値は仕様（issue、ADR、`docs/reference/`）から決める。実装の式やいまの出力を写さない。根拠がなければ、書く前にユーザーに確認する
- 内部の呼び出し回数や private の値を検証しない。回数が仕様のとき（課金・クォータ・キャッシュ、二重実行の禁止など。`docs/guides/testing-policy.md` の5節）は検証してよい。モックは外へ出る副作用だけ、取得はスタブ
- 高リスク箇所（認証・認可、スコア計算、データ移行・シード、入力検証・レート制限）の追加要件は、`docs/guides/testing-policy.md` の7節に従う
- 適用は新しく書く・変更するテストだけ

## 仕様と文書

`docs/reference/` のうち、冒頭の「状態」が「仕様（正）」の文書は、実装と違えば実装の誤りとして扱う（`docs/adr/010-spec-source-of-truth.md`）。仕様を変える PR は、同じ PR で文書とテストの期待値も更新する。

## Git運用

```bash
git commit -m "✨ feat: 機能追加の説明"
git commit -m "🐛 fix: バグ修正の説明 #123"
```

- 絵文字と type の間は**半角スペース**。`✨:feat:` のようにコロンで繋ぐと commitlint が落ちる
- チケット番号は `#123` のように**数字のみ**。文字列を書くと commitlint が落ちる。無い場合は省略する
- type は `commitlint.config.cts` の `type-enum` にあるもの:
  `feat` `improve` `update` `fix` `hotfix` `refactor` `delete` `style` `docs` `move` `test` `chore` `package` `WIP`

## コードレビュー

コードレビューは open-code-review (OCR) の **delegate モード**で行う（月額プランで API キーが無いため、OCR 自体に LLM を呼ばせない）。

- Claude Code: `open-code-review:delegate-review` スキル / Codex: Open Code Review プラグインの delegate スキル
- 手順: `ocr delegate preview --format json [--from develop --to HEAD]` → `ocr delegate rule --format json <paths>` → git diff を読んで自分でレビュー
- `ocr review`（API キー必須の既定モード）は使わない

## 詳細ドキュメント（必要時のみ参照）

まず `docs/README.md`（索引）を見ること。目的別の一覧と置き場所の判断基準はそこにある。

## Agent skills

### Issue tracker

issue は GitHub Issues（`gh` CLI）で管理する。See `docs/agents/issue-tracker.md`.

### Triage labels

既定の5ラベル（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）を使う。AI factory の `agent:*` ラベルとは別系統。See `docs/agents/triage-labels.md`.

### Domain docs

single-context（ルートの `CONTEXT.md` + `docs/adr/`）。See `docs/agents/domain.md`.
