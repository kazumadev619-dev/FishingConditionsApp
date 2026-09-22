# AI開発Watcher運用ガイド

GitHub Issueをキューとして、単一のTerra runnerが`develop`向けPRを作るPhase 1の運用手順。

## 前提確認

```bash
node --version
codex --version
codex login status
gh auth status
env | rg '^(OPENAI_API_KEY|CODEX_API_KEY)=' || true
```

- Node.js 24を使う。
- Codex CLI 0.155.1以上を使い、ChatGPTでログインする。
- `OPENAI_API_KEY`と`CODEX_API_KEY`は設定しない。存在するとWatcherは停止する。
- `gh`は対象リポジトリを読み書きできるアカウントで認証する。

## 初期設定

GitHubへ書き込むため、ラベル作成は実行前に人の承認を得る。

```bash
node scripts/ai-factory/watcher.mjs --ensure-labels
gh label list --limit 200 | rg '^(agent:|human:approval|done)'
```

## 手動実行

最初に必ずread-onlyのdry-runを行う。

```bash
npm run factory:dry-run
```

出力で対象Issue、利用枠の残量、`gpt-5.6-terra`、`codex/issue-<N>`、`issue-<N>`、次状態`agent:running`を確認する。dry-runはIssue、ラベル、branch、worktree、PR、Codex turnを変更しない。

実行が承認された場合だけ1回動かす。

```bash
npm run factory:once
```

成功時は`agent:ready`から`agent:running`、`agent:review`へ進み、`develop`向けPRを1件作る。Watcherはmergeもdeployも行わない。

## 常駐運用

```bash
npm run factory:install
npm run factory:status
launchctl print gui/$(id -u)/com.kazuma-lab.fishing-conditions-ai-factory
```

停止とアンインストールは固定labelのLaunchAgentだけを対象にする。

```bash
node scripts/ai-factory/launchd.mjs uninstall
```

この操作はworktree、run log、Issue、branch、PRを削除しない。

## 障害復旧

再起動前に状態をread-onlyで確認する。

```bash
gh issue list --state open --label agent:running
gh issue list --state open --label agent:recovery
git worktree list --porcelain
git branch --list 'codex/issue-*'
gh pr list --state all --base develop
```

Issueの`<!-- ai-factory-run:v1 -->` commentにあるbranch、worktree ID、PID、thread ID、heartbeatを確認してからWatcherを再起動する。Watcherは既存PR、runner、resultの順に照合し、dirty worktreeを削除・resetしない。

`agent:blocked`と`agent:failed`は人が原因とworktreeを確認する。安全に再開できる場合だけ、他の状態ラベルを外して`agent:ready`へ戻す。

worktreeの削除はPRのmergeまたはclose後に、未コミット変更がないことを人が確認してから行う。

## Phase 1の境界

Phase 1には自動merge/deploy、Sol/Astraレビュー、3並列runner、Slack通知、Slack Bot、Jev、API key fallback、API従量課金を含めない。
