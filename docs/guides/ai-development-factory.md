# AI開発Watcher運用ガイド

GitHub Issueをキューとして、Solが計画し、Luna/TerraがIssueごとのworktreeで`develop`向けPRを作り、CI成功後にSol/Astraが最終レビューする運用手順。

現在の実装仕様は [AI開発ファクトリー現行仕様](../reference/ai-development-factory.md) を参照する。このガイドは操作手順だけを扱う。

## 前提確認

```bash
node --version
codex --version
codex login status
gh auth status
node -e "const names=['OPENAI_API_KEY','CODEX_API_KEY'].filter((name)=>Object.hasOwn(process.env,name)); console.log(names.length ? 'set: '+names.join(',') : 'API key env: unset')"
```

- Node.js 24を使う。
- Codex CLI 0.157.1以上を使い、ChatGPTでログインする。
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

onceは有効な計画cacheがなければSolでread-only計画を行い、最大1つのLuna/Terra workerを実行する。成功時は`agent:ready`から`agent:running`、`agent:review`へ進み、`develop`向けPRを1件作る。計画とworker起動の直前にCodex利用枠を確認し、残量20%以下なら起動しない。既存 `agent:review` のCI監視と最終レビューはdaemon cycleが行う。Watcherは修正、merge、deployを行わない。

## 常駐運用

```bash
npm run factory:install
npm run factory:status
launchctl print gui/$(id -u)/com.kazuma-lab.fishing-conditions-ai-factory
```

daemonはSol計画を直列に行い、workerは最大3件を並列実行する。最終Reviewerはworker枠と別に最大1件だけ実行する。依存Issueが未完了、計画の対象パスが競合する、PR checkが未開始またはpending、quota残量が20%以下の場合は待機する。空き枠は次のサイクルで補充される。自動テストはIssueやPRを作成しない。

実Issueの手動E2Eは、人が承認してから行う。まず互いに異なるdocsファイルから、実在する軽微な置換を人が1件ずつ選ぶ。架空の誤字を指定しない。各候補は、変更前の文字列が対象ファイルにちょうど1件あることを確認する。

```bash
TARGET='docs/guides/development.md' # docs/guides/docker.md や docs/README.md と重複させない
OLD='人が確認した変更前の正確な文字列'
NEW='変更後の正確な文字列'
rg -n --fixed-strings "$OLD" "$TARGET"
rg --count-matches --fixed-strings "$OLD" "$TARGET"
gh issue create --title 'E2E: docs の軽微な置換' --body "対象: $TARGET
変更: \`$OLD\` → \`$NEW\`
確認: 変更前文字列は対象ファイル内で1件"
```

`rg -n`で対象行を確認し、`rg --count-matches`が`1`を返すこと、Issue本文に対象ファイルと正確な旧→新があることを確認する。同じ手順を最大3回繰り返し、対象ファイルを重複させない。この時点では各Issueに`agent:ready`を付けない。人が開始を判断した時だけ次を実行する。

```bash
gh issue edit <A> <B> <C> --add-label agent:ready
launchctl kickstart -k gui/$(id -u)/com.kazuma-lab.fishing-conditions-ai-factory
npm run factory:status
```

期待結果は、各Issueが`agent:running`、`agent:review`、またはCIと最終レビュー合格後の`human:approval`になり、同時worker数が3以下、Reviewerが1以下で、対象がdocsの各1ファイルに限られること。検証後は人がIssueとPRをcloseし、状態ラベルを整理する。

停止とアンインストールは固定labelのLaunchAgentだけを対象にする。

```bash
node scripts/ai-factory/launchd.mjs uninstall
```

この操作はworktree、run log、Issue、branch、PRを削除しない。

## 最終レビューの確認

`agent:review`、対象PR、現在head SHAのcheckをread-onlyで確認する。

```bash
gh issue list --state open --label agent:review
ISSUE=<番号>
BRANCH="codex/issue-$ISSUE"
gh pr list --state open --head "$BRANCH" --json number,isDraft,baseRefName,headRefName,headRefOid,createdAt,files
PR=<PR番号>
gh pr checks "$PR" --json name,workflow,bucket,completedAt
```

checkが0件ならPRの`createdAt`から30分までは待つ。1件でも`pending`なら待機し、`fail`、`cancel`、`skipping`は `agent:blocked` になる。すべて`pass`の場合だけReviewerが始まる。

Watcher所有のreview証拠とローカル状態を確認する。

```bash
gh issue view "$ISSUE" --comments --json labels,comments --jq '.comments[] | select(.body | contains("<!-- ai-factory-review:v1 -->")) | .body'
FACTORY_ROOT="$HOME/Library/Application Support/FishingConditionsApp/ai-factory"
find "$FACTORY_ROOT/review-runs" -maxdepth 2 -type f -print
git worktree list --porcelain
```

running recordでは`model`、`headSha`、`ciFingerprint`、`reviewerPid`、`threadId`、`heartbeatAt`を照合する。PIDは値を表示せず引数として使える。

```bash
REVIEWER_PID=<reviewerPid>
ps -p "$REVIEWER_PID" -o pid=,command=
```

completed recordの`approved`は`documentationCurrent=true`の場合だけ有効である。`changes-required`、確認不能、不正なAstra再昇格では `agent:blocked` になる。Watcherは指摘を自動修正せず、mergeもdeployも行わない。

## 障害復旧

再起動前に状態をread-onlyで確認する。

```bash
gh issue list --state open --label agent:running
gh issue list --state open --label agent:recovery
gh issue list --state open --label agent:review
git worktree list --porcelain
git branch --list 'codex/issue-*'
gh pr list --state all --base develop
```

Issue commentを取得するには対象番号を指定する。

```bash
ISSUE=<番号>
gh issue view "$ISSUE" --comments --json number,labels,comments --jq '.comments[] | select(.body | contains("<!-- ai-factory-plan:v1 -->") or contains("<!-- ai-factory-run:v1 -->") or contains("<!-- ai-factory-review:v1 -->") or contains("changed paths are outside the planned paths") or contains("dirty verification worktree preserved")) | .body'
```

依存待ちは`<!-- ai-factory-plan:v1 -->`の`dependencies`に未closeのIssueがあり、競合待ちは同markerの`plannedPaths`または`exclusive`が稼働中Issueの計画と重なることを確認して、どちらも`agent:ready`に留める。範囲外の変更では`<!-- ai-factory-run:v1 -->`の`planHash`とworktreeを照合し、`changed paths are outside the planned paths`と`agent:blocked`を確認する。worker復旧時は同markerのbranch、worktree ID、PID、thread ID、heartbeat、計画hashを確認し、plan markerの入力hashと一致する場合だけ`agent:recovery`を再開する。Reviewer復旧時はreview markerと現在のPR番号、head SHA、CI fingerprint、model、PID、thread ID、heartbeatを照合する。Watcherは既存PR、runner/reviewer、resultの順に照合し、dirty worktreeを削除・resetしない。

`agent:blocked`と`agent:failed`は人が原因とworktreeを確認する。review修正必須の場合は人が指摘を反映してPR headを更新し、新しいhead SHAのCIを確認する。安全に再開できる場合だけ、他の状態ラベルを外して`agent:ready`へ戻す。

```bash
gh issue edit "$ISSUE" --remove-label agent:blocked --add-label agent:ready
```

この操作は自動修正ではない。人が変更内容、dirty worktree、PR head、再実行の安全性を確認した後だけ行う。

worktreeの削除はPRのmergeまたはclose後に、未コミット変更がないことを人が確認してから行う。

## 現在の境界

現在のWatcherには自動修正、自動merge/deploy、Slack通知、全体観測・週次レポート、Slack Bot、Jev、API key fallback、API従量課金を含めない。
