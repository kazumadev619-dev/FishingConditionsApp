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

daemonはSol計画を直列に行い、workerは最大3件を並列実行する。依存Issueが未完了、または計画の対象パスが競合する場合は待機する。空き枠は次のサイクルで補充される。自動テストはIssueやPRを作成しない。

実Issueの手動E2Eは、人が承認してから行う。まず互いに異なるdocsファイルだけを対象にした無害のIssueを最大3件作成し、Issue番号を控える。この時点では`agent:ready`を付けない。

```bash
gh issue create --title 'E2E: docs guide A' --body 'docs/guides/development.md の誤字だけを修正する'
gh issue create --title 'E2E: docs guide B' --body 'docs/guides/docker.md の誤字だけを修正する'
gh issue create --title 'E2E: docs guide C' --body 'docs/README.md のリンク表記だけを修正する'
gh issue view <A> --json number,title,labels
gh issue view <B> --json number,title,labels
gh issue view <C> --json number,title,labels
```

3件以下で、対象ファイルが重複せず、各Issueに`agent:ready`がないことを確認する。人が開始を判断した時だけ次を実行する。

```bash
gh issue edit <A> <B> <C> --add-label agent:ready
launchctl kickstart -k gui/$(id -u)/com.kazuma-lab.fishing-conditions-ai-factory
npm run factory:status
```

期待結果は、各Issueが`agent:running`または`agent:review`になり、同時worker数が3以下で、対象がdocsの各1ファイルに限られること。検証後は人がIssueとPRをcloseし、`agent:ready`を外す。

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

Issue commentを取得するには対象番号を指定する。

```bash
ISSUE=<番号>
gh issue view "$ISSUE" --comments --json number,labels,comments --jq '.comments[] | select(.body | contains("<!-- ai-factory-plan:v1 -->") or contains("<!-- ai-factory-run:v1 -->") or contains("changed paths are outside the planned paths")) | .body'
```

依存待ちは`<!-- ai-factory-plan:v1 -->`の`dependencies`に未closeのIssueがあり、競合待ちは同markerの`plannedPaths`または`exclusive`が稼働中Issueの計画と重なることを確認して、どちらも`agent:ready`に留める。範囲外の変更では`<!-- ai-factory-run:v1 -->`の`planHash`とworktreeを照合し、`changed paths are outside the planned paths`と`agent:blocked`を確認する。復旧時は同markerのbranch、worktree ID、PID、thread ID、heartbeat、計画hashを確認し、plan markerの入力hashと一致する場合だけ`agent:recovery`を再開する。Watcherは既存PR、runner、resultの順に照合し、dirty worktreeを削除・resetしない。

`agent:blocked`と`agent:failed`は人が原因とworktreeを確認する。安全に再開できる場合だけ、他の状態ラベルを外して`agent:ready`へ戻す。

worktreeの削除はPRのmergeまたはclose後に、未コミット変更がないことを人が確認してから行う。

## Phase 2の境界

Phase 2には自動merge/deploy、Sol/Astraレビュー、Slack通知、Slack Bot、Jev、API key fallback、API従量課金を含めない。
