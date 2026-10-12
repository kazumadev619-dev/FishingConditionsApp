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
