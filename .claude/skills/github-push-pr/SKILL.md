---
name: github-push-pr
description: GitHubへのPushおよびPR作成を行うスキル。ユーザーが「pushして」「PRを作って」「プッシュしてPR作って」「GitHubにあげて」「PRを出して」などと言った場合、または開発作業が完了してコードを共有・レビューしたいときに必ず使用すること。このプロジェクト専用のコミット形式（絵文字プレフィックス付き）とPRテンプレートに対応している。
---

# GitHub Push & PR 作成スキル

このスキルはGitへのコミット、GitHubへのPush、PR（Pull Request）の作成を一連の流れで行う。

## 前提確認

作業開始前に以下を確認する：

```bash
git status
git diff HEAD
git branch --show-current
git log --oneline -10
```

## ステップ1: 変更の確認と整理

1. `git status` でステージング状態を確認
2. **今回の作業に対応するファイルだけを選択的にステージする**
   - `git add <specific-files>` のように**明示的にパスを指定**する。`git add -A` / `git add .` は使わない。
   - 理由: このリポジトリのワーキングツリーには、無関係な未追跡ファイル（`.claude/`、`docs/_archive/` など）が混ざっていることがある。一括 add すると意図しないファイルまでコミットに入ってしまう。
   - **シークレットは絶対にステージしない**（CLAUDE.md 安全ルール）: `.env` / `*.key` / `kubeconfig` / `*_rsa`。誤って add した場合は即 `git restore --staged <file>`。
3. `git diff --cached --name-only` でステージ対象が意図通りか、`git diff --staged` で内容を最終確認

## ステップ2: コミットメッセージの作成

このプロジェクトのコミット形式に従う：

```
<emoji> <type>: <説明> #<TaskNo>
```

### 絵文字とタイプの対応表

`type` は必ず `commitlint.config.cts` の `type-enum` に含まれる値を使う。ここに無い type（例: `perf` / `ci`）を使うと commit-msg フックの commitlint に弾かれてコミットできない。よく使うものは以下。

| Type | Emoji | 用途 |
|------|-------|------|
| feat | ✨ | 新機能追加 |
| fix | 🐛 | バグ修正 |
| refactor | ♻️ | リファクタリング |
| docs | 📝 | ドキュメント更新 |
| test | ✅ | テスト追加・修正 |
| chore | 🔧 | 設定・ビルド関連 |
| style | 🎨 | フォーマット・見た目 |
| improve | ⚡️ | 既存実装の改善 |

`commitlint.config.cts` が許可する type 全一覧（変更されうるので迷ったら設定ファイルを確認）:
`feat / improve / update / fix / hotfix / refactor / delete / style / docs / move / test / chore / package / WIP`

### commitlint の落とし穴（重要）

このプロジェクトは `commitlint-config-gitmoji` を commit-msg フックで検証している。以下を守らないとコミットが失敗する。

- **絵文字の直後は半角スペース**。`📝 docs: ...` は OK だが `📝:docs:` は NG（`:docs:` が gitmoji コードと誤認され `start-with-gitmoji` エラーになる）。
- 先頭は**有効な gitmoji**（実在する絵文字/コード）であること。
- **ヘッダー（1行目）は 100 文字以内**（`header-max-length`）。長い説明は本文に回す。
- 迷ったら `echo "<msg>" | npx commitlint` でコミット前に検証できる。

### コミット例

```bash
git commit -m "✨ feat: 釣りスポット検索APIにページネーション追加 #123"
git commit -m "🐛 fix: UUID検証のエラーハンドリングを修正 #456"
git commit -m "♻️ refactor: isValidUUID()を型ガード対応に改善 #2"
git commit -m "📝 docs: README を現状に合わせ更新 #10"
```

**重要**: タスク番号（#TaskNo）が不明な場合はユーザーに確認するか、コンテキストから推測する。

## ステップ3: ブランチ確認とPush

### 専用ブランチを用意する

`main` や `develop` に直接コミットしない。作業用ブランチが無ければ **`develop` を基点に**作成する。

```bash
# develop を基点に新規ブランチを作成（例: docs 作業）
git checkout -b <type>/<short-desc> develop
# 例: git checkout -b docs/repo-tidy develop
#     git checkout -b feat/#123_fishing-spot-pagination develop
```

- ブランチ命名: `<type>/<short-desc>` または `<type>/#<issue-no>_<description>`。
- 未コミットの変更があるまま基点ブランチへ切り替える前に、対象ファイルが基点と衝突しないか（`git diff <develop>..HEAD -- <file>` が空か）を確認すると安全。未追跡ファイルはそのまま新ブランチへ持ち越される。

### Push する

```bash
# 新しいブランチの場合（-u フラグ必須）
git push -u origin <branch-name>

# 既存のブランチの場合
git push origin <branch-name>
```

## ステップ4: PR作成

`gh pr create` でPRを作成する。ベースブランチは通常 `develop`（mainではない）。

### PRタイトル形式

コミットメッセージと同様の形式：
```
<emoji> <type>: <説明> #<TaskNo>
```

### PRテンプレート

```bash
gh pr create \
  --base develop \
  --title "<emoji> <type>: <説明> #<TaskNo>" \
  --body "$(cat <<'EOF'
## 概要

<!-- 変更の概要を記述 -->

## 変更内容

- <!-- 変更点1 -->
- <!-- 変更点2 -->

## 関連Issue

closes #<TaskNo>

## テスト計画

- [ ] 型チェック: `npm run type-check`
- [ ] Lint: `npm run lint`
- [ ] ビルド: `npm run build`
- [ ] 手動動作確認

## スクリーンショット（UIの変更がある場合）

<!-- スクリーンショットを貼り付け -->
EOF
)"
```

### PR本文の書き方

- **概要**: 何を変更したか、なぜ変更したかを1〜3文で説明
- **変更内容**: 具体的な変更点をリストアップ
- **関連Issue**: 対応するIssue番号をcloses #XXX形式で記載
- **テスト計画**: 実行したまたは実行すべきテストのチェックリスト

## 注意事項

- `@ts-ignore` や空のcatchブロックが含まれていないか確認
- リンター設定ファイル（biome.json, .oxlintrc.json, eslint.config.*）を誤って変更していないか確認
- PRは `develop` ブランチに向けて作成する（直接 `main` にはPRしない）
- ブランチ名の命名規則: `<type>/#<issue-no>_<description>` 例: `feat/#123_fishing-spot-pagination`
