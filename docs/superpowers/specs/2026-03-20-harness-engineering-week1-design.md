# Harness Engineering Week 1 設計書

**日付:** 2026-03-20
**ブランチ:** refactor/#1
**参考:** [Harness Engineering Best Practices 2026](https://nyosegawa.com/posts/harness-engineering-best-practices-2026/)

---

## 概要

Claude Code等のAIエージェントを安定・自律的に動かすための「ハーネス」をこのプロジェクトに導入する。
Week 1は2つのPRに分けて実施し、ツール移行とHook設定を独立して検証できるようにする。

---

## Step 1: ツール移行（PR #1）

### 目的
フォーマッターをPrettier → Biome に置き換え、高速リンターOxlintを追加する。
ESLintはCIのみの深い解析ツールに格下げする。

### 変更内容

#### Biome導入
- `@biomejs/biome` をdevDependenciesに追加
- `biome.json` を作成（フォーマット設定 + 基本lint設定）
- `package.json` スクリプト変更:
  - `format`: `prettier --write ...` → `biome format --write ./src`
  - `format:check`: `prettier --check ...` → `biome format ./src`
- `prettier` / `prettier-plugin-*` をdevDependenciesから削除
- `.prettierrc` / `.prettierignore` を削除
- `lint-staged` の Prettier 参照を Biome に変更

#### Oxlint追加
- `oxlint` をdevDependenciesに追加
- `.oxlintrc.json` を作成
- `package.json` に `lint:fast` スクリプト追加: `oxlint src/`

#### ESLint格下げ
- `lint-staged` から ESLint を除外（Biome + Oxlint に委譲）
- `package.json` の `lint` スクリプト（ESLint）はCI用途として維持
- pre-commitフックはlint-stagedのBiome+Oxlintのみ実行

### 検証基準
- `npm run format` でBiomeがフォーマット実行できる
- `npm run lint:fast` でOxlintが実行できる
- `npm run lint` でESLintが実行できる（CI用途）
- `git commit` でpre-commitが正常に動作する

---

## Step 2: Hook設定 + CLAUDE.md整理（PR #2）

### 目的
Claude CodeのHooksシステムを設定し、ファイル編集のたびに自動lint→自己修正ループを実現する。
CLAUDE.mdをポインタ設計に整理し、ADRで技術的決定を記録する。

### 変更内容

#### PostToolUse Hook
`.claude/settings.json` に以下を設定:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "cd $CLAUDE_PROJECT_DIR && npx oxlint --format=json $CLAUDE_TOOL_INPUT_FILE_PATH 2>&1 | head -50"
          },
          {
            "type": "command",
            "command": "cd $CLAUDE_PROJECT_DIR && npx biome check --write $CLAUDE_TOOL_INPUT_FILE_PATH 2>&1"
          }
        ]
      }
    ]
  }
}
```

**動作:** ファイル編集後にOxlint → Biome autofix を自動実行。エラーがあればClaudeへフィードバックされ自己修正ループが発動する。

#### PreToolUse Hook（設定ファイル保護）
保護対象ファイルへの直接編集をブロック:
- `biome.json`
- `.oxlintrc.json`
- `eslint.config.*`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "echo $CLAUDE_TOOL_INPUT_FILE_PATH | grep -E '(biome\\.json|\\.oxlintrc\\.json|eslint\\.config)' && echo 'BLOCKED: リンター設定ファイルは直接編集禁止。変更が必要な場合はユーザーに確認してください。' && exit 1 || exit 0"
          }
        ]
      }
    ]
  }
}
```

#### CLAUDE.md整理
- 現在75行 → 50行以下に削減
- 詳細な説明・設計情報を削除し、docsへのポインタに置き換え
- 残す内容: コマンド参照、禁止事項、ルーティング指示

#### 初ADR
`docs/adr/001-harness-tooling.md` を作成:
- **決定:** Oxlint（PostToolUse高速lint）+ Biome（フォーマット）+ ESLint（CIのみ）
- **理由:** フィードバック速度の最適化。PostToolUse Hookでms単位の即時フィードバックを実現するため高速ツールが必要
- **代替案:** ESLint一本化（遅い）、Biomeのみ（ESLintのルール網羅性が失われる）

### 検証基準
- ファイル編集後にOxlint + Biomeが自動実行される
- `biome.json` を編集しようとするとブロックされる
- CLAUDE.mdが50行以下になっている
- ADRファイルが存在する

---

## 非機能要件

- 既存のCIパイプラインを壊さない
- `npm run type-check && npm run lint && npm run build` が引き続き通る
- Biome移行後もコードスタイルの一貫性が保たれる

---

## 実施順序

```
PR #1: ツール移行
  └─ Biome導入（Prettier置き換え）
  └─ Oxlint追加
  └─ ESLint格下げ（CIのみ）
  └─ 動作確認後マージ

PR #2: Hook設定
  └─ PostToolUse Hook
  └─ PreToolUse Hook
  └─ CLAUDE.md整理
  └─ 初ADR
```
