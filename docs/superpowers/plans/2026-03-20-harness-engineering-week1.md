# Harness Engineering Week 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prettier→Biome移行・Oxlint追加・ESLint格下げ（PR #1）、Claude Code Hooks設定・CLAUDE.md整理・ADR作成（PR #2）を実施し、ファイル編集後の自動lint→自己修正ループを実現する。

**Architecture:** PR #1でツールチェーンをBiome+Oxlint+ESLint(CIのみ)に切り替え、PR #2でClaude Code HooksにPostToolUse/PreToolUseを設定して自律的なlint修正ループを構築する。2つのPRを独立して検証可能にするため順番通りに実施する。

**Tech Stack:** @biomejs/biome, oxlint, husky, lint-staged, Claude Code Hooks (.claude/settings.json)

---

## 事前確認

現在の状態:
- **Formatter:** `prettier` (`.prettierrc.json` + `.prettierignore` 存在)
- **Linter:** `eslint` (eslint.config.mts、`eslint-config-prettier` 使用中)
- **lint-staged:** prettier + eslint の組み合わせ
- **pre-commit:** `npm run test --if-present` + `npx lint-staged`
- **pre-push:** `npm run format:check` + `npm run type-check`
- **CI:** ESLintチェック + Prettierフォーマットチェック + 型チェック + ビルド
- **`.claude/settings.json`:** 存在しない（`.claude/settings.local.json` のみ存在）

---

## PR #1: ツール移行

### Task 1: biome.json を作成する

**Files:**
- Create: `biome.json`

- [ ] **Step 1: biome.json を作成**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.x/schema.json",
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "arrowParentheses": "always",
      "semicolons": "always"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "files": {
    "ignore": [
      "*.lock",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      ".git",
      ".github",
      ".vscode",
      ".kiro",
      ".serena",
      "node_modules",
      ".next"
    ]
  }
}
```

- [ ] **Step 2: .oxlintrc.json を作成**

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "rules": {}
}
```

---

### Task 2: Biome と Oxlint をインストールする

**Files:**
- Modify: `package.json`

- [ ] **Step 1: パッケージをインストール**

```bash
npm install --save-dev @biomejs/biome oxlint
```

- [ ] **Step 2: インストール確認**

```bash
npx biome --version
npx oxlint --version
```

Expected: バージョン番号が表示される

---

### Task 3: package.json のスクリプトと lint-staged を更新する

**Files:**
- Modify: `package.json`

- [ ] **Step 1: scripts を更新**

`package.json` の `scripts` を以下に変更:
```json
"format": "biome format --write ./src",
"format:check": "biome format ./src",
"lint:fast": "oxlint src/",
```
（`lint`, `lint:fix`, `lint-and-format`, `check-code`, `full-check` はそのまま維持）

- [ ] **Step 2: lint-staged を更新**

`package.json` の `lint-staged` を以下に変更:
```json
"lint-staged": {
  "src/**/*.{js,jsx,ts,tsx}": [
    "oxlint",
    "biome check --write"
  ],
  "src/**/*.{json,md}": [
    "biome format --write"
  ]
}
```

- [ ] **Step 3: 動作確認**

```bash
npm run format
```

Expected: `biome format --write ./src` が実行され、エラーなく完了する

```bash
npm run format:check
```

Expected: フォーマットチェックが完了する（差分がなければ0件）

```bash
npm run lint:fast
```

Expected: Oxlintが `src/` を検査する

---

### Task 4: Prettier を削除する

**Files:**
- Modify: `package.json`
- Delete: `.prettierrc.json`
- Delete: `.prettierignore`

- [ ] **Step 1: prettier をアンインストール**

```bash
npm uninstall prettier
```

Note: `package.json` に `prettier-plugin-*` は存在しないので、`prettier` のみアンインストールすればOKのだ。

- [ ] **Step 2: .prettierrc.json と .prettierignore を削除**

```bash
rm .prettierrc.json .prettierignore
```

- [ ] **Step 3: 削除後にformatが動くことを確認**

```bash
npm run format:check
```

Expected: Biomeが正常に動作する（Prettierなしで）

---

### Task 5: ESLint から eslint-config-prettier を除去する

**Files:**
- Modify: `eslint.config.mts`
- Modify: `package.json`

- [ ] **Step 1: eslint.config.mts から eslint-config-prettier のインポートと使用を削除**

`eslint.config.mts` の以下を削除:
```typescript
import eslintConfigPrettier from 'eslint-config-prettier';
```

および以下のブロックを削除:
```typescript
// Prettier configuration
{
  name: 'prettier/config',
  ...eslintConfigPrettier,
},
```

- [ ] **Step 2: eslint-config-prettier をアンインストール**

```bash
npm uninstall eslint-config-prettier
```

- [ ] **Step 3: ESLint が正常動作することを確認**

```bash
npm run lint
```

Expected: ESLintがエラーなく完了する（または既存のlintエラーのみ）

---

### Task 6: CI ワークフローのステップ名を更新する

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Prettierのステップ名をBiomeに更新**

`.github/workflows/ci.yml` の以下を変更:
```yaml
# Before
- name: Check code formatting
  run: npm run format:check

# After
- name: Check code formatting (Biome)
  run: npm run format:check
```

---

### Task 7: PR #1 の動作を総合検証してコミットする

- [ ] **Step 1: 全コマンドを通しで確認**

```bash
npm run format:check
npm run lint:fast
npm run lint
npm run type-check
```

Expected: 全コマンドがエラーなく完了する（lintの警告は許容）

- [ ] **Step 2: コミット（削除ファイルを含む）**

```bash
git rm .prettierrc.json .prettierignore
git add biome.json .oxlintrc.json package.json package-lock.json eslint.config.mts .github/workflows/ci.yml
git commit -m "🔧 chore: Prettier→Biome移行・Oxlint追加・ESLint格下げ #1"
```

Expected: pre-commitフックが正常に動作する（lint-stagedがBiome+Oxlintを実行）

---

## PR #2: Hook設定 + CLAUDE.md整理

### Task 8: .claude/settings.json を作成してHooksを設定する

**Files:**
- Create: `.claude/settings.json`

- [ ] **Step 1: PostToolUse Hook と PreToolUse Hook を設定**

`.claude/settings.json` を以下の内容で作成:

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
    ],
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "if echo \"$CLAUDE_TOOL_INPUT_FILE_PATH\" | grep -qE '(biome\\.json|\\.oxlintrc\\.json|eslint\\.config)'; then echo 'BLOCKED: リンター設定ファイルは直接編集禁止。変更が必要な場合はユーザーに確認してください。'; exit 2; fi"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: PreToolUse Hook の動作を確認**

Claude Codeで `biome.json` の編集を試みてブロックされることを確認する。
（この確認は手動。実際の編集を試みてブロックメッセージが出ればOK）

---

### Task 9: CLAUDE.md を整理する（50行以下）

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md を50行以下に削減**

`CLAUDE.md` を以下の内容で**完全に置き換える**（Write toolを使う）。
内容はポインタ設計に整理し、コマンドブロック・禁止事項・Gitルール・ドキュメント参照表のみ残す。

目標の最終内容（この通りに書く）:

    # CLAUDE.md

    基本的な会話は日本語で。

    ## プロジェクト概要

    **Fishing Conditions App** - 釣り条件をスコア化するPWA
    - **Phase 1 (現在):** Next.js 16 + React 19 フルスタックMVP
    - **技術スタック:** TypeScript, Prisma, PostgreSQL, Tailwind CSS, Auth.js

    ## コマンド

    ` ` `bash
    npm run dev
    npm run type-check && npm run lint && npm run build
    npm run lint:fast   # Oxlint高速チェック
    npm run format      # Biomeフォーマット
    ` ` `

    ## 禁止事項

    - `@ts-ignore`、空catch禁止（根本原因を修正）
    - リンター設定ファイル（biome.json, .oxlintrc.json, eslint.config.*）の直接編集禁止

    ## Git運用

    ` ` `bash
    git commit -m "✨:feat: 機能追加の説明 #TaskNo"
    ` ` `
    Prefixes: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

    ## 詳細ドキュメント（必要時のみ参照）

    | ドキュメント | 内容 |
    |-------------|------|
    | `docs/architecture.md` | システム設計、DB、キャッシュ戦略 |
    | `docs/authentication.md` | Auth.js設定、認証フロー |
    | `docs/api-integration.md` | 外部API連携詳細 |
    | `docs/adr/` | 技術的決定記録（ADR） |
    | `.spec-workflow/steering/` | プロダクト・技術・構造の詳細仕様 |

Note: 上記の ` ` ` はバッククォート3つのコードフェンス（スペースなし）のだ。

- [ ] **Step 2: 行数を確認**

```bash
wc -l /Users/nosawakazuma/Project/FishingConditionsApp/CLAUDE.md
```

Expected: 50行以下

---

### Task 10: 初 ADR を作成する

**Files:**
- Create: `docs/adr/` ディレクトリ
- Create: `docs/adr/001-harness-tooling.md`

- [ ] **Step 1: docs/adr ディレクトリを作成**

```bash
mkdir -p docs/adr
```

- [ ] **Step 2: ADR-001 を作成**

`docs/adr/001-harness-tooling.md`:

```markdown
# ADR-001: Harnessツールチェーン選定

**日付:** 2026-03-20
**ステータス:** 採用済み

## 決定

ローカル開発のlintツールを以下の役割分担で構成する:
- **Oxlint:** PostToolUse Hookでの高速lint（ms単位フィードバック）
- **Biome:** フォーマット + lint autofix（Prettier代替）
- **ESLint:** CIのみで使用する深い静的解析

## 理由

Claude Code等のAIエージェントがファイル編集後に即時フィードバックを受け取り自己修正ループを回すには、PostToolUse Hookのlintツールがmsオーダーで完了する必要がある。ESLintは高精度だが低速であり、Hookには不適切。

## 代替案

- **ESLint一本化:** 低速のためHookには不適切
- **Biomeのみ:** ESLintのルール網羅性（React Hooks等）が失われる

## 結果

`npm run lint:fast`（Oxlint）+ `npm run format`（Biome）がローカル品質ゲートになり、`npm run lint`（ESLint）はCI専用となる。
```

---

### Task 11: PR #2 の動作を総合検証してコミットする

- [ ] **Step 1: Hooks の PostToolUse 動作確認**

任意の `src/` ファイルを編集してOxlint + Biomeが自動実行されることを確認する。
（Claude Code上でファイルを編集し、hookのフィードバックが返ってくればOK）

- [ ] **Step 2: CLAUDE.md の行数確認**

```bash
wc -l CLAUDE.md
```

Expected: 50行以下

- [ ] **Step 3: ADR ファイルの存在確認**

```bash
ls docs/adr/
```

Expected: `001-harness-tooling.md` が存在する

- [ ] **Step 4: コミット**

```bash
git add .claude/settings.json CLAUDE.md docs/adr/001-harness-tooling.md
git commit -m "🔧 chore: Claude Code Hooks設定・CLAUDE.md整理・初ADR追加 #1"
```

---

## 非機能要件チェック（両PRで確認）

- [ ] `npm run type-check && npm run lint && npm run build` が通ること
- [ ] Biome移行後もコードスタイルの一貫性が保たれること（インデント2, シングルクォート, セミコロンあり）
- [ ] 既存のCIパイプライン（.github/workflows/ci.yml）が壊れないこと
