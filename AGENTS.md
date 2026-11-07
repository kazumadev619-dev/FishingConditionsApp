# AGENTS.md

基本的な会話は日本語で。

## プロジェクト概要

**Fishing Conditions App** - 釣り条件をスコア化するPWA
- **Phase 1 (現在):** Next.js + React フルスタックMVP

## 禁止事項

- `@ts-ignore`、空catch禁止（根本原因を修正）
- リンター設定ファイル（biome.json, .oxlintrc.json, eslint.config.*）の直接編集禁止
- 関連が薄く見えるエラーの放置禁止（対処するか、理由を明示して記録する）
- テストを通すためだけのテスト改変禁止（実装の誤りを疑う）

## テスト

テストを書く・直す前に `docs/guides/testing-policy.md` を読む。要点:

- 期待値は仕様（issue、ADR、`docs/reference/`）から決める。実装の式やいまの出力を写さない。根拠がなければ、書く前にユーザーに確認する
- 内部の呼び出し回数や private の値を検証しない。回数が仕様のとき（課金・クォータ・キャッシュ、二重実行の禁止など。`docs/guides/testing-policy.md` の5節）は検証してよい。モックは外へ出る副作用だけ、取得はスタブ
- 高リスク箇所（認証・認可、スコア計算、データ移行・シード、入力検証・レート制限）の追加要件は、`docs/guides/testing-policy.md` の7節に従う
- 適用は新しく書く・変更するテストだけ

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
