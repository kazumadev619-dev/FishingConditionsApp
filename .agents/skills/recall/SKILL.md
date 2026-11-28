---
name: recall
description: 作業を再開するとき、夜間・外出先の Orca bot が進めた進捗を手元の Antigravity や Claude Code で引き継ぐとき、複数ブランチや worktree の現状を素早く把握したいときに使う。引き継ぎ、今どこまで進んでいるか、昨晩の bot の成果確認、catch me up、recall、といった場面。
---

# recall

> **参考元:** [pstack `recall`](https://github.com/cursor/plugins/tree/main/pstack/skills/recall)

別セッション・別エージェント（Orca bot、Claude Code、Antigravity）の作業を引き継ぐ前に、**いまの正確な現在地と未決事項を 1 画面のブリーフに復元する**スキル。

## 守ること

- **完全に読み取り専用で動く。** ファイルを変更しない、ブランチを切り替えない、GitHub へ書き込まない
- **シークレットを読まない・出さない。** `.env.local` や復号済みファイル、トークン類は参照しない
- **推測で進捗を埋めない。** git / GitHub / ログに実在する事実だけを書く

## 手順

### 1. ローカルのリポジトリ状態を把握する

```bash
git status -sb
git log --oneline -15
git worktree list
```

- 進行中の worktree（Orca やサブエージェントが作ったもの）や未コミットの変更が無いかを見る
- `origin/develop` との差分件数を確認する（`git rev-list --left-right --count HEAD...origin/develop`）

### 2. GitHub 上の進行中スレッドを把握する

```bash
gh pr list --state open --json number,title,headRefName,isDraft,updatedAt,labels
gh issue list --state open --label ready-for-agent --json number,title,assignees,updatedAt
```

- 特定の Issue / PR を引き継ぐ場合は、`gh pr view <N> --comments` または `gh issue view <N> --comments` で直近の判断・レビュー指摘・残課題を読む
- 同じ Issue に複数の PR や worktree が立っていないかも確認する（二重着手の検知）

### 3. 直近ログの確認（必要時のみ）

引き継ぎ対象の会話や bot 実行ログが指定されている、または手元にある場合だけ参照する。

- Antigravity: 対象会話の `transcript.jsonl`（`<appDataDir>/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`）
- Claude Code / Orca: 該当ワークスペースの作業記録・直近コメント

### 4. 引き継ぎブリーフに圧縮する

長いログをそのまま貼らず、「次に何をすればいいか」が一瞬で判断できる形にまとめる。

## 出力の形（固定）

```markdown
## 現在地ブリーフ（<対象ブランチ / PR / Issue または全体>）

### 完了していること
- <コミット / PR / テスト通過など、確認できた事実>

### 進行中・人間判断が必要なこと
- <Draft PR、レビュー待ち、needs-info の質問、承認待ちの提案>

### 注意点・ブロッカー
- <未コミット変更、衝突しそうな開いている PR、二重着手、CI 失敗など。無ければ「なし」>

### 次に打つべき 1 手
1. <最も優先度が高い具体的なアクション>
```
