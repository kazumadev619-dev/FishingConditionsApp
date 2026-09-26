# AI開発Watcher運用ガイド

GitHub Issueをキューとして、Solが計画し、Luna/TerraがIssueごとのworktreeで`develop`向けPRを作るPhase 2の運用手順。

## 前提確認

```bash
node --version
codex --version
codex login status
gh auth status
node -e "const names=['OPENAI_API_KEY','CODEX_API_KEY'].filter((name)=>Object.hasOwn(process.env,name)); console.log(names.length ? 'set: '+names.join(',') : 'API key env: unset')"
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

出力で対象Issue、利用枠の残量、`codex/issue-<N>`、`issue-<N>`、次状態`agent:running`を確認する。`reason: "planning-required"`は有効な計画キャッシュがないことを示し、計画済みなら選択されたLuna/Terraモデルと計画が表示される。dry-runはSolもworkerも起動せず、Issue、ラベル、branch、worktree、PRを変更しない。

実行が承認された場合だけ1回動かす。

```bash
npm run factory:once
```

onceはSolによるread-only計画と最大1つのLuna/Terra workerを実行する。成功時は`agent:ready`から`agent:running`、`agent:review`へ進み、`develop`向けPRを1件作る。計画とworker起動の直前にCodex利用枠を確認し、残量20%以下なら起動しない。Watcherはmergeもdeployも行わない。

## 常駐運用

```bash
npm run factory:install
npm run factory:status
launchctl print gui/$(id -u)/com.kazuma-lab.fishing-conditions-ai-factory
```

daemonはSol計画を直列に行い、workerは最大3件を並列実行する。依存Issueが未完了、または計画の対象パスが競合する場合は待機する。空き枠は次のサイクルで補充される。実Issueで試す場合は、互いに非競合な無害のdocs Issueを最大3件、人が明示的に`agent:ready`へ入れる。自動テストはIssueやPRを作成しない。

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

Issueの`<!-- ai-factory-plan:v1 -->` commentで計画、対象パス、依存Issue、入力hashを確認する。依存待ち・競合待ちはこのmarkerの依存Issueと対象パスを確認し、`agent:ready`に留める。範囲外の変更は`<!-- ai-factory-run:v1 -->` commentの計画hashとworktreeを照合して`agent:blocked`を確認する。復旧時は同markerのbranch、worktree ID、PID、thread ID、heartbeat、計画hashを確認してから`agent:recovery`を再開する。Watcherは既存PR、runner、resultの順に照合し、dirty worktreeを削除・resetしない。

`agent:blocked`と`agent:failed`は人が原因とworktreeを確認する。安全に再開できる場合だけ、他の状態ラベルを外して`agent:ready`へ戻す。

worktreeの削除はPRのmergeまたはclose後に、未コミット変更がないことを人が確認してから行う。

## Phase 2の境界

Phase 2には自動merge/deploy、Sol/Astraレビュー、Slack通知、Slack Bot、Jev、API key fallback、API従量課金を含めない。
